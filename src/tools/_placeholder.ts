/**
 * `health_check` placeholder tool.
 *
 * Purpose: smoke-test the scaffold. Confirms the MCP server can register a
 * tool, validate a (trivially empty) input schema, and return a structured
 * result. Real DeFi tools (get_position_risk, simulate_tx_risk, etc.) live
 * in their own files and are added in subsequent stories.
 *
 * This file is deliberately tiny — no upstream calls, no business logic,
 * no mock data. The first hot-path tool ships in `story-tool-get-position-risk`.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { healthCheckInputShape, healthCheckOutputSchema } from '../schemas/tools.js';

export const HEALTH_CHECK_TOOL_NAME = 'health_check';

export function registerHealthCheckTool(server: McpServer): void {
  server.registerTool(
    HEALTH_CHECK_TOOL_NAME,
    {
      title: 'Health check',
      description:
        'Returns {ok: true} if the MCP server is reachable. Used to verify Claude Desktop can spawn this server and list at least one tool.',
      inputSchema: healthCheckInputShape,
      outputSchema: healthCheckOutputSchema.shape,
    },
    () => {
      const result = { ok: true as const };
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );
}
