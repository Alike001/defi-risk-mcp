/**
 * DefiLlama protocol-metadata client.
 *
 * Why DefiLlama: free, no key, generous limits (per architecture.md ADR-005)
 * and the canonical mirror for protocol slugs + TVL across 100+ chains.
 *
 * Endpoints used:
 *   GET https://api.llama.fi/protocol/{slug}    — full protocol detail
 *   GET https://api.llama.fi/protocols          — full directory (cached locally)
 *
 * We intentionally do NOT cache the response across MCP sessions — Claude
 * Desktop spawns one MCP child per session, so per-process memoization is
 * sufficient (ADR-004 — stateless, in-memory only).
 */

import { z } from 'zod';

const DEFILLAMA_BASE = 'https://api.llama.fi';
const DEFILLAMA_YIELDS_BASE = 'https://yields.llama.fi';

/** Subset of the DefiLlama protocol-detail response we care about. */
const protocolDetailSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  // DefiLlama serves chains with capitalized names (Ethereum, Arbitrum, Base)
  chains: z.array(z.string()).default([]),
  category: z.string().nullish(),
  // `tvl` is sometimes a number, sometimes an array of {date, totalLiquidityUSD}
  tvl: z.union([z.number(), z.array(z.unknown())]).optional(),
  url: z.string().url().nullish(),
  audit_links: z.array(z.string().url()).default([]),
  audits: z.string().nullish(),
  audit_note: z.string().nullish(),
  description: z.string().nullish(),
});

export interface ProtocolMetadata {
  /** Canonical name as DefiLlama displays it (e.g. "Aave V3"). */
  name: string;
  /** Lower-case chain names (we normalize). */
  chains: string[];
  /** Approx TVL (USD). 0 if not available. */
  tvlUsd: number;
  category: string | null;
  url: string | null;
  /** DefiLlama-categorical audit signal: e.g. "0", "1", "2", "3". */
  auditTier: string | null;
  /** Free-form note from DefiLlama if present. */
  auditNote: string | null;
  auditLinks: string[];
  description: string | null;
}

export interface DefiLlamaClientOptions {
  /** Override fetch (test injection). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Override base URL (tests). */
  baseUrl?: string;
}

export class DefiLlamaUnknownProtocolError extends Error {
  override readonly name = 'DefiLlamaUnknownProtocolError';
  constructor(public readonly slug: string) {
    super(`DefiLlama has no protocol with slug "${slug}".`);
  }
}

/**
 * Fetch + parse a single protocol's metadata.
 *
 * Throws `DefiLlamaUnknownProtocolError` on 404, generic `Error` on other
 * upstream failures. Errors are NEVER swallowed silently — see banned
 * patterns in architecture.md.
 */
export async function fetchProtocolMetadata(
  slug: string,
  options: DefiLlamaClientOptions = {},
): Promise<ProtocolMetadata> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl ?? DEFILLAMA_BASE;
  const url = `${base}/protocol/${encodeURIComponent(slug)}`;

  const res = await fetchImpl(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });

  if (res.status === 404) {
    throw new DefiLlamaUnknownProtocolError(slug);
  }
  if (!res.ok) {
    throw new Error(`DefiLlama ${url} → HTTP ${res.status} ${res.statusText}`);
  }

  const raw: unknown = await res.json();
  const parsed = protocolDetailSchema.parse(raw);

  // tvl can be number, array, or missing — pull a usable scalar
  let tvlUsd = 0;
  if (typeof parsed.tvl === 'number') {
    tvlUsd = parsed.tvl;
  } else if (Array.isArray(parsed.tvl) && parsed.tvl.length > 0) {
    const last = parsed.tvl[parsed.tvl.length - 1];
    if (last && typeof last === 'object' && 'totalLiquidityUSD' in last) {
      const v = (last as { totalLiquidityUSD?: unknown }).totalLiquidityUSD;
      if (typeof v === 'number') tvlUsd = v;
    }
  }

  return {
    name: parsed.name,
    chains: parsed.chains.map((c) => c.toLowerCase()),
    tvlUsd,
    category: parsed.category ?? null,
    url: parsed.url ?? null,
    auditTier: parsed.audits ?? null,
    auditNote: parsed.audit_note ?? null,
    auditLinks: parsed.audit_links ?? [],
    description: parsed.description ?? null,
  };
}

/* ------------------------------------------------------------------------- */
/* Yields API                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Schema for one entry in `https://yields.llama.fi/pools` (`data[]`). We
 * intentionally validate only the fields we use — DefiLlama returns ~20
 * additional metrics per pool and we want this client to keep working when
 * they add new ones.
 *
 * Two fields drive the F4 real-yield separation:
 *   - `apyBase`   = APY from underlying revenue (real yield)
 *   - `apyReward` = APY from inflationary token emissions
 * `apy` is the headline (apyBase + apyReward when both present).
 *
 * When apyBase is null but apy is non-null we cannot separate the two — the
 * tool layer marks the candidate `real_yield_estimated: true` and uses `apy`
 * as a conservative real-yield estimate (per the F4 honesty rule).
 */
const yieldPoolSchema = z
  .object({
    chain: z.string(),
    project: z.string(),
    symbol: z.string(),
    pool: z.string(),
    tvlUsd: z.number().nullable().default(0),
    apyBase: z.number().nullable().optional(),
    apyReward: z.number().nullable().optional(),
    apy: z.number().nullable().optional(),
    apyMean30d: z.number().nullable().optional(),
    rewardTokens: z.array(z.string()).nullable().optional(),
    stablecoin: z.boolean().optional(),
    ilRisk: z.string().nullable().optional(),
    exposure: z.string().nullable().optional(),
    poolMeta: z.string().nullable().optional(),
    underlyingTokens: z.array(z.string()).nullable().optional(),
    outlier: z.boolean().optional(),
  })
  .passthrough();

const yieldsResponseSchema = z.object({
  status: z.string().optional(),
  data: z.array(yieldPoolSchema),
});

/** Typed view of a single pool. Mirrors what `discover_yields_by_intent` consumes. */
export interface YieldPool {
  chain: string;
  project: string;
  symbol: string;
  poolId: string;
  tvlUsd: number;
  apyBase: number | null;
  apyReward: number | null;
  apy: number | null;
  apyMean30d: number | null;
  rewardTokens: string[];
  stablecoin: boolean;
  ilRisk: string | null;
  exposure: string | null;
  poolMeta: string | null;
  underlyingTokens: string[];
  outlier: boolean;
}

export class DefiLlamaYieldsError extends Error {
  override readonly name = 'DefiLlamaYieldsError';
}

/**
 * Fetch the full DefiLlama Yields pool list. No key required (per ADR-005).
 *
 * The endpoint returns ~15K pools (~10–15 MB JSON). Callers should narrow
 * down via the intent-based filter as soon as possible — we do NOT cache the
 * full set across MCP processes (per ADR-004 — stateless).
 */
export async function fetchYieldPools(options: DefiLlamaClientOptions = {}): Promise<YieldPool[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl ?? DEFILLAMA_YIELDS_BASE;
  const url = `${base}/pools`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DefiLlamaYieldsError(`fetch ${url} failed: ${msg}`);
  }

  if (!res.ok) {
    throw new DefiLlamaYieldsError(`${url} → HTTP ${res.status} ${res.statusText}`);
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DefiLlamaYieldsError(`response was not JSON: ${msg}`);
  }

  const parsed = yieldsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DefiLlamaYieldsError(
      `yields response did not match schema: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }

  return parsed.data.data.map((p) => ({
    chain: p.chain,
    project: p.project,
    symbol: p.symbol,
    poolId: p.pool,
    tvlUsd: p.tvlUsd ?? 0,
    apyBase: p.apyBase ?? null,
    apyReward: p.apyReward ?? null,
    apy: p.apy ?? null,
    apyMean30d: p.apyMean30d ?? null,
    rewardTokens: p.rewardTokens ?? [],
    stablecoin: p.stablecoin ?? false,
    ilRisk: p.ilRisk ?? null,
    exposure: p.exposure ?? null,
    poolMeta: p.poolMeta ?? null,
    underlyingTokens: p.underlyingTokens ?? [],
    outlier: p.outlier ?? false,
  }));
}
