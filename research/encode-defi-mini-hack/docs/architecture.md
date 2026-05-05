# Architecture — defi-risk-mcp

**Status:** Locked at spec time. Changes require Abu approval.

---

## Stack

| Concern | Choice | Version | Why |
|---|---|---|---|
| Language | TypeScript | 5.6+ | Best Claude Desktop compat; first-class `@modelcontextprotocol/sdk` |
| Runtime | Node.js | 20 LTS | npm publish + Claude Desktop spawn |
| MCP SDK | `@modelcontextprotocol/sdk` | v2 (latest stable) | Official, stdio transport built-in |
| Schema | `zod` | 3.x | MCP tool input validation |
| HTTP | `undici` (Node native fetch) | bundled | No axios bloat |
| Test | `vitest` | 2.x | Fast, ESM-native |
| Linter | `biome` | 1.x | Single tool, fast, TS-first |
| Landing page | Next.js | 15 (App Router) | Per ux-spec.md anchor (Bun, shadcn) |
| Landing CSS | Tailwind | v4 | Per ux-spec.md DESIGN.md |
| Landing fonts | Geist Sans + Geist Mono | latest | `next/font/google` |
| Deploy (landing) | Vercel | free tier | Default for Next 15 |
| Package registry | npm | public | `@defi-risk/mcp` scope |

## Transport + protocol

- **Transport:** stdio (default for Claude Desktop) — process is spawned by Claude Desktop, communicates via stdin/stdout JSON-RPC
- **Optional later:** Streamable HTTP transport for remote hosting (out of scope for hack)
- **No auth in v0** — local stdio only, no remote endpoint

## Tool surface (canonical)

Source of truth: `research/encode-defi-mini-hack/10-wedge-deep-dive-mcp.md` §3.

### Hard floor (5 tools — must ship)

| # | Tool | Inputs | Output shape |
|---|---|---|---|
| 1 | `get_position_risk` | `{chain, protocol, position_id}` | `{summary: string, dimensions: {audit, oracle, exploit, composability, mev, slippage}, sources: string[]}` |
| 2 | `simulate_tx_risk` | `{chain, unsigned_tx_hex}` | `{summary, mev_risk, slippage_pct, counterparty, oracle_deps, portfolio_after}` |
| 4 | `explain_protocol_risk` | `{protocol_name}` | `{summary, audits, exploit_history, oracle_deps, composability_tree, recent_governance}` |
| 7 | `get_recent_exploits` | `{time_window_days, chain?}` | `{exploits: Array<{date, protocol, amount_usd, source_url, summary}>}` |
| 8 | `discover_yields_by_intent` | `{intent: string}` (natural language) | `{candidates: Array<{protocol, apy, real_yield, risk_score, why_recommended}>}` |

### Stretch (2 more tools — Day 2 if time)

| # | Tool | Notes |
|---|---|---|
| 3 | `find_safer_alternatives` | Wraps tools 1+8 |
| 6 | `check_oracle_dependencies` | Standalone oracle grapher |

### Cut (do not build in 3 days)

- Tool 5 (`read_audit_report`) — folded into tool 4
- Tool 9 (`score_token_emission_quality`) — explicit out-of-scope per PRD
- Tool 10 (`explain_governance_proposal`) — explicit out-of-scope per PRD

## Key libraries (use these, do not reinvent)

| Need | Use | Why |
|---|---|---|
| EVM RPC | `viem` | Modern, typed, smaller than ethers |
| ABI fetch | Etherscan v2 API (free) | One key for 60+ chains |
| Tx simulation | Tenderly Simulation API | Free tier 100/day; covers MEV, balance changes |
| Protocol metadata + TVL | DefiLlama API | No key, generous limits |
| Yield candidates | DefiLlama Yields API | Same |
| Audit data | Code4rena public reports + Spearbit GitHub | Public markdown/PDF, scrape-able |
| Exploit feed | Rekt News RSS + BlockSec public alerts (RSS/X) | RSS = trivial parse |
| Discovery layer | `@indexnetwork/sdk` (npm — verified) | Day 1: `npm view @indexnetwork/sdk` + read `.d.ts` to confirm exact API. Fallback: `@indexnetwork/cli` shell-out. See `research/encode-defi-mini-hack/12-tech-deep-dive.md` §3. |
| Twitter signal | sahil-x burner (already configured) | No paid API |
| LLM (for synthesis sub-prompts within tools) | Direct call to Claude API via `@anthropic-ai/sdk` (optional in v0) | Risk synthesis can be deterministic in v0; LLM only for explanation polish |

## ADRs

### ADR-001: TypeScript over Python
**Decision:** TypeScript.
**Context:** MCP SDK ships first-class TS; Claude Desktop integration tested mostly with TS examples; Node has best startup performance for stdio spawn.
**Consequence:** No Python-native libs (e.g., if Index Network only ships Python SDK, we'll either find the JS SDK or shell out via subprocess as last resort).

### ADR-002: stdio transport, no HTTP in v0
**Decision:** stdio only.
**Context:** Claude Desktop primary, no remote use case for hack. Streamable HTTP adds infra surface (TLS, sessions) we don't need.
**Consequence:** Must be `npx`-installable. Cursor/Cline also support stdio so this covers all primary clients.

### ADR-003: Read-only / simulation-only — no signing
**Decision:** No private key handling, no tx signing.
**Context:** MCP security spec emphasizes "treat all tool inputs as untrusted." A signing-capable MCP is a major attack surface (Tom's Hardware vuln cited in 2026-04 — 200K servers exposed). For hack: signing adds 2 days of safety work, zero judge value.
**Consequence:** `simulate_tx_risk` takes a raw unsigned tx hex; user signs in their own wallet. Never store/handle keys.

### ADR-004: Stateless, in-memory cache only
**Decision:** No Postgres, Redis, or any persistent store.
**Context:** 3-day timeline. Stateless tools = trivial deploy + zero state-bug surface.
**Consequence:** Repeated identical queries hit upstream APIs each time within a session (Claude Desktop spawns one MCP process per session — process lifetime cache OK).

### ADR-005: Free-tier APIs only
**Decision:** No paid keys.
**Context:** Hackathon timeline + post-hack open-source distribution requires zero-cost-of-use.
**Consequence:** Tenderly limits us to 100 simulations/day per IP — pre-cache demo prompts; document this constraint in README.

### ADR-006: Index Network as a tool, not core dep
**Decision:** Index Network participation is one tool (#8), not the foundation.
**Context:** Index Network in 2026 is a full-stack agent network for intent-matching (verified in `research/encode-defi-mini-hack/12-tech-deep-dive.md` §3) — not a thin RAG SDK. Exact `@indexnetwork/sdk` API surface needs Day 1 verification.
**Consequence:** Tool 8 has three integration paths in priority order:
  1. `@indexnetwork/sdk` if API fits (preferred)
  2. `@indexnetwork/cli` shell-out via `child_process` (fallback)
  3. Brave/Tavily/DefiLlama-only path (final fallback — keeps tool useful even if Index is unreachable)

## Repo structure (file tree)

```
defi-risk-mcp/
├── README.md                      # Hero + install + tool list (per PRD §README)
├── LICENSE                        # MIT
├── package.json                   # @defi-risk/mcp scope; "bin" wires npx
├── tsconfig.json
├── biome.json
├── vitest.config.ts
├── .env.example                   # Alchemy / Tenderly / Etherscan keys
├── src/
│   ├── index.ts                   # MCP server entrypoint, tool registration
│   ├── transport.ts               # stdio transport setup
│   ├── tools/
│   │   ├── getPositionRisk.ts
│   │   ├── simulateTxRisk.ts
│   │   ├── explainProtocolRisk.ts
│   │   ├── getRecentExploits.ts
│   │   └── discoverYieldsByIntent.ts
│   ├── lib/
│   │   ├── alchemy.ts             # RPC client
│   │   ├── tenderly.ts            # Simulation client
│   │   ├── defillama.ts           # Protocol + yields API
│   │   ├── code4rena.ts           # Audit report fetcher
│   │   ├── rekt.ts                # Exploit feed parser
│   │   ├── indexNetwork.ts        # Index SDK wrapper (with fallback)
│   │   └── synthesis.ts           # Risk-dimension scoring + plain-English explanation
│   ├── schemas/
│   │   ├── tools.ts               # Zod schemas for every tool
│   │   └── domain.ts              # RiskScore, Position, Exploit types
│   └── tests/
│       ├── tools.test.ts          # ≥15 behavioral test cases (per BDD)
│       ├── synthesis.test.ts
│       └── lib.test.ts
├── landing/                       # Next.js 15 landing page (separate workspace)
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx               # Single-scroll landing (per ux-spec.md)
│   │   └── globals.css
│   ├── components/
│   │   ├── InstallBlock.tsx
│   │   ├── ToolCard.tsx
│   │   └── CodeTab.tsx
│   ├── public/
│   │   └── og-image.png
│   ├── package.json
│   ├── next.config.ts
│   └── tailwind.config.ts
├── docs/
│   └── (this folder)
└── .github/
    └── workflows/
        ├── test.yml               # vitest on PR
        └── publish.yml            # npm publish on release tag
```

## Context7 library research rule

**Mandatory before coding from scratch.** For each external lib, run Context7 *before* implementing:

```
mcp__context7__resolve-library-id libraryName="<lib name>" query="<task>"
mcp__context7__query-docs libraryId="<id>" query="<specific task>"
```

**Already verified** (file `research/encode-defi-mini-hack/12-tech-deep-dive.md` §1):

| Library | Context7 ID | Confirmed for our usage |
|---|---|---|
| `@modelcontextprotocol/sdk` | `/websites/ts_sdk_modelcontextprotocol_io` | ✅ McpServer + StdioServerTransport + registerTool(zodInputSchema) |
| `viem` | `/wevm/viem` | ✅ parseTransaction, decodeFunctionData, simulateContract |
| `zod` | `/colinhacks/zod` (v4) | ✅ discriminatedUnion for tool error/success |
| `Next.js` | `/vercel/next.js` (v15.1.8+) | ✅ App Router, RSC, next/font/google for Geist |

**Still required Day 1** (open):
- `@indexnetwork/sdk` — exact API surface (no Context7 entry; use `npm view` + `.d.ts` inspection)
- Tenderly Simulation API request/response shape (use Firecrawl on docs.tenderly.co)

If Context7 has no entry for a library, fall back to Firecrawl on the official docs URL.

## Banned patterns (per playbook §14, ux-spec.md)

- **Mocked data in hot path.** Every tool must call real upstream API in production code. Mocks live in `*.test.ts` only.
- **Hardcoded "demo" responses** in tool implementations.
- **`any` type** in TypeScript (use `unknown` + Zod parse).
- **Try/catch swallowing errors** without rethrow or structured tool error response.
- **Console.log** in production code (use stderr for diagnostic — stdout is reserved for MCP JSON-RPC).
- **Default Inter font** (Geist only — see ux-spec.md).
- **Generic gradients** on landing page (banned in ux-spec.md DESIGN.md).
- **Mock avatars** (`ui-avatars.com`, `picsum.photos`).
- **Three identical cards** pattern on landing page.

## Security posture

- No private key handling (ADR-003)
- All tool inputs validated through Zod
- Rate limit per tool: max 10 upstream calls per single tool invocation
- Tenderly key never logged
- `.env` in `.gitignore`
- README explicitly documents "this MCP cannot sign transactions"

## Performance budget

| Metric | Target |
|---|---|
| Cold start (process spawn) | < 800ms |
| Tool latency (single upstream call) | < 2s p95 |
| Tool latency (multi-source synthesis) | < 6s p95 |
| Memory | < 150 MB resident |

If exceeded: add per-tool concurrency limits, parallel-fan-out upstream calls, simplify synthesis prompts.

## CI

- `test.yml` — runs `pnpm install --frozen-lockfile && pnpm test` on every PR
- `publish.yml` — runs `pnpm publish --access public` on tag push
- No deploy gate for landing — Vercel auto-deploys on `main` push to `landing/`

## Locked deployed addresses (per playbook §13)

**N/A** — this project deploys no smart contracts. Read/simulate only.

The README must explicitly state this so judges don't search for contracts that don't exist.
