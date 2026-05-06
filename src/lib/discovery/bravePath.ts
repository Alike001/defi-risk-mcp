/**
 * Discovery Path 2 — Brave Search (heuristic protocol surface).
 *
 * Per ADR-006 this is the optional middle path that activates only when
 * `BRAVE_SEARCH_API_KEY` is set. It exists for the case where Index Network
 * is unavailable but the user still wants a "search-the-web for what other
 * protocols match this intent" signal before we collapse to the
 * DefiLlama-only floor.
 *
 * Why direct REST and not the `mcp__brave-search__brave_web_search` MCP tool:
 *   The MCP-search tool runs in this AI harness, NOT in the user's MCP server
 *   process at runtime. The deployed `defi-risk-mcp` Node binary cannot call
 *   another MCP server — it would need to BE one. So we use Brave's public
 *   REST endpoint directly via `fetch`. Endpoint:
 *     GET https://api.search.brave.com/res/v1/web/search?q=...
 *   with `X-Subscription-Token` header. Free-tier quota is generous (2000
 *   queries/month) and per-call cost is one round-trip.
 *
 * Pipeline:
 *   1. Build a Brave query from the natural-language intent + DeFi-yield
 *      qualifiers ("DeFi yield", "audited", chain hint when present).
 *   2. POST query → parse `web.results[].url`. Extract DefiLlama-project
 *      slugs from URLs that match known patterns (`defillama.com/protocol/`,
 *      `*.morpho.org`, `aave.com`, etc.).
 *   3. Map the extracted slugs to the canonical DefiLlama project list using
 *      a small allow-list (`BRAVE_URL_TO_PROJECT`). Anything we cannot
 *      confidently map is dropped — we never silently include a candidate
 *      whose risk metadata we do not have.
 *   4. Hand the resulting set of project slugs to the DefiLlama floor as a
 *      `signalProtocols` bias. The floor still applies the audit/TVL/IL
 *      filters and risk-score sort. Surviving candidates are tagged
 *      `data_source: "brave_inferred"` so the LLM can disclose the heuristic.
 *
 * Honest disclosure (F4 rule): the candidates are NOT returned because Brave
 * said so. They are returned because DefiLlama has them AND Brave's results
 * surfaced their parent protocol. The risk score is computed from DefiLlama
 * data — not from Brave's search rank.
 *
 * Failure posture:
 *   - HTTP non-2xx → throws `BravePathError` with the status code so the
 *     router can distinguish rate-limit (429) from "no key" (401).
 *   - Network error → throws `BravePathError` wrapping the underlying message.
 *   - Empty result set → returns `[]` (the router collapses to the DefiLlama
 *     floor without any Brave bias).
 */

import { z } from 'zod';

/** Default per-path timeout. Mirrors the router's 8s cap (story #8 note). */
const DEFAULT_TIMEOUT_MS = 8_000;

const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

/** Env var that gates this path. */
export const BRAVE_SEARCH_API_KEY_ENV = 'BRAVE_SEARCH_API_KEY';

/* ------------------------------------------------------------------------- */
/* Errors                                                                     */
/* ------------------------------------------------------------------------- */

export class BravePathDisabledError extends Error {
  override readonly name = 'BravePathDisabledError';
  constructor() {
    super(`${BRAVE_SEARCH_API_KEY_ENV} is not set; Brave path skipped.`);
  }
}

export class BravePathError extends Error {
  override readonly name = 'BravePathError';
  constructor(
    message: string,
    public readonly httpStatus: number | null = null,
  ) {
    super(`brave_path_error: ${message}`);
  }
}

export class BravePathTimeoutError extends Error {
  override readonly name = 'BravePathTimeoutError';
  constructor(public readonly timeoutMs: number) {
    super(`Brave path timed out after ${timeoutMs}ms`);
  }
}

/* ------------------------------------------------------------------------- */
/* Brave response schema                                                      */
/* ------------------------------------------------------------------------- */

/**
 * Subset of the Brave Web Search v1 response. We only consume `web.results[].url`
 * + `title`; the rest is preserved by `passthrough()` so future fields don't
 * break parsing.
 */
const braveWebResultSchema = z
  .object({
    title: z.string().optional(),
    url: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough();

const braveSearchResponseSchema = z
  .object({
    web: z
      .object({
        results: z.array(braveWebResultSchema).optional(),
      })
      .optional(),
  })
  .passthrough();

/* ------------------------------------------------------------------------- */
/* URL → DefiLlama project slug mapping                                       */
/* ------------------------------------------------------------------------- */

/**
 * Known protocol-domain → DefiLlama project slug. Conservative allow-list
 * mirroring the audit cache (`yieldFilter.AUDITED_PROJECTS`) — any domain we
 * cannot confidently map is dropped rather than guessed at, per the F4
 * honesty rule.
 *
 * Keys are lower-cased URL host substrings. The first matching entry wins.
 */
const BRAVE_URL_TO_PROJECT: ReadonlyArray<readonly [string, string]> = [
  ['app.aave.com', 'aave-v3'],
  ['aave.com', 'aave-v3'],
  ['app.compound.finance', 'compound-v3'],
  ['compound.finance', 'compound-v3'],
  ['app.morpho.org', 'morpho-blue'],
  ['morpho.org', 'morpho-blue'],
  ['blue.morpho.org', 'morpho-blue'],
  ['curve.fi', 'curve'],
  ['app.uniswap.org', 'uniswap-v3'],
  ['uniswap.org', 'uniswap-v3'],
  ['stake.lido.fi', 'lido'],
  ['lido.fi', 'lido'],
  ['rocketpool.net', 'rocket-pool'],
  ['app.pendle.finance', 'pendle'],
  ['pendle.finance', 'pendle'],
  ['app.eigenlayer.xyz', 'eigenlayer'],
  ['eigenlayer.xyz', 'eigenlayer'],
  ['app.ether.fi', 'ether.fi-stake'],
  ['ether.fi', 'ether.fi-stake'],
  ['app.kelpdao.xyz', 'kelp-dao'],
  ['renzoprotocol.com', 'renzo'],
  ['ethena.fi', 'ethena-usde'],
  ['app.spark.fi', 'spark'],
  ['spark.fi', 'spark'],
  ['makerdao.com', 'maker-dsr'],
  ['oasis.app', 'maker-dsr'],
  ['app.balancer.fi', 'balancer-v2'],
  ['balancer.fi', 'balancer-v2'],
  ['app.fluid.instadapp.io', 'fluid-lending'],
  ['fluid.instadapp.io', 'fluid-lending'],
  ['gearbox.fi', 'gearbox-passive-pool'],
  ['silo.finance', 'silo-finance'],
  ['across.to', 'across-v3'],
  // DefiLlama's own protocol pages are first-class — extract slug from path.
  ['defillama.com', '__defillama_path__'],
];

const DEFILLAMA_PROTOCOL_PATH_RE = /\/protocol\/([a-z0-9.-]+)/i;

/**
 * Walk `BRAVE_URL_TO_PROJECT` and return the first matching DefiLlama slug.
 * Returns `null` when the URL is not in the allow-list — caller drops these
 * entries (we never invent a slug from a hostname pattern).
 */
function urlToProjectSlug(rawUrl: string): string | null {
  let host: string;
  let pathname: string;
  try {
    const u = new URL(rawUrl);
    host = u.host.toLowerCase();
    pathname = u.pathname.toLowerCase();
  } catch {
    return null;
  }

  for (const [needle, slug] of BRAVE_URL_TO_PROJECT) {
    if (!host.includes(needle)) continue;
    if (slug !== '__defillama_path__') return slug;
    // defillama.com → pull the slug from `/protocol/<slug>`
    const m = pathname.match(DEFILLAMA_PROTOCOL_PATH_RE);
    if (m && typeof m[1] === 'string') return m[1].toLowerCase();
    return null;
  }
  return null;
}

/* ------------------------------------------------------------------------- */
/* Public surface                                                             */
/* ------------------------------------------------------------------------- */

export interface BravePathOptions {
  /** Hard timeout for the path. Defaults to 8s (router cap). */
  timeoutMs?: number;
  /** Test seam — env override. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Test seam — alternative `fetch` impl. */
  fetchImpl?: typeof fetch;
  /** Test seam — override the Brave endpoint URL. */
  endpoint?: string;
}

/** True when the env var that gates this path is set. */
export function isBravePathEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const key = env[BRAVE_SEARCH_API_KEY_ENV];
  return Boolean(key && key.trim().length > 0);
}

/**
 * Run the Brave Search discovery path. Returns the de-duplicated set of
 * DefiLlama project slugs we extracted from the search results.
 *
 * Throws `BravePathDisabledError` when the env var is unset (router uses
 * this signal to skip). Throws `BravePathError` on HTTP / parse failures so
 * the router can record a precise `fallback_reason`.
 */
export async function runBravePath(
  intent: string,
  options: BravePathOptions = {},
): Promise<string[]> {
  const env = options.env ?? process.env;
  if (!isBravePathEnabled(env)) {
    throw new BravePathDisabledError();
  }
  const apiKey = env[BRAVE_SEARCH_API_KEY_ENV];
  if (!apiKey) {
    // Defensive — `isBravePathEnabled` already checks; this satisfies TS.
    throw new BravePathDisabledError();
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? BRAVE_SEARCH_ENDPOINT;

  const query = buildBraveQuery(intent);
  const url = `${endpoint}?q=${encodeURIComponent(query)}&count=10`;

  let res: Response;
  try {
    res = await runWithTimeout(
      fetchImpl(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'X-Subscription-Token': apiKey,
        },
      }),
      timeoutMs,
      () => new BravePathTimeoutError(timeoutMs),
    );
  } catch (err) {
    if (err instanceof BravePathTimeoutError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new BravePathError(`fetch failed: ${msg}`);
  }

  if (!res.ok) {
    throw new BravePathError(`HTTP ${res.status} ${res.statusText}`, res.status);
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new BravePathError(`response was not JSON: ${msg}`);
  }

  const parsed = braveSearchResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BravePathError(
      `response shape mismatch: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }

  const results = parsed.data.web?.results ?? [];
  const slugs = new Set<string>();
  for (const r of results) {
    if (typeof r.url !== 'string') continue;
    const slug = urlToProjectSlug(r.url);
    if (slug) slugs.add(slug);
  }
  return Array.from(slugs);
}

/**
 * Build the Brave query from the user intent. We bias the search toward
 * DeFi-yield results so we don't pollute the URL extractor with off-topic
 * pages. The original intent is preserved so chain/asset hints flow through.
 */
export function buildBraveQuery(intent: string): string {
  const trimmed = intent.trim().slice(0, 256);
  return `${trimmed} DeFi yield protocol audited site:defillama.com OR site:aave.com OR site:morpho.org OR site:lido.fi OR site:compound.finance OR site:pendle.finance OR site:eigenlayer.xyz`;
}

/** Test surface — exposed so unit tests can assert URL extraction directly. */
export const __test__ = { urlToProjectSlug, BRAVE_URL_TO_PROJECT };

/* ------------------------------------------------------------------------- */
/* Internals                                                                  */
/* ------------------------------------------------------------------------- */

function runWithTimeout<T>(promise: Promise<T>, ms: number, makeError: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(makeError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
