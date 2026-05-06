/**
 * Apply parsed `IntentConstraints` to a candidate set of `YieldPool`s.
 *
 * Filters are conjunctive — a pool must pass every set constraint to make
 * it through. Unset constraints (null / false) are no-ops.
 *
 * Constraints honored (matches `lib/intentParser.ts` keyword set):
 *   apy_min .................... pool.apy >= apy_min  (or pool.apyBase if real_yield_only)
 *   chain ...................... pool.chain.toLowerCase() === chain
 *   asset_symbol ............... pool.symbol contains asset (case-insensitive)
 *   audited_required ........... pool.project in AUDITED_PROJECTS allow-list
 *                                (curated from the same audit cache used by
 *                                 explain_protocol_risk; pools whose project
 *                                 we cannot vouch for are dropped when this
 *                                 flag is set — never silently included).
 *   no_rebase .................. drops STETH and other known rebase tokens
 *   stable_only ................ pool.stablecoin === true
 *   real_yield_only ............ pool.apyBase != null AND apyBase > 0 AND
 *                                inflationary share <= 50%
 *
 * The `audited_required` allow-list is the conservative move per the F4
 * honesty rule: if we don't have audit evidence for a project, we drop
 * rather than include-with-an-asterisk. The list is exported so the test
 * suite can assert the bound.
 *
 * `audit_max_age_months` cannot be enforced from DefiLlama metadata alone —
 * the audit-cache markdown encodes per-firm dates but there is no per-pool
 * link. We honor the constraint by tightening the allow-list at request
 * time (currently a no-op past the AUDITED_PROJECTS gate; future stories
 * may swap in a per-protocol freshness check).
 */

import type { IntentConstraints } from '../schemas/domain.js';
import type { YieldPool } from './defillama.js';
import { classifyRealYield } from './realYield.js';

/**
 * DefiLlama project slugs we have audit evidence for.
 *
 * Curated from `data/audits/` plus the canonical Code4rena / OpenZeppelin /
 * Trail of Bits report indexes. Lower-cased to match DefiLlama's `.project`.
 *
 * Conservative bias: when in doubt, NOT in the list. Better to filter out a
 * legitimate pool than to falsely vouch for an unaudited one.
 */
export const AUDITED_PROJECTS: ReadonlySet<string> = new Set([
  'aave-v3',
  'aave-v2',
  'compound-v3',
  'compound-v2',
  'compound',
  'morpho-blue',
  'morpho',
  'morpho-aave-v3',
  'morpho-aaveV3-eth-optimizer',
  'uniswap-v3',
  'uniswap-v2',
  'curve-dex',
  'curve',
  'lido',
  'rocket-pool',
  'pendle',
  'eigenlayer',
  'ether.fi-stake',
  'ether.fi-liquid',
  'kelp-dao',
  'renzo',
  'ethena-usde',
  'sky-lending',
  'spark',
  'maker-dsr',
  'sushiswap',
  'balancer-v2',
  'balancer-v3',
  'fluid-lending',
  'gearbox-passive-pool',
  'silo-finance',
  'across-v3',
]);

/** Known rebase-style symbols. Drop these when `no_rebase` is set. */
export const REBASE_SYMBOLS: ReadonlySet<string> = new Set([
  'STETH',
  'AETH',
  'AUSDC',
  'AUSDT',
  'ADAI',
  'CUSDC',
  'CUSDT',
  'CDAI',
  'OHM',
  'USDM',
]);

export interface FilterOptions {
  /**
   * Override the audited-projects allow-list. Tests use this to assert the
   * filter against a deterministic cohort.
   */
  auditedProjects?: ReadonlySet<string>;
}

/**
 * Apply the constraints. Returns the surviving pools, in the same order they
 * were passed in. Sorting by risk is the caller's responsibility (the tool
 * layer composes filter → score → sort).
 */
export function filterPools(
  pools: ReadonlyArray<YieldPool>,
  constraints: IntentConstraints,
  options: FilterOptions = {},
): YieldPool[] {
  const audited = options.auditedProjects ?? AUDITED_PROJECTS;
  return pools.filter((pool) => passes(pool, constraints, audited));
}

function passes(pool: YieldPool, c: IntentConstraints, audited: ReadonlySet<string>): boolean {
  // chain ---------------------------------------------------------------------
  if (c.chain) {
    if (pool.chain.toLowerCase() !== c.chain.toLowerCase()) return false;
  }

  // asset symbol --------------------------------------------------------------
  if (c.asset_symbol) {
    const sym = pool.symbol.toUpperCase();
    if (!sym.includes(c.asset_symbol.toUpperCase())) return false;
  }

  // stablecoin ----------------------------------------------------------------
  if (c.stable_only) {
    if (!pool.stablecoin) return false;
  }

  // audited -------------------------------------------------------------------
  if (c.audited_required) {
    if (!audited.has(pool.project.toLowerCase())) return false;
  }

  // no rebase -----------------------------------------------------------------
  if (c.no_rebase) {
    const sym = pool.symbol.toUpperCase();
    for (const rebase of REBASE_SYMBOLS) {
      // contains-match — covers "STETH", "WSTETH/STETH" pool combos, "aUSDC", etc.
      if (sym.includes(rebase)) return false;
    }
  }

  // real-yield only -----------------------------------------------------------
  // We require apyBase to be present AND the inflationary share to be <= 50%.
  // Pools where DefiLlama cannot split apyBase / apyReward are dropped — we
  // never silently include them under a "real yield" constraint.
  if (c.real_yield_only) {
    const cls = classifyRealYield(pool);
    if (cls.estimated) return false;
    if (cls.realYield <= 0) return false;
    if (cls.inflationaryShare > 0.5) return false;
  }

  // APY threshold -------------------------------------------------------------
  if (typeof c.apy_min === 'number') {
    const cls = classifyRealYield(pool);
    // Under `real_yield_only` the threshold applies to realYield; otherwise to
    // headline apy (matches user's mental model — "10% USDC yield" usually
    // refers to the marketed headline APY).
    const apyToCheck = c.real_yield_only ? cls.realYield : cls.apy;
    if (apyToCheck < c.apy_min) return false;
  }

  return true;
}
