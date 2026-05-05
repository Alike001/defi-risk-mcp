# aave-v3

**Protocol:** Aave v3
**Type:** Lending market
**TVL tier:** > $10B aggregate across deployments

## Audit history

- **OpenZeppelin** — Aave v3 core review (2022) covering pool, configurator, ACL.
  Source: https://blog.openzeppelin.com/aave-v3-audit
- **Trail of Bits** — pre-deployment review (2022), focus on liquidation logic.
  Source: https://github.com/trailofbits/publications
- **Certora** — formal verification of pool accounting invariants (ongoing).
  Source: https://www.certora.com/reports
- **SigmaPrime** — review of v3.1 GHO + risk parameters (2023).
- **Code4rena** — community audit competition for v3 (2022).
  Source: https://code4rena.com/reports/2022-08-aave

## Findings summary

Multiple high/medium-severity findings were filed during the v3 launch audits, all
disclosed and remediated before deployment. No critical findings have been
disclosed against Aave v3 core post-launch as of the cache date.

## Exploit history

- 2022-11: Aave v2 (legacy, not v3) was used as the venue for the Mango-style
  CRV short attack against Avraham Eisenberg — protocol contracts were not
  exploited; the loss was a bad-debt event from an oracle-priced asset that
  Aave subsequently froze.
- v3 has had no contract-level exploits to date.

## Oracle dependencies

- Chainlink price feeds for primary collateral assets.
- Per-asset price-feed redundancy is configured in the AaveOracle contract.

## Composability notes

- Heavily composed: GHO mints from Aave v3 collateral, multiple aggregators
  (1inch, Paraswap) route through Aave flashloans, Yearn / Morpho-Aave wrap
  Aave positions.

## Recent governance

- AIPs for parameter tuning (LTV, liquidation thresholds, e-mode caps) ship
  monthly. RWA / GHO expansion in 2024–2025.
