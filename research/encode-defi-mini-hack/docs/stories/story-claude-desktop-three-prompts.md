# story-claude-desktop-three-prompts

**Epic:** 2 — Discovery + Index Integration
**Estimated coding time:** 1.5h
**Depends on:** All Epic 1 + Epic 2 tool stories
**Status:** PENDING

---

## Goal

Verify all 3 demo prompts (per PRD §Demo moment) work end-to-end in Claude Desktop. Capture timing, screenshot evidence, and fix any blockers before Day 3 polish.

## BDD acceptance criteria

```
Given Claude Desktop with the MCP installed and all 7 tools registered
When prompt 1 is run: "I'm thinking of supplying 10,000 USDC to Aave on Base. What are the risks?"
Then Claude calls ≥ 1 of: get_position_risk, explain_protocol_risk, get_recent_exploits
And the response cites at least 2 specific risk dimensions
And the response cites at least 1 specific source URL
And total time-to-final-token < 30 seconds

When prompt 2 is run: "Find me a yield play with > 8% real yield on Base, no rebase tokens, audited within last 12 months."
Then Claude calls discover_yields_by_intent
And the response includes ≥ 1 candidate matching all constraints
And the response cites Index Network OR the fallback source explicitly
And total time-to-final-token < 30 seconds

When prompt 3 is run with a real Uniswap V3 swap raw tx hex appended
Then Claude calls simulate_tx_risk
And the response identifies the swap correctly (token in/out, AMM)
And the response surfaces MEV exposure verdict
And the response provides at least 1 specific recommendation
And total time-to-final-token < 30 seconds

Given any of the above fail (timeout, wrong tool call, missing data)
When the failure is recorded
Then a remediation note is added to the next-day plan
And the story is NOT marked complete until all 3 prompts pass
```

## File modification map

- `docs/demo-transcript.md` — NEW — recorded transcript of all 3 prompts running successfully (with tool-call IDs and timings)
- `.github/screenshots/prompt-1.png`, `prompt-2.png`, `prompt-3.png` — NEW — Claude Desktop captures
- `scripts/demo-prep.sh` — NEW — pre-warms caches (Tenderly sim, DefiLlama, exploit feed) for stable demo

## Shell verification

```bash
# Manual verification — interactive
echo "Run all 3 prompts in Claude Desktop. Record:"
echo "  1. Tool calls visible in Claude Desktop"
echo "  2. Time-to-final-token (use stopwatch)"
echo "  3. Screenshot of each completed prompt"
echo "Pass: all 3 < 30s, all 3 cite specific data"

# Automated cache pre-warm
bash scripts/demo-prep.sh
```

## Out of scope

- Cursor / Cline verification (bonus, not blocking)
- Performance < 10s (tighten in post-hack iteration)

## Notes

- This story is the **Day 2 EOD gate**. If it doesn't pass, Day 3 polish cannot proceed.
- Run on the actual demo machine (not a different laptop) — Claude Desktop config + paths matter.
- Capture screenshots in light AND dark Claude Desktop themes if the user has theme set; pick one for README hero.
