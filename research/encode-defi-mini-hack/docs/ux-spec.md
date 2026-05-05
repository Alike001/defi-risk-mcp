# UX Spec — defi-risk-mcp

**Surfaces:** GitHub README hero + single-scroll landing page (Next.js 15).
**No app UI.** This is an MCP server — the "product UI" is Claude Desktop itself.

Source of truth: `research/encode-defi-mini-hack/11-ui-mining.md` (anchors, DESIGN.md, banned tokens).

---

## Anchor product

**Primary:** [Bun](https://bun.sh) — replicate structure, install-as-hero pattern, single-accent palette
**Secondary:** [shadcn/ui](https://ui.shadcn.com) — replicate palette discipline, code-forward content
**Tertiary inspiration:** [Resend](https://resend.com) — replicate tool-list-in-grid section pattern

**Why:** Judges browsing the submission on a phone need to recognize "MCP server / dev tool" in 2 seconds — not "another DeFi dashboard." All three anchors signal infrastructure, not application.

---

## Design tokens (resolved DESIGN.md — copy from `research/encode-defi-mini-hack/11-ui-mining.md`)

```
Background:        #0A0A0A
Surface:           #141414
Border:            #262626
Text primary:      #FAFAFA
Text secondary:    #A3A3A3
Accent:            #FBF0DF (warm cream — install CTA + active code-line ONLY)
Destructive:       #EF4444 (used ONLY in optional dashboard fallback for risk warnings)

Display:           Geist Sans, weights 600/700
Body:              Geist Sans, weight 400
Mono:              Geist Mono (all code, tool names, install commands)

Type scale (px):   12, 14, 16, 18, 24, 32, 48, 64
Spacing scale:     4, 8, 12, 16, 24, 32, 48, 64, 96 (base unit 4px)

Hover (links):     opacity 0.9, no transform, 150ms ease
Hover (cards):     translateY(-2px) + border #404040, 200ms ease
Loading skeleton:  h-4 bg-#141414 animate-pulse rounded
Page transition:   none
```

---

## Route shape

**Single route.** No multi-page navigation.

```
GET /                  Single-scroll landing (Next.js 15 app/page.tsx)
GET /api/og            Dynamic OG image (optional, only if time)
```

That is the entire frontend.

---

## Page section structure (top-to-bottom, single scroll)

| Section | Height | Content |
|---|---|---|
| **1. Hero** | ~80vh | H1: "Give Claude DeFi-grade risk awareness." • Sub: 1-line value prop • Install code block with copy button • "View on GitHub →" text link |
| **2. The 3 prompts** | ~60vh | 3 stacked code blocks: Claude Desktop prompt → tool calls (mono) → response shape preview |
| **3. Tools list** | ~50vh | 2x4 grid (or 4x2 on wide). 8 cards. Each: tool name in mono, 1-line description, category tag (read / synthesize / discover) |
| **4. Why this exists** | ~30vh | Comparison table: "Existing MCPs cover X / We add Y" — 4 rows max |
| **5. Install details** | ~40vh | Tabbed code blocks for Claude Desktop / Cursor / Cline configs |
| **6. Footer** | ~10vh | 1 line: GitHub link, MIT license, "Built for Encode DeFi Mini Hack 2026" |

**Total page:** ~270vh single-scroll.

---

## Demo shape rule

What gets demoed at Demo Day:
1. **Browser tab #1** — landing page (proves project legibility on web)
2. **Claude Desktop** — the actual demo (3 live prompts, see PRD §Demo moment)
3. **GitHub repo tab** — README hero (proves shipping discipline)

**The landing page is NOT the demo.** It is the back-pocket artifact for the asynchronous judging pass that happens after Demo Day. The live demo is Claude Desktop.

---

## Banned Tailwind classes (project-specific)

Per playbook §14 + DESIGN.md:

```
# Gradients (default palette tells)
from-purple-500 to-pink-500
from-violet-600 to-indigo-600
from-blue-500 to-cyan-500
bg-gradient-to-r/l/t/b/tr/tl/br/bl   (period — Bun uses NO gradients)

# Cards (generic AI pattern)
rounded-xl shadow-md                  (use rounded-md border border-[#262626] instead)
backdrop-blur-md                      (anchor doesn't use it)

# Type (Inter default)
font-sans without explicit @import    (Geist only)
text-gray-600                         (use text-[#A3A3A3])

# Mock data
ui-avatars.com / picsum.photos / randomuser.me   (we have no users; don't fake them)

# Layout
flex-1 as primary spacer              (use explicit padding/margin from spacing scale)
text-center on hero                   (Bun left-aligns; we left-align)

# Modes
dark:* variants                       (we are dark-only — no toggle)

# DeFi-app tells (CRITICAL — must avoid)
chart libraries (recharts, victory, etc.) on landing page
chain logos / token logos on landing page
TVL numbers / APY numbers as visual content
"trusted by" logo soup
```

---

## Interaction states (required per component)

### `InstallBlock` (the hero install command)
- [x] **Hover:** opacity 0.9
- [x] **Focus:** 2px focus ring `#FBF0DF` outline-offset 2px
- [x] **Active/pressed:** opacity 0.8 + scale(0.99)
- [x] **Click:** copies to clipboard, "Copied!" feedback for 1500ms
- [x] **Loading:** N/A (instant copy)
- [x] **Error:** clipboard API fail → text-select fallback

### `ToolCard` (8 cards in tools list)
- [x] **Hover:** translateY(-2px) + border #404040
- [x] **Focus:** focus ring on card (keyboard tabbable)
- [x] **Active:** N/A (cards are static unless we add expand-on-click stretch goal)
- [x] **Empty/Loading/Error:** N/A (static content)

### `CodeTab` (Claude Desktop / Cursor / Cline tabs)
- [x] **Hover (tab trigger):** text color shift to #FAFAFA (from #A3A3A3)
- [x] **Active tab:** underline accent #FBF0DF + text #FAFAFA
- [x] **Hover (code copy button):** opacity 0.9
- [x] **Click (copy):** "Copied!" feedback
- [x] **Error:** clipboard fallback

### `[UNDESIGNED]` states
- None. All resolved.

---

## README hero

**Location:** `README.md` at repo root.

**Structure:**

```markdown
<h1 align="center">defi-risk-mcp</h1>
<p align="center">Give Claude DeFi-grade risk awareness.</p>
<p align="center">
  <a href="<demo-video-url>">Watch demo</a> ·
  <a href="<landing-url>">Landing</a> ·
  <a href="#install">Install</a>
</p>

![hero screenshot](./.github/hero.png)

## Install

\`\`\`
npx @defi-risk/mcp install
\`\`\`

(Or manual config — see "Install details" below.)

## Tools

(7 lines, one per shipped tool.)

## What's missing

(Honest list. Token emission scoring + governance translator are next.)

## License

MIT.

Built for Encode DeFi Mini Hack 2026.
```

**Hero screenshot:** A real Claude Desktop screenshot of prompt 1 (the Aave-on-Base risk question) with the MCP tool calls visible. Captured Day 3 after final wiring. PNG at `landing/.github/hero.png`. Size: 1440×900 max.

---

## Out of scope (do not build)

- ❌ Light mode toggle
- ❌ Multi-page navigation
- ❌ Blog / changelog
- ❌ Auth / login
- ❌ User-generated content / accounts
- ❌ Live data on landing (no API calls — page is static)
- ❌ Charts, dashboards, DeFi visualizations
- ❌ "Trusted by" logos
- ❌ Newsletter signup
- ❌ Cookie banner (no tracking → no banner)
- ❌ Mobile-specific app shell (responsive only, no PWA)
- ❌ i18n
