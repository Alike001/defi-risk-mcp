/**
 * Index Network client (CLI shell-out path — Path 2 per ADR-006).
 *
 * Day 1 verification (2026-05-06):
 *   - `npm view @indexnetwork/sdk` → DEPRECATED ("Package no longer supported")
 *     Last published: 2025-05 (a year ago). Methods like `IndexClient.search`
 *     exist but the model is deprecated and assumes Ceramic + Lit + DID auth
 *     stack we do NOT want to take on for this MCP.
 *   - `npm view @indexnetwork/cli` → ACTIVELY MAINTAINED (last published a week
 *     ago, v0.10.3). Surfaces the current 2026 product (intent-matching agent
 *     network):
 *         index intent create "<text>"
 *         index opportunity discover "<query>"
 *         index opportunity list / show
 *
 * ADR-006 prescribes three integration paths in priority order:
 *   1. `@indexnetwork/sdk` — UNAVAILABLE (deprecated as of Day 1 probe).
 *   2. `@indexnetwork/cli` shell-out via `child_process.spawn` — what this file
 *      implements. Calls `index opportunity discover "<query>" --json` and
 *      parses the `{success, data, error}` envelope the CLI emits.
 *   3. Brave Search REST + DefiLlama Yields fallback — implemented in
 *      `lib/discovery/{bravePath,defillamaFloor,router}.ts` after the
 *      story-fallback-discovery (#8) refactor.
 *
 * After story #8: this file is the underlying CLI bridge. The discovery
 * router consumes it through `lib/discovery/indexPath.ts` (the thin path
 * adapter) — not directly. We keep this file rather than re-exporting from
 * `indexPath.ts` because:
 *   (a) `IndexNetworkNotConfiguredError` + the typed `IndexOpportunity` shape
 *       are imported by both the path adapter AND the existing
 *       `discoverYieldsByIntent.test.ts` (story #7) — back-compat.
 *   (b) The spawn / stdout-buffer / SIGTERM logic is non-trivial; isolating
 *       it here means `lib/discovery/indexPath.ts` stays under 100 LOC.
 *   (c) If a future story decides to swap the CLI for a hypothetical
 *       resurrected SDK, the bridge changes; the path adapter does not.
 *
 * Why `index opportunity discover` rather than `index intent create`:
 *   - `intent create` writes a persistent signal into the user's Index
 *     account (slow, side-effectful, requires login, costs the user's
 *     attention forever). Agents that re-post the same intent every turn
 *     would spam the network.
 *   - `opportunity discover` runs the discovery search synchronously without
 *     writing a persistent signal. This is the read-shaped operation MCP
 *     tools should default to (we are read-only per ADR-003).
 *
 * Auth:
 *   - The CLI stores credentials in `~/.index/credentials.json` after the
 *     user runs `index login` once. Our MCP detects auth via the standard
 *     `INDEX_NETWORK_KEY` env var. If set, we shell out to the CLI; if unset,
 *     we never invoke and the caller falls back to DefiLlama Yields.
 *   - We pass the key to the CLI via `--token <key>` so the user does not
 *     need a persistent CLI login on the machine running the MCP.
 *
 * Failure posture:
 *   - timeout (default 15s) → throws `IndexNetworkTimeoutError`
 *   - CLI exits non-zero → throws `IndexNetworkCliError` with stderr
 *   - CLI prints unparseable JSON → throws `IndexNetworkParseError`
 *   - The orchestrating tool catches all three and falls back to DefiLlama
 *     Yields, recording `fallback_reason` in the response so the MCP client
 *     can surface honest diagnostics.
 */

import { spawn } from 'node:child_process';
import { z } from 'zod';

/** Environment variable that gates the Index Network path. */
export const INDEX_NETWORK_KEY_ENV = 'INDEX_NETWORK_KEY';

/** Default timeout for a single CLI invocation. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Max stdout we will buffer from the CLI (1 MB — generous for `--json` output). */
const MAX_BUFFER_BYTES = 1 * 1024 * 1024;

/* ------------------------------------------------------------------------- */
/* Errors                                                                     */
/* ------------------------------------------------------------------------- */

export class IndexNetworkTimeoutError extends Error {
  override readonly name = 'IndexNetworkTimeoutError';
  constructor(public readonly timeoutMs: number) {
    super(`Index CLI timed out after ${timeoutMs}ms`);
  }
}

export class IndexNetworkCliError extends Error {
  override readonly name = 'IndexNetworkCliError';
  constructor(
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(`Index CLI exited with code ${exitCode ?? 'null'}: ${stderr.trim() || '(no stderr)'}`);
  }
}

export class IndexNetworkParseError extends Error {
  override readonly name = 'IndexNetworkParseError';
  constructor(public readonly stdout: string) {
    super(`Index CLI emitted unparseable JSON: ${stdout.slice(0, 200)}`);
  }
}

export class IndexNetworkNotConfiguredError extends Error {
  override readonly name = 'IndexNetworkNotConfiguredError';
  constructor() {
    super(`${INDEX_NETWORK_KEY_ENV} is not set; Index Network path skipped.`);
  }
}

/* ------------------------------------------------------------------------- */
/* CLI envelope                                                              */
/* ------------------------------------------------------------------------- */

/**
 * Schema for the `--json` envelope `index opportunity discover` emits. The CLI
 * source (probed Day 1) always wraps results as `{success, data, error}`.
 *
 * `data` shape varies — opportunities can carry titles, descriptions, links,
 * scores, or just a `message` field while async negotiation runs. We capture
 * the most common keys with a permissive schema and pass through unknown
 * keys as part of the raw record so downstream synthesis can use them.
 */
const indexOpportunitySchema = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    score: z.number().optional(),
    chain: z.string().optional(),
    project: z.string().optional(),
    protocol: z.string().optional(),
    symbol: z.string().optional(),
    apy: z.number().optional(),
    real_yield: z.number().optional(),
    link: z.string().optional(),
    url: z.string().optional(),
    sources: z.array(z.string()).optional(),
  })
  .passthrough();

const indexOpportunityResultSchema = z
  .object({
    success: z.boolean().optional(),
    data: z
      .union([
        z.array(indexOpportunitySchema),
        z.object({
          opportunities: z.array(indexOpportunitySchema).optional(),
          message: z.string().optional(),
        }),
        z.null(),
      ])
      .optional(),
    error: z.string().optional(),
  })
  .passthrough();

/** Lightweight typed view of one Index Network match. */
export interface IndexOpportunity {
  id: string | null;
  title: string | null;
  description: string | null;
  score: number | null;
  protocol: string | null;
  chain: string | null;
  symbol: string | null;
  apy: number | null;
  url: string | null;
  /** Keep the raw record so callers can surface anything the CLI returned. */
  raw: Record<string, unknown>;
}

export interface DiscoverOpportunitiesOptions {
  /** Override the path/binary — tests use this to point at a stub script. */
  cliBinary?: string;
  /** Override env (tests). Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Custom timeout (ms). Defaults to 15s. */
  timeoutMs?: number;
  /** Test seam — alternative `spawn` impl. */
  spawnImpl?: typeof spawn;
}

/* ------------------------------------------------------------------------- */
/* Public surface                                                             */
/* ------------------------------------------------------------------------- */

/** True when the CLI is reachable via env (we do not actually launch it here). */
export function isIndexNetworkEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const key = env[INDEX_NETWORK_KEY_ENV];
  return Boolean(key && key.trim().length > 0);
}

/**
 * Shell out to `index opportunity discover "<query>" --json --token <key>` and
 * parse the JSON envelope. Returns a typed `IndexOpportunity[]`.
 *
 * Throws `IndexNetworkNotConfiguredError` when the env var is unset (the caller
 * should treat this as "fall back to DefiLlama Yields").
 */
export async function discoverOpportunities(
  query: string,
  options: DiscoverOpportunitiesOptions = {},
): Promise<IndexOpportunity[]> {
  const env = options.env ?? process.env;
  if (!isIndexNetworkEnabled(env)) {
    throw new IndexNetworkNotConfiguredError();
  }
  const token = env[INDEX_NETWORK_KEY_ENV];
  if (!token) {
    // Defensive — `isIndexNetworkEnabled` already checks; this satisfies TS.
    throw new IndexNetworkNotConfiguredError();
  }

  const cliBinary = options.cliBinary ?? 'index';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawnImpl = options.spawnImpl ?? spawn;

  const args = ['opportunity', 'discover', query, '--json', '--token', token];

  const stdout = await runCli(cliBinary, args, { timeoutMs, spawnImpl });

  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new IndexNetworkParseError(stdout);
  }

  const parsed = indexOpportunityResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new IndexNetworkParseError(stdout);
  }

  if (parsed.data.success === false) {
    throw new IndexNetworkCliError(0, parsed.data.error ?? 'discovery failed');
  }

  // `data` can be an array, an object with `opportunities`, or null/undefined.
  const list = (() => {
    const d = parsed.data.data;
    if (Array.isArray(d)) return d;
    if (d && typeof d === 'object' && 'opportunities' in d && Array.isArray(d.opportunities)) {
      return d.opportunities;
    }
    return [];
  })();

  return list.map((item) => normalizeOpportunity(item));
}

/* ------------------------------------------------------------------------- */
/* Internals                                                                  */
/* ------------------------------------------------------------------------- */

interface RunCliOptions {
  timeoutMs: number;
  spawnImpl: typeof spawn;
}

function runCli(binary: string, args: string[], opts: RunCliOptions): Promise<string> {
  const { timeoutMs, spawnImpl } = opts;
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnImpl(binary, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reject(new IndexNetworkCliError(null, `failed to spawn ${binary}: ${msg}`));
      return;
    }

    let stdoutBuf = '';
    let stderrBuf = '';
    let bufBytes = 0;
    let killedForTimeout = false;
    let killedForOverflow = false;

    const timer = setTimeout(() => {
      killedForTimeout = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      bufBytes += Buffer.byteLength(text, 'utf8');
      if (bufBytes > MAX_BUFFER_BYTES) {
        killedForOverflow = true;
        child.kill('SIGTERM');
        return;
      }
      stdoutBuf += text;
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrBuf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new IndexNetworkCliError(null, err.message));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killedForTimeout) {
        reject(new IndexNetworkTimeoutError(timeoutMs));
        return;
      }
      if (killedForOverflow) {
        reject(new IndexNetworkCliError(code, 'CLI stdout exceeded 1 MB cap'));
        return;
      }
      if (code !== 0) {
        reject(new IndexNetworkCliError(code, stderrBuf));
        return;
      }
      resolve(stdoutBuf);
    });
  });
}

function normalizeOpportunity(raw: z.infer<typeof indexOpportunitySchema>): IndexOpportunity {
  const url = raw.url ?? raw.link ?? null;
  return {
    id: raw.id ?? null,
    title: raw.title ?? null,
    description: raw.description ?? null,
    score: raw.score ?? null,
    protocol: raw.protocol ?? raw.project ?? null,
    chain: raw.chain ?? null,
    symbol: raw.symbol ?? null,
    apy: raw.apy ?? null,
    url,
    raw: raw as Record<string, unknown>,
  };
}
