# pendle

**Protocol:** Pendle (PT/YT yield-tokenization + AMM)
**Type:** Yield-stripping + maturity-AMM
**TVL tier:** > $4B aggregate

## Audit history

- **Ackee Blockchain** — Pendle V2 review (2023).
  Source: https://github.com/AckeeBlockchain/audits
- **Spearbit** — Pendle V2 + LP review (2023).
- **Code4rena** — community competition on Pendle V2.
  Source: https://code4rena.com/reports/2023-06-pendle

## Findings summary

Several medium-severity findings around PT/YT redemption timing and the
TWAP oracle for SY/PT pools; resolved pre-deployment.

## Exploit history

- 2024-06: Penpie (a yield aggregator built on Pendle, NOT Pendle itself)
  was exploited for ~$27M. Pendle contracts were not at fault — the bug was
  in Penpie's reward-streaming logic. Confirmed by Pendle team.
- No exploits of Pendle's own contracts.

## Oracle dependencies

- Internal SY/PT TWAP for AMM pricing. Downstream consumers using Pendle PT
  prices inherit TWAP-manipulation risk in low-liquidity markets.

## Composability notes

- Heavily integrated with LRT/LST ecosystem — eETH, ezETH, weETH, swETH all
  ship Pendle markets. Aave / Morpho list PT as collateral with custom
  oracle adapters.

## Recent governance

- vePENDLE governance, fee switches, multi-chain expansion (Arbitrum, Optimism,
  BNB, Mantle, Base).
