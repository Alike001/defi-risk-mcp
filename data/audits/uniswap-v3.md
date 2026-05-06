# uniswap-v3

**Protocol:** Uniswap v3
**Type:** Concentrated-liquidity AMM
**TVL tier:** > $5B aggregate across deployments

## Audit history

- **Trail of Bits** — Uniswap v3 core review (2021).
  Source: https://github.com/Uniswap/v3-core/blob/main/audits/tob/audit.pdf
- **ABDK Consulting** — math review of tick + sqrtPriceX96 logic (2021).
- **Samczsun (independent)** — pre-launch invariant review (2021).
- **Code4rena** — community audit (2021).
  Source: https://code4rena.com/reports/2021-10-uniswap-v3

## Findings summary

The v3 core has held up since 2021 with no critical exploits disclosed. Several
medium-severity findings around fee growth accounting were addressed pre-launch.

## Exploit history

- No exploits of the v3 core contracts.
- Periphery (Universal Router, Permit2) had findings disclosed and patched
  pre-deployment.

## Oracle dependencies

- v3 ships its own time-weighted average price (TWAP) oracle. Pools with
  thin liquidity expose downstream consumers to manipulation risk — this is
  a frequent root cause in protocols that use v3 TWAPs without filtering.

## Composability notes

- Extreme composability — Universal Router, Permit2, every aggregator
  (1inch, 0x, Paraswap, Cowswap) routes through v3.

## Recent governance

- Uniswap v4 launched 2025 with hooks; v3 remains the dominant deployment.
