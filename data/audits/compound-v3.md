# compound-v3

**Protocol:** Compound v3 (Comet)
**Type:** Lending market (single borrowable asset per deployment)
**TVL tier:** > $1B aggregate

## Audit history

- **OpenZeppelin** — Compound v3 review (2022).
  Source: https://blog.openzeppelin.com/compound-iii-audit/
- **ChainSecurity** — Comet contract review (2022).
  Source: https://chainsecurity.com/security-audit/compound-iii/
- **Code4rena** — community competition (2022, $200K pool).
  Source: https://code4rena.com/reports/2022-08-compound

## Findings summary

Multiple medium-severity findings around interest-rate accumulation and
liquidation incentive math; all disclosed and addressed pre-launch.

## Exploit history

- 2021 (v2, not v3): COMP distribution bug accidentally over-distributed
  ~$80M of COMP. Not a v3 issue.
- v3 has had no contract-level exploits to date.

## Oracle dependencies

- Chainlink price feeds. v3 introduces a fixed price feed contract per asset
  configured at deployment.

## Composability notes

- Less composed than Aave v3. Single-borrow-asset design limits flashloan
  surface but also limits aggregator integration.

## Recent governance

- COMP migrated to Compound III incentives. Multi-chain deployments to Base,
  Arbitrum, Polygon, Optimism added through 2023–2024.
