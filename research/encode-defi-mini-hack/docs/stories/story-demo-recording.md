# story-demo-recording

**Epic:** 3 — Polish + Submit
**Estimated coding time:** 1h
**Depends on:** Epic 1 + Epic 2 done
**Status:** PENDING

---

## Goal

Record + edit a 90-second demo video showing all 3 prompts running in Claude Desktop. Upload to YouTube/Loom. Embed link in README + landing + Encode submission.

## BDD acceptance criteria

```
Given the recording is captured
When the video file is inspected
Then the duration is 60-120 seconds
And the resolution is at least 1080p
And the audio (if any) is clear (no clipping, no background hum)
And all 3 prompts are visibly typed and answered

Given the video is uploaded
When the public URL is opened
Then the video plays without auth requirements
And the thumbnail displays Claude Desktop UI clearly
And the title is "defi-risk-mcp — DeFi risk in Claude Desktop"
And the description includes GitHub link + Encode hackathon attribution

Given the video link
When pasted into the README
Then the link renders as a clickable thumbnail (or text link if MD viewer doesn't support thumbnail)
And the same link is in the landing page hero secondary CTA
And the same link is in the Encode submission form
```

## File modification map

- `.github/demo-script.md` — NEW — 90-second script with timing markers
- (External) — YouTube or Loom upload, link captured in `sprint-status.yaml`
- `README.md` — UPDATE — embed video link
- `landing/app/page.tsx` — UPDATE — video link in hero secondary CTA

## Shell verification

```bash
# Manual checks (no automation possible for video content)
echo "Verify checklist:"
echo "  [ ] Duration 60-120s"
echo "  [ ] 1080p+"
echo "  [ ] All 3 prompts visible and answered"
echo "  [ ] Public URL opens without auth"
echo "  [ ] Title + description correct"
echo "  [ ] Linked from README, landing, submission"

# Once recorded, validate URL is reachable
DEMO_URL="<paste here>"
curl -s -o /dev/null -w "%{http_code}\n" "$DEMO_URL" | grep -qE "^(200|301|302)" && echo "OK: URL reachable"
```

## Out of scope

- Voiceover with narration (judges read; on-screen typing is enough)
- Animated transitions / motion graphics
- Multiple platforms (one upload, one canonical URL)

## Notes

- Recording tool: macOS QuickTime (Cmd+Shift+5) or Loom desktop app for fastest workflow.
- Pre-warm caches via `scripts/demo-prep.sh` before recording — no waiting for API on screen.
- Do exactly the script in `.github/demo-script.md` — no improvising. Time it.
- If recording fails at Demo Day live: this video is the fallback the audience sees.
