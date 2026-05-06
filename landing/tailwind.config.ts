import type { Config } from 'tailwindcss';

/**
 * Tailwind v4 reads most theme tokens from `app/globals.css` `@theme`.
 * This file exists per story-landing-page file map and pins:
 *   - the content glob (so JIT only scans our app/components dirs)
 *   - the DESIGN.md token mirror, in case any tooling expects a JS config
 *
 * Source of truth for runtime tokens: app/globals.css (`@theme`).
 * If you change a token here, change it there too.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  // v4 ignores `darkMode` — we are dark-only via `<html class="dark">` in
  // app/layout.tsx; no dark: variants used (banned per ux-spec.md).
  theme: {
    extend: {
      colors: {
        // DESIGN.md palette (verbatim from research/encode-defi-mini-hack/11-ui-mining.md)
        background: '#0A0A0A',
        surface: '#141414',
        border: '#262626',
        'border-hover': '#404040',
        'text-primary': '#FAFAFA',
        'text-secondary': '#A3A3A3',
        accent: '#FBF0DF',
        destructive: '#EF4444', // UNUSED on landing
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // DESIGN.md type scale
        xs: ['12px', { lineHeight: '1.5' }],
        sm: ['14px', { lineHeight: '1.5' }],
        base: ['16px', { lineHeight: '1.6' }],
        lg: ['18px', { lineHeight: '1.6' }],
        xl: ['24px', { lineHeight: '1.3' }],
        '2xl': ['32px', { lineHeight: '1.2' }],
        '3xl': ['48px', { lineHeight: '1.1' }],
        '4xl': ['64px', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
      },
      spacing: {
        // DESIGN.md spacing scale (base 4)
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        6: '24px',
        8: '32px',
        12: '48px',
        16: '64px',
        24: '96px',
      },
      transitionDuration: {
        DEFAULT: '150ms',
        card: '200ms',
      },
    },
  },
  plugins: [],
};

export default config;
