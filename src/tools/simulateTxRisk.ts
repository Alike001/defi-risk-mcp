/**
 * `simulate_tx_risk` — decode a raw unsigned tx + run a Tenderly simulation,
 * surfacing MEV exposure, slippage estimate, counterparty info, oracle
 * dependencies, and post-tx portfolio impact.
 *
 * Per ADR-003 this tool is read-only — never signs, never broadcasts. The
 * input is a serialized transaction hex (the user signs in their own wallet
 * after reviewing the report).
 *
 * Pipeline:
 *   1. Validate input via Zod (chain ∈ {ethereum,base,arbitrum}, hex prefix).
 *   2. `decodeRawTx` — viem `parseTransaction` + ABI lookup (registry first,
 *      Etherscan v2 fallback) + `decodeFunctionData`.
 *   3. `simulateTransaction` — Tenderly free-tier sim (cached by request hash
 *      to amortize the 100/day limit).
 *   4. Synthesize:
 *        - MEV verdict (3-band heuristic — see scoreMevRisk + tool description)
 *        - Slippage estimate from decoded amountIn + amountOutMinimum
 *        - Counterparty record from the registry
 *        - Oracle deps from the curated knowledge base
 *        - Portfolio_after = null (we never recover from-address in v0)
 *        - Recommendations (MEV-protected RPC for swaps, etc.)
 *
 * Tenderly free tier: 100 simulations/day per IP. Tool description documents
 * this constraint; missing TENDERLY_* env vars → structured tool error with
 * setup instructions (NOT a crash).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  type SimulationResult,
  TenderlyApiError,
  TenderlyMissingCredentialsError,
  resolveCredentials,
  simulateTransaction,
} from '../lib/tenderly.js';
import {
  type DecodedTransaction,
  InvalidTxHexError,
  decodeRawTx,
  stringifyArgs,
} from '../lib/txDecoder.js';
import {
  type Counterparty,
  type DecodedCall,
  type MevRiskBand,
  SUPPORTED_CHAINS,
  type SupportedChain,
  type TxRiskReport,
  txRiskReportSchema,
} from '../schemas/domain.js';
import {
  simulateTxRiskInputSchema,
  simulateTxRiskInputShape,
  simulateTxRiskOutputSchema,
} from '../schemas/tools.js';

export const SIMULATE_TX_RISK_TOOL_NAME = 'simulate_tx_risk';

/* ------------------------------------------------------------------------- */
/* Public surface                                                             */
/* ------------------------------------------------------------------------- */

/**
 * Programmatic entry point. Used by both the MCP `registerTool` handler and
 * tests. Returns either a parsed `TxRiskReport` (success) or a typed error
 * object (so the tool layer can map missing-credentials → MCP isError).
 */
export type SimulateTxRiskResult =
  | { status: 'ok'; report: TxRiskReport }
  | { status: 'error'; code: string; message: string };

export interface SimulateTxRiskOptions {
  /** Inject a custom decoder (tests). */
  decode?: typeof decodeRawTx;
  /** Inject a custom simulator (tests). */
  simulate?: typeof simulateTransaction;
  /** Skip the Tenderly call entirely (e.g. when credentials missing). */
  skipSimulation?: boolean;
}

export async function simulateTxRisk(
  rawInput: unknown,
  options: SimulateTxRiskOptions = {},
): Promise<SimulateTxRiskResult> {
  // 1. Validate input — Zod gives a clean error message on bad chain/hex.
  const parsed = simulateTxRiskInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      status: 'error',
      code: 'invalid_input',
      message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }
  const input = parsed.data;

  // 2. Decode tx hex.
  const decode = options.decode ?? decodeRawTx;
  let decoded: DecodedTransaction;
  try {
    decoded = await decode(input.chain, input.unsigned_tx_hex);
  } catch (err) {
    if (err instanceof InvalidTxHexError) {
      return {
        status: 'error',
        code: 'invalid_tx_hex',
        message: err.message,
      };
    }
    throw err;
  }

  // 3. Run Tenderly simulation. Missing credentials → structured error
  //    (BDD: tool MUST NOT crash). Network failure → also structured error.
  let simulation: SimulationResult | null = null;
  if (!options.skipSimulation) {
    const simulate = options.simulate ?? simulateTransaction;
    try {
      // Pre-flight credential check so the tool fails fast with a clean
      // error before we try the network call. Skip when the test layer has
      // injected a custom `simulate` — the stub doesn't need real env vars.
      if (!options.simulate) {
        resolveCredentials();
      }
      simulation = await simulate({
        chain: input.chain,
        // Sender unknown for unsigned tx — Tenderly accepts the zero address.
        from: '0x0000000000000000000000000000000000000000',
        to: decoded.to,
        input: decoded.data,
        value: decoded.value,
      });
    } catch (err) {
      if (err instanceof TenderlyMissingCredentialsError) {
        return {
          status: 'error',
          code: 'missing_credentials',
          message: err.message,
        };
      }
      if (err instanceof TenderlyApiError) {
        return {
          status: 'error',
          code: 'tenderly_api_error',
          message: err.message,
        };
      }
      throw err;
    }
  }

  // 4. Synthesize the report from decoded + simulation.
  const report = buildReport(input.chain, decoded, simulation);
  return { status: 'ok', report: txRiskReportSchema.parse(report) };
}

/* ------------------------------------------------------------------------- */
/* Synthesis                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Heuristic MEV classifier (v0). The full rule set lives here so the tool
 * description can quote it verbatim and tests can assert specific verdicts.
 *
 *  - HIGH   = swap on a known public AMM (Uniswap V2/V3) with notional > $5K
 *             AND slippage tolerance > 0.3%
 *  - MEDIUM = swap on a known public AMM, smaller size or smaller slippage
 *  - LOW    = non-swap (deposit/supply/withdraw/borrow/transfer/approve), OR
 *             unknown contract with no swap-shaped calldata.
 */
export function scoreMevRisk(
  decoded: DecodedTransaction,
  notionalUsd: number,
  slippagePct: number,
): { band: MevRiskBand; reasoning: string } {
  const onAmm = decoded.counterparty?.isPublicAmm === true;
  const fnName = decoded.call?.functionName?.toLowerCase() ?? '';
  const isSwap = onAmm || fnName.includes('swap') || fnName.startsWith('exact');

  if (!isSwap) {
    return {
      band: 'low',
      reasoning:
        'Non-swap transaction (deposit / supply / withdraw / approve). MEV exposure is structurally limited; no public-mempool sandwich vector.',
    };
  }

  if (onAmm && notionalUsd > 5_000 && slippagePct > 0.3) {
    return {
      band: 'high',
      reasoning: `Swap on a public AMM with notional ≈ $${notionalUsd.toLocaleString()} and slippage tolerance ${slippagePct.toFixed(2)}% — sandwich-attack target. Use a private mempool (Flashbots Protect, MEV-Share) and tighten slippage.`,
    };
  }

  if (onAmm) {
    return {
      band: 'medium',
      reasoning: `Swap on a public AMM but smaller notional ($${notionalUsd.toLocaleString()}) or tighter slippage (${slippagePct.toFixed(2)}%) — partial MEV exposure. Consider Flashbots Protect for additional safety.`,
    };
  }

  return {
    band: 'medium',
    reasoning:
      'Swap-shaped calldata on a contract not in our public-AMM registry. Treat as moderate MEV risk pending counterparty review.',
  };
}

/**
 * Estimate slippage tolerance from decoded swap args. Returns 0 for
 * non-swaps so the BDD criterion `slippage_pct >= 0` always holds.
 *
 * Uniswap-style swap params expose `amountIn` + `amountOutMinimum`. Without
 * a price oracle we can't know the *expected* amountOut, so we report the
 * tolerance as a reasonable percentage of `amountIn` (in raw units). For
 * v0 this is a coarse signal — subsequent stories can wire in a price feed.
 */
export function estimateSlippagePct(decoded: DecodedTransaction): number {
  if (!decoded.call) return 0;
  const args = decoded.call.args;
  // exactInputSingle / exactInput take a single tuple arg
  if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
    const params = args[0] as Record<string, unknown>;
    const amountIn = toBigInt(params.amountIn);
    const amountOutMin = toBigInt(params.amountOutMinimum);
    if (amountIn === null || amountOutMin === null || amountIn === 0n) return 0;
    // We don't have decimals or a price feed — express the slippage tolerance
    // as the *minimum-output ratio* gap if the two were the same denomination.
    // This is intentionally a v0 approximation; the recommendation string
    // tells the user to tighten if it looks loose.
    const ratio = Number(amountOutMin) / Number(amountIn);
    // For cross-asset swaps `ratio` will not be ~1.0 so we clamp to a
    // reasonable upper bound so the number stays interpretable to humans.
    if (ratio < 0.0001 || ratio > 100) return 0.5; // unknown — assume default 0.5%
    return Math.max(0, (1 - ratio) * 100);
  }
  return 0;
}

/**
 * Estimate notional USD value. v0: we don't have a price oracle, so for
 * Uniswap-style swaps we read `amountIn` and assume 18 decimals as the
 * default. A USDC-shaped (6dp) `amountIn` like 10_000_000_000 → ~$10K when
 * we treat it as USDC. For the demo-grade heuristic we sniff the token
 * address in `tokenIn` and apply known decimals where we recognize them.
 */
const KNOWN_TOKEN_DECIMALS: Record<string, number> = {
  // Mainnet USDC
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6,
  // Mainnet USDT
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 6,
  // Mainnet WETH
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 18,
  // Mainnet DAI
  '0x6b175474e89094c44da98b954eedeac495271d0f': 18,
};

const STABLECOIN_ADDRESSES = new Set([
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
  '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
]);

export function estimateNotionalUsd(decoded: DecodedTransaction): number {
  if (!decoded.call) return 0;
  const args = decoded.call.args;
  if (args.length !== 1 || typeof args[0] !== 'object' || args[0] === null) return 0;
  const params = args[0] as Record<string, unknown>;

  const amountIn = toBigInt(params.amountIn);
  if (amountIn === null) return 0;

  const tokenIn = typeof params.tokenIn === 'string' ? params.tokenIn.toLowerCase() : null;
  const decimals = tokenIn !== null ? (KNOWN_TOKEN_DECIMALS[tokenIn] ?? 18) : 18;
  const human = Number(amountIn) / 10 ** decimals;

  // Only stablecoins are 1:1 USD; for ETH/WETH/other we apply a coarse
  // fallback of $3,500/ETH so the band check still triggers on real-size
  // swaps. This is a heuristic, not a price feed — documented inline.
  if (tokenIn !== null && STABLECOIN_ADDRESSES.has(tokenIn)) return human;
  return human * 3_500;
}

function toBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

/* ------------------------------------------------------------------------- */
/* Counterparty + oracle deps                                                 */
/* ------------------------------------------------------------------------- */

function buildCounterparty(decoded: DecodedTransaction): Counterparty {
  if (decoded.counterparty) {
    return {
      address: decoded.to,
      name: decoded.counterparty.name,
      audited: decoded.counterparty.audited,
      category: decoded.counterparty.category,
    };
  }
  return {
    address: decoded.to,
    // No fabricated label for unknown contracts — surface the address itself
    // so the LLM does not pretend the contract is something it isn't.
    name: `Unknown contract ${decoded.to}`,
    audited: false,
    category: null,
  };
}

/**
 * Build the oracle-deps array. AMM swaps emit no oracle dependencies (they
 * use the pool spot price); lending markets like Aave V3 depend on Chainlink.
 * The list is intentionally small in v0 — story-tool-check-oracle-dependencies
 * will replace this with a graph walk.
 */
function buildOracleDeps(decoded: DecodedTransaction): string[] {
  const cat = decoded.counterparty?.category?.toLowerCase() ?? null;
  if (cat === 'lending') return ['chainlink-price-feeds'];
  if (cat === 'cdp') return ['chainlink-price-feeds'];
  // AMM swaps and unknown contracts: no oracle deps surfaced.
  return [];
}

/* ------------------------------------------------------------------------- */
/* Recommendations                                                            */
/* ------------------------------------------------------------------------- */

function buildRecommendations(
  mev: MevRiskBand,
  decoded: DecodedTransaction,
  simulation: SimulationResult | null,
): string[] {
  const out: string[] = [];

  if (mev === 'high') {
    out.push('Submit via Flashbots Protect or another private-mempool RPC to avoid sandwich MEV.');
    out.push('Tighten amountOutMinimum / slippage tolerance below 0.3%.');
  } else if (mev === 'medium') {
    out.push('Consider Flashbots Protect or MEV-Share for added safety on this swap.');
  }

  if (decoded.counterparty && !decoded.counterparty.audited) {
    out.push(
      `Counterparty "${decoded.counterparty.name}" lacks a curated audit summary in our cache — independently verify the contract before proceeding.`,
    );
  }

  if (!decoded.counterparty) {
    out.push(
      `Target contract ${decoded.to} is not in our known-protocol registry. Verify on a block explorer before signing.`,
    );
  }

  if (simulation && !simulation.success) {
    out.push(
      `Tenderly simulation reverted${
        simulation.errorMessage ? ` (${simulation.errorMessage})` : ''
      } — do NOT broadcast this transaction; investigate the revert reason first.`,
    );
  }

  if (out.length === 0) {
    out.push('No specific risks flagged — continue to verify the decoded args match your intent.');
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* Report assembly                                                            */
/* ------------------------------------------------------------------------- */

function buildDecodedField(decoded: DecodedTransaction): DecodedCall | null {
  if (!decoded.call || !decoded.selector) return null;
  return {
    function_name: decoded.call.functionName,
    args: stringifyArgs(decoded.call.args),
    selector: decoded.selector,
  };
}

function buildSummary(
  chain: SupportedChain,
  decoded: DecodedTransaction,
  mev: MevRiskBand,
  slippagePct: number,
  simulation: SimulationResult | null,
): string {
  const ctp = decoded.counterparty?.name ?? `unknown contract ${decoded.to}`;
  const fn = decoded.call?.functionName ?? 'opaque call';
  const simBit = simulation
    ? simulation.success
      ? `Simulation OK (${simulation.gasUsed.toLocaleString()} gas).`
      : `Simulation REVERTED (${simulation.errorMessage ?? 'no reason'}).`
    : 'Simulation skipped (Tenderly credentials not provided).';
  return `Calls ${fn}() on ${ctp} (${chain}). MEV verdict: ${mev}. Slippage tolerance ≈ ${slippagePct.toFixed(2)}%. ${simBit}`;
}

function buildSources(decoded: DecodedTransaction, chain: SupportedChain): string[] {
  const out = new Set<string>();
  if (decoded.counterparty?.source) out.add(decoded.counterparty.source);
  out.add(EXPLORER_FOR_CHAIN[chain](decoded.to));
  out.add('https://docs.tenderly.co/simulations/api');
  return Array.from(out);
}

const EXPLORER_FOR_CHAIN: Record<SupportedChain, (addr: string) => string> = {
  ethereum: (a) => `https://etherscan.io/address/${a}`,
  base: (a) => `https://basescan.org/address/${a}`,
  arbitrum: (a) => `https://arbiscan.io/address/${a}`,
};

export function buildReport(
  chain: SupportedChain,
  decoded: DecodedTransaction,
  simulation: SimulationResult | null,
): TxRiskReport {
  const slippagePct = estimateSlippagePct(decoded);
  const notionalUsd = estimateNotionalUsd(decoded);
  const { band, reasoning } = scoreMevRisk(decoded, notionalUsd, slippagePct);
  const counterparty = buildCounterparty(decoded);
  const oracleDeps = buildOracleDeps(decoded);
  const decodedField = buildDecodedField(decoded);
  const recommendations = buildRecommendations(band, decoded, simulation);
  const summary = buildSummary(chain, decoded, band, slippagePct, simulation);
  const sources = buildSources(decoded, chain);

  return {
    summary,
    chain,
    counterparty,
    decoded: decodedField,
    mev_risk: band,
    mev_reasoning: reasoning,
    slippage_pct: slippagePct,
    oracle_deps: oracleDeps,
    portfolio_after: null, // v0 — wallet inference out of scope (see ADR-003)
    recommendations,
    sources,
  };
}

/* ------------------------------------------------------------------------- */
/* MCP tool registration                                                      */
/* ------------------------------------------------------------------------- */

export function registerSimulateTxRiskTool(server: McpServer): void {
  server.registerTool(
    SIMULATE_TX_RISK_TOOL_NAME,
    {
      title: 'Simulate transaction risk',
      description: [
        'Decode a raw unsigned transaction hex and surface MEV exposure, slippage tolerance,',
        'counterparty info, oracle dependencies, and recommendations BEFORE the user signs.',
        'Read-only — never signs or broadcasts (per ADR-003).',
        `Supported chains: ${SUPPORTED_CHAINS.join(', ')}.`,
        'Uses Tenderly Simulation API (free tier — limited to 100 sims/day per IP);',
        'responses are cached in process memory by request hash to amortize the limit.',
        'MEV heuristic (v0):',
        ' high = swap on public AMM with notional > $5K AND slippage > 0.3%;',
        ' medium = swap on public AMM, smaller size or tighter slippage;',
        ' low = non-swap (deposit / supply / withdraw / approve) or non-AMM contract.',
        'If TENDERLY_USER, TENDERLY_PROJECT, or TENDERLY_ACCESS_KEY is missing,',
        'the tool returns a structured "missing_credentials" error rather than crashing.',
      ].join(' '),
      inputSchema: simulateTxRiskInputShape,
      outputSchema: simulateTxRiskOutputSchema.shape,
    },
    async (rawInput: { chain: SupportedChain; unsigned_tx_hex: string }) => {
      try {
        const result = await simulateTxRisk(rawInput);
        if (result.status === 'error') {
          // Surface as an MCP isError response with structured detail so the
          // client can render setup / repair instructions to the user.
          const detail = { status: 'error', code: result.code, message: result.message };
          return {
            content: [{ type: 'text', text: JSON.stringify(detail) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result.report) }],
          structuredContent: result.report,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[simulate_tx_risk] error: ${message}\n`);
        throw err;
      }
    },
  );
}
