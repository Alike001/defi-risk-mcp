import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Story: story-claude-desktop-integration (#5).
 *
 * BDD acceptance (auto-verifiable subset):
 *   - The shipped `claude-desktop-config-example.json` is valid JSON
 *   - It contains an `mcpServers["defi-risk"]` entry with `command` + `args`
 *     of the correct shape
 *   - Every env var referenced in the example is documented in `.env.example`
 *
 * The full BDD criteria — Claude Desktop restart + live prompt timing — are
 * MANUAL user steps on a Mac/Windows install of Claude Desktop and are
 * explicitly NOT auto-verified on this Linux build host. They are deferred
 * to the user's manual smoke-test per `docs/INSTALL.md`.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG_PATH = join(REPO_ROOT, 'claude-desktop-config-example.json');
const ENV_EXAMPLE_PATH = join(REPO_ROOT, '.env.example');

interface McpServerEntry {
  command?: unknown;
  args?: unknown;
  env?: Record<string, unknown>;
}

interface ClaudeDesktopConfig {
  mcpServers?: Record<string, McpServerEntry>;
}

function readConfig(): ClaudeDesktopConfig {
  const raw = readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw) as ClaudeDesktopConfig;
}

describe('claude-desktop-config-example.json', () => {
  it('is valid JSON', () => {
    expect(() => readConfig()).not.toThrow();
  });

  it('declares an mcpServers["defi-risk"] entry', () => {
    const cfg = readConfig();
    expect(cfg.mcpServers).toBeDefined();
    expect(cfg.mcpServers?.['defi-risk']).toBeDefined();
  });

  it('the defi-risk entry exposes a string `command` and array `args`', () => {
    const entry = readConfig().mcpServers?.['defi-risk'];
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(typeof entry.command).toBe('string');
    expect((entry.command as string).length).toBeGreaterThan(0);
    expect(Array.isArray(entry.args)).toBe(true);
    expect((entry.args as unknown[]).length).toBeGreaterThanOrEqual(1);
    for (const arg of entry.args as unknown[]) {
      expect(typeof arg).toBe('string');
    }
  });

  it('every env var referenced in the example is documented in .env.example', () => {
    const entry = readConfig().mcpServers?.['defi-risk'];
    expect(entry).toBeDefined();
    if (!entry) return;
    const envBlock = (entry.env ?? {}) as Record<string, unknown>;
    const referenced = Object.keys(envBlock);
    expect(referenced.length).toBeGreaterThan(0);

    const envExample = readFileSync(ENV_EXAMPLE_PATH, 'utf8');
    const documented = new Set(
      envExample
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
        .map((line) => line.split('=', 1)[0]?.trim() ?? ''),
    );

    for (const key of referenced) {
      expect(documented, `env var ${key} must appear in .env.example`).toContain(key);
    }
  });

  it('references the canonical MCP server identifier "defi-risk"', () => {
    const cfg = readConfig();
    const keys = Object.keys(cfg.mcpServers ?? {});
    expect(keys).toContain('defi-risk');
  });
});
