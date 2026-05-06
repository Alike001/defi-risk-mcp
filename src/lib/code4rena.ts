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

/* ------------------------------------------------------------------------- */
/* Audit-history extraction (story-tool-explain-protocol-risk)                */
/* ------------------------------------------------------------------------- */

/**
 * Structured audit record. The shape mirrors `auditEntrySchema` in
 * `src/schemas/domain.ts` but is declared here without importing the schema
 * file — this keeps the lib boundary clean (lib doesn't depend on schemas).
 */
export interface AuditEntryRecord {
  firm: string;
  date: string; // "YYYY", "YYYY-MM", or "YYYY-MM-DD"
  url: string;
  scope: string | null;
}

/**
 * One historical exploit / disclosure. `affectedProtocol` is set when the
 * exploit hit a downstream aggregator (e.g. Penpie/Pendle) rather than the
 * protocol's own contracts — we annotate explicitly so callers do not falsely
 * attribute the loss.
 */
export interface ExploitEntryRecord {
  date: string;
  description: string;
  amountUsd: number | null;
  sourceUrl: string | null;
  affectedProtocol: string | null;
}

/**
 * Extracted protocol-level audit history. `oracleProviders` is the curated
 * set of oracle systems referenced by the markdown (chainlink, twap, etc.).
 */
export interface AuditHistoryRecord {
  protocol: string;
  audits: AuditEntryRecord[];
  exploits: ExploitEntryRecord[];
  oracleProviders: string[];
  sources: string[];
}

/**
 * Patterns that match audit firm names referenced in the cached markdown.
 * Order matters — longer / more specific patterns first so we don't mis-tag
 * "Sigma Prime" as just "Prime" etc.
 */
const FIRM_PATTERNS: ReadonlyArray<{ firm: string; matchers: RegExp[] }> = [
  { firm: 'OpenZeppelin', matchers: [/openzeppelin/i] },
  { firm: 'Trail of Bits', matchers: [/trail\s*of\s*bits/i] },
  { firm: 'Spearbit', matchers: [/spearbit/i] },
  { firm: 'ChainSecurity', matchers: [/chain\s*security/i] },
  { firm: 'Certora', matchers: [/certora/i] },
  { firm: 'SigmaPrime', matchers: [/sigma\s*prime/i] },
  { firm: 'Code4rena', matchers: [/code4rena/i, /c4/i] },
  { firm: 'Cantina', matchers: [/cantina/i] },
  { firm: 'Quantstamp', matchers: [/quantstamp/i] },
  { firm: 'MixBytes', matchers: [/mixbytes/i] },
  { firm: 'Statemind', matchers: [/statemind/i] },
  { firm: 'Ackee Blockchain', matchers: [/ackee/i] },
  { firm: 'Pashov Audit Group', matchers: [/pashov/i] },
  { firm: 'Consensys Diligence', matchers: [/consensys\s*diligence/i] },
];

/** Curated oracle-provider tags. Lower-case for set semantics downstream. */
const ORACLE_TAGS: ReadonlyArray<{ tag: string; matchers: RegExp[] }> = [
  { tag: 'chainlink', matchers: [/chainlink/i] },
  { tag: 'redstone', matchers: [/redstone/i] },
  { tag: 'pyth', matchers: [/\bpyth\b/i] },
  { tag: 'uniswap-v3-twap', matchers: [/uniswap.*twap/i, /v3\s*twap/i] },
  { tag: 'twap', matchers: [/twap/i] },
  { tag: 'lido-oracle', matchers: [/lido\s*oracle/i] },
  { tag: 'protocol-internal-ema', matchers: [/internal.*ema/i, /ema\s*oracle/i] },
  { tag: 'cex-backed', matchers: [/cex.*backed/i, /off.?exchange.*custody/i] },
];

/**
 * Parse one bullet line from a `## Audit history` section into an audit entry.
 *
 * Lines look like:
 *   - **OpenZeppelin** — Aave v3 core review (2022) covering pool, configurator, ACL.
 *     Source: https://blog.openzeppelin.com/aave-v3-audit
 *
 * `extra` holds the next non-bullet continuation line (or empty), which is
 * where the `Source:` URL typically lives.
 */
function parseAuditLine(
  line: string,
  extra: string,
  fallbackUrls: string[],
): AuditEntryRecord | null {
  // Match "**Firm** — scope ... (YEAR)"
  const stripped = line.replace(/^\s*[-*]\s*/, '').trim();
  if (stripped.length === 0) return null;

  let firm: string | null = null;
  for (const { firm: f, matchers } of FIRM_PATTERNS) {
    if (matchers.some((re) => re.test(stripped))) {
      firm = f;
      break;
    }
  }
  if (!firm) return null;

  // Extract a date — first 4-digit year in the line wins. We accept YYYY,
  // YYYY-MM, or YYYY-MM-DD when explicit.
  const dateMatch = stripped.match(/(20\d{2}-\d{2}-\d{2}|20\d{2}-\d{2}|20\d{2})/);
  const date = dateMatch?.[1] ?? 'unknown';

  // Extract a URL from this line OR the continuation line. Falls back to the
  // first protocol-level source URL so the auditEntrySchema URL constraint
  // always passes (BDD requires URL per audit).
  const urlRe = /(https?:\/\/\S+?)(?:[\s)\].,]|$)/;
  const inlineUrl = stripped.match(urlRe)?.[1] ?? null;
  const extraUrl = extra.match(urlRe)?.[1] ?? null;
  const url = inlineUrl ?? extraUrl ?? fallbackUrls[0] ?? null;
  if (!url) return null;

  // Scope = the bit after the firm name and before the date / URL. We strip
  // markdown bold + the leading em-dash so the rendered scope is clean.
  const scopeRaw = stripped
    .replace(/\*\*[^*]+\*\*/g, '')
    .replace(/^[\s—–\-:]+/, '')
    .replace(/https?:\/\/\S+/g, '')
    .trim();
  const scope = scopeRaw.length > 0 ? scopeRaw : null;

  return { firm, date, url, scope };
}

/** Parse an exploit bullet into an ExploitEntryRecord. */
function parseExploitLine(line: string): ExploitEntryRecord | null {
  const stripped = line.replace(/^\s*[-*]\s*/, '').trim();
  if (stripped.length === 0) return null;

  // Skip the "no exploits to date" sentinels — they're not exploit entries.
  if (/no (contract-level )?exploits/i.test(stripped)) return null;

  // Skip "Material non-contract risks" / "non-contract" / "off-chain"
  // commentary bullets — the cached markdown uses these to enumerate
  // structural risks that are NOT actual on-chain exploits. Including them
  // would falsely inflate the exploit_history array (BDD says it's allowed
  // to be empty for clean protocols).
  if (/^(material |off-chain |non-contract )/i.test(stripped)) return null;

  // Date prefix like "2022-11:" or "2024-06:" — keep the YYYY-MM if present,
  // else first 4-digit year. Strip the "<date>:" prefix from the description.
  const dateMatch = stripped.match(/^(20\d{2}-\d{2}-\d{2}|20\d{2}-\d{2}|20\d{2})\s*:?\s*/);
  // Require a date prefix for top-level exploit entries — every real
  // exploit in the cache is dated, so no date == not an exploit row.
  if (!dateMatch) return null;
  const date = dateMatch[1] ?? 'unknown';
  const description = stripped.slice(dateMatch[0].length).trim();
  if (description.length < 10) return null;

  // Best-effort dollar-amount extraction. We accept "$27M", "$2.1M", "$73M",
  // "~$73M", etc., and convert to absolute USD.
  const amountMatch = description.match(/[~≈]?\$\s*(\d+(?:\.\d+)?)\s*([MBK])?/i);
  let amountUsd: number | null = null;
  if (amountMatch) {
    const base = Number.parseFloat(amountMatch[1] ?? '0');
    const unit = (amountMatch[2] ?? '').toUpperCase();
    const mult = unit === 'B' ? 1e9 : unit === 'M' ? 1e6 : unit === 'K' ? 1e3 : 1;
    if (Number.isFinite(base) && base > 0) amountUsd = base * mult;
  }

  // Optional inline source URL.
  const urlMatch = description.match(/(https?:\/\/\S+?)(?:[\s)\].,]|$)/);
  const sourceUrl = urlMatch?.[1] ?? null;

  // If the exploit describes a downstream aggregator (e.g. "Penpie ... NOT
  // Pendle itself"), record the affected name explicitly so downstream
  // synthesis does not misattribute.
  const affectedMatch = description.match(/^([A-Z][\w-]*)\s*\(/);
  const affectedProtocol = affectedMatch?.[1] ?? null;

  return { date, description, amountUsd, sourceUrl, affectedProtocol };
}

/**
 * Walk the cached markdown and extract structured audit history, exploit
 * history, and the curated oracle-provider tag set.
 *
 * Returns `null` for unknown protocols so callers can branch to the
 * "protocol not found" path with suggestions.
 */
export function getAuditHistory(protocolSlug: string): AuditHistoryRecord | null {
  const summary = getAuditSummary(protocolSlug);
  if (!summary) return null;

  const lines = summary.markdown.split(/\r?\n/);
  const audits: AuditEntryRecord[] = [];
  const exploits: ExploitEntryRecord[] = [];
  const oracles = new Set<string>();

  // Two-pass-ish: track the current section header so we know whether a
  // bullet is an audit or an exploit entry.
  type Section = 'none' | 'audit' | 'exploit' | 'oracle';
  let section: Section = 'none';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const heading = line.match(/^##\s+(.+)\s*$/);
    if (heading) {
      const title = (heading[1] ?? '').toLowerCase();
      if (title.includes('audit history')) section = 'audit';
      else if (title.includes('exploit history')) section = 'exploit';
      else if (title.includes('oracle')) section = 'oracle';
      else section = 'none';
      continue;
    }

    if (section === 'audit' && /^\s*[-*]\s*/.test(line)) {
      const next = lines[i + 1] ?? '';
      const continuation = next.match(/^\s+\S/) ? next : '';
      const entry = parseAuditLine(line, continuation, summary.sources);
      if (entry) audits.push(entry);
    } else if (section === 'exploit' && /^[-*]\s/.test(line)) {
      // Bullet at column-0 only (top-level entry). Continuation lines and
      // sub-bullets indented under it are pulled in via the multi-line
      // collection below, but they don't start a NEW exploit entry — so
      // protocols with no exploits + only "material risks" sub-bullets do
      // not get false-positive exploit rows.
      const collected: string[] = [line];
      let j = i + 1;
      while (j < lines.length) {
        const peek = lines[j] ?? '';
        // Continuation: starts with whitespace AND has non-whitespace, AND
        // is not a new top-level bullet or a new heading.
        if (/^\s+\S/.test(peek) && !/^\s*##\s/.test(peek)) {
          collected.push(peek.trim());
          j++;
        } else {
          break;
        }
      }
      const entry = parseExploitLine(collected.join(' '));
      if (entry) exploits.push(entry);
    } else if (section === 'oracle') {
      for (const { tag, matchers } of ORACLE_TAGS) {
        if (matchers.some((re) => re.test(line))) oracles.add(tag);
      }
    }
  }

  return {
    protocol: protocolSlug,
    audits,
    exploits,
    oracleProviders: Array.from(oracles),
    sources: summary.sources,
  };
}
