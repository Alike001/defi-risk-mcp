/**
 * Raw-tx decoder for `simulate_tx_risk`.
 *
 * Pipeline (per `12-tech-deep-dive.md` §1):
 *   1. `parseTransaction(hex)` — viem accepts both legacy and EIP-1559
 *      serialized transactions (signed or unsigned).
 *   2. Resolve an ABI for `tx.to`. We try, in order:
 *        a. The local "known protocols" registry (offline, deterministic).
 *        b. Etherscan v2 multichain API (`?action=getabi`) when
 *           `ETHERSCAN_API_KEY` is set. We never crash if the key is missing —
 *           the tool falls through with `decoded: null`.
 *   3. `decodeFunctionData({ abi, data: tx.data })` to extract the function
 *      name + args. If decoding fails (proxy contract, partial ABI), we
 *      surface that as `decoded: null` rather than throwing.
 *
 * No signing, no broadcasting, no key handling — read-only per ADR-003.
 */

import { decodeFunctionData, parseTransaction } from 'viem';
import type { Abi, TransactionSerialized } from 'viem';
import type { SupportedChain } from '../schemas/domain.js';

/* ------------------------------------------------------------------------- */
/* Known-counterparty + ABI registry                                          */
/* ------------------------------------------------------------------------- */

/**
 * Curated address → metadata. Lower-case the address before lookup. Adding
 * an entry here makes the tool work entirely offline for that contract — no
 * Etherscan call needed.
 */
export interface KnownCounterparty {
  /** Display name (e.g. "Uniswap V3 SwapRouter02"). */
  name: string;
  /** DefiLlama-style category (e.g. "DEX", "Lending"). */
  category: string;
  /** True iff the protocol has a curated audit summary in our local cache. */
  audited: boolean;
  /** True iff this contract is a public AMM (drives the MEV heuristic). */
  isPublicAmm: boolean;
  /** Minimal ABI fragment(s) we accept calls against. */
  abi: Abi;
  /** Public-source URL for citations. */
  source: string;
}

/* Minimal ABIs — only the function selectors we need to decode + reason about. */

const UNISWAP_V3_ROUTER_ABI = [
  {
    type: 'function',
    name: 'exactInputSingle',
    stateMutability: 'payable',
    inputs: [
      {
        type: 'tuple',
        name: 'params',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'exactInput',
    stateMutability: 'payable',
    inputs: [
      {
        type: 'tuple',
        name: 'params',
        components: [
          { name: 'path', type: 'bytes' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const satisfies Abi;

const AAVE_V3_POOL_ABI = [
  {
    type: 'function',
    name: 'supply',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'referralCode', type: 'uint16' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'to', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'borrow',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'interestRateMode', type: 'uint256' },
      { name: 'referralCode', type: 'uint16' },
      { name: 'onBehalfOf', type: 'address' },
    ],
    outputs: [],
  },
] as const satisfies Abi;

/**
 * Per-chain address registry. Addresses are stored lower-case so we can use
 * raw string equality (viem returns checksummed addresses from
 * `parseTransaction`, so we always lower-case the lookup key).
 */
export const KNOWN_COUNTERPARTIES: Record<SupportedChain, Record<string, KnownCounterparty>> = {
  ethereum: {
    '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': {
      name: 'Uniswap V3 SwapRouter02',
      category: 'DEX',
      audited: true,
      isPublicAmm: true,
      abi: UNISWAP_V3_ROUTER_ABI as unknown as Abi,
      source: 'https://docs.uniswap.org/contracts/v3/reference/deployments',
    },
    '0xe592427a0aece92de3edee1f18e0157c05861564': {
      name: 'Uniswap V3 SwapRouter',
      category: 'DEX',
      audited: true,
      isPublicAmm: true,
      abi: UNISWAP_V3_ROUTER_ABI as unknown as Abi,
      source: 'https://docs.uniswap.org/contracts/v3/reference/deployments',
    },
    '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2': {
      name: 'Aave V3 Pool',
      category: 'Lending',
      audited: true,
      isPublicAmm: false,
      abi: AAVE_V3_POOL_ABI as unknown as Abi,
      source: 'https://docs.aave.com/developers/core-contracts/pool',
    },
  },
  base: {
    '0x2626664c2603336e57b271c5c0b26f421741e481': {
      name: 'Uniswap V3 SwapRouter02 (Base)',
      category: 'DEX',
      audited: true,
      isPublicAmm: true,
      abi: UNISWAP_V3_ROUTER_ABI as unknown as Abi,
      source: 'https://docs.uniswap.org/contracts/v3/reference/deployments',
    },
    '0xa238dd80c259a72e81d7e4664a9801593f98d1c5': {
      name: 'Aave V3 Pool (Base)',
      category: 'Lending',
      audited: true,
      isPublicAmm: false,
      abi: AAVE_V3_POOL_ABI as unknown as Abi,
      source: 'https://docs.aave.com/developers/deployed-contracts/v3-mainnet/base',
    },
  },
  arbitrum: {
    '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': {
      name: 'Uniswap V3 SwapRouter02 (Arbitrum)',
      category: 'DEX',
      audited: true,
      isPublicAmm: true,
      abi: UNISWAP_V3_ROUTER_ABI as unknown as Abi,
      source: 'https://docs.uniswap.org/contracts/v3/reference/deployments',
    },
    '0x794a61358d6845594f94dc1db02a252b5b4814ad': {
      name: 'Aave V3 Pool (Arbitrum)',
      category: 'Lending',
      audited: true,
      isPublicAmm: false,
      abi: AAVE_V3_POOL_ABI as unknown as Abi,
      source: 'https://docs.aave.com/developers/deployed-contracts/v3-mainnet/arbitrum',
    },
  },
};

/* ------------------------------------------------------------------------- */
/* Etherscan v2 ABI fetch                                                     */
/* ------------------------------------------------------------------------- */

const ETHERSCAN_V2_BASE = 'https://api.etherscan.io/v2/api';

/** Etherscan v2 chain-id mapping for the chains we support. */
const ETHERSCAN_CHAIN_ID: Record<SupportedChain, number> = {
  ethereum: 1,
  base: 8453,
  arbitrum: 42161,
};

export interface FetchAbiOptions {
  /** Override fetch (test injection). */
  fetchImpl?: typeof fetch;
  /** Override the API key. */
  apiKey?: string;
  /** Override the base URL (tests). */
  baseUrl?: string;
}

/**
 * Fetch + parse an ABI from Etherscan v2 multichain API. Returns `null` on
 * any non-OK status, missing key, or unverified-contract response — the
 * caller treats `null` as "no ABI available" and surfaces `decoded: null`.
 *
 * Errors are NEVER swallowed silently — they surface on stderr and we return
 * `null` so the tool can keep degrading gracefully.
 */
export async function fetchAbiFromEtherscan(
  chain: SupportedChain,
  address: `0x${string}`,
  options: FetchAbiOptions = {},
): Promise<Abi | null> {
  const apiKey = options.apiKey ?? process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    process.stderr.write('[txDecoder] ETHERSCAN_API_KEY unset — skipping ABI fetch\n');
    return null;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl ?? ETHERSCAN_V2_BASE;
  const chainid = ETHERSCAN_CHAIN_ID[chain];
  const url = `${base}?chainid=${chainid}&module=contract&action=getabi&address=${address}&apikey=${apiKey}`;

  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[txDecoder] etherscan fetch threw: ${message}\n`);
    return null;
  }

  if (!res.ok) {
    process.stderr.write(`[txDecoder] etherscan ${res.status} for ${address}\n`);
    return null;
  }

  let body: { status?: string; result?: string };
  try {
    body = (await res.json()) as { status?: string; result?: string };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[txDecoder] etherscan json parse failed: ${message}\n`);
    return null;
  }

  // Etherscan returns status="0" + result="Contract source code not verified"
  // for unverified contracts. We treat that as "no ABI" and return null.
  if (body.status !== '1' || !body.result) {
    return null;
  }

  try {
    const abi = JSON.parse(body.result) as Abi;
    return abi;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[txDecoder] etherscan abi JSON.parse failed: ${message}\n`);
    return null;
  }
}

/* ------------------------------------------------------------------------- */
/* Decode pipeline                                                            */
/* ------------------------------------------------------------------------- */

export interface DecodedTransaction {
  /** Lower-case hex address of the contract this tx targets. */
  to: `0x${string}`;
  /** ETH value in wei (string for safe JSON serialization of bigints). */
  value: string;
  /** Raw call data, 0x-prefixed. */
  data: `0x${string}`;
  /** First 4 bytes of `data` (the function selector). */
  selector: `0x${string}` | null;
  /** Optional from-address (only present on signed txs). */
  from: `0x${string}` | null;
  /** Counterparty metadata if `to` is in the registry, else null. */
  counterparty: KnownCounterparty | null;
  /** Decoded function call, or null if no ABI was available. */
  call: {
    functionName: string;
    args: readonly unknown[];
  } | null;
}

export interface DecodeOptions extends FetchAbiOptions {
  /** Override the local registry (tests). */
  registry?: Record<SupportedChain, Record<string, KnownCounterparty>>;
}

export class InvalidTxHexError extends Error {
  override readonly name = 'InvalidTxHexError';
  override readonly cause?: unknown;
  constructor(cause?: unknown) {
    super('Could not parse transaction hex — not a valid serialized EVM tx.');
    this.cause = cause;
  }
}

/**
 * End-to-end decode. Throws `InvalidTxHexError` only when `parseTransaction`
 * cannot make sense of the input — every other failure (no ABI, no
 * decoding) downgrades to a `null` field on the result.
 */
export async function decodeRawTx(
  chain: SupportedChain,
  hex: string,
  options: DecodeOptions = {},
): Promise<DecodedTransaction> {
  const registry = options.registry ?? KNOWN_COUNTERPARTIES;

  // viem requires the `0x` prefix and rejects non-hex chars; surface as our
  // typed error so the tool layer can return a structured MCP error.
  let parsed: ReturnType<typeof parseTransaction>;
  try {
    parsed = parseTransaction(hex as TransactionSerialized);
  } catch (err) {
    throw new InvalidTxHexError(err);
  }

  // EIP-1559 / legacy / 2930 all expose `to` as a hex address.
  const toRaw = parsed.to;
  if (!toRaw) {
    throw new InvalidTxHexError('contract-creation tx has no `to`');
  }
  const to = toRaw.toLowerCase() as `0x${string}`;

  const data = ((parsed.data as `0x${string}` | undefined) ?? '0x') as `0x${string}`;
  const selector = data.length >= 10 ? (data.slice(0, 10).toLowerCase() as `0x${string}`) : null;

  const valueWei = (parsed.value ?? 0n).toString();

  // signed txs include r/s/v but viem doesn't ecrecover here. Real
  // from-address recovery would require a viem helper — for v0 we leave it
  // null and the tool returns portfolio_after=null (BDD allows this).
  const from: `0x${string}` | null = null;

  const counterparty = registry[chain][to] ?? null;

  // 1) Try the registry ABI first.
  let call: DecodedTransaction['call'] = null;
  if (counterparty && data !== '0x') {
    call = tryDecode(counterparty.abi, data);
  }

  // 2) Fall back to Etherscan if registry didn't decode.
  if (!call && data !== '0x') {
    const fetched = await fetchAbiFromEtherscan(chain, to, options);
    if (fetched) {
      call = tryDecode(fetched, data);
    }
  }

  return {
    to,
    value: valueWei,
    data,
    selector,
    from,
    counterparty,
    call,
  };
}

function tryDecode(abi: Abi, data: `0x${string}`): DecodedTransaction['call'] {
  try {
    const decoded = decodeFunctionData({ abi, data });
    return {
      functionName: decoded.functionName,
      args: (decoded.args ?? []) as readonly unknown[],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[txDecoder] decodeFunctionData failed: ${message}\n`);
    return null;
  }
}

/**
 * Helper used by both the tool (for serialization) and tests (for assertions).
 * Coerces viem's heterogeneous arg types (addresses, bigints, tuples) into
 * JSON-safe strings so the structured MCP response stays well-typed.
 */
export function stringifyArgs(args: readonly unknown[]): string[] {
  return args.map((a) => stringifyArg(a));
}

function stringifyArg(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return String(value);
  // tuples / arrays / objects — JSON.stringify with bigint replacer
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}
