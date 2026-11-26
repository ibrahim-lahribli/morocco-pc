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

## 2. Why the target is an isolated, seeded branch (Option A)

Two independent blockers stop this suite from running against TEST as it stands today:

1. `scripts/test-orchestrator-full-run.js` preflights **global** counts: `recommendation_query` must be `0`
   and `build_candidate` must be `0`. R-32 records **80** unmarked `recommendation_query` rows on TEST
   (2026-11-21) that must be **left alone**, so the harness refuses to start there.
2. Its `EXPECTED` pins `models: 1` for `modelPin.DEFAULT_MODEL_PIN` = `seed-minimal-v1@1.0.0`, which seed
   029 makes **INACTIVE**. `modelPin.resolvePinnedModel` refuses an inactive pin, so the default fails
   closed even on a pristine branch. `--model=launch-v2@2.5.0` is required. `EXPECTED`'s
   `assessments: 280` also disagrees with that file's own comment (`235`), so the seeded counts must be
   **measured** on the target, never assumed.

The resolution is an isolated, fully seeded acceptance branch, provisioned by the operator. Reasons, in
order of weight:

- The zero-baseline preflight **is** the leak proof for `runRecommendationFullRun`: it is how the harness
  knows that every row it deletes belongs to it, and it is the only reason its id-scoped cleanup can be
  trusted. Adapting the harness to a populated branch (Option B) would replace a global invariant with a
  weaker one.
- Option B would still need a **quiescent** branch: a whole-table difference cannot distinguish a harness
  leak from a concurrent writer, so a strict implementation must fail on either. It therefore buys no
  operational freedom while costing a re-validation of a Decision 21 gate.
- TEST's 80 rows are legitimately owned by nobody in this PR. Nothing here resets, clears, re-marks or
  deletes them.
- The shape is already proven in CI: `ephemeral-eval` applies migrations `001`-`023` and the seed tail to a
  throwaway database and runs the harness. An acceptance branch is the operator-provisioned version of it.

`npm run test:api:db` alone is runnable against TEST (its checks are before/after, so constant pre-existing
rows do not move them), but running the whole suite on **one** target keeps the acceptance attributable.

## 3. Procedure

1. Create a fresh Neon branch for the run (for example `acceptance-step5-<YYYYMMDD>`), from the branch the
   acceptance is meant to represent. It must carry **no** Layer-4 rows, and no preset generation.
2. Record the branch's **restore point** before any write.
3. **Verify the branch identity out of band.** A differing hostname or a differing `db:<12 hex>` digest is
   *not* proof of physical isolation: a local port, an SSH tunnel or a TCP proxy can compare as different
   while reaching a shared database. Confirm in the Neon console that the branch is the new one.
4. Apply migrations `001`-`023` through `node scripts/run-migrations.js` — the ledger is the only permitted
   path, never a raw `psql` apply and never a renumbered or rewritten migration.
5. Apply the seed tail through `node scripts/run-seeds.js`. Read that script's source before passing any
   flag: `--help` is not a contract, and an unknown argument may run the default path.
6. Point `TEST_DATABASE_URL` at the acceptance branch in the operator's own shell. `DATABASE_URL` must still
   name a **different** endpoint — `packages/database-guard/src/index.js` refuses equal normalized hosts,
   and that refusal is the guard working, not an obstacle to route around.
7. Run the preflight queries in §4 and record the numbers.
8. Run the suite in the order of §5 on the **final SHA** of the branch under test.
9. Record the evidence in §8, then delete the acceptance branch. Deleting a branch created for this run is
   not "clearing TEST": no row of TEST's data is touched at any point.

## 4. Preflight — measure, never assume

The two harnesses check different things, and both refusals are read-only.

| Harness | Requires | Tolerates |
|---|---|---|
| `scripts/test-orchestrator-commit.js` | ≥ 2 `product` rows, ≥ 1 `scoring_model` row, ≥ 1 seed `store_offer` (`ingestion_record_id IS NULL`) | any Layer-4 state; cleanup is by captured id |
| `scripts/test-orchestrator-full-run.js` | `product` = 100 Seed rows, `scoring_model` = 1 row matching the **pin**, `store_offer` = 101 Seed offers, `component_assessment` = 280 Seed rows, `recommendation_query` = 0, `build_candidate` = 0 | nothing — it is a clean-baseline harness |

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

**If a count differs from `EXPECTED`, STOP.** Do not edit `EXPECTED` to make the refusal go away, and never
with a number nobody measured. Record the measured counts and treat the difference as its own finding: a
seeded catalogue that no longer matches the harness's committed shape is a separate change that needs the
measurement, the reason and a review — not a side effect of an acceptance run.

## 5. Suite order

`test-orchestrator-full-run.js` needs the pristine baseline, so it goes **first**; `test:api:db` creates
`recommendation_query` rows, so it goes last.

1. `node scripts/test-orchestrator-full-run.js --model=launch-v2@2.5.0`
2. `node scripts/test-orchestrator-commit.js`
3. `npm run test:api:db`

If any step leaves residue, **stop and report the ids it printed**. Do not delete rows the run did not
create, and do not "clean up" by truncating a table.

`npm run test:loaders:ephemeral` is deliberately not part of this acceptance: its fixtures carry TEST ids and
the suite asserts loader ORDER BY against rows PostgreSQL actually returned, so it belongs to the ephemeral
CI job (`ephemeral-eval`) and not to a seeded acceptance branch.

## 6. Residue map — what each file actually asserts

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

## 7. Reading a refusal

A preflight refusal means **no write was performed** and is a correct outcome, not a harness bug. Record the
message verbatim, note which requirement failed, and stop. The one response that is never acceptable is to
pass `--confirm-test-db` or `--confirm-shared` to make it go away.

## 8. Evidence to attach to the acceptance review

- the branch name, the restore point, and how the identity was verified **out of band**;
- the SHA under test (the PR's final head);
- the preflight output from §4, and the pin used;
- one result line per harness (`== RESULT: n pass / m fail`) and `test:api:db: n passed, 0 failed`;
- the residue figures each harness printed;
- the branch deletion, and confirmation that no TEST or shared row was touched.

## 9. Limits

The run proves the acceptance branch, not TEST's current contents — that is the point. `test:api:db`'s
whole-table checks require quiescence, so do not run this against a branch a deployed API is writing to. And
a green acceptance closes the DB half of Step 5 only: the Step 5 acceptance review of the §11.5 surface, the
step 6 migration and the F1 removal obligation (R-33) all remain open.
