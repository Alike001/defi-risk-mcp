# ethena

**Protocol:** Ethena (USDe / sUSDe synthetic dollar)
**Type:** Delta-neutral synthetic dollar (perp-short backed)
**TVL tier:** > $3B aggregate

## Audit history

- **Pashov Audit Group** — multiple Ethena reviews (2023–2024).
- **Spearbit** — Ethena USDe core review (2024).
- **Quantstamp** — review of staking + reward distribution (2024).

## Findings summary

Multiple medium-severity findings filed against the staking + redemption
flow; resolved pre-mainnet. Off-chain components (perp position management,
custodian integrations) are NOT covered by these contract audits.

## Exploit history

- No contract-level exploits to date.
- Material non-contract risks: funding-rate inversion (USDe is short-perp
  backed), CEX counterparty risk (Binance/Bybit/Deribit hold collateral via
  off-exchange custody), de-peg under stressed funding conditions.

## Oracle dependencies

- USDe/USD price feed for downstream collateral integrations is being added
  to Chainlink and Redstone. PT-USDe markets in Pendle / Aave use protocol-
  specific oracle adapters that should be reviewed per integration.

## Composability notes

- Heavy integration with Pendle (PT-sUSDe, PT-USDe), Morpho, Aave, Uniswap.
  Cascading risk if USDe de-pegs.

## Recent governance

- ENA token launched 2024. Governance scope limited; protocol parameters
  managed by Ethena Labs multisig in v0–v1.
