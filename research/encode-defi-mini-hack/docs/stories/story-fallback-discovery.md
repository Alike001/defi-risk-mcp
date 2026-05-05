# story-fallback-discovery

**Epic:** 2 — Discovery + Index Integration
**Estimated coding time:** 1h
**Depends on:** story-tool-discover-yields-by-intent
**Status:** PENDING

---

## Goal

Add a Brave/Tavily-search-based fallback to `discover_yields_by_intent` so the tool degrades gracefully when Index Network is unavailable, missing key, or rate-limited.

## BDD acceptance criteria

```
Given the Index Network client throws / errors / rate-limits
When `discover_yields_by_intent` is called
Then the fallback path executes
And the response succeeds with `discovery_source: "fallback"`
And the response candidates count ≥ 3 (matching Index path)

Given INDEX_NETWORK_KEY is unset and BRAVE_SEARCH_API_KEY is set
When the tool is called
Then the fallback path executes (no error)
And response is valid

Given both INDEX_NETWORK_KEY and BRAVE_SEARCH_API_KEY are unset
When the tool is called
Then the response uses DefiLlama Yields API directly as the absolute floor
And `discovery_source: "defillama_only"`

Given vitest test suite
When `pnpm test src/tests/fallbackDiscovery.test.ts` runs
Then ≥ 4 BDD test cases pass
And tests cover: index-fail-fallback-success, no-keys-defillama-floor, network-timeout, all-paths-fail-graceful-error
```

## File modification map

- `src/lib/discovery/indexPath.ts` — NEW — extracted from indexNetwork.ts
- `src/lib/discovery/bravePath.ts` — NEW — Brave search → parsed candidates
- `src/lib/discovery/defillamaFloor.ts` — NEW — DefiLlama Yields API direct
- `src/lib/discovery/router.ts` — NEW — picks path based on env + retry logic
- `src/tools/discoverYieldsByIntent.ts` — UPDATE — uses router instead of direct Index call
- `src/tests/fallbackDiscovery.test.ts` — NEW — ≥ 4 BDD cases

## Shell verification

```bash
pnpm test src/tests/fallbackDiscovery.test.ts --reporter=verbose | grep -E "✓" | wc -l
# expected: ≥ 4

# Test fallback by deleting key
INDEX_NETWORK_KEY="" node -e "
const { discoverYieldsByIntent } = require('./dist/tools/discoverYieldsByIntent.js');
discoverYieldsByIntent({intent:'stable USDC yield > 5% on Base, audited'})
  .then(r => console.log(r.discovery_source !== 'index_network' ? 'OK: fell back' : 'FAIL'));
"
```

## Out of scope

- Caching across paths (one-call-per-tool-invocation only)
- Circuit-breaker patterns (simple try/fallback only)

## Notes

- This story can be cut if Day 2 runs short — see epics.md hard-cut order.
- If cut: inline a simple `try { index } catch { brave }` in discoverYieldsByIntent.ts directly. Less clean, but ships.
