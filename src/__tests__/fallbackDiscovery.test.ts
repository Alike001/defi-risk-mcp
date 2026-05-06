/**
 * Story: story-fallback-discovery (#8).
 *
 * BDD acceptance criteria (from the story file):
 *   1. Index Network errors → fallback path runs, response is valid, ≥3
 *      candidates (when fixture pools support it).
 *   2. INDEX_NETWORK_KEY unset, BRAVE_SEARCH_API_KEY set → Brave fallback
 *      runs without error and produces a valid response (`discovery_source:
 *      "brave"`).
 *   3. Both INDEX_NETWORK_KEY and BRAVE_SEARCH_API_KEY unset → DefiLlama
 *      Yields direct as the floor (`discovery_source: "defillama_only"`).
 *   4. ≥4 vitest cases covering: index-fail-fallback-success,
 *      no-keys-defillama-floor, network-timeout, all-paths-fail-graceful-error.
 *
 * Why these tests live alongside the existing #7 suite (which still tests the
 * full tool surface): #7 verified the inline orchestration. #8 verifies the
 * explicit router behavior — path selection, per-path timeout, structured
 * `all_paths_failed` error. The two suites overlap by design (defense in
 * depth) but assert different invariants.
 *
 * Hermetic: every test injects fakes via the tool's existing test seams
 * (`fetchPools`, `fetchOpportunities`, `env`, `now`) plus router-level seams
 * for Brave (we exercise `discover()` from `lib/discovery/router.js` directly).
 */

import { describe, expect, it } from 'vitest';
import type { YieldPool } from '../lib/defillama.js';
import { runBravePath } from '../lib/discovery/bravePath.js';
import { runDefiLlamaFloor } from '../lib/discovery/defillamaFloor.js';
import { AllPathsFailedError, discover as routerDiscover } from '../lib/discovery/router.js';
import { parseIntent } from '../lib/intentParser.js';
import { yieldDiscoveryResultSchema } from '../schemas/domain.js';
import { discoverYieldsByIntent } from '../tools/discoverYieldsByIntent.js';

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

function fixturePools(): YieldPool[] {
  return [
    fixturePool(),
    fixturePool({
      project: 'aave-v3',
      symbol: 'USDC',
      poolId: 'aaaa1111-2222-3333-4444-555566667777',
      tvlUsd: 1_500_000_000,
      apyBase: 4.1,
      apyReward: 1.3,
      apy: 5.4,
    }),
    fixturePool({
      project: 'fluid-lending',
      symbol: 'USDC',
      poolId: 'bbbb1111-2222-3333-4444-555566667777',
      tvlUsd: 30_000_000,
      apyBase: 4.5,
      apyReward: 2.7,
      apy: 7.2,
    }),
    fixturePool({
      project: 'compound-v3',
      symbol: 'USDC',
      poolId: 'cccc1111-2222-3333-4444-555566667777',
      tvlUsd: 800_000_000,
      apyBase: 4.0,
      apyReward: 0.5,
      apy: 4.5,
    }),
  ];
}

/* ========================================================================== */
/* BDD case 1 — index fails, router falls through to DefiLlama floor          */
/* ========================================================================== */

describe('story-fallback-discovery: index path errors → fallback succeeds', () => {
  it('records the precise reason and still returns ≥3 candidates from the floor', async () => {
    const result = await discoverYieldsByIntent(
      { intent: 'stable USDC yield > 3% on Base, audited' },
      {
        env: { INDEX_NETWORK_KEY: 'fake-token-for-tests' },
        fetchPools: async () => fixturePools(),
        fetchOpportunities: async () => {
          throw new Error('rate-limited 429');
        },
        now: () => FROZEN_NOW,
      },
    );

    yieldDiscoveryResultSchema.parse(result);
    // BRAVE_SEARCH_API_KEY is also unset here so the router lands on the floor.
    expect(result.discovery_source).toBe('defillama_only');
    expect(result.fallback_reason).toMatch(/rate-limited 429/);
    expect(result.candidates.length).toBeGreaterThanOrEqual(3);
    // Every candidate has the `defillama` provenance flag.
    for (const c of result.candidates) {
      expect(c.data_source).toBe('defillama');
    }
  });

  it('still falls through cleanly when the Index path throws an unexpected non-Error', async () => {
    const result = await discoverYieldsByIntent(
      { intent: 'USDC yield > 3% on Base, audited' },
      {
        env: { INDEX_NETWORK_KEY: 'fake' },
        fetchPools: async () => fixturePools(),
        fetchOpportunities: async () => {
          // biome-ignore lint/suspicious/noExplicitAny: deliberately exotic throw shape
          throw 'string-throw' as any;
        },
        now: () => FROZEN_NOW,
      },
    );
    expect(result.discovery_source).toBe('defillama_only');
    expect(result.fallback_reason).toMatch(/string-throw/);
  });
});

/* ========================================================================== */
/* BDD case 2 — both keys unset → DefiLlama floor (the absolute floor)        */
/* ========================================================================== */

describe('story-fallback-discovery: no keys → DefiLlama Yields floor', () => {
  it('reports `discovery_source: "defillama_only"` and never invokes Index or Brave', async () => {
    let indexCalled = false;
    const result = await discoverYieldsByIntent(
      { intent: 'stable USDC yield > 3% on Base, audited' },
      {
        env: {},
        fetchPools: async () => fixturePools(),
        fetchOpportunities: async () => {
          indexCalled = true;
          return [];
        },
        now: () => FROZEN_NOW,
      },
    );

    yieldDiscoveryResultSchema.parse(result);
    expect(result.discovery_source).toBe('defillama_only');
    expect(result.index_network_used).toBe(false);
    expect(result.fallback_reason).toMatch(/INDEX_NETWORK_KEY not set/);
    expect(result.fallback_reason).toMatch(/BRAVE_SEARCH_API_KEY not set/);
    expect(indexCalled).toBe(false);
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    expect(result.sources.some((s) => s.includes('yields.llama.fi'))).toBe(true);
  });
});

/* ========================================================================== */
/* BDD case 3 — Brave path runs when only BRAVE_SEARCH_API_KEY is set         */
/* ========================================================================== */

describe('story-fallback-discovery: Index unset, Brave set → Brave path', () => {
  it('returns `discovery_source: "brave"` and tags candidates `brave_inferred`', async () => {
    const constraints = parseIntent('stable USDC yield > 3% on Base, audited');

    // Stub the Brave path (we never hit the network in tests). Returns the
    // canonical DefiLlama project slugs the URL extractor would have produced.
    const fakeBrave = async () => ['morpho-blue', 'aave-v3'];

    // Stub the floor with our hermetic pool universe.
    const fakeFloor = async (
      opts: Parameters<typeof runDefiLlamaFloor>[0],
    ): ReturnType<typeof runDefiLlamaFloor> => {
      // Reuse the real floor with injected fetchPools — exercises the actual
      // scoring + filter logic.
      return runDefiLlamaFloor({ ...opts, fetchPools: async () => fixturePools() });
    };

    const result = await routerDiscover({
      intent: 'stable USDC yield > 3% on Base, audited',
      constraints,
      limit: 5,
      now: FROZEN_NOW,
      env: { BRAVE_SEARCH_API_KEY: 'brave-fake-key' },
      runBravePathImpl: fakeBrave,
      runDefiLlamaFloorImpl: fakeFloor,
    });

    yieldDiscoveryResultSchema.parse(result);
    expect(result.discovery_source).toBe('brave');
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    for (const c of result.candidates) {
      expect(c.data_source).toBe('brave_inferred');
    }
    expect(result.sources.some((s) => s.includes('search.brave.com'))).toBe(true);
  });

  it('parses real Brave search responses → DefiLlama project slugs', async () => {
    // Verify the URL extractor against canned Brave-shaped JSON.
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          web: {
            results: [
              { url: 'https://app.morpho.org/base/vault/123/steakusdc' },
              { url: 'https://aave.com/markets/base' },
              { url: 'https://defillama.com/protocol/pendle' },
              { url: 'https://random-blog.dev/article' },
              { url: 'not-a-url' },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );

    const slugs = await runBravePath('USDC yield', {
      env: { BRAVE_SEARCH_API_KEY: 'k' },
      fetchImpl: fakeFetch,
    });

    // Order is set-insertion order; assert membership.
    expect(slugs).toContain('morpho-blue');
    expect(slugs).toContain('aave-v3');
    expect(slugs).toContain('pendle');
    // random-blog.dev and the malformed URL must be dropped — we never invent.
    expect(slugs).not.toContain('random-blog');
    expect(slugs.length).toBe(3);
  });
});

/* ========================================================================== */
/* BDD case 4 — network timeout doesn't pin the tool                          */
/* ========================================================================== */

describe('story-fallback-discovery: per-path timeout', () => {
  it('honors the router-level timeout and falls through when a path hangs', async () => {
    const constraints = parseIntent('USDC yield on Base, audited');

    // Path 1 hangs forever — timeout MUST fire and let the router try the
    // next path.
    const hangingIndex = (() => Promise.race([])) as () => Promise<never>;

    const fakeFloor = async (
      opts: Parameters<typeof runDefiLlamaFloor>[0],
    ): ReturnType<typeof runDefiLlamaFloor> =>
      runDefiLlamaFloor({ ...opts, fetchPools: async () => fixturePools() });

    const result = await routerDiscover({
      intent: 'USDC yield on Base, audited',
      constraints,
      limit: 5,
      now: FROZEN_NOW,
      env: { INDEX_NETWORK_KEY: 'set' },
      timeoutMs: 50,
      runIndexPathImpl: hangingIndex,
      runDefiLlamaFloorImpl: fakeFloor,
    });

    yieldDiscoveryResultSchema.parse(result);
    expect(result.discovery_source).toBe('defillama_only');
    expect(result.fallback_reason).toMatch(/timed out|timeout|IndexPathTimeoutError/i);
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
  });
});

/* ========================================================================== */
/* BDD case 5 — all paths fail → graceful structured error                    */
/* ========================================================================== */

describe('story-fallback-discovery: all paths fail → graceful error', () => {
  it('throws AllPathsFailedError carrying every per-path reason', async () => {
    const constraints = parseIntent('USDC yield on Base, audited');

    const exploding = async () => {
      throw new Error('upstream down');
    };

    await expect(
      routerDiscover({
        intent: 'USDC yield on Base, audited',
        constraints,
        limit: 5,
        now: FROZEN_NOW,
        env: { INDEX_NETWORK_KEY: 'a', BRAVE_SEARCH_API_KEY: 'b' },
        runIndexPathImpl: exploding,
        runBravePathImpl: exploding,
        runDefiLlamaFloorImpl: exploding,
      }),
    ).rejects.toBeInstanceOf(AllPathsFailedError);

    // And the error carries the per-path reasons for diagnostic surfacing.
    try {
      await routerDiscover({
        intent: 'USDC yield on Base, audited',
        constraints,
        limit: 5,
        now: FROZEN_NOW,
        env: { INDEX_NETWORK_KEY: 'a', BRAVE_SEARCH_API_KEY: 'b' },
        runIndexPathImpl: exploding,
        runBravePathImpl: exploding,
        runDefiLlamaFloorImpl: exploding,
      });
      throw new Error('should not reach here');
    } catch (err) {
      expect(err).toBeInstanceOf(AllPathsFailedError);
      const e = err as AllPathsFailedError;
      expect(e.code).toBe('all_paths_failed');
      expect(e.reasons.some((r) => r.includes('upstream down'))).toBe(true);
      expect(e.message).toMatch(/All discovery paths failed/);
    }
  });
});

/* ========================================================================== */
/* BDD case 6 — back-compat: existing tool seam still works                   */
/* ========================================================================== */

describe('story-fallback-discovery: back-compat with story #7 test seams', () => {
  it('the tool wrapper still threads `fetchPools` + `fetchOpportunities` via the router', async () => {
    const result = await discoverYieldsByIntent(
      { intent: 'stable USDC yield on Base, audited' },
      {
        env: { INDEX_NETWORK_KEY: 'set' },
        fetchPools: async () => fixturePools(),
        fetchOpportunities: async () => [
          {
            id: 'opp-1',
            title: 't',
            description: 'd',
            score: 0.9,
            protocol: 'morpho-blue',
            chain: 'Base',
            symbol: 'STEAKUSDC',
            apy: 4,
            url: 'https://app.morpho.org/x',
            raw: {},
          },
        ],
        now: () => FROZEN_NOW,
      },
    );
    expect(result.discovery_source).toBe('index_network');
    expect(result.index_network_used).toBe(true);
    expect(result.fallback_reason).toBeNull();
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
  });
});
