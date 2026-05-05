# morpho

**Protocol:** Morpho (Blue + MetaMorpho vaults)
**Type:** Modular lending primitive
**TVL tier:** > $2B aggregate

## Audit history

- **Spearbit** — multiple reviews of Morpho Blue (2023–2024).
  Source: https://github.com/spearbit/portfolio
- **OpenZeppelin** — MetaMorpho vault review (2024).
  Source: https://blog.openzeppelin.com/metamorpho-audit
- **ChainSecurity** — Morpho Blue review (2024).
- **Code4rena Cantina-style** — public competitions on MetaMorpho.

## Findings summary

Several medium-severity findings around vault rebalancing flow timing and
liquidation incentive bands; resolved pre-deployment. Codebase intentionally
small (~600 LoC for Blue core) which reduces audit surface.

## Exploit history

- 2024-04: a frontend-side approval-phishing incident (not a contract bug)
  affected one user's pre-signed approval — protocol contracts unaffected.
- No contract-level exploits to date.

## Oracle dependencies

- Per-market oracle pluggable. Markets that opt for thin Uniswap v3 TWAPs
  inherit TWAP-manipulation risk; markets using Chainlink + redundancy are
  the lower-risk default.

## Composability notes

- MetaMorpho vaults aggregate Morpho Blue markets — risk inherits from
  underlying market selection. Vault curators (Gauntlet, Steakhouse, Block
  Analitica) control allocation.

## Recent governance

- MORPHO token launched 2024. DAO controls fee switch + vault allowlist.
