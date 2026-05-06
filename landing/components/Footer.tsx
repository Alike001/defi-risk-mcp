/**
 * One-line footer (server component) — per ux-spec.md section 6.
 * No social icons, no "made with love" — terse dev-tone.
 */
export default function Footer() {
  return (
    <footer className="border-t border-[#262626] py-6">
      <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-2 px-6 font-mono text-xs text-[#A3A3A3] sm:flex-row sm:items-center">
        <p>
          <a
            href="https://github.com/Alike001/defi-risk-mcp"
            className="text-[#FAFAFA] transition-opacity duration-150 hover:opacity-90"
          >
            github.com/Alike001/defi-risk-mcp
          </a>
          <span className="mx-2 text-[#262626]">·</span>
          MIT License
        </p>
        <p>Built for Encode DeFi Mini Hack 2026</p>
      </div>
    </footer>
  );
}
