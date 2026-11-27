# Step 5 database acceptance — the operator runbook

Covers the database-backed half of the Step 5 acceptance review: §19.3's "DB-backed suite on the isolated
branch with residue asserted to zero", as it applies to the eight W3 orchestrator modules, the five W2
persistence modules and the API's DB suite.

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

## 2. The target: an isolated, seeded branch

### 2.1 Why TEST itself is not the target

Two independent blockers stop this suite from running against TEST as it stands today:

1. `scripts/test-orchestrator-full-run.js` preflights **global** counts: `recommendation_query` must be `0`
   and `build_candidate = 0`. R-32 records unmarked `recommendation_query` rows on TEST **last recorded
   2026-11-21 — that figure must be re-measured before it is cited, and the rows themselves must be left
   alone**. So the harness refuses to start there.
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
- TEST's unmarked rows are legitimately owned by nobody in this PR. Nothing here resets, clears, re-marks or
  deletes them.
- The shape is already proven in CI: the `ephemeral-eval` job applies migrations `001`-`023` and then
  **every** seed inside its own throwaway container, via `node scripts/run-seeds.js` carrying the
  shared-write attestation flag (spelled `--confirm-`*shared*: CI-only, because that container is the job's
  own scratch database, reachable by nobody else, and the flag is the operator's claim that the destination
  was verified out of band — here it would authorize a write to the WRONG database, so §4.1 step 7 is the
  only seeding path this runbook uses and it takes the TEST-target attestation instead). An acceptance
  branch is the operator-provisioned version of that CI shape.

### 2.2 The seeded catalogue does not match `EXPECTED` — measured 2026-11-26

`scripts/test-orchestrator-full-run.js` pins
`EXPECTED = { products: 100, models: 1, offers: 101, assessments: 280, queries: 0 }`. A fully seeded
database does not produce those product, offer or assessment figures.

**Measured, not inferred.** `ci` run `45901715371` (head `5aab9a6`), job `ephemeral-eval`:

| Step | Line |
|---|---|
| `Apply all seeds (ephemeral)` | `Seed rows: products=113, offers=114, assessments=319` |
| `Golden scenario harness (ephemeral)` | `catalog: {"products":113,"offers":114,"assessments":319}` |
| `Golden scenario harness (ephemeral)` | `offers: 114/114 fresh; oldest 2026-11-26T21:58:50.656Z` |

Those three counts come from `scripts/run-seeds.js` (`applySeeds`, the three `SELECT`s before the log line),
and each is **`count(*)` restricted by `product.name LIKE 'Seed %'`** — `Seed %`-prefixed rows, not table
totals. On a fresh ephemeral database the two coincide; on any other target they would not.

Static count of the same seeds (`database/seeds/*.sql`, 2026-11-26), each with zero contribution omitted:

| Seed | `product` tuples | `store_offer` tuples | `component_assessment` tuples |
|---|---|---|---|
| `001_minimal_builds.sql` | 15 | 16 | 25 |
| `002_catalog_expansion.sql` | 85 | 85 | 0 |
| `004a_component_assessments_gpu_psu.sql` | 0 | 0 | 87 |
| `004b_case_cooler.sql` | 0 | 0 | 45 |
| `004b_cpu_motherboard.sql` | 0 | 0 | 63 |
| `004b_ssd_ram.sql` | 0 | 0 | 60 |
| `023_igpu_cpu_catalog_expansion.sql` | 4 | 4 | 12 |
| `024_platform_cost_catalog_expansion.sql` | 7 | 7 | 21 |
| `025_gpu_vram_tier_expansion.sql` | 2 | 2 | 6 |
| **total** | **113** | **114** | **319** |

The three totals reproduce the CI lines exactly, so `EXPECTED` is stale by **+13 products, +13 offers and
+39 assessments**, and the gap is entirely seeds `023`-`025` plus the offer split in `001`.

**Consequence.** A correctly seeded branch would report `products: expected 100, found 113`,
`offers: expected 101, found 114` and `assessments: expected 280, found 319`, and
`scripts/test-orchestrator-full-run.js` would refuse. That refusal writes nothing and proves nothing, so
**the full-run harness is not run by this runbook at all** (see §4.4). Do **not** edit `EXPECTED` to make a
run start, and never with a number nobody measured on the target: the effective count also depends on each
seed's `NOT EXISTS` guards, so the authoritative figure is the one the read-only preflight returns **on the
acceptance branch**. Those measured counts are the **input to a separate reviewed reconciliation PR**; this
runbook does not authorise that edit, and Part II stays gated until it lands.

## 3. Prerequisites — establish both targets BEFORE any write

### 3.1 A verified clean parent

A Neon branch **inherits its parent's rows**. Creating a branch from the current TEST branch therefore
inherits TEST's unmarked `recommendation_query` rows, and the full-run preflight refuses. "Fresh branch" is
not the same as "clean branch".

The operator must choose a parent that is **verified** to have:

- `recommendation_query = 0` and `build_candidate = 0` (the full-run preflight's baseline);
- no Layer-4 test residue and no preset generation;
- the migration and seed state this acceptance intends to represent.

No clean parent is identified anywhere in this repository. That is an **operator prerequisite**: if none can
be verified, acceptance is **BLOCKED** until one is, and no branch name may be assumed. Never reset, clear,
re-mark or delete the existing TEST rows to manufacture a clean parent.

### 3.2 Both connection variables, set first

Open a **fresh shell** for the acceptance run — not a window reused from development work — and disable
its history before anything is typed, so no connection string can land in a history file:

| Shell | Disable history for this session |
|---|---|
| bash | `unset HISTFILE` |
| PowerShell | `Set-PSReadLineOption -HistorySaveStyle SaveNothing` |

Set **both** variables **before running any migration or seed command**:

| Variable | Meaning for this run |
|---|---|
| `TEST_DATABASE_URL` | the isolated acceptance branch — the **only** intended write target |
| `DATABASE_URL` | an **unreachable placeholder**, never a real endpoint |
| `API_ALLOW_SHARED` | must be **unset** |

bash form:

```sh
export DATABASE_URL='postgres://acceptance-placeholder.invalid:5432/none'
export TEST_DATABASE_URL='<the acceptance branch connection string>'
unset API_ALLOW_SHARED
```

PowerShell form:

```powershell
$env:DATABASE_URL = 'postgres://acceptance-placeholder.invalid:5432/none'
$env:TEST_DATABASE_URL = '<the acceptance branch connection string>'
Remove-Item Env:API_ALLOW_SHARED -ErrorAction SilentlyContinue
```

`.invalid` is reserved by RFC 2606 and never resolves, so the failure is a DNS error rather than a write.
Never set `DATABASE_URL` to the shared development URL, and never to the acceptance branch: the guard's
host comparison is a cheap typo check, not a destination proof, and the shared branch is not a scratch
target under any circumstances.

`API_ALLOW_SHARED=1` is the explicit opt-in that routes the API pool at `DATABASE_URL` as the shared
database (`apps/api/src/db.js:52`). Left over from an earlier session it turns "the placeholder cannot
resolve" into a routing switch, so the section above unsets it and the shell that later runs the suites
must be this same shell.

**Pre-write check — hostnames only, never credentials.** Before the first write command, run this
one-liner (it prints two hostnames and nothing else):

```sh
node -e "const h=(s)=>{try{return new URL(s).hostname}catch(e){return '(unset or unparseable)'}};console.log('DATABASE_URL host:',h(process.env.DATABASE_URL));console.log('TEST_DATABASE_URL host:',h(process.env.TEST_DATABASE_URL))"
```

The check passes only when the two hosts **differ** and the `DATABASE_URL` host **ends in `.invalid`**.
It is a typo check, not a destination proof (§3.3 remains the verification). Never paste a full connection
string into any output this run produces — not the evidence file, not a note, not a ticket, not a chat
message. Hostnames alone are safe to paste; a URL is not, because userinfo and database name ride with it.

**Why the shell must win over files (static finding; nothing was executed to learn this).** Repo entry
points call `require('dotenv').config()` (`scripts/apply-seed.js:45`, `apps/api/src/server.js:28`,
`apps/api/test/run-db-tests.js:27`), and `dotenv.config()` does **not** override an already-set variable
(`scripts/lib/generate-presets-cli.test.js:308` records exactly that). Two consequences:

- Setting the variables first makes the shell authoritative over any `.env` present in the checkout —
  which is why the exports above come before every command in §4.
- The inverse is the hazard: a **forgotten** variable lets a stale `.env` silently supply the real
  shared `DATABASE_URL`. A fresh shell with both variables set, history disabled and (for the duration)
  no reliance on any `.env`, is what makes the forgetting case impossible.

`packages/database-guard/src/index.js` refuses when the two normalized hosts are equal. That refusal is the
guard working, not an obstacle to route around — and it is only a cheap typo guard: two different strings
can still reach one database through a tunnel or port forward.

**When the run is finished or abandoned**, clear the shell so no later command inherits a live write
target:

```sh
unset DATABASE_URL TEST_DATABASE_URL
```

```powershell
Remove-Item Env:DATABASE_URL, Env:TEST_DATABASE_URL
```

### 3.3 Verify out of band, and record no secrets

Confirm in the Neon console — not from a connection string, which cannot prove the destination — that:

- `TEST_DATABASE_URL` reaches the intended **project**, **branch** and **database** of the acceptance run;
- `DATABASE_URL` reaches nothing (it is the placeholder above);
- the branch is the new one created for this run.

Record the project, branch name and database name. **Never** paste, print, log or commit a connection string
or credential into the evidence.

Then record the branch's **restore point** before any write.

## 4. Part I — the pre-reconciliation run (executable today)

Part I produces two things: a real-database behaviour result for the W3/W2 modules and the API, and the
**measured** catalogue counts Part II depends on. It does not run the full-run harness (§4.4).

### 4.1 Provision and seed

1. Verify §3.1 and §3.3. Stop here if either fails.
2. Create the Neon branch from the verified parent (for example `acceptance-step5-<YYYYMMDD>`).
3. Set `TEST_DATABASE_URL` and `DATABASE_URL` in the operator's shell (§3.2) — **before** the next step.
4. Record the restore point.
5. Apply migrations `001`-`023` **to the TEST target explicitly**:

   ```
   node scripts/run-migrations.js --test-db
   ```

   `--test-db` is not optional. Without it the runner targets `DATABASE_URL` (the unreachable placeholder
   above, so it fails to connect) and, being a shared-target apply, refuses without `--restore-point`.
   Never apply a migration with raw `psql`, and never renumber or rewrite a committed migration:
   `scripts/run-migrations.js` is the only permitted path and its ledger is what makes the apply
   re-runnable.

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
   - **Seed `006_offer_refresh.sql` re-dates existing `store_offer` rows.** Its single statement sets
     `store_offer.last_checked_at = NOW()` and `store_offer.updated_at = NOW()` for rows whose product
     name matches `Seed %` and whose `last_checked_at < NOW() - INTERVAL '7 days'` — timestamp columns
     only, no inserts and no price/currency/availability writes (its own header: "Scope: timestamp
     columns ONLY"). That is expected and correct **on an isolated
     branch created for this run**, where it touches only inherited rows the branch owns. On shared, TEST or
     EU it would be a real change to live offer dates, which is one more reason the target must be a branch
     nobody else is writing to.

### 4.2 Measure, read-only

Each statement is a `SELECT`; run it against `TEST_DATABASE_URL` after seeding and paste the output into the
evidence:

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

These five figures use the **same `Seed %` filter as `run-seeds.js` and as the harness preflight**, so they
are directly comparable — unlike the raw table counts source files imply. They are the measurement §2.2
asks for and the input to the reconciliation PR; record them even though Part I does not compare them
against `EXPECTED`.

### 4.3 The two suites that run today

Run them in this order, on the **final SHA** of the branch under test. `test:api:db` creates
`recommendation_query` rows, so it goes last:

1. `node scripts/test-orchestrator-commit.js`
2. `npm run test:api:db`

`npm run test:loaders:ephemeral` is deliberately not part of this acceptance: its fixtures carry TEST ids
and the suite asserts loader ORDER BY against rows PostgreSQL actually returned, so it belongs to the
ephemeral CI job (`ephemeral-eval`) and not to a seeded acceptance branch.

### 4.4 The full-run harness is BLOCKED in Part I

`scripts/test-orchestrator-full-run.js` is **not run** as part of Part I. Its `EXPECTED` catalogue counts are
stale (§2.2), so on a correctly seeded branch it would refuse, and a refusal that writes nothing is neither
a pass nor evidence of anything the other two suites do not already show. There is therefore no step in
Part I whose expected outcome is a refusal.

The harness becomes runnable only in Part II, after a merged PR reconciles `EXPECTED` against the counts
measured in §4.2.

### 4.5 Record and close

Record the evidence (§7) — the §4.2 counts above all — then delete the acceptance branch. Deleting a
branch created for this run is not "clearing TEST": no row of TEST, shared or EU data is touched at any
point, and the branch's inherited rows go with it.

## 5. Part II — the post-reconciliation run (gated)

### 5.1 The gate

Part II runs **only after** a merged PR updates `EXPECTED` in `scripts/test-orchestrator-full-run.js` from
numbers **measured on an acceptance branch** (the §4.2 output), with the measurement and its reason in that
PR. Until that merge, Part II does not run and the acceptance is **BLOCKED**, not failed. Nothing in this
runbook authorises editing `EXPECTED` directly.

**Both derivations must agree.** The reconciling PR has to carry (a) the **static per-seed derivation** of the
seeded catalogue - the `product` / `store_offer` / `component_assessment` tuple counts read from
`database/seeds/*.sql` (the table in §2.2) - and (b) the **§4.2 measurement from the acceptance branch**, and
the two must produce the same number for products, for offers and for assessments. Neither alone is enough: a
measured figure with no static derivation behind it cannot be re-checked by a reviewer, and a static figure
with no measurement is arithmetic about seeds whose `NOT EXISTS` guards only a real apply exercises. If they
**disagree, STOP** - the branch is not seeded as this runbook assumes, and the difference is its own finding,
not a number to write into `EXPECTED`.

### 5.2 Re-verify the zero baseline first

On the branch Part II will use, run — read-only:

```sql
SELECT
  (SELECT count(*)::int FROM recommendation_query) AS queries,
  (SELECT count(*)::int FROM build_candidate)      AS build_candidates;
```

Both must be `0`. If either is not, **STOP**: this branch is not a clean baseline, and the harness's
id-scoped cleanup would no longer be provably complete. Create a **new** branch from the verified clean
parent (§3.1) and re-run §4.1-§4.2 on it. Never clear, re-mark or delete rows to make the count zero.

### 5.3 Order: full-run first, then the commit harness, then the API suite

`test-orchestrator-full-run.js` needs the pristine baseline, so it goes first; `test:api:db` writes
`recommendation_query` rows, so it goes last:

1. `node scripts/test-orchestrator-full-run.js --model=launch-v2@2.5.0`
2. `node scripts/test-orchestrator-commit.js`
3. `npm run test:api:db`

If any step leaves residue, **stop and report the ids it printed**. Do not delete rows the run did not
create, and do not "clean up" by truncating a table.

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

## 7. Evidence to attach to the acceptance review

- which part was run, and for Part II the merging PR that reconciled `EXPECTED`;
- the branch name, the verified parent, the restore point, and how each destination's identity was verified
  **out of band** (project / branch / database names only — never a connection string);
- the SHA under test (the PR's final head);
- the §4.2 measurement output, verbatim, and the pin used;
- one result line per harness (`== RESULT: n pass / m fail`) and `test:api:db: n passed, 0 failed`;
- the residue figures each harness printed;
- the branch deletion, and confirmation that no TEST or shared row was touched.

## 8. Reading a refusal — STOP

A refusal means **STOP**. In **both** parts. It means no write was performed and the precondition it names
is not met: record the message verbatim, note which requirement failed, stop the run and report. Do not
retry it with a different flag, do not reconcile a number to get past it, and do not clear rows.

Part I contains no step whose expected outcome is a refusal. If a Part I step refuses, something about the
target is wrong — the seed state, the pin, the identity of the branch — and continuing would test something
other than what this runbook describes.

The one response that is never acceptable is passing a confirmation flag to make a refusal go away. The
distinction is not the flag, it is who is asserting what: a `--test-db --confirm-test-db` seed apply is a
**verified operator** writing to a branch they have independently confirmed, while an agent adding the same
flag is authorizing a write it cannot verify. This acceptance is the first case and only the first case.

## 9. Limits

The run proves the acceptance branch, not TEST's current contents — that is the point. `test:api:db`'s
whole-table checks require quiescence, so do not run this against a branch a deployed API is writing to.

A green run closes the DB half of Step 5 only, and Part I alone does not close it: the full-run half needs
Part II, which needs the reconciliation PR. Beyond this, these remain open and are **not** closed by any
part of this run: the `EXPECTED` reconciliation itself, the Step 5 acceptance review of the §11.5 surface,
the step 6 migration, and the F1 removal obligation (R-33 — the three composites are an owner-approved
**temporary** exception that step 6 must delete). Step 5 cannot be declared accepted until Part I and
Part II have both succeeded on a reconciled `EXPECTED`.
