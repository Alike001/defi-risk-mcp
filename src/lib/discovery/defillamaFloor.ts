/**
 * Discovery Path 3 — DefiLlama Yields direct (the absolute floor).
 *
 * Per ADR-006 this is the path that always works. No API key required, no
 * external dependency on Index Network or Brave. When `INDEX_NETWORK_KEY`
 * and `BRAVE_SEARCH_API_KEY` are both unset (or both upstreams fail), the
 * router falls back here so `discover_yields_by_intent` still returns a
 * useful candidate set.
 *
 * Pipeline:
 *   1. Fetch the full DefiLlama Yields list (`https://yields.llama.fi/pools`)
 *   2. Apply the parsed `IntentConstraints` via `lib/yieldFilter`
 *   3. Score each surviving pool — F4 real-yield separation + audit/TVL/IL
 *   4. Sort ascending by `risk_score` and slice to `limit`
 *
 * The `discoverYieldsByIntent` tool used to inline this exact logic; story
 * #8 lifts it into this file so:
 *   (a) the router can compose it as one path among many
 *   (b) the Brave path can reuse the same scoring/synthesis (Brave's role is
 *       only to PICK protocols — risk metrics still come from DefiLlama)
 *   (c) a single change to scoring touches one file, not three.
 *
 * Failure posture:
 *   - DefiLlama unreachable → throws `DefiLlamaFloorError`. This is the floor;
 *     when the floor fails the router emits the structured `all_paths_failed`
 *     tool error.
 *   - Empty result is a valid response (`candidates: []`) — we never fabricate
 *     candidates to pad the count.
 */

import type {
  IntentConstraints,
  YieldCandidate,
  YieldCandidateDataSource,
} from '../../schemas/domain.js';
import type { DefiLlamaClientOptions, YieldPool } from '../defillama.js';
import { fetchYieldPools } from '../defillama.js';
import { classifyRealYield } from '../realYield.js';
import { AUDITED_PROJECTS, filterPools } from '../yieldFilter.js';

/** Default per-path timeout. Mirrors the router's 8s cap. */
const DEFAULT_TIMEOUT_MS = 8_000;

export class DefiLlamaFloorError extends Error {
  override readonly name = 'DefiLlamaFloorError';
  constructor(message: string) {
    super(`defillama_floor_error: ${message}`);
  }
}

export class DefiLlamaFloorTimeoutError extends Error {
  override readonly name = 'DefiLlamaFloorTimeoutError';
  constructor(public readonly timeoutMs: number) {
    super(`DefiLlama floor path timed out after ${timeoutMs}ms`);
  }
}

export interface DefiLlamaFloorOptions {
  constraints: IntentConstraints;
  /** Optional set of project slugs that should be tagged as Index/Brave hits. */
  signalProtocols?: ReadonlySet<string>;
  /** Cap on returned candidates after risk-sort. */
  limit: number;
  /** Hard timeout for the path. Defaults to 8s. */
  timeoutMs?: number;
  /** Per-candidate provenance flag (defaults to `defillama`). */
  dataSource?: YieldCandidateDataSource;
  /** Test seam — alternative DefiLlama Yields fetcher. */
  fetchPools?: (options?: DefiLlamaClientOptions) => Promise<YieldPool[]>;
}

export interface DefiLlamaFloorResult {
  candidates: YieldCandidate[];
  /** Total surviving pools before slicing — useful for diagnostics. */
  filteredCount: number;
  /** Total pools fetched from DefiLlama before filtering. */
  totalPoolCount: number;
}

/**
 * Run the DefiLlama floor path.
 *
 * Pure-ish: the only side effect is the HTTP fetch (or the injected
 * `fetchPools` stub). No process.stderr writes — diagnostic logging is the
 * router's job so we keep one log line per tool invocation.
 */
export async function runDefiLlamaFloor(
  options: DefiLlamaFloorOptions,
): Promise<DefiLlamaFloorResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchPools ?? fetchYieldPools;
  const signalProtocols = options.signalProtocols ?? new Set<string>();
  const dataSource: YieldCandidateDataSource = options.dataSource ?? 'defillama';

  let pools: YieldPool[];
  try {
    pools = await runWithTimeout(
      fetchImpl(),
      timeoutMs,
      () => new DefiLlamaFloorTimeoutError(timeoutMs),
    );
  } catch (err) {
    if (err instanceof DefiLlamaFloorTimeoutError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new DefiLlamaFloorError(msg);
  }

  const filtered = filterPools(pools, options.constraints);

  const candidates: YieldCandidate[] = filtered
    .map((pool) => buildCandidate(pool, options.constraints, signalProtocols, dataSource))
    // Sort ASC by risk_score (safest first) — BDD requirement.
    .sort((a, b) => a.risk_score - b.risk_score)
    .slice(0, options.limit);

  return {
    candidates,
    filteredCount: filtered.length,
    totalPoolCount: pools.length,
  };
}

/* ------------------------------------------------------------------------- */
/* Candidate synthesis                                                        */
/* ------------------------------------------------------------------------- */

interface ScoreInputs {
  pool: YieldPool;
  audited: boolean;
  classification: ReturnType<typeof classifyRealYield>;
}

/**
 * Risk scoring — deterministic, additive, capped at [0, 100]. Lower = safer.
 * Mirrors the original implementation in `discoverYieldsByIntent.ts` (story
 * #7) verbatim — extracted here so the router can reuse it across paths.
 */
export function scoreRisk(inputs: ScoreInputs): number {
  const { pool, audited, classification } = inputs;
  let score = 0;

  if (!audited) score += 25;

  if (pool.tvlUsd >= 1_000_000_000) score += 0;
  else if (pool.tvlUsd >= 100_000_000) score += 5;
  else if (pool.tvlUsd >= 10_000_000) score += 12;
  else if (pool.tvlUsd >= 1_000_000) score += 20;
  else score += 30;

  if (classification.estimated) score += 20;
  else if (classification.band === 'mostly_inflationary') score += 15;

  const il = (pool.ilRisk ?? '').toLowerCase();
  if (il === 'yes') score += 10;
  else if (!il) score += 5;

  if (pool.stablecoin) score -= 5;
  if (pool.outlier) score += 10;

  if (score < 0) score = 0;
  if (score > 100) score = 100;
  return score;
}

function buildCandidate(
  pool: YieldPool,
  constraints: IntentConstraints,
  signalProtocols: ReadonlySet<string>,
  dataSource: YieldCandidateDataSource,
): YieldCandidate {
  const cls = classifyRealYield(pool);
  const audited = AUDITED_PROJECTS.has(pool.project.toLowerCase());
  const signal = signalProtocols.has(pool.project.toLowerCase());

  const riskScore = scoreRisk({ pool, audited, classification: cls });
  const why = buildWhyRecommended({
    pool,
    classification: cls,
    audited,
    signal,
    constraints,
    riskScore,
    dataSource,
  });

  return {
    protocol: pool.project,
    chain: pool.chain.toLowerCase(),
    symbol: pool.symbol,
    apy: round2(cls.apy),
    real_yield: round2(cls.realYield),
    real_yield_estimated: cls.estimated,
    risk_score: riskScore,
    tvl_usd: pool.tvlUsd,
    is_stablecoin: pool.stablecoin,
    il_risk: pool.ilRisk,
    pool_id: pool.poolId,
    audited,
    why_recommended: why,
    data_source: dataSource,
  };
}

interface WhyInputs {
  pool: YieldPool;
  classification: ReturnType<typeof classifyRealYield>;
  audited: boolean;
  signal: boolean;
  constraints: IntentConstraints;
  riskScore: number;
  dataSource: YieldCandidateDataSource;
}

function buildWhyRecommended(inputs: WhyInputs): string {
  const { pool, classification, audited, signal, constraints, riskScore, dataSource } = inputs;
  const parts: string[] = [];

  parts.push(`${pool.project} on ${pool.chain} (${pool.symbol}) — risk score ${riskScore}/100.`);
  parts.push(classification.narrative);
  parts.push(
    audited
      ? 'Project has audit evidence in our cache.'
      : 'No audit evidence in our cache (treat with extra caution).',
  );
  parts.push(`TVL ≈ $${formatUsd(pool.tvlUsd)}.`);
  if (pool.ilRisk && pool.ilRisk.toLowerCase() === 'yes') {
    parts.push('DefiLlama flags non-zero impermanent-loss exposure for this pool.');
  }
  if (constraints.no_rebase) {
    parts.push('Passes the "no rebase" constraint (symbol does not match known rebase tokens).');
  }
  if (signal && dataSource === 'brave_inferred') {
    parts.push('Brave web search surfaced this protocol for the intent (heuristic signal).');
  } else if (signal) {
    parts.push('Index Network agent matchmaker also surfaced this protocol for the intent.');
  }
  return parts.join(' ');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatUsd(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}

/* ------------------------------------------------------------------------- */
/* Internals                                                                  */
/* ------------------------------------------------------------------------- */

function runWithTimeout<T>(promise: Promise<T>, ms: number, makeError: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(makeError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
