# story-anti-slop-audit

**Epic:** 3 — Polish + Submit
**Estimated coding time:** 0.5h
**Depends on:** story-landing-page (deployed)
**Status:** PENDING

---

## Goal

Run `sahil-anti-slop-audit` on the deployed landing page against the Bun.sh anchor. Surface any blocking visual deltas. Fix or accept-and-document before submission.

## BDD acceptance criteria

```
Given the landing page is deployed to Vercel preview
When sahil-anti-slop-audit runs with:
  - anchor: https://bun.sh (Playwright capture at 1440x900)
  - current: <Vercel preview URL>
Then the audit returns a verdict ∈ {"ok", "minor", "blocking"}

Given verdict is "ok"
When story is closed
Then no further action

Given verdict is "minor" with deltas listed
When the deltas are reviewed
Then each delta is either fixed in landing/ OR explicitly accepted with reasoning recorded in this story file
And no banned class from ux-spec.md appears in any flagged delta

Given verdict is "blocking"
When deltas are surfaced
Then story is NOT closed
And a follow-up landing-page fix story is created in stories/ folder
And Day 3 polish cycle continues until verdict is "ok" or "minor with all accepted"
```

## File modification map

- `docs/audit-results.md` — NEW — captures audit verdict, deltas, decisions
- (Optional) `landing/...` — UPDATE — fixes for blocking deltas

## Shell verification

```bash
# Invoke the audit (skill-driven, not pure shell)
echo "Run skill: sahil-anti-slop-audit"
echo "Inputs:"
echo "  - anchor: https://bun.sh"
echo "  - current: <Vercel preview URL>"
echo "Capture verdict + deltas in docs/audit-results.md"

# Verify file exists
test -f docs/audit-results.md && echo "OK: audit results recorded"
grep -E "verdict: (ok|minor|blocking)" docs/audit-results.md && echo "OK: verdict captured"
```

## Out of scope

- Refactoring the entire landing page (only fix flagged deltas)
- Comparing to anchors other than Bun (single-anchor audit)

## Notes

- This is the gate before Encode submission. Don't ship a landing page that pattern-matches as AI slop.
- If audit returns "blocking" and Day 3 has < 2h left: cut landing page entirely from submission, ship just the README + demo video. The MCP server is the actual product.
