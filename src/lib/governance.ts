/**
 * Snapshot governance fetcher.
 *
 * Snapshot exposes a public GraphQL endpoint at https://hub.snapshot.org/graphql
 * — no API key required (per architecture.md ADR-005, free-tier APIs only).
 *
 * Per protocol we map the slug to the canonical Snapshot space (e.g.
 * `aave.eth`, `lido-snapshot.eth`) and fetch the most-recent N proposals.
 * Spaces that are not on Snapshot (e.g. EigenLayer, which uses custom on-chain
 * governance) return an empty array and the `recent_governance` field in the
 * tool output is empty — never fabricated.
 */

import { z } from 'zod';

const SNAPSHOT_GRAPHQL = 'https://hub.snapshot.org/graphql';

/**
 * Mapping from our protocol slug to the canonical Snapshot space ID. Only
 * protocols that *actually* govern via Snapshot are listed — others return
 * empty proposal arrays so we never fabricate governance data.
 *
 * All space IDs verified live against `https://hub.snapshot.org/graphql`
 * (POST `{spaces(where:{id_in:[...]}){id name}}`):
 *   - aavedao.eth          (Aave DAO)            — verified
 *   - lido-snapshot.eth    (Lido)                — verified
 *   - uniswapgovernance.eth (Uniswap)            — verified
 *   - balancer.eth         (Balancer)            — verified
 *   - curve.eth            (Curve Finance)       — verified
 *   - morpho.eth           (Morpho)              — verified
 *   - sushigov.eth         (Sushi)               — verified
 *   - comp-vote.eth        (Compound)            — verified
 *
 * Pendle, Ethena, EigenLayer use custom on-chain governance / tokenholder
 * voting outside Snapshot. They are intentionally absent so the tool returns
 * `recent_governance: []` rather than fabricating data.
 */
const SNAPSHOT_SPACES: Record<string, string> = {
  'aave-v3': 'aavedao.eth',
  aave: 'aavedao.eth',
  'compound-v3': 'comp-vote.eth',
  compound: 'comp-vote.eth',
  'uniswap-v3': 'uniswapgovernance.eth',
  uniswap: 'uniswapgovernance.eth',
  morpho: 'morpho.eth',
  lido: 'lido-snapshot.eth',
  curve: 'curve.eth',
  balancer: 'balancer.eth',
};

export interface SnapshotProposalRecord {
  id: string;
  title: string;
  status: string;
  url: string;
  /** Unix-epoch seconds. */
  created: number;
}

export interface SnapshotClientOptions {
  /** Override fetch (test injection). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Override endpoint (tests). */
  endpoint?: string;
}

/**
 * GraphQL response schema. We narrow to the fields we use — Snapshot returns
 * many more, but parsing only what we need keeps the validation deterministic.
 */
const proposalSchema = z.object({
  id: z.string(),
  title: z.string(),
  state: z.string(),
  created: z.number().int(),
  link: z.string().url().optional().nullable(),
  space: z.object({ id: z.string() }).optional().nullable(),
});

const responseSchema = z.object({
  data: z
    .object({
      proposals: z.array(proposalSchema).nullable(),
    })
    .optional(),
  errors: z
    .array(
      z.object({
        message: z.string(),
      }),
    )
    .optional(),
});

export class SnapshotApiError extends Error {
  override readonly name = 'SnapshotApiError';
}

/** Resolve our protocol slug to a Snapshot space ID, or `null` if absent. */
export function spaceForProtocol(protocolSlug: string): string | null {
  return SNAPSHOT_SPACES[protocolSlug] ?? null;
}

/** Public list of slugs we know how to fetch from Snapshot. */
export const SNAPSHOT_KNOWN_SLUGS = Object.freeze(Object.keys(SNAPSHOT_SPACES));

/**
 * Fetch the last N proposals for a protocol from Snapshot.
 *
 * Returns an empty array (NOT throws) when:
 *   - the protocol has no Snapshot space mapping, OR
 *   - the Snapshot API responds with an empty proposals list.
 *
 * Throws `SnapshotApiError` on HTTP or GraphQL failure so callers surface the
 * upstream error rather than silently returning fake data.
 */
export async function fetchRecentProposals(
  protocolSlug: string,
  limit = 5,
  options: SnapshotClientOptions = {},
): Promise<SnapshotProposalRecord[]> {
  const space = spaceForProtocol(protocolSlug);
  if (!space) return [];

  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? SNAPSHOT_GRAPHQL;

  const query = `
    query ($space: String!, $first: Int!) {
      proposals(
        first: $first,
        skip: 0,
        where: { space_in: [$space] },
        orderBy: "created",
        orderDirection: desc
      ) {
        id
        title
        state
        created
        link
        space { id }
      }
    }
  `;

  const body = JSON.stringify({
    query,
    variables: { space, first: Math.max(1, Math.min(limit, 25)) },
  });

  let res: Response;
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SnapshotApiError(`Snapshot fetch failed: ${message}`);
  }

  if (!res.ok) {
    throw new SnapshotApiError(`Snapshot ${endpoint} → HTTP ${res.status} ${res.statusText}`);
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SnapshotApiError(`Snapshot response was not JSON: ${message}`);
  }

  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SnapshotApiError(
      `Snapshot response did not match schema: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }

  if (parsed.data.errors && parsed.data.errors.length > 0) {
    throw new SnapshotApiError(
      `Snapshot GraphQL errors: ${parsed.data.errors.map((e) => e.message).join('; ')}`,
    );
  }

  const proposals = parsed.data.data?.proposals ?? [];
  return proposals.map((p) => ({
    id: p.id,
    title: p.title,
    status: p.state.toLowerCase(),
    url: p.link ?? `https://snapshot.org/#/${p.space?.id ?? space}/proposal/${p.id}`,
    created: p.created,
  }));
}
