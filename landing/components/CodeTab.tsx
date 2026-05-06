'use client';

import { useState } from 'react';

export interface CodeTabItem {
  id: string;
  label: string;
  /** Path or filename hint shown above the code block. */
  filename?: string;
  language?: string;
  code: string;
}

interface CodeTabProps {
  tabs: CodeTabItem[];
}

/**
 * Tabbed code-block component for the install-details section.
 * Client component — needs local state for the active tab.
 *
 * Interaction states (per ux-spec.md):
 *  - tab hover: text shifts from #A3A3A3 to #FAFAFA
 *  - active tab: underline accent #FBF0DF + text #FAFAFA
 *  - focus: focus ring (global)
 */
export default function CodeTab({ tabs }: CodeTabProps) {
  const [active, setActive] = useState(tabs[0]?.id ?? '');
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  if (!current) return null;

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Install configurations"
        className="flex flex-wrap items-center gap-1 border-b border-[#262626]"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              id={`tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              onClick={() => setActive(tab.id)}
              className={`relative -mb-px border-b-2 px-3 py-2 font-mono text-sm transition-colors duration-150 ${
                isActive
                  ? 'border-[#FBF0DF] text-[#FAFAFA]'
                  : 'border-transparent text-[#A3A3A3] hover:text-[#FAFAFA]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`panel-${current.id}`}
        aria-labelledby={`tab-${current.id}`}
        className="rounded-md border border-[#262626] bg-[#141414]"
      >
        {current.filename ? (
          <div className="border-b border-[#262626] px-4 py-2 font-mono text-xs text-[#A3A3A3]">
            {current.filename}
          </div>
        ) : null}
        <pre className="overflow-x-auto px-4 py-4 font-mono text-xs leading-relaxed text-[#FAFAFA] sm:text-sm">
          <code>{current.code}</code>
        </pre>
      </div>
    </div>
  );
}
