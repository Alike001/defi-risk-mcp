import CodeTab from '@/components/CodeTab';
import Footer from '@/components/Footer';
import InstallBlock from '@/components/InstallBlock';
import PromptShowcase from '@/components/PromptShowcase';
import ToolCard from '@/components/ToolCard';

/**
 * Single-scroll landing for defi-risk-mcp.
 *
 * Anchors:
 *   - Bun (bun.sh)            — structure + install-as-hero
 *   - shadcn/ui (ui.shadcn.com) — palette discipline
 *   - Resend (resend.com)     — tool-list grid pattern
 *
 * Server component (RSC). Only InstallBlock + CodeTab are client components.
 */

const TOOLS: Array<{
  name: string;
  description: string;
  category: 'read' | 'synthesize' | 'discover';
}> = [
  // Lifted (concise) from src/tools/*.ts descriptions.
  {
    name: 'get_position_risk',
    description:
      'Synthesize risk for a known DeFi position across 6 dimensions: audit, oracle, exploit, composability, MEV, slippage.',
    category: 'synthesize',
  },
  {
    name: 'simulate_tx_risk',
    description:
      'Decode a raw unsigned tx; surface MEV exposure, slippage, counterparty info, and oracle deps before signing.',
    category: 'synthesize',
  },
  {
    name: 'explain_protocol_risk',
    description:
      'Audit history, exploit chain, oracle deps, composability tree, and recent governance for any protocol.',
    category: 'synthesize',
  },
  {
    name: 'get_recent_exploits',
    description:
      'Synthesized exploit feed from Rekt News RSS with optional chain + time-window filters.',
    category: 'read',
  },
  {
    name: 'discover_yields_by_intent',
    description:
      'Natural-language yield-discovery intent routed through Index Network → Brave → DefiLlama; ranked by risk.',
    category: 'discover',
  },
  {
    name: 'find_safer_alternatives',
    description:
      'Lower-risk replacements for a current position. Stretch tool — ships behind a feature flag.',
    category: 'discover',
  },
  {
    name: 'health_check',
    description:
      'Returns {ok: true} if the MCP server is reachable. Used to verify Claude Desktop spawned this server.',
    category: 'read',
  },
];

const COMPARISON_ROWS: Array<{ existing: string; us: string }> = [
  // Pulled from research/encode-defi-mini-hack/12-tech-deep-dive.md §2.
  {
    existing: 'Read on-chain state, portfolio positions, tx broadcast',
    us: 'Audit synthesis across Code4rena / Spearbit / OpenZeppelin / ToB',
  },
  {
    existing: 'Cross-chain swap + execute (deBridge), portfolio (Octav, Hive)',
    us: 'Pre-sign tx simulation: MEV / slippage / counterparty / oracle deps',
  },
  {
    existing: 'Action-oriented tools that need wallet keys',
    us: 'Read-only / simulate-only — never signs, never holds keys',
  },
  {
    existing: 'No exploit-feed reasoning, no oracle dependency graph',
    us: 'Exploit feed (Rekt) + oracle graph + composability tracing',
  },
];

const CLAUDE_CONFIG = `{
  "mcpServers": {
    "defi-risk": {
      "command": "npx",
      "args": ["-y", "-p", "@defi-risk/mcp", "defi-risk-mcp"],
      "env": {
        "ALCHEMY_API_KEY": "",
        "ETHERSCAN_API_KEY": ""
      }
    }
  }
}`;

const CURSOR_CONFIG = `{
  "mcpServers": {
    "defi-risk": {
      "command": "npx",
      "args": ["-y", "-p", "@defi-risk/mcp", "defi-risk-mcp"],
      "env": {
        "ALCHEMY_API_KEY": "",
        "ETHERSCAN_API_KEY": ""
      }
    }
  }
}`;

const CLINE_CONFIG = `{
  "mcpServers": {
    "defi-risk": {
      "command": "npx",
      "args": ["-y", "-p", "@defi-risk/mcp", "defi-risk-mcp"],
      "env": {
        "ALCHEMY_API_KEY": "",
        "ETHERSCAN_API_KEY": ""
      }
    }
  }
}`;

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0A0A0A] text-[#FAFAFA]">
      {/* ───────── 1. HERO ───────── */}
      <section
        id="hero"
        className="mx-auto flex min-h-[80vh] max-w-5xl flex-col justify-center gap-6 px-6 py-24"
      >
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#A3A3A3]">
          MCP server · TypeScript · MIT
        </p>
        <h1 className="max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight text-[#FAFAFA] sm:text-5xl md:text-6xl">
          Give Claude DeFi-grade risk awareness.
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-[#A3A3A3] sm:text-lg">
          An MCP server that synthesizes audits, exploits, oracles, MEV — exposed as 7 tools any AI agent can call.
        </p>

        <div className="mt-4 max-w-2xl">
          <InstallBlock command="npx @defi-risk/mcp install" accent />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-sm">
          <a
            href="https://github.com/Alike001/defi-risk-mcp"
            className="text-[#FAFAFA] underline-offset-4 transition-opacity duration-150 hover:opacity-90 hover:underline"
          >
            View on GitHub →
          </a>
          <a
            href="#install"
            className="text-[#A3A3A3] transition-colors duration-150 hover:text-[#FAFAFA]"
          >
            Install details
          </a>
          <span className="font-mono text-xs text-[#A3A3A3]">
            Works with: Claude Desktop · Cursor · Cline · Continue · Windsurf
          </span>
        </div>
      </section>

      {/* ───────── 2. THE 3 PROMPTS ───────── */}
      <section
        id="prompts"
        className="border-t border-[#262626]"
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-24">
          <header className="flex flex-col gap-2">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#A3A3A3]">
              02 · what claude does with it
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-[#FAFAFA] sm:text-3xl">
              Three prompts. Three tool calls. Risk-aware answers.
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-[#A3A3A3] sm:text-base">
              The same prompts judges see at Demo Day. No custom UI — just Claude Desktop, fluent in DeFi risk.
            </p>
          </header>
          <PromptShowcase />
        </div>
      </section>

      {/* ───────── 3. TOOLS LIST ───────── */}
      <section
        id="tools"
        className="border-t border-[#262626]"
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-24">
          <header className="flex flex-col gap-2">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#A3A3A3]">
              03 · tools
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-[#FAFAFA] sm:text-3xl">
              Seven tools. One risk lens.
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-[#A3A3A3] sm:text-base">
              Six shipped tools plus a connectivity health check. Read, synthesize, discover.
            </p>
          </header>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TOOLS.map((t) => (
              <ToolCard key={t.name} {...t} />
            ))}
          </div>
        </div>
      </section>

      {/* ───────── 4. WHY THIS EXISTS ───────── */}
      <section
        id="why"
        className="border-t border-[#262626]"
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-24">
          <header className="flex flex-col gap-2">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#A3A3A3]">
              04 · why this exists
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-[#FAFAFA] sm:text-3xl">
              Existing MCPs are action-oriented. We add the risk lens.
            </h2>
          </header>

          <div className="overflow-hidden rounded-md border border-[#262626]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#141414] font-mono text-xs uppercase tracking-wider text-[#A3A3A3]">
                <tr>
                  <th className="border-b border-[#262626] px-4 py-3 font-normal">
                    Existing MCPs cover
                  </th>
                  <th className="border-b border-[#262626] px-4 py-3 font-normal">
                    What we add
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row, i) => (
                  <tr key={i} className="border-b border-[#262626] last:border-b-0">
                    <td className="px-4 py-4 align-top text-[#A3A3A3]">{row.existing}</td>
                    <td className="px-4 py-4 align-top text-[#FAFAFA]">{row.us}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="max-w-2xl font-mono text-xs text-[#A3A3A3]">
            Source: research/encode-defi-mini-hack/12-tech-deep-dive.md §2 (incumbent matrix).
          </p>
        </div>
      </section>

      {/* ───────── 5. INSTALL DETAILS ───────── */}
      <section
        id="install"
        className="border-t border-[#262626]"
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-24">
          <header className="flex flex-col gap-2">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#A3A3A3]">
              05 · install details
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-[#FAFAFA] sm:text-3xl">
              Paste this into your client config.
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-[#A3A3A3] sm:text-base">
              Same JSON shape across Claude Desktop, Cursor, and Cline. Restart your client and the tools appear.
            </p>
          </header>

          <CodeTab
            tabs={[
              {
                id: 'claude',
                label: 'Claude Desktop',
                filename:
                  '~/Library/Application Support/Claude/claude_desktop_config.json',
                language: 'json',
                code: CLAUDE_CONFIG,
              },
              {
                id: 'cursor',
                label: 'Cursor',
                filename: '~/.cursor/mcp.json',
                language: 'json',
                code: CURSOR_CONFIG,
              },
              {
                id: 'cline',
                label: 'Cline',
                filename:
                  '~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
                language: 'json',
                code: CLINE_CONFIG,
              },
            ]}
          />

          <p className="max-w-2xl font-mono text-xs text-[#A3A3A3]">
            Need the long version? See{' '}
            <a
              href="https://github.com/Alike001/defi-risk-mcp/blob/main/docs/INSTALL.md"
              className="text-[#FAFAFA] underline-offset-4 hover:underline hover:opacity-90"
            >
              docs/INSTALL.md
            </a>
            .
          </p>
        </div>
      </section>

      {/* ───────── 6. FOOTER ───────── */}
      <Footer />
    </main>
  );
}
