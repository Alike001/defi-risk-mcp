#!/usr/bin/env node
/**
 * defi-risk-mcp install helper.
 *
 * Story: story-readme-and-publish (#11).
 *
 * What it does:
 *   - Detects the host OS (mac / linux / windows).
 *   - Locates the Claude Desktop config file for the platform.
 *   - Reads the existing config (or starts a fresh one if it does not exist).
 *   - Merges the canonical `defi-risk` MCP server entry into `mcpServers`,
 *     preserving every other server already configured.
 *   - If a `defi-risk` entry is already present, prompts the user before
 *     overwriting it. `--force` (or non-TTY stdin) skips the prompt.
 *   - Writes the result back atomically via a temp-file rename.
 *
 * Out of scope:
 *   - Spawning Claude Desktop itself; we just print the "restart" instruction.
 *   - Credential management; the user fills in env keys in the config file.
 *   - Linux Claude Desktop is not officially shipped, but Cursor/Cline users on
 *     Linux can still pull a sane skeleton — we use the macOS-style config dir
 *     under `~/.config/Claude/claude_desktop_config.json` as a courtesy default.
 *
 * stdout is reserved for the human-readable success/error output. The merge
 * logic itself is exported as pure functions so the unit tests can drive it
 * without spawning a child process.
 */

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';

export const SERVER_KEY = 'defi-risk';

export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ClaudeDesktopConfig {
  mcpServers?: Record<string, McpServerEntry>;
  [other: string]: unknown;
}

export type SupportedPlatform = 'darwin' | 'win32' | 'linux';

/**
 * The canonical npx-based entry. End users should not need to clone the repo;
 * Claude Desktop will fetch the package on first launch.
 */
export function defaultServerEntry(): McpServerEntry {
  return {
    command: 'npx',
    args: ['-y', '-p', '@alike001/defi-risk-mcp', 'defi-risk-mcp'],
    env: {
      ALCHEMY_API_KEY: '',
      ETHERSCAN_API_KEY: '',
      TENDERLY_USER: '',
      TENDERLY_PROJECT: '',
      TENDERLY_ACCESS_KEY: '',
      INDEX_NETWORK_KEY: '',
      BRAVE_SEARCH_API_KEY: '',
    },
  };
}

/**
 * Resolve the Claude Desktop config path for the current platform. We rely on
 * `homedir()` so tests can override via `process.env.HOME` / `USERPROFILE`.
 */
export function configPathFor(
  os: SupportedPlatform,
  home: string = homedir(),
  appData?: string,
): string {
  if (os === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (os === 'win32') {
    const base = appData ?? process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    return join(base, 'Claude', 'claude_desktop_config.json');
  }
  // Linux — Claude Desktop isn't officially shipped here, but we still emit a
  // sensible default so Cursor/Cline users have a starting file.
  return join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

export function detectPlatform(): SupportedPlatform {
  const p = platform();
  if (p === 'darwin' || p === 'win32') return p;
  return 'linux';
}

/** Read and parse a Claude Desktop config file, or return an empty config. */
export function readConfig(path: string): ClaudeDesktopConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return {};
    throw err;
  }
  if (raw.trim().length === 0) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`config at ${path} is not a JSON object`);
  }
  return parsed as ClaudeDesktopConfig;
}

/**
 * Merge the `defi-risk` server entry into an existing config without
 * clobbering other servers or unrelated top-level keys.
 *
 * If the config already declares a `defi-risk` entry, the caller decides
 * (interactively) whether to overwrite it; this function only inspects.
 * Returns `{ next, conflict }` so callers can branch cleanly.
 */
export function mergeServerEntry(
  existing: ClaudeDesktopConfig,
  entry: McpServerEntry,
  serverKey: string = SERVER_KEY,
): { next: ClaudeDesktopConfig; conflict: boolean } {
  const conflict = Boolean(existing.mcpServers?.[serverKey]);
  const next: ClaudeDesktopConfig = {
    ...existing,
    mcpServers: {
      ...(existing.mcpServers ?? {}),
      [serverKey]: entry,
    },
  };
  return { next, conflict };
}

/**
 * Write a config to disk atomically:
 *   1. Ensure the parent directory exists.
 *   2. Write to a sibling temp file.
 *   3. `rename` over the destination (POSIX atomic on the same filesystem).
 *
 * On Windows `rename` will overwrite the target since Node 14+.
 */
export function writeConfigAtomic(path: string, config: ClaudeDesktopConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

/** Lightweight yes/no prompt over stdin; resolves the user's answer. */
async function confirm(question: string): Promise<boolean> {
  process.stdout.write(`${question} [y/N] `);
  return new Promise((resolve) => {
    process.stdin.setEncoding('utf8');
    const onData = (chunk: string): void => {
      const answer = chunk.trim().toLowerCase();
      process.stdin.removeListener('data', onData);
      process.stdin.pause();
      resolve(answer === 'y' || answer === 'yes');
    };
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

interface RunOptions {
  force: boolean;
}

/** Pure-ish entry point: runs the install flow against the real filesystem. */
export async function runInstall(
  argv: string[] = process.argv.slice(2),
  io: {
    log: (msg: string) => void;
    err: (msg: string) => void;
    promptOverwrite?: () => Promise<boolean>;
  } = {
    log: (msg: string) => process.stdout.write(`${msg}\n`),
    err: (msg: string) => process.stderr.write(`${msg}\n`),
  },
): Promise<number> {
  const opts: RunOptions = { force: argv.includes('--force') || argv.includes('-f') };
  const os = detectPlatform();
  const path = configPathFor(os);

  io.log('defi-risk-mcp install');
  io.log(`  platform: ${os}`);
  io.log(`  config:   ${path}`);

  let existing: ClaudeDesktopConfig;
  try {
    existing = readConfig(path);
  } catch (err) {
    io.err(`error: failed to read existing config at ${path}: ${(err as Error).message}`);
    return 1;
  }

  const { next, conflict } = mergeServerEntry(existing, defaultServerEntry());

  if (conflict && !opts.force) {
    const ttyConfirm =
      io.promptOverwrite ?? (() => confirm(`Overwrite existing 'defi-risk' entry?`));
    const shouldOverwrite = process.stdin.isTTY ? await ttyConfirm() : false;
    if (!shouldOverwrite) {
      io.err(
        `aborted: a 'defi-risk' entry already exists at ${path}. Re-run with --force to overwrite.`,
      );
      return 2;
    }
  }

  try {
    writeConfigAtomic(path, next);
  } catch (err) {
    io.err(`error: failed to write config: ${(err as Error).message}`);
    return 1;
  }

  // Sanity-check the write — non-fatal but useful in CI.
  try {
    statSync(path);
  } catch {
    // ignore — atomic write would have thrown above on a real failure
  }

  io.log(`written: ${path}`);
  io.log('next: fully quit and restart Claude Desktop (Cmd/Ctrl-Q).');
  return 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  runInstall().then(
    (code) => process.exit(code),
    (err: unknown) => {
      const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
      process.stderr.write(`defi-risk-mcp install fatal: ${message}\n`);
      process.exit(1);
    },
  );
}
