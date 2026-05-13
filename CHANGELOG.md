# Changelog

All notable changes to `@alike001/defi-risk-mcp` are documented in this file.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- README "What you get" section — user-outcome framing (before/after, four concrete use cases) so first-time readers can decide whether to install in under 30 seconds.
- README "Quick start" section — one-command install path, restart instruction, and a verification prompt to run against Claude.
- README "Project setup (local dev)" section — full clone-build-test flow plus a table of every env key, where to get it, and which tool needs it.
- `CHANGELOG.md` itself — versioned release notes for every future publish.

### Changed
- Reordered README so the value proposition comes before the demo block, matching reviewer feedback.

## [0.1.0] - 2026-05-11

First public release on npm — published as `@alike001/defi-risk-mcp`.

### Added
- **6 MCP tools** exposed over stdio JSON-RPC, callable from Claude Desktop, Cursor, Cline, Continue, and Windsurf:
  - `health_check` — liveness probe.
  - `get_position_risk` — 6-dimension risk synthesis (oracle, audit, exploit, counterparty, composability, MEV/slippage) for a DeFi position.
  - `simulate_tx_risk` — decode + simulate a raw tx against Tenderly; flags drain patterns, stale deadlines, and suspicious recipients before signing.
  - `explain_protocol_risk` — audit history, exploit chain, governance posture for a protocol (Aave, Lido, Compound, …).
  - `get_recent_exploits` — synthesized, deduped exploit feed across Rekt and BlockSec.
  - `discover_yields_by_intent` — yield discovery via Index Network with a DefiLlama Yields fallback (per ADR-006); ranked by risk floor, not raw APY.
- **One-line install helper** (`defi-risk-mcp-install`) — merges the canonical `defi-risk` entry into the Claude Desktop config without clobbering other MCP servers already configured. Prompts before overwriting an existing entry; `--force` skips the prompt.
- **Read-only / simulate-only architecture** (ADR-003) — the server never signs transactions, never holds keys, never broadcasts. You always sign in your own wallet.
- **Graceful credential degradation** — tools that need a missing API key return a structured `missing_credentials` error rather than crashing. The server stays "connected" in the client; add the key and restart to enable the tool.
- **Full install documentation** for macOS, Windows, Cursor, and Cline, including a copy-pasteable [`claude-desktop-config-example.json`](claude-desktop-config-example.json).

### Notes
- Built for the [Encode DeFi Mini Hack 2026](https://www.encodeclub.com/programmes/defi-mini-hack).
- Pre-1.0 — the tool surface is stable enough to ship but may evolve. Track changes in this file before upgrading minor versions.

[Unreleased]: https://github.com/Alike001/defi-risk-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Alike001/defi-risk-mcp/releases/tag/v0.1.0
