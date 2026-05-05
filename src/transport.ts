/**
 * stdio transport factory.
 *
 * Claude Desktop spawns this MCP server as a child process and communicates
 * over stdin/stdout using newline-delimited JSON-RPC. The SDK ships a ready
 * `StdioServerTransport` for exactly that — wrapping it in a tiny factory
 * keeps `index.ts` declarative and lets tests substitute a mock transport
 * without monkey-patching globals.
 *
 * No HTTP transport in v0 (see ADR-002 in architecture.md).
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export function createStdioTransport(): Transport {
  return new StdioServerTransport();
}
