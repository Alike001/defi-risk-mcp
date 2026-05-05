# story-claude-desktop-integration

**Epic:** 1 — Core Tools
**Estimated coding time:** 1h
**Depends on:** All 3 core tool stories (get_position_risk, simulate_tx_risk, explain_protocol_risk)
**Status:** PENDING

---

## Goal

Wire the MCP server into Claude Desktop on the build machine. Smoke-test that the demo prompt #1 works end-to-end.

## BDD acceptance criteria

```
Given a fresh `claude_desktop_config.json` referencing the local build
When Claude Desktop is restarted
Then the MCP server appears in the tool list with status "connected"
And exactly the tools shipped so far are listed (≥ 3)

Given Claude Desktop is connected
When the user types: "I'm thinking of supplying 10,000 USDC to Aave on Base. What are the risks?"
Then Claude calls at least 1 of: `get_position_risk`, `explain_protocol_risk`
And the visible response cites Aave by name
And the visible response lists at least 2 specific risk dimensions
And the total response time from prompt-send to final-token is < 30 seconds

Given the same Claude Desktop session
When 5 consecutive identical prompts are run
Then all 5 succeed without error
And no tool returns >2× upstream rate limits
```

## File modification map

- `claude-desktop-config-example.json` — NEW — example config for users
- `docs/INSTALL.md` — NEW — Claude Desktop / Cursor / Cline setup instructions
- `scripts/verify-claude-desktop.sh` — NEW — semi-automated check script (greps Claude Desktop logs for "connected")

## Shell verification

```bash
# Manual integration test — must be run interactively, results captured in transcript
echo "Manual test: open Claude Desktop, restart, verify connected status"
echo "Run prompt 1 from PRD §Demo moment, time end-to-end"
echo "Pass criteria: response < 30s, cites Aave, lists ≥ 2 risk dimensions"

# Automated config validation
node -e "
const cfg = require('./claude-desktop-config-example.json');
const mcp = cfg.mcpServers['defi-risk'];
console.log(mcp.command && mcp.args ? 'OK: config shape' : 'FAIL: bad config');
"
```

## Out of scope

- Cursor / Cline integration (verified during story-claude-desktop-three-prompts)
- Multi-session state
- Performance optimization beyond hitting < 30s

## Notes

- Day 1 EOD gate: this story passes. If it doesn't, halt Day 2 work and debug Epic 1.
- Capture screenshots of Claude Desktop running the tools — used in Epic 3 README hero.
