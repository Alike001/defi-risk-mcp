# story-encode-submission

**Epic:** 3 — Polish + Submit
**Estimated coding time:** 0.5h
**Depends on:** all other Epic 3 stories
**Status:** PENDING

---

## Goal

File the project on Encode Club's hackathon platform with all required artifacts. Hit the submission deadline.

## BDD acceptance criteria

```
Given the Encode platform login (sign-in)
When the DeFi Mini Hack project page is found
Then "Submit" / "Edit submission" is accessible

Given the submission form
When all fields are filled
Then the project name is "defi-risk-mcp"
And the one-line pitch is "An MCP server that turns Claude Desktop into a DeFi risk analyst."
And the GitHub repo URL is the public repo
And the demo video URL is the YouTube/Loom link
And the landing page URL is the Vercel preview
And the team field lists builder(s)
And the long description (≥ 200 chars) cites Index Network MCP wrapper as the differentiator
And screenshots include: Claude Desktop demo, landing hero, README

Given the submission is filed
When the submission status is checked
Then status reads "submitted" or equivalent (not "draft")
And the timestamp is before the official deadline (verify Day 1 — likely 2026-04-30 18:00 BST)

Given the submission is post-deadline
When the user contacts Encode (Discord) with proof of build
Then the team is given a clear path forward (late submission, post-deadline showcase, or roll into next mini hack)
```

## File modification map

- `docs/submission-text.md` — NEW — paste-ready text for the Encode form fields
- `sprint-status.yaml` — UPDATE — set `submission_url` field

## Shell verification

```bash
# All artifacts present?
test -f README.md && echo "OK: README"
test -f LICENSE && echo "OK: LICENSE"
grep -q "MIT" LICENSE && echo "OK: MIT"
test -f docs/submission-text.md && echo "OK: submission text drafted"

# Manual: file the submission via web UI
echo "Final manual step — submit via Encode platform"
echo "Capture confirmation screenshot in .github/submission-confirmation.png"
```

## Out of scope

- Multiple submissions (Encode mini hacks are 1 submission per team)
- Marketing the submission externally (post-judging concern)

## Notes

- Verify the submission deadline on Day 1 by signing into Encode platform — the page UI says "still applying open" but FAQ says "deadline once accepted." If hard deadline already passed, switch this story to "Late-submission ask" and contact Encode Discord with proof of in-progress build.
- Submission text: emphasize judges' rubric (Innovation × Utility × Execution). Lead with "first-ever Index Network MCP wrapper" for innovation; lead with "60-second install for any Claude Desktop user" for utility; lead with "shipped 7 tools + landing + video in 3 days" for execution.
