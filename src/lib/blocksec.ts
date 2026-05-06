/**
 * BlockSec public alert fetcher.
 *
 * Story Notes spec: "prefer RSS if available; otherwise use sahil-x burner with
 * handle `@BlockSecTeam`." Plus the hard rule: "BlockSec fallback: if no public
 * RSS exists at the time of build, ship the tool Rekt-only and document the
 * gap honestly in the tool description + PR body. Do NOT invent a fake
 * BlockSec endpoint."
 *
 * Reality at build time (verified 2026-05-05):
 *   - https://blocksec.com/                → 200 OK, no `rss`/`feed`/`atom` link in markup
 *   - https://blocksec.com/blog            → 200 OK, no public RSS endpoint
 *   - https://app.blocksec.com/{rss,feed}  → 404
 *   - https://phalcon.blocksec.com/{rss,feed} → 404
 *   - https://metasleuth.io/{rss,feed}     → 404
 *
 * The X scrape fallback (sahil-x burner) is brittle and explicitly out of scope
 * for the auto-pass tests per the story's "deferred manual" line — pulling
 * tweets in tests would require a session cookie checked into the repo, which
 * we will not do. We therefore ship the tool Rekt-only and:
 *
 *   1) Surface this honestly via `BLOCKSEC_STATUS` so the tool description +
 *      MCP `sources_used` array can declare the gap to the LLM client.
 *   2) Keep the public function signature ready for the day a real RSS
 *      endpoint exists — tests inject a fake fetcher to validate that the
 *      dedupe + merge code path works end-to-end.
 *
 * Per architecture.md banned patterns: no `any`, no `console.log`, no swallowed
 * errors. Errors raise `BlockSecFeedError`; the tool layer chooses to degrade.
 */

/**
 * Public status of the BlockSec integration. The tool layer reads this so the
 * `sources_used` field and tool description never lie about coverage.
 */
export const BLOCKSEC_STATUS = Object.freeze({
  enabled: false,
  reason:
    'No public BlockSec RSS endpoint discoverable at build time (verified 2026-05-05). X-scrape fallback is intentionally not auto-tested — see src/lib/blocksec.ts header.',
} as const);

export interface BlockSecAlert {
  /** ISO-8601 UTC date string. */
  dateIso: string;
  /** Best-effort protocol slug. */
  protocol: string;
  /** USD loss estimate. `0` when unknown. */
  amountUsd: number;
  /** Public URL to the alert. */
  url: string;
  /** Plain-English summary, ≥30 chars. */
  summary: string;
  /** Lower-cased EVM chain slugs the alert mentions. May be empty. */
  chains: string[];
}

export interface BlockSecClientOptions {
  fetchImpl?: typeof fetch;
  /** Override endpoint. When unset, the function returns `[]` because no public endpoint exists. */
  endpoint?: string | null;
  signal?: AbortSignal;
}

export class BlockSecFeedError extends Error {
  override readonly name = 'BlockSecFeedError';
}

/**
 * Fetch BlockSec public alerts.
 *
 * Default behaviour (no `endpoint` passed) returns `[]` deterministically so
 * the tool ships Rekt-only without any risk of silent fabrication. Tests pass
 * an `endpoint` + a `fetchImpl` that returns a known JSON payload to exercise
 * the parser and dedupe path.
 *
 * If a real public BlockSec RSS endpoint surfaces post-launch, replace the
 * default `endpoint` value here and add the parser inline. The function
 * signature already returns the shape the tool consumes.
 */
export async function fetchBlockSecAlerts(
  options: BlockSecClientOptions = {},
): Promise<BlockSecAlert[]> {
  const endpoint = options.endpoint ?? null;
  if (endpoint === null) {
    // Honest no-op. Documented above.
    return [];
  }

  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        accept: 'application/json, application/rss+xml, application/xml',
        'user-agent': 'defi-risk-mcp/0.1.0 (+https://github.com/Alike001/defi-risk-mcp)',
      },
      signal: options.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new BlockSecFeedError(`BlockSec fetch failed: ${message}`);
  }

  if (!res.ok) {
    throw new BlockSecFeedError(`BlockSec ${endpoint} → HTTP ${res.status} ${res.statusText}`);
  }

  // The shape is forward-looking — adapt when a real endpoint exists. For now
  // we accept a JSON array of alert records keyed by the same field names the
  // dedupe path consumes. This lets the tests inject a stub without dragging
  // in a real parser today.
  const raw: unknown = await res.json();
  return parseBlockSecJson(raw);
}

/**
 * Tolerant JSON parser for the placeholder BlockSec response shape. Skips
 * malformed entries instead of throwing — same posture as `parseRektXml`.
 *
 * Exported so tests can validate parser robustness without a network call.
 */
export function parseBlockSecJson(raw: unknown): BlockSecAlert[] {
  if (!Array.isArray(raw)) return [];
  const out: BlockSecAlert[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const rec = entry as Record<string, unknown>;
    const dateIso = typeof rec.dateIso === 'string' ? rec.dateIso : null;
    const protocol = typeof rec.protocol === 'string' ? rec.protocol.trim() : null;
    const amountUsd = typeof rec.amountUsd === 'number' && rec.amountUsd >= 0 ? rec.amountUsd : 0;
    const url = typeof rec.url === 'string' ? rec.url : null;
    const summary = typeof rec.summary === 'string' ? rec.summary : null;
    const chains = Array.isArray(rec.chains)
      ? rec.chains.filter((c): c is string => typeof c === 'string').map((c) => c.toLowerCase())
      : [];

    if (!dateIso || !protocol || !url || !summary) continue;
    if (Number.isNaN(Date.parse(dateIso))) continue;

    out.push({ dateIso, protocol, amountUsd, url, summary, chains });
  }
  return out;
}
