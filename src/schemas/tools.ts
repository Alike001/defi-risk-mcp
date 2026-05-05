/**
 * Zod schemas for every MCP tool exposed by defi-risk-mcp.
 *
 * Why a single file: the MCP SDK's `registerTool` consumes the raw zod shape
 * (a `ZodRawShape`, not a wrapped `z.object(...)`), so we keep one canonical
 * place where input shapes + result types are declared. Subsequent stories
 * (get_position_risk, simulate_tx_risk, ...) append their schemas here.
 *
 * The placeholder `health_check` tool exists only so the scaffold story has
 * something to register and so a smoke test can verify tool discovery.
 */

import { z } from 'zod';

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
