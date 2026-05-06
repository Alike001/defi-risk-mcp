#!/usr/bin/env bash
# verify-claude-desktop.sh
#
# Story: story-claude-desktop-integration (#5).
#
# Semi-automated checker that:
#   1. Detects host OS (macOS / Linux / Windows-via-WSL).
#   2. Locates `claude_desktop_config.json` for the current user.
#   3. Validates that the file is parseable JSON (jq if available, else node).
#   4. Confirms `mcpServers["defi-risk"]` exists with `command` + `args`.
#   5. (Best effort) Greps Claude Desktop's per-server log for a connected /
#      ready signal. Skipped on Linux because Claude Desktop is Mac/Win only.
#
# Exits 0 on success; non-zero with an actionable message otherwise.
#
# Final verification — that the tool is actually callable inside a live
# Claude Desktop session — is the user's manual prompt-1 step (see
# docs/INSTALL.md §5). This script cannot drive the GUI.

set -euo pipefail

SERVER_NAME="defi-risk"

log()  { printf '[verify-claude-desktop] %s\n' "$*"; }
fail() { printf '[verify-claude-desktop] FAIL: %s\n' "$*" >&2; exit 1; }
ok()   { printf '[verify-claude-desktop] OK:   %s\n' "$*"; }
note() { printf '[verify-claude-desktop] note: %s\n' "$*"; }

# ----- 1. detect host OS -----
detect_os() {
  local uname_s
  uname_s="$(uname -s 2>/dev/null || echo unknown)"
  case "$uname_s" in
    Darwin) echo macos ;;
    Linux)
      if grep -qiE '(microsoft|wsl)' /proc/version 2>/dev/null; then
        echo wsl
      else
        echo linux
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*) echo windows ;;
    *) echo unknown ;;
  esac
}

OS="$(detect_os)"
log "detected os: ${OS}"

# ----- 2. resolve config + log paths -----
config_path=""
log_path=""

case "$OS" in
  macos)
    config_path="${HOME}/Library/Application Support/Claude/claude_desktop_config.json"
    log_path="${HOME}/Library/Logs/Claude/mcp-server-${SERVER_NAME}.log"
    ;;
  windows)
    if [ -n "${APPDATA:-}" ]; then
      config_path="${APPDATA}/Claude/claude_desktop_config.json"
      log_path="${APPDATA}/Claude/logs/mcp-server-${SERVER_NAME}.log"
    fi
    ;;
  wsl)
    # On WSL, Claude Desktop runs under Windows. Try to bridge via $USERPROFILE.
    if command -v wslpath >/dev/null 2>&1 && [ -n "${USERPROFILE:-}" ]; then
      win_appdata="$(wslpath "${APPDATA:-${USERPROFILE}/AppData/Roaming}" 2>/dev/null || true)"
      if [ -n "$win_appdata" ]; then
        config_path="${win_appdata}/Claude/claude_desktop_config.json"
        log_path="${win_appdata}/Claude/logs/mcp-server-${SERVER_NAME}.log"
      fi
    fi
    ;;
  linux)
    note "Claude Desktop does not officially support Linux."
    note "Use Cursor (~/.cursor/mcp.json) or Cline (~/.config/Code/...) instead."
    note "The shape check below still works for Cursor/Cline configs if you pass --config <path>."
    ;;
esac

# CLI override: --config <path>
if [ "${1:-}" = "--config" ] && [ -n "${2:-}" ]; then
  config_path="$2"
  shift 2
  note "using --config override: ${config_path}"
fi

if [ -z "$config_path" ]; then
  fail "could not infer config path for os=${OS}. Re-run with --config <path>."
fi

# ----- 3. greenfield vs existing -----
if [ ! -f "$config_path" ]; then
  fail "config file not found: ${config_path}
  Greenfield install? Create the file using the snippet in docs/INSTALL.md §2,
  then re-run this script. The directory may also need to be created first."
fi

ok "config file present: ${config_path}"

# ----- 4. validate JSON shape -----
validate_with_jq() {
  jq -e --arg name "$SERVER_NAME" '
    (.mcpServers | type == "object")
    and (.mcpServers[$name] | type == "object")
    and (.mcpServers[$name].command | type == "string")
    and (.mcpServers[$name].args | type == "array")
    and (.mcpServers[$name].args | length >= 1)
  ' "$config_path" >/dev/null
}

validate_with_node() {
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    const entry = (cfg.mcpServers || {})['$SERVER_NAME'];
    if (!entry) { console.error('missing mcpServers.$SERVER_NAME'); process.exit(2); }
    if (typeof entry.command !== 'string' || !entry.command.length) {
      console.error('command is not a non-empty string'); process.exit(3);
    }
    if (!Array.isArray(entry.args) || entry.args.length < 1) {
      console.error('args is not a non-empty array'); process.exit(4);
    }
    for (const a of entry.args) {
      if (typeof a !== 'string') { console.error('args contains non-string'); process.exit(5); }
    }
  " "$config_path"
}

if command -v jq >/dev/null 2>&1; then
  if ! validate_with_jq; then
    fail "config file at ${config_path} is missing a valid mcpServers[\"${SERVER_NAME}\"]
  entry. Expected shape:
    { \"mcpServers\": { \"${SERVER_NAME}\": { \"command\": \"...\", \"args\": [\"...\"] } } }"
  fi
elif command -v node >/dev/null 2>&1; then
  if ! validate_with_node 2>/tmp/verify-claude-desktop.err; then
    cat /tmp/verify-claude-desktop.err >&2
    fail "config validation failed (node fallback). See the line above."
  fi
else
  fail "neither \`jq\` nor \`node\` is on PATH; install one and re-run."
fi

ok "config shape valid: mcpServers[\"${SERVER_NAME}\"] has command + args"

# ----- 5. (best effort) grep log for connected/ready -----
if [ "$OS" = "linux" ]; then
  note "skipping log check on linux (no Claude Desktop log file expected)."
  note "manual user step: open Claude Desktop on Mac/Win, send prompt 1 from"
  note "                  docs/INSTALL.md §5 — that is the only way to confirm"
  note "                  the tool is actually callable end-to-end."
  ok "static checks passed."
  exit 0
fi

if [ -z "$log_path" ] || [ ! -f "$log_path" ]; then
  note "log file not found at ${log_path:-<unknown>}."
  note "expected after first Claude Desktop launch with this MCP enabled."
  note "manual user step: launch Claude Desktop, then re-run this script."
  ok "config-shape checks passed (log check deferred)."
  exit 0
fi

# Look for either of the canonical connected/ready strings:
#   - "ready (stdio)" — emitted by this server's main()
#   - "Server transport closed" / "Connected to" — emitted by Claude Desktop itself
if grep -q -E 'ready \(stdio\)|connected|Connected' "$log_path"; then
  ok "log shows server connected / ready: ${log_path}"
else
  fail "log file ${log_path} exists but does not contain a connected/ready line.
  Open Claude Desktop, fully restart it (Cmd/Ctrl-Q), and re-run.
  Also tail the log for clues:  tail -n 50 \"${log_path}\""
fi

ok "all automated checks passed."
note "final step is manual: send prompt 1 from docs/INSTALL.md §5 to confirm"
note "the tool is actually callable inside a live Claude Desktop session."
