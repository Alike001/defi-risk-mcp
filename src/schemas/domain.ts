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
