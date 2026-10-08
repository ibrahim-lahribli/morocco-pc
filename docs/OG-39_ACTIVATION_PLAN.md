# OG-39 — activation plan for the launch-v2 scoring model

**Status:** AUTHORED 2026-10-08 (E1b) — **NOT EXECUTED.** Every command below is written to be
copy-pasteable but has NOT been run; nothing in this plan has touched a database.

**Gap:** `docs/OPEN_GAPS.md` OG-39. **Decision:** 37. **Seed:** `database/seeds/013_scoring_model_launch_v2.sql`.

**Why this is a plan and not a routine seed run.** Applying seed 013 flips the active scoring model
from `seed-minimal-v1` to `launch-v2`. Four guarded harnesses pin `seed-minimal-v1 ... is_active = true`
BY NAME in their preflight and fail if v1 is inactive, and `apps/api/`'s model resolution starts
serving `launch-v2`. So activation is a coordinated, sequenced change.

Acceptance for completing OG-39: seed 013 is applied on the dedicated engine branch, all four guarded
harnesses are GREEN against that branch, and the golden baseline records BOTH models.

---

## Step (a) — confirm a DEDICATED Neon branch for engine work

The engine must never apply seed 013 (or any write) to the shared `DATABASE_URL`. `TEST_DATABASE_URL`
must point at a dedicated branch of the shared instance whose normalised host differs from
`DATABASE_URL` — `getWriteTestDbUrl()` throws when they match, so a successful connect already proves
distinctness. `.env` is loaded by the scripts, not by the shell.

```bash
# 1) Point TEST_DATABASE_URL at the dedicated engine branch in .env, then confirm reachability.
node -e "require('dotenv').config();const{getWriteTestDbUrl}=require('./scripts/lib/db-url');const{Client}=require('pg');const c=new Client(Object.assign({},getWriteTestDbUrl(),{connectionTimeoutMillis:15000}));c.connect().then(()=>c.query('SELECT current_database() AS db')).then(r=>{console.log('TEST branch ok',r.rows[0]);return c.end();}).catch(e=>{console.error('ERR',e.message);process.exit(1);});"

# 2) Confirm the branch carries the canonical catalog and exactly ONE active model (pre-activation).
node -e "require('dotenv').config();const{getWriteTestDbUrl}=require('./scripts/lib/db-url');const{Client}=require('pg');const c=new Client(Object.assign({},getWriteTestDbUrl(),{connectionTimeoutMillis:15000}));(async()=>{await c.connect();await c.query('SET search_path = public');console.log((await c.query(\"SELECT name,version,is_active FROM scoring_model ORDER BY is_active DESC,name\")).rows);console.log((await c.query(\"SELECT count(*)::int AS products FROM product WHERE name LIKE 'Seed %'\")).rows[0]);await c.end();})().catch(e=>{console.error('ERR',e.message);process.exit(1);});"

# 3) Confirm the migration ledger is current on the branch (seeds are DML, so this should be 018).
node scripts/run-migrations.js --check --test-db
```

Record the Neon branch name/endpoint in the branch metadata. Do NOT reuse the shared DB host.

Checkpoint: a 1-row SELECT succeeds, the branch is distinct from `DATABASE_URL`, and preflight shows
one active model (`seed-minimal-v1 1.0.0`).

## Step (b) — rewrite the four `is_active`-by-name harnesses

Each harness must pin the model by **explicit name + version** and DROP the `is_active = true`
requirement, because the harness passes the chosen `scoring_model_id` on the query it inserts — the
engine then uses the pinned row regardless of which model is active.

```bash
grep -rn "seed-minimal-v1" scripts/measure-orchestrator.js scripts/test-orchestrator-full-run.js scripts/verify-pool-independence.js scripts/measure-og01-reach.js scripts/eval-scenarios.js
```

Exact call sites to change (measured 2026-10-08):

| File | Line(s) | Current predicate |
|---|---|---|
| `scripts/measure-orchestrator.js` | 168, 192 | `name = 'seed-minimal-v1' AND version = '1.0.0' AND is_active = true` |
| `scripts/test-orchestrator-full-run.js` | 91, 113 | same |
| `scripts/verify-pool-independence.js` | 63 | same |
| `scripts/measure-og01-reach.js` | 105 | same |
| `scripts/eval-scenarios.js` | 95 | model-agnostic: `WHERE is_active = true ORDER BY created_at DESC, id ASC LIMIT 1` |

Rewrite the four to `WHERE name = 'seed-minimal-v1' AND version = '1.0.0'` (explicit pin, no
`is_active`). Leave `eval-scenarios.js` model-agnostic for step (d), but add a `--model=<name>@<version>`
selector there so both models can be measured deliberately.

Re-run each harness against the branch and require GREEN (the guards already refuse a non-branch target):

```bash
node scripts/test-orchestrator-full-run.js
node scripts/measure-orchestrator.js
node scripts/verify-pool-independence.js
node scripts/measure-og01-reach.js
```

Checkpoint: all four GREEN with `seed-minimal-v1` still the active model. Do NOT apply seed 013 before
this step.

## Step (c) — apply seed 013 on the branch only, then re-run the guarded harnesses

`scripts/run-seeds.js` ignores `--test-db` and always targets the shared `DATABASE_URL`, so it MUST NOT
be used here. Apply branch-first with the same pattern the migration runner uses: connect through
`getWriteTestDbUrl()`, `SET search_path = public` (the branch client defaults to `pg_temp`, so the
tables are otherwise invisible), then send the WHOLE file (it carries no `BEGIN`/`COMMIT`, and must
never be split on `;`).

```bash
node -e "require('dotenv').config();const fs=require('fs');const{getWriteTestDbUrl}=require('./scripts/lib/db-url');const{Client}=require('pg');const c=new Client(Object.assign({},getWriteTestDbUrl(),{connectionTimeoutMillis:15000}));(async()=>{await c.connect();await c.query('SET search_path = public');const sql=fs.readFileSync('database/seeds/013_scoring_model_launch_v2.sql','utf8');await c.query(sql);const rows=await c.query(\"SELECT name,version,is_active FROM scoring_model WHERE name IN ('seed-minimal-v1','launch-v2') ORDER BY is_active DESC,name\");console.log(rows.rows);const models=await c.query('SELECT count(*)::int AS active FROM scoring_model WHERE is_active = true');console.log('active models:',models.rows[0].active);await c.end();})().catch(e=>{console.error('ERR',e.message);process.exit(1);});"
```

Expected after a first apply: exactly one active model (`launch-v2 1.0.0`), with `seed-minimal-v1 1.0.0`
retained but inactive. A second apply is a no-op (both statements are guarded) — verify by re-running
the command and asserting the row count is unchanged.

Then re-run the four harnesses AND the golden harness against the branch:

```bash
node scripts/test-orchestrator-full-run.js
node scripts/measure-orchestrator.js
node scripts/verify-pool-independence.js
node scripts/measure-og01-reach.js
node scripts/eval-scenarios.js --with-pi1
```

Checkpoint: all five GREEN, residue asserted 0. Confirm the public vocabulary is now
`{GAMING, OFFICE, WORKSTATION}` (the seed's read-only verification SELECT at the bottom of the file).

## Step (d) — record `seed-minimal-v1` and `launch-v2` as two columns in the golden baseline

`eval-scenarios.js` currently reads the single active model. Extend it (in the execution commit, not
here) to run the suite once per model and render BOTH in the baseline:

- add `--model=<name>@<version>` (default: the active model);
- run: `node scripts/eval-scenarios.js --model=seed-minimal-v1@1.0.0 --baseline=test/golden/baseline-2026-10.md`
  and `node scripts/eval-scenarios.js --model=launch-v2@1.0.0 ...` — or one pass that emits a
  `model` column per row;
- the observed-metrics and assertion tables gain a `model` column so a difference between the two
  models is visible, and the Environment section names both versions.

Checkpoint: the committed baseline shows both models; any row that differs between them is explained
(the two configurations differ ONLY by `use_case_profiles`, so scoring numbers should be identical).

## Rollback

Seed 013 is additive and reversible by hand on the branch:

```sql
UPDATE scoring_model SET is_active = false WHERE name = 'launch-v2' AND version = '1.0.0';
UPDATE scoring_model SET is_active = true  WHERE name = 'seed-minimal-v1' AND version = '1.0.0';
```

Or delete the `launch-v2` row and re-activate v1. Never do this on the shared `DATABASE_URL`.

## Risks / notes

- `apps/api/` begins serving `launch-v2` as soon as it is active, and its meta vocabulary is still
  derived from `gpu_required_use_cases` until the Platform request in `docs/briefs/requests.md` lands
  (OFFICE stays 422 at the vocabulary gate). Coordinate the API change or accept that interim state.
- The four harnesses measure `seed-minimal-v1` by design; if a future epic wants the ACTIVE model
  measured instead, that is a deliberate change, not a side effect of this plan.
- Apply this to the dedicated engine branch only; a later shared-DB apply needs a recorded Neon restore
  point (AGENTS.md §8) and is a separate, explicit decision.
