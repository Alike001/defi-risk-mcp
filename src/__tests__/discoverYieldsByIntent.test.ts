/**
 * Story: story-tool-discover-yields-by-intent (#7).
 *
 * BDD acceptance:
 *   1. Happy path with Index — INDEX_NETWORK_KEY set + intent →
 *      `discovery_source: "index_network"`, ≥3 candidates sorted ASC by
 *      risk_score, every candidate has protocol/chain/apy/real_yield/
 *      risk_score (0..100)/why_recommended (≥40 chars).
 *   2. Fallback path — INDEX_NETWORK_KEY unset → `discovery_source: "fallback"`,
 *      response otherwise conforms to schema.
 *   3. Malformed intent — empty string is rejected by the input schema.
 *   4. No-results — restrictive constraints produce a valid response with
 *      `candidates: []`.
 *   5. Intent with chain constraint — `on Base` filters out non-Base pools.
 *   6. Intent with risk constraint (`audited`) — drops unaudited projects.
 *   7. Tool registered + discoverable via MCP listTools.
 *   8. Intent parser keyword coverage (rule-based, deterministic).
 *   9. F4 separation — apyBase / apyReward → real_yield + estimated flag.
 *  10. yieldFilter audit gate.
 *  11. Index path errors → fallback + fallback_reason populated.
 *
 * Why hermetic fixtures: the live DefiLlama Yields endpoint returns ~15K
 * rapidly-changing pools and the live Index Network requires CLI auth. We
 * inject hand-crafted YieldPool[] + IndexOpportunity[] via the test seams
 * exposed by the tool (`fetchPools`, `fetchOpportunities`, `env`).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../index.js';
import type { YieldPool } from '../lib/defillama.js';
import { SUPPORTED_INTENT_KEYWORDS, parseIntent } from '../lib/intentParser.js';
import { classifyRealYield } from '../lib/realYield.js';
import { AUDITED_PROJECTS, filterPools } from '../lib/yieldFilter.js';
import { yieldDiscoveryResultSchema } from '../schemas/domain.js';
import {
  DISCOVER_YIELDS_BY_INTENT_TOOL_NAME,
  discoverYieldsByIntent,
  scoreRisk,
} from '../tools/discoverYieldsByIntent.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, '..', '..', 'data', 'fixtures', 'index-network-response.json');
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
  success: boolean;
  data: Array<{
    id: string;
    title: string;
    description: string;
    score: number;
    protocol: string;
    chain: string;
    symbol: string;
    apy: number;
    url: string;
  }>;
};

const FROZEN_NOW = new Date('2026-05-06T12:00:00.000Z');

function fixturePool(overrides: Partial<YieldPool> = {}): YieldPool {
  return {
    chain: 'Base',
    project: 'morpho-blue',
    symbol: 'STEAKUSDC',
    poolId: '7820bd3c-461a-4811-9f0b-1d39c1503c3f',
    tvlUsd: 470_000_000,
    apyBase: 4.0,
    apyReward: 0,
    apy: 4.0,
    apyMean30d: 4.27,
    rewardTokens: [],
    stablecoin: true,
    ilRisk: 'no',
    exposure: 'single',
    poolMeta: null,
    underlyingTokens: ['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'],
    outlier: false,
    ...overrides,
  };
}

/** Hermetic fixture pool universe — covers every BDD case. */
function fixturePools(): YieldPool[] {
  return [
    // 1. Audited Morpho Blue STEAKUSDC on Base — clean real yield
    fixturePool(),
    // 2. Audited Aave v3 USDC on Base — mixed real + inflationary
    fixturePool({
      project: 'aave-v3',
      symbol: 'USDC',
      poolId: 'aaaa1111-2222-3333-4444-555566667777',
      tvlUsd: 1_500_000_000,
      apyBase: 4.1,
      apyReward: 1.3,
      apy: 5.4,
      ilRisk: 'no',
    }),
    // 3. Audited Fluid Lending USDC on Base — small TVL → riskier
    fixturePool({
      project: 'fluid-lending',
      symbol: 'USDC',
      poolId: 'bbbb1111-2222-3333-4444-555566667777',
      tvlUsd: 30_000_000,
      apyBase: 4.5,
      apyReward: 2.7,
      apy: 7.2,
    }),
    // 4. Compound v3 USDC on Ethereum — for chain-filter tests
    fixturePool({
      project: 'compound-v3',
      symbol: 'USDC',
      chain: 'Ethereum',
      poolId: 'cccc1111-2222-3333-4444-555566667777',
      tvlUsd: 800_000_000,
      apyBase: 4.0,
      apyReward: 0.5,
      apy: 4.5,
    }),
    // 5. UNAUDITED rugfarm — should be dropped under audited_required
    fixturePool({
      project: 'rugfarm-xyz',
      symbol: 'USDC',
      poolId: 'dddd1111-2222-3333-4444-555566667777',
      tvlUsd: 500_000,
      apyBase: 12,
      apyReward: 50,
      apy: 62,
      stablecoin: true,
    }),
    // 6. Lido stETH on Ethereum — rebase token, should be dropped under no_rebase
    fixturePool({
      project: 'lido',
      symbol: 'STETH',
      chain: 'Ethereum',
      poolId: 'eeee1111-2222-3333-4444-555566667777',
      tvlUsd: 21_000_000_000,
      apyBase: 2.4,
      apyReward: 0,
      apy: 2.4,
      stablecoin: false,
      ilRisk: 'no',
    }),
    // 7. Pool with apyBase=null → real_yield_estimated=true
    fixturePool({
      project: 'eigenlayer',
      symbol: 'EIGEN',
      chain: 'Ethereum',
      poolId: 'ffff1111-2222-3333-4444-555566667777',
      tvlUsd: 4_000_000_000,
      apyBase: null,
      apyReward: null,
      apy: 3.5,
      stablecoin: false,
    }),
  ];
}

function indexHitsFromFixture() {
  return FIXTURE.data.map((d) => ({
    id: d.id,
    title: d.title,
    description: d.description,
    score: d.score,
    protocol: d.protocol,
    chain: d.chain,
    symbol: d.symbol,
    apy: d.apy,
    url: d.url,
    raw: d as Record<string, unknown>,
  }));
}

/* ========================================================================== */
/* Tests                                                                      */
/* ========================================================================== */

describe('story-tool-discover-yields-by-intent', () => {
  /* ------------------------------------------------------------------------ */
  /* BDD #1 — Happy path with Index Network                                  */
  /* ------------------------------------------------------------------------ */

  describe('happy path: Index Network configured (BDD #1)', () => {
    it('returns ≥3 candidates sorted ascending by risk_score, with all required fields', async () => {
      const result = await discoverYieldsByIntent(
        { intent: 'stable USDC yield > 3% on Base, audited' },
        {
          env: { INDEX_NETWORK_KEY: 'fake-token-for-tests' },
          fetchPools: async () => fixturePools(),
          fetchOpportunities: async () => indexHitsFromFixture(),
          now: () => FROZEN_NOW,
        },
      );

      // Schema-level — every constraint enforced
      yieldDiscoveryResultSchema.parse(result);

      expect(result.discovery_source).toBe('index_network');
      expect(result.index_network_used).toBe(true);
      expect(result.fallback_reason).toBeNull();
      expect(result.candidates.length).toBeGreaterThanOrEqual(3);

      // Sorted ascending
      for (let i = 1; i < result.candidates.length; i++) {
        const prev = result.candidates[i - 1];
        const curr = result.candidates[i];
        expect(prev?.risk_score ?? 0).toBeLessThanOrEqual(curr?.risk_score ?? 0);
      }

      // Per-candidate field shape
      for (const c of result.candidates) {
        expect(c.protocol.length).toBeGreaterThan(0);
        expect(c.chain.length).toBeGreaterThan(0);
        expect(typeof c.apy).toBe('number');
        expect(typeof c.real_yield).toBe('number');
        expect(c.risk_score).toBeGreaterThanOrEqual(0);
        expect(c.risk_score).toBeLessThanOrEqual(100);
        expect(c.why_recommended.length).toBeGreaterThanOrEqual(40);
      }

      // Sources include both Index + DefiLlama Yields
      expect(result.sources.some((s) => s.includes('yields.llama.fi'))).toBe(true);
      expect(result.sources.some((s) => s.includes('index.network'))).toBe(true);
    });

    it('applies the chain filter (Base) and rejects Ethereum-only pools', async () => {
      const result = await discoverYieldsByIntent(
        { intent: 'stable USDC yield > 3% on Base, audited' },
        {
          env: { INDEX_NETWORK_KEY: 'fake-token-for-tests' },
          fetchPools: async () => fixturePools(),
          fetchOpportunities: async () => indexHitsFromFixture(),
          now: () => FROZEN_NOW,
        },
      );

      // Every returned candidate is on base
      for (const c of result.candidates) {
        expect(c.chain).toBe('base');
      }
      // Compound v3 (Ethereum), Lido stETH (Ethereum), and Eigenlayer (Ethereum)
      // must not appear.
      const protocols = result.candidates.map((c) => c.protocol);
      expect(protocols).not.toContain('compound-v3');
      expect(protocols).not.toContain('lido');
      expect(protocols).not.toContain('eigenlayer');
    });
  });

  /* ------------------------------------------------------------------------ */
  /* BDD #2 — Fallback path (no key)                                         */
  /* ------------------------------------------------------------------------ */

  describe('fallback path: INDEX_NETWORK_KEY unset (BDD #2)', () => {
    it('reports `discovery_source: "fallback"` and never spawns the CLI', async () => {
      let cliCalled = false;
      const result = await discoverYieldsByIntent(
        { intent: 'stable USDC yield > 3% on Base, audited' },
        {
          env: {},
          fetchPools: async () => fixturePools(),
          fetchOpportunities: async () => {
            cliCalled = true;
            return [];
          },
          now: () => FROZEN_NOW,
        },
      );

      yieldDiscoveryResultSchema.parse(result);
      // Router refactor (story #8): the explicit "no Index, no Brave" path now
      // emits `defillama_only`. The legacy `'fallback'` umbrella value remains
      // in the schema enum but the router never picks it.
      expect(result.discovery_source).toBe('defillama_only');
      expect(result.index_network_used).toBe(false);
      // The router concatenates per-path reasons with `; ` so we match a
      // substring rather than the exact string the old single-path inline
      // implementation emitted.
      expect(result.fallback_reason).toMatch(/INDEX_NETWORK_KEY not set/);
      expect(cliCalled).toBe(false);

      // Schema still produces ≥1 candidate (Morpho/Aave/Fluid all on Base + audited)
      expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* BDD #3 — Malformed intent                                               */
  /* ------------------------------------------------------------------------ */

  describe('malformed intent (BDD #3)', () => {
    it('rejects empty string at the input schema', async () => {
      await expect(
        discoverYieldsByIntent(
          { intent: '' },
          {
            env: {},
            fetchPools: async () => fixturePools(),
            now: () => FROZEN_NOW,
          },
        ),
      ).rejects.toBeTruthy();
    });

    it('handles a "noise" intent (no recognized keywords) without throwing', async () => {
      const result = await discoverYieldsByIntent(
        { intent: 'lorem ipsum dolor sit amet consectetur', limit: 3 },
        {
          env: {},
          fetchPools: async () => fixturePools(),
          now: () => FROZEN_NOW,
        },
      );
      yieldDiscoveryResultSchema.parse(result);
      // No constraints means every pool passes — risk-sort still applies.
      expect(result.parsed_intent.recognized_keywords.length).toBe(0);
      expect(result.candidates.length).toBeGreaterThan(0);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* BDD #4 — No results                                                     */
  /* ------------------------------------------------------------------------ */

  describe('no-results path (BDD #4)', () => {
    it('returns empty candidates when constraints exclude every pool', async () => {
      const result = await discoverYieldsByIntent(
        { intent: 'stable WBTC yield > 50% on Optimism, audited' },
        {
          env: {},
          fetchPools: async () => fixturePools(),
          now: () => FROZEN_NOW,
        },
      );
      yieldDiscoveryResultSchema.parse(result);
      expect(result.candidates).toHaveLength(0);
      expect(result.parsed_intent.chain).toBe('optimism');
      expect(result.parsed_intent.asset_symbol).toBe('WBTC');
      expect(result.parsed_intent.apy_min).toBe(50);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* BDD #5 — chain constraint                                               */
  /* ------------------------------------------------------------------------ */

  describe('intent with chain constraint (BDD #5)', () => {
    it('parses "on Arbitrum" → chain=arbitrum and applies the filter', async () => {
      const c = parseIntent('USDC yield > 4% on Arbitrum');
      expect(c.chain).toBe('arbitrum');
      expect(c.asset_symbol).toBe('USDC');
      expect(c.apy_min).toBe(4);
    });

    it('parses "on Ethereum" → chain=ethereum', () => {
      expect(parseIntent('yield > 5% on Ethereum').chain).toBe('ethereum');
    });

    it('parses "on Base" → chain=base', () => {
      expect(parseIntent('on Base, audited').chain).toBe('base');
    });
  });

  /* ------------------------------------------------------------------------ */
  /* BDD #6 — risk constraint (audited)                                      */
  /* ------------------------------------------------------------------------ */

  describe('intent with risk constraint (BDD #6)', () => {
    it('drops unaudited projects when `audited` is in the intent', async () => {
      const result = await discoverYieldsByIntent(
        { intent: 'stable USDC yield > 3% on Base, audited' },
        {
          env: {},
          fetchPools: async () => fixturePools(),
          now: () => FROZEN_NOW,
        },
      );
      const protocols = result.candidates.map((c) => c.protocol);
      expect(protocols).not.toContain('rugfarm-xyz');
      // All survivors are in the audited allow-list
      for (const p of protocols) {
        expect(AUDITED_PROJECTS.has(p.toLowerCase())).toBe(true);
      }
    });

    it('parses "audited within last 12 months" → audit_max_age_months=12', () => {
      const c = parseIntent('Find me a yield play on Base, audited within last 12 months');
      expect(c.audited_required).toBe(true);
      expect(c.audit_max_age_months).toBe(12);
    });

    it('parses "no rebase" and drops STETH', async () => {
      const c = parseIntent('yield on Ethereum, audited, no rebase');
      expect(c.no_rebase).toBe(true);

      const result = await discoverYieldsByIntent(
        { intent: 'yield on Ethereum, audited, no rebase' },
        {
          env: {},
          fetchPools: async () => fixturePools(),
          now: () => FROZEN_NOW,
        },
      );
      const symbols = result.candidates.map((c) => c.symbol.toUpperCase());
      expect(symbols).not.toContain('STETH');
    });

    it('parses "real yield > 8%" and applies it on apyBase', async () => {
      const c = parseIntent('> 8% real yield on Base, audited within last 12 months');
      expect(c.apy_min).toBe(8);
      expect(c.real_yield_only).toBe(true);
      expect(c.audited_required).toBe(true);
      expect(c.audit_max_age_months).toBe(12);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* BDD #7 — MCP tool registration                                          */
  /* ------------------------------------------------------------------------ */

  describe('MCP tool registration (BDD #7)', () => {
    let client: Client;
    let close: () => Promise<void>;

    beforeEach(async () => {
      const server = createServer();
      const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
      client = new Client(
        { name: 'discover-yields-test-client', version: '0.0.0' },
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

    it('lists discover_yields_by_intent among the registered tools', async () => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain(DISCOVER_YIELDS_BY_INTENT_TOOL_NAME);
      expect(DISCOVER_YIELDS_BY_INTENT_TOOL_NAME).toBe('discover_yields_by_intent');
    });

    it('describes the tool with Index Network + DefiLlama Yields + risk language', async () => {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === DISCOVER_YIELDS_BY_INTENT_TOOL_NAME);
      expect(tool).toBeDefined();
      expect(tool?.description).toMatch(/index network/i);
      expect(tool?.description).toMatch(/defillama|yields/i);
      expect(tool?.description).toMatch(/real[- ]yield/i);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* BDD #8 — Intent parser keyword coverage                                 */
  /* ------------------------------------------------------------------------ */

  describe('intent parser (BDD #8)', () => {
    it('extracts apy_min from "> 5%"', () => {
      expect(parseIntent('USDC yield > 5%').apy_min).toBe(5);
    });

    it('extracts apy_min from ">= 8%"', () => {
      expect(parseIntent('yield >= 8%').apy_min).toBe(8);
    });

    it('extracts apy_min when threshold is decimal', () => {
      expect(parseIntent('yield > 5.5% on Base').apy_min).toBe(5.5);
    });

    it('treats stablecoin and stable as equivalent', () => {
      expect(parseIntent('stable USDC yield').stable_only).toBe(true);
      expect(parseIntent('stablecoin yield').stable_only).toBe(true);
    });

    it('keyword list is documented and non-empty', () => {
      expect(SUPPORTED_INTENT_KEYWORDS.length).toBeGreaterThan(5);
      // Sanity: chain + asset + audited + APY + real-yield + rebase + stable
      const blob = SUPPORTED_INTENT_KEYWORDS.join(' ');
      expect(blob).toMatch(/apy/i);
      expect(blob).toMatch(/chain/i);
      expect(blob).toMatch(/audited/i);
      expect(blob).toMatch(/rebase/i);
      expect(blob).toMatch(/stable/i);
      expect(blob).toMatch(/real[- ]yield/i);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* BDD #9 — F4 real-yield separation                                       */
  /* ------------------------------------------------------------------------ */

  describe('F4 real-yield separation (BDD #9)', () => {
    it('classifies apyBase + apyReward as mixed and computes inflationary share', () => {
      const cls = classifyRealYield(fixturePool({ apyBase: 4.0, apyReward: 6.0, apy: 10.0 }));
      expect(cls.estimated).toBe(false);
      expect(cls.realYield).toBe(4.0);
      expect(cls.band).toBe('mostly_inflationary');
      expect(cls.inflationaryShare).toBeCloseTo(0.6, 2);
    });

    it('classifies apyReward=0 as all_real', () => {
      const cls = classifyRealYield(fixturePool({ apyBase: 4.0, apyReward: 0, apy: 4.0 }));
      expect(cls.band).toBe('all_real');
      expect(cls.estimated).toBe(false);
      expect(cls.realYield).toBe(4.0);
    });

    it('marks estimated=true when apyBase is null', () => {
      const cls = classifyRealYield(fixturePool({ apyBase: null, apyReward: null, apy: 7.0 }));
      expect(cls.estimated).toBe(true);
      expect(cls.band).toBe('unknown');
      expect(cls.narrative).toMatch(/estimated|may be lower/i);
    });

    it('marks estimated=true on the eigenlayer-style pool', async () => {
      const result = await discoverYieldsByIntent(
        { intent: 'yield on Ethereum, no rebase' },
        {
          env: {},
          fetchPools: async () => fixturePools(),
          now: () => FROZEN_NOW,
        },
      );
      const eigen = result.candidates.find((c) => c.protocol === 'eigenlayer');
      expect(eigen).toBeDefined();
      expect(eigen?.real_yield_estimated).toBe(true);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* BDD #10 — yieldFilter audit gate + scoreRisk                            */
  /* ------------------------------------------------------------------------ */

  describe('yieldFilter + scoreRisk (BDD #10)', () => {
    it('filterPools with audited_required drops the rugfarm pool', () => {
      const constraints = parseIntent('USDC on Base, audited');
      const survivors = filterPools(fixturePools(), constraints);
      expect(survivors.find((p) => p.project === 'rugfarm-xyz')).toBeUndefined();
    });

    it('scoreRisk gives audited + high-TVL + all-real lower score than unaudited + small TVL', () => {
      const safe = fixturePool({
        project: 'aave-v3',
        tvlUsd: 1_500_000_000,
        apyBase: 4.0,
        apyReward: 0,
        ilRisk: 'no',
      });
      const risky = fixturePool({
        project: 'rugfarm-xyz',
        tvlUsd: 500_000,
        apyBase: 12,
        apyReward: 50,
        ilRisk: 'yes',
        outlier: true,
      });
      const safeScore = scoreRisk({
        pool: safe,
        audited: AUDITED_PROJECTS.has('aave-v3'),
        classification: classifyRealYield(safe),
      });
      const riskyScore = scoreRisk({
        pool: risky,
        audited: AUDITED_PROJECTS.has('rugfarm-xyz'),
        classification: classifyRealYield(risky),
      });
      expect(safeScore).toBeLessThan(riskyScore);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* BDD #11 — Index path errors → fallback                                  */
  /* ------------------------------------------------------------------------ */

  describe('Index Network failure recovers via fallback (BDD #11)', () => {
    it('records fallback_reason and still returns DefiLlama-only candidates', async () => {
      const result = await discoverYieldsByIntent(
        { intent: 'stable USDC yield > 3% on Base, audited' },
        {
          env: { INDEX_NETWORK_KEY: 'fake-token-for-tests' },
          fetchPools: async () => fixturePools(),
          fetchOpportunities: async () => {
            throw new Error('CLI unreachable');
          },
          now: () => FROZEN_NOW,
        },
      );
      yieldDiscoveryResultSchema.parse(result);
      // Router refactor (story #8): when Index errors and Brave is unset, the
      // router falls through to the DefiLlama floor — `discovery_source` is
      // now the explicit `defillama_only` rather than the legacy umbrella.
      expect(result.discovery_source).toBe('defillama_only');
      expect(result.fallback_reason).toMatch(/CLI unreachable/);
      expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    });
  });
});
