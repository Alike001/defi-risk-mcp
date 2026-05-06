#!/usr/bin/env bash
# check-banned-classes.sh
#
# Greps the source tree (and, if present, the .next build output) for
# DESIGN.md banned tokens (per ux-spec.md + 11-ui-mining.md §Banned).
#
# Runs as `prebuild` so a CI/Vercel build that introduces a banned
# token fails the deploy. Also safe to run standalone:
#   bash scripts/check-banned-classes.sh
set -euo pipefail

# Resolve repo dir = this script's parent's parent (landing/).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LANDING_DIR="$(dirname "$SCRIPT_DIR")"
cd "$LANDING_DIR"

RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RESET=$'\033[0m'

# Patterns banned per DESIGN.md.
# Each entry is "PATTERN|REASON".
BANNED=(
  'bg-gradient-to-|gradients banned per DESIGN.md (Bun uses none)'
  'from-purple-|purple gradient = AI slop default'
  'from-violet-|violet gradient = AI slop default'
  'from-pink-|pink gradient = AI slop default'
  'from-blue-.*to-cyan|blue->cyan gradient = AI slop default'
  'rounded-xl shadow-md|generic AI card pattern banned (use rounded-md border)'
  'backdrop-blur-md|anchor (Bun) does not use it'
  'text-gray-600|use text-[#A3A3A3] (DESIGN.md text-secondary)'
  'ui-avatars\.com|avatar generators banned (no users to fake)'
  'picsum\.photos|avatar generators banned'
  'randomuser\.me|avatar generators banned'
  'Lorem ipsum|placeholder copy banned'
  'John Doe|placeholder copy banned'
  'Jane Smith|placeholder copy banned'
  'user@example\.com|placeholder copy banned'
  'dark:[a-z]|dark: variants banned (we are dark-only — no toggle)'
  'recharts|chart libs banned on landing'
  'victory-|chart libs banned on landing'
)

# Paths to scan.
# - source = always exists
# - build  = optional (only when prebuild → build has produced .next/)
SCAN_DIRS=()
[ -d "app" ] && SCAN_DIRS+=("app")
[ -d "components" ] && SCAN_DIRS+=("components")
[ -d ".next/static" ] && SCAN_DIRS+=(".next/static")
[ -d ".next/server" ] && SCAN_DIRS+=(".next/server")

if [ "${#SCAN_DIRS[@]}" -eq 0 ]; then
  echo "${YELLOW}⚠ no source/build dirs found; nothing to scan${RESET}"
  exit 0
fi

echo "▶ scanning: ${SCAN_DIRS[*]}"

FAIL=0
for entry in "${BANNED[@]}"; do
  pattern="${entry%%|*}"
  reason="${entry#*|}"

  matches="$(grep -RInE "$pattern" "${SCAN_DIRS[@]}" \
    --include='*.ts' \
    --include='*.tsx' \
    --include='*.js' \
    --include='*.jsx' \
    --include='*.css' \
    --include='*.html' \
    --exclude-dir='node_modules' \
    --exclude='check-banned-classes.sh' \
    2>/dev/null || true)"

  # Filter false positives: skip matches in this script itself or in
  # comments that name the banned pattern intentionally.
  matches="$(printf '%s\n' "$matches" | grep -vE '(BANNED PATTERN — DOC ONLY|check-banned-classes\.sh)' || true)"

  if [ -n "$matches" ]; then
    echo "${RED}✗ banned: ${pattern}${RESET} — ${reason}"
    printf '%s\n' "$matches" | sed 's/^/    /'
    FAIL=1
  fi
done

if [ "$FAIL" -ne 0 ]; then
  echo "${RED}❌ banned-classes check FAILED${RESET}"
  exit 1
fi

echo "${GREEN}✅ banned-classes check passed${RESET}"
exit 0
