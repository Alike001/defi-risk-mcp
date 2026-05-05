# story-tool-discover-yields-by-intent

**Epic:** 2 — Discovery + Index Integration
**Estimated coding time:** 3h
**Depends on:** story-scaffold-mcp-server
**Status:** PENDING

---

## Goal

Implement `discover_yields_by_intent` — accept a natural-language intent ("stable USDC yield > 5% on Base, audited"), post it to Index Network as a structured intent, receive matched opportunities, then layer risk synthesis per candidate. **This is the judge-alignment tool — first-ever Index Network MCP wrapper.** Lets Claude Desktop participate as a first-class agent in Index's intent-matching network (see `research/encode-defi-mini-hack/12-tech-deep-dive.md` §3).

## BDD acceptance criteria

```
Given the MCP server is running and INDEX_NETWORK_KEY is set in env
When the tool `discover_yields_by_intent` is called with `{intent: "stable USDC yield > 5% on Base, audited"}`
Then the response is valid JSON conforming to the YieldDiscoveryResult schema
And the response includes a `candidates` array with ≥ 3 entries
And each candidate has: `protocol`, `chain`, `apy` (number), `real_yield` (number, may differ from apy), `risk_score` (0-100), `why_recommended` (≥ 40 chars)
And candidates are sorted by `risk_score` ascending (safest first)
And the response includes a `discovery_source` field: "index_network" | "fallback"

Given INDEX_NETWORK_KEY is unset
When the tool is called
Then the fallback discovery path runs (Brave/Tavily search)
And the response `discovery_source` field is "fallback"
And the response otherwise conforms to schema

Given vitest test suite
When `pnpm test src/tests/discoverYieldsByIntent.test.ts` runs
Then ≥ 6 BDD test cases pass
And tests cover: happy path with Index, fallback path, malformed intent, no-results, intent with chain constraint, intent with risk constraint

Given a Claude Desktop session with the demo prompt 2
When the user asks "Find me a yield play with > 8% real yield on Base, no rebase tokens, audited within last 12 months."
Then Claude calls `discover_yields_by_intent` with that intent
And the response includes ≥ 1 candidate matching all constraints
And the visible answer cites Index Network if Index path was used
```

## File modification map

- `src/tools/discoverYieldsByIntent.ts` — NEW — tool implementation (orchestrates Index + DefiLlama Yields + risk filter)
- `src/lib/indexNetwork.ts` — NEW — Index Network SDK wrapper (with confirmed package + endpoint Day 1)
- `src/lib/yieldFilter.ts` — NEW — applies intent constraints to candidate set
- `src/lib/realYield.ts` — NEW — separates inflationary token emission from real yield using DefiLlama protocol metadata
- `src/lib/intentParser.ts` — NEW — extracts structured constraints (apy_min, chain, audited, etc.) from natural-language intent
- `src/schemas/domain.ts` — UPDATE — add `YieldCandidate`, `YieldDiscoveryResult`, `IntentConstraints` types
- `src/schemas/tools.ts` — UPDATE — add input/output schemas
- `src/index.ts` — UPDATE — register the tool
- `src/tests/discoverYieldsByIntent.test.ts` — NEW — ≥ 6 BDD cases
- `data/fixtures/index-network-response.json` — NEW — fixture for offline tests
- `.env.example` — UPDATE — document `INDEX_NETWORK_KEY` (optional)

## Shell verification

```bash
pnpm test src/tests/discoverYieldsByIntent.test.ts --reporter=verbose | grep -E "✓" | wc -l
# expected: ≥ 6

# Live integration (requires INDEX_NETWORK_KEY)
node -e "
const { discoverYieldsByIntent } = require('./dist/tools/discoverYieldsByIntent.js');
discoverYieldsByIntent({intent:'stable USDC yield > 5% on Base, audited'})
  .then(r => {
    console.log(r.candidates.length >= 3 ? 'OK: candidates' : 'FAIL');
    console.log(['index_network','fallback'].includes(r.discovery_source) ? 'OK: source' : 'FAIL');
    const sortedAsc = r.candidates.every((c,i,a) => i===0 || a[i-1].risk_score <= c.risk_score);
    console.log(sortedAsc ? 'OK: sorted' : 'FAIL: sort');
  });
"
```

## Out of scope

- Executing the yield position (read/discover only — never sign)
- Multi-step yield strategies (single position only)
- Historical yield backtest

## Notes

- **Day 1 task before this story can complete (per architecture.md ADR-006 + tech deep-dive §3 §7):**
  1. `npm view @indexnetwork/sdk` — confirm latest version + maintainer + dependencies
  2. `npm install @indexnetwork/sdk` in a scratch dir
  3. `cat node_modules/@indexnetwork/sdk/dist/index.d.ts` (or equivalent) to read TypeScript signatures
  4. If `IndexClient` has a usable `createIntent` / `discoverOpportunity` / equivalent method → use directly (path 1)
  5. If SDK is too thin → shell out to `@indexnetwork/cli` (path 2 — `child_process.spawn` with `index opportunity discover "<intent>"`)
  6. If Index unreachable → fallback to Brave/Tavily/DefiLlama (path 3 — see story-fallback-discovery)
- Document loudly in tool description: "Lets Claude Desktop participate in Index Network's intent-matching."
- If Index integration slips on a path: fallback path keeps the tool valuable; ship with README note acknowledging which path is live.
