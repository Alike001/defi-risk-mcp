# Epics — defi-risk-mcp

**Build window:** 2026-05-05 (today) → 2026-05-08 Demo Day. **3 working days.**

Each epic capped at ~8h coding-agent time (a single 1-day work block). Stories within capped at ≤ 2h each.

---

## Epic 1 — Core Tools (Day 1)

**Business value:** Without these 5 tools, the demo is unshippable. They are the floor.
**Estimated coding time:** ~8h (1 day with parallelism).
**Depends on:** None.
**Stories:**

| ID | Title | Est | Depends on |
|---|---|---|---|
| story-scaffold-mcp-server | Scaffold TypeScript MCP server with stdio transport | 1.5h | none |
| story-tool-get-position-risk | Implement `get_position_risk` tool | 2h | scaffold |
| story-tool-simulate-tx-risk | Implement `simulate_tx_risk` tool | 2h | scaffold |
| story-tool-explain-protocol-risk | Implement `explain_protocol_risk` tool | 1.5h | scaffold |
| story-claude-desktop-integration | Wire MCP into Claude Desktop, end-to-end smoke test on 3 prompts | 1h | all 3 tools above |

**Day 1 EOD success criterion:** Claude Desktop can answer prompt 1 (Aave-on-Base risk) using the MCP, end-to-end, with at least 2 tool calls visible in the Claude Desktop log.

---

## Epic 2 — Discovery + Index Integration (Day 2)

**Business value:** The judge-alignment epic. Index Network co-founder is on the panel. Building the first-ever Index Network MCP wrapper is direct alignment without sycophancy.
**Estimated coding time:** ~7h.
**Depends on:** Epic 1 (scaffold + tool patterns).
**Stories:**

| ID | Title | Est | Depends on |
|---|---|---|---|
| story-tool-get-recent-exploits | Implement `get_recent_exploits` tool (Rekt RSS + BlockSec) | 1.5h | scaffold |
| story-tool-discover-yields-by-intent | Implement `discover_yields_by_intent` with Index Network SDK | 3h | scaffold |
| story-fallback-discovery | Add Brave/Tavily fallback to discovery tool (per ADR-006) | 1h | discover-yields |
| story-claude-desktop-three-prompts | Verify all 3 demo prompts work end-to-end | 1.5h | all of Epic 2 |

**Day 2 EOD success criterion:** All 3 demo prompts succeed in Claude Desktop with no manual fallback. Index Network appears in tool calls for prompt 2.

**Hard cut if behind:** drop `story-fallback-discovery` (use Brave fallback inline if Index slips, no separate story). Drop `get_recent_exploits` if needed (prompt 3 doesn't need it).

---

## Epic 3 — Polish + Submit (Day 3)

**Business value:** Without this epic the project is invisible to judges. Landing + README + demo video + submission.
**Estimated coding time:** ~7h.
**Depends on:** Epics 1 + 2 done (the demo must work).
**Stories:**

| ID | Title | Est | Depends on |
|---|---|---|---|
| story-landing-page | Single-scroll Next.js landing per ux-spec.md | 3h | none (parallel-able) |
| story-readme-and-publish | README hero + screenshot + npm publish | 1.5h | Epic 1+2 done |
| story-demo-recording | Record + edit 90-second demo video | 1h | Epic 1+2 done |
| story-encode-submission | Submit on Encode platform with all artifacts | 0.5h | all above |
| story-anti-slop-audit | Run sahil-anti-slop-audit on landing before publish | 0.5h | landing-page done |

**Day 3 EOD success criterion:** Encode submission filed before deadline. Landing live on Vercel preview. npm package published. Demo video uploaded to YouTube/Loom.

---

## Dependency graph

```
Epic 1 (Day 1)                      Epic 3 — landing-page
  └─ scaffold                              ║ (parallel — no Epic dep)
       ├─ get_position_risk                ║
       ├─ simulate_tx_risk                 ║
       ├─ explain_protocol_risk            ║
       └─ claude-desktop-integration       ║
            ▼                              ║
Epic 2 (Day 2)                             ║
  ├─ get_recent_exploits                   ║
  ├─ discover_yields_by_intent             ║
  ├─ fallback-discovery                    ║
  └─ claude-desktop-three-prompts          ║
                              ▼            ▼
Epic 3 finalization (Day 3)
  ├─ readme-and-publish ── needs Epic 1+2 demo working
  ├─ demo-recording      ── needs Epic 1+2 demo working
  ├─ anti-slop-audit     ── needs landing-page
  └─ encode-submission   ── needs all
```

`story-landing-page` is parallelizable from Day 1 — different surface, different stack. Assign a separate coding agent if running multi-agent.

---

## Story file index

```
docs/stories/
├── story-scaffold-mcp-server.md
├── story-tool-get-position-risk.md
├── story-tool-simulate-tx-risk.md
├── story-tool-explain-protocol-risk.md
├── story-claude-desktop-integration.md
├── story-tool-get-recent-exploits.md
├── story-tool-discover-yields-by-intent.md
├── story-fallback-discovery.md
├── story-claude-desktop-three-prompts.md
├── story-landing-page.md
├── story-readme-and-publish.md
├── story-demo-recording.md
├── story-anti-slop-audit.md
└── story-encode-submission.md
```

13 stories. ~22h total coding time. 3 days × ~7-8h/day with parallelism = fits.

---

## Hard cuts (running behind triage order)

If at end of Day 1 we don't have Epic 1 done:
1. **Cut tool 4** (`explain_protocol_risk`) — it's the lightest-utility of the three core tools
2. **Cut Epic 2's `get_recent_exploits`**
3. **Cut Epic 3 anti-slop-audit** — accept landing as-is

If at end of Day 2 we don't have Index integration:
1. Use Brave/Tavily for discovery, keep tool name + signature, document Index integration as roadmap

If at end of Day 3 morning the demo isn't reliable:
1. Pre-record the live-demo prompts, ship video as fallback. Live demo = ideal, not required.
