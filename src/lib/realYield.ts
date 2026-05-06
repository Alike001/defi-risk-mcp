/**
 * Real-yield separation (the F4 atom from `12-tech-deep-dive.md`).
 *
 * "Real yield" = APY paid out of underlying revenue (trading fees, lending
 * interest, MEV rebates). "Inflationary token emission" = APY paid by
 * minting new governance tokens — the protocol prints money.
 *
 * F4 atom (from first-principles deep-dive):
 *   - Most "10% APY" stable yields are 2% real + 8% inflationary token rewards.
 *   - The 8% is a marketing number that disappears when emissions taper.
 *   - A risk-aware tool MUST separate these two so the LLM never tells the
 *     user "stable 10% USDC yield, fully audited" without flagging that 80%
 *     of that APY is inflationary.
 *
 * DefiLlama's Yields API gives us the raw split:
 *   - `apyBase`   = real yield component
 *   - `apyReward` = inflationary token-emission component
 *   - `apy`       = sum (apyBase + apyReward) when both are present
 *
 * When `apyBase` is null we cannot separate the two — the F4 honesty rule
 * requires us to mark the candidate as `real_yield_estimated: true` rather
 * than fabricate a number. We use `apy` as a conservative ceiling in that
 * case (the real number is somewhere between 0 and `apy`).
 *
 * The classification result feeds into the candidate's `risk_score`: pools
 * with high inflationary share get a risk-score bump because their "yield"
 * is paying out tokens whose price will drop with the next emission cliff.
 */

import type { YieldPool } from './defillama.js';

export interface RealYieldClassification {
  /** Best-effort real-yield APY (apyBase when present, else apy as ceiling). */
  realYield: number;
  /** True when we could not separate apyBase / apyReward (data missing). */
  estimated: boolean;
  /** Headline APY (apyBase + apyReward; null if neither present). */
  apy: number;
  /** Share of APY paid in inflationary tokens. 0 when no emissions. */
  inflationaryShare: number;
  /** Categorization band — used by `risk_score` synthesis. */
  band: 'all_real' | 'mixed' | 'mostly_inflationary' | 'unknown';
  /** ISO-style narrative for the candidate's `why_recommended`. */
  narrative: string;
}

/**
 * Pure classifier — takes a single yield pool and returns the F4 split.
 *
 * Honest-disclosure rules (per ADR + project banned-patterns):
 *   - never fabricate a real-yield number when the data is missing
 *   - always set `estimated: true` when `apyBase` is null
 *   - never assume "all real" without DefiLlama saying `apyReward === 0`
 *   - always emit a non-empty narrative so the LLM caller has a sentence to
 *     surface to the end user
 */
export function classifyRealYield(pool: YieldPool): RealYieldClassification {
  const apyBase = pool.apyBase;
  const apyReward = pool.apyReward;
  const apy = pool.apy ?? sumOrNull(apyBase, apyReward) ?? 0;

  // Case 1: both fields present — clean split
  if (typeof apyBase === 'number' && typeof apyReward === 'number') {
    const total = apyBase + apyReward;
    const inflationaryShare = total > 0 ? apyReward / total : 0;
    const band: RealYieldClassification['band'] =
      apyReward === 0 ? 'all_real' : inflationaryShare >= 0.5 ? 'mostly_inflationary' : 'mixed';
    const narrative =
      apyReward === 0
        ? `All ${apy.toFixed(2)}% APY is real (apyBase=${apyBase.toFixed(2)}%, no token emissions per DefiLlama).`
        : `Real ${apyBase.toFixed(2)}% + inflationary ${apyReward.toFixed(2)}% (= ${apy.toFixed(2)}% total APY); inflationary share ${(inflationaryShare * 100).toFixed(0)}% per DefiLlama Yields.`;
    return { realYield: apyBase, estimated: false, apy, inflationaryShare, band, narrative };
  }

  // Case 2: apyBase present but apyReward absent — treat as all-real (DefiLlama
  // omits the field when there are no rewards rather than emitting a null).
  if (typeof apyBase === 'number' && (apyReward === null || apyReward === undefined)) {
    return {
      realYield: apyBase,
      estimated: false,
      apy,
      inflationaryShare: 0,
      band: 'all_real',
      narrative: `All ${apyBase.toFixed(2)}% APY is real (no inflationary reward APY recorded by DefiLlama).`,
    };
  }

  // Case 3: only headline `apy` present (apyBase missing) — cannot separate
  if (typeof apy === 'number' && apy > 0) {
    return {
      realYield: apy,
      estimated: true,
      apy,
      inflationaryShare: 0,
      band: 'unknown',
      narrative: `Headline ${apy.toFixed(2)}% APY; DefiLlama does not split this pool's apyBase / apyReward, so the real-yield component is estimated and may be lower.`,
    };
  }

  // Case 4: nothing usable
  return {
    realYield: 0,
    estimated: true,
    apy: 0,
    inflationaryShare: 0,
    band: 'unknown',
    narrative: 'No APY data available from DefiLlama for this pool.',
  };
}

function sumOrNull(a: number | null | undefined, b: number | null | undefined): number | null {
  if (typeof a !== 'number' && typeof b !== 'number') return null;
  return (a ?? 0) + (b ?? 0);
}
