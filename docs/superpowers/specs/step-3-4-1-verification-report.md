# Step 3.4.1 — Remote verification and documentation reconciliation: report

**Date:** 2026-11-07
**Branch:** `feature/v2-design`
**Step 3.4 baseline:** `3a65bad`
**Step 3.4 final commit:** `f68cb79`
**Scope:** verification and documentation only. No design, token, API, copy or behaviour change.

## A. Purpose

This is a small verification follow-up to Step 3.4, not another refinement phase. It corrects stale Git
information in the Step 3.4 report, replaces the RTL direction gate with a matcher that has positive
and negative coverage and reports locations, and states exactly what the card-alignment change does
and does not guarantee. Nothing on the homepage was redesigned, and no visual value moved.

## B. Starting Git state

Read before any edit, and after a `git fetch origin` that returned nothing new:

| Fact                       | Value                                                                 |
| -------------------------- | --------------------------------------------------------------------- |
| Local `HEAD`               | `f68cb79486a60d8eaf86adb620ec814897bcc779`                            |
| `origin/feature/v2-design` | the same commit                                                       |
| Branch status              | `## feature/v2-design...origin/feature/v2-design` — ahead 0, behind 0 |
| Working tree               | clean (`git status --short` empty)                                    |
| `git diff --check`         | exit 0                                                                |

The local branch was based on the expected remote history, so nothing had to be integrated and no
history was rewritten.

## C. Finding A — the report's Git state was stale

`docs/superpowers/specs/step-3-4-report.md` §K said the work was entirely local, that "nothing was
pushed", and that `origin/feature/v2-design` still pointed at `3a65bad`. Those statements were true
when written — the report was authored before the owner authorised the push — and became false one
commit later.

§K now records verified values only: final Step 3.4 commit `f68cb79`, remote head
`f68cb79486a60d8eaf86adb620ec814897bcc779`, local `HEAD` identical (ahead 0, behind 0), nine commits
above `3a65bad`, working tree clean, and the branch pushed. The correction is dated and attributed
inside the section, so the historical claim is visible rather than silently overwritten. The
commit list itself was left intact — it is history, not a status field — and this follow-up's commit
is recorded in §J below instead of being spliced into that list.

## D. Finding B — what the matcher actually missed

**The review's stated defect did not reproduce against the committed matcher.** The Step 3.4 test
carried four patterns, and I measured every case the review lists against them before changing
anything:

| Measurement                                                                                                                                                   | Result                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Required forbidden forms (28: bare, `-2`, `-4`, arbitrary value, corner variants, `md:`/`hover:`/`lg:` prefixes)                                              | **missed 0**                   |
| Logical and unrelated forms (18: `border-s/e`, `rounded-ss/se/es/ee`, `ms/me/ps/pe`, `text-start/end`, `rounded-lg`, `border-2`, `mx-auto`, `inline-start-0`) | **false positives 0**          |
| Prose containing a class name (`rounded-l/r` inside a comment)                                                                                                | **flagged — a false positive** |

So the suffixed-variant weakness described by the review belongs to the pattern sketched in the plan,
not to the pattern that shipped. The real defects were different and are what this follow-up fixed:

1. **Prose was class content.** Matching raw file text meant a comment such as "never use `rounded-l/r`"
   counted as a violation — measured true above.
2. **The suite could not distinguish clean from broken.** Its only assertion was "the tree has no
   offenders", which is exactly what a matcher that matches nothing also reports.
3. **No location and no family.** A failure named a class but not the file, line or rule.

**The replacement** is a token-aware matcher, not a wider regex:

- Class candidates are read from string literals only (`"…"`, `'…'`, `` `…` ``), so comments are not
  class content.
- Variant prefixes are stripped from the last top-level colon, with bracket awareness, so
  `md:hover:border-l-2` → `border-l-2` while `supports-[display:grid]:` and `border-l-[rgb(0_0_0/0.5)]`
  survive intact.
- The remaining utility base is tested against one named family per documented rule — margin side,
  padding side, inset side, text alignment, border side, corner radius — each anchored so
  `rounded-lg` is not a physical corner and `border-left:1px` is not `border-l`.
- A violation reports `file`, `line`, `token` and `family`.

**Coverage, positive and negative:**

| Test                                   | Assertion                                                                                                                                                                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Physical forms (31 cases)              | each yields its expected family: bare `border-l`, `border-l-2`, `border-l-[#123456]`, `rounded-tl`, `rounded-tl-lg`, `rounded-bl-[12px]`, `md:border-l-2`, `hover:border-r-4`, `lg:rounded-tr-lg`, `-ml-2`, `-right-2`, `md:hover:text-right` … |
| Logical and unrelated forms (34 cases) | no violation: `border-s/e`, `rounded-ss/se/es/ee`, `rounded-s-lg`, `ms/me`, `ps/pe`, `-ms-1`, `text-start/end`, `start-0`, `end-4`, `rounded-lg`, `border-x-4`, `border-border`, `rtl:-scale-x-100`, `max-lg:hidden` …                          |
| Source sample                          | a synthetic component's `md:rounded-tr-md` reports `probe.tsx:2`, token and family                                                                                                                                                              |
| Scope                                  | more than ten component files are scanned, so the gate cannot pass vacuously                                                                                                                                                                    |
| Repository                             | every `.tsx` under `components/` is clean                                                                                                                                                                                                       |

**End-to-end proof on a real component** (temporary file, deleted after the run):

```
components/tmp-rtl-probe.tsx  →  1 failed | 4 passed   (failure names tmp-rtl-probe.tsx)
probe deleted                 →  5 passed
```

The probe deliberately kept a comment saying "rounded-l/r"; the new matcher reported **one**
violation (the class), not two, which is the prose fix measured rather than asserted.

## E. Finding C — the card-alignment guarantee

The clarification was added to Step 3.4 report §I. The change is **intra-card**: inside one card the
score and price values share one 28 px line box (`min-h-7 leading-7`), and the score keeps that height
when the card has no price. It does not align rows across the three cards — a wrapped title, a longer
rationale or a taller pill set pushes that card's own rows lower, and the cards only share a height
because the grid stretches them.

`apps/web-v2/docs/sections/01-homepage.md` was **not** edited: its wording names the two labels
(`builds.scoreLabel`, `builds.priceLabel`) and never claimed a cross-card baseline, so a change there
would have been churn.

## F. Files changed

| File                                                                       | Why                                                                                           |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `apps/web-v2/tests/homepage/rtl-utilities.test.ts`                         | the token-aware matcher, its positive/negative matrix and location reporting (Finding B)      |
| `docs/superpowers/specs/step-3-4-report.md`                                | §K corrected against `git rev-parse` (Finding A); §I card-alignment clarification (Finding C) |
| `docs/superpowers/plans/2026-11-07-step-3-4-homepage-visual-refinement.md` | the eight task-level checkboxes, reconciled with their commits and the deviations note        |
| `docs/superpowers/specs/step-3-4-1-verification-report.md`                 | this report                                                                                   |

No other file changed. The temporary probe component was deleted before committing.

## G. Test evidence

Run from `apps/web-v2` on 2026-11-07, after the source edit and the documentation edits:

| Command                                                        | Exit | Result                                         |
| -------------------------------------------------------------- | ---- | ---------------------------------------------- |
| `npx vitest run tests/homepage/rtl-utilities.test.ts` (prompt) | 1    | 1 failed                                       | 4 passed — the deliberate probe, named in the failure |
| the same after the probe was deleted                           | 0    | **5 passed**                                   |
| `npm run typecheck`                                            | 0    | clean                                          |
| `npm run lint`                                                 | 0    | clean                                          |
| `npm run format:check`                                         | 0    | clean                                          |
| `npm run check:api-types`                                      | 0    | types match `openapi-v1.10.json`               |
| `npm test`                                                     | 0    | **157 passed** across 28 files (Step 3.4: 154) |
| `npm run test:e2e`                                             | 0    | **62 passed** in 23.4 s                        |
| `npm run build`                                                | 0    | dynamic routes + middleware unchanged          |

The three extra unit tests are the new matrix, the source-sample case and the family assertion that
replaced the old two-test suite.

**These are local gates only.** Nothing was pushed by this follow-up, so no GitHub Actions run exists
for these commits and none is claimed here. The seven-viewport coverage, the French/Arabic rendering
and the no-write guarantee are unchanged and still exercised by the same e2e suite, which passed.

## H. Scope verification

`git status` after the run listed exactly the three modified files plus the new report. Verified
untouched: `apps/api`, `apps/web`, `apps/web-v2/package.json` and its lockfile, `apps/web-v2/app`,
`apps/web-v2/components` (the probe was created and deleted outside the commit),
`apps/web-v2/messages`, `apps/web-v2/lib`, `app/globals.css`. No token, dependency, URL contract,
translation or product behaviour changed; no API call was added, removed or reordered.

## I. Remaining limitations

1. **The matcher reads string literals, not computed class names.** A class assembled at runtime
   (`"text-" + alignment`) is invisible to it. Every current component uses literal class lists, so
   today that is a non-issue, but it is the gate's boundary.
2. **Only the documented families are enforced.** `float-left`, `origin-left` and similar physical
   utilities are not in `DESIGN_SYSTEM.md`'s rule, so they are out of scope by design rather than
   forgotten.
3. **The review's Finding B premise did not reproduce** (§D). The gate was strengthened and is now
   genuinely tested, but the record should not claim a defect that the shipped code did not have.
4. **Arabic copy remains unsigned** — the standing gate, unchanged by this follow-up.

## J. Final Git state

| Fact                 | Value                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Test commit          | `32a8e5d` — `test(web-v2): strengthen RTL physical utility enforcement`                   |
| Documentation commit | the commit carrying this report — `docs(web-v2): reconcile Step 3.4 verification records` |
| Branch               | `feature/v2-design`, ahead of `origin/feature/v2-design` by these commits                 |
| Working tree         | clean after the documentation commit                                                      |
| Push                 | **not performed** — the follow-up waits for explicit authorisation                        |

Step 3.4 history was not rewritten: `f68cb79` and the eight commits beneath it are untouched, and this
follow-up adds commits on top.

## K. Verdict

**PASS WITH CAVEATS.** Both findings are addressed and every local gate exits 0 with measured counts,
but two limitations remain and are stated rather than hidden: the matcher's literal-only boundary
(§I 1), and the fact that Finding B's premise did not reproduce against the committed matcher even
though its real defects — prose false positives and an untestable assertion — did (§D, §I 3). No
remote CI has run for these commits, because pushing requires authorisation this follow-up did not use.
