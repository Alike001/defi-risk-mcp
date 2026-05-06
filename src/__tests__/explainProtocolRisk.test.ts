import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../index.js';
import { getAuditHistory, isKnownProtocol } from '../lib/code4rena.js';
import {
  CURATED_COMPOSABILITY_SLUGS,
  inferComposabilityFromCategory,
  loadCuratedComposability,
} from '../lib/composability.js';
import { SnapshotApiError, fetchRecentProposals, spaceForProtocol } from '../lib/governance.js';
import { protocolNotFoundErrorSchema, protocolRiskProfileSchema } from '../schemas/domain.js';
import {
  EXPLAIN_PROTOCOL_RISK_TOOL_NAME,
  explainProtocolRisk,
  levenshtein,
  nearestKnownProtocols,
} from '../tools/explainProtocolRisk.js';

/**
 * Story: story-tool-explain-protocol-risk (#4).
 *
 * BDD acceptance:
 *   1. Happy path (aave-v3) — valid ProtocolRiskProfile with all required fields
 *   2. audits[] non-empty (firm + date + url per entry)
 *   3. exploit_history[] present (may be empty for clean protocols)
 *   4. oracle_deps[] present
 *   5. composability_tree object present (depth, depends_on, downstream_users)
 *   6. recent_governance[] capped at 5 (id, title, status)
 *   7. Unknown protocol → structured "protocol_not_found" error
 *   8. Suggestions array length === 3, Levenshtein-ranked
 *   9. Tool registered + discoverable via MCP listTools
 *  10. Snapshot client returns [] for protocols without a Snapshot space
 */

/** A stub Snapshot fetcher that returns 5 deterministic proposals. */
function fakeSnapshotFetcher() {
  return async () => [
    {
      id: 'prop-1',
      title: 'Adjust LTV for stETH',
      status: 'closed',
      url: 'https://snapshot.org/#/aave.eth/proposal/prop-1',
      created: 1_700_000_000,
    },
    {
      id: 'prop-2',
      title: 'Add wstETH e-mode',
      status: 'active',
      url: 'https://snapshot.org/#/aave.eth/proposal/prop-2',
      created: 1_700_100_000,
    },
    {
      id: 'prop-3',
      title: 'Cap GHO mint',
      status: 'closed',
      url: 'https://snapshot.org/#/aave.eth/proposal/prop-3',
      created: 1_700_200_000,
    },
    {
      id: 'prop-4',
      title: 'Treasury report',
      status: 'closed',
      url: 'https://snapshot.org/#/aave.eth/proposal/prop-4',
      created: 1_700_300_000,
    },
    {
      id: 'prop-5',
      title: 'Listing review',
      status: 'closed',
      url: 'https://snapshot.org/#/aave.eth/proposal/prop-5',
      created: 1_700_400_000,
    },
  ];
}

/** A stub DefiLlama fetcher returning a representative shape. */
function fakeMetadataFetcher() {
  return async (slug: string) => ({
    name: slug,
    chains: ['ethereum', 'base'],
    tvlUsd: 12_000_000_000,
    category: 'Lending',
    url: 'https://aave.com/',
    auditTier: '3',
    auditNote: null,
    auditLinks: ['https://blog.openzeppelin.com/aave-v3-audit'],
    description: 'aave v3 lending market',
  });
}

describe('story-tool-explain-protocol-risk', () => {
  describe('happy path: aave-v3 (BDD #1–#6)', () => {
    it('returns a valid ProtocolRiskProfile with audits, exploit_history, oracle_deps, composability_tree, recent_governance', async () => {
      const result = await explainProtocolRisk(
        { protocol_name: 'aave-v3' },
        {
          fetchMetadata: fakeMetadataFetcher(),
          fetchProposals: fakeSnapshotFetcher(),
        },
      );

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return; // narrow

      // Schema enforces every constraint; calling parse a second time guards
      // against future drift in any helper.
      protocolRiskProfileSchema.parse(result.profile);

      // BDD #1 — protocol echoed back
      expect(result.profile.protocol).toBe('aave-v3');

      // BDD #2 — audits ≥ 1, every entry has firm + date + url
      expect(result.profile.audits.length).toBeGreaterThanOrEqual(1);
      for (const a of result.profile.audits) {
        expect(a.firm.length).toBeGreaterThan(0);
        expect(a.date.length).toBeGreaterThanOrEqual(4);
        expect(() => new URL(a.url)).not.toThrow();
      }

      // BDD #3 — exploit_history is an array (may be empty)
      expect(Array.isArray(result.profile.exploit_history)).toBe(true);

      // BDD #4 — oracle_deps array of providers (Aave uses Chainlink)
      expect(Array.isArray(result.profile.oracle_deps)).toBe(true);
      expect(result.profile.oracle_deps).toContain('chainlink');

      // BDD #5 — composability_tree object with the documented shape
      expect(result.profile.composability_tree.protocol).toBe('aave-v3');
      expect(Array.isArray(result.profile.composability_tree.depends_on)).toBe(true);
      expect(Array.isArray(result.profile.composability_tree.downstream_users)).toBe(true);
      expect(result.profile.composability_tree.depends_on).toContain('chainlink-price-feeds');
      expect(result.profile.composability_tree.downstream_users.length).toBeGreaterThan(0);

      // BDD #6 — recent_governance capped at 5; entries shaped (id, title, status)
      expect(result.profile.recent_governance.length).toBeLessThanOrEqual(5);
      for (const g of result.profile.recent_governance) {
        expect(g.id.length).toBeGreaterThan(0);
        expect(g.title.length).toBeGreaterThan(0);
        expect(g.status.length).toBeGreaterThan(0);
        expect(() => new URL(g.url)).not.toThrow();
      }
      expect(result.profile.recent_governance.length).toBe(5);

      // Summary + sources sanity
      expect(result.profile.summary.length).toBeGreaterThanOrEqual(50);
      expect(result.profile.sources.length).toBeGreaterThanOrEqual(1);
    });

    it('parses real Aave v3 audit-cache markdown into ≥ 4 audit entries', () => {
      const history = getAuditHistory('aave-v3');
      expect(history).not.toBeNull();
      expect(history?.audits.length).toBeGreaterThanOrEqual(4);
      // Trail of Bits + OpenZeppelin should be detected
      const firms = (history?.audits ?? []).map((a) => a.firm);
      expect(firms).toContain('OpenZeppelin');
      expect(firms).toContain('Trail of Bits');
      expect(firms).toContain('Code4rena');
    });
  });

  describe('exploit-history extraction', () => {
    it('extracts the Curve July 2023 ~$73M Vyper reentrancy exploit', () => {
      const history = getAuditHistory('curve');
      expect(history).not.toBeNull();
      expect(history?.exploits.length).toBeGreaterThan(0);
      const c = (history?.exploits ?? []).find((e) =>
        e.description.toLowerCase().includes('vyper'),
      );
      expect(c).toBeDefined();
      expect(c?.amountUsd).toBe(73_000_000);
    });

    it('returns an empty exploit array for clean protocols (eigenlayer)', () => {
      const history = getAuditHistory('eigenlayer');
      expect(history).not.toBeNull();
      expect(history?.exploits).toEqual([]);
    });
  });

  describe('unknown-protocol path (BDD #7, #8)', () => {
    it('returns structured protocol_not_found with 3 Levenshtein-ranked suggestions', async () => {
      const result = await explainProtocolRisk(
        { protocol_name: 'fakeprotocolxyz' },
        {
          fetchMetadata: fakeMetadataFetcher(),
          fetchProposals: fakeSnapshotFetcher(),
        },
      );
      expect(result.status).toBe('error');
      if (result.status !== 'error') return;
      expect(result.code).toBe('protocol_not_found');
      expect(result.message.toLowerCase()).toContain('fakeprotocolxyz');
      expect(result.suggestions).toHaveLength(3);
      // Schema enforces length-3 constraint
      protocolNotFoundErrorSchema.parse({
        status: 'error',
        code: result.code,
        message: result.message,
        suggestions: result.suggestions,
      });
    });

    it('a near-miss like "aav-v3" suggests aave-v3 in the top-1 slot', async () => {
      const result = await explainProtocolRisk(
        { protocol_name: 'aav-v3' },
        {
          fetchMetadata: fakeMetadataFetcher(),
          fetchProposals: fakeSnapshotFetcher(),
        },
      );
      expect(result.status).toBe('error');
      if (result.status !== 'error') return;
      expect(result.suggestions[0]).toBe('aave-v3');
    });

    it('isKnownProtocol returns true for curated slug, false for fictional', () => {
      expect(isKnownProtocol('aave-v3')).toBe(true);
      expect(isKnownProtocol('fakeprotocolxyz')).toBe(false);
    });
  });

  describe('Levenshtein helper', () => {
    it('returns 0 for identical strings', () => {
      expect(levenshtein('aave-v3', 'aave-v3')).toBe(0);
    });

    it('returns 1 for a single substitution', () => {
      expect(levenshtein('aave', 'aaze')).toBe(1);
    });

    it('returns the longer length when one input is empty', () => {
      expect(levenshtein('', 'morpho')).toBe(6);
      expect(levenshtein('morpho', '')).toBe(6);
    });

    it('nearestKnownProtocols returns deterministic top-3 for empty input', () => {
      const a = nearestKnownProtocols('', 3);
      const b = nearestKnownProtocols('', 3);
      expect(a).toEqual(b);
      expect(a).toHaveLength(3);
    });
  });

  describe('composability layer', () => {
    it('loads curated maps for all 6 top protocols', () => {
      for (const slug of CURATED_COMPOSABILITY_SLUGS) {
        const map = loadCuratedComposability(slug);
        expect(map).not.toBeNull();
        expect(map?.protocol).toBe(slug);
        expect(Array.isArray(map?.dependsOn)).toBe(true);
        expect(Array.isArray(map?.downstreamUsers)).toBe(true);
      }
    });

    it('falls back to category-inferred map when a slug is not curated', () => {
      const lending = inferComposabilityFromCategory('some-new-lending', 'Lending');
      expect(lending.dependsOn).toContain('chainlink-price-feeds');
      const dex = inferComposabilityFromCategory('some-new-dex', 'Dexes');
      expect(dex.downstreamUsers.length).toBeGreaterThan(0);
    });

    it('returns null for non-curated slugs from loadCuratedComposability', () => {
      expect(loadCuratedComposability('sushiswap')).toBeNull();
    });
  });

  describe('Snapshot governance client (BDD #10)', () => {
    it('spaceForProtocol returns the canonical space for known slugs', () => {
      // Verified live against https://hub.snapshot.org/graphql at spec time —
      // the Aave DAO uses `aavedao.eth`, NOT `aave.eth` (which 404s).
      expect(spaceForProtocol('aave-v3')).toBe('aavedao.eth');
      expect(spaceForProtocol('lido')).toBe('lido-snapshot.eth');
      expect(spaceForProtocol('eigenlayer')).toBeNull(); // not on Snapshot
    });

    it('fetchRecentProposals returns [] for protocols without a Snapshot space', async () => {
      const fakeFetch = vi.fn(
        async () => new Response('{}', { status: 200 }),
      ) as unknown as typeof fetch;
      const out = await fetchRecentProposals('eigenlayer', 5, { fetchImpl: fakeFetch });
      expect(out).toEqual([]);
      expect(fakeFetch).not.toHaveBeenCalled();
    });

    it('fetchRecentProposals parses a happy GraphQL response', async () => {
      const fakeFetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                proposals: [
                  {
                    id: '0xabc',
                    title: 'Increase reserve factor',
                    state: 'closed',
                    created: 1_700_000_000,
                    link: 'https://snapshot.org/#/aave.eth/proposal/0xabc',
                    space: { id: 'aave.eth' },
                  },
                ],
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ) as unknown as typeof fetch;
      const proposals = await fetchRecentProposals('aave-v3', 5, { fetchImpl: fakeFetch });
      expect(proposals).toHaveLength(1);
      expect(proposals[0]?.id).toBe('0xabc');
      expect(proposals[0]?.status).toBe('closed');
      expect(proposals[0]?.title).toBe('Increase reserve factor');
    });

    it('fetchRecentProposals throws SnapshotApiError on HTTP 5xx', async () => {
      const fakeFetch = vi.fn(
        async () =>
          new Response('upstream error', { status: 503, statusText: 'Service Unavailable' }),
      ) as unknown as typeof fetch;
      await expect(
        fetchRecentProposals('aave-v3', 5, { fetchImpl: fakeFetch }),
      ).rejects.toBeInstanceOf(SnapshotApiError);
    });
  });

  describe('best-effort governance fetch (Snapshot failure does not crash tool)', () => {
    it('still returns a profile with empty recent_governance when snapshot returns []', async () => {
      const result = await explainProtocolRisk(
        { protocol_name: 'aave-v3' },
        {
          fetchMetadata: fakeMetadataFetcher(),
          // Empty array is the "Snapshot worked but no proposals" case AND
          // also the post-fallback case when the upstream HTTP call fails
          // (the default fetcher swallows + logs to stderr). Either way the
          // BDD response shape must remain valid.
          fetchProposals: async () => [],
        },
      );
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.profile.recent_governance).toEqual([]);
      // Schema still passes — recent_governance is array(...).max(5) so empty is valid.
      protocolRiskProfileSchema.parse(result.profile);
    });
  });

  describe('MCP tool registration (BDD #9)', () => {
    let client: Client;
    let close: () => Promise<void>;

    beforeEach(async () => {
      const server = createServer();
      const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
      client = new Client(
        { name: 'explain-protocol-risk-test-client', version: '0.0.0' },
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

    it('lists explain_protocol_risk among the registered tools', async () => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain(EXPLAIN_PROTOCOL_RISK_TOOL_NAME);
      expect(EXPLAIN_PROTOCOL_RISK_TOOL_NAME).toBe('explain_protocol_risk');
    });

    it('describes the tool with audits + governance + composability', async () => {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === EXPLAIN_PROTOCOL_RISK_TOOL_NAME);
      expect(tool).toBeDefined();
      expect(tool?.description).toMatch(/audit/i);
      expect(tool?.description).toMatch(/governance|snapshot/i);
      expect(tool?.description).toMatch(/composability/i);
    });
  });
});
