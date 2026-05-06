# curve

**Protocol:** Curve Finance (StableSwap + crvUSD + tricrypto)
**Type:** Stable + correlated-asset AMM
**TVL tier:** > $1.5B aggregate

## Audit history

- **MixBytes** — multiple Curve reviews (2020–2023).
  Source: https://github.com/mixbytes/audits_public/tree/master/Curve
- **Trail of Bits** — crvUSD review (2023).
- **ChainSecurity** — tricrypto reviews.

## Findings summary

Long audit history. The Vyper compiler bug exploited in 2023 (see Exploit
History) was not flagged by any of the contract-level audits — root cause
was a compiler-level reentrancy lock bug in specific Vyper versions.

## Exploit history

- 2023-07-30: ~$73M drained from CRV/ETH, alETH/ETH, msETH/ETH and pETH/ETH
  pools due to a Vyper 0.2.15/0.2.16 reentrancy-lock compiler bug. Curve
  contracts themselves were correctly written; the compiler emitted broken
  bytecode. Partial recovery via white-hat negotiations.
  Source: https://rekt.news/curve-vyper-rekt/

## Oracle dependencies

- Internal EMA oracles for crvUSD and tricrypto pricing.

## Composability notes

- Most stablecoin liquidity routes through Curve. crvUSD lending (LLAMMA)
  is composed into yearn, conic, fxs ecosystems.

## Recent governance

- veCRV / vote-escrow + bribe markets (Convex, Votium). DAO controls gauge
  weights and crvUSD parameters.
