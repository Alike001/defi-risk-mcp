# lido

**Protocol:** Lido (stETH liquid staking)
**Type:** Ethereum liquid staking
**TVL tier:** > $20B (largest LST)

## Audit history

- **Sigma Prime** — Lido core + oracle reviews (2020–2023).
- **Quantstamp** — Lido + Curve stETH/ETH pool review (2021).
- **MixBytes** — multiple Lido reviews including oracle, NodeOperatorsRegistry.
  Source: https://github.com/mixbytes/audits_public
- **Statemind** — V2 (staking router) review (2023).
- **OpenZeppelin** — V2 review (2023).

## Findings summary

Largest LST by TVL; dozens of audits across the years. Findings have been
disclosed and remediated incrementally. Remaining non-contract risks
(validator concentration, slashing) are protocol-design risks, not bugs.

## Exploit history

- No contract-level exploits.
- 2023 Curve re-entrancy bug on the stETH/ETH pool affected liquidity, not
  Lido's own contracts (Curve was the venue).

## Oracle dependencies

- Lido Oracle reports beacon-chain balance data on-chain through a quorum
  of node operators. This oracle quorum is itself a centralization vector.
- stETH price is a market price (Curve / Uniswap / Balancer) rather than a
  Chainlink oracle for most uses; downstream consumers should use Chainlink
  stETH/ETH where available.

## Composability notes

- Most-composed asset in DeFi. wstETH used as collateral in Aave, Morpho,
  Compound, Maker, Spark, every major lender on every major chain.

## Recent governance

- Snapshot + on-chain Aragon DAO. Validator-set diversification efforts via
  CSM (Community Staking Module) + DVT.
