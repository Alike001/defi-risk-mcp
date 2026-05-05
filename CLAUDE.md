# CLAUDE.md — [Project Name]

_Updated: [date]. Managed by sahil-coding-protocol._

## What this is

[One paragraph: what problem this project solves, who uses it, what it does.]

## Stack

[List: language + framework + main deps + deploy target. One line per item.]

## Top-3 commands

```bash
.claude/scripts/green-light.sh   # full gate: tests + lint + types + visual + §14 grep
pnpm dev                          # or npm run dev / cargo run / python main.py
pnpm test                         # or pytest / cargo test / forge test
```

## Library research rule (mandatory)

Before implementing ANYTHING from scratch, you must check Context7 first:

```bash
# Step 1: find the library
mcp__context7__resolve-library-id libraryName="<what you need>"

# Step 2: read the docs
mcp__context7__query-docs context7CompatibleLibraryID="<id>" topic="<specific area>" tokens=5000
```

**If a library exists that solves it, use it. Do not build it yourself.**

This applies to: UI components, form validation, state management, auth, animations, chart/data viz, date handling, file uploads, websockets, crypto primitives — everything.

## Required external libraries (use these, do not reinvent)

[Fill in from SPEC.md Dependencies section. Example:]

| Library | Purpose | How to add |
|---|---|---|
| `zod` | Schema validation | `pnpm add zod` |
| `zustand` | Global state | `pnpm add zustand` |
| `framer-motion` | Animations + transitions | `pnpm add framer-motion` |
| Magic UI | Animated hero components | Copy from magicui.design (MIT) |
| `@anthropic-ai/sdk` | Claude API | `pnpm add @anthropic-ai/sdk` |

## Rules for this repo

[Anti-patterns specific to this codebase. Grows over time as agents burn themselves.]

- Never use `from-purple-500 to-pink-500` or any default Tailwind purple gradient
- Never use `font-sans` without an explicit font import (Inter default = slop)
- All React state goes through Zustand — never local useState for shared state
- `§14 grep gate` must be clean: no mock/fake/dummy/hardcoded in hot path
- Never write "John Doe", "lorem ipsum", or "$1,234.56" — use realistic demo data

## BDD acceptance criteria

Read `SPEC.md` for the full list. For each story you implement:
1. Read the Given/When/Then criteria for that story
2. Write the tests FIRST (ATDD — tests come before implementation)
3. Implement until `pnpm test` passes those specific scenarios
4. Check `.claude/last-review.json` after every UI edit — fix before continuing

## Anchor products

[UI reference products, if applicable. Links to screenshots/anchor/.]

- Product: [name + URL]
- Anchor screenshots: `screenshots/anchor/` — immutable, never overwrite
- Design tokens: primary [hex], secondary [hex], font [name], spacing [system]

## Known pitfalls

[Things that have already burned an agent. Grows over time.]

## Where things live

- **SPEC.md (3-field brief):** `SPEC.md` at repo root — read this first for every task
  - Generated from story file: `research/<hackathon-slug>/docs/stories/story-<slug>.md` (if hackathon project)
  - Contains: Goal, Constraints, Acceptance (extracted from story file)
- **Story file (full context):** `research/<hackathon-slug>/docs/stories/story-<slug>.md`
  - Includes: user story, file map, BDD criteria, shell verification, notes for agents
  - Read this for context beyond the 3-field brief
- **Architecture + PRD:** `research/<hackathon-slug>/docs/architecture.md` + `docs/PRD.md` (locked after Abu approval)
- **Anchor screenshots:** `screenshots/anchor/`
- **Visual test baselines:** `screenshots/baseline/`
- **Reviewer output:** `.claude/last-review.json`
- **PR audit:** `.claude/last-audit.md`
- **Green-light log:** `.claude/green-light.log`

## CI requirement

`.github/workflows/ci.yml` must stay green on every commit. If CI is red:
1. Stop current work
2. Fix the CI failure
3. Re-run green-light.sh
4. Then continue

Never merge a PR while CI is red.
