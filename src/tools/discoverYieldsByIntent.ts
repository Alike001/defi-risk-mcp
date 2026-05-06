/**
 * `discover_yields_by_intent` — accept a natural-language yield-discovery
 * intent ("stable USDC yield > 5% on Base, audited"), surface ranked yield
 * candidates with risk scoring + the F4 real-yield separation.
 *
 * This tool is the judge-alignment story (Index Network on the panel — see
 * `research/encode-defi-mini-hack/12-tech-deep-dive.md` §3 and the story
 * file). It lets Claude Desktop participate as an agent in the Index Network
 * intent-matching mesh.
 *
 * Story #8 refactor (story-fallback-discovery): the tool body used to inline
 * the Index → DefiLlama orchestration. We've lifted that into
 * `lib/discovery/router.ts` so each path is one swappable module per ADR-006:
 *   - Path 1 (`indexPath.ts`)        — `@indexnetwork/cli` shell-out
 *   - Path 2 (`bravePath.ts`)        — Brave Search REST (optional)
 *   - Path 3 (`defillamaFloor.ts`)   — DefiLlama Yields direct (always works)
 * The router picks the highest-priority enabled path and falls back through
 * the chain on error. The tool wrapper's job after the refactor is: validate
 * input, parse intent, call `router.discover(...)`, surface errors structurally.
 *
 * Failure posture:
 *   - Per-path errors → router records them in `fallback_reason` and tries
 *     the next path. Never silent.
 *   - All paths fail → router throws `AllPathsFailedError` and we emit a
 *     structured `{status: "error", code: "all_paths_failed", message}` MCP
 *     frame so the LLM can render an honest failure rather than crashing.
 *   - Empty result is a valid response (`candidates: []` with the parsed
 *     intent + diagnostics) — we never fabricate candidates.
 *
 * Test seams preserved from the story #7 implementation so the existing 27-
 * case test suite continues to pass:
 *   - `fetchPools(options?)`         — injected into the DefiLlama floor path
 *   - `fetchOpportunities(query)`    — injected into the Index path
 *   - `env`                          — flows to the router (path gates)
 *   - `now()`                        — pinned wall-clock for `generated_at`
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DefiLlamaClientOptions, YieldPool } from '../lib/defillama.js';
import { AllPathsFailedError, discover as routerDiscover } from '../lib/discovery/router.js';
import {
  type DiscoverOpportunitiesOptions,
  IndexNetworkNotConfiguredError,
  type IndexOpportunity,
} from '../lib/indexNetwork.js';
import { SUPPORTED_INTENT_KEYWORDS, parseIntent } from '../lib/intentParser.js';
import type { YieldDiscoveryResult } from '../schemas/domain.js';
import {
  discoverYieldsByIntentInputSchema,
  discoverYieldsByIntentInputShape,
  discoverYieldsByIntentOutputSchema,
} from '../schemas/tools.js';

// Re-export `scoreRisk` from the floor module so the existing story #7 tests
// (which import it from this file) keep working without churn. Risk scoring
// is now owned by `lib/discovery/defillamaFloor.ts` because every path
// produces candidates through the same scorer.
export { scoreRisk } from '../lib/discovery/defillamaFloor.js';

export const DISCOVER_YIELDS_BY_INTENT_TOOL_NAME = 'discover_yields_by_intent';

const DEFAULT_LIMIT = 5;

/* ------------------------------------------------------------------------- */
/* Public surface                                                             */
/* ------------------------------------------------------------------------- */

export interface DiscoverYieldsByIntentOptions {
  /** Test seam — inject a custom DefiLlama Yields fetcher. */
  fetchPools?: (options?: DefiLlamaClientOptions) => Promise<YieldPool[]>;
  /** Test seam — inject a custom Index Network fetcher. */
  fetchOpportunities?: (
    query: string,
    options?: DiscoverOpportunitiesOptions,
  ) => Promise<IndexOpportunity[]>;
  /** Test seam — env override (defaults to `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Test seam — pin the wall clock for deterministic `generated_at`. */
  now?: () => Date;
}

export async function discoverYieldsByIntent(
  rawInput: unknown,
  options: DiscoverYieldsByIntentOptions = {},
): Promise<YieldDiscoveryResult> {
  const parsed = discoverYieldsByIntentInputSchema.safeParse(rawInput);
  if (!parsed.success) throw parsed.error;

  const limit = parsed.data.limit ?? DEFAULT_LIMIT;
  const env = options.env ?? process.env;
  const now = options.now ? options.now() : new Date();
  const constraints = parseIntent(parsed.data.intent);

  // Build the per-path runner overrides. We only wire the test-seam fetchers
  // into the corresponding path; the router's path-selection logic stays
  // untouched.
  const fetchOpportunitiesImpl = options.fetchOpportunities;
  const fetchPoolsImpl = options.fetchPools;

  const runIndexPathImpl = fetchOpportunitiesImpl
    ? // Adapt the legacy `fetchOpportunities(query, opts)` test seam to the
      // router's `runIndexPath(query, options)` shape.
      async (query: string, opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}) => {
        const localEnv = opts.env ?? env;
        // Treat the test seam as the source of truth — even when the env is
        // missing we want the seam to win so existing tests stay deterministic.
        return fetchOpportunitiesImpl(query, { env: localEnv });
      }
    : undefined;

  const runDefiLlamaFloorImpl = fetchPoolsImpl
    ? // Adapt by importing the floor and pre-binding the fetchPools seam.
      async (
        opts: Parameters<typeof import('../lib/discovery/defillamaFloor.js').runDefiLlamaFloor>[0],
      ) => {
        const { runDefiLlamaFloor } = await import('../lib/discovery/defillamaFloor.js');
        return runDefiLlamaFloor({ ...opts, fetchPools: fetchPoolsImpl });
      }
    : undefined;

  return routerDiscover({
    intent: parsed.data.intent,
    constraints,
    limit,
    now,
    env,
    runIndexPathImpl,
    runDefiLlamaFloorImpl,
  });
}

/* ------------------------------------------------------------------------- */
/* MCP tool registration                                                      */
/* ------------------------------------------------------------------------- */

export function registerDiscoverYieldsByIntentTool(server: McpServer): void {
  server.registerTool(
    DISCOVER_YIELDS_BY_INTENT_TOOL_NAME,
    {
      title: 'Discover yield candidates by natural-language intent',
      description: [
        'Posts a natural-language DeFi-yield discovery intent through a',
        'three-path discovery router (per ADR-006): (1) Index Network agent',
        'matchmaker via @indexnetwork/cli when INDEX_NETWORK_KEY is set;',
        '(2) Brave Search REST as an optional fallback when BRAVE_SEARCH_API_KEY',
        'is set; (3) DefiLlama Yields directly as the absolute floor that',
        'always works. Returns ranked candidates from DefiLlama Yields, scored',
        'across audit evidence, TVL, real-yield (vs inflationary token',
        'emissions, F4), impermanent-loss, and outlier flags. Sorted by',
        'risk_score ascending (safest first). Read-only — never signs or',
        'broadcasts (ADR-003). Discovery source is always reported via',
        '`discovery_source` ∈ {index_network, brave, defillama_only, fallback}.',
        `Supported intent keywords: ${SUPPORTED_INTENT_KEYWORDS.join('; ')}.`,
      ].join(' '),
      inputSchema: discoverYieldsByIntentInputShape,
      outputSchema: discoverYieldsByIntentOutputSchema.shape,
    },
    async (rawInput: { intent: string; limit?: number }) => {
      try {
        const result = await discoverYieldsByIntent(rawInput);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (err) {
        if (err instanceof IndexNetworkNotConfiguredError) {
          // Should never bubble here (router skips the path) but defensive.
          process.stderr.write(`[discover_yields_by_intent] ${err.message}\n`);
        }
        if (err instanceof AllPathsFailedError) {
          // All discovery paths failed — emit a structured MCP error frame
          // (status + code + message) so the LLM can render an honest
          // diagnostic rather than crashing the whole tool call.
          const payload = {
            status: 'error' as const,
            code: err.code,
            message: err.message,
          };
          process.stderr.write(`[discover_yields_by_intent] ${err.message}\n`);
          return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify(payload) }],
          };
        }
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[discover_yields_by_intent] error: ${message}\n`);
        throw err;
      }
    },
  );
}
