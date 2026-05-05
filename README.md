<h1 align="center">defi-risk-mcp</h1>
<p align="center">Give Claude DeFi-grade risk awareness.</p>
<p align="center">
  <a href="#install">Install</a> ·
  <a href="research/encode-defi-mini-hack/docs/PRD.md">PRD</a> ·
  <a href="research/encode-defi-mini-hack/docs/architecture.md">Architecture</a>
</p>

---

## What this is

An MCP (Model Context Protocol) server that synthesizes DeFi risk across audits, exploits, oracle dependencies, composability, MEV, and slippage. Exposes 7 tools any Claude Desktop / Cursor / Cline / Continue / Windsurf agent can call.

**Read-only / simulate-only.** Never signs transactions. Never holds keys.

## Why it matters

Existing DeFi MCPs are action-oriented (read + write + sign) or portfolio-only. None synthesize risk across heterogeneous sources. This is the only DeFi MCP designed as a **risk lens**, not a tool catalog.

See [research/encode-defi-mini-hack/12-tech-deep-dive.md](research/encode-defi-mini-hack/12-tech-deep-dive.md) for the incumbent coverage matrix.

## Install

```bash
npx @defi-risk/mcp install
```

Or manual config — see [docs/INSTALL.md](research/encode-defi-mini-hack/docs/) (added during story-claude-desktop-integration).

## Tools

| # | Tool | What it does |
|---|---|---|
| 1 | `get_position_risk` | Synthesize risk for a known DeFi position across 6 dimensions |
| 2 | `simulate_tx_risk` | Decode + simulate a raw tx; surface MEV / slippage / counterparty / oracle deps |
| 3 | `explain_protocol_risk` | Audit history + exploit chain + governance for a protocol |
| 4 | `get_recent_exploits` | Synthesized exploit feed (Rekt + BlockSec) |
| 5 | `discover_yields_by_intent` | Post a yield-discovery intent to Index Network; rank by risk |
| 6 | `find_safer_alternatives` | (stretch) Lower-risk replacements for a current position |
| 7 | `check_oracle_dependencies` | (stretch) Oracle graph for a position or protocol |

## What's missing (honest)

- Token-emission quality scoring (real yield vs. inflationary) — roadmap
- Governance-proposal translator — roadmap
- Live wallet inference (`portfolio_after`) — roadmap
- Index Network full intent flow — pending Day 1 SDK verification (file 12 §3)

## Development

```bash
pnpm install
pnpm test
pnpm build
```

The repo enforces:
- BDD-tested PRs (acceptance criteria from `research/encode-defi-mini-hack/docs/stories/*.md`)
- §14 anti-slop gate (no mock data in hot path — see `CLAUDE.md`)
- Branch protection (CI required, no force pushes)

## License

MIT.

Built for [Encode DeFi Mini Hack 2026](https://www.encodeclub.com/programmes/defi-mini-hack).
