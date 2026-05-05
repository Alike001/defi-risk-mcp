# story-scaffold-mcp-server

**Epic:** 1 — Core Tools
**Estimated coding time:** 1.5h
**Depends on:** none
**Status:** PENDING

---

## Goal

Stand up the TypeScript MCP server skeleton with stdio transport, Zod schemas, and a single placeholder tool. Every later tool story plugs into this scaffold.

## BDD acceptance criteria

```
Given a fresh clone of the repo
When `pnpm install && pnpm build` runs
Then exit code is 0
And `dist/index.js` exists and is executable

Given the built server
When `node dist/index.js` runs with stdin closed
Then the process emits a valid MCP `initialize` response within 800ms
And the response declares `serverInfo.name === "defi-risk-mcp"`

Given Claude Desktop config pointing at the local build
When Claude Desktop is restarted
Then the MCP server appears in Claude Desktop's MCP tool list with status "connected"
And at least 1 tool (the placeholder) is listed
```

## File modification map

- `package.json` — NEW — `@defi-risk/mcp` scope, `bin` field for npx, build/test scripts
- `tsconfig.json` — NEW — strict mode, ESM, target ES2022
- `biome.json` — NEW — default + 2-space indent
- `vitest.config.ts` — NEW — node environment, coverage on `src/**`
- `src/index.ts` — NEW — server bootstrap, registers placeholder tool, stdio transport connect
- `src/transport.ts` — NEW — `createStdioTransport()` helper
- `src/schemas/tools.ts` — NEW — exports Zod schemas (initially: placeholder schema)
- `src/tools/_placeholder.ts` — NEW — `health_check` tool returning `{ok: true}` for smoke testing
- `.env.example` — NEW — required keys (`ALCHEMY_KEY`, `TENDERLY_KEY`, `ETHERSCAN_KEY`)
- `.gitignore` — NEW — node_modules, dist, .env
- `README.md` — NEW — minimal placeholder (Epic 3 fills hero)
- `LICENSE` — NEW — MIT

## Shell verification

```bash
pnpm install --frozen-lockfile
pnpm build
test -x dist/index.js && echo "OK: build artifact present"
node -e "require('./dist/index.js')" 2>/dev/null || echo "FAIL: cannot require"
# Smoke test via mcp-inspector or manual stdin:
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' | node dist/index.js | head -c 500
```

## Out of scope

- Real DeFi tools (later stories)
- Landing page (Epic 3)
- npm publish workflow (Epic 3)

## Notes

- Use Context7 to confirm `@modelcontextprotocol/sdk` v2 API surface BEFORE coding (per `architecture.md` §Context7 rule).
- Keep `index.ts` under 80 lines — it should be just registration + transport wiring.
