type Category = 'read' | 'synthesize' | 'discover';

interface ToolCardProps {
  name: string;
  description: string;
  category: Category;
}

const CATEGORY_LABEL: Record<Category, string> = {
  read: 'read',
  synthesize: 'synthesize',
  discover: 'discover',
};

/**
 * Static server component. Hover state implemented in pure CSS so no
 * `'use client'` needed.
 *
 * Interaction states (per ux-spec.md):
 *  - hover: translateY(-2px) + border #404040 (200ms ease)
 *  - focus: focus ring (handled by :focus-visible globally) — card is
 *    not interactive itself, but if used as an <a> wrapper it would be.
 */
export default function ToolCard({ name, description, category }: ToolCardProps) {
  return (
    <article
      tabIndex={0}
      className="group flex flex-col gap-2 rounded-md border border-[#262626] bg-[#141414] p-4 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-[#404040] focus:-translate-y-0.5 focus:border-[#404040] sm:p-6"
    >
      <header className="flex items-start justify-between gap-3">
        <h3 className="font-mono text-sm font-semibold text-[#FAFAFA] sm:text-base">
          {name}
        </h3>
        <span className="shrink-0 rounded-sm border border-[#262626] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[#A3A3A3]">
          {CATEGORY_LABEL[category]}
        </span>
      </header>
      <p className="text-sm leading-relaxed text-[#A3A3A3]">{description}</p>
    </article>
  );
}
