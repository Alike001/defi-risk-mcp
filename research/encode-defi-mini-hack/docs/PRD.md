# PRD — defi-risk-mcp

**Hackathon:** Encode Club DeFi Mini Hack 2026
**Demo Day:** 2026-05-08
**Project name:** `defi-risk-mcp` (locked, do not rename)

---

## Goal

Most DeFi users sign transactions blind. Audit reports are 80-page PDFs. Dashboards show APY, not risk. Existing AI agents either hallucinate APYs or wrap a single SDK with no risk synthesis. **`defi-risk-mcp` gives Claude Desktop and any MCP-compliant agent native DeFi risk awareness** — synthesizing audits, exploits, oracle dependencies, composability, MEV, and slippage across 8 high-leverage tools that any agent can call before it acts.

## One-line pitch

**An MCP server that turns Claude Desktop into a DeFi risk analyst.**

## Sponsor-native fit

Encode DeFi Mini Hack judging panel includes Index Network's co-founder (Seref Yarar). Index Network in 2026 is a **full-stack agent network for intent-matching** (verified — see `research/encode-defi-mini-hack/12-tech-deep-dive.md` §3), and ships no MCP server. This project ships the **first-ever Index Network MCP wrapper** as one of its tools (`discover_yields_by_intent`), letting Claude Desktop participate as an agent in Index's network — posting yield-discovery intents and synthesizing risk per matched opportunity. This is the canonical agent-to-agent flow Index was built for, surfaced through the MCP standard. Direct judge alignment without sycophancy.

The hackathon description says "AI and decentralised finance" twice. This project is the agentic-DeFi infrastructure layer that lets every other DeFi-AI builder go faster.

## Demo moment (90-second judge walkthrough)

**Setup before judge arrives:** Claude Desktop on screen, MCP installed, browser tab with our landing page in background.

1. **Open Claude Desktop.** "Watch this — Claude has zero DeFi knowledge by default. Let me give it some."
2. **Show the install line:** `npx @defi-risk/mcp install`. "One command. Done."
3. **Type the first prompt:** *"I'm thinking of supplying 10,000 USDC to Aave on Base. What are the risks?"* — Claude's MCP tool calls flash on screen, then the synthesized answer: protocol risk, oracle dependency, recent exploits, composability depth.
4. **Type the second prompt:** *"Find me a yield play with > 8% real yield on Base, no rebase tokens, audited within last 12 months."* — Claude calls `discover_yields_by_intent`, Index Network does the discovery, results come back ranked by risk.
5. **Type the third (kill shot):** *"I'm about to sign this — what's wrong with it?"* and paste a raw tx hex. Claude flags MEV exposure, recommends Flashbots Protect, shows portfolio-after impact.

Total stage time: 90 seconds. No sliding decks. No custom UI. Judges see Claude Desktop natively doing DeFi work.

## The wow moment

**The judge doesn't see a custom DeFi app.** They see Claude Desktop — a product they already know — suddenly fluent in DeFi risk. The form factor IS the wedge: this is how every AI-DeFi tool ships in 2026, and we shipped it first.

## Target user (post-hack)

- DeFi power users running Claude Desktop / Cursor for research
- DeFi-native AI agent builders (Olas-style multi-agent systems) who want a risk-aware tool layer
- Encode Hub members + Index Network ecosystem (judge-network reach)

## Success metrics

| Metric | 3-day target | 30-day target |
|---|---|---|
| MCP tools shipped | 7 (5 hard floor) | 10 |
| Install one-liner works | Yes (npm publish or direct GitHub install) | Yes |
| Claude Desktop end-to-end demo | All 3 prompts succeed live | Same |
| GitHub repo public + MIT licensed | Yes | Yes |
| Index Network MCP wrapper | First-ever | Maintained |
| Encode submission accepted | Yes | N/A |
| GitHub stars | Doesn't matter for judging | 50+ if we tweet |

## Scope

### In scope (Days 1-3)

- TypeScript MCP server using `@modelcontextprotocol/sdk` v2 over stdio
- 7 tools (target) / 5 tools (hard floor): see `architecture.md` §Tool Surface
- Read-only / simulation-only — **no signing, no private keys**
- Single-scroll landing page (Next.js 15, see `ux-spec.md`)
- README with install one-liner + 5 example prompts + screenshot
- Published to npm OR documented direct-from-GitHub install
- 90-second demo video (recorded Day 3)
- Encode submission with all required artifacts

### Out of scope (explicitly NOT building)

- ❌ Private key handling, transaction signing, wallet management
- ❌ Database / persistent state (stateless tools, in-memory cache only)
- ❌ Auth / OAuth / user accounts
- ❌ Custom DeFi dashboard UI (banned per ux-spec.md — landing page only)
- ❌ Multi-page navigation / blog / changelog
- ❌ Mobile app
- ❌ Smart contract deployment (this is read/simulate only — no contracts)
- ❌ Light mode toggle
- ❌ Real-time websockets
- ❌ Multiple chains beyond Ethereum + Base + Arbitrum (free-tier RPC budget)
- ❌ Any tool requiring paid API keys beyond free tiers
- ❌ Token emission quality scoring + governance translator (cuttable tools 9, 10 from file 10 §3)

## README requirement (per playbook §8 + §13)

The repo README must, at minimum, contain:
1. Title + 1-line pitch
2. Demo video link (or animated GIF if video can't host)
3. Hero screenshot of Claude Desktop using the MCP
4. Install one-liner + Claude Desktop config snippet
5. Tool list (8 tools, one line each)
6. "What's missing" honest list (governance + token-emission tools as roadmap)
7. License (MIT)
8. Built for Encode DeFi Mini Hack 2026 attribution

## Inputs (canonical references)

- `research/encode-defi-mini-hack/CONTEXT.md` — wedge lock + workflow context
- `research/encode-defi-mini-hack/10-wedge-deep-dive-mcp.md` — tool surface §3, demo §5, 3-day plan §6, risks §7
- `research/encode-defi-mini-hack/11-ui-mining.md` — DESIGN.md gate, anchors, banned tokens
- `research/encode-defi-mini-hack/02-sponsor-docs.md` — Index Network background

## Approval gate

Abu must approve this PRD before architecture lock. Once approved, no scope creep without explicit Abu sign-off.
