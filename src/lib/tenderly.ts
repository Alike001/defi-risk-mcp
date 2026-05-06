/**
 * Tenderly Simulation API client.
 *
 * Endpoint (free tier):
 *   POST https://api.tenderly.co/api/v1/account/{user}/project/{project}/simulate
 *   Headers: X-Access-Key: <TENDERLY_ACCESS_KEY>
 *
 * Free tier is 100 simulations / day per IP (architecture.md ADR-005). To
 * avoid burning quota during demos we cache results by a stable hash of the
 * (chain, from, to, value, input) tuple in process memory. The cache is
 * intentionally process-local — Claude Desktop spawns one MCP child per
 * session (ADR-004), so per-process is the correct scope.
 *
 * If any of the three TENDERLY_* env vars are missing, the helper throws a
 * `TenderlyMissingCredentialsError` — the tool layer maps that to a structured
 * MCP error so Claude can render setup instructions instead of crashing.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { SupportedChain } from '../schemas/domain.js';

const TENDERLY_BASE = 'https://api.tenderly.co/api/v1';

/** Maps our chain enum → Tenderly's `network_id` (decimal chain id). */
const TENDERLY_NETWORK_ID: Record<SupportedChain, string> = {
  ethereum: '1',
  base: '8453',
  arbitrum: '42161',
};

/* ------------------------------------------------------------------------- */
/* Errors                                                                     */
/* ------------------------------------------------------------------------- */

export class TenderlyMissingCredentialsError extends Error {
  override readonly name = 'TenderlyMissingCredentialsError';
  constructor(public readonly missing: string[]) {
    super(
      `Tenderly credentials missing: ${missing.join(', ')}. Set TENDERLY_USER, TENDERLY_PROJECT, and TENDERLY_ACCESS_KEY in your environment. See https://docs.tenderly.co/simulations/api for setup instructions.`,
    );
  }
}

export class TenderlyApiError extends Error {
  override readonly name = 'TenderlyApiError';
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------------- */
/* Request / response shapes                                                  */
/* ------------------------------------------------------------------------- */

export interface SimulateRequest {
  chain: SupportedChain;
  /** Sender address. Tenderly uses the zero address if missing. */
  from: `0x${string}`;
  to: `0x${string}`;
  /** Hex-encoded calldata. */
  input: `0x${string}`;
  /** Value in wei as a decimal string. */
  value: string;
  /** Optional gas limit. */
  gas?: number;
  /** Optional gas price in wei (decimal string). */
  gasPrice?: string;
}

/**
 * Subset of the Tenderly response we use. Tenderly returns ~30 KB of detail
 * per simulation; we only need a handful of fields for the v0 risk synthesis.
 */
const tenderlyTransactionInfoSchema = z
  .object({
    call_trace: z.array(z.unknown()).optional(),
    asset_changes: z.array(z.unknown()).optional(),
    balance_changes: z.array(z.unknown()).optional(),
    logs: z.array(z.unknown()).optional(),
  })
  .partial();

const tenderlyTransactionSchema = z
  .object({
    hash: z.string().optional(),
    status: z.boolean().optional(),
    gas_used: z.number().optional(),
    error_message: z.string().nullish(),
    transaction_info: tenderlyTransactionInfoSchema.optional(),
  })
  .partial();

const tenderlySimulationResponseSchema = z
  .object({
    transaction: tenderlyTransactionSchema.optional(),
    simulation: z
      .object({
        id: z.string().optional(),
        status: z.boolean().optional(),
        gas_used: z.number().optional(),
        error_message: z.string().nullish(),
      })
      .partial()
      .optional(),
  })
  .passthrough();

export interface SimulationResult {
  /** True if the EVM accepted the call. */
  success: boolean;
  /** EVM gas used. 0 if unknown. */
  gasUsed: number;
  /** Revert reason if `success === false`, else null. */
  errorMessage: string | null;
  /** Tenderly's per-token asset deltas (raw shape passthrough). */
  assetChanges: unknown[];
  /** Tenderly's per-account balance deltas (raw shape passthrough). */
  balanceChanges: unknown[];
  /** Logs emitted in the simulation. */
  logs: unknown[];
  /** Tenderly internal simulation id (for debugging). */
  simulationId: string | null;
  /** True iff the result was served from the in-process cache. */
  cached: boolean;
}

/* ------------------------------------------------------------------------- */
/* In-process cache                                                           */
/* ------------------------------------------------------------------------- */

/**
 * Map<cacheKey, SimulationResult>. Module-scoped so all callers within one
 * MCP process share the same cache. Cap at 256 entries to bound memory.
 */
const SIM_CACHE = new Map<string, SimulationResult>();
const CACHE_CAP = 256;

/** Stable hash of the simulation request — collision-resistant for v0. */
export function cacheKeyFor(req: SimulateRequest): string {
  const h = createHash('sha256');
  h.update(req.chain);
  h.update('|');
  h.update(req.from.toLowerCase());
  h.update('|');
  h.update(req.to.toLowerCase());
  h.update('|');
  h.update(req.value);
  h.update('|');
  h.update(req.input.toLowerCase());
  return h.digest('hex');
}

/** Test seam — clear the cache between tests. */
export function clearSimulationCache(): void {
  SIM_CACHE.clear();
}

/* ------------------------------------------------------------------------- */
/* Public API                                                                 */
/* ------------------------------------------------------------------------- */

export interface TenderlyClientOptions {
  /** Override fetch (test injection). */
  fetchImpl?: typeof fetch;
  /** Override the Tenderly base URL (tests). */
  baseUrl?: string;
  /** Override env credentials (tests). */
  user?: string;
  project?: string;
  accessKey?: string;
  /** Skip cache lookup (force re-simulate). */
  bypassCache?: boolean;
}

/**
 * Resolve credentials from env (or options). Throws
 * `TenderlyMissingCredentialsError` when any of the three are unset — the
 * tool layer turns that into a structured MCP error response.
 */
export function resolveCredentials(options: TenderlyClientOptions = {}): {
  user: string;
  project: string;
  accessKey: string;
} {
  const user = options.user ?? process.env.TENDERLY_USER ?? '';
  const project = options.project ?? process.env.TENDERLY_PROJECT ?? '';
  const accessKey = options.accessKey ?? process.env.TENDERLY_ACCESS_KEY ?? '';

  const missing: string[] = [];
  if (!user) missing.push('TENDERLY_USER');
  if (!project) missing.push('TENDERLY_PROJECT');
  if (!accessKey) missing.push('TENDERLY_ACCESS_KEY');

  if (missing.length > 0) {
    throw new TenderlyMissingCredentialsError(missing);
  }
  return { user, project, accessKey };
}

/**
 * Run one simulation. Caches successful + failed responses by request hash.
 *
 * Throws on:
 *   - missing credentials (`TenderlyMissingCredentialsError`)
 *   - non-2xx HTTP response (`TenderlyApiError`)
 *   - network failure (rethrows the original error)
 */
export async function simulateTransaction(
  req: SimulateRequest,
  options: TenderlyClientOptions = {},
): Promise<SimulationResult> {
  const cacheKey = cacheKeyFor(req);
  if (!options.bypassCache) {
    const hit = SIM_CACHE.get(cacheKey);
    if (hit) return { ...hit, cached: true };
  }

  const { user, project, accessKey } = resolveCredentials(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl ?? TENDERLY_BASE;
  const url = `${base}/account/${encodeURIComponent(user)}/project/${encodeURIComponent(project)}/simulate`;

  const body = {
    network_id: TENDERLY_NETWORK_ID[req.chain],
    from: req.from,
    to: req.to,
    input: req.input,
    value: req.value,
    gas: req.gas,
    gas_price: req.gasPrice,
    save: false,
    save_if_fails: false,
    simulation_type: 'quick',
  };

  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'X-Access-Key': accessKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      // ignore — the status code alone is enough
    }
    throw new TenderlyApiError(
      `Tenderly simulate ${res.status} ${res.statusText}: ${detail.slice(0, 240)}`,
      res.status,
    );
  }

  const raw: unknown = await res.json();
  const parsed = tenderlySimulationResponseSchema.parse(raw);

  const tx = parsed.transaction ?? {};
  const sim = parsed.simulation ?? {};
  const info = tx.transaction_info ?? {};

  const result: SimulationResult = {
    success: tx.status ?? sim.status ?? false,
    gasUsed: tx.gas_used ?? sim.gas_used ?? 0,
    errorMessage: tx.error_message ?? sim.error_message ?? null,
    assetChanges: info.asset_changes ?? [],
    balanceChanges: info.balance_changes ?? [],
    logs: info.logs ?? [],
    simulationId: sim.id ?? null,
    cached: false,
  };

  // Bound cache size — drop the oldest entry when we hit the cap.
  if (SIM_CACHE.size >= CACHE_CAP) {
    const firstKey = SIM_CACHE.keys().next().value;
    if (firstKey !== undefined) SIM_CACHE.delete(firstKey);
  }
  SIM_CACHE.set(cacheKey, result);
  return result;
}
