#!/usr/bin/env bash
# scripts/demo-prep.sh
# Pre-warm the API caches the demo will hit so nothing waits on the network
# during the recording. Safe to re-run.

set -euo pipefail

cd "$(dirname "$0")/.."

YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

say() { printf "${YELLOW}→${NC} %s\n" "$*"; }
ok()  { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn(){ printf "${RED}!${NC} %s\n" "$*"; }

if [[ ! -f .env ]]; then
  warn "no .env found — server will degrade for missing keys, demo still works"
else
  set -a; . .env; set +a
fi

say "warming DefiLlama yields (free, no key)"
curl -fsS "https://yields.llama.fi/pools" -o /tmp/defi-risk-demo-yields.json && \
  ok "DefiLlama yields cached ($(wc -c < /tmp/defi-risk-demo-yields.json) bytes)" || \
  warn "DefiLlama warmup failed (network?)"

say "warming Code4rena audit page (Aave v3)"
curl -fsS -A 'demo-prep/0.1' \
  "https://code4rena.com/audits/2022-12-aave-v3-additional-audit" \
  -o /tmp/defi-risk-demo-c4-aave.html 2>/dev/null && \
  ok "Code4rena Aave audit cached" || \
  warn "Code4rena warmup failed (rate-limited or layout changed — non-blocking)"

say "warming Aave Snapshot space"
curl -fsS "https://hub.snapshot.org/graphql" \
  -H 'content-type: application/json' \
  -d '{"query":"{ proposals(first:5, where:{space_in:[\"aavedao.eth\"]}, orderBy:\"created\", orderDirection:desc){ id title state created } }"}' \
  -o /tmp/defi-risk-demo-snapshot.json && \
  ok "Snapshot aavedao.eth cached" || \
  warn "Snapshot warmup failed"

if [[ -n "${ETHERSCAN_API_KEY:-}" ]]; then
  say "warming Etherscan (Aave Pool address on Base)"
  curl -fsS "https://api.basescan.org/api?module=contract&action=getsourcecode&address=0xA238Dd80C259a72e81d7e4664a9801593F98d1c5&apikey=${ETHERSCAN_API_KEY}" \
    -o /tmp/defi-risk-demo-etherscan.json && \
    ok "Etherscan Base cached" || \
    warn "Etherscan warmup failed"
else
  warn "ETHERSCAN_API_KEY not set — skipping Etherscan warmup"
fi

if [[ -n "${ALCHEMY_API_KEY:-}" ]]; then
  say "warming Alchemy (Base latest block)"
  curl -fsS -X POST "https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}" \
    -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    -o /tmp/defi-risk-demo-alchemy.json && \
    ok "Alchemy Base cached" || \
    warn "Alchemy warmup failed"
else
  warn "ALCHEMY_API_KEY not set — skipping Alchemy warmup"
fi

ok "warmup complete — record within 60s for best cache hit rate"
