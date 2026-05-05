# story-landing-page

**Epic:** 3 — Polish + Submit
**Estimated coding time:** 3h
**Depends on:** none (parallel-able from Day 1)
**Status:** PENDING

---

## Goal

Build the single-scroll dev-tool landing page per `docs/ux-spec.md`. Deploy to Vercel preview. This is the back-pocket artifact for asynchronous judging.

## BDD acceptance criteria

```
Given the landing/ workspace exists
When `pnpm install && pnpm build` runs in landing/
Then exit code is 0
And no Tailwind warnings appear
And no banned classes (per ux-spec.md) appear in the output bundle (greppable)

Given the landing page is deployed to Vercel preview
When the deployed URL is opened
Then the hero displays the H1, sub, install code block with copy button, and "View on GitHub →" link
And all 6 sections render (hero / 3 prompts / tools list / why / install details / footer)
And no console errors in browser dev tools
And Lighthouse Performance score ≥ 85 on mobile

Given the install code block in hero
When the user clicks the copy button
Then the install command is copied to clipboard
And a "Copied!" feedback appears for ~1500ms
And clicking again works (no stale state)

Given the tools list section
When inspected in the rendered DOM
Then exactly 7 ToolCard elements render (or 5 if hard-cut applied)
And each card displays tool name in monospace
And cards in 2x4 grid (desktop) or 1-column (mobile)

Given the install details tabs section
When the user clicks each tab (Claude Desktop / Cursor / Cline)
Then the active tab style updates (accent underline)
And the displayed code block changes to the correct config

Given keyboard navigation
When tab is pressed repeatedly
Then focus rings appear on every interactive element
And focus rings use the accent color (#FBF0DF)

Given visual regression test
When the deployed page is screenshotted at 1440x900
Then the screenshot matches the anchor (Bun.sh structure) within sahil-anti-slop-audit verdict "ok" or only minor cosmetic deltas
```

## File modification map

- `landing/package.json` — NEW — Next 15, Tailwind v4, Geist fonts
- `landing/next.config.ts` — NEW — minimal
- `landing/tailwind.config.ts` — NEW — DESIGN.md tokens
- `landing/app/layout.tsx` — NEW — Geist Sans + Geist Mono via `next/font/google`, dark-only `<html class="dark">`
- `landing/app/page.tsx` — NEW — single-scroll page, 6 sections per ux-spec.md
- `landing/app/globals.css` — NEW — Tailwind import + DESIGN.md tokens as CSS vars
- `landing/components/InstallBlock.tsx` — NEW — code block + copy button
- `landing/components/ToolCard.tsx` — NEW — tool card with hover state
- `landing/components/CodeTab.tsx` — NEW — tabbed code blocks (Claude / Cursor / Cline)
- `landing/components/PromptShowcase.tsx` — NEW — section 2 (3 stacked prompt examples)
- `landing/components/Footer.tsx` — NEW — 1-line footer
- `landing/public/og-image.png` — NEW — OG image for sharing
- `landing/.eslintrc.json` — NEW — ban regex on banned classes (CI grep step)
- `landing/scripts/check-banned-classes.sh` — NEW — greps output bundle for banned tokens

## Shell verification

```bash
cd landing
pnpm install --frozen-lockfile
pnpm build
# banned-class check
bash scripts/check-banned-classes.sh && echo "OK: no banned classes" || echo "FAIL: banned class found"

# Lighthouse via Vercel preview URL (manual or via CI action)
# pass: Performance ≥ 85 on mobile

# Visual audit
# Run sahil-anti-slop-audit with anchor=https://bun.sh and current=<vercel preview URL>
# pass: verdict === "ok"
```

## Out of scope

- Light mode toggle
- i18n
- Live MCP demo embed (linked video only)
- Analytics / telemetry
- Cookie banner

## Notes

- Use `next/font/google` for Geist (verify availability — Geist Sans is on Google Fonts; Geist Mono is on `next/font/google` after Vercel added it).
- All 6 sections must render server-side (RSC). No client components except `InstallBlock` (clipboard) and `CodeTab` (state).
- Follow ux-spec.md's `Page section structure` table for height targets.
