interface Prompt {
  /** Number shown in the section index. */
  index: number;
  /** Human prompt as typed in Claude Desktop. */
  prompt: string;
  /** Tool calls Claude makes (one per line). */
  toolCalls: string[];
  /** Compact preview of the response shape Claude returns. */
  responseShape: string;
}

const PROMPTS: Prompt[] = [
  {
    index: 1,
    prompt:
      "I'm thinking of supplying 10,000 USDC to Aave on Base. What are the risks?",
    toolCalls: [
      'get_position_risk({ chain: "base", protocol: "aave", position_id: "..." })',
      'explain_protocol_risk({ protocol_name: "aave" })',
    ],
    responseShape: `{
  summary: "Moderate. Aave V3 on Base is heavily audited but ...",
  dimensions: {
    audit:        { score: 22, reasoning: "..." },
    oracle:       { score: 35, reasoning: "..." },
    exploit:      { score: 18, reasoning: "..." },
    composability: { score: 41, reasoning: "..." },
    mev:          { score: 12, reasoning: "..." },
    slippage:     { score:  8, reasoning: "..." }
  },
  sources: ["https://...", "https://..."]
}`,
  },
  {
    index: 2,
    prompt:
      'Find me a yield play with > 8% real yield on Base, no rebase tokens, audited within last 12 months.',
    toolCalls: [
      'discover_yields_by_intent({ intent: "...", min_apy: 8, chain: "base" })',
    ],
    responseShape: `{
  source: "index_network" | "brave_search" | "defillama_floor",
  candidates: [
    {
      protocol: "...",
      pool: "...",
      apy_real_pct: 9.2,
      risk_score: 34,
      reasoning: "audited 2026-02 by ...; oracle: Chainlink"
    }
    // ranked by risk-adjusted real yield
  ]
}`,
  },
  {
    index: 3,
    prompt: "I'm about to sign this — what's wrong with it?  0xf86c0a85…",
    toolCalls: [
      'simulate_tx_risk({ raw_tx: "0xf86c0a85...", chain: "ethereum" })',
    ],
    responseShape: `{
  decoded:      { to: "...", function: "swapExactTokensForTokens", ... },
  mev_risk:     { score: 78, reason: "large notional, public mempool" },
  slippage_pct: 3.4,
  recommendations: [
    "Route through Flashbots Protect to avoid sandwich attack",
    "Tighten slippage to <= 0.5%"
  ],
  sources: ["..."]
}`,
  },
];

/**
 * Section 2 — three stacked prompt examples (server component).
 * Pulled from PRD §Demo moment + claude-desktop-config-example.json.
 */
export default function PromptShowcase() {
  return (
    <div className="flex flex-col gap-8">
      {PROMPTS.map((p) => (
        <article
          key={p.index}
          className="flex flex-col gap-3 rounded-md border border-[#262626] bg-[#141414] p-6 sm:p-8"
        >
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-[#A3A3A3]">
              0{p.index} · prompt
            </span>
          </div>
          <p className="text-base leading-relaxed text-[#FAFAFA] sm:text-lg">
            {p.prompt}
          </p>

          <div className="mt-2 flex flex-col gap-2">
            <span className="font-mono text-xs text-[#A3A3A3]">tool calls</span>
            <pre className="overflow-x-auto rounded-sm border border-[#262626] bg-[#0A0A0A] px-4 py-3 font-mono text-xs leading-relaxed text-[#FAFAFA] sm:text-sm">
              <code>{p.toolCalls.join('\n')}</code>
            </pre>
          </div>

          <div className="mt-2 flex flex-col gap-2">
            <span className="font-mono text-xs text-[#A3A3A3]">response shape</span>
            <pre className="overflow-x-auto rounded-sm border border-[#262626] bg-[#0A0A0A] px-4 py-3 font-mono text-xs leading-relaxed text-[#FAFAFA]">
              <code>{p.responseShape}</code>
            </pre>
          </div>
        </article>
      ))}
    </div>
  );
}
