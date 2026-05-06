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
