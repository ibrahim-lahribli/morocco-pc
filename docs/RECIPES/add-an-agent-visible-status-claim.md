# Recipe: add or change an agent-visible status claim

"Status" is the repo's most drift-prone artifact (nine of twelve audit findings). Claims
about what exists must land in the right file — and only there.

1. Pick the ONE authoritative home for the claim (`AGENTS.md` §9 precedence table):
   - "what exists / current status" → `CONTEXT.md`;
   - engine contract / why → the decision log (new entry or UPDATE block);
   - command operability → `DEVELOPMENT_NOTES.md`;
   - open gaps → `docs/OPEN_GAPS.md` (register row, not prose elsewhere).
2. Keep every other doc pointing at the home, not restating it.
3. Fact-shaped claims get mechanical guards: if you write "Decisions 1–N", a count, a range,
   or "X exists", check whether `scripts/verify-docs.js` asserts it — extend it if not.
4. Generated files are never the place for hand-written claims: `docs/DECISION_INDEX.md`,
   `docs/SCHEMA_REFERENCE.md`, `docs/DATA_STATE.md` are regenerate-only.
5. Line endings: `docs/*.md` and `database/**` are CRLF; root `AGENTS.md` is LF. A stray-LF
   file reads as a whole-file diff.
6. If the claim supersedes an older doc, add the supersession marker INLINE in the older doc
   (Decision 18 item 7 is the cautionary tale: a recorded supersession nobody starting from
   the old doc can see).

Verify:

```bash
npm run verify:docs
node scripts/gen-decision-index.js --check
git diff --stat              # no whole-file line-ending churn
```
