#!/usr/bin/env node
/**
 * defi-risk-mcp — MCP server entrypoint.
 *
 * Responsibility: wire serverInfo + tools + stdio transport, then connect.
 * Per architecture.md, this file stays under 80 lines — registration and
 * transport only. Real tool logic lives in `src/tools/*` and is added by
 * subsequent stories.
 *
 * stdout is reserved for MCP JSON-RPC frames. All diagnostics go to stderr,
 * never `console.log` (banned in architecture.md §Banned patterns).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerHealthCheckTool } from './tools/_placeholder.js';
import { registerDiscoverYieldsByIntentTool } from './tools/discoverYieldsByIntent.js';
import { registerExplainProtocolRiskTool } from './tools/explainProtocolRisk.js';
import { registerGetPositionRiskTool } from './tools/getPositionRisk.js';
import { registerGetRecentExploitsTool } from './tools/getRecentExploits.js';
import { registerSimulateTxRiskTool } from './tools/simulateTxRisk.js';
import { createStdioTransport } from './transport.js';

export const SERVER_NAME = 'defi-risk-mcp';
export const SERVER_VERSION = '0.1.0';

export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerHealthCheckTool(server);
  registerGetPositionRiskTool(server);
  registerSimulateTxRiskTool(server);
  registerExplainProtocolRiskTool(server);
  registerGetRecentExploitsTool(server);
  registerDiscoverYieldsByIntentTool(server);

  return server;
}

export async function main(): Promise<void> {
  const server = createServer();
  const transport = createStdioTransport();
  await server.connect(transport);
  process.stderr.write(`${SERVER_NAME} v${SERVER_VERSION} ready (stdio)\n`);
}

// Run only when invoked directly (not when imported by tests).
// `import.meta.url` resolves to the actual entry script even after the
// `#!/usr/bin/env node` bin shim re-execs this file.
const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`${SERVER_NAME} fatal: ${message}\n`);
    process.exit(1);
  });
}
