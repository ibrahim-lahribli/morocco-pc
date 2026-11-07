# Step 3.1 — commit review

**Date:** 2026-11-07
**Branch:** `feature/v2-design`
**Scope:** the commits that exist on this branch around Step 3.1 (`f4167f6` … `dcff399`), reviewed for
scope, content and test quality. Read-only: this record changes no code, commits nothing, and calls no
API.

## How to read this record

Section 1 is the repository state the review was taken against. Section 2 settles what "the Step 3.1
commits" are, because the answer is not the obvious one. Sections 3–5 are the review: what each commit
does, what it prevents, and the quality findings. Section 6 is the coverage the commits sit on, and
Sections 7–8 are the defects and the verdict. Every number below was measured in this checkout; nothing
is carried over from a plan.

## 1. Repository state

Captured 2026-11-07:

```text
branch       feature/v2-design
HEAD         dcff3996da8a7973928170a5cfb63e4e86b2732c
             docs(web-v2): record the Step 2.2 finder validation and verdict
origin       feature/v2-design (in sync — no ahead, no behind)
status       ?? apps/web-v2/app/[locale]/simulateur-preview/
             ?? docs/superpowers/
tracked diff none
```

The five commits under review are pushed. This review added no commit, no staged file and no tracked
modification; the only artifact it produces is this untracked record.

## 2. What "the Step 3.1 commits" are

**There are none, and that is deliberate.** The Step 3.1 plan
(`docs/superpowers/plans/2026-11-07-step-3-1-configurator-architecture.md`) contains no `git commit` step,
because its brief forbids committing; the deliverable — the plan and
`docs/superpowers/specs/step-3-1-configurator-architecture.md` — therefore lives untracked.

Three independent checks agree:

| Check | Command | Result |
| --- | --- | --- |
| Commits since the 3.1 baseline | `git log --oneline dcff399..HEAD` | 0 lines |
| Any commit message naming 3.1 | `git log --all --oneline --grep="3\.1"` | none |
| Any tracked artifact under the report's directory | `git ls-tree -r HEAD --name-only docs/superpowers` | 0 files |

So the only commits "around" Step 3.1 are the five that precede it. All are Step 2.2's, all dated
2026-11-07, and all of them are reviewed below.

## 3. The five commits at a glance

| Commit | Subject | File | +/− | Class |
| --- | --- | --- | --- | --- |
| `f4167f6` | give the homepage API stub optional response latency | `e2e/support/homepage-api.ts` | +14 | test harness |
| `0614e7f` | pin the budget boundaries and the card switch in the browser | `e2e/homepage-builds.spec.ts` | +93 | test |
| `70569c6` | prove the pathway tile narrows the cards | `e2e/homepage-finder.spec.ts` | +24 / −1 | test |
| `38bd27a` | cover the Arabic finder as an interaction | `e2e/homepage-finder-ar.spec.ts` | +51 | test |
| `dcff399` | record the Step 2.2 finder validation and verdict | `apps/web-v2/docs/finder-validation.md` | +279 | documentation |

Total: **5 files, 461 insertions, 1 deletion**. Every path is under `apps/web-v2/e2e/` or
`apps/web-v2/docs/` — no product component, no engine module, no API file, no migration.

## 4. Commit by commit

### 4.1 `f4167f6` — stub latency, not product latency

Adds `presetsDelayMs` and `detailDelayMs` to the stub options and a small `wait(ms)` helper. The
documentation on the field is the load-bearing part:

> "Test latency before the presets answer, so a spec can observe the pending state of a ladder it is
> waiting on. Never a product sleep."

That distinction holds in the code: the delay exists only inside the stub, and the suite contains **0**
`waitForTimeout` calls. Pending states are observed through auto-waiting assertions, never through a
sleep.

### 4.2 `0614e7f` — four boundary specs

| Spec | What it pins | Why it matters |
| --- | --- | --- |
| below the cheapest tier (3 500) | honest empty slot, category kept, no budget line | a substituted, pricier card would be a lie |
| above the top tier (20 000) | cap note names the tier actually served (15 000) | the budget is never relabelled as a price |
| switching use case | previous card gone, `aria-labelledby="build-rec-OFFICE-12000"` | catches a stale gaming build under an office heading |
| one skeleton per slot | 3 `article[aria-busy='true']` → 0 with `presetsDelayMs: 2_000` | proves the pending state exists, without a sleep |

Each of the four asserts `posts` is empty, so none can pass by accidentally issuing a write.

### 4.3 `70569c6` — the pathway tile

One new spec: the desktop pathway tile narrows 3 cards to 1, and the usage radio comes back checked. The
comment states the failure it exists to catch — "a count of 3 here would mean the tile moved the radio and
nothing else". The commit also adds the shared `waitForSettledCards` boundary to an existing spec, which
is the single deletion in the set.

### 4.4 `38bd27a` — Arabic as an interaction

A new 51-line spec with two tests: the full answer → narrowed-card flow on `/ar` with `dir="rtl"` and
Arabic copy asserted literally, and a 360 px pass measuring horizontal overflow after the card settles.
The header explains why the measurement waits for the settled card rather than the skeleton: the grid only
reaches its final width once a price lands.

### 4.5 `dcff399` — the record

279 lines: repository state, intended-vs-implemented matrix, live ladder, French and Arabic passes,
per-task regression sections (6.1–6.4), defects, verdict. It records its own harness race honestly — a
single red run caused by a hydration race, then 21/21 across three isolated repeats and 29/29 twice, with
no assertion or timeout relaxed. That is the standard the five commits are held to here.

## 5. Quality findings

### 5.1 No fixed sleeps, no weakened assertions, no skips

`grep -rc waitForTimeout apps/web-v2/e2e` totals **0**. The latency knobs from `f4167f6` are always paired
with an assertion that waits for the real state change. No spec in the set is skipped or marked `fixme`,
and no timeout was raised.

### 5.2 Forced interactions — the one thing to watch

`force: true` appears **16 times** across three spec files (`homepage-builds`, `homepage-finder`,
`homepage-finder-ar`). `force` bypasses Playwright's actionability checks, so a real overlay or a
mis-sized hit area would not fail the test. It is defensible for custom-styled radios whose `<label>`
intercepts pointer events — which is the case here — but it should eventually carry a comment at each
site, or be narrowed to the sites that genuinely need it. Recorded as an observation, not changed: it is
outside this review's read-only scope.

### 5.3 Deliberate duplication

`USAGE_GAMING` is defined in two spec files; the second definition carries a comment saying so ("the finder
spec keeps its own copy"). Acceptable in tests, and disclosed rather than hidden — but it is duplication,
and it can drift if one copy is edited.

### 5.4 Scope discipline

All five commits are test-and-docs only. A Step 2.2 commit that had touched a component to make a test
pass would have been a product change smuggled in as a test change; none did.

## 6. Coverage the commits sit on

The V2 workflow triggers on `apps/web-v2/**`, on the contract snapshot
`apps/api/test/unit/openapi-v1.10.json`, and on itself — so all five commits are covered by it. Its steps
are `npm ci`, `typecheck`, `lint`, `format:check`, `check:api-types`, `test`, `build`, `playwright install
--with-deps chromium` and `test:e2e` — nine steps, one of which is install.

Re-run locally for this review, from `apps/web-v2`:

| Command | Exit | Result |
| --- | --- | --- |
| `npm run check:api-types` | 0 | "api types are up to date" |
| `npm run typecheck` | 0 | clean |

The full suites were **not** re-run here: the reviewed commits are test and documentation only, and their
last recorded CI runs were green. That is a carried result, not one measured in this session, and it is
stated that way deliberately.

## 7. Defects

None found in the five commits. The observations in §5.2 and §5.3 are maintainability notes, not defects,
and §2 records a fact about Step 3.1 rather than a fault in it: the brief requires the deliverable to stay
uncommitted, so "no 3.1 commits" is the intended state.

## 8. Verdict

**PASS** for the five commits as committed, with these limits stated as limits:

- **No Step 3.1 commit exists.** The 3.1 deliverable is untracked by design (§2); this record does not
  claim otherwise, and it is not evidence that 3.1 was committed.
- **CI status is carried, not re-measured.** No `gh` client and no push were used here; the green runs for
  these SHAs come from the sprint record. The two local gates in §6 were re-run and passed.
- **Content review, not a re-run.** The commits were read at the diff level and checked against their
  messages; the E2E suite was not executed in this session, so this is not a claim that the specs pass
  today.
- **The 16 forced interactions remain.** §5.2 is an open maintainability item, not a fixed one.
