/**
 * Rekt News RSS parser.
 *
 * Source: https://rekt.news/rss/feed.xml — verified live 2026-05-05 (HTTP 200,
 * `application/xml`, ~10KB). Note: the URL listed in the story file
 * (`/rss.xml`) returns HTTP 500; the actual feed lives at `/rss/feed.xml`. The
 * canonical URL is exported so the tool surface and any future docs share one
 * source of truth.
 *
 * Parser strategy: zero-dependency, regex-based. Rekt's feed is a simple RSS
 * 2.0 channel with `<item>` elements that carry `<title>`, `<link>`,
 * `<pubDate>` and `<description>` (plus an optional `<content:encoded>` we
 * ignore — descriptions are already a clean one-paragraph summary). Adding a
 * full XML parser dependency for this would be overkill given the feed is
 * 7–50 items long.
 *
 * Per architecture.md banned patterns: no `any`, no `console.log`, no
 * swallowed errors. Network failures throw `RektFeedError` — the tool layer
 * decides whether to degrade gracefully (we do — see `getRecentExploits.ts`).
 *
 * Read-only and free-tier per ADR-005. The fetch carries a UA so Rekt's CDN
 * does not 403 us as a generic bot.
 */

export const REKT_FEED_URL = 'https://rekt.news/rss/feed.xml';

/** Internal raw shape — one `<item>` from the RSS document. */
export interface RektFeedItem {
  /** Headline as printed in the feed (CDATA already stripped). */
  title: string;
  /** Article URL. Always uses the rekt.news domain. */
  link: string;
  /** ISO-8601 UTC date string. We normalise from the RFC-822 pubDate. */
  pubDateIso: string;
  /** One-paragraph editorial summary from `<description>`. */
  description: string;
}

export interface RektClientOptions {
  fetchImpl?: typeof fetch;
  /** Override endpoint (tests). */
  endpoint?: string;
  /** AbortSignal for the network call. */
  signal?: AbortSignal;
}

export class RektFeedError extends Error {
  override readonly name = 'RektFeedError';
}

/**
 * Fetch the live Rekt RSS feed and return parsed items.
 *
 * Throws `RektFeedError` on network failure, non-2xx HTTP, or when no `<item>`
 * elements are found. Empty arrays are NOT a parse-success — Rekt always
 * publishes ≥ 5 items, so an empty result indicates upstream drift and the
 * caller should treat it as a failure (we throw rather than silently returning
 * `[]` and pretending the feed is healthy).
 */
export async function fetchRektFeed(options: RektClientOptions = {}): Promise<RektFeedItem[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = options.endpoint ?? REKT_FEED_URL;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        accept: 'application/rss+xml, application/xml, text/xml',
        // Rekt's edge does 403 generic curl-like UAs; a real-browser-shaped
        // string is fine and is what every RSS reader (Feedly, Reeder) sends.
        'user-agent': 'defi-risk-mcp/0.1.0 (+https://github.com/Alike001/defi-risk-mcp)',
      },
      signal: options.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new RektFeedError(`Rekt fetch failed: ${message}`);
  }

  if (!res.ok) {
    throw new RektFeedError(`Rekt ${url} → HTTP ${res.status} ${res.statusText}`);
  }

  const xml = await res.text();
  const items = parseRektXml(xml);
  if (items.length === 0) {
    throw new RektFeedError(`Rekt feed parsed to 0 items (URL: ${url})`);
  }
  return items;
}

/**
 * Parse a Rekt-shaped RSS 2.0 document into items. Tolerates malformed input:
 * any individual item missing one of (title, link, pubDate) is skipped — the
 * remaining items are still returned. This satisfies the BDD criterion
 * "malformed RSS recovers gracefully".
 *
 * Exported so tests can drive the parser directly off the on-disk fixture
 * without touching the network.
 */
export function parseRektXml(xml: string): RektFeedItem[] {
  // Match each `<item>...</item>` block. RSS items in Rekt's feed never nest.
  const ITEM_RE = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  const out: RektFeedItem[] = [];

  for (const match of xml.matchAll(ITEM_RE)) {
    const inner = match[1] ?? '';
    const title = extractCdata(inner, 'title');
    const link = extractText(inner, 'link');
    const pubDateRaw = extractText(inner, 'pubDate');
    const description = extractCdata(inner, 'description');

    if (!title || !link || !pubDateRaw) continue;

    const ts = Date.parse(pubDateRaw);
    if (Number.isNaN(ts)) continue;
    const pubDateIso = new Date(ts).toISOString();

    out.push({
      title: title.trim(),
      link: link.trim(),
      pubDateIso,
      description: (description ?? '').trim(),
    });
  }

  return out;
}

/* ------------------------------------------------------------------------- */
/* Local helpers                                                              */
/* ------------------------------------------------------------------------- */

/**
 * Extract the inner text of `<tag>...</tag>` — CDATA-aware. Rekt wraps every
 * title and description in `<![CDATA[...]]>` so we strip those wrappers when
 * present. Returns `null` if the tag is absent or empty.
 */
function extractCdata(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(xml);
  if (!m) return null;
  const raw = m[1] ?? '';
  const cdataMatch = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  const value = cdataMatch ? (cdataMatch[1] ?? '') : raw;
  return value.length === 0 ? null : value;
}

/**
 * Extract the inner text of a tag without CDATA unwrapping (used for
 * `<link>` and `<pubDate>` which Rekt emits as plain text).
 */
function extractText(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(xml);
  if (!m) return null;
  const v = (m[1] ?? '').trim();
  return v.length === 0 ? null : v;
}
