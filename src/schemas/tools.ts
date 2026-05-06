/**
 * Zod schemas for every MCP tool exposed by defi-risk-mcp.
 *
 * Why a single file: the MCP SDK's `registerTool` consumes the raw zod shape
 * (a `ZodRawShape`, not a wrapped `z.object(...)`), so we keep one canonical
 * place where input shapes + result types are declared. Subsequent stories
 * (simulate_tx_risk, ...) append their schemas here.
 *
 * The placeholder `health_check` tool exists only so the scaffold story has
 * something to register and so a smoke test can verify tool discovery.
 */

import { z } from 'zod';
import {
  SUPPORTED_CHAINS,
  exploitFeedSchema,
  protocolNotFoundErrorSchema,
  protocolRiskProfileSchema,
  riskScoreSchema,
  txRiskReportSchema,
} from './domain.js';

/**
 * `health_check` takes no input. Exposing it as an empty raw shape (rather
 * than `undefined`) keeps the SDK's typed `registerTool` call straightforward
 * across every tool we add later.
 */
export const healthCheckInputShape = {} as const;

export const healthCheckOutputSchema = z.object({
  ok: z.literal(true),
});

export type HealthCheckOutput = z.infer<typeof healthCheckOutputSchema>;

/* ------------------------------------------------------------------------- */
/* get_position_risk                                                          */
/* ------------------------------------------------------------------------- */

/**
 * Input shape consumed by the MCP SDK's `registerTool` (raw shape, not a
 * `z.object(...)`). Chain is constrained to the three networks the tool
 * actually supports — DefiLlama + Alchemy free tier covers all three.
 */
export const getPositionRiskInputShape = {
  chain: z.enum(SUPPORTED_CHAINS).describe('Target chain. One of ethereum, base, arbitrum.'),
  protocol: z
    .string()
    .min(1)
    .describe('Protocol slug as used by DefiLlama, e.g. "aave-v3", "compound-v3", "uniswap-v3".'),
  position_id: z
    .string()
    .min(1)
    .describe(
      'Protocol-specific position identifier. Aave uses "<asset>-supply" / "<asset>-borrow"; Uniswap LP uses an NFT tokenId; etc.',
    ),
} as const;

/**
 * The output schema is the canonical RiskScore. Re-exporting under a tool-
 * scoped name keeps `index.ts` registration calls symmetric across tools.
 */
export const getPositionRiskOutputSchema = riskScoreSchema;

export type GetPositionRiskOutput = z.infer<typeof getPositionRiskOutputSchema>;

/* ------------------------------------------------------------------------- */
/* simulate_tx_risk                                                           */
/* ------------------------------------------------------------------------- */

/**
 * Input shape for `simulate_tx_risk`. Chain matches the same three networks
 * the rest of the surface supports. `unsigned_tx_hex` accepts a serialized
 * transaction (legacy or EIP-1559). Per ADR-003 we never sign or broadcast.
 */
export const simulateTxRiskInputShape = {
  chain: z.enum(SUPPORTED_CHAINS).describe('Target chain. One of ethereum, base, arbitrum.'),
  unsigned_tx_hex: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/, 'must be 0x-prefixed hex')
    .min(20)
    .describe(
      'Serialized transaction hex (legacy or EIP-1559). May be unsigned. The MCP server NEVER signs or broadcasts — simulation only (ADR-003).',
    ),
} as const;

export const simulateTxRiskInputSchema = z.object(simulateTxRiskInputShape);

export type SimulateTxRiskInput = z.infer<typeof simulateTxRiskInputSchema>;

/** Output is the canonical TxRiskReport shape from `domain.ts`. */
export const simulateTxRiskOutputSchema = txRiskReportSchema;

export type SimulateTxRiskOutput = z.infer<typeof simulateTxRiskOutputSchema>;

/* ------------------------------------------------------------------------- */
/* explain_protocol_risk                                                      */
/* ------------------------------------------------------------------------- */

/**
 * Input shape for `explain_protocol_risk`. Single string arg — the protocol
 * slug as it appears in DefiLlama / our local audit cache. Lower-cased.
 */
export const explainProtocolRiskInputShape = {
  protocol_name: z
    .string()
    .min(1)
    .describe(
      'Protocol slug as used by DefiLlama, e.g. "aave-v3", "morpho", "pendle". Lower-cased.',
    ),
} as const;

export const explainProtocolRiskInputSchema = z.object(explainProtocolRiskInputShape);

export type ExplainProtocolRiskInput = z.infer<typeof explainProtocolRiskInputSchema>;

/**
 * Output schema declared to MCP is the success shape — the `protocol_not_found`
 * error variant is surfaced via the SDK's `isError: true` response (analogous
 * to how `simulate_tx_risk` handles missing-credentials), and the structured
 * error payload is parsed against `protocolNotFoundErrorSchema` separately so
 * its three-suggestion contract is still enforced.
 */
export const explainProtocolRiskOutputSchema = protocolRiskProfileSchema;

/** Re-export the not-found error schema so the tool layer + tests share one source. */
export const explainProtocolRiskErrorSchema = protocolNotFoundErrorSchema;

export type ExplainProtocolRiskOutput = z.infer<typeof explainProtocolRiskOutputSchema>;

/* ------------------------------------------------------------------------- */
/* get_recent_exploits                                                        */
/* ------------------------------------------------------------------------- */

/**
 * Input shape for `get_recent_exploits`. Two args:
 *   - `time_window_days` (1..365) — how far back to look. Default 30 in the
 *     wrapper; the schema enforces a hard ceiling so a runaway LLM call cannot
 *     turn the tool into an unbounded scrape.
 *   - `chain` (optional) — case-insensitive chain name. The tool maps common
 *     aliases (eth/ethereum, arb/arbitrum, op/optimism, polygon/matic,
 *     bsc/bnb, base) before filtering.
 *
 * Note: this is intentionally NOT constrained to `SUPPORTED_CHAINS` from
 * `domain.ts`. Exploit feeds cover chains beyond our position/simulation
 * surface (Fantom, Avalanche, Solana, etc.) and the chain filter is a
 * read-only narrowing — accepting a free-form string lets users filter
 * by any chain Rekt mentions without a domain-schema bump.
 */
export const getRecentExploitsInputShape = {
  time_window_days: z
    .number()
    .int()
    .min(1)
    .max(365)
    .describe(
      'Days to look back from now (1..365). Defaults to 30 if omitted by the caller wrapper.',
    ),
  chain: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional case-insensitive chain filter. Accepts canonical names (ethereum, arbitrum, base, optimism, polygon, bsc, avalanche, fantom, solana) and common aliases (eth, arb, op, matic, bnb).',
    ),
} as const;

export const getRecentExploitsInputSchema = z.object(getRecentExploitsInputShape);

export type GetRecentExploitsInput = z.infer<typeof getRecentExploitsInputSchema>;

/** Output is the canonical ExploitFeed shape from `domain.ts`. */
export const getRecentExploitsOutputSchema = exploitFeedSchema;

export type GetRecentExploitsOutput = z.infer<typeof getRecentExploitsOutputSchema>;
