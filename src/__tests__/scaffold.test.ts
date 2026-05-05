import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SERVER_NAME, SERVER_VERSION, createServer } from '../index.js';
import { HEALTH_CHECK_TOOL_NAME } from '../tools/_placeholder.js';

/**
 * Scaffold-level tests for story-scaffold-mcp-server.
 *
 * These exercise the public MCP surface end-to-end via the SDK's in-memory
 * transport pair, so we cover the same code paths Claude Desktop will hit
 * over stdio without needing a child process.
 */
describe('story-scaffold-mcp-server', () => {
  let client: Client;
  let close: () => Promise<void>;

  beforeEach(async () => {
    const server = createServer();
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: 'scaffold-test-client', version: '0.0.0' }, { capabilities: {} });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    close = async () => {
      await client.close();
      await server.close();
    };
  });

  afterEach(async () => {
    await close();
  });

  it('declares serverInfo.name === "defi-risk-mcp" on initialize', () => {
    const info = client.getServerVersion();
    expect(info).toBeDefined();
    expect(info?.name).toBe(SERVER_NAME);
    expect(info?.name).toBe('defi-risk-mcp');
    expect(info?.version).toBe(SERVER_VERSION);
  });

  it('registers at least one tool and exposes health_check by name', async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(1);
    const names = tools.map((t) => t.name);
    expect(names).toContain(HEALTH_CHECK_TOOL_NAME);
    expect(HEALTH_CHECK_TOOL_NAME).toBe('health_check');
  });

  it('returns {ok: true} when health_check is invoked', async () => {
    const result = await client.callTool({ name: HEALTH_CHECK_TOOL_NAME, arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ ok: true });
  });
});
