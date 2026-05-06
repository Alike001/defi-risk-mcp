'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface InstallBlockProps {
  /** The command shown inside the block. */
  command: string;
  /** Visual prompt prefix. Default `$`. Pass empty string to omit. */
  prefix?: string;
  /** Apply the warm-cream accent border (hero CTA only). */
  accent?: boolean;
}

/**
 * Hero install command block + copy button.
 * Client component (clipboard requires `navigator.clipboard`).
 *
 * Interaction states (per ux-spec.md):
 *  - hover: opacity 0.9
 *  - focus: 2px focus ring #FBF0DF (handled by globals.css :focus-visible)
 *  - active: opacity 0.8, scale(0.99)
 *  - click: copies to clipboard, "Copied!" feedback for 1500ms
 *  - error: clipboard fail → text-select fallback
 */
export default function InstallBlock({
  command,
  prefix = '$',
  accent = false,
}: InstallBlockProps) {
  const [copied, setCopied] = useState(false);
  const [errored, setErrored] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setErrored(false);
    } catch {
      // Clipboard API failed — fall back to selecting the text so the
      // user can press Cmd/Ctrl-C themselves.
      const node = codeRef.current;
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      setErrored(true);
    }
    timeoutRef.current = setTimeout(() => {
      setCopied(false);
      setErrored(false);
    }, 1500);
  }, [command]);

  const borderClass = accent
    ? 'border-[#FBF0DF]/40 hover:border-[#FBF0DF]/70'
    : 'border-[#262626] hover:border-[#404040]';

  return (
    <div
      className={`group relative flex items-center justify-between gap-4 rounded-md border ${borderClass} bg-[#141414] px-4 py-3 transition-colors duration-150`}
    >
      <code
        ref={codeRef}
        className="overflow-x-auto whitespace-nowrap font-mono text-sm text-[#FAFAFA] sm:text-base"
      >
        {prefix ? <span className="mr-3 text-[#A3A3A3]">{prefix}</span> : null}
        {command}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'Copied' : 'Copy install command'}
        className="shrink-0 rounded border border-[#262626] bg-[#0A0A0A] px-3 py-1 font-mono text-xs text-[#A3A3A3] transition-all duration-150 hover:border-[#404040] hover:text-[#FAFAFA] hover:opacity-90 active:scale-[0.99] active:opacity-80"
      >
        {copied ? 'Copied!' : errored ? 'Press Ctrl-C' : 'Copy'}
      </button>
    </div>
  );
}
