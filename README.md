<h1 align="center">defi-risk-mcp</h1>
<p align="center"><strong>Give Claude DeFi-grade risk awareness.</strong></p>
<p align="center">
  An MCP server that synthesizes DeFi risk across audits, exploits, oracle dependencies, composability, MEV, and slippage — exposed as tools any Claude Desktop / Cursor / Cline agent can call.
</p>
<p align="center">
  <a href="#install">Install</a> ·
  <a href="#tools">Tools</a> ·
  <a href="docs/INSTALL.md">Full install guide</a> ·
  <a href="#whats-missing-honest">What's missing</a> ·
  <a href="research/encode-defi-mini-hack/docs/PRD.md">PRD</a>
</p>

---

## Demo

**Prompt:** _"I'm thinking of supplying 10,000 USDC to Aave on Base. What are the risks?"_

Claude calls `get_position_risk` + `explain_protocol_risk` + `get_recent_exploits` + `get_chain_info` and synthesizes — verbatim from a live Claude Code session on Linux:

> ### Risks of supplying 10,000 USDC to Aave v3 on Base
>
> **Protocol risk — LOW**
> - Audits: 5 reputable firms on record — OpenZeppelin (2022), Trail of Bits (2022), Certora (formal verification, ongoing), SigmaPrime (2023, GHO/v3.1), Code4rena (2022).
> - Exploit history: 1 historical incident (2022 CRV short attack) — and that was on Aave v2, not v3 — protocol contracts weren't exploited; it was a bad-debt event from an oracle-priced asset that was subsequently frozen. v3 has a clean record.
> - TVL: ~$14.9B — deep enough that supply/withdraw liquidity is rarely a problem for a $10K position.
> - Recent Base exploits (90 days): feed returned 0 real incidents.
>
> **Oracle risk — MEDIUM** (structural, not Aave-specific)
> - Aave v3 reads Chainlink for all collateral pricing. A USDC supply position itself isn't directly priced (USDC is the unit of account), but Chainlink failure or stale prices can cause cascading bad-debt that hits the reserve where you're supplying. This is the single biggest non-headline risk.
>
> **Chain risk (Base) — MEDIUM**
> - Sequencer: Base runs a centralized Coinbase sequencer. Outage → no withdrawals or liquidations until restored. A long sequencer halt during a USDC depeg event is the worst case.
> - Bridge: USDC on Base is native (Circle's CCTP), not a bridge wrapper, so this risk is lower than on chains using lock/mint bridges. Withdrawing back to Ethereum still routes through the standard L2 → L1 7-day exit window if you bypass CCTP.
>
> **Asset risk (USDC) — LOW-MEDIUM**
> - Circle freeze: USDC is freezable at the issuer level. Sanctioned addresses can lose funds outright. Not a behavioral risk for a normal user but worth noting.
> - Depeg: March 2023 SVB depeg saw USDC trade ~$0.87 briefly. Aave v3 handled this correctly, but it's the historical worst case.
>
> **Position-specific risk — LOW**
> - Utilization spike: if borrow demand spikes, withdraws can queue until utilization drops. For $10K on a multi-billion-dollar reserve, this is a non-issue 99% of the time.
> - Variable APY: yield is not fixed — can drop quickly if borrow demand softens.
> - `aBasUSDC` is rebasing (interest accrues to balance). Some downstream protocols don't accept it.
>
> **Governance risk — LOW**
>
> Recent Aave DAO activity is routine: risk-provider renewal, bug bounty restructure, AAVE buyback pause. No emergency or contentious proposals affecting USDC reserves.
>
> **Bottom line**
>
> For passive USDC supply, this is one of the lower-risk yields in DeFi. Three things to actually watch:
> 1. Chainlink USDC/USD feed health (oracle is the real systemic risk)
> 2. Base sequencer status during any USDC depeg
> 3. Reserve utilization before sizing up — at $10K it's irrelevant.

The full verification log — including prompt #2 (yield discovery → Pendle APXUSD picked correctly) and prompt #3 (caught a drain-pattern transaction with burn-shaped recipient + stale deadline) — lives in [issue #5](https://github.com/Alike001/defi-risk-mcp/issues/5) and [issue #9](https://github.com/Alike001/defi-risk-mcp/issues/9).

> 📹 90-second demo video: _coming soon_ <!-- TODO from #12 -->

---

## Install

The MCP server is installed by registering it as a tool server in your MCP-compliant client (Claude Desktop, Cursor, Cline, Continue, Windsurf). It speaks JSON-RPC over stdio — your client spawns it and routes tool calls to it.

### Quick install (one-liner)

```bash
npx -y -p @defi-risk/mcp defi-risk-mcp-install
```

This writes a `defi-risk` entry into your Claude Desktop config (creating the file if it does not exist), preserving every other MCP server you already have. If a `defi-risk` entry is already present, the script asks before overwriting; pass `--force` to skip the prompt.

### Manual install

If you prefer to edit the config yourself, paste this block into `claude_desktop_config.json` and restart Claude Desktop fully (Cmd/Ctrl-Q):

```json
{
  "mcpServers": {
    "defi-risk": {
      "command": "npx",
      "args": ["-y", "-p", "@defi-risk/mcp", "defi-risk-mcp"],
      "env": {
        "ALCHEMY_API_KEY": "",
        "ETHERSCAN_API_KEY": "",
        "TENDERLY_USER": "",
        "TENDERLY_PROJECT": "",
        "TENDERLY_ACCESS_KEY": "",
        "INDEX_NETWORK_KEY": "",
        "BRAVE_SEARCH_API_KEY": ""
      }
    }
  }
}
```

Config file paths:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

The full guide — including Cursor and Cline paths, troubleshooting, and verification prompts — lives at [`docs/INSTALL.md`](docs/INSTALL.md). A copy-pasteable starting config is at [`claude-desktop-config-example.json`](claude-desktop-config-example.json).

> **Read-only / simulate-only.** This MCP never signs transactions, never holds keys, never broadcasts. Per [ADR-003](research/encode-defi-mini-hack/docs/architecture.md#adr-003-read-only--simulation-only--no-signing) you always sign in your own wallet.

---

## Tools

| # | Tool | What it does |
|---|---|---|
| 1 | `health_check` | Liveness probe — round-trips through stdio so clients can confirm the server is up before calling tools. |
| 2 | `get_position_risk` | Synthesize risk for a known DeFi position across 6 dimensions (oracle, audit, exploit, counterparty, composability, MEV/slippage). |
| 3 | `simulate_tx_risk` | Decode + simulate a raw tx against Tenderly; surface MEV / slippage / counterparty / oracle dependencies before you sign. |
| 4 | `explain_protocol_risk` | Audit history + exploit chain + governance posture for a protocol (Aave, Lido, Compound, …). |
| 5 | `get_recent_exploits` | Synthesized exploit feed across Rekt + BlockSec, deduped and ranked by recency and severity. |
| 6 | `discover_yields_by_intent` | Post a yield-discovery intent to Index Network (with DefiLlama fallback per ADR-006); rank by risk. |
| 7 | `find_safer_alternatives` | _Stretch_ — lower-risk replacements for a current position. Roadmap. |
| 8 | `check_oracle_dependencies` | _Stretch_ — oracle dependency graph for a position or protocol. Roadmap. |

Tools that need credentials but don't have them return a structured `missing_credentials` error rather than crashing — the server still comes up "connected" in your client. Add the missing key to the `env` block and fully restart.

---

## What's missing (honest)

This MCP is shipped for the [Encode DeFi Mini Hack 2026](https://www.encodeclub.com/programmes/defi-mini-hack) under a tight time box. The following are explicitly deferred:

- **Token-emission quality scoring** (real-yield vs. inflationary) — roadmap; cuttable per PRD scope.
- **Governance-proposal translator** — roadmap; cuttable per PRD scope.
- **Live wallet inference** (`portfolio_after`) — roadmap.
- **`find_safer_alternatives` and `check_oracle_dependencies`** — listed in the tool table as stretch; not yet implemented in this build.
- **Index Network full intent flow** — runs through the SDK→CLI→Brave→DefiLlama fallback router (ADR-006); end-to-end intent matching is gated on the SDK reaching parity with the published spec.
- **Multi-chain coverage beyond Ethereum + Base + Arbitrum** — bounded by the free-tier RPC budget.

If a tool you need is missing, open an issue — the architecture is built so adding a tool is one file in `src/tools/` plus one registration in `src/index.ts`.

---

## Development

```bash
git clone https://github.com/Alike001/defi-risk-mcp.git
cd defi-risk-mcp
pnpm install
pnpm test            # full vitest suite
pnpm exec tsc --noEmit
pnpm run lint        # biome
pnpm run build       # writes dist/
```

The repo enforces:

- **BDD-tested PRs** — every story under `research/encode-defi-mini-hack/docs/stories/*.md` lists Given/When/Then acceptance criteria; tests come first.
- **§14 anti-slop gate** — no mock / fake / dummy data in the hot path (see `CLAUDE.md`).
- **Branch protection** — CI required, no force pushes to `main`.

### Publishing (maintainers only)

`prepublishOnly` runs `pnpm build`. From a clean working tree:

```bash
pnpm publish --dry-run --access public   # preview the tarball
npm login && pnpm publish --access public # actual publish (requires npm auth)
```

The `bin` field exposes both:

- `defi-risk-mcp` — the MCP server entrypoint (what Claude Desktop spawns).
- `defi-risk-mcp-install` — the install helper that merges the canonical entry into Claude Desktop config without overwriting other servers.

---

## License

MIT. See [`LICENSE`](LICENSE).

---

Built for Encode DeFi Mini Hack 2026 — [encodeclub.com/programmes/defi-mini-hack](https://www.encodeclub.com/programmes/defi-mini-hack).
