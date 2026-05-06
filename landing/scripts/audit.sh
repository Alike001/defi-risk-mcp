#!/usr/bin/env bash
# audit.sh — repeatable anti-slop visual audit capture
#
# Boots the landing dev server, captures two screenshots at 1440x900
# (anchor = bun.sh, current = http://localhost:3000), tears down the
# dev server. Output PNGs land in landing/.audit/.
#
# Usage:
#   bash scripts/audit.sh
#   ANCHOR_URL=https://bun.sh CURRENT_URL=https://defi-risk-mcp.vercel.app \
#     bash scripts/audit.sh --skip-dev  # use a pre-deployed URL instead
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LANDING_DIR="$(dirname "$SCRIPT_DIR")"
cd "$LANDING_DIR"

ANCHOR_URL="${ANCHOR_URL:-https://bun.sh}"
CURRENT_URL="${CURRENT_URL:-http://localhost:3000}"
SKIP_DEV=0
for arg in "$@"; do
  case "$arg" in
    --skip-dev) SKIP_DEV=1 ;;
  esac
done

DEV_PID=""
DEV_LOG="/tmp/landing-dev.log"

cleanup() {
  if [ -n "$DEV_PID" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    echo "▶ stopping dev server (pid=$DEV_PID)"
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [ "$SKIP_DEV" -eq 0 ]; then
  echo "▶ booting next dev (log: $DEV_LOG)"
  : > "$DEV_LOG"
  pnpm dev > "$DEV_LOG" 2>&1 &
  DEV_PID=$!
  # Wait for "Ready" marker (Next 15 prints "Ready in" or "✓ Ready").
  for i in $(seq 1 60); do
    if grep -q -E "Ready|Local:" "$DEV_LOG" 2>/dev/null; then
      echo "▶ dev server ready (after ${i}s)"
      break
    fi
    sleep 1
  done
  # Extra settle for first request.
  sleep 2

  # Detect the actual port Next bound to — if 3000 was busy, Next falls
  # back to 3001/3002 silently. Parse the "Local: http://..." line.
  DETECTED_URL="$(grep -oE 'Local:[^\n]*http://localhost:[0-9]+' "$DEV_LOG" | tail -1 | grep -oE 'http://localhost:[0-9]+' || true)"
  if [ -n "$DETECTED_URL" ]; then
    CURRENT_URL="$DETECTED_URL"
    echo "▶ detected dev URL: $CURRENT_URL"
  fi
fi

echo "▶ capture: anchor=$ANCHOR_URL  current=$CURRENT_URL"
ANCHOR_URL="$ANCHOR_URL" CURRENT_URL="$CURRENT_URL" \
  pnpm exec tsx scripts/capture-audit.ts

echo "▶ output:"
ls -lh .audit/

# Verify every PNG is under 500KB (story acceptance criterion).
FAIL=0
for f in .audit/*.png; do
  size=$(stat -c '%s' "$f")
  kb=$((size / 1024))
  if [ "$size" -gt 512000 ]; then
    echo "✗ $f is ${kb}KB (>500KB cap)"
    FAIL=1
  fi
done
if [ "$FAIL" -ne 0 ]; then
  echo "❌ size budget exceeded"
  exit 1
fi

echo "✅ audit capture complete"
