import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type ClaudeDesktopConfig,
  type McpServerEntry,
  configPathFor,
  defaultServerEntry,
  mergeServerEntry,
  readConfig,
  writeConfigAtomic,
} from '../install.js';

/**
 * Story: story-readme-and-publish (#11).
 *
 * BDD acceptance (auto-verifiable subset):
 *   - Greenfield write: when no Claude Desktop config exists, the installer
 *     creates one with a single `mcpServers["defi-risk"]` entry.
 *   - Merge: when a config already exists with OTHER servers, the installer
 *     adds `defi-risk` without removing or mutating the other entries.
 *   - Conflict: when `defi-risk` is already present, `mergeServerEntry` flags
 *     the conflict so the caller can prompt the user.
 *   - Atomic write: the write goes through a temp file + rename so a partial
 *     write cannot corrupt the original config.
 *
 * The full BDD criteria — Claude Desktop actually picking up the config
 * after a restart — is a manual user step on a Mac/Windows install of Claude
 * Desktop and is explicitly NOT auto-verified on this Linux build host.
 */

describe('install script — pure helpers', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'defi-risk-install-'));
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  describe('configPathFor', () => {
    it('returns the macOS Application Support path on darwin', () => {
      const path = configPathFor('darwin', '/Users/alice');
      expect(path).toBe(
        '/Users/alice/Library/Application Support/Claude/claude_desktop_config.json',
      );
    });

    it('returns the Windows %APPDATA% path on win32', () => {
      const path = configPathFor('win32', 'C:\\Users\\alice', 'C:\\Users\\alice\\AppData\\Roaming');
      expect(path).toContain('Claude');
      expect(path).toContain('claude_desktop_config.json');
    });

    it('returns a sane Linux fallback under ~/.config', () => {
      const path = configPathFor('linux', '/home/alice');
      expect(path).toBe('/home/alice/.config/Claude/claude_desktop_config.json');
    });
  });

  describe('defaultServerEntry', () => {
    it('uses npx as the command and references @defi-risk/mcp', () => {
      const entry = defaultServerEntry();
      expect(entry.command).toBe('npx');
      expect(entry.args).toContain('@defi-risk/mcp');
      expect(entry.args).toContain('defi-risk-mcp');
    });

    it('declares every env key the MCP server reads', () => {
      const entry = defaultServerEntry();
      const keys = Object.keys(entry.env ?? {});
      expect(keys).toEqual(
        expect.arrayContaining([
          'ALCHEMY_API_KEY',
          'ETHERSCAN_API_KEY',
          'TENDERLY_USER',
          'TENDERLY_PROJECT',
          'TENDERLY_ACCESS_KEY',
          'INDEX_NETWORK_KEY',
          'BRAVE_SEARCH_API_KEY',
        ]),
      );
    });
  });

  describe('readConfig', () => {
    it('returns an empty object for a missing file', () => {
      const result = readConfig(join(workdir, 'does-not-exist.json'));
      expect(result).toEqual({});
    });

    it('returns an empty object for an empty file', () => {
      const path = join(workdir, 'empty.json');
      writeFileSync(path, '   \n', 'utf8');
      expect(readConfig(path)).toEqual({});
    });

    it('parses a real config back to an object', () => {
      const path = join(workdir, 'config.json');
      const cfg: ClaudeDesktopConfig = {
        mcpServers: { other: { command: 'node', args: ['x.js'] } },
      };
      writeFileSync(path, JSON.stringify(cfg), 'utf8');
      const parsed = readConfig(path);
      expect(parsed.mcpServers?.other?.command).toBe('node');
    });

    it('throws if the JSON root is not an object', () => {
      const path = join(workdir, 'bad.json');
      writeFileSync(path, '[1, 2, 3]', 'utf8');
      expect(() => readConfig(path)).toThrow(/not a JSON object/);
    });
  });

  describe('mergeServerEntry — greenfield write', () => {
    it('creates the mcpServers map from scratch when none exists', () => {
      const entry = defaultServerEntry();
      const { next, conflict } = mergeServerEntry({}, entry);

      expect(conflict).toBe(false);
      expect(next.mcpServers).toBeDefined();
      expect(next.mcpServers?.['defi-risk']).toEqual(entry);
      expect(Object.keys(next.mcpServers ?? {})).toEqual(['defi-risk']);
    });
  });

  describe('mergeServerEntry — merge with existing config', () => {
    it('preserves OTHER mcp servers and unrelated top-level keys', () => {
      const existing: ClaudeDesktopConfig = {
        mcpServers: {
          'github-mcp': { command: 'node', args: ['/path/to/github-mcp.js'] },
          filesystem: { command: 'npx', args: ['-y', 'fs-mcp'] },
        },
        // Hypothetical unrelated field — must round-trip untouched.
        someOtherKey: { foo: 'bar' },
      } as ClaudeDesktopConfig;

      const entry = defaultServerEntry();
      const { next, conflict } = mergeServerEntry(existing, entry);

      expect(conflict).toBe(false);
      expect(next.mcpServers?.['github-mcp']?.command).toBe('node');
      expect(next.mcpServers?.filesystem?.args).toContain('fs-mcp');
      expect(next.mcpServers?.['defi-risk']).toEqual(entry);
      expect((next as { someOtherKey?: unknown }).someOtherKey).toEqual({ foo: 'bar' });
    });
  });

  describe('mergeServerEntry — conflict prompt', () => {
    it('flags conflict=true when defi-risk already exists', () => {
      const existing: ClaudeDesktopConfig = {
        mcpServers: {
          'defi-risk': {
            command: 'node',
            args: ['/old/path/dist/index.js'],
            env: { ALCHEMY_API_KEY: 'sk-old' },
          },
        },
      };

      const fresh: McpServerEntry = defaultServerEntry();
      const { next, conflict } = mergeServerEntry(existing, fresh);

      expect(conflict).toBe(true);
      // Caller is responsible for prompting; the merge result already shows
      // what the post-overwrite state would be.
      expect(next.mcpServers?.['defi-risk']?.command).toBe('npx');
      expect(next.mcpServers?.['defi-risk']?.env?.ALCHEMY_API_KEY).toBe('');
    });

    it('does not silently mutate the input config', () => {
      const existing: ClaudeDesktopConfig = {
        mcpServers: {
          'defi-risk': { command: 'node', args: ['/old.js'] },
        },
      };
      const before = JSON.stringify(existing);
      mergeServerEntry(existing, defaultServerEntry());
      expect(JSON.stringify(existing)).toBe(before);
    });
  });

  describe('writeConfigAtomic', () => {
    it('writes the config to disk and is round-trippable', () => {
      const path = join(workdir, 'nested', 'claude_desktop_config.json');
      const cfg: ClaudeDesktopConfig = {
        mcpServers: { 'defi-risk': defaultServerEntry() },
      };
      writeConfigAtomic(path, cfg);

      expect(existsSync(path)).toBe(true);
      const roundtrip = JSON.parse(readFileSync(path, 'utf8')) as ClaudeDesktopConfig;
      expect(roundtrip.mcpServers?.['defi-risk']?.command).toBe('npx');
    });

    it('creates parent directories that do not yet exist', () => {
      const path = join(workdir, 'a', 'b', 'c', 'config.json');
      writeConfigAtomic(path, { mcpServers: { 'defi-risk': defaultServerEntry() } });
      expect(existsSync(dirname(path))).toBe(true);
      expect(existsSync(path)).toBe(true);
    });

    it('does not leave a temp sibling file after a successful write', () => {
      const path = join(workdir, 'config.json');
      writeConfigAtomic(path, { mcpServers: { 'defi-risk': defaultServerEntry() } });

      const siblings = readdirSync(workdir);
      const lingeringTmps = siblings.filter((name: string) => name.startsWith('config.json.tmp-'));
      expect(lingeringTmps).toEqual([]);
    });

    it('overwrites an existing config without losing the parent directory', () => {
      const path = join(workdir, 'config.json');
      writeFileSync(path, JSON.stringify({ mcpServers: { other: { command: 'x', args: [] } } }));

      const merged = mergeServerEntry(readConfig(path), defaultServerEntry()).next;
      writeConfigAtomic(path, merged);

      const after = JSON.parse(readFileSync(path, 'utf8')) as ClaudeDesktopConfig;
      expect(after.mcpServers?.other?.command).toBe('x');
      expect(after.mcpServers?.['defi-risk']?.command).toBe('npx');
    });
  });
});
