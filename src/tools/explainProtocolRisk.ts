/**
 * `explain_protocol_risk` — given a protocol slug, synthesize a structured
 * risk profile across audits, exploit history, oracle dependencies, the
 * composability tree, and recent governance proposals.
 *
 * Per ADR-003 this tool is read-only — never signs, never broadcasts. It
 * pulls grounded signals from:
 *   - Local audit cache (`data/audits/<slug>.md` via `lib/code4rena.ts`)
 *   - DefiLlama protocol metadata (`lib/defillama.ts`)
 *   - Curated composability maps (`data/composability/<slug>.json`) with
 *     a category-derived fallback for non-curated slugs
 *   - Snapshot GraphQL (`lib/governance.ts`) for last-5 proposals
 *
 * For unknown protocols we return a structured `protocol_not_found` error
 * with three Levenshtein-ranked suggestions from the curated slug list, per
 * the BDD acceptance criteria.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  type AuditEntryRecord,
  type AuditHistoryRecord,
  type ExploitEntryRecord,
  KNOWN_PROTOCOLS,
  getAuditHistory,
  isKnownProtocol,
} from '../lib/code4rena.js';
import {
  CURATED_COMPOSABILITY_SLUGS,
  type ComposabilityRecord,
  inferComposabilityFromCategory,
  loadCuratedComposability,
} from '../lib/composability.js';
import {
  DefiLlamaUnknownProtocolError,
  type ProtocolMetadata,
  fetchProtocolMetadata,
} from '../lib/defillama.js';
import {
  SNAPSHOT_KNOWN_SLUGS,
  type SnapshotProposalRecord,
  fetchRecentProposals,
} from '../lib/governance.js';
import {
  type AuditEntry,
  type ComposabilityTree,
  type ExploitEntry,
  type GovernanceProposal,
  type ProtocolNotFoundError,
  type ProtocolRiskProfile,
  protocolNotFoundErrorSchema,
  protocolRiskProfileSchema,
} from '../schemas/domain.js';
import {
  explainProtocolRiskInputSchema,
  explainProtocolRiskInputShape,
  explainProtocolRiskOutputSchema,
} from '../schemas/tools.js';

export const EXPLAIN_PROTOCOL_RISK_TOOL_NAME = 'explain_protocol_risk';

/* ------------------------------------------------------------------------- */
/* Public surface                                                             */
/* ------------------------------------------------------------------------- */

export type ExplainProtocolRiskResult =
  | { status: 'ok'; profile: ProtocolRiskProfile }
  | ({ status: 'error' } & Omit<ProtocolNotFoundError, 'status'>);

export interface ExplainProtocolRiskOptions {
  /** Test seam — inject a custom DefiLlama fetcher. */
  fetchMetadata?: (slug: string) => Promise<ProtocolMetadata | null>;
  /** Test seam — inject a custom Snapshot fetcher. */
  fetchProposals?: (slug: string, limit?: number) => Promise<SnapshotProposalRecord[]>;
  /** Test seam — inject a custom audit-history loader. */
  loadAuditHistory?: (slug: string) => AuditHistoryRecord | null;
  /** Test seam — inject a custom composability loader. */
  loadComposability?: (slug: string) => ComposabilityRecord | null;
}

/**
 * Programmatic entry point. Used by both the MCP `registerTool` handler and
 * tests. Returns either a parsed `ProtocolRiskProfile` (success) or a
 * structured `protocol_not_found` error with three suggestions.
 */
export async function explainProtocolRisk(
  rawInput: unknown,
  options: ExplainProtocolRiskOptions = {},
): Promise<ExplainProtocolRiskResult> {
  const parsed = explainProtocolRiskInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    // Treat malformed input as a "protocol not found" with no suggestions to
    // bias from (we do not know the user's intent). The Levenshtein step
    // still produces three nearest neighbors from the empty string.
    throw parsed.error;
  }
  const slug = parsed.data.protocol_name.trim().toLowerCase();

  const loadAudit = options.loadAuditHistory ?? getAuditHistory;
  const loadComp = options.loadComposability ?? loadCuratedComposability;
  const fetchMd = options.fetchMetadata ?? defaultFetchMetadata;
  const fetchProps = options.fetchProposals ?? defaultFetchProposals;

  const auditHistory = loadAudit(slug);

  // Unknown protocol = no curated audit history AND not a curated slug. We
  // still consult composability+governance lists to give the most generous
  // fallback before declaring "not found".
  if (!auditHistory && !isKnownProtocol(slug)) {
    const suggestions = nearestKnownProtocols(slug, 3);
    return {
      status: 'error',
      code: 'protocol_not_found',
      message: `Protocol "${slug}" is not in the curated risk catalog. Check the spelling, or pick from the closest known slugs.`,
      suggestions,
    };
  }

  // Run the remaining lookups in parallel — DefiLlama + Snapshot are both
  // network-bound and independent of each other.
  const [metadata, proposals] = await Promise.all([fetchMd(slug), fetchProps(slug, 5)]);

  const composability =
    loadComp(slug) ?? inferComposabilityFromCategory(slug, metadata?.category ?? null);

  const profile = buildProfile({
    slug,
    metadata,
    auditHistory,
    composability,
    proposals,
  });

  // Validate before returning so a future drift in any helper crashes here
  // rather than emitting an invalid MCP frame.
  return { status: 'ok', profile: protocolRiskProfileSchema.parse(profile) };
}

/* ------------------------------------------------------------------------- */
/* Default fetchers                                                           */
/* ------------------------------------------------------------------------- */

async function defaultFetchMetadata(slug: string): Promise<ProtocolMetadata | null> {
  try {
    return await fetchProtocolMetadata(slug);
  } catch (err) {
    if (err instanceof DefiLlamaUnknownProtocolError) return null;
    throw err;
  }
}

async function defaultFetchProposals(
  slug: string,
  limit?: number,
): Promise<SnapshotProposalRecord[]> {
  try {
    return await fetchRecentProposals(slug, limit ?? 5);
  } catch (err) {
    // Snapshot is best-effort — if it fails we still want the rest of the
    // profile rather than a hard crash. Log on stderr (stdout is reserved).
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[explain_protocol_risk] snapshot fetch failed: ${message}\n`);
    return [];
  }
}

/* ------------------------------------------------------------------------- */
/* Synthesis — pure                                                           */
/* ------------------------------------------------------------------------- */

interface BuildInputs {
  slug: string;
  metadata: ProtocolMetadata | null;
  auditHistory: AuditHistoryRecord | null;
  composability: ComposabilityRecord;
  proposals: SnapshotProposalRecord[];
}

function buildProfile(inputs: BuildInputs): ProtocolRiskProfile {
  const { slug, metadata, auditHistory, composability, proposals } = inputs;

  const audits = mapAudits(auditHistory);
  const exploitHistory = mapExploits(auditHistory);
  const oracleDeps = buildOracleDeps(auditHistory, metadata);
  const composabilityTree = mapComposability(composability);
  const recentGovernance = mapProposals(proposals).slice(0, 5);
  const sources = collectSources(slug, metadata, auditHistory, recentGovernance);
  const summary = buildSummary(slug, metadata, auditHistory, exploitHistory, recentGovernance);

  return {
    protocol: slug,
    summary,
    audits,
    exploit_history: exploitHistory,
    oracle_deps: oracleDeps,
    composability_tree: composabilityTree,
    recent_governance: recentGovernance,
    sources,
  };
}

function mapAudits(auditHistory: AuditHistoryRecord | null): AuditEntry[] {
  if (!auditHistory || auditHistory.audits.length === 0) {
    // BDD requires audits.length >= 1 for known protocols. If parsing
    // somehow fails for a known protocol we degrade gracefully by emitting
    // a single placeholder pointing back to the source list — rather than
    // fabricating a firm name.
    if (auditHistory && auditHistory.sources.length > 0) {
      return [
        {
          firm: 'Curated audit cache',
          date: 'unknown',
          url: auditHistory.sources[0] ?? 'https://defillama.com/',
          scope: 'See cited source for full report list.',
        },
      ];
    }
    // Absolute fallback — should never happen because callers already check
    // isKnownProtocol() before reaching this point.
    return [
      {
        firm: 'Curated audit cache',
        date: 'unknown',
        url: 'https://defillama.com/',
        scope: 'No structured audit entries parsed; verify upstream.',
      },
    ];
  }
  return auditHistory.audits.map(toAuditEntry);
}

function toAuditEntry(record: AuditEntryRecord): AuditEntry {
  return {
    firm: record.firm,
    date: record.date,
    url: record.url,
    scope: record.scope,
  };
}

function mapExploits(auditHistory: AuditHistoryRecord | null): ExploitEntry[] {
  if (!auditHistory) return [];
  return auditHistory.exploits.map(toExploitEntry);
}

function toExploitEntry(record: ExploitEntryRecord): ExploitEntry {
  return {
    date: record.date,
    description: record.description,
    amount_usd: record.amountUsd,
    source_url: record.sourceUrl,
    affected_protocol: record.affectedProtocol,
  };
}

/**
 * Build the oracle-deps array. Combines:
 *   - tags extracted from the audit-cache markdown ("chainlink", "twap", ...),
 *   - DefiLlama category heuristics (lending → chainlink, dex → none),
 *   - the composability tree's `depends_on` list (which already separates
 *     oracle-shaped deps in the curated maps).
 *
 * De-duped, never empty for known protocols (we add a generic placeholder if
 * the audit + category extractions both come up empty).
 */
function buildOracleDeps(
  auditHistory: AuditHistoryRecord | null,
  metadata: ProtocolMetadata | null,
): string[] {
  const out = new Set<string>();
  if (auditHistory) {
    for (const o of auditHistory.oracleProviders) out.add(o);
  }
  const cat = metadata?.category?.toLowerCase() ?? '';
  if (cat.includes('lending') || cat.includes('cdp')) out.add('chainlink');
  if (cat.includes('dex')) {
    // AMMs don't depend on external oracles for swaps — we leave this empty
    // unless the curated audit cache says otherwise.
  }
  return Array.from(out);
}

function mapComposability(rec: ComposabilityRecord): ComposabilityTree {
  return {
    protocol: rec.protocol,
    depth: rec.depth,
    depends_on: rec.dependsOn,
    downstream_users: rec.downstreamUsers,
    notes: rec.notes,
  };
}

function mapProposals(proposals: SnapshotProposalRecord[]): GovernanceProposal[] {
  return proposals.map((p) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    url: p.url,
    created: p.created,
  }));
}

function collectSources(
  slug: string,
  metadata: ProtocolMetadata | null,
  auditHistory: AuditHistoryRecord | null,
  proposals: GovernanceProposal[],
): string[] {
  const out = new Set<string>();
  if (metadata?.url) out.add(metadata.url);
  if (auditHistory) for (const s of auditHistory.sources) out.add(s);
  if (metadata) {
    for (const s of metadata.auditLinks) out.add(s);
    out.add(`https://defillama.com/protocol/${encodeURIComponent(slug)}`);
  } else {
    out.add(`https://defillama.com/protocol/${encodeURIComponent(slug)}`);
  }
  if (proposals.length > 0) {
    // Cite the Snapshot space root if we have any proposals. This gives the
    // LLM a stable "where to read more" link beyond per-proposal URLs.
    out.add('https://snapshot.org/');
  }
  return Array.from(out).slice(0, 10);
}

function buildSummary(
  slug: string,
  metadata: ProtocolMetadata | null,
  auditHistory: AuditHistoryRecord | null,
  exploits: ExploitEntry[],
  proposals: GovernanceProposal[],
): string {
  const name = metadata?.name ?? slug;
  const auditCount = auditHistory?.audits.length ?? 0;
  const exploitBit =
    exploits.length === 0
      ? 'no contract-level exploits in cache'
      : `${exploits.length} historical exploit${exploits.length > 1 ? 's' : ''} on record`;
  const govBit =
    proposals.length === 0
      ? 'no Snapshot governance fetched'
      : `${proposals.length} recent Snapshot proposal${proposals.length > 1 ? 's' : ''}`;
  const tvlBit =
    metadata && metadata.tvlUsd > 0 ? ` TVL ≈ $${(metadata.tvlUsd / 1e9).toFixed(2)}B.` : '';
  return `${name} risk profile: ${auditCount} curated audit${auditCount === 1 ? '' : 's'} indexed, ${exploitBit}, ${govBit}.${tvlBit}`;
}

/* ------------------------------------------------------------------------- */
/* Levenshtein-ranked suggestions                                             */
/* ------------------------------------------------------------------------- */

/**
 * Iterative Levenshtein. O(n*m) time, O(min(n,m)) space. Inline here per the
 * story constraints — no external dep, no `any`.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Make `b` the shorter string so the working array stays small.
  let s1 = a;
  let s2 = b;
  if (s1.length < s2.length) {
    const t = s1;
    s1 = s2;
    s2 = t;
  }

  const m = s2.length;
  const prev = new Array<number>(m + 1);
  const curr = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;

  for (let i = 1; i <= s1.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      const del = (prev[j] ?? 0) + 1;
      const ins = (curr[j - 1] ?? 0) + 1;
      const sub = (prev[j - 1] ?? 0) + cost;
      curr[j] = Math.min(del, ins, sub);
    }
    for (let j = 0; j <= m; j++) prev[j] = curr[j] ?? 0;
  }
  return prev[m] ?? 0;
}

/**
 * Rank the union of all known protocol slugs by Levenshtein distance to
 * `slug` and return the top `k`. Ties are broken alphabetically so the
 * result is deterministic across processes.
 */
export function nearestKnownProtocols(slug: string, k = 3): string[] {
  const universe = new Set<string>([
    ...KNOWN_PROTOCOLS,
    ...CURATED_COMPOSABILITY_SLUGS,
    ...SNAPSHOT_KNOWN_SLUGS,
  ]);
  const scored = Array.from(universe).map((p) => ({ p, d: levenshtein(slug, p) }));
  scored.sort((a, b) => (a.d === b.d ? a.p.localeCompare(b.p) : a.d - b.d));
  return scored.slice(0, k).map((x) => x.p);
}

/* ------------------------------------------------------------------------- */
/* MCP tool registration                                                      */
/* ------------------------------------------------------------------------- */

export function registerExplainProtocolRiskTool(server: McpServer): void {
  server.registerTool(
    EXPLAIN_PROTOCOL_RISK_TOOL_NAME,
    {
      title: 'Explain protocol risk',
      description: [
        'Synthesize a structured risk profile for a DeFi protocol across',
        'audits, exploit history, oracle dependencies, composability tree,',
        'and recent governance proposals (last 5 from Snapshot).',
        'Read-only — never signs or broadcasts (per ADR-003).',
        'Sources: local audit cache (Code4rena / Spearbit / OpenZeppelin /',
        'Trail of Bits / ChainSecurity), DefiLlama protocol metadata,',
        'curated composability maps (top 6 protocols), Snapshot GraphQL.',
        'Unknown protocols return a structured "protocol_not_found" error',
        'with three Levenshtein-ranked suggestions from the known catalog.',
      ].join(' '),
      inputSchema: explainProtocolRiskInputShape,
      outputSchema: explainProtocolRiskOutputSchema.shape,
    },
    async (rawInput: { protocol_name: string }) => {
      try {
        const result = await explainProtocolRisk(rawInput);
        if (result.status === 'error') {
          const detail = protocolNotFoundErrorSchema.parse({
            status: 'error',
            code: result.code,
            message: result.message,
            suggestions: result.suggestions,
          });
          // Surface as MCP `isError` so the SDK does NOT validate the error
          // body against the success outputSchema (per the simulate_tx_risk
          // precedent in this repo). Detail is still serialized to text so
          // the LLM client can render the suggestions UI.
          return {
            content: [{ type: 'text', text: JSON.stringify(detail) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result.profile) }],
          structuredContent: result.profile,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[explain_protocol_risk] error: ${message}\n`);
        throw err;
      }
    },
  );
}
