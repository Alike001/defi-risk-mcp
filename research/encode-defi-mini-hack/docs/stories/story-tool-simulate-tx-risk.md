# story-tool-simulate-tx-risk

**Epic:** 1 — Core Tools
**Estimated coding time:** 2h
**Depends on:** story-scaffold-mcp-server
**Status:** PENDING

---

## Goal

Implement `simulate_tx_risk` — takes a raw unsigned tx hex, runs through Tenderly simulation, returns MEV exposure, slippage estimate, counterparty info, oracle dependencies, and post-tx portfolio impact.

## BDD acceptance criteria

```
Given the MCP server is running
When the tool `simulate_tx_risk` is called with `{chain: "ethereum", unsigned_tx_hex: "<valid Uniswap V3 swap tx>"}`
Then the response is valid JSON conforming to the TxRiskReport schema
And the response includes `mev_risk` ∈ {"low", "medium", "high"} with a reasoning string
And the response includes `slippage_pct` as a number ≥ 0
And the response includes `counterparty` object with name + audited boolean
And the response includes `oracle_deps` array (may be empty for AMM swaps)
And the response includes `portfolio_after` (may be null if wallet unknown)
And the response includes `recommendations` array of strings (e.g., "use Flashbots Protect")

Given vitest test suite
When `pnpm test src/tests/simulateTxRisk.test.ts` runs
Then ≥ 6 behavioral test cases pass
And tests cover: valid Uniswap swap, valid Aave deposit, invalid tx hex, malformed chain, Tenderly API failure (mock), MEV-flagged tx (mock)

Given a Claude Desktop session
When the user pastes a raw tx hex and asks "what's wrong with this?"
Then Claude calls `simulate_tx_risk` with the hex
And the response surfaces at least one specific risk (MEV, slippage, or counterparty)
```

## File modification map

- `src/tools/simulateTxRisk.ts` — NEW — tool implementation
- `src/lib/tenderly.ts` — NEW — Tenderly Simulation API client
- `src/lib/txDecoder.ts` — NEW — decodes raw tx hex to method + args using viem + Etherscan ABI fetch
- `src/schemas/domain.ts` — UPDATE — add `TxRiskReport` type
- `src/schemas/tools.ts` — UPDATE — add `simulateTxRiskInput/Output` Zod schemas
- `src/index.ts` — UPDATE — register the tool
- `src/tests/simulateTxRisk.test.ts` — NEW — ≥ 6 BDD test cases
- `data/fixtures/txs/` — NEW — fixture tx hexes for tests (1 Uniswap, 1 Aave, 1 invalid)

## Shell verification

```bash
pnpm test src/tests/simulateTxRisk.test.ts --reporter=verbose | grep -E "✓" | wc -l
# expected: ≥ 6

# Integration smoke test (requires TENDERLY_KEY)
node -e "
const { simulateTxRisk } = require('./dist/tools/simulateTxRisk.js');
const fixture = require('fs').readFileSync('data/fixtures/txs/uniswap-v3-swap.hex', 'utf8').trim();
simulateTxRisk({chain:'ethereum',unsigned_tx_hex:fixture})
  .then(r => {
    console.log(['low','medium','high'].includes(r.mev_risk) ? 'OK' : 'FAIL: mev_risk');
    console.log(typeof r.slippage_pct === 'number' ? 'OK' : 'FAIL: slippage');
  });
"
```

## Out of scope

- Wallet address inference / portfolio_after for unknown senders (returns null)
- Bundling multiple txs (single-tx only)
- Cross-chain tx simulation
- Signing or broadcasting (NEVER — per ADR-003)

## Notes

- Tenderly free tier: 100 simulations/day. Cache responses by tx hash in process memory to avoid repeat hits during demo.
- For demo prep: pre-warm cache with the demo fixture txs the night before (Day 3 morning).
- If Tenderly key missing in env: return a clear error with setup instructions, not a crash.
