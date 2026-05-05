/**
 * DefiLlama protocol-metadata client.
 *
 * Why DefiLlama: free, no key, generous limits (per architecture.md ADR-005)
 * and the canonical mirror for protocol slugs + TVL across 100+ chains.
 *
 * Endpoints used:
 *   GET https://api.llama.fi/protocol/{slug}    — full protocol detail
 *   GET https://api.llama.fi/protocols          — full directory (cached locally)
 *
 * We intentionally do NOT cache the response across MCP sessions — Claude
 * Desktop spawns one MCP child per session, so per-process memoization is
 * sufficient (ADR-004 — stateless, in-memory only).
 */

import { z } from 'zod';

const DEFILLAMA_BASE = 'https://api.llama.fi';

/** Subset of the DefiLlama protocol-detail response we care about. */
const protocolDetailSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  // DefiLlama serves chains with capitalized names (Ethereum, Arbitrum, Base)
  chains: z.array(z.string()).default([]),
  category: z.string().nullish(),
  // `tvl` is sometimes a number, sometimes an array of {date, totalLiquidityUSD}
  tvl: z.union([z.number(), z.array(z.unknown())]).optional(),
  url: z.string().url().nullish(),
  audit_links: z.array(z.string().url()).default([]),
  audits: z.string().nullish(),
  audit_note: z.string().nullish(),
  description: z.string().nullish(),
});

export interface ProtocolMetadata {
  /** Canonical name as DefiLlama displays it (e.g. "Aave V3"). */
  name: string;
  /** Lower-case chain names (we normalize). */
  chains: string[];
  /** Approx TVL (USD). 0 if not available. */
  tvlUsd: number;
  category: string | null;
  url: string | null;
  /** DefiLlama-categorical audit signal: e.g. "0", "1", "2", "3". */
  auditTier: string | null;
  /** Free-form note from DefiLlama if present. */
  auditNote: string | null;
  auditLinks: string[];
  description: string | null;
}

export interface DefiLlamaClientOptions {
  /** Override fetch (test injection). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Override base URL (tests). */
  baseUrl?: string;
}

export class DefiLlamaUnknownProtocolError extends Error {
  override readonly name = 'DefiLlamaUnknownProtocolError';
  constructor(public readonly slug: string) {
    super(`DefiLlama has no protocol with slug "${slug}".`);
  }
}

/**
 * Fetch + parse a single protocol's metadata.
 *
 * Throws `DefiLlamaUnknownProtocolError` on 404, generic `Error` on other
 * upstream failures. Errors are NEVER swallowed silently — see banned
 * patterns in architecture.md.
 */
export async function fetchProtocolMetadata(
  slug: string,
  options: DefiLlamaClientOptions = {},
): Promise<ProtocolMetadata> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl ?? DEFILLAMA_BASE;
  const url = `${base}/protocol/${encodeURIComponent(slug)}`;

  const res = await fetchImpl(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });

  if (res.status === 404) {
    throw new DefiLlamaUnknownProtocolError(slug);
  }
  if (!res.ok) {
    throw new Error(`DefiLlama ${url} → HTTP ${res.status} ${res.statusText}`);
  }

  const raw: unknown = await res.json();
  const parsed = protocolDetailSchema.parse(raw);

  // tvl can be number, array, or missing — pull a usable scalar
  let tvlUsd = 0;
  if (typeof parsed.tvl === 'number') {
    tvlUsd = parsed.tvl;
  } else if (Array.isArray(parsed.tvl) && parsed.tvl.length > 0) {
    const last = parsed.tvl[parsed.tvl.length - 1];
    if (last && typeof last === 'object' && 'totalLiquidityUSD' in last) {
      const v = (last as { totalLiquidityUSD?: unknown }).totalLiquidityUSD;
      if (typeof v === 'number') tvlUsd = v;
    }
  }

  return {
    name: parsed.name,
    chains: parsed.chains.map((c) => c.toLowerCase()),
    tvlUsd,
    category: parsed.category ?? null,
    url: parsed.url ?? null,
    auditTier: parsed.audits ?? null,
    auditNote: parsed.audit_note ?? null,
    auditLinks: parsed.audit_links ?? [],
    description: parsed.description ?? null,
  };
}
