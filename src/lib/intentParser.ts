/**
 * Rule-based intent parser for `discover_yields_by_intent`.
 *
 * Extracts structured `IntentConstraints` from a natural-language yield-
 * discovery intent. Intentionally rule-based — no LLM call — so:
 *   - the parser is deterministic and unit-testable in milliseconds,
 *   - we never spend a paid LLM token to interpret something a regex can,
 *   - the "supported keywords" list is provable by reading this file.
 *
 * Supported keywords (kept in lockstep with the schema docstring in
 * `schemas/domain.ts` and the tool description in `discoverYieldsByIntent.ts`):
 *
 *   APY threshold ........... `> N%`, `>= N%`, `apy > N%`, `apy >= N%`
 *   APY threshold (no %) .... `> N`, `>= N`           (interpreted as percent)
 *   chain ................... `on Base`, `on Arbitrum`, `on Ethereum`,
 *                             `on Optimism`, `on Polygon`, `on BSC`
 *   asset ................... `USDC`, `USDT`, `DAI`, `ETH`, `WETH`, `WBTC`,
 *                             `STETH`, `WSTETH`, `EZETH`
 *   audited ................. `audited`
 *   audit window ............ `audited within last N months` (also "month")
 *   rebase .................. `no rebase`, `non-rebasing`, `non rebasing`
 *   stable .................. `stable`, `stablecoin`
 *   real yield .............. `real yield`, `no emissions`, `no inflationary`
 *
 * If a token is unrecognized we keep going — the parser is best-effort, the
 * downstream filter is conjunctive over whatever was extracted. The parsed
 * intent is echoed in the tool response so callers can see exactly what the
 * parser caught.
 */

import type { IntentConstraints } from '../schemas/domain.js';

/** Canonical chain slug in the Yields filter (matches DefiLlama `.chain` lowercased). */
export const SUPPORTED_INTENT_CHAINS: Record<string, string> = Object.freeze({
  ethereum: 'ethereum',
  eth: 'ethereum',
  mainnet: 'ethereum',
  base: 'base',
  arbitrum: 'arbitrum',
  arb: 'arbitrum',
  optimism: 'optimism',
  op: 'optimism',
  polygon: 'polygon',
  matic: 'polygon',
  bsc: 'bsc',
  bnb: 'bsc',
});

/** Asset symbols we'll filter on. Upper-cased. */
export const SUPPORTED_INTENT_ASSETS = [
  'USDC',
  'USDT',
  'DAI',
  'FRAX',
  'WETH',
  'ETH',
  'WBTC',
  'STETH',
  'WSTETH',
  'EZETH',
  'CBBTC',
  'GHO',
] as const;

const APY_PATTERNS: ReadonlyArray<RegExp> = [
  // explicit "apy > 5%" or "apy >= 5"
  /\bapy\s*(?:>=|>)\s*([0-9]+(?:\.[0-9]+)?)\s*%?/i,
  // ">= 5%" or "> 5%" without the word "apy"
  /(?:>=|>)\s*([0-9]+(?:\.[0-9]+)?)\s*%/,
  // "yield > 5%" or "yield >= 5"
  /\byield\s*(?:>=|>)\s*([0-9]+(?:\.[0-9]+)?)\s*%?/i,
  // "real yield > 8%"
  /\breal\s+yield\s*(?:>=|>)\s*([0-9]+(?:\.[0-9]+)?)\s*%?/i,
  // bare "> 5" — only fires when accompanied by chain/asset/audited so we don't
  // false-trigger on unrelated numbers.
  /(?:>=|>)\s*([0-9]+(?:\.[0-9]+)?)\b/,
];

const AUDIT_WINDOW_PATTERNS: ReadonlyArray<RegExp> = [
  /audited\s+within\s+(?:the\s+)?last\s+([0-9]+)\s+months?/i,
  /audited\s+in\s+(?:the\s+)?last\s+([0-9]+)\s+months?/i,
  /audited\s+(?:in|within)?\s*(?:the\s+)?(?:last|past)\s+([0-9]+)\s+mos?/i,
];

/**
 * Parse a natural-language intent into structured constraints.
 *
 * The function never throws — even on garbage input we emit an "empty"
 * `IntentConstraints` (every flag false / null) plus an empty
 * `recognized_keywords` so the caller can detect the no-match case via
 * `recognized_keywords.length === 0`.
 */
export function parseIntent(intent: string): IntentConstraints {
  const text = (intent ?? '').toString();
  const lower = text.toLowerCase();
  const recognized = new Set<string>();

  // ---- APY threshold --------------------------------------------------------
  let apy_min: number | null = null;
  for (const re of APY_PATTERNS) {
    const m = text.match(re);
    if (m?.[1]) {
      const n = Number.parseFloat(m[1]);
      if (Number.isFinite(n) && n >= 0) {
        apy_min = n;
        recognized.add(`apy>=${n}%`);
        break;
      }
    }
  }

  // ---- chain -----------------------------------------------------------------
  let chain: string | null = null;
  // "on <chain>" — the most reliable signal
  const onChainMatch = lower.match(/\bon\s+([a-z0-9]+)\b/);
  if (onChainMatch?.[1] && onChainMatch[1] in SUPPORTED_INTENT_CHAINS) {
    chain = SUPPORTED_INTENT_CHAINS[onChainMatch[1]] ?? null;
    if (chain) recognized.add(`chain:${chain}`);
  }
  // Fallback: bare chain mention without "on"
  if (!chain) {
    for (const [alias, canonical] of Object.entries(SUPPORTED_INTENT_CHAINS)) {
      // Word-boundary match so "ethereum" doesn't match inside "ethereumXYZ".
      const re = new RegExp(`\\b${alias}\\b`, 'i');
      if (re.test(lower)) {
        chain = canonical;
        recognized.add(`chain:${canonical}`);
        break;
      }
    }
  }

  // ---- asset symbol ----------------------------------------------------------
  let asset_symbol: string | null = null;
  for (const sym of SUPPORTED_INTENT_ASSETS) {
    const re = new RegExp(`\\b${sym}\\b`, 'i');
    if (re.test(text)) {
      asset_symbol = sym;
      recognized.add(`asset:${sym}`);
      break;
    }
  }

  // ---- audit window --------------------------------------------------------
  let audit_max_age_months: number | null = null;
  for (const re of AUDIT_WINDOW_PATTERNS) {
    const m = text.match(re);
    if (m?.[1]) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) {
        audit_max_age_months = n;
        recognized.add(`audit_max_age_months:${n}`);
        break;
      }
    }
  }

  // ---- audited (boolean) ---------------------------------------------------
  // "audited" alone or "audited within last N months" both imply audited=true.
  const audited_required = /\baudited\b/i.test(text);
  if (audited_required) recognized.add('audited');

  // ---- rebase --------------------------------------------------------------
  const no_rebase = /\bno\s+rebase\b/i.test(text) || /\bnon[\s-]?rebasing\b/i.test(text);
  if (no_rebase) recognized.add('no_rebase');

  // ---- stable --------------------------------------------------------------
  const stable_only = /\bstable(?:coin)?\b/i.test(text);
  if (stable_only) recognized.add('stable');

  // ---- real yield ----------------------------------------------------------
  const real_yield_only =
    /\breal\s+yield\b/i.test(text) ||
    /\bno\s+emissions?\b/i.test(text) ||
    /\bno\s+inflationary\b/i.test(text);
  if (real_yield_only) recognized.add('real_yield');

  return {
    apy_min,
    chain,
    asset_symbol,
    audited_required,
    audit_max_age_months,
    no_rebase,
    stable_only,
    real_yield_only,
    recognized_keywords: Array.from(recognized),
  };
}

/** Documented keyword set — exported for the tool description + tests. */
export const SUPPORTED_INTENT_KEYWORDS: ReadonlyArray<string> = Object.freeze([
  'apy > N% / >= N% / yield > N%',
  'on <chain> (Ethereum, Base, Arbitrum, Optimism, Polygon, BSC)',
  '<asset> (USDC, USDT, DAI, FRAX, WETH, ETH, WBTC, STETH, WSTETH, EZETH, CBBTC, GHO)',
  'audited',
  'audited within last N months',
  'no rebase / non-rebasing',
  'stable / stablecoin',
  'real yield / no emissions / no inflationary',
]);
