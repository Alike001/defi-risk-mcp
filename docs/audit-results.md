# anti-slop audit — landing page vs Bun anchor

**Story:** [story-anti-slop-audit](../research/encode-defi-mini-hack/docs/stories/story-anti-slop-audit.md)
**Issue:** [#13](https://github.com/Alike001/defi-risk-mcp/issues/13)
**Run date:** 2026-05-06
**Captured by:** `landing/scripts/audit.sh` (Playwright + sharp; viewport 1440×900, DPR 1)
**Anchor:** https://bun.sh
**Current build:** `http://localhost:3000` (Next 15 dev, no Vercel preview deployed yet)
**Capture method:** **Playwright + manual structural review**
(no `ANTHROPIC_API_KEY` available in this environment — vision-LLM verdict was skipped per the story's fallback path; this is an honest, manual delta against `ux-spec.md` + `11-ui-mining.md`)

---

## verdict: ok

The current build matches the Bun anchor on every load-bearing axis the
ux-spec calls out (palette discipline, install-as-hero, single accent,
mono code, left alignment, no DeFi-app tells). The few visible
differences are either explicitly out-of-scope per `ux-spec.md` or
subjective polish that does not pattern-match as AI slop.

No banned class from `ux-spec.md` §"Banned Tailwind classes" appears in
the source tree (re-verified: `landing/scripts/check-banned-classes.sh`
exits 0).

---

## screenshots

| | path | size |
|---|---|---|
| Anchor (Bun) | `landing/.audit/anchor-bun-1440x900.png` | 215 KB |
| Current build | `landing/.audit/build-current-1440x900.png` | 23 KB |

Both PNGs are committed and within the 500 KB cap defined by the story.

---

## structural delta — axis-by-axis

| Axis | Anchor (Bun) | Current build | Verdict |
|---|---|---|---|
| Background | `#0F0E0E`-ish (warm near-black) | `#0A0A0A` (DESIGN.md token) | matches anchor |
| Surface | dark grey panel for code blocks | `#141414` for `InstallBlock` + cards | matches anchor |
| Text primary | near-white, geometric sans | `#FAFAFA`, Geist Sans 700 | matches anchor |
| Text secondary | mid-grey | `#A3A3A3` | matches anchor |
| Single accent | warm cream `#FBF0DF` (Build CTA + tab underline + italic "fast") | warm cream `#FBF0DF` border on `InstallBlock` (accent prop) | matches anchor |
| Layout | left-aligned hero, install-block primacy | left-aligned hero, install-block primacy | matches anchor |
| Hero copy | "Bun is a fast JavaScript runtime." | "Give Claude DeFi-grade risk awareness." | matches anchor (terse, dev-tone) |
| Install block | code + Copy button, `curl -fsSL …` | code + Copy button, `npx @defi-risk/mcp install` | matches anchor |
| Code-as-content | benchmark code block in hero | 3 prompt code blocks below hero | matches anchor (genre standard) |
| Mono | mono throughout for code, tool names, eyebrow | Geist Mono for code, tool names, eyebrow | matches anchor |
| Display font | geometric sans, weight 700 | Geist Sans, weight 700 | matches anchor |
| Banned tells (charts / token logos / "trusted by" soup / TVL) | none | none | matches anchor |
| Gradients | none | none | matches anchor |
| Card pattern | `rounded` + 1px border on dark surface | `rounded-md border border-[#262626]` on `bg-[#141414]` | matches anchor |
| Hover (links) | opacity / underline | `hover:opacity-90 hover:underline` (`page.tsx:152`) | matches anchor |
| Hover (cards) | subtle | `translate-y-[-2px]` + border shift (per ux-spec) | matches anchor |

---

## minor deltas (logged, no fix required)

These are observed but not blocking, and either explicitly out-of-scope
per `ux-spec.md` or stylistic choices that do not regress the
"infrastructure not app" signal:

1. **No top nav.** Bun has a horizontal nav (Build / Docs / Blog / Reference / Guides / Discord). We do not.
   - **Decision:** explicit accept.
   - **Reason:** `ux-spec.md` §"Out of scope" lists *"Multi-page navigation"* — single-route by design. A nav would be slop on a single-page site.

2. **No right-column visualization.** Bun's hero has a benchmark chart in the right column.
   - **Decision:** explicit accept.
   - **Reason:** `ux-spec.md` §"Banned Tailwind classes" + §"Out of scope" both ban *"chart libraries (recharts, victory, etc.) on landing page"* — and the spec page-section structure defines a single-column hero only.

3. **No italic accent word in H1.** Bun italicises *"fast"* with a warm-pink hue. Our H1 is solid.
   - **Decision:** explicit accept.
   - **Reason:** stylistic flourish, not load-bearing. The single-accent rule is satisfied by the `#FBF0DF` border on `InstallBlock` (`landing/components/InstallBlock.tsx:67`). Adding a second accent hue (Bun's pink) would *break* DESIGN.md, not match it.

4. **No "logo strip" / consumer-of section visible above the fold.** Bun shows ANTHROPIC, Typeform, Midjourney, tailwindcss, Lovable, CodeRabbit, replit, CURSOR.
   - **Decision:** explicit accept.
   - **Reason:** `11-ui-mining.md` §DESIGN.md banned list explicitly forbids *"'Trusted by' logo soup (we have no users yet — don't fake it)"*. We have no real users to list. Faking them would be the textbook slop pattern this audit exists to catch.

5. **Eyebrow string differs.** Bun: announcement banner. Ours: `MCP SERVER · TYPESCRIPT · MIT` mono caps.
   - **Decision:** explicit accept.
   - **Reason:** identical pattern (small mono uppercase eyebrow above H1). Different content because we have nothing to announce.

---

## banned-classes confirmation

Re-ran `bash landing/scripts/check-banned-classes.sh` after capture →
exit 0. Scanned: `app/`, `components/`, `.next/static/`, `.next/server/`.
Patterns checked include all 17 banned tokens from `ux-spec.md` and
`scripts/check-banned-classes.sh`:

```
bg-gradient-to-, from-purple-, from-violet-, from-pink-,
from-blue-.*to-cyan, rounded-xl shadow-md, backdrop-blur-md,
text-gray-600, ui-avatars.com, picsum.photos, randomuser.me,
Lorem ipsum, John Doe, Jane Smith, user@example.com,
dark:[a-z], recharts, victory-
```

No matches. The build passes the §14 anti-slop grep gate.

---

## reproducing this audit

```bash
cd landing
bash scripts/audit.sh
# → captures .audit/anchor-bun-1440x900.png + .audit/build-current-1440x900.png
# → both ≤ 500 KB (sharp re-encode if needed)
```

Override anchor or skip dev boot with env vars:

```bash
ANCHOR_URL=https://bun.sh \
CURRENT_URL=https://defi-risk-mcp.vercel.app \
  bash scripts/audit.sh --skip-dev
```

When `ANTHROPIC_API_KEY` is in the environment, a follow-up vision-LLM
pass can be wired in (see `~/.claude/skills/sahil-anti-slop-audit/`);
this audit run was manual structural-only by design and labelled as such.

---

## decision

**Verdict:** `ok` → story closes; no follow-up landing-page fix story
required. No source files in `landing/` were modified by this audit.
