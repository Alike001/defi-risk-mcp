# Installing `defi-risk-mcp` in Claude Desktop, Cursor, or Cline

`defi-risk-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io)
server. It speaks JSON-RPC over stdio, so any MCP-compliant client — Claude
Desktop, Cursor, Cline, Continue, or your own — can spawn it and call its
tools. This guide covers Claude Desktop first (primary target) and notes the
deltas for Cursor and Cline.

> **Why no signing?** Per [ADR-003](../research/encode-defi-mini-hack/docs/architecture.md#adr-003-read-only--simulation-only--no-signing)
> this MCP is read-only and simulation-only. It never asks for a private key,
> never broadcasts a transaction, and never holds funds. You always sign in
> your own wallet.

---

## 1. Prerequisites

| Requirement | Why |
|---|---|
| Node.js **20 LTS or newer** | The MCP SDK ships ESM; Claude Desktop spawns `node`. |
| **Claude Desktop** (macOS or Windows) | The primary client. Linux is not supported by Claude Desktop today, so use Cursor or Cline on Linux. |
| `git` and `pnpm` (manual install only) | Required for the clone-and-build path. |
| **Free-tier API keys** (optional but recommended) | The 3 shipped tools degrade gracefully without them, but a few features need: `ALCHEMY_API_KEY` (read RPC), `ETHERSCAN_API_KEY` (ABI fetch). Tenderly + Index + Brave keys are only needed for tools that explicitly use them. |

Tools that need credentials but don't have them return a structured
`missing_credentials` error rather than crashing — so you can install with
zero keys and the server will still come up "connected" in Claude Desktop.

---

## 2. Quick install (npx — recommended for end users)

This pattern requires no clone. Claude Desktop will fetch the package on first
launch and cache it.

1. **Locate your Claude Desktop config file.** Create it if it does not exist:

   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

2. **Paste this block** (merge with any existing `mcpServers` you have):

   ```json
   {
     "mcpServers": {
       "defi-risk": {
         "command": "npx",
         "args": ["-y", "-p", "@alike001/defi-risk-mcp", "defi-risk-mcp"],
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

3. Fill in any keys you have. Leave the rest as empty strings.

4. **Fully quit and restart Claude Desktop** (Cmd/Ctrl-Q — closing the window
   is not enough; the helper process must restart).

---

## 3. Manual install (clone + build — recommended for contributors)

```bash
git clone https://github.com/Alike001/defi-risk-mcp.git
cd defi-risk-mcp
pnpm install
pnpm run build          # writes dist/index.js
cp .env.example .env    # then fill in the keys you have
```

Then point Claude Desktop at the local build by pasting this into the same
config file as above (replace `ABSOLUTE_PATH_TO_REPO`):

```json
{
  "mcpServers": {
    "defi-risk": {
      "command": "node",
      "args": ["ABSOLUTE_PATH_TO_REPO/dist/index.js"],
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

A copy-pasteable starting point also lives at the repo root:
[`claude-desktop-config-example.json`](../claude-desktop-config-example.json).

Then quit and restart Claude Desktop fully.

---

## 4. Config file paths (other clients)

| Client | OS | Config path |
|---|---|---|
| Claude Desktop | macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop | Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Cursor | macOS / Windows / Linux | `~/.cursor/mcp.json` (per-user) or `<workspace>/.cursor/mcp.json` (per-project) |
| Cline (VS Code extension) | macOS | `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| Cline (VS Code extension) | Windows | `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json` |
| Cline (VS Code extension) | Linux | `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |

The JSON shape is the same for all three: a top-level `mcpServers` map keyed
by server name. Cursor and Cline both spawn the server process the same way
Claude Desktop does, so the same config block above works in all three.

---

## 5. Verify the install with these prompts

After restarting your client, open a new chat and try the prompts below.
The first three are the canonical demo prompts from the
[PRD §Demo moment](../research/encode-defi-mini-hack/docs/PRD.md#demo-moment-90-second-judge-walkthrough).
The last two are simpler smoke tests.

1. **Risk synthesis (PRD demo #1)**
   > I'm thinking of supplying 10,000 USDC to Aave on Base. What are the risks?

   Expected: Claude calls `get_position_risk` and/or `explain_protocol_risk`,
   names Aave explicitly, and lists ≥ 2 risk dimensions (e.g. oracle, audit,
   exploit, composability). Round-trip < 30 s.

2. **Intent-based discovery (PRD demo #2)**
   > Find me a yield play with > 8 % real yield on Base, no rebase tokens,
   > audited within last 12 months.

   Expected: Claude calls `discover_yields_by_intent` (Epic-2 stretch tool;
   may return `not_implemented` until that story ships) and explains its
   ranking. Shipped tools fall back to a usable answer.

3. **Tx pre-flight (PRD demo #3 — "kill shot")**
   > I'm about to sign this — what's wrong with it?
   > 0xf86c0a8502540be400825208944592d8f8d7b001e72cb26a73e4fa1806a51ac79d880de0b6b3a76400008025…

   Expected: Claude calls `simulate_tx_risk`, surfaces MEV exposure / slippage
   / counterparty issues, and (when warranted) recommends Flashbots Protect.

4. **Smoke prompt — protocol explainer**
   > Tell me what `lido` is and what its main risks are.

   Expected: Claude calls `explain_protocol_risk`. Response cites audits and
   oracle dependencies for Lido.

5. **Smoke prompt — connectivity check**
   > List every tool the `defi-risk` server exposes.

   Expected: Claude lists the tools registered by this MCP. With Epic 1
   shipped that includes `health_check`, `get_position_risk`,
   `simulate_tx_risk`, and `explain_protocol_risk`. More are added by Epic 2.

---

## 6. Troubleshooting

### Where are the logs?

Claude Desktop writes per-MCP-server log files. The MCP server's stderr is
captured here (we never log to stdout — that channel carries JSON-RPC).

- **macOS**: `~/Library/Logs/Claude/mcp-server-defi-risk.log`
- **Windows**: `%APPDATA%\Claude\logs\mcp-server-defi-risk.log`

A successful start prints:

```
defi-risk-mcp v0.1.0 ready (stdio)
```

### "MCP server defi-risk failed to start"

1. Confirm Node 20+ is on `PATH` for the user that launched Claude Desktop:
   `node --version` from the same shell.
2. For the **manual install** path, confirm `dist/index.js` exists and is
   executable: `ls -l dist/index.js`. Re-run `pnpm run build` if not.
3. For the **npx** path, confirm `npx -y -p @alike001/defi-risk-mcp defi-risk-mcp`
   runs and prints `defi-risk-mcp v0.1.0 ready (stdio)` to stderr before you
   send EOF.
4. Run `scripts/verify-claude-desktop.sh` from a terminal — it locates the
   config file, validates JSON shape, and (when run on the same machine as
   Claude Desktop) greps the log file for a "connected" status.

### "missing_credentials" returned by a tool

The server starts and registers tools even when API keys are absent, so the
client still shows the server as "connected". Tools that need a key surface a
structured error of the form `{ status: "error", code: "missing_credentials",
message: "..." }`. Add the missing key to the `env` block in
`claude_desktop_config.json` and fully restart Claude Desktop.

### The server appears connected, but a tool times out

Claude Desktop's stdio framing is sensitive to anything written to stdout.
This MCP routes every diagnostic to stderr; if you patch the code, keep that
invariant — `console.log` is banned in `src/` for this reason. Re-run
`pnpm run lint` and `pnpm test` if you're not sure.

### Verify everything in one shot

```bash
bash scripts/verify-claude-desktop.sh
```

Exits 0 if the config file exists, parses, contains a `defi-risk` server
entry, and (when a log file is reachable) shows a "connected" / "ready" line.
Exits non-zero with an actionable message otherwise.

> Final verification — _"the tool is actually callable from Claude Desktop"_
> — requires the manual prompt-1 step in §5.1. The shell script cannot run
> Claude Desktop on your behalf.
