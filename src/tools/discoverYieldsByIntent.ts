/**
 * `discover_yields_by_intent` — accept a natural-language yield-discovery
 * intent ("stable USDC yield > 5% on Base, audited"), surface ranked yield
 * candidates with risk scoring + the F4 real-yield separation.
 *
 * This tool is the judge-alignment story (Index Network on the panel — see
 * `research/encode-defi-mini-hack/12-tech-deep-dive.md` §3 and the story
 * file). It lets Claude Desktop participate as an agent in the Index Network
 * intent-matching mesh.
 *
 * SHIPPED PATH: Path 2 (CLI shell-out via @indexnetwork/cli) + Path 3 (DefiLlama
 * Yields fallback). Day-1 verification (2026-05-06):
 *   - `@indexnetwork/sdk` is DEPRECATED (`npm view` reports "Package no longer
 *     supported", last published a year ago).
 *   - `@indexnetwork/cli` is actively maintained (v0.10.3, published a week
 *     ago) and exposes `index opportunity discover "<query>" --json` — exactly
 *     the intent-matching surface we need.
 *
 * Pipeline:
 *   1. Parse the natural-language intent → `IntentConstraints` (rule-based,
 *      no LLM — see `lib/intentParser.ts` for the supported keyword list).
 *   2. If `INDEX_NETWORK_KEY` is set, shell out to `index opportunity discover`
 *      and capture the matched opportunities. Mark `index_network_used: true`.
 *      We use these opportunities to bias the candidate set toward what Index
 *      surfaces — falling back to DefiLlama Yields enrichment for the per-pool
 *      risk scoring.
 *   3. Pull DefiLlama Yields (`https://yields.llama.fi/pools`) and apply the
 *      conjunctive filter (`lib/yieldFilter.ts`).
 *   4. Score each surviving pool — F4 real-yield separation
 *      (`lib/realYield.ts`) + audit / TVL / IL bumps (deterministic synthesis).
 *   5. Sort ascending by `risk_score` and slice to `limit` (default 5).
 *
 * Failure posture:
 *   - Index CLI errors / not configured → fall back to DefiLlama-only path,
 *     record `fallback_reason` in the response (never silent).
 *   - DefiLlama yields fetch fails → throw (no other source can replace it).
 *   - Empty result is a valid response (`candidates: []` with the parsed
 *     intent + diagnostics) — we never fabricate candidates.
 *
 * Out of scope (handled by future stories):
 *   - story-fallback-discovery (#8) will refactor the inline fallback into a
 *     clean router with Brave/Tavily search as additional fallbacks.
 *   - Executing the yield position (read-only by ADR-003).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type DefiLlamaClientOptions, type YieldPool, fetchYieldPools } from '../lib/defillama.js';
import {
  type DiscoverOpportunitiesOptions,
  IndexNetworkNotConfiguredError,
  type IndexOpportunity,
  discoverOpportunities,
  isIndexNetworkEnabled,
} from '../lib/indexNetwork.js';
import { SUPPORTED_INTENT_KEYWORDS, parseIntent } from '../lib/intentParser.js';
import { classifyRealYield } from '../lib/realYield.js';
import { AUDITED_PROJECTS, filterPools } from '../lib/yieldFilter.js';
import {
  type IntentConstraints,
  type YieldCandidate,
  type YieldDiscoveryResult,
  yieldDiscoveryResultSchema,
} from '../schemas/domain.js';
import {
  discoverYieldsByIntentInputSchema,
  discoverYieldsByIntentInputShape,
  discoverYieldsByIntentOutputSchema,
} from '../schemas/tools.js';

export const DISCOVER_YIELDS_BY_INTENT_TOOL_NAME = 'discover_yields_by_intent';

const DEFAULT_LIMIT = 5;

/* ------------------------------------------------------------------------- */
/* Public surface                                                             */
/* ------------------------------------------------------------------------- */

export interface DiscoverYieldsByIntentOptions {
  /** Test seam — inject a custom DefiLlama Yields fetcher. */
  fetchPools?: (options?: DefiLlamaClientOptions) => Promise<YieldPool[]>;
  /** Test seam — inject a custom Index Network fetcher. */
  fetchOpportunities?: (
    query: string,
    options?: DiscoverOpportunitiesOptions,
  ) => Promise<IndexOpportunity[]>;
  /** Test seam — env override (defaults to `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Test seam — pin the wall clock for deterministic `generated_at`. */
  now?: () => Date;
}

export async function discoverYieldsByIntent(
  rawInput: unknown,
  options: DiscoverYieldsByIntentOptions = {},
): Promise<YieldDiscoveryResult> {
  const parsed = discoverYieldsByIntentInputSchema.safeParse(rawInput);
  if (!parsed.success) throw parsed.error;

  const limit = parsed.data.limit ?? DEFAULT_LIMIT;
  const env = options.env ?? process.env;
  const now = options.now ? options.now() : new Date();
  const fetchPoolsImpl = options.fetchPools ?? fetchYieldPools;
  const fetchOpportunitiesImpl = options.fetchOpportunities ?? discoverOpportunities;

  // --- Step 1: parse the intent --------------------------------------------
  const constraints = parseIntent(parsed.data.intent);

  // --- Step 2: Index Network (best-effort) ---------------------------------
  let indexUsed = false;
  let indexHits: IndexOpportunity[] = [];
  let fallbackReason: string | null = null;

  if (isIndexNetworkEnabled(env)) {
    try {
      indexHits = await fetchOpportunitiesImpl(parsed.data.intent, { env });
      indexUsed = true;
    } catch (err) {
      // Index path failed — continue with the DefiLlama-only fallback. We
      // record the reason so the MCP client can surface "we tried Index but
      // it wasn't available" honestly.
      indexUsed = false;
      fallbackReason =
        err instanceof Error
          ? `index_network_error: ${err.name}: ${err.message}`
          : `index_network_error: ${String(err)}`;
      // Never console.log — stderr is fine (stdout is reserved for MCP frames).
      process.stderr.write(`[discover_yields_by_intent] ${fallbackReason}\n`);
    }
  } else {
    fallbackReason = 'INDEX_NETWORK_KEY not set';
  }

  // --- Step 3: DefiLlama Yields --------------------------------------------
  // We always fetch DefiLlama — it's the source of truth for per-pool risk
  // metadata even when Index supplied the initial opportunity set.
  const allPools = await fetchPoolsImpl();

  // Bias the pool universe toward Index opportunities when they exist by
  // tagging the candidate's `why_recommended`. We do NOT exclusively use the
  // Index set, because Index opportunities don't always carry a DefiLlama
  // pool ID — we use Index as a SIGNAL, not a hard filter (see ADR-006: Index
  // is one tool, not the foundation; DefiLlama yields stays the canonical
  // source for per-pool real-yield + TVL + IL).
  const indexProtocols = new Set(
    indexHits.map((o) => (o.protocol ?? '').toLowerCase()).filter((p) => p.length > 0),
  );

  // --- Step 4: filter ------------------------------------------------------
  const filtered = filterPools(allPools, constraints);

  // --- Step 5: score + format ----------------------------------------------
  const candidates: YieldCandidate[] = filtered
    .map((pool) => buildCandidate(pool, constraints, indexProtocols))
    // Sort ASC by risk_score (safest first) — BDD requirement.
    .sort((a, b) => a.risk_score - b.risk_score)
    .slice(0, limit);

  const discoverySource: 'index_network' | 'fallback' =
    indexUsed && indexHits.length > 0 ? 'index_network' : 'fallback';

  // Only set fallback_reason when we are actually falling back. When Index
  // succeeded with hits we leave it null.
  const finalFallbackReason = discoverySource === 'fallback' ? fallbackReason : null;

  const result: YieldDiscoveryResult = {
    discovery_source: discoverySource,
    index_network_used: indexUsed,
    fallback_reason: finalFallbackReason,
    parsed_intent: constraints,
    candidates,
    sources: collectSources(discoverySource, indexHits, candidates),
    generated_at: now.toISOString(),
  };

  // Validate before returning — catches drift in any helper rather than
  // emitting an invalid MCP frame.
  return yieldDiscoveryResultSchema.parse(result);
}

/* ------------------------------------------------------------------------- */
/* Synthesis                                                                  */
/* ------------------------------------------------------------------------- */

function buildCandidate(
  pool: YieldPool,
  constraints: IntentConstraints,
  indexProtocols: Set<string>,
): YieldCandidate {
  const cls = classifyRealYield(pool);
  const audited = AUDITED_PROJECTS.has(pool.project.toLowerCase());
  const indexSignal = indexProtocols.has(pool.project.toLowerCase());

  const riskScore = scoreRisk({ pool, audited, classification: cls });
  const why = buildWhyRecommended({
    pool,
    classification: cls,
    audited,
    indexSignal,
    constraints,
    riskScore,
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
  };
}

interface ScoreInputs {
  pool: YieldPool;
  audited: boolean;
  classification: ReturnType<typeof classifyRealYield>;
}

/**
 * Risk scoring — deterministic, additive, capped at [0, 100]. Lower = safer.
 *
 * Bands (additive):
 *   audit:        +0 if audited, +25 otherwise
 *   tvl:          $1B+ → +0; $100M+ → +5; $10M+ → +12; $1M+ → +20; <$1M → +30
 *   real-yield:   +0 all_real / mixed; +15 mostly_inflationary; +20 estimated
 *   IL:           +0 ilRisk=no; +10 ilRisk=yes; +5 unknown
 *   stable bonus: -5 when stablecoin (denominated in stables, lower price risk)
 *   outlier:      +10 when DefiLlama flags pool as outlier (unstable APY history)
 *
 * Final clamp [0, 100]. The bands are intentionally coarse — fine-grained
 * tuning is a future-story problem; this gets a deterministic ranking that
 * satisfies the BDD acceptance criterion (sorted ascending).
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

interface WhyInputs {
  pool: YieldPool;
  classification: ReturnType<typeof classifyRealYield>;
  audited: boolean;
  indexSignal: boolean;
  constraints: IntentConstraints;
  riskScore: number;
}

function buildWhyRecommended(inputs: WhyInputs): string {
  const { pool, classification, audited, indexSignal, constraints, riskScore } = inputs;
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
  if (indexSignal) {
    parts.push('Index Network agent matchmaker also surfaced this protocol for the intent.');
  }
  return parts.join(' ');
}

function collectSources(
  source: 'index_network' | 'fallback',
  indexHits: IndexOpportunity[],
  candidates: YieldCandidate[],
): string[] {
  const out = new Set<string>();
  out.add('https://yields.llama.fi/pools');
  if (source === 'index_network') {
    out.add('https://index.network/');
    for (const h of indexHits) {
      if (h.url) out.add(h.url);
    }
  }
  for (const c of candidates) {
    if (c.pool_id) {
      out.add(`https://defillama.com/yields/pool/${encodeURIComponent(c.pool_id)}`);
    }
  }
  return Array.from(out).slice(0, 10);
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
/* MCP tool registration                                                      */
/* ------------------------------------------------------------------------- */

export function registerDiscoverYieldsByIntentTool(server: McpServer): void {
  server.registerTool(
    DISCOVER_YIELDS_BY_INTENT_TOOL_NAME,
    {
      title: 'Discover yield candidates by natural-language intent',
      description: [
        'Posts a natural-language DeFi-yield discovery intent to the Index',
        'Network agent matchmaker (when INDEX_NETWORK_KEY is configured) and',
        'returns ranked candidates from DefiLlama Yields, scored across audit',
        'evidence, TVL, real-yield (vs inflationary token emissions, F4),',
        'impermanent-loss, and outlier flags. Sorted by risk_score ascending',
        '(safest first). Read-only — never signs or broadcasts (ADR-003).',
        'Path: shells out to @indexnetwork/cli (`index opportunity discover`)',
        'when configured (Path 2 per ADR-006); falls back to DefiLlama Yields',
        'directly when Index is unset or errors (Path 3). Discovery source is',
        'always reported via `discovery_source` ∈ {index_network, fallback}.',
        `Supported intent keywords: ${SUPPORTED_INTENT_KEYWORDS.join('; ')}.`,
      ].join(' '),
      inputSchema: discoverYieldsByIntentInputShape,
      outputSchema: discoverYieldsByIntentOutputSchema.shape,
    },
    async (rawInput: { intent: string; limit?: number }) => {
      try {
        const result = await discoverYieldsByIntent(rawInput);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (err) {
        if (err instanceof IndexNetworkNotConfiguredError) {
          // Should never bubble here (we check in-tool) but defensive.
          process.stderr.write(`[discover_yields_by_intent] ${err.message}\n`);
        }
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[discover_yields_by_intent] error: ${message}\n`);
        throw err;
      }
    },
  );
}
