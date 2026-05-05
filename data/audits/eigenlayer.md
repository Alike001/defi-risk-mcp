# eigenlayer

**Protocol:** EigenLayer (restaking)
**Type:** Ethereum restaking primitive
**TVL tier:** > $10B aggregate

## Audit history

- **Spearbit** — EigenLayer core review (2023, 2024).
  Source: https://github.com/spearbit/portfolio
- **Sigma Prime** — restaking + slasher review (2023).
- **Consensys Diligence** — operator + staker flow review (2024).
- **Code4rena** — community competition pre-mainnet (2024).

## Findings summary

Multiple medium-severity findings around withdrawal queue and slasher
authorization; remediated pre-mainnet. Codebase complexity is high — slasher,
operator delegation, AVS registration are all distinct subsystems.

## Exploit history

- No contract-level exploits to date.
- Material non-contract risks: AVSes (EigenDA, Lagrange, etc.) carry their
  own slashing surfaces that compound for restakers.

## Oracle dependencies

- Minimal direct oracle dependency on EigenLayer core. Each AVS may bring
  its own oracle requirements.

## Composability notes

- LRTs (ether.fi weETH, Renzo ezETH, Kelp rsETH, Puffer pufETH) wrap
  EigenLayer points + restaking. Risk cascades to LRT holders via slashing
  and operator-misbehavior conditions.

## Recent governance

- EIGEN token launched 2024. Slashing for AVSes was introduced through
  multiple staged releases.
