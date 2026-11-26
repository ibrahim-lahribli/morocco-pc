# Step 5 database acceptance — the operator runbook

Covers the database-backed half of the Step 5 acceptance review: §19.3's "DB-backed suite on the isolated
TEST branch with residue asserted to zero", as it applies to the eight W3 orchestrator modules, the five
W2 persistence modules and the API's DB suite.

**Operator-only.** The agent never runs any part of this: no `.env` read, no connection to shared, TEST or
EU, no migration, seed or DB-writing test, and no `--confirm-test-db` / `--confirm-shared` flag on the
operator's behalf. The write attestations are the operator's claim that the destination was verified out of
band; if an agent can pass one, it protects nothing.

## 1. What this proves — and what it does not

It proves the extracted W3 modules still behave the same against a real PostgreSQL: a committed pass is
visible on a second session, a writer error rolls back and persists nothing, the re-run guard refuses
fail-fast, the Decision 46 pass facts land, rejections replace rather than duplicate, a swap commits and is
read back, and the API round-trips a real recommendation with no residue.

It does **not** prove runtime characterization (that is the DB-free `check:characterization` gates), engine
quality, performance, deployed behaviour, or anything about the catalogue's content.

## 2. Why the target is an isolated, seeded branch

Two independent blockers stop this suite from running against TEST as it stands today:

1. `scripts/test-orchestrator-full-run.js` preflights **global** counts: `recommendation_query` must be `0`
   and `build_candidate = 0`. R-32 records **80** unmarked `recommendation_query` rows on TEST
   (2026-11-21) that must be **left alone**, so the harness refuses to start there.
2. Its `EXPECTED` pins `models: 1` for `modelPin.DEFAULT_MODEL_PIN` = `seed-minimal-v1@1.0.0`, which seed
   029 makes **INACTIVE**. `modelPin.resolvePinnedModel` refuses an inactive pin, so the default fails
   closed even on a pristine branch. `--model=launch-v2@2.5.0` is required.

The resolution is an isolated, fully seeded acceptance branch, provisioned by the operator. Reasons, in
order of weight:

- The zero-baseline preflight **is** the leak proof for `runRecommendationFullRun`: it is how the harness
  knows that every row it deletes belongs to it, and it is the only reason its id-scoped cleanup can be
  trusted. Adapting the harness to a populated branch would replace a global invariant with a weaker one.
- A whole-table difference cannot distinguish a harness leak from a concurrent writer, so even a populated
  branch would have to be **quiescent**. Routing around the zero baseline therefore buys no operational
  freedom while costing a re-validation of a Decision 21 gate.
- TEST's 80 rows are legitimately owned by nobody in this PR. Nothing here resets, clears, re-marks or
  deletes them.
- The shape is already proven in CI: the `ephemeral-eval` job applies migrations `001`-`023` with
  `--test-db` and then applies **every** seed with `node scripts/run-seeds.js --confirm-shared` against its
  own throwaway container. An acceptance branch is the operator-provisioned version of it.

### 2.1 The assessment-count discrepancy — BLOCKING, not resolved

`EXPECTED.assessments` is `280`. The comment that used to sit beside it claimed `235`. A read-only count of
the seed files (2026-11-26) gives **319**:

| Seed | `component_assessment` tuples |
|---|---|
| `001_minimal_builds.sql` | 25 |
| `004a_component_assessments_gpu_psu.sql` | 87 |
| `004b_case_cooler.sql` | 45 |
| `004b_cpu_motherboard.sql` | 63 |
| `004b_ssd_ram.sql` | 60 |
| `023_igpu_cpu_catalog_expansion.sql` | 12 |
| `024_platform_cost_catalog_expansion.sql` | 21 |
| `025_gpu_vram_tier_expansion.sql` | 6 |
| **total** | **319** |

Two independent checks agree with that arithmetic: the subtotal before seed `025` is **313**, and seed
`025`'s own header records a **measured** `assessments 313 -> 319` on TEST (2026-10-31). So `235` is
stale, and `280` matches neither the seed files nor any measurement recorded in this repository.

**Consequence for this run.** A correctly seeded branch is expected to report
`assessments: expected 280, found 319` and the harness will refuse — correctly. Do **not** edit `EXPECTED`
to make a run start, and never with a number nobody measured on the target. The effective count depends on
each seed's `NOT EXISTS` guards and on which rows carry the `Seed %` prefix the preflight counts, so the
correct number has to be established by the read-only preflight below, on the acceptance branch, and
reconciled in its own reviewed change. Until that change lands, the full-run acceptance is **BLOCKED** and
`node scripts/test-orchestrator-commit.js` + `npm run test:api:db` are the only runnable parts.

## 3. Prerequisites — establish both targets BEFORE any write

### 3.1 A verified clean parent

A Neon branch **inherits its parent's rows**. Creating a branch from the current TEST branch therefore
inherits TEST's 80 unmarked `recommendation_query` rows, and the preflight refuses. "Fresh branch" is not
the same as "clean branch".

The operator must choose a parent that is **verified** to have:

- `recommendation_query = 0` and `build_candidate = 0` (the full-run preflight's baseline);
- no Layer-4 test residue and no preset generation;
- the migration and seed state this acceptance intends to represent.

No clean parent is identified anywhere in this repository. That is an **operator prerequisite**: if none can
be verified, acceptance is **BLOCKED** until one is, and no branch name may be assumed. Never reset, clear,
re-mark or delete the existing TEST rows to manufacture a clean parent.

### 3.2 Both connection variables, set first

Set **both** variables in the operator's own shell **before running any migration or seed command**:

| Variable | Meaning for this run |
|---|---|
| `TEST_DATABASE_URL` | the isolated acceptance branch — the **only** intended write target |
| `DATABASE_URL` | must name a **different** endpoint; `scripts/run-migrations.js` and `scripts/run-seeds.js` reach it by default, which is why it must not be the acceptance branch |

`packages/database-guard/src/index.js` refuses when the two normalized hosts are equal. That refusal is the
guard working, not an obstacle to route around — and it is only a cheap typo guard: two different strings
can still reach one database through a tunnel or port forward.

### 3.3 Verify out of band, and record no secrets

Confirm in the Neon console — not from a connection string, which cannot prove the destination — that:

- `TEST_DATABASE_URL` reaches the intended **project**, **branch** and **database** of the acceptance run;
- `DATABASE_URL` reaches something else and is **not** the acceptance target;
- the branch is the new one created for this run.

Record the project, branch name and database name. **Never** paste, print, log or commit a connection string
or credential into the evidence.

Then record the branch's **restore point** before any write.

## 4. Procedure

1. Verify §3.1 (clean parent) and §3.3. Stop here if either fails.
2. Create the Neon branch from the verified parent (for example `acceptance-step5-<YYYYMMDD>`).
3. Set `TEST_DATABASE_URL` and `DATABASE_URL` in the operator's shell — **before** the next step.
4. Record the restore point.
5. Apply migrations `001`-`023` **to the TEST target explicitly**:

   ```
   node scripts/run-migrations.js --test-db
   ```

   `--test-db` is not optional. Without it the runner targets `DATABASE_URL` (and, being a shared-target
   apply, refuses without `--restore-point`). Never apply a migration with raw `psql`, and never renumber or
   rewrite a committed migration: `scripts/run-migrations.js` is the only permitted path and its ledger is
   what makes the apply re-runnable.

6. Confirm nothing is pending on that same target:

   ```
   node scripts/run-migrations.js --test-db --check
   ```

   Exit 0 means the ledger matches `database/migrations/`; exit 1 means the apply above was incomplete.
   `--check` executes nothing.

7. Apply the seeds **to the TEST target explicitly, with the operator attestation**:

   ```
   node scripts/run-seeds.js --test-db --confirm-test-db
   ```

   - `run-seeds.js` applies **every** file in `database/seeds/*.sql`, in sorted filename order. There is no
     "seed tail" selection in this script and no supported flag that would apply a subset; the whole ordered
     set is what a seeded branch means.
   - `--confirm-test-db` is **required** for a `--test-db` write. It is the operator's attestation that
     `TEST_DATABASE_URL` reaches the intended isolated database — the guard compares normalized hostnames
     only and cannot see through a tunnel, proxy or forwarded port. Pass it **only after** §3.3 has been
     verified independently.
   - The **coding agent must never run this command and must never supply this attestation.** An agent
     asserting the destination is exactly the claim the flag exists to make impossible to fake.
   - `--confirm-shared` is **not** part of this procedure. It authorizes a `DATABASE_URL` write, which here
     would be the wrong database. The CI job uses it against its own throwaway container; that is not this.

8. Stop and read §5 before running any suite: the assessment preflight is expected to refuse (§2.1).
9. Run the suites in §6 on the **final SHA** of the branch under test.
10. Record the evidence in §8, then delete the acceptance branch. Deleting a branch created for this run is
    not "clearing TEST": no row of TEST's data is touched at any point.

## 5. Preflight — measure, never assume

The two harnesses check different things, and both refusals are read-only.

| Harness | Requires | Tolerates |
|---|---|---|
| `scripts/test-orchestrator-commit.js` | ≥ 2 `product` rows, ≥ 1 `scoring_model` row, ≥ 1 seed `store_offer` (`ingestion_record_id IS NULL`) | any Layer-4 state; cleanup is by captured id |
| `scripts/test-orchestrator-full-run.js` | `product` = 100 Seed rows, `scoring_model` = 1 row matching the **pin**, `store_offer` = 101 Seed offers, `component_assessment` = 280 Seed rows (see §2.1 — this figure is unreconciled), `recommendation_query` = 0, `build_candidate` = 0 | nothing — it is a clean-baseline harness |

Read-only measurement (each is a `SELECT`; run it before the suite and paste the output into the evidence):

```sql
SELECT
  (SELECT count(*)::int FROM product  WHERE name LIKE 'Seed %')                        AS seed_products,
  (SELECT count(*)::int FROM store_offer o JOIN product p ON p.id = o.product_id
     WHERE p.name LIKE 'Seed %')                                                       AS seed_offers,
  (SELECT count(*)::int FROM component_assessment a JOIN product p ON p.id = a.product_id
     WHERE p.name LIKE 'Seed %')                                                       AS seed_assessments,
  (SELECT count(*)::int FROM recommendation_query)                                     AS queries,
  (SELECT count(*)::int FROM build_candidate)                                          AS build_candidates;

SELECT name, version, is_active FROM scoring_model ORDER BY name, version;
```

**If a count differs from `EXPECTED`, STOP.** Do not edit `EXPECTED` to make the refusal go away. Record the
measured counts, and treat the difference as its own finding: a seeded catalogue that no longer matches the
harness's committed shape is a separate change that needs the measurement, the reason and a review — not a
side effect of an acceptance run. For `assessments` specifically, §2.1 already predicts the mismatch.

## 6. Suite order

`test-orchestrator-full-run.js` needs the pristine baseline, so it goes **first**; `test:api:db` creates
`recommendation_query` rows, so it goes last.

1. `node scripts/test-orchestrator-full-run.js --model=launch-v2@2.5.0` — **expected to refuse until §2.1 is
   reconciled**; a refusal writes nothing and is a correct outcome, so record it verbatim.
2. `node scripts/test-orchestrator-commit.js`
3. `npm run test:api:db`

If any step leaves residue, **stop and report the ids it printed**. Do not delete rows the run did not
create, and do not "clean up" by truncating a table.

`npm run test:loaders:ephemeral` is deliberately not part of this acceptance: its fixtures carry TEST ids and
the suite asserts loader ORDER BY against rows PostgreSQL actually returned, so it belongs to the ephemeral
CI job (`ephemeral-eval`) and not to a seeded acceptance branch.

## 7. Residue map — what each file actually asserts

The earlier description claimed a universal whole-table assertion. That is false, and the difference matters
when reading a green run. Measured from the files themselves (2026-11-26):

| File | Writes | Residue check | Scope |
|---|---|---|---|
| `apps/api/test/db/recommendations.db.test.js` | commits real passes | scoped `residueFor` by query id **and** whole-table `countAll` before/after | six tables: `recommendation_profile`, `recommendation_query`, `recommendation_result`, `build_candidate`, `build_component`, `build_rejection` |
| `apps/api/test/db/swap-commit.db.test.js` | commits a pass and a swap | residue zero **and** whole-table counts compared with the pre-run snapshot | its own query id, plus the whole-table snapshot |
| `apps/api/test/db/swap-preview.db.test.js` | commits a pass | residue zero **and** whole-table counts compared with the pre-run snapshot | its own query id, plus the whole-table snapshot |
| `apps/api/test/db/presets.db.test.js` | test 1 rolls back on a dedicated client; test 2 commits a pass | id-scoped `residueFor` (queries, profiles, results, candidates, rejections, presets) **plus one global count** | its own query/profile ids; `recommendation_preset` is the single table counted globally, because no other file writes it |
| `apps/api/test/db/dedupe.db.test.js` | one transaction, `ROLLBACK` | id-scoped count after the rollback | `recommendation_query` by captured id |
| `apps/api/test/db/catalog.db.test.js` | **none** — SELECT only | **none** (no cleanup) | — |
| `apps/api/test/db/scoring-model-pin.db.test.js` | **none** — SELECT only | **none** (no cleanup) | — |
| `scripts/test-orchestrator-commit.js` | commits passes, and temporarily flips one `store_offer.ingestion_record_id` then restores it | id-scoped counts only (**no** whole-table comparison) | its captured query ids; the offer's non-null count is asserted back to the preflight baseline |
| `scripts/test-orchestrator-full-run.js` | commits two passes | id-scoped leftovers only | its captured query ids; the "nothing else was written" half comes from the **zero preflight baseline**, not from an after-comparison |

For a `node --test` run, `run-db-tests.js` pins `--test-concurrency=1` (all seven files share one database),
so the parallel-run caveat recorded in `presets.db.test.js` no longer applies to `npm run test:api:db`; the
scoped checks are kept because they are the honest ones, not because the files still race.

## 8. Evidence to attach to the acceptance review

- the branch name, the verified parent, the restore point, and how each destination's identity was verified
  **out of band** (project / branch / database names only — never a connection string);
- the SHA under test (the PR's final head);
- the preflight output from §5, and the pin used;
- one result line per harness (`== RESULT: n pass / m fail`) and `test:api:db: n passed, 0 failed`;
- the residue figures each harness printed, plus any refusal recorded verbatim (including the §2.1 one);
- the branch deletion, and confirmation that no TEST or shared row was touched.

## 9. Reading a refusal

A preflight refusal means **no write was performed** and is a correct outcome, not a harness bug. Record the
message verbatim, note which requirement failed, and stop.

The one response that is never acceptable is passing a confirmation flag to make a refusal go away. The
distinction is not the flag, it is who is asserting what: a `--test-db --confirm-test-db` seed apply is a
**verified operator** writing to a branch they have independently confirmed, while an agent adding the same
flag is authorizing a write it cannot verify. This acceptance is the first case and only the first case.

## 10. Limits

The run proves the acceptance branch, not TEST's current contents — that is the point. `test:api:db`'s
whole-table checks require quiescence, so do not run this against a branch a deployed API is writing to.

A green acceptance closes the DB half of Step 5 only. Beyond it, these remain open and are **not** closed by
this run: the §2.1 assessment reconciliation, the Step 5 acceptance review of the §11.5 surface, the step 6
migration, and the F1 removal obligation (R-33 — the three composites are an owner-approved **temporary**
exception that step 6 must delete). Step 5 cannot be declared accepted until this isolated operator run
succeeds **and** §2.1 is reconciled.
