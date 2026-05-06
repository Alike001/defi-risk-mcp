/**
 * Minimal Alchemy-backed RPC client.
 *
 * Wraps `viem`'s `createPublicClient` + the Alchemy free-tier HTTPS endpoint
 * for the three chains we support (`ethereum`, `base`, `arbitrum`). The
 * full `simulate_tx_risk` story will use this for `simulateContract`; the
 * `get_position_risk` tool only needs lightweight reads (block number,
 * code-presence at an address) for liveness signals — the heavy synthesis
 * comes from DefiLlama + the audit cache.
 *
 * Per architecture.md ADR-005, the Alchemy key is optional. When the env
 * var is unset, we fall back to viem's default public RPC — slower, less
 * reliable, but works for read-only liveness checks. We never crash on a
 * missing key here.
 */

import { http, createPublicClient } from 'viem';
import { arbitrum, base, mainnet } from 'viem/chains';
import type { SupportedChain } from '../schemas/domain.js';

/** Maps our supported-chain enum to the viem chain object. */
const VIEM_CHAINS = {
  ethereum: mainnet,
  base,
  arbitrum,
} as const satisfies Record<SupportedChain, typeof mainnet | typeof base | typeof arbitrum>;

/** Alchemy URL slug per chain, used when ALCHEMY_API_KEY is set. */
const ALCHEMY_SLUG: Record<SupportedChain, string> = {
  ethereum: 'eth-mainnet',
  base: 'base-mainnet',
  arbitrum: 'arb-mainnet',
};

export interface AlchemyClientOptions {
  /** Optional API key (defaults to `process.env.ALCHEMY_API_KEY`). */
  apiKey?: string;
}

/**
 * Build a viem `PublicClient` for the given chain. If ALCHEMY_API_KEY is
 * present we use the Alchemy HTTPS endpoint; otherwise we fall back to the
 * chain's default public RPC.
 *
 * The return type is intentionally inferred — viem parameterizes
 * `PublicClient` over the chain object, so trying to write a single union
 * type across all three chains makes the surface unwieldy. Inference works.
 */
export function createAlchemyClient(chain: SupportedChain, options: AlchemyClientOptions = {}) {
  const apiKey = options.apiKey ?? process.env.ALCHEMY_API_KEY;
  const viemChain = VIEM_CHAINS[chain];

  const transport = apiKey
    ? http(`https://${ALCHEMY_SLUG[chain]}.g.alchemy.com/v2/${apiKey}`)
    : http();

  return createPublicClient({ chain: viemChain, transport });
}

/**
 * Probe whether an address has deployed code on the chain. We use this as a
 * cheap "is the protocol contract still live?" signal. Returns `true` on
 * success, `false` on no code, and `null` on RPC error so the caller can
 * decide whether to surface the failure or fall through.
 */
export async function hasContractCode(
  chain: SupportedChain,
  address: `0x${string}`,
  options: AlchemyClientOptions = {},
): Promise<boolean | null> {
  const client = createAlchemyClient(chain, options);
  try {
    const code = await client.getCode({ address });
    if (!code) return false;
    return code !== '0x';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[alchemy] getCode(${chain},${address}) failed: ${message}\n`);
    return null;
  }
}
