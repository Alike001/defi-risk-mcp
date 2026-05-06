/**
 * `get_position_risk` — synthesize risk for a known DeFi position across
 * audit, oracle, exploit, composability, MEV, and slippage dimensions.
 *
 * Per architecture.md ADR-003, this tool is read-only — it never signs or
 * broadcasts transactions. It pulls grounded signals from:
 *   - DefiLlama protocol metadata + TVL  (no key)
 *   - Locally cached audit summaries     (Code4rena / Spearbit / etc.)
 *   - viem read-only RPC for liveness    (optional)
 *
 * Synthesis is deterministic in v0 (story file: "LLM-based summary polish"
 * is explicitly out of scope). All scoring lives in `lib/synthesis.ts`.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type AuditSummary, getAuditSummary, isKnownProtocol } from '../lib/code4rena.js';
import {
  DefiLlamaUnknownProtocolError,
  type ProtocolMetadata,
  fetchProtocolMetadata,
} from '../lib/defillama.js';
import { synthesizeRiskScore } from '../lib/synthesis.js';
import {
  type Position,
  type RiskScore,
  SUPPORTED_CHAINS,
  type SupportedChain,
  positionSchema,
  riskScoreSchema,
} from '../schemas/domain.js';
import { getPositionRiskInputShape, getPositionRiskOutputSchema } from '../schemas/tools.js';

export const GET_POSITION_RISK_TOOL_NAME = 'get_position_risk';

/**
 * Programmatic entry point. Used by:
 *  - the MCP `registerTool` handler, and
 *  - tests, which call this directly without spinning up the full server.
 *
 * Validates inputs, fetches grounded signals, and returns a parsed RiskScore.
 * Errors surface as thrown `Error` instances — never swallowed (architecture.md
 * banned patterns).
 */
export async function getPositionRisk(input: unknown): Promise<RiskScore> {
  const position = positionSchema.parse(input);
  return computeRisk(position);
}

interface ComputeOptions {
  /** Test seam — inject a custom DefiLlama fetcher. */
  fetchMetadata?: (slug: string) => Promise<ProtocolMetadata | null>;
  /** Test seam — inject a custom audit-cache lookup. */
  loadAuditSummary?: (slug: string) => AuditSummary | null;
}

/**
 * Internal implementation. Exposed (without `export`) for the registration
 * helper; tests should call `getPositionRisk` instead.
 */
async function computeRisk(position: Position, options: ComputeOptions = {}): Promise<RiskScore> {
  const fetchMetadata = options.fetchMetadata ?? defaultFetchMetadata;
  const loadAuditSummary = options.loadAuditSummary ?? getAuditSummary;

  // Run upstream lookups in parallel — DefiLlama is the slow leg.
  const [metadata, auditSummary] = await Promise.all([
    fetchMetadata(position.protocol),
    Promise.resolve(loadAuditSummary(position.protocol)),
  ]);

  // If neither source returned anything, the protocol is unknown to us. We
  // still synthesize a result (the BDD criteria require a valid RiskScore in
  // every case), but the audit + exploit dimensions will reflect the
  // no-data state and the summary will say so.
  if (!metadata && !auditSummary) {
    process.stderr.write(
      `[get_position_risk] no DefiLlama or local audit data for "${position.protocol}"\n`,
    );
  }

  const result = synthesizeRiskScore({
    position,
    metadata,
    auditSummary,
  });

  // Validate the output against the same schema we expose to MCP clients.
  // If synthesis ever drifts (e.g. a future dev removes a dimension), this
  // throws *here* rather than emitting an invalid MCP frame.
  return riskScoreSchema.parse(result);
}

/**
 * Default DefiLlama fetcher. Translates "unknown protocol" 404s into `null`
 * so the synthesis layer can fall through gracefully — but rethrows on any
 * other upstream failure so the caller surfaces the network error.
 */
async function defaultFetchMetadata(slug: string): Promise<ProtocolMetadata | null> {
  try {
    return await fetchProtocolMetadata(slug);
  } catch (err) {
    if (err instanceof DefiLlamaUnknownProtocolError) {
      // Unknown to DefiLlama, but maybe in our local audit cache.
      return null;
    }
    throw err;
  }
}

/**
 * MCP tool registration. Mirrors the pattern in `_placeholder.ts`.
 */
export function registerGetPositionRiskTool(server: McpServer): void {
  server.registerTool(
    GET_POSITION_RISK_TOOL_NAME,
    {
      title: 'Get position risk',
      description: [
        'Synthesize risk for a known DeFi position across six dimensions:',
        'audit, oracle, exploit, composability, MEV, slippage.',
        'Returns a RiskScore with per-dimension score (0–100, higher = more risk),',
        'a plain-English reasoning string for each, a top-level summary, and at',
        'least two source URLs. Read-only; never signs transactions.',
        `Supported chains: ${SUPPORTED_CHAINS.join(', ')}.`,
      ].join(' '),
      inputSchema: getPositionRiskInputShape,
      outputSchema: getPositionRiskOutputSchema.shape,
    },
    async (rawInput: { chain: SupportedChain; protocol: string; position_id: string }) => {
      try {
        const result = await getPositionRisk(rawInput);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[get_position_risk] error: ${message}\n`);
        // Re-throw as a structured tool error rather than silently returning
        // a fake RiskScore — MCP SDK turns this into an isError response.
        throw err;
      }
    },
  );
}

/** Re-export the helper used by tests for the no-cache fallback path. */
export { isKnownProtocol };
