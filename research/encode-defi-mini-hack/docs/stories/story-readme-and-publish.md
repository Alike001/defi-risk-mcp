# story-readme-and-publish

**Epic:** 3 — Polish + Submit
**Estimated coding time:** 1.5h
**Depends on:** Epic 1 + Epic 2 done (need working demo for screenshot)
**Status:** PENDING

---

## Goal

Write the repo README with hero screenshot, install one-liner, tool list, honest "what's missing" section. Publish package to npm under `@defi-risk/mcp` scope.

## BDD acceptance criteria

```
Given the README.md
When opened on GitHub
Then the title + 1-line pitch render in the first 100 pixels
And a hero screenshot of Claude Desktop using the MCP renders below
And the install one-liner is the first code block
And all 7 tools (or 5 if cut) are listed with one-line descriptions
And a "What's missing" section honestly lists deferred features (token emission scoring, governance translator)
And the License section says MIT
And the footer credits "Built for Encode DeFi Mini Hack 2026"

Given the package on npm
When `npm view @defi-risk/mcp` runs
Then the package exists with the latest version (>= 0.1.0)
And the `bin` field points to `dist/index.js`
And the `description` field matches the one-line pitch
And the `repository.url` points to the GitHub repo

Given a fresh user with no prior setup
When they run `npx @defi-risk/mcp install` (or follow manual config)
Then Claude Desktop config is updated with the correct entry
And restarting Claude Desktop shows "defi-risk" connected

Given vitest test suite
When `pnpm test` runs in the package root
Then exit code is 0
And ≥ 30 total test cases pass across all tools (cumulative)
```

## File modification map

- `README.md` — UPDATE (full rewrite) — hero, pitch, demo link, install, tools, what's missing, license, attribution
- `.github/hero.png` — NEW — Claude Desktop screenshot (captured during story-claude-desktop-three-prompts)
- `package.json` — UPDATE — `version` to 0.1.0, `description`, `repository`, `bin`, `keywords` (mcp, defi, claude, anthropic), `files` whitelist
- `bin/install.ts` — NEW — `npx @defi-risk/mcp install` script that updates Claude Desktop config
- `.npmignore` — NEW — exclude src/, tests/, docs/, data/fixtures/

## Shell verification

```bash
# README content checks
grep -q "defi-risk-mcp" README.md && echo "OK: title"
grep -q "Built for Encode DeFi Mini Hack 2026" README.md && echo "OK: attribution"
grep -q "MIT" README.md && echo "OK: license"
grep -q "What's missing" README.md && echo "OK: honest section"

# Hero screenshot
test -f .github/hero.png && echo "OK: hero exists" || echo "FAIL: missing hero"

# npm publish dry-run
pnpm publish --dry-run --access public

# After publish:
sleep 30
npm view @defi-risk/mcp version | grep -E "^[0-9]+\.[0-9]+\.[0-9]+$" && echo "OK: published"
```

## Out of scope

- Versioned releases (single 0.1.0 cut for hack)
- Automated changelog
- Marketing copy on npm page beyond what `description` field allows

## Notes

- npm scope `@defi-risk` may be unavailable. Fallback names in priority order: `defi-risk-mcp`, `@<user>/defi-risk-mcp`, `mcp-defi-risk`.
- The `npx install` script must NOT silently overwrite existing `claude_desktop_config.json` — read, merge, prompt for confirmation, write.
- Hero screenshot dimensions: 1440×900 max, PNG, < 500KB.
