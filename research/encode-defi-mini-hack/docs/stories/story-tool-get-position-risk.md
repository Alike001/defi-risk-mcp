# story-tool-get-position-risk

**Epic:** 1 — Core Tools
**Estimated coding time:** 2h
**Depends on:** story-scaffold-mcp-server
**Status:** PENDING

---

## Goal

Implement `get_position_risk` — synthesizes risk for a known DeFi position across audit, oracle, exploit, composability, MEV, and slippage dimensions.

## BDD acceptance criteria

```
Given the MCP server is running
When the tool `get_position_risk` is called with `{chain: "base", protocol: "aave-v3", position_id: "USDC-supply"}`
Then the response is valid JSON conforming to the RiskScore schema
And the response contains exactly 6 risk dimensions (audit, oracle, exploit, composability, mev, slippage)
And each dimension has a `score` (0-100) and a `reasoning` string ≥ 30 chars
And the response contains a top-level `summary` string ≥ 50 chars
And the response contains a `sources` array with ≥ 2 URLs

Given vitest test suite
When `pnpm test src/tests/getPositionRisk.test.ts` runs
Then ≥ 8 behavioral test cases pass
And tests cover: happy path, unknown protocol, unknown chain, malformed inputs, no-data fallback, source-url validity

Given a real Claude Desktop session
When user asks "What's the risk of supplying USDC to Aave on Base?"
Then Claude calls `get_position_risk` with chain=base, protocol=aave-v3, position_id="USDC-supply"
And the synthesized answer cites at least one specific risk dimension by name
```

## File modification map

- `src/tools/getPositionRisk.ts` — NEW — tool implementation
- `src/lib/synthesis.ts` — NEW — risk-dimension scoring + plain-English explanation generator
- `src/lib/alchemy.ts` — NEW — minimal RPC client for protocol state reads
- `src/lib/defillama.ts` — NEW — protocol metadata + TVL fetcher
- `src/lib/code4rena.ts` — NEW — public audit summary fetcher (top-50 protocols cached locally)
- `src/schemas/domain.ts` — NEW — `RiskScore`, `RiskDimension`, `Position` types
- `src/schemas/tools.ts` — UPDATE — add `getPositionRiskInput`, `getPositionRiskOutput` Zod schemas
- `src/index.ts` — UPDATE — register the tool
- `src/tests/getPositionRisk.test.ts` — NEW — ≥ 8 BDD test cases
- `data/audits/` — NEW — pre-cached audit summaries for top 50 protocols (markdown files)

## Shell verification

```bash
pnpm test src/tests/getPositionRisk.test.ts --reporter=verbose | grep -E "✓" | wc -l
# expected: ≥ 8

# integration smoke
node -e "
const { getPositionRisk } = require('./dist/tools/getPositionRisk.js');
getPositionRisk({chain:'base',protocol:'aave-v3',position_id:'USDC-supply'})
  .then(r => { 
    console.log(Object.keys(r.dimensions).length === 6 ? 'OK' : 'FAIL: dimensions');
    console.log(r.summary.length >= 50 ? 'OK' : 'FAIL: summary too short');
    console.log(r.sources.length >= 2 ? 'OK' : 'FAIL: too few sources');
  });
"
```

## Out of scope

- Tools 2, 4, 7, 8 (other tool stories)
- Live exploit feed (story-tool-get-recent-exploits)
- LLM-based summary polish (synthesis is deterministic in v0)

## Notes

- Pre-cache audit summaries for: aave-v3, compound-v3, uniswap-v3, morpho, pendle, ethena, lido, eigenlayer, curve, balancer (top 10). Drop in `data/audits/<protocol>.md`.
- For chains: support `ethereum`, `base`, `arbitrum` initially. Document chain coverage in tool description.
