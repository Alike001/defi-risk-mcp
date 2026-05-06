/**
 * Domain-level Zod schemas + types shared across tools.
 *
 * These are the canonical shapes a synthesizer produces and a tool returns.
 * Keeping them in one place lets tool-specific input/output schemas in
 * `tools.ts` reuse the same building blocks (`RiskScore`, `RiskDimension`,
 * `Position`) so every tool that synthesizes risk speaks the same language.
 *
 * Per architecture.md banned patterns, no `any` is allowed — these schemas
 * also serve as the runtime parse layer for upstream API responses.
 */

import { z } from 'zod';

/**
 * The six dimensions are fixed. The tool's BDD acceptance criteria require
 * the response to contain *exactly* these six keys, so we model them as a
 * tuple-like literal union and assert the dimensions object covers all six.
 */
export const RISK_DIMENSION_NAMES = [
  'audit',
  'oracle',
  'exploit',
  'composability',
  'mev',
  'slippage',
] as const;

export type RiskDimensionName = (typeof RISK_DIMENSION_NAMES)[number];

/**
 * A single risk dimension result. Score is 0–100 (higher = more risk).
 * Reasoning is required to be ≥30 chars per BDD; we enforce that here so
 * the synthesis layer cannot accidentally ship empty stub strings.
 */
export const riskDimensionSchema = z.object({
  score: z.number().min(0).max(100),
  reasoning: z.string().min(30),
});

export type RiskDimension = z.infer<typeof riskDimensionSchema>;

/**
 * The full RiskScore returned by `get_position_risk`. Note the explicit
 * shape on `dimensions` — using `z.record` would let the model omit a
 * dimension and pass validation, which would break the BDD criterion
 * "exactly 6 risk dimensions".
 */
export const riskScoreSchema = z.object({
  summary: z.string().min(50),
  dimensions: z.object({
    audit: riskDimensionSchema,
    oracle: riskDimensionSchema,
    exploit: riskDimensionSchema,
    composability: riskDimensionSchema,
    mev: riskDimensionSchema,
    slippage: riskDimensionSchema,
  }),
  sources: z.array(z.string().url()).min(2),
});

export type RiskScore = z.infer<typeof riskScoreSchema>;

/**
 * A position is the (chain, protocol, position_id) triple the tool accepts.
 * `position_id` is intentionally a free-form string today — formats vary
 * across protocols (Aave uses `<asset>-supply` / `<asset>-borrow`, Uniswap
 * uses LP NFT tokenIds). Validation of the *value* lives in the tool when
 * we look up the position metadata.
 */
export const SUPPORTED_CHAINS = ['ethereum', 'base', 'arbitrum'] as const;
export type SupportedChain = (typeof SUPPORTED_CHAINS)[number];

export const positionSchema = z.object({
  chain: z.enum(SUPPORTED_CHAINS),
  protocol: z.string().min(1),
  position_id: z.string().min(1),
});

export type Position = z.infer<typeof positionSchema>;

/* ------------------------------------------------------------------------- */
/* TxRiskReport — output of `simulate_tx_risk`                                */
/* ------------------------------------------------------------------------- */

/**
 * Three-band MEV verdict. v0 heuristic — see `simulateTxRisk.ts` and the
 * tool description for the exact rules. Subsequent stories may refine.
 */
export const MEV_RISK_BANDS = ['low', 'medium', 'high'] as const;
export type MevRiskBand = (typeof MEV_RISK_BANDS)[number];

/**
 * Counterparty = the contract the tx targets (`tx.to`). For known protocols
 * we set `name` to the canonical DefiLlama label and `audited` from the
 * curated audit cache; for unknown contracts we set `name` to the address
 * and `audited` to `false` (do not fabricate a yes-answer for unknowns).
 */
export const counterpartySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'address must be 0x-prefixed 20-byte hex'),
  name: z.string().min(1),
  audited: z.boolean(),
  category: z.string().nullable(),
});

export type Counterparty = z.infer<typeof counterpartySchema>;

/**
 * Lightweight portfolio delta hint for the sender (when known). For v0 we
 * never infer wallets, so this is always `null` for unsigned tx hex (which
 * has no recoverable from-address) — but the field is reserved so future
 * stories that accept signed-tx hex or a `from` arg can populate it.
 */
export const portfolioAfterSchema = z
  .object({
    address: z.string(),
    /** Free-form deltas, e.g. `{ USDC: -10_000, WETH: +2.7 }`. */
    deltas: z.record(z.string(), z.number()),
  })
  .nullable();

export type PortfolioAfter = z.infer<typeof portfolioAfterSchema>;

/**
 * Full `TxRiskReport` — the structured output of `simulate_tx_risk`.
 *
 * Required fields (per BDD):
 *   - mev_risk + mev_reasoning
 *   - slippage_pct (>= 0)
 *   - counterparty (name, audited)
 *   - oracle_deps (array — may be empty for AMM swaps)
 *   - portfolio_after (nullable when wallet unknown)
 *   - recommendations (array of strings)
 *
 * Plus a top-level `summary` so the LLM has a single-paragraph TL;DR and a
 * `decoded` field carrying the parsed call-data so callers can render the
 * "what does this tx actually do" UI without re-decoding themselves.
 */
export const decodedCallSchema = z.object({
  function_name: z.string(),
  // args are heterogeneous (addresses, bigints, tuples). We stringify before
  // serializing — Zod cannot model the open viem type union without `any`.
  args: z.array(z.string()),
  selector: z.string().regex(/^0x[a-fA-F0-9]{8}$/),
});

export type DecodedCall = z.infer<typeof decodedCallSchema>;

export const txRiskReportSchema = z.object({
  summary: z.string().min(40),
  chain: z.enum(SUPPORTED_CHAINS),
  counterparty: counterpartySchema,
  decoded: decodedCallSchema.nullable(),
  mev_risk: z.enum(MEV_RISK_BANDS),
  mev_reasoning: z.string().min(20),
  slippage_pct: z.number().min(0),
  oracle_deps: z.array(z.string()),
  portfolio_after: portfolioAfterSchema,
  recommendations: z.array(z.string().min(3)).min(1),
  sources: z.array(z.string().url()).min(1),
});

export type TxRiskReport = z.infer<typeof txRiskReportSchema>;

/* ------------------------------------------------------------------------- */
/* ProtocolRiskProfile — output of `explain_protocol_risk`                    */
/* ------------------------------------------------------------------------- */

/**
 * One audit entry. We capture firm + date + url so the MCP client can render
 * a timeline. Date is an ISO-8601 string ("2024-04-15") or "YYYY-MM" / "YYYY"
 * for cases where the public report only specifies the month or year.
 *
 * URL is required by BDD ("firm + date + url"). When the source markdown
 * lists a firm without a URL we fall back to the protocol-level source URL
 * from `code4rena.ts` so the field always parses.
 */
export const auditEntrySchema = z.object({
  firm: z.string().min(1),
  date: z.string().min(4), // "2024", "2024-06", or "2024-06-15"
  url: z.string().url(),
  scope: z.string().nullable(),
});

export type AuditEntry = z.infer<typeof auditEntrySchema>;

/**
 * One historical exploit / disclosure. `amount_usd` is a best-effort estimate;
 * `null` when the loss is non-monetary (e.g. an approval-phishing incident).
 * `affected_protocol` is set when the exploit hit a *downstream* aggregator
 * rather than the protocol's own contracts (we annotate explicitly so the LLM
 * does not falsely attribute Penpie-style aggregator bugs to Pendle, etc.).
 */
export const exploitEntrySchema = z.object({
  date: z.string().min(4),
  description: z.string().min(10),
  amount_usd: z.number().min(0).nullable(),
  source_url: z.string().url().nullable(),
  affected_protocol: z.string().nullable(),
});

export type ExploitEntry = z.infer<typeof exploitEntrySchema>;

/**
 * One recent governance proposal from Snapshot. `status` is whatever Snapshot
 * returns (typically: "active", "closed", "pending"). We pass it through
 * lower-cased so downstream rendering can branch deterministically.
 */
export const governanceProposalSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.string().min(1),
  url: z.string().url(),
  created: z.number().int().nonnegative(),
});

export type GovernanceProposal = z.infer<typeof governanceProposalSchema>;

/**
 * Composability tree. `depends_on` is the set of upstream protocols this
 * protocol relies on (oracles, lower-level lending markets, restaking primitives).
 * `downstream_users` is the set of protocols that wrap or compose this one
 * (LRTs, yield aggregators, leveraged-LP wrappers).
 *
 * `depth` is a coarse hop-count for the local map (1 = direct integrations
 * curated manually; higher values reserved for future graph walks).
 */
export const composabilityTreeSchema = z.object({
  protocol: z.string().min(1),
  depth: z.number().int().nonnegative(),
  depends_on: z.array(z.string()),
  downstream_users: z.array(z.string()),
  notes: z.string().nullable(),
});

export type ComposabilityTree = z.infer<typeof composabilityTreeSchema>;

/**
 * Full ProtocolRiskProfile — the structured output of `explain_protocol_risk`.
 *
 * Required fields (per BDD acceptance):
 *   - audits           : array of {firm, date, url} — at least one entry
 *   - exploit_history  : array (may be empty if no exploits)
 *   - oracle_deps      : array of oracle providers in use
 *   - composability_tree
 *   - recent_governance : last 5 Snapshot proposals
 *
 * Plus a top-level `summary` for the LLM TL;DR and a `sources` array for
 * citation symmetry with the other tools. We keep `summary` ≥ 50 chars to
 * match the convention in `riskScoreSchema`.
 */
export const protocolRiskProfileSchema = z.object({
  protocol: z.string().min(1),
  summary: z.string().min(50),
  audits: z.array(auditEntrySchema).min(1),
  exploit_history: z.array(exploitEntrySchema),
  oracle_deps: z.array(z.string()),
  composability_tree: composabilityTreeSchema,
  recent_governance: z.array(governanceProposalSchema).max(5),
  sources: z.array(z.string().url()).min(1),
});

export type ProtocolRiskProfile = z.infer<typeof protocolRiskProfileSchema>;

/**
 * Structured "protocol not found" error shape. Returned in-band from the tool
 * (rather than thrown) so MCP clients can render the suggestions UI cleanly.
 */
export const protocolNotFoundErrorSchema = z.object({
  status: z.literal('error'),
  code: z.literal('protocol_not_found'),
  message: z.string().min(1),
  /** Three closest known protocols, Levenshtein-ranked. */
  suggestions: z.array(z.string().min(1)).length(3),
});

export type ProtocolNotFoundError = z.infer<typeof protocolNotFoundErrorSchema>;

/* ------------------------------------------------------------------------- */
/* ExploitFeed — output of `get_recent_exploits`                              */
/* ------------------------------------------------------------------------- */

/**
 * A single exploit record. Per the BDD acceptance criteria each entry must
 * have a non-empty `protocol` slug, a numeric `amount_usd`, a `source_url`,
 * a ≥30-char `summary`, and an ISO-8601 `date`. Optional `chains` carries
 * the EVM chain slugs the exploit affected (lower-cased) — used by the chain
 * filter. `source` records which feed the entry came from so the deduper
 * and downstream UIs can render attribution.
 */
export const EXPLOIT_FEED_SOURCES = ['rekt', 'blocksec'] as const;
export type ExploitFeedSource = (typeof EXPLOIT_FEED_SOURCES)[number];

export const exploitSchema = z.object({
  /** ISO-8601 date in UTC ("YYYY-MM-DD" or full ISO 8601 timestamp). */
  date: z
    .string()
    .min(10)
    .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'date must parse via Date.parse' }),
  /** Best-effort protocol slug (lower-cased, hyphenated when multi-word). */
  protocol: z.string().min(1),
  /**
   * USD loss estimate. `0` is permitted when the post is qualitative
   * (governance attack, exit scam without a clean number) — this is
   * preferable to fabricating a number.
   */
  amount_usd: z.number().min(0),
  source_url: z.string().url(),
  summary: z.string().min(30),
  /**
   * EVM chain slugs (lower-cased) the exploit affected. May be empty when
   * no chain is mentioned in the source post — the filter treats empty as
   * "unknown" rather than a positive signal. Multi-chain exploits keep all
   * slugs.
   */
  chains: z.array(z.string().min(1)),
  source: z.enum(EXPLOIT_FEED_SOURCES),
});

export type Exploit = z.infer<typeof exploitSchema>;

/**
 * Full ExploitFeed — output of `get_recent_exploits`. The tool returns this
 * shape for both the empty (no exploits) and populated cases. `time_window_days`
 * and `chain_filter` are echoed so the LLM client can render "showing exploits
 * in the last N days [on chain X]". `sources_used` lists the upstream feeds
 * that contributed any entry — used for citation symmetry with the rest of
 * the tool surface and for honest documentation when one source is offline.
 */
export const exploitFeedSchema = z.object({
  exploits: z.array(exploitSchema),
  time_window_days: z.number().int().positive(),
  chain_filter: z.string().nullable(),
  sources_used: z.array(z.enum(EXPLOIT_FEED_SOURCES)),
  /** When the response was generated. ISO-8601 UTC. */
  generated_at: z.string().datetime(),
});

export type ExploitFeed = z.infer<typeof exploitFeedSchema>;

/* ------------------------------------------------------------------------- */
/* IntentConstraints / YieldCandidate / YieldDiscoveryResult                  */
/* (output of `discover_yields_by_intent`)                                    */
/* ------------------------------------------------------------------------- */

/**
 * Discovery source for a yield search. Records which path served the candidate
 * set (judge-fit signal — see story file + ADR-006 for path priority).
 *
 *   - `index_network`: Index CLI returned matched opportunities; we then
 *     enriched/scored them against DefiLlama Yields (Path 2 per ADR-006).
 *   - `brave`: Index unavailable; the Brave Search REST API surfaced
 *     yield-candidate URLs which we then resolved via DefiLlama Yields. Marked
 *     candidates carry `data_source: "brave_inferred"` so callers know the
 *     selection signal is heuristic (Path 2.5 — optional, only when
 *     `BRAVE_SEARCH_API_KEY` is set).
 *   - `defillama_only`: both upstreams unavailable / unset; we ran the
 *     DefiLlama Yields path directly as the absolute floor (Path 3, always
 *     works — no key required).
 *   - `fallback`: legacy umbrella value preserved for backward compatibility
 *     with the original story-tool-discover-yields-by-intent (#7) tests. The
 *     router never emits this — only the three explicit values above.
 */
export const YIELD_DISCOVERY_SOURCES = [
  'index_network',
  'brave',
  'defillama_only',
  'fallback',
] as const;
export type YieldDiscoverySource = (typeof YIELD_DISCOVERY_SOURCES)[number];

/**
 * Per-candidate provenance flag. Most candidates come straight from DefiLlama
 * Yields (`defillama`). When the Brave Search path is the path selector, we
 * mark the surviving candidates `brave_inferred` so the MCP client can render
 * "this protocol surfaced via web search heuristic — risk metrics still come
 * from DefiLlama".
 */
export const YIELD_CANDIDATE_DATA_SOURCES = ['defillama', 'brave_inferred'] as const;
export type YieldCandidateDataSource = (typeof YIELD_CANDIDATE_DATA_SOURCES)[number];

/**
 * Structured constraints extracted by the rule-based intent parser. Every
 * field is optional — the parser produces what it can and the filter applies
 * each constraint conjunctively. Keeping the shape Zod-validated lets us
 * round-trip the parsed intent in the response so callers can audit the
 * parser's interpretation.
 *
 * Supported keywords (mirror `intentParser.ts` — keep in sync):
 *   - APY: `apy > N%`, `apy >= N%`, `> N%`, `>= N%`, `> N` (interpreted as %)
 *   - chain: `on Base`, `on Arbitrum`, `on Ethereum`
 *   - asset: `USDC`, `USDT`, `DAI`, `ETH`, `WETH`, `WBTC`, `STETH`
 *   - audited: `audited`
 *   - audit window: `audited within last N months`
 *   - rebase: `no rebase`, `non-rebasing`
 *   - stable: `stable`, `stablecoin`
 *   - real yield: `real yield`, `no emissions`, `no inflationary`
 */
export const intentConstraintsSchema = z.object({
  apy_min: z.number().nullable(),
  chain: z.string().nullable(),
  asset_symbol: z.string().nullable(),
  audited_required: z.boolean(),
  audit_max_age_months: z.number().int().nullable(),
  no_rebase: z.boolean(),
  stable_only: z.boolean(),
  real_yield_only: z.boolean(),
  /** Free-form keywords the parser recognized (for transparency). */
  recognized_keywords: z.array(z.string()),
});

export type IntentConstraints = z.infer<typeof intentConstraintsSchema>;

/**
 * One yield candidate. `apy` is the headline number (DefiLlama's `apy` field —
 * apyBase + apyReward when both are present). `real_yield` strips out
 * inflationary token emissions per the F4 atom — when DefiLlama exposes
 * `apyBase` we use it; when only `apy` is present we set `real_yield_estimated`
 * so callers know the value is best-effort.
 *
 * `risk_score` is 0–100 with safer = lower. Sort ascending = safest first
 * (BDD requirement). `why_recommended` is a >=40-char human-readable rationale.
 */
export const yieldCandidateSchema = z.object({
  protocol: z.string().min(1),
  chain: z.string().min(1),
  symbol: z.string().min(1),
  apy: z.number(),
  real_yield: z.number(),
  real_yield_estimated: z.boolean(),
  risk_score: z.number().min(0).max(100),
  tvl_usd: z.number().min(0),
  is_stablecoin: z.boolean(),
  /** DefiLlama's IL-risk verdict, when present. */
  il_risk: z.string().nullable(),
  /** DefiLlama pool UUID for traceability. */
  pool_id: z.string().nullable(),
  audited: z.boolean(),
  why_recommended: z.string().min(40),
  /**
   * Provenance of the candidate selection signal. `defillama` is the default —
   * the candidate was selected directly from DefiLlama Yields (with optional
   * Index Network biasing). `brave_inferred` means the Brave Search path
   * surfaced this protocol via heuristic URL extraction; risk metrics still
   * come from DefiLlama, but the LLM should disclose the heuristic origin to
   * the user. Optional for back-compat with the #7 candidate shape — defaults
   * to `defillama` on the wire.
   */
  data_source: z.enum(YIELD_CANDIDATE_DATA_SOURCES).optional(),
});

export type YieldCandidate = z.infer<typeof yieldCandidateSchema>;

/**
 * Full `discover_yields_by_intent` output.
 *
 * `discovery_source` records which path served the candidate set — see the
 * `YIELD_DISCOVERY_SOURCES` doc above for the full enum (index_network /
 * brave / defillama_only, plus the legacy `fallback` umbrella retained for
 * back-compat with story #7's existing tests).
 *
 * `parsed_intent` echoes the structured constraints so the MCP client can
 * render "we interpreted your intent as: APY >= 5%, chain Base, audited".
 *
 * `index_network_used` is true if the live Index call was actually issued —
 * even when discovery_source falls back, this lets us record (in tests) that
 * an attempted CLI invocation took place.
 */
export const yieldDiscoveryResultSchema = z.object({
  discovery_source: z.enum(YIELD_DISCOVERY_SOURCES),
  index_network_used: z.boolean(),
  fallback_reason: z.string().nullable(),
  parsed_intent: intentConstraintsSchema,
  candidates: z.array(yieldCandidateSchema),
  sources: z.array(z.string().url()).min(1),
  generated_at: z.string().datetime(),
});

export type YieldDiscoveryResult = z.infer<typeof yieldDiscoveryResultSchema>;
