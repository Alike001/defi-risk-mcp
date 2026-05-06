/**
 * Discovery Path 1 — Index Network (CLI shell-out).
 *
 * Per ADR-006 the priority order for `discover_yields_by_intent` is:
 *   1. `@indexnetwork/sdk` — UNAVAILABLE (deprecated; verified Day 1 2026-05-06)
 *   2. `@indexnetwork/cli` shell-out — what this module owns
 *   3. Brave Search (optional, when `BRAVE_SEARCH_API_KEY` is set)
 *   4. DefiLlama Yields direct (final floor)
 *
 * This file is the thin discovery-router-facing wrapper around the CLI
 * shell-out implementation in `lib/indexNetwork.ts`. Story-fallback-discovery
 * (#8) extracts the orchestration tier into `lib/discovery/router.ts` so each
 * path lives in its own file with a uniform `runIndexPath` signature; the
 * underlying CLI bridge stays in `indexNetwork.ts` to preserve back-compat
 * with the story #7 import path used by `discoverYieldsByIntent.test.ts`.
 *
 * Why a thin wrapper rather than re-implementing the CLI bridge here:
 *   - The CLI bridge (spawn → JSON parse → Zod-validate envelope) is already
 *     covered by integration tests via the `fetchOpportunities` test seam in
 *     `discoverYieldsByIntent.test.ts`. Duplicating the spawn logic in two
 *     files would create drift.
 *   - The router needs a single shape — `(query, env, signal) → Opportunity[]`
 *     — for every path. This file adapts the existing
 *     `discoverOpportunities(query, options)` to that shape and applies the
 *     router's hard timeout (per the story's "8s suggested" note).
 *
 * Failure posture:
 *   - Throws `IndexPathDisabledError` when `INDEX_NETWORK_KEY` is unset (the
 *     router treats this as "skip me; try the next path").
 *   - Throws `IndexPathTimeoutError` when the CLI hangs past `timeoutMs`.
 *   - Bubbles up `IndexNetworkCliError` / `IndexNetworkParseError` from the
 *     underlying bridge unchanged so the router can record a precise
 *     `fallback_reason`.
 */

import {
  type DiscoverOpportunitiesOptions,
  INDEX_NETWORK_KEY_ENV,
  type IndexOpportunity,
  discoverOpportunities,
  isIndexNetworkEnabled,
} from '../indexNetwork.js';

/** Default per-path timeout. Mirrors the router's `8s` cap (story #8 note). */
const DEFAULT_TIMEOUT_MS = 8_000;

export class IndexPathDisabledError extends Error {
  override readonly name = 'IndexPathDisabledError';
  constructor() {
    super(`${INDEX_NETWORK_KEY_ENV} is not set; Index Network path skipped.`);
  }
}

export class IndexPathTimeoutError extends Error {
  override readonly name = 'IndexPathTimeoutError';
  constructor(public readonly timeoutMs: number) {
    super(`Index Network path timed out after ${timeoutMs}ms`);
  }
}

export interface IndexPathOptions {
  /** Hard timeout for the path. Defaults to 8s (router cap). */
  timeoutMs?: number;
  /** Test seam — env override. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /**
   * Test seam — alternative `discoverOpportunities` impl. The router uses
   * this to inject a stub returning canned opportunities.
   */
  fetchOpportunities?: (
    query: string,
    options?: DiscoverOpportunitiesOptions,
  ) => Promise<IndexOpportunity[]>;
}

/** True when the env var that gates this path is set. */
export function isIndexPathEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isIndexNetworkEnabled(env);
}

/**
 * Run the Index Network discovery path. Throws `IndexPathDisabledError` when
 * the env var is unset (the router uses this signal to skip the path) and
 * `IndexPathTimeoutError` when the CLI hangs past `timeoutMs`.
 */
export async function runIndexPath(
  query: string,
  options: IndexPathOptions = {},
): Promise<IndexOpportunity[]> {
  const env = options.env ?? process.env;
  if (!isIndexPathEnabled(env)) {
    throw new IndexPathDisabledError();
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchOpportunities ?? discoverOpportunities;

  // Race the underlying CLI call against a hard timeout. We pass `timeoutMs`
  // through to `discoverOpportunities` as well so the spawned CLI is killed
  // (the router-level race handles the case where the CLI bridge itself
  // ignores the timeout, e.g. an injected stub).
  return runWithTimeout(
    fetchImpl(query, { env, timeoutMs }),
    timeoutMs,
    () => new IndexPathTimeoutError(timeoutMs),
  );
}

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
