# Remaining Limitations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the six limitations left standing after the 2026-10-05 review, so no delivered
check depends on someone remembering to run it by hand.

**Architecture:** Five independent tasks, each ending in its own commit. Task 1 is a measurement
sweep that may surface defects; Task 2 hardens the gap-register parser; Task 3 gives the two
recurring gates an automated home; Task 4 adds the first behavioural check on a freshly replayed
database; Task 5 retires an orphaned database. They share no interfaces, so they can be executed in
any order and reviewed independently.

**Tech Stack:** Node.js CommonJS, `node:test`, `pg`, raw SQL against Neon, GitHub Actions. No lint,
no typecheck, no build step.

**Spec:** the "Remaining limitations" list in the 2026-10-05 session report, plus
`docs/OPEN_GAPS.md` **C-30** (the structural replay result this plan extends) and
`docs/AGENTS.md` §7 items 7–11 (the replay facts recorded there).

**Plan document:** this plan is `docs/superpowers/plans/2026-10-05-remaining-limitations.md`.

## Scope Check

Six limitations were listed. Five are actionable work and become Tasks 1–5. The sixth,
*"the replay gate is structural, not behavioural"*, is a scope boundary rather than a defect — but
because it is the most valuable thing left to close, it becomes **Task 4** rather than being
dismissed. `CLOSED_ROW_CELL_COUNT`'s headerless gap and the orphaned database are small enough to
fold in rather than split.

These are five genuinely independent subsystems (CI config, a doc parser, the engine, a database
lifecycle, and a verification sweep). If a single reviewer gate is too coarse, Tasks 3–5 can ship as
one plan and Tasks 1–2 as another; nothing is coupled.

## Global Constraints

- **Never write to the shared `DATABASE_URL` database.** Write-capable work goes through
  `TEST_DATABASE_URL` and `scripts/lib/db-url.js`.
- **Do not run the engine against a freshly replayed database without seeds.** A replay produces
  schema only; an unseeded engine pass would return zero candidates and prove nothing.
- **A gate that cannot run must say so and exit non-zero — never silently pass.** A scheduled CI job
  missing secrets is the obvious case.
- **Committed `.md` files use CRLF**, `core.autocrlf=true`, no `.gitattributes`. Do not add one.
- Existing gates must stay green at every commit: `npm run test:unit` → 898/0, `npm run test:scripts`
  → 61/0, `node scripts/verify-docs.js --offline` → exit 0, `npm run verify:replay` → 0 drift.
- Record measured figures in `CONTEXT.md` only when they were measured in the same session. Never
  duplicate live row counts into `docs/OPEN_GAPS.md` (its §6 forbids it).

## Review Focus

Five failure modes the limitations imply that no existing check covers. Each gets a test in the task
that owns the code.

1. **CI runs without repository secrets configured.** The current workflow runs no DB command at all,
   so a job that needs `TEST_DATABASE_URL` and gets nothing must fail loudly with a named missing
   secret — not pass on empty input.
2. **A scheduled job that silently stops running.** A cron-triggered gate that never fires is
   indistinguishable from one that passes. Not fully solvable in-band — GitHub surfaces skipped and
   failed scheduled runs in the Actions UI, which is the intended detection point, so this line is a
   prompt to check that UI rather than a test.
3. **The two scheduled gates run concurrently against one scratch database name.** Both would fight
   over `migrations_replay_tmp`; one must wait, or the name must be made unique per run.
4. **A behavioural check that compares only counts.** Equal verdict counts with different reasons is
   still drift, so the comparison must be by reason code.
5. **Dropping the wrong database.** The orphan cleanup must refuse to run if the resolved name is
   anything other than the exact recorded orphan.

---

### Task 1: Run the verification paths this session skipped

`verify-docs --live` and the three guarded orchestrator harnesses have never been executed across the
whole session. Every claim resting on them is currently reasoned, not measured.

**Files:**
- Modify: `CONTEXT.md` (record the measured results)

**Interfaces:**
- Consumes: `.env` (`DATABASE_URL`, `TEST_DATABASE_URL`); the existing harnesses, unmodified.
- Produces: nothing other tasks consume. This task changes no code unless a harness fails.

- [ ] **Step 1: Run `verify-docs --live` and capture the result**

Run: `node scripts/verify-docs.js --live`
Expected: `verify-docs: OK`, exit 0. If it FAILS, stop this task and fix what it reports before
doing anything else — the schema digest gate failing means `docs/SCHEMA_REFERENCE.md` is stale and
`npm run gen:schema` is the fix.

- [ ] **Step 2: Run the three guarded harnesses and capture their counts**

Run each, recording the PASS/FAIL totals it prints:

```bash
node scripts/test-orchestrator-commit.js
node scripts/test-orchestrator-full-run.js
node scripts/measure-orchestrator.js
```

`measure-orchestrator.js` may take several minutes; allow it. If any harness fails, stop and treat
it as a real defect — do not record a green that did not happen.

- [ ] **Step 3: Record the results in `CONTEXT.md`**

Add one sentence to the verification section stating which gates were executed on which date and
their totals, and name the two that remain DB-only. Do not add row counts.

- [ ] **Step 4: Confirm nothing else moved**

Run: `npm run test:unit && npm run test:scripts && node scripts/verify-docs.js --offline`
Expected: 898/0, 61/0, `verify-docs: OK`.

- [ ] **Step 5: Commit**

```bash
git add CONTEXT.md
git commit -m "docs: record the executed verification gates"
```

---

### Task 2: Check closed-table rows that carry no table header

`CLOSED_ROW_CELL_COUNT` skips a `C-nn` row whenever no header row has been seen for its table. That
was a deliberate choice (guessing produced false positives), but it means a malformed row inside a
headerless excerpt is unchecked.

**Files:**
- Modify: `scripts/lib/gap-register.js`
- Test: `scripts/lib/gap-register.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks consume. `parseGapRegister(markdown)` keeps its signature and its
  `problems` array shape; new problems use a new code.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/lib/gap-register.test.js`:

```js
test('infers a closed-table shape from its rows when no header is present', () => {
  // three consecutive 4-cell C-rows, no header above them
  const md = ['| C-30 | a | b | c |', '| C-31 | d | e | f |', '| C-32 | g | h | i |'].join('\n');
  assert.deepEqual(parseGapRegister(md).problems, []);
});

test('a 3-cell row inside an otherwise 4-cell headerless run is drift', () => {
  const md = ['| C-30 | a | b | c |', '| C-31 | d | e |', '| C-32 | g | h | i |'].join('\n');
  const p = parseGapRegister(md).problems.find((x) => x.code === 'CLOSED_ROW_CELL_COUNT');
  assert.ok(p);
  assert.equal(p.line, 2);
});

test('a single headerless C-row is left unchecked rather than guessed at', () => {
  // one row cannot establish a shape
  const md = ['| C-30 | a | b | c |'].join('\n');
  assert.deepEqual(parseGapRegister(md).problems.filter((x) => x.code === 'CLOSED_ROW_CELL_COUNT'), []);
});

test('an explicit header still wins over inference', () => {
  const md = ['| ID | Item | Status | Resolution |', '|---|---|---|---|', '| C-30 | a | b |'].join('\n');
  assert.ok(parseGapRegister(md).problems.some((x) => x.code === 'CLOSED_ROW_CELL_COUNT'));
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test scripts/lib/gap-register.test.js`
Expected: the inference tests FAIL; the "explicit header still wins" test PASSES.

- [ ] **Step 3: Implement inference in `scripts/lib/gap-register.js`**

Replace the bare `currentTableCells === null` skip with a rule:

1. An explicit header row sets `currentTableCells` and clears any pending inference.
2. With no header, collect the cell count of each `C-nn` row in the current run (reset by any
   heading, any `OG-nn` row, or any non-table line).
3. At the end of the document, if a run had **three or more** `C-nn` rows and their cell counts were
   **all identical**, treat that count as the expected shape and check every row in the run against
   it. A run whose counts disagree, or one with fewer than three rows, is left unchecked.

Report the inferred case with a distinct detail string so a reader can tell it from a header-derived
one. Do not add a new problem code — reuse `CLOSED_ROW_CELL_COUNT`.

- [ ] **Step 4: Run to verify all tests pass**

Run: `node --test scripts/lib/gap-register.test.js`
Expected: PASS, previous 18 plus 4 new, 0 failures.

- [ ] **Step 5: Confirm the shipped register is still accepted, and the gate still works**

Run: `npm run test:scripts && node scripts/verify-docs.js --offline`
Expected: 61 + 4 script tests pass, 0 fail; `verify-docs: OK`. The
`accepts the shipped register` test is what proves no false positive reached the real file.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/gap-register.js scripts/lib/gap-register.test.js
git commit -m "feat(docs): infer a closed-table shape from its rows when unheaded"
```

---

### Task 3: Give the two recurring gates an automated home

`npm run verify:replay` and `node scripts/check-offer-freshness.js` both work and both are run by
hand. Drift accumulates as migrations land and offers age, not as pull requests open, so neither
belongs on the PR path.

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `AGENTS.md` (§6, so the new job is discoverable)

**Interfaces:**
- Consumes: `scripts/verify-migrations-replay.js` (`--test-db`) and
  `scripts/check-offer-freshness.js` (`--fail-days=N`), both unmodified.
- Produces: a workflow named `recurring-gates` triggered by `schedule` and `workflow_dispatch`.

- [ ] **Step 1: Check the prerequisite you cannot satisfy yourself**

The workflow runs on `ubuntu-latest` with no `.env`. It therefore needs `DATABASE_URL` and
`TEST_DATABASE_URL` configured as **repository secrets**. Confirm with the repository owner that they
exist; if they do not, stop and say so rather than committing a job that cannot work.

- [ ] **Step 2: Add the triggers to `ci.yml`**

Add to the existing `on:` block, keeping `push` and `pull_request`:

```yaml
on:
  push:
  pull_request:
  workflow_dispatch:
  schedule:
    # 03:17 UTC nightly — off the hour, so it does not pile onto :00 with other repos.
    - cron: "17 3 * * *"
```

- [ ] **Step 3: Add the `recurring-gates` job**

A second job in the same workflow. It must export both secrets into the environment and must not run
concurrently with a PR build that also needs them.

```yaml
  recurring-gates:
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    # Queue rather than overlap: two runs at once would fight over the single
    # scratch database name migrations_replay_tmp. cancel-in-progress:false so a
    # slow run is never killed half-way through a CREATE/DROP.
    concurrency:
      group: recurring-gates
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Assert secrets are present
        run: |
          test -n "${{ secrets.TEST_DATABASE_URL }}" || { echo "::error::TEST_DATABASE_URL secret is not set"; exit 1; }
          test -n "${{ secrets.DATABASE_URL }}" || { echo "::error::DATABASE_URL secret is not set"; exit 1; }
      - run: npm ci
      - run: node scripts/check-offer-freshness.js --fail-days=14
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
      - run: node scripts/verify-migrations-replay.js --test-db
        env:
          TEST_DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

Use `--fail-days=14`, not the default 7: a nightly job with a 7-day threshold would page someone
only a week before the cliff, which is too late to re-stamp offers. Note the equals form — the
script parses `--fail-days=N` and rejects a space-separated value.

- [ ] **Step 4: Verify the workflow is well-formed**

Run:
`node -e "const y=require('fs').readFileSync('.github/workflows/ci.yml','utf8');for(const k of ['schedule','workflow_dispatch','recurring-gates','TEST_DATABASE_URL'])if(!y.includes(k)){console.error('missing '+k);process.exit(1)}console.log('ok')"`
Expected: `ok`, exit 0.

- [ ] **Step 5: Confirm the two gates still pass locally with the exact CI arguments**

Run: `node scripts/check-offer-freshness.js --fail-days=14` and then
`node scripts/verify-migrations-replay.js --test-db`
Expected: `RESULT: PASS` and `RESULT: 0 drift`, both exit 0.

- [ ] **Step 6: Document it and commit**

Add one row to `AGENTS.md` §6 for the scheduled job, then:

```bash
git add .github/workflows/ci.yml AGENTS.md
git commit -m "ci: run the replay and offer-freshness gates nightly"
```

---

### Task 4: Give the replay gate a behavioural check

`0 drift` proves the tree reproduces the live **schema**. It says nothing about whether the engine
behaves the same on that schema — the largest gap left in the replay work.

**Files:**
- Create: `scripts/verify-seeded-replay.js`
- Create: `scripts/lib/verdict-comparison.js`
- Test: `scripts/lib/verdict-comparison.test.js`

**Interfaces:**
- Consumes: `scripts/verify-migrations-replay.js`'s scratch-database helpers (`withScratchDatabase`,
  `connectWithRetry`, `dropScratchDatabase`, `SCRATCH_DB`) — all already exported;
  `scripts/run-seeds.js`'s seed files; the Engine 2C-2D entry point used by
  `scripts/measure-orchestrator.js` (read that file for the exact call — do not re-derive it).
- Produces: `compareVerdicts(fresh, live) -> { hasDrift: boolean, byReason: Record<string, number> }`
  in `scripts/lib/verdict-comparison.js`, pure like `schema-diff.js`. `byReason` counts verdicts per
  reason code, so equal totals with different reasons still report drift.

- [ ] **Step 1: Write the failing tests for the comparison**

Create `scripts/lib/verdict-comparison.test.js`:

```js
test('equal totals with different reasons are drift', () => {
  const fresh = [{ reason: 'PASS' }, { reason: 'GPU_TOO_THICK' }];
  const live = [{ reason: 'PASS' }, { reason: 'UNKNOWN' }];
  const r = compareVerdicts(fresh, live);
  assert.equal(r.hasDrift, true);
});

test('identical reason counts are not drift', () => {
  const v = [{ reason: 'PASS' }, { reason: 'PASS' }, { reason: 'UNKNOWN' }];
  assert.equal(compareVerdicts(v, v).hasDrift, false);
});

test('a missing verdict on one side is drift', () => {
  assert.equal(compareVerdicts([{ reason: 'PASS' }], []).hasDrift, true);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/lib/verdict-comparison.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `compareVerdicts` in `scripts/lib/verdict-comparison.js`**

Pure. Count verdicts by `reason` on both sides, emit the union of reason codes with
`{ fresh, live }` counts, and set `hasDrift` when any count differs.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/lib/verdict-comparison.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Implement `scripts/verify-seeded-replay.js`**

Same scratch-database lifecycle as the replay gate: `CREATE DATABASE`, apply every migration, then
apply every seed in `database/seeds/` in filename order, then run one Engine 2C-2D pass and collect
`{ product_variant_id, reason }` for every verdict. Run the same pass against the live
`DATABASE_URL`, then `compareVerdicts`. Print per-reason counts and a `RESULT:` line; exit non-zero
on drift. Reuse the exported helpers rather than re-implementing cleanup — the masking-error defect
fixed in `201d47a` lives in `withScratchDatabase` and must not be duplicated.

- [ ] **Step 6: Prove it detects drift rather than always passing**

Temporarily narrow the seed set the script applies (move one file aside), run it, and confirm a
non-zero drift count and a non-zero exit; restore the file and confirm it returns to clean. A
behavioural gate that has never been seen red proves nothing.

- [ ] **Step 7: Commit**

```bash
git add scripts/verify-seeded-replay.js scripts/lib/verdict-comparison.js scripts/lib/verdict-comparison.test.js package.json
git commit -m "feat(tooling): add a behavioural check for a freshly replayed database"
```

---

### Task 5: Retire the orphaned test database

`temp_test_db_1789106515699` sits on the TEST Neon instance. It predates this session and is not
referenced by any script.

**Files:**
- Modify: none required. If the drop reveals something still using it, stop and report instead.

**Interfaces:**
- Consumes: `TEST_DATABASE_URL`.
- Produces: nothing.

- [ ] **Step 1: Confirm nothing references it**

Run: `grep -rn "temp_test_db" --include="*.js" --include="*.json" --include="*.yml" --include="*.md" . | grep -v node_modules`
Expected: no hits outside this plan. Any hit means something depends on it — stop.

- [ ] **Step 2: Inspect before destroying**

Connect to it read-only and count its tables and rows. If it holds data no other database has, stop
and report what it is rather than dropping it.

- [ ] **Step 3: Drop it, refusing any other name**

Run a script that resolves the name, asserts it equals `temp_test_db_1789106515699` exactly, refuses
to proceed otherwise, terminates other backends, then drops it.

- [ ] **Step 4: Confirm the instance is otherwise untouched**

Run: `select datname from pg_database where datistemplate = false order by 1`
Expected: exactly `neondb`, `postgres` — and nothing else.

- [ ] **Step 5: Confirm the gates still pass and commit nothing was needed**

Run: `npm run test:scripts && node scripts/verify-migrations-replay.js --test-db`
Expected: script tests pass, `RESULT: 0 drift`. If no file changed, there is nothing to commit —
report the result and stop.

---

### Task 6: Build Decision 23's PI-1 (pool independence) — added 2026-10-05

Found while reviewing Task 1's own record. **Decision 23** (`docs/RECOMMENDATION_ENGINE_DECISIONS.md`
section 6, "Acceptance verification") carries **three** acceptance criteria, and its own status line
reads `acceptance criterion 3 / PI-1 NOT built`. `measure-orchestrator.js` measures criteria 1-2 only
and says so on its own line 763. A Task 1 record claiming "nothing outstanding" would have let a
future session believe PI-1 was verified. It is not, and it is the last unbuilt acceptance criterion
of a RESOLVED decision.

> Attribution correction (2026-10-05, review pass): an earlier draft of this task and of the
> `CONTEXT.md` line said **Decision 20**. That is wrong. Decision 20's criteria 1-2 are the CPU/GPU
> pair-diversity claims (`scripts/measure-orchestrator.js` lines 3-19 and its `printSummary`
> sections); PI-1 is Decision 23's criterion 3. Decision 20's `Status:` line does not mention PI-1
> at all. Cross-check the decision number against the decision's own `## Decision NN` heading before
> citing a criterion.

**Files:**
- Create: `scripts/verify-pool-independence.js`
- Create: `scripts/lib/score-vector.js`
- Test: `scripts/lib/score-vector.test.js`

**Interfaces:**
- Consumes: the GAMING and OFFICE query entry points used by `scripts/measure-orchestrator.js` (read
  that file for the exact calls); `TEST_DATABASE_URL` via `scripts/lib/db-url.js`.
- Produces: `captureScoreVector(verdicts) -> Map<string, number>` and
  `scoreVectorDrift(before, after) -> string[]` in `scripts/lib/score-vector.js`, pure — keyed by
  build signature, so the comparison is about scores rather than row order.

- [ ] **Step 1: Write the failing tests for the pure comparator**

Create `scripts/lib/score-vector.test.js`. `scoreVectorDrift` must return the signatures whose score
moved or vanished, and must ignore a build that exists only in `after` — Decision 23 permits new
builds, it forbids existing scores moving:

```js
test('an unchanged score is not drift', () => {
  const v = new Map([['sig-a', 60.52]]);
  assert.deepEqual(scoreVectorDrift(v, new Map([['sig-a', 60.52]])), []);
});
test('a moved score is drift', () => {
  assert.deepEqual(scoreVectorDrift(new Map([['sig-a', 60.52]]), new Map([['sig-a', 60.5]])), ['sig-a']);
});
test('a build that disappears is drift', () => {
  assert.deepEqual(scoreVectorDrift(new Map([['sig-a', 1]]), new Map()), ['sig-a']);
});
test('a new build only is NOT drift', () => {
  assert.deepEqual(scoreVectorDrift(new Map([['sig-a', 1]]), new Map([['sig-a', 1], ['sig-b', 9]])), []);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/lib/score-vector.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement both functions in `scripts/lib/score-vector.js`**

Pure. `captureScoreVector` maps each ranked build's signature (its component ids, sorted and joined)
to its `build_score`. `scoreVectorDrift(before, after)` returns the sorted signatures present in
`before` whose score differs in `after`, or which are missing from `after`. Keys present only in
`after` are ignored.

- [ ] **Step 4: Implement `scripts/verify-pool-independence.js` following Decision 23 steps a-d**

Capture the score vector for GAMING and OFFICE on the `TEST_DATABASE_URL` branch; insert ONE
unrelated product with NULL connector columns that cannot enter a finished build; re-capture; assert
`scoreVectorDrift` is empty for both profiles; delete the product and verify it is gone. **Always
delete in a `finally`** — this writes to a real branch, and a leaked product would corrupt every
later measurement.

Two reasons this must be its own script, not a flag on `measure-orchestrator.js`:
1. **The harness cannot emit the thing PI-1 compares.** Its score facts come from
   `ranked.slice(0, TOP_N_PERSISTED)` (line 638) — a top-10 slice, not the full ranked set. PI-1
   must diff *every* pre-existing signature, so it needs the whole vector.
2. **The preflight aborts on the probe row.** `preflight()` asserts exact counts, and the
   `products`/`offers` counts are `name LIKE 'Seed %'`-scoped (lines 166, 170). Do NOT relax those
   assertions to accommodate a probe; they are a real tripwire for an out-of-band catalog change.

Note the candidate pool is name-agnostic: `loadCandidates` selects by `lifecycle_status = 'ACTIVE'`
plus spec-table membership (`src/recommendation/candidates/loader.js`), so the probe product DOES
enter the pool even if it is named outside `Seed %` — which is exactly the condition PI-1 needs to
test. Give it a `psu_spec` row so it is a real PSU candidate.

- [ ] **Step 5: Prove it detects a real violation**

Add a second in-pool product a build *can* select, confirm the script exits non-zero naming the moved
signature, then revert. A gate never seen red proves nothing.

- [ ] **Step 6: Record the result and commit**

Add one line to `CONTEXT.md` stating PI-1's outcome and the date, then:

```bash
git add scripts/verify-pool-independence.js scripts/lib/score-vector.js scripts/lib/score-vector.test.js package.json CONTEXT.md
git commit -m "feat(tooling): build Decision 23's PI-1 pool-independence check"
```
