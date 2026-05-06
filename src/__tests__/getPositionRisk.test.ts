import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../index.js';
import { getAuditSummary, isKnownProtocol } from '../lib/code4rena.js';
import { fetchProtocolMetadata } from '../lib/defillama.js';
import { synthesizeRiskScore } from '../lib/synthesis.js';
import { RISK_DIMENSION_NAMES } from '../schemas/domain.js';
import { GET_POSITION_RISK_TOOL_NAME, getPositionRisk } from '../tools/getPositionRisk.js';

/**
 * Story: story-tool-get-position-risk (#2).
 *
 * BDD acceptance:
 *   1. Happy path returns valid JSON conforming to RiskScore schema
 *   2. Exactly 6 risk dimensions
 *   3. Each dimension has score (0–100) + reasoning ≥ 30 chars
 *   4. Top-level summary ≥ 50 chars
 *   5. sources array ≥ 2 URLs
 *   6. Unknown protocol fallback
 *   7. Unknown chain rejected
 *   8. Malformed inputs rejected
 *   9. No-data fallback still produces a valid score
 *  10. All source URLs are valid URLs
 *  11. Tool is registered + discoverable via MCP listTools
 */

describe('story-tool-get-position-risk', () => {
  describe('happy path: aave-v3 USDC supply on Base (BDD #1)', () => {
    it('returns a valid RiskScore with 6 dimensions, summary ≥ 50, sources ≥ 2', async () => {
      // Use the pure synthesis layer with a representative DefiLlama-shaped
      // payload so this test runs offline and is fast/deterministic.
      const auditSummary = getAuditSummary('aave-v3');
      expect(auditSummary).not.toBeNull();
      const score = synthesizeRiskScore({
        position: { chain: 'base', protocol: 'aave-v3', position_id: 'USDC-supply' },
        metadata: {
          name: 'Aave V3',
          chains: ['ethereum', 'base', 'arbitrum'],
          tvlUsd: 12_000_000_000,
          category: 'Lending',
          url: 'https://aave.com/',
          auditTier: '3',
          auditNote: null,
          auditLinks: ['https://blog.openzeppelin.com/aave-v3-audit'],
          description: 'Aave v3 lending market',
        },
        auditSummary,
      });

      // BDD #2 — exactly 6 named dimensions
      expect(Object.keys(score.dimensions)).toHaveLength(6);
      for (const name of RISK_DIMENSION_NAMES) {
        expect(score.dimensions).toHaveProperty(name);
      }

      // BDD #3 — every dimension has score 0–100 + reasoning ≥ 30 chars
      for (const name of RISK_DIMENSION_NAMES) {
        const d = score.dimensions[name];
        expect(d.score).toBeGreaterThanOrEqual(0);
        expect(d.score).toBeLessThanOrEqual(100);
        expect(d.reasoning.length).toBeGreaterThanOrEqual(30);
      }

      // BDD #4 — summary ≥ 50 chars
      expect(score.summary.length).toBeGreaterThanOrEqual(50);

      // BDD #5 — sources ≥ 2 URLs
      expect(score.sources.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('schema enforcement (BDD #6, #7, #8)', () => {
    it('rejects an unknown chain via Zod (BDD #7)', async () => {
      await expect(
        getPositionRisk({ chain: 'solana', protocol: 'aave-v3', position_id: 'USDC-supply' }),
      ).rejects.toThrow();
    });

    it('rejects malformed input — missing protocol (BDD #8)', async () => {
      await expect(
        getPositionRisk({ chain: 'base', position_id: 'USDC-supply' }),
      ).rejects.toThrow();
    });

    it('rejects malformed input — empty position_id (BDD #8)', async () => {
      await expect(
        getPositionRisk({ chain: 'base', protocol: 'aave-v3', position_id: '' }),
      ).rejects.toThrow();
    });

    it('rejects non-object input entirely (BDD #8)', async () => {
      await expect(getPositionRisk(null)).rejects.toThrow();
      await expect(getPositionRisk('not-an-object')).rejects.toThrow();
    });
  });

  describe('unknown-protocol + no-data fallback (BDD #6, #9)', () => {
    it('still produces a valid RiskScore when DefiLlama and audit cache both miss', () => {
      const score = synthesizeRiskScore({
        position: {
          chain: 'ethereum',
          protocol: 'totally-fictional-protocol-xyz',
          position_id: 'TKN-supply',
        },
        metadata: null,
        auditSummary: null,
      });
      // Schema validation is the canonical gate
      expect(Object.keys(score.dimensions)).toHaveLength(6);
      expect(score.sources.length).toBeGreaterThanOrEqual(2);
      expect(score.summary.length).toBeGreaterThanOrEqual(50);
      // Audit dimension should reflect the no-data state
      expect(score.dimensions.audit.score).toBeGreaterThanOrEqual(60);
      expect(score.dimensions.audit.reasoning.toLowerCase()).toMatch(/no|unknown|tier/);
    });

    it('reports an unknown protocol via isKnownProtocol()', () => {
      expect(isKnownProtocol('aave-v3')).toBe(true);
      expect(isKnownProtocol('totally-fictional-protocol-xyz')).toBe(false);
    });
  });

  describe('source-url validity (BDD #10)', () => {
    it('every source URL parses as a valid URL', () => {
      const score = synthesizeRiskScore({
        position: { chain: 'base', protocol: 'aave-v3', position_id: 'USDC-supply' },
        metadata: {
          name: 'Aave V3',
          chains: ['base'],
          tvlUsd: 1_000_000_000,
          category: 'Lending',
          url: 'https://aave.com/',
          auditTier: '3',
          auditNote: null,
          auditLinks: [],
          description: null,
        },
        auditSummary: getAuditSummary('aave-v3'),
      });
      for (const src of score.sources) {
        expect(() => new URL(src)).not.toThrow();
      }
    });
  });

  describe('MCP tool registration (BDD #11)', () => {
    let client: Client;
    let close: () => Promise<void>;

    beforeEach(async () => {
      const server = createServer();
      const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
      client = new Client(
        { name: 'get-position-risk-test-client', version: '0.0.0' },
        { capabilities: {} },
      );
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      close = async () => {
        await client.close();
        await server.close();
      };
    });

    afterEach(async () => {
      await close();
    });

    it('lists get_position_risk among the registered tools', async () => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain(GET_POSITION_RISK_TOOL_NAME);
      expect(GET_POSITION_RISK_TOOL_NAME).toBe('get_position_risk');
    });

    it('describes the tool with chains + dimensions in the description', async () => {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === GET_POSITION_RISK_TOOL_NAME);
      expect(tool).toBeDefined();
      expect(tool?.description).toMatch(/audit/i);
      expect(tool?.description).toMatch(/oracle/i);
      expect(tool?.description).toMatch(/base/i);
    });
  });

  describe('upstream client wiring', () => {
    it('DefiLlama client throws DefiLlamaUnknownProtocolError on 404', async () => {
      const fakeFetch = vi.fn(
        async () => new Response('Not found', { status: 404, statusText: 'Not Found' }),
      ) as unknown as typeof fetch;
      await expect(
        fetchProtocolMetadata('absolutely-not-a-real-protocol', { fetchImpl: fakeFetch }),
      ).rejects.toMatchObject({ slug: 'absolutely-not-a-real-protocol' });
      expect(fakeFetch).toHaveBeenCalledTimes(1);
    });

    it('DefiLlama client parses + normalizes a minimal happy response', async () => {
      const fakeFetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              name: 'Aave V3',
              chains: ['Ethereum', 'Base'],
              tvl: 12_345_678_901,
              category: 'Lending',
              url: 'https://aave.com/',
              audits: '3',
              audit_links: ['https://blog.openzeppelin.com/aave-v3-audit'],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ) as unknown as typeof fetch;
      const md = await fetchProtocolMetadata('aave-v3', { fetchImpl: fakeFetch });
      expect(md.name).toBe('Aave V3');
      expect(md.chains).toEqual(['ethereum', 'base']);
      expect(md.tvlUsd).toBe(12_345_678_901);
      expect(md.auditTier).toBe('3');
      expect(md.url).toBe('https://aave.com/');
    });
  });
});
