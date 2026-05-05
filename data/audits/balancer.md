# balancer

**Protocol:** Balancer v2 / v3
**Type:** Generalized AMM (weighted, stable, boosted, composable-stable)
**TVL tier:** > $700M aggregate

## Audit history

- **Trail of Bits** — Balancer v2 vault + pools review (2021).
- **Certora** — formal verification of vault accounting (2021–2023).
- **OpenZeppelin** — composable-stable + boosted-pool reviews (2022–2023).
- **ABDK** — math review of stable-math invariants (2022).

## Findings summary

Multiple medium-severity findings against boosted-pool linear pools resolved
2022–2023. Composable stable pools introduced new griefing surfaces around
BPT-as-collateral.

## Exploit history

- 2023-08: ~$2.1M drained from boosted pools after Balancer disclosed a
  vulnerability and asked LPs to withdraw; some LPs missed the window.
  Balancer team mitigated further loss by killing affected pools.
  Source: https://rekt.news/balancer-rekt-3/
- 2020-06: ~$500K drained from STA/STONK pools due to deflationary-token
  edge case.

## Oracle dependencies

- Per-pool oracle (weighted pools expose price oracles via timestamped
  cumulative invariant). Downstream consumers using these oracles inherit
  the same TWAP-manipulation risk as Uniswap v3 TWAPs.

## Composability notes

- Boosted pools route idle liquidity to Aave for yield — adds a second-order
  dependency on Aave + the underlying boosted token.

## Recent governance

- veBAL governance (80/20 BAL/WETH lock). DAO controls gauge weights, fees.
