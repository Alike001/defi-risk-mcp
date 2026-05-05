/**
 * Audit-summary fetcher.
 *
 * Why this file is *also* called `code4rena.ts`: Code4rena is the canonical
 * source of public audit reports for the protocols we cover, but in practice
 * we cache the *synthesized* summaries (which combine Code4rena, Spearbit,
 * OpenZeppelin, Trail of Bits and others) as markdown in `data/audits/`.
 * Live scraping of code4rena.com per request is too slow + unreliable for
 * a hackathon-grade MCP, and we get a free TVL boost by curating the data
 * once and shipping it with the npm package.
 *
 * Per architecture.md ADR-005 / ADR-004, this is intentionally read-only,
 * stateless, and zero-cost.
 *
 * The cache is the source of truth for *known* protocols. Unknown protocols
 * return `null` — callers handle the no-data fallback path explicitly.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The data directory is sibling-of-`dist` after build (`data/audits/<slug>.md`)
 * and sibling-of-`src` during development. We resolve relative to this file's
 * location and walk up to the package root so both work.
 */
const DATA_DIR = join(HERE, '..', '..', 'data', 'audits');

/** Public source URLs we cite alongside cached summaries. */
const SOURCE_URLS: Record<string, string[]> = {
  'aave-v3': [
    'https://code4rena.com/reports/2022-08-aave',
    'https://blog.openzeppelin.com/aave-v3-audit',
  ],
  'compound-v3': [
    'https://code4rena.com/reports/2022-08-compound',
    'https://chainsecurity.com/security-audit/compound-iii/',
  ],
  'uniswap-v3': [
    'https://code4rena.com/reports/2021-10-uniswap-v3',
    'https://github.com/Uniswap/v3-core/blob/main/audits/tob/audit.pdf',
  ],
  morpho: [
    'https://github.com/spearbit/portfolio',
    'https://blog.openzeppelin.com/metamorpho-audit',
  ],
  pendle: [
    'https://code4rena.com/reports/2023-06-pendle',
    'https://github.com/AckeeBlockchain/audits',
  ],
  ethena: ['https://github.com/spearbit/portfolio', 'https://www.ethena.fi/'],
  lido: ['https://github.com/mixbytes/audits_public', 'https://lido.fi/'],
  eigenlayer: ['https://github.com/spearbit/portfolio', 'https://www.eigenlayer.xyz/'],
  curve: ['https://rekt.news/curve-vyper-rekt/', 'https://github.com/mixbytes/audits_public'],
  balancer: [
    'https://rekt.news/balancer-rekt-3/',
    'https://github.com/balancer/balancer-v2-monorepo/tree/master/audits',
  ],
};

export interface AuditSummary {
  protocol: string;
  /** Raw markdown summary, suitable for verbatim quoting. */
  markdown: string;
  /** Public URLs to original audit reports / disclosures. */
  sources: string[];
}

/**
 * Look up the cached audit summary for a protocol slug.
 *
 * Returns `null` when the protocol is not in the local cache. Callers MUST
 * treat null as "no audit data" and fall through to the conservative default
 * scoring path — never fabricate audit findings.
 */
export function getAuditSummary(protocolSlug: string): AuditSummary | null {
  const sources = SOURCE_URLS[protocolSlug];
  if (!sources) return null;

  const path = join(DATA_DIR, `${protocolSlug}.md`);
  let markdown: string;
  try {
    markdown = readFileSync(path, 'utf8');
  } catch (err) {
    // The slug is in our SOURCE_URLS map but the markdown file is missing.
    // This is a packaging bug, not a runtime condition — surface it loudly
    // on stderr (stdout is reserved for MCP JSON-RPC) and return null so the
    // tool falls through to the no-data path rather than crashing.
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[code4rena] missing audit cache for ${protocolSlug}: ${message}\n`);
    return null;
  }

  return { protocol: protocolSlug, markdown, sources };
}

export const KNOWN_PROTOCOLS = Object.freeze(Object.keys(SOURCE_URLS));

/** True if we have a curated audit summary for `protocolSlug`. */
export function isKnownProtocol(protocolSlug: string): boolean {
  return Object.hasOwn(SOURCE_URLS, protocolSlug);
}
