# Structural-Drift Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the two kinds of drift that were found by hand in the 2026-10-05 review
impossible to miss again — schema drift between the migration tree and a live database, and
register drift inside `docs/OPEN_GAPS.md`.

**Architecture:** Three independently-shippable gates, each pure-logic-first. Task 1 makes CI
actually execute the `scripts/lib` test suites it is currently omitting. Task 2 turns the
throwaway empty-database replay into `scripts/verify-migrations-replay.js`, with all comparison
logic in a pure module `scripts/lib/schema-diff.js` so it is unit-testable without a database.
Task 3 extends `scripts/lib/gap-register.js` to validate the two regions of the register it
currently skips entirely.

**Tech Stack:** Node.js CommonJS, `node:test`, `pg`, raw SQL against Neon. No lint, no typecheck,
no build step — this repo has none.

**Spec:** `docs/OPEN_GAPS.md` **C-30** (the replay measurement and its two methodology findings)
and row **OG-14**; `docs/OPEN_GAPS.md` §6 (the register's own table-shape gate, and the explicit
statement that it "does NOT cover" whether a row's prose is true).

**Plan document:** this plan is `docs/superpowers/plans/2026-10-05-structural-drift-gates.md`.

## Global Constraints

- **Never write to the shared `DATABASE_URL` database.** The replay harness creates and drops
  exactly one scratch database on the `TEST_DATABASE_URL` Neon instance and only *reads* the
  shared database for the diff. A harness that can write to `DATABASE_URL` is a defect.
- **The replay must use a real DATABASE, never a scratch SCHEMA.** Migrations `008` and `011` guard
  enum creation with a namespace-blind catalog lookup
  (`IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assessment_type')`), and `pg_type` is
  database-global. Replaying into a schema either silently skips creating those two enums (when
  `public` is on `search_path`, producing a phantom 12-vs-14 enum drift) or fails
  `42704 type "assessment_type" does not exist` (when it is not). Both are harness artifacts, not
  evidence. This is recorded in C-30; do not "optimise" the harness back to a schema.
- **Do not reuse `scripts/run-migrations.js` for the replay.** It hardcodes
  `table_schema = 'public'` in its ledger queries and therefore cannot target a scratch database.
  Migration `015`'s header says "Do not hand-replay it; use the runner" — that warning is about
  *re-application* against a database already carrying the constraint. Single application of each
  file into an empty database is exactly the fresh-replay case and is what C-30 measured.
- **Exclude `schema_migrations` from every diff query.** It is created by the runner, not by a
  numbered migration, so a fresh replay legitimately lacks it and including it manufactures drift.
- **Committed `.md` files use CRLF** and `core.autocrlf=true` with no `.gitattributes`. Do not add
  one in this plan. Tests that care must construct `\r\n` explicitly rather than depending on the
  checkout.
- Existing gates must stay green at every commit: `npm run test:unit` → 898 pass / 0 fail, and
  `node scripts/verify-docs.js --offline` → exit 0.

## Review Focus

Five input classes a reasonable person would expect to work but no step above exercises. The first
three are the ones that actually bit during the 2026-10-05 review.

1. **A CHECK constraint with the same name but a different body.** The first replay pass compared
   constraint *names* and would have reported a subtly altered CHECK as faithful. Expectation: a
   definition-level comparison flags it. This is the single most important line below.
2. **The harness invoked with only `DATABASE_URL` set.** Expectation: it refuses with a non-zero
   exit and creates nothing, rather than silently creating a scratch database on the shared
   instance's sibling.
3. **The harness interrupted between `CREATE DATABASE` and `DROP DATABASE`.** Expectation: the
   drop runs on both the success and the failure path, so no `migrations_replay_tmp` is left
   holding a half-built schema.
4. **A migration that fails halfway.** Expectation: that file's partial DDL is rolled back and the
   replay stops, naming the file — the earlier files' work is not silently reported as success.
5. **CI on `ubuntu-latest`, where the register is checked out as LF.** Expectation: the gap-register
   parser still accepts it. This is already covered — `scripts/lib/gap-register.test.js` contains
   an `accepts CRLF input, which is how the register is stored` test that constructs `\r\n` itself —
   so Task 3's job is to leave it passing, not to rewrite it. Task 1 is what makes it run in CI.

---

### Task 1: CI runs the `scripts/lib` test suites

`scripts/lib/db-url.test.js`, `scripts/lib/gap-register.test.js` and `scripts/lib/migrations.test.js`
exist and pass locally, but `"test:unit": "node --test \"src/**/*.test.js\""` does not match them
and `.github/workflows/ci.yml` runs only `test:unit`, `gen-decision-index --check` and
`verify-docs --offline`. The 13 gap-register tests — the guard against the `10a8e87` damage class —
never run in CI today.

**Files:**
- Modify: `package.json` (the `scripts` block)
- Modify: `.github/workflows/ci.yml` (the `unit-and-docs` job)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: an npm script `test:scripts` and a CI step that runs it. Tasks 2 and 3 add test files
  under `scripts/lib/`, and this task is what makes those tests execute automatically.

- [ ] **Step 1: Confirm the gap is real before changing anything**

Run: `node --test "scripts/lib/*.test.js"` and count the tests; then
`npm run test:unit 2>&1 | grep -c "gap-register"` and confirm it reports 0.

Expected: the direct invocation reports all three suites passing; `test:unit` reports 0
gap-register tests. If `test:unit` already picks them up, stop — this task is unnecessary and the
`test:unit` glob is not what the CI file implies.

- [ ] **Step 2: Add the `test:scripts` script**

Add one entry to the `scripts` block in `package.json`, immediately after `test:unit`:

```json
"test:scripts": "node --test \"scripts/lib/*.test.js\"",
```

- [ ] **Step 3: Run it to verify it passes and actually collects the suites**

Run: `npm run test:scripts`
Expected: PASS, and the reported total is greater than the count from Step 1's direct run only if
Step 1 ran a narrower glob — the key assertion is that `gap-register`, `migrations` and `db-url`
each appear, with 0 failures.

- [ ] **Step 4: Wire it into CI**

In `.github/workflows/ci.yml`, add exactly one step to the `unit-and-docs` job, directly after
`- run: npm run test:unit`:

```yaml
        - run: npm run test:scripts
```

Do not reorder the other three steps; `verify-docs --offline` must remain last so its gates gate
the merge.

- [ ] **Step 5: Verify the workflow is well-formed and still complete**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/ci.yml','utf8');const n=(y.match(/- run:/g)||[]).length;if(n!==4){console.error('expected 4 run steps, found '+n);process.exit(1)}console.log('4 run steps')"`
Expected: `4 run steps`, exit 0 (the workflow has 3 `- run:` steps today; this task adds the fourth).

- [ ] **Step 6: Commit**

```bash
git add package.json .github/workflows/ci.yml
git commit -m "ci: run the scripts/lib test suites

test:unit globs src/**/*.test.js only, so the 13 gap-register tests guarding
the 10a8e87 damage class and the 10 migration-ledger tests never ran in CI.
Add a test:scripts script and a workflow step."
```

---

### Task 2: A permanent empty-database migration replay gate

Promote the throwaway harness that produced C-30 into a committed script, with every comparison
rule extracted into a pure module so the rule that C-30's first pass got wrong is now a unit test.

**Files:**
- Create: `scripts/lib/schema-diff.js`
- Test: `scripts/lib/schema-diff.test.js`
- Create: `scripts/verify-migrations-replay.js`
- Modify: `package.json` (add `"verify:replay"` to the `scripts` block)

**Interfaces:**
- Consumes: `scripts/lib/db-url.js` (`resolveTestDbUrl(env)`, which throws unless
  `TEST_DATABASE_URL` is set, parseable, and a different host from `DATABASE_URL`); migration files
  from `database/migrations/*.sql`; `DATABASE_URL` for a read-only diff target.
- Produces:
  - `compareSchemaSnapshot(fresh, live) -> { hasDrift: boolean, byClass: Record<string, { onlyFresh: string[], onlyLive: string[] }> }`
    where `fresh` and `live` are both `Record<string, string[]>` keyed by the class names
    `'columns' | 'checks' | 'fks' | 'indexes'`. Pure: no DB, no clock, no I/O, no randomness.
  - `scripts/verify-migrations-replay.js` CLI with flags `--test-db` (required, guarded via
    `resolveTestDbUrl`), `--dry-run` (list the files and exit without creating anything) and
    `--keep-db` (skip the drop; for debugging only). Exit 0 when `hasDrift` is false, 1 otherwise.
    Prints one line per class then a final `RESULT:` line.

- [ ] **Step 1: Write the failing tests for the comparison rule C-30 got wrong**

Create `scripts/lib/schema-diff.test.js` with `node:test` and `node:assert/strict`, matching the
style of `scripts/lib/gap-register.test.js`. Assert on `compareSchemaSnapshot`:

```js
test('reports no drift when both sides are identical', () => {
  const snap = { columns: ['a.b :: text'], checks: ['a.c1 :: CHECK ((x > 0))'] };
  assert.equal(compareSchemaSnapshot(snap, snap).hasDrift, false);
});

test('a same-named CHECK with a different body is drift', () => {
  const fresh = { checks: ['a.c1 :: CHECK ((x > 0))'] };
  const live  = { checks: ['a.c1 :: CHECK ((x >= 0))'] };
  const r = compareSchemaSnapshot(fresh, live);
  assert.equal(r.hasDrift, true);
  assert.deepEqual(r.byClass.checks.onlyLive,  ['a.c1 :: CHECK ((x >= 0))']);
  assert.deepEqual(r.byClass.checks.onlyFresh, ['a.c1 :: CHECK ((x > 0))']);
});

test('an index present live but not fresh is live-only drift', () => {
  const r = compareSchemaSnapshot({ indexes: [] }, { indexes: ['CREATE INDEX i ON t USING btree (a)'] });
  assert.deepEqual(r.byClass.indexes.onlyLive, ['CREATE INDEX i ON t USING btree (a)']);
});

test('a column whose type differs is drift', () => {
  const r = compareSchemaSnapshot(
    { columns: ['t.c :: text :: text :: nullable'] },
    { columns: ['t.c :: integer :: int4 :: nullable'] });
  assert.equal(r.hasDrift, true);
});

test('class ordering does not affect the verdict', () => {
  const a = { columns: ['x', 'y'], indexes: ['i1'] };
  const b = { columns: ['y', 'x'], indexes: ['i1'] };
  assert.equal(compareSchemaSnapshot(a, b).hasDrift, false);
});

test('a class present on one side only is drift, not silently ignored', () => {
  assert.equal(compareSchemaSnapshot({ fks: [] }, {}).hasDrift, true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/lib/schema-diff.test.js`
Expected: FAIL — `compareSchemaSnapshot is not a function` (module missing).

- [ ] **Step 3: Implement the pure comparison in `scripts/lib/schema-diff.js`**

Export `compareSchemaSnapshot(fresh, live)` with the signature in the Interfaces block. Semantics:
the union of keys across both sides defines the classes; for each class, `onlyFresh` is
`fresh[k]` minus `live[k]` and `onlyLive` is the reverse; `hasDrift` is true if any class has a
non-empty `onlyFresh` or `onlyLive`. Missing key on one side is treated as an empty array. Do not
sort the inputs — order is irrelevant to set membership. Include a header comment stating the
C-30 lesson: comparison must be by definition (`pg_get_constraintdef` / `indexdef` / column
type+nullability+default), never by object name alone.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/lib/schema-diff.test.js`
Expected: PASS, 6 tests, 0 failures.

- [ ] **Step 5: Write the failing test for the harness's safety behaviour**

Add to `scripts/lib/schema-diff.test.js` a suite for the helpers that Task 2's Step 7 exports. Pin
Review Focus items 2, 3 and 4 here — each is a behaviour the harness has but no test would
otherwise catch:

```js
test('scratch database name is derived, never the shared database', () => { /* assert it never equals 'neondb' or the DATABASE_URL db */ });
test('snapshot queries exclude schema_migrations', () => { /* assert every query string excludes it */ });
test('dry-run needs no database and lists every migration file', () => { /* call with only DATABASE_URL set; assert exit 0 and the 15 filenames, and that nothing connected */ });
test('refuses to create a scratch database without TEST_DATABASE_URL', () => { /* assert non-zero exit and no CREATE DATABASE issued */ });
test('cleanup drops the scratch database on the failure path too', () => { /* drive a failing migration; assert the drop was still requested */ });
```

The `schema_migrations` test is the important one: it is runner-created, so including it
manufactures drift that does not exist. The dry-run and refusal tests are Review Focus #2 — they
are what stops this harness ever being pointed at the shared instance. Make the cleanup and refusal
helpers plain exported functions taking a client, so these tests need no database.

- [ ] **Step 6: Run the tests to verify they fail**

Run: `node --test scripts/lib/schema-diff.test.js`
Expected: FAIL — the harness module does not exist yet.

- [ ] **Step 7: Implement `scripts/verify-migrations-replay.js`**

Structure it as: export the query map, the scratch-database name constant and the cleanup
function (so Step 5 can test them), then run the CLI only when
`require.main === module`. Required behaviour:

1. Resolve the connection via `resolveTestDbUrl(process.env)`. If it throws, print the message and
   exit 1 having created nothing. Never accept a bare `DATABASE_URL` as the replay target.
2. With `--dry-run`, print the sorted migration filenames and exit 0 without connecting.
3. Connect, `CREATE DATABASE migrations_replay_tmp`, connect to it by replacing the path component
   of the test URL, then apply each `database/migrations/*.sql` in sorted order, **each in its own
   `BEGIN`/`COMMIT`**, rolling back and stopping on the first failure while printing the filename,
   the SQLSTATE and the message.
4. Query both databases with the snapshot SQL below and pass the results to
   `compareSchemaSnapshot`.
5. Print each class as `fresh=<n> live=<n> MATCH|DRIFT` plus `live-only:` / `fresh-only:` lines,
   then `RESULT: 0 drift` or `RESULT: <n> class(es) drift`, and exit accordingly.
6. In a `finally`, terminate other backends on the scratch database and `DROP DATABASE IF EXISTS`
   it — unless `--keep-db`. Do this on both the success and the failure path.

Use exactly these snapshot expressions; they are the validated ones from the C-30 measurement, and
substituting a name-only expression reintroduces the bug Step 1 pins:

- `columns`: `table_name||'.'||column_name||' :: '||data_type||COALESCE('.'||udt_name,'')||' :: '||is_nullable||' :: '||COALESCE(column_default,'-')`
- `checks` / `fks`: join `pg_constraint` to `pg_class` and `pg_namespace` on `contype='c'` / `'f'`
  and select `r.relname||'.'||con.conname||' :: '||pg_get_constraintdef(con.oid)`
- `indexes`: `SELECT indexdef FROM pg_indexes WHERE schemaname='public'`

Every one of them must exclude `schema_migrations` (step 5's test enforces this).

- [ ] **Step 8: Run the harness end-to-end against the real TEST database**

Run: `node scripts/verify-migrations-replay.js --test-db`
Expected: 15 files applied, then `RESULT: 0 drift`, exit 0. Then confirm cleanup by querying
`SELECT datname FROM pg_database` on `TEST_DATABASE_URL` and checking `migrations_replay_tmp` is
absent.

- [ ] **Step 9: Prove the gate actually fails when drift exists**

Do not mutate the shared database. Instead run the harness with one migration file temporarily
moved out of `database/migrations/` (for example `mv 014_build_rejection.sql /tmp/`), re-run, and
confirm it reports a non-zero drift count and exits 1 — then restore the file with
`mv /tmp/014_build_rejection.sql database/migrations/`. This is the step that distinguishes a gate
from a reporter that always says MATCH.

- [ ] **Step 10: Add the npm script and update the docs this change makes stale**

Add `"verify:replay": "node scripts/verify-migrations-replay.js --test-db"` to `package.json`.
In `CONTEXT.md`, update the sentence added for C-30 so it names the committed script instead of
describing a one-off measurement.

- [ ] **Step 11: Commit**

```bash
git add scripts/lib/schema-diff.js scripts/lib/schema-diff.test.js scripts/verify-migrations-replay.js package.json CONTEXT.md
git commit -m "feat(tooling): make the empty-database migration replay a permanent gate

C-30's replay was a throwaway harness; its first pass compared object names
and would have certified a differently DEFINED constraint as faithful.
Extract the comparison into a pure module, compare definitions via
pg_get_constraintdef and indexdef, and pin the name-only failure with a
unit test."
```

---

### Task 3: Close the two regions of the register the shape gate skips

`scripts/lib/gap-register.js` validates §1's main table only. Its `CLOSED_ROW_RE`
(`^\|\s*C-\d{2}\s*\|`) marks §2/§3 rows as exempt, and `ROW_RE` (`^\|\s*(OG-\d{2})\s*\|`) does not
match the bolded `| **OG-35** |` rows in the §1 data-research sub-table. So a malformed closed-table
row, or a blank line splitting the sub-table, passes CI today — the latter is exactly the defect
fixed in `a95353a`.

**Files:**
- Modify: `scripts/lib/gap-register.js`
- Test: `scripts/lib/gap-register.test.js` (append to the existing file)
- Modify: `docs/OPEN_GAPS.md` only if a new check exposes a real defect in the shipped tree

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `parseGapRegister(markdown)` gains a `problems: string[]` field alongside its existing
  return shape. `rows` and every existing field keep their current meaning — `scripts/verify-docs.js`
  reads them and must not need changing.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/lib/gap-register.test.js`:

```js
test('flags a closed-table row whose cell count is not 4', () => { /* parse a table with a 3-cell C-nn row; assert problems mentions it */ });
test('flags a blank line that splits the data-research sub-table', () => { /* sub-table rows, blank line, more sub-table rows; assert flagged */ });
test('accepts the shipped register', () => { /* parse docs/OPEN_GAPS.md itself; assert problems is empty */ });
```

The third test is the one that keeps this honest: it fails the moment anyone edits the register into
a shape the gate rejects.

- [ ] **Step 2: Run the tests to verify the first two fail**

Run: `node --test scripts/lib/gap-register.test.js`
Expected: the two new "flags" tests FAIL; "accepts the shipped register" PASSES (it must — a
rejection here means the shipped file is already malformed).

- [ ] **Step 3: Implement the two new checks**

In `parseGapRegister`, additionally:

- For every line matching `CLOSED_ROW_RE`, count `|`-delimited fields; if the count is not the
  §2/§3 column count, push a `problems` entry naming the C-id and the observed count.
- Track §1's data-research sub-table: detect a run of bolded `| **OG-nn** |` rows interrupted by a
  blank line followed by more such rows, and push a `problems` entry naming the split.

Read the expected closed-table column count from that table's own header row rather than hardcoding
it, so a future column addition does not need a code change.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/lib/gap-register.test.js`
Expected: PASS — the existing 13 tests plus the 3 new ones, 0 failures.

- [ ] **Step 5: Confirm the shipped register and CI are unaffected**

Run: `node scripts/verify-docs.js --offline` and `npm run test:unit`
Expected: `verify-docs: OK` exit 0 with `gap-register-shape` still reporting `36 rows, 6 cells
each`; `test:unit` 898 pass / 0 fail. If `verify-docs` now fails, the new check found a real
defect in `docs/OPEN_GAPS.md` — fix the register, not the check.

- [ ] **Step 6: Surface the new problems in verify-docs output**

Confirm `verify-docs.js`'s `gap-register-shape` check prints any entry in `problems` and fails on a
non-empty array. If it currently ignores the field, extend that check to consume it and add one
assertion to `scripts/lib/gap-register.test.js` proving a malformed closed row makes the check
report FAIL.

- [ ] **Step 7: Close OG-05's structural trap and commit**

OG-05 is `CLOSED` in §1 but has no §3 row whose ID or Item cell names it, so under §1's line-72
exit condition ("a row that closes leaves §1 once its ID is cited only from the closed tables") it
can never leave §1. Add a `C-31` row to the §3 table whose Item cell names OG-05, summarising that
its closure is `004b_case_cooler.sql`'s second DML block (52 `case_radiator_support` rows, all 10
of 10 cases now carrying a matrix). Then:

```bash
git add scripts/lib/gap-register.js scripts/lib/gap-register.test.js scripts/verify-docs.js docs/OPEN_GAPS.md
git commit -m "feat(docs): validate closed-table rows and the data-research sub-table

The shape gate skipped both regions: C-nn rows are exempt by regex, and the
bolded sub-table ids never matched ROW_RE, so a malformed closed row or a
blank line splitting the sub-table passed CI. Also give OG-05 a closed-table
row so it can leave section 1 under line 72's own exit condition."
```