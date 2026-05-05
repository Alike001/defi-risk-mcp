# story-tool-explain-protocol-risk

**Epic:** 1 — Core Tools
**Estimated coding time:** 1.5h
**Depends on:** story-scaffold-mcp-server (and shares libs with story-tool-get-position-risk)
**Status:** PENDING

---

## Goal

Implement `explain_protocol_risk` — given a protocol name, return a synthesized risk profile across audits, exploit history, oracle dependencies, composability tree, and recent governance.

## BDD acceptance criteria

```
Given the MCP server is running
When the tool `explain_protocol_risk` is called with `{protocol_name: "aave-v3"}`
Then the response is valid JSON conforming to the ProtocolRiskProfile schema
And the response includes `audits` array with ≥ 1 entry (firm + date + url)
And the response includes `exploit_history` array (may be empty if no exploits)
And the response includes `oracle_deps` array of oracle providers in use
And the response includes `composability_tree` object describing dependent positions
And the response includes `recent_governance` array of last 5 proposals (id, title, status)

Given the protocol is unknown (e.g., `protocol_name: "fakeprotocolxyz"`)
When the tool is called
Then the response returns a structured "protocol not found" error
And the error includes a `suggestions` array of 3 closest known protocols

Given vitest test suite
When `pnpm test src/tests/explainProtocolRisk.test.ts` runs
Then ≥ 5 behavioral test cases pass
```

## File modification map

- `src/tools/explainProtocolRisk.ts` — NEW — tool implementation
- `src/lib/code4rena.ts` — UPDATE (extend) — add audit-history fetch
- `src/lib/governance.ts` — NEW — fetch recent Snapshot/Tally proposals for protocol
- `src/lib/composability.ts` — NEW — build dep tree from DefiLlama + manual mapping for top protocols
- `src/schemas/domain.ts` — UPDATE — add `ProtocolRiskProfile` type
- `src/schemas/tools.ts` — UPDATE — add input/output schemas
- `src/index.ts` — UPDATE — register the tool
- `src/tests/explainProtocolRisk.test.ts` — NEW — ≥ 5 BDD cases
- `data/composability/` — NEW — manual composability maps for top 10 protocols (JSON files)

## Shell verification

```bash
pnpm test src/tests/explainProtocolRisk.test.ts --reporter=verbose | grep -E "✓" | wc -l
# expected: ≥ 5

node -e "
const { explainProtocolRisk } = require('./dist/tools/explainProtocolRisk.js');
explainProtocolRisk({protocol_name:'aave-v3'})
  .then(r => {
    console.log(Array.isArray(r.audits) && r.audits.length >= 1 ? 'OK: audits' : 'FAIL');
    console.log(Array.isArray(r.oracle_deps) ? 'OK: oracles' : 'FAIL');
    console.log(Array.isArray(r.recent_governance) ? 'OK: governance' : 'FAIL');
  });
"
```

## Out of scope

- Live exploit alerts (covered by story-tool-get-recent-exploits)
- Per-position risk (covered by story-tool-get-position-risk)
- Audit report full-text search

## Notes

- Pre-build composability maps for: aave-v3, morpho, pendle, ethena, lido, eigenlayer (top 6 by user-overlap).
- "Closest known protocols" suggestion uses simple Levenshtein on the protocol-name list.
