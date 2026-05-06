# Demo recording script — 90 seconds

Read this before pressing record. Time it. Do not improvise.

## Pre-recording checklist (5 min before record)

- [ ] Run `bash scripts/demo-prep.sh` to warm caches (Etherscan, DefiLlama, Code4rena lookups)
- [ ] Open Claude Code in a terminal that's already maximized
- [ ] Confirm `defi-risk` MCP is connected: type `/mcp` — `defi-risk` should show as ✔ connected with 6 tools
- [ ] Close Slack / browser tabs / anything that pings notifications
- [ ] Disable system notifications (Linux: GNOME → Settings → Notifications → Do Not Disturb)
- [ ] Clear terminal scrollback (Ctrl+L)
- [ ] Set terminal font ≥ 16pt for readability at 1080p
- [ ] Browser zoom 110% if showing the npm page or GitHub repo

## Timing budget — 90 seconds total

| Window | Time | What's on screen |
|---|---|---|
| 0:00 – 0:05 | 5s | Title slide or terminal banner: `defi-risk-mcp — DeFi risk in Claude Desktop` |
| 0:05 – 0:30 | 25s | Prompt #1 — Aave 10K USDC risk synthesis |
| 0:30 – 0:55 | 25s | Prompt #2 — yield discovery picks Pendle APXUSD |
| 0:55 – 1:20 | 25s | Prompt #3 — tx decode catches drain pattern |
| 1:20 – 1:30 | 10s | Outro: GitHub URL + npm install line + Encode attribution |

Each prompt is paste-ready below. Type the first one live so the audience sees the workflow; paste #2 and #3 to stay under the 25-second budget.

## Prompt #1 — Aave risk synthesis (25s)

Type live (slow, deliberate):

```
I'm thinking of supplying 10,000 USDC to Aave on Base. What are the risks?
```

Hit Enter. Claude calls `get_position_risk` + `explain_protocol_risk` + `get_recent_exploits` + `get_chain_info`. Response is ~45 lines and takes ~50s in real time, so **cut to a pre-rendered scroll** of the answer (use the saved `.github/hero-response.txt` content — already verified live in #5).

Show the section headers as you scroll: Protocol / Oracle / Chain / Asset / Position / Governance — let viewers see all 6 risk dimensions tick by.

## Prompt #2 — yield discovery (25s)

Paste:

```
I want a stablecoin yield over 8% APY with TVL above $50M. Sort by safety.
```

Calls `discover_yields_by_intent`. Output should surface Pendle APXUSD as a top pick (verified in #9).

Show the JSON-shaped result table: pool name, APY, TVL, chain, risk floor.

## Prompt #3 — tx-decode drain pattern (25s)

Paste:

```
Decode and simulate this transaction. Tell me if it looks safe to sign.

0x02f8b1018203e8843b9aca00850c46cb35008301f...truncated...
```

(Use the exact calldata blob from `.github/hero-response.txt` line ~30+ — the one that triggers the `recipient is burn-shaped` + `deadline already passed` detection.)

Calls `simulate_tx_risk`. Output flags drain pattern with the warning lines visible.

Land on the warning panel: red text, recipient flag, deadline flag.

## Outro slide (10s)

Static text on screen — record over a notepad or HTML page:

```
defi-risk-mcp
github.com/Alike001/defi-risk-mcp
npx -y -p @alike001/defi-risk-mcp defi-risk-mcp-install
Encode DeFi Mini Hack 2026
```

## Recording tools (Linux)

Pick whichever is easiest:

- **Loom desktop** (https://www.loom.com/desktop) — auto-uploads, gives shareable link in seconds. Free tier: 5 min limit (we need 90s, fine).
- **OBS Studio** (`sudo apt install obs-studio`) — most powerful, 1080p+ no problem. Steeper UI.
- **SimpleScreenRecorder** (`sudo apt install simplescreenrecorder`) — fastest setup, fewer options.
- **GNOME built-in** — Ctrl+Alt+Shift+R, no audio. Saves to `~/Videos`.

Recommended for speed: **Loom desktop**. Records, uploads, generates a public URL in one flow.

## Upload destination

- **YouTube** (unlisted) — best long-term URL, doesn't expire, embeddable thumbnail in markdown.
- **Loom** — fastest if using Loom desktop; auto-uploads.

Title: `defi-risk-mcp — DeFi risk in Claude Desktop`

Description (paste verbatim):

```
A Model Context Protocol server that gives Claude DeFi-grade risk awareness.
Synthesizes risk across audits, exploits, oracle dependencies, composability,
MEV, and slippage.

Repo: https://github.com/Alike001/defi-risk-mcp
Install: npx -y -p @alike001/defi-risk-mcp defi-risk-mcp-install

Built for Encode DeFi Mini Hack 2026.
https://www.encodeclub.com/programmes/defi-mini-hack
```

## Verification checklist (after upload)

- [ ] Duration 60-120s
- [ ] At least 1080p
- [ ] All 3 prompts visibly typed/pasted and answered
- [ ] Public URL opens without auth (test in incognito window)
- [ ] Title and description set correctly
- [ ] Linked from `README.md` (replace `_coming soon_` placeholder near the bottom of `## Demo`)
- [ ] Linked from `landing/app/page.tsx` (hero secondary CTA)
- [ ] Linked from Encode submission form (issue #14)

## If recording fails on Demo Day

This recording is the fallback. Submit it standalone if live demo crashes.
