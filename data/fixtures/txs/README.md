# Tx fixtures

Raw EIP-1559 serialized transactions used by `simulateTxRisk` tests. These
are constructed deterministically with `viem.serializeTransaction` against
real mainnet protocol addresses + selectors so the decoder + ABI lookup paths
exercise realistic codepaths without hitting upstream APIs.

| File | What | Used by |
|---|---|---|
| `uniswap-v3-swap.hex` | `exactInputSingle` USDC→WETH on the SwapRouter02 (`0x68b3...Fc45`) for a 10,000 USDC notional. | Happy-path swap test (high MEV verdict expected). |
| `aave-v3-supply.hex`  | `supply(USDC, 5,000.00, ...)` on Aave V3 Pool (`0x8787...4fA4E2`). | Happy-path lending test (low MEV verdict expected). |
| `invalid.hex` | Garbage bytes — not valid hex, not a serialized tx. | Rejection test. |

These hexes are unsigned (no `r`/`s`/`v`); the tool MUST work on unsigned tx
hex per ADR-003 (no signing). `viem.parseTransaction` accepts both shapes.
