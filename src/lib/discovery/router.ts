/**
 * Discovery router — picks one of three paths per ADR-006 and returns a
 * unified `YieldDiscoveryResult` shape.
 *
 * Priority order (story #8 + ADR-006):
 *   1. Index Network CLI shell-out — when `INDEX_NETWORK_KEY` is set.
 *      Sets `discovery_source: "index_network"`.
 *   2. Brave Search REST — when `BRAVE_SEARCH_API_KEY` is set AND Index path
 *      did not run (or did and produced zero hits). Sets `discovery_source:
 *      "brave"` and tags candidates `data_source: "brave_inferred"`.
 *   3. DefiLlama Yields direct — always works (no key required). Sets
 *      `discovery_source: "defillama_only"`.
 *
 * The router never crashes. When ALL three paths fail (network down, every
 * upstream unreachable), it throws `AllPathsFailedError` which the tool
 * wrapper translates into a structured MCP error frame
 * (`{status: "error", code: "all_paths_failed", message: "..."}`).
 *
 * Why this lives in its own file (refactor from inline orchestration):
 *   - story #7 inlined the path selection in `tools/discoverYieldsByIntent.ts`.
 *     story #8's deliverable is to lift it out so each path is one
 *     swappable module + the tool stays thin.
 *   - The tool wrapper's only job after this refactor is: validate input,
 *     parse intent, call `router.discover(...)`, format the response.
 *   - Future paths (e.g. Tavily Search) can be added by dropping a fourth
 *     `lib/discovery/<name>Path.ts` and wiring it into `discover()` below.
 *
 * Failure-reason format: every fallback emits a string like
 * `"<source>_<reason>: <message>"`. The tool surfaces this verbatim under
 * `fallback_reason` so the MCP client renders an honest "we tried Index but
 * it timed out, and Brave returned 429, so we used DefiLlama" diagnostic.
 *
 * Per-path timeouts (8s default) prevent a hanging upstream from pinning
 * Claude Desktop. The story's "8s suggested" note balances generous CLI cold
 * starts against MCP-call latency budgets.
 */

import type { IntentConstraints, YieldDiscoveryResult } from '../../schemas/domain.js';
import { yieldDiscoveryResultSchema } from '../../schemas/domain.js';
import type { IndexOpportunity } from '../indexNetwork.js';
import { BravePathDisabledError, isBravePathEnabled, runBravePath } from './bravePath.js';
import { runDefiLlamaFloor } from './defillamaFloor.js';
import { IndexPathDisabledError, isIndexPathEnabled, runIndexPath } from './indexPath.js';

/* ------------------------------------------------------------------------- */
/* Errors                                                                     */
/* ------------------------------------------------------------------------- */

export class AllPathsFailedError extends Error {
  override readonly name = 'AllPathsFailedError';
  /** Stable error code for the structured MCP error frame. */
  readonly code = 'all_paths_failed';
  constructor(public readonly reasons: string[]) {
    super(`All discovery paths failed: ${reasons.join(' | ') || 'no paths attempted'}`);
  }
}

/* ------------------------------------------------------------------------- */
/* Options                                                                    */
/* ------------------------------------------------------------------------- */

export interface RouterDiscoverOptions {
  /** The natural-language intent (already validated by the tool's input schema). */
  intent: string;
  /** Parsed constraints from `lib/intentParser`. */
  constraints: IntentConstraints;
  /** Cap on the returned candidate set. */
  limit: number;
  /** Frozen wall-clock for `generated_at`. */
  now: Date;
  /** Test seam — env override. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Test seam — alternative Index path runner. */
  runIndexPathImpl?: typeof runIndexPath;
  /** Test seam — alternative Brave path runner. */
  runBravePathImpl?: typeof runBravePath;
  /** Test seam — alternative DefiLlama floor runner. */
  runDefiLlamaFloorImpl?: typeof runDefiLlamaFloor;
  /** Per-path timeout. Defaults to 8s. */
  timeoutMs?: number;
}

/* ------------------------------------------------------------------------- */
/* Public surface                                                             */
/* ------------------------------------------------------------------------- */

/**
 * Discover yield candidates by trying paths in priority order. Returns a
 * fully-formed `YieldDiscoveryResult` (validated against
 * `yieldDiscoveryResultSchema`). Throws `AllPathsFailedError` ONLY when
 * every attempted path errored — the tool wrapper catches that and emits a
 * structured error frame.
 */
export async function discover(options: RouterDiscoverOptions): Promise<YieldDiscoveryResult> {
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const runIndex = options.runIndexPathImpl ?? runIndexPath;
  const runBrave = options.runBravePathImpl ?? runBravePath;
  const runFloor = options.runDefiLlamaFloorImpl ?? runDefiLlamaFloor;

  const reasons: string[] = [];

  // --- Path 1: Index Network ------------------------------------------------
  let indexHits: IndexOpportunity[] = [];
  let indexUsed = false;
  if (isIndexPathEnabled(env)) {
    try {
      // Defense-in-depth timeout: even when an injected stub ignores the
      // `timeoutMs` option, the router-level race guarantees Claude Desktop
      // never hangs on a single path.
      indexHits = await raceWithTimeout(
        runIndex(options.intent, { env, timeoutMs }),
        timeoutMs,
        'index_network_timeout',
      );
      indexUsed = true;
    } catch (err) {
      if (err instanceof IndexPathDisabledError) {
        reasons.push('index_network: disabled');
      } else {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        reasons.push(`index_network_error: ${msg}`);
        process.stderr.write(`[discovery.router] index path failed: ${msg}\n`);
      }
    }
  } else {
    reasons.push('index_network: INDEX_NETWORK_KEY not set');
  }

  // If Index returned hits, we serve from the Index path (with DefiLlama
  // enrichment for risk metrics). The router never trusts Index for risk
  // metadata — DefiLlama is the source of truth for per-pool TVL/IL/audit.
  if (indexUsed && indexHits.length > 0) {
    const indexProtocols = new Set(
      indexHits.map((o) => (o.protocol ?? '').toLowerCase()).filter((p) => p.length > 0),
    );
    try {
      const floor = await runFloor({
        constraints: options.constraints,
        signalProtocols: indexProtocols,
        limit: options.limit,
        timeoutMs,
        dataSource: 'defillama',
      });
      return assemble({
        discoverySource: 'index_network',
        indexUsed: true,
        fallbackReason: null,
        constraints: options.constraints,
        candidates: floor.candidates,
        indexHits,
        now: options.now,
        bravePath: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      reasons.push(`defillama_floor_error: ${msg}`);
      // Fall through — try Brave, then bare DefiLlama (no Index bias).
    }
  }

  // --- Path 2: Brave Search (optional) -------------------------------------
  let braveSlugs: string[] = [];
  let braveUsed = false;
  if (isBravePathEnabled(env)) {
    try {
      braveSlugs = await raceWithTimeout(
        runBrave(options.intent, { env, timeoutMs }),
        timeoutMs,
        'brave_timeout',
      );
      braveUsed = true;
    } catch (err) {
      if (err instanceof BravePathDisabledError) {
        reasons.push('brave: disabled');
      } else {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        reasons.push(`brave_path_error: ${msg}`);
        process.stderr.write(`[discovery.router] brave path failed: ${msg}\n`);
      }
    }
  } else {
    reasons.push('brave: BRAVE_SEARCH_API_KEY not set');
  }

  if (braveUsed) {
    const braveProtocols = new Set(braveSlugs.map((s) => s.toLowerCase()));
    try {
      const floor = await runFloor({
        constraints: options.constraints,
        signalProtocols: braveProtocols,
        limit: options.limit,
        timeoutMs,
        dataSource: 'brave_inferred',
      });
      return assemble({
        discoverySource: 'brave',
        indexUsed,
        fallbackReason: reasons.length > 0 ? reasons.join('; ') : null,
        constraints: options.constraints,
        candidates: floor.candidates,
        indexHits,
        now: options.now,
        bravePath: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      reasons.push(`defillama_floor_error: ${msg}`);
      // Fall through to bare DefiLlama (no Brave bias) — last resort.
    }
  }

  // --- Path 3: DefiLlama floor (always works) ------------------------------
  try {
    const floor = await runFloor({
      constraints: options.constraints,
      signalProtocols: new Set<string>(),
      limit: options.limit,
      timeoutMs,
      dataSource: 'defillama',
    });
    return assemble({
      discoverySource: 'defillama_only',
      indexUsed,
      fallbackReason: reasons.length > 0 ? reasons.join('; ') : null,
      constraints: options.constraints,
      candidates: floor.candidates,
      indexHits,
      now: options.now,
      bravePath: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    reasons.push(`defillama_floor_error: ${msg}`);
    throw new AllPathsFailedError(reasons);
  }
}

/* ------------------------------------------------------------------------- */
/* Result assembly                                                            */
/* ------------------------------------------------------------------------- */

interface AssembleInputs {
  discoverySource: 'index_network' | 'brave' | 'defillama_only';
  indexUsed: boolean;
  fallbackReason: string | null;
  constraints: IntentConstraints;
  candidates: YieldDiscoveryResult['candidates'];
  indexHits: IndexOpportunity[];
  now: Date;
  bravePath: boolean;
}

function assemble(inputs: AssembleInputs): YieldDiscoveryResult {
  const sources = collectSources(
    inputs.discoverySource,
    inputs.indexHits,
    inputs.candidates,
    inputs.bravePath,
  );

  const result: YieldDiscoveryResult = {
    discovery_source: inputs.discoverySource,
    index_network_used: inputs.indexUsed,
    fallback_reason: inputs.fallbackReason,
    parsed_intent: inputs.constraints,
    candidates: inputs.candidates,
    sources,
    generated_at: inputs.now.toISOString(),
  };

  // Validate before returning — catches drift in any helper rather than
  // emitting an invalid MCP frame.
  return yieldDiscoveryResultSchema.parse(result);
}

/**
 * Router-level timeout race. Even when a per-path stub ignores its own
 * `timeoutMs`, this guarantees Claude Desktop never hangs on a single path.
 * Note this does NOT cancel the underlying work — the path is still running
 * in the background — but it lets the router move on to the next path.
 */
function raceWithTimeout<T>(promise: Promise<T>, ms: number, tag: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${tag} after ${ms}ms`)), ms);
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

function collectSources(
  source: 'index_network' | 'brave' | 'defillama_only',
  indexHits: IndexOpportunity[],
  candidates: YieldDiscoveryResult['candidates'],
  bravePath: boolean,
): string[] {
  const out = new Set<string>();
  out.add('https://yields.llama.fi/pools');
  if (source === 'index_network') {
    out.add('https://index.network/');
    for (const h of indexHits) {
      if (h.url) out.add(h.url);
    }
  }
  if (bravePath) {
    out.add('https://search.brave.com/');
  }
  for (const c of candidates) {
    if (c.pool_id) {
      out.add(`https://defillama.com/yields/pool/${encodeURIComponent(c.pool_id)}`);
    }
  }
  return Array.from(out).slice(0, 10);
}
