# PLATFORM PLAN — P0: persist pass facts + product identity (v1.0 → v1.1)

**Date:** 2026-10-14  
**Author:** Platform agent (agent/platforms), on behalf of the approved review.  
**Purpose of this file:** the single, dated, auditable record of what the platform agent agreed to build next — migration 019 (persisted `budget_floor` / `engine_version` / `strategy_key` + the column-scoped UPDATE grants that resolve the production-role write problem), migration 020 (`display_name` / `slug` / image fields with a deterministic backfill), the pass-facts write seam and API wiring that consume them, and the contract v1.1 deltas in `docs/API.md`. It is also the work breakdown by 1-hour sprints with a definition of done and a verification gate per sprint, so the execution can be driven sprint-by-sprint without re-deriving scope from prose.

**Decision id:** Decision 46 (Platform manual/019/020 + persisted pass facts). The commit of this file is the pool-independent record of that decision; the actual decision entry in `docs/RECOMMENDATION_ENGINE_DECISIONS.md` is written in Sprint 2 alongside the seam.

**Branch:** `agent/platforms` at commit `c8c16b9`, identical to `origin/master`. The branch is clean and has zero in-flight platform commits.  
**Target version:** `0.1.0` in `package.json`.  
**Database reality checked before planning:** the commit seam already holds the pieces it would need to thread a `passFacts` ([commit.js:118](src/recommendation/orchestrator/commit.js#L118), [full-run.js:104](src/recommendation/orchestrator/full-run.js#L104)); the production role is documented as having **no UPDATE** ([docs/API.md](docs/API.md)); the production-role decision is a set of COLUMN-scoped grants — `GRANT UPDATE (budget_floor) ON recommendation_query` plus `GRANT UPDATE (engine_version, strategy_key) ON recommendation_result`, one per column the writer touches and never a row-wide UPDATE; `strategy_key` stays TEXT (precedent: `use_case` is TEXT); the new writer follows the proven pattern in `persist-rejections.js` (DML-only boundary, replace-not-append idempotency, boundary test banning SELECT/BEGIN/COMMIT). Column shapes read from the generated [SCHEMA_REFERENCE.md](docs/SCHEMA_REFERENCE.md): `product` 9 columns, `recommendation_query` 9, `recommendation_result` 6; migrations end at `018`; seeds end at `016`.

---

## Outcome

After this plan, the API can answer a GET with the same facts it produced on the POST (budget floor, engine version, strategy key, and per-component slug/display_name), the user no longer sees `Seed <model>` tokens through `components[].name`, and the contract moves to v1.1. The bigger items — region coarsening / topology move, loader batching (engine-owned), real-data ingestion, and ops — stay explicitly planned, not absorbed into "done."

## Scope (build now)

**In scope this session:**
- `database/migrations/019_recommendation_pass_facts.sql`
- `database/migrations/020_product_identity_and_media.sql`
- `src/recommendation/persistence/persist-pass-facts.js`
- `src/recommendation/persistence/persist-pass-facts.test.js`
- `src/recommendation/persistence/persist-ranked.js` (read only; decide whether strategy_key survives `explainSelection`)
- `src/recommendation/persistence/validate-selected.js` (read only)
- `src/recommendation/persistence/persist-rejections.js` (read only, for the pattern)
- `src/recommendation/orchestrator/commit.js`
- `src/recommendation/orchestrator/full-run.js`
- `src/recommendation/orchestrator/full-run.test.js`
- `apps/api/src/repository.js`
- `apps/api/src/routes/recommendations.js`
- `apps/api/src/contracts/recommendations.js`
- `apps/api/test/unit/contract.test.js`
- `docs/API.md` (the v1.1 deltas)
- optional: `apps/api/test/unit/openapi-v1.1.json` (the API contract snapshot)

**Not started this session (recorded as still-planned):**
- P1 step 1 (region/topology move) — operator action, not a code change.
- P1 step 3 (loader batching) — engine-owned; file as a request with a Decision + `catalog_version` check; attempt only if steps 1–2 miss the target.
- P1 step 4 (dedupe) + step 5 (presets) — both depend on a canonical key and a `catalog_version` concept that does not exist; build after the key is designed.
- P2 catalog endpoints, trustProxy config, OpenAPI snapshot+test, `meta.js` listUseCases swap (OG-38) — the snapshot test is the one P2 item folded into Sprint 4; the rest stay planned.
- P3 ops, CI `test:api:db` verification, role rehearsal, error tracking, staging+prod, migration-deploy step — operator/owner work, recorded.
- P4 real data, the missing non-seed provenance gate, Decision 7 amendment, seed retirement per PIPELINE_DESIGN §7, the read-path `ACTIVE` audit — blocked on H2 (a retailer with readable terms); recorded, not started.

## House rules applied to this plan

- Schema change = new sequential migration, never edit a committed one. (Recipe: `docs/RECIPES/add-a-migration.md`.)
- `gen:schema` regenerates `docs/SCHEMA_REFERENCE.md` and `docs/DATA_STATE.md` from the shared DB; it is run only after any shared apply, not before. Running it now would desynchronise the generated docs from the database the digest gate hashes.
- `verify-docs.js` pins `global=43` / `Status=49`; adding Decision 46 means `global=44` / `Status=50`, plus its comment block, then `npm run gen:decisions`.
- `migrations-range-documented` keys on the `AGENTS.md` §4 range; that range must be refreshed when 019/020 land.
- `str_replace` ignores whitespace across line wraps; CRLF files in `docs/` and `database/` must be edited so anchors sit wholly inside one physical line. For new migration files, write CRLF from the start and never normalize.
- Never apply a migration to the shared `DATABASE_URL` without a recorded Neon restore point; `run-migrations.js` refuses with exit 1 and a clean ledger unless `--restore-point=<id>` matches `^[A-Za-z0-9_-]{8,}$`.
- TEST apply is unbounded in this plan; shared apply is a gated operator step whose mode (defer to owner, or apply with a restore point handed by the owner) is decided in Sprint 5 and recorded in `docs/briefs/requests.md`.
- Every verification at a sprint door is captured on its own exit, not filtered through a pager or `grep`.

## Sprint 1 — pass-facts writer + 5th-arg seam (60 min)

**Date:** 2026-10-14  
**Purpose:** create the writer that persists a pass's facts inside the existing commit transaction, and extend the commit seam with a backward-compatible 5th argument so the full run and the API can eventually push facts down.

### Files to add or edit

**Add:**
- `src/recommendation/persistence/persist-pass-facts.js`
- `src/recommendation/persistence/persist-pass-facts.test.js`

**Edit:**
- `src/recommendation/orchestrator/commit.js` — `runRecommendationCommit(client, queryId, selected, rejections, passFacts)` with passFacts as the new 5th argument; invoke the writer only when `passFacts` is not `undefined` (a `null`/non-object value is refused before `BEGIN`); return path unchanged (the writer's frozen result is still returned by reference, mirroring the current seam).
- `src/recommendation/orchestrator/commit.test.js` — TWO edits, and the second is the one that gets forgotten:
  - (a) the Decision 46 fake-client tests: an `undefined` passFacts issues no statements and leaves all existing call sites byte-identical; a supplied value writes the floor then each rank between `persistRanked` and `COMMIT`; a malformed value is refused before `BEGIN`; a failing pass-facts writer rolls the whole pass back. The 5th argument is additive, not a shape change to the call contract.
  - (b) **UPDATE THE EXACT-IMPORT PIN.** The test `commit.js imports exactly the error vocabulary and the writer modules` asserts the sorted `require` list deep-equals `['../candidates/errors', '../persistence/persist-ranked', '../persistence/persist-rejections']`, so the new `require('../persistence/persist-pass-facts')` in `commit.js` FAILS it. The list must become `['../candidates/errors', '../persistence/persist-pass-facts', '../persistence/persist-ranked', '../persistence/persist-rejections']` — note `persist-pass-facts` sorts BEFORE `persist-ranked`. Skipping this step makes the sprint's own verification gate unreachable.

### What the writer does

- Boundary: DML only — no SELECT, no BEGIN/COMMIT/ROLLBACK, parameterized-only; same discipline as `persist-rejections.js`. **UPDATE-only** as well: the rows already exist by the time it runs (`persistRanked` inserted them earlier in this same transaction), so it contains no INSERT, no DELETE and no UUID generation — unlike both of its siblings.
- One parameterized `UPDATE recommendation_query SET budget_floor = $2 WHERE id = $1`. The floor object is passed THROUGH unchanged, not stringified: node-postgres JSON-encodes a plain object parameter for a jsonb column (measured against the shared DB 2026-10-14: `SELECT $1::jsonb` with `{a:1}` round-trips to an object; a JS `null` becomes SQL NULL), and stringifying would double-encode it.
- One parameterized `UPDATE recommendation_result SET engine_version = $1, strategy_key = $2 WHERE recommendation_query_id = $3 AND rank = $4` per result row, addressed by `rank = index + 1` over the supplied `strategyKeys` array. That is exactly the order `persistRanked` wrote them in, because `validate-selected.js` pins `persisted_rank` to contiguous 1..N over the same array; migration 011's `uq_recommendation_result_query_rank (recommendation_query_id, rank)` makes the `AND rank = $4` match hit at most one row. WHICH key belongs to WHICH rank stays verified by the read path, not by the writer claiming it.
- The writer also takes `selected`, for ONE purpose: it refuses a mismatch between `passFacts.strategyKeys.length` and `selected.length`. A short array would silently leave rows NULL and a long one would fire UPDATEs that match nothing, and NEITHER is visible to a fake-client test. The length half is therefore enforced in the writer; the content half is pinned at the seam in Sprint 2.
- `undefined` ⇒ the wrapper invokes nothing (zero statements). `null` (or any non-object) ⇒ refused by the wrapper with `CandidateSelectionError(ERROR_CODES.INVALID_FIELD_VALUE, field 'passFacts')` BEFORE `BEGIN`, so not even a transaction is opened. `null` is deliberately NOT a synonym for `undefined`: omitting the argument is what means "persist no facts".
- Idempotency: the writer REPLACES the query's floor (one UPDATE scoped to the query id) and replaces each result row's engine_version/strategy_key; it does not INSERT anything, so a re-commit of the same pass converges. Replacement here is inherited from UPDATE itself rather than from a DELETE step, so it also sidesteps the unique-index problem on the (id, NULL) product-keyed rows.
- Return shape: frozen `{ query_id, floor_update_issued: true, result_updates_issued: N }` — honest STATEMENT COUNTS, deliberately not named "rows updated": without a SELECT (banned here) the writer cannot prove a row matched. The seam caller does not reshape the return.

### Decisions recorded in this sprint (in code and in the writer's test header)

- The 5th argument is `undefined`-able, not required, for backward compatibility with the existing commit suite and with the 3-/4-arg call sites.
- `null` is refused rather than folded into `undefined` — pinned in `commit.js`, in the writer and in the tests, not left floating.
- The query-row floor UPDATE is column-scoped by design; the production-role GRANTs for every column the writer touches are recorded as a Decision 46 implementation note in the writer's header and in the docs addendum, not deferred to Sprint 5.
- `engine_version` is TEXT and nullable (pre-019 rows are unknowable), same as `strategy_key`.

### Tests (fake client, no DB)

1. Pass a real `passFacts` to a fake client: exactly the expected parameterized UPDATEs in the expected order (floor row first, then one result row per rank with `rank = index + 1`), the exact parameter tuple of each, and the statement SQL constants equal to the module constants. The writer mints no ids, so the assertion is on the parameter tuples — there is no returned id list to compare.
2. `passFacts: undefined` → zero statements; the commit result's shape is unchanged; the 3/4-arg call site still works.
3. `passFacts: null` (and any other non-object) → refused with `CandidateSelectionError(ERROR_CODES.INVALID_FIELD_VALUE, field 'passFacts')` BEFORE `BEGIN`, so zero statements are issued. Not a synonym for `undefined`.
4. Malformed client → `CandidateSelectionError(ERROR_CODES.INVALID_INPUT, field 'client')` before any statement (mirror `persistRejections`'s `validateClient`).
5. Re-commit with changed `strategy_key` replaces the old value; a second identical pass converges to the same rows (replacement, not duplication), asserted together with a source-boundary check that the module contains no INSERT and no DELETE at all.
6. `passFacts.strategyKeys.length` ≠ `selected.length` → refused, naming BOTH counts, before any statement. This is the alignment half the writer can check without a SELECT.

### Verification at the door

- `node --test "src/recommendation/persistence/persist-pass-facts.test.js" "src/recommendation/orchestrator/commit.test.js"` — each suite on its own exit status; no `grep`/`head` of the output; capture `$?` from the test command itself.
- `npm run test:unit` still 0 fail / 0 cancelled at the end (the commit and full-run suites already exist and are pinned; only their additive path is touched).
- `scripts/verify-migrations-replay.js --test-db` is **not** run here: no schema file yet.

### Definition of done

- `persist-pass-facts.js` exists, boundary-correct (DML-only AND UPDATE-only), and its test pins the SQL constants, the parameter tuples and the fail-fast matrix.
- `commit.js` takes the 5th argument and invokes the writer only when `passFacts` is defined.
- The exact-import pin in `commit.test.js` is updated in the same edit — without it the suite cannot read green.
- The commit suite + writer test read green with the additive path in, false by construction (no schema, no DB).
- Both suites re-verified on the CI's Node 22 leg (`npx -y node@22 --test "src/**/*.test.js"`), not only locally: an accidentally-nested test is cancelled on 22 and runs on 24.

---

## Sprint 2 — wiring the seam: full-run → commit, and the column-scoped UPDATE grant (60 min)

**Date:** 2026-10-14  
**Purpose:** thread a real `passFacts` from the full run into the commit, decide and record the production-role write resolution, and confirm the seam produces a persisted shape that carries the facts, including on an empty zero-build pass (the A1/A3 diagnostic the roadmap asked for).

### Files to add or edit

**Add:**
- `docs/RECOMMENDATION_ENGINE_DECISIONS.md` addendum entry for Decision 46 (if not already written) — one normalized `Status:` line and a short body: what 019/020 add, why the production role gets column-scoped `GRANT UPDATE` privileges on EACH written column (`budget_floor`, `engine_version`, `strategy_key`) rather than a row-wide UPDATE or an insert-only diagnostic table, the `has_table_privilege` / `has_column_privilege` self-check that keeps the invariant provable, and the rejected alternative plus the reason.

**Edit:**
- `src/recommendation/orchestrator/full-run.js` — call `commit.runRecommendationCommit(client, queryId, explained, snap.filter_verdicts, passFacts)` where `passFacts` is `{ budgetFloor: snap.budget_floor, engineVersion, strategyKeys: selection.archetypes.map(a => a.strategy_key) }`. The `engineVersion` comes from the engine's own option/constant at the seam, not from the API's `ENGINE_VERSION` env (the API passes its deploy version down through `engine.runFullRun`; decide the exact handoff during the sprint and pin it).
- `src/recommendation/orchestrator/full-run.test.js` — add a fake-client test proving the seam threads `passFacts` such that the persisted shape (the return of `runRecommendationCommit`) includes `engine_version` and `strategy_key` on the result rows when the writer is a real fake writer, and that an empty zero-build pass still writes the query's `budget_floor` row if the pass computed a floor (this is the A1/A3 gap: a 200 reply with a floor diagnostic on a zero-build pass).

### What the writer does (cross-check, not re-implement)

- The same boundaries and idempotency from Sprint 1.
- The writer does not INSERT; it UPDATEs. A re-run of the same pass for the same query id converges (the same replacement logic as `persistRejections`).

### Tests (fake client, no DB, plus a seam proof)

1. Fake full-run with a real fake writer: the `persisted` return from the commit shows the facts landed on the result rows for a non-empty pass.
2. Empty zero-build pass: the commit still writes the query's `budget_floor` row (or intentionally does not — decide and pin; the roadmap wants a 200 with a floor on a zero-build pass, so recording the floor on the query row is the intended behaviour).
3. The seam does not require the API to change in this sprint; API wiring is Sprint 4.
4. The 3/4-arg call sites outside `full-run.js` still work (the seam is additive; verify with the existing full-run test suite plus one explicit additive path).
5. Rank alignment, content half: the writer enforces `strategyKeys.length === selected.length`, so assert the other half too — that rank `i + 1`'s UPDATE carries `archetypes[i].strategy_key`. `select-archetypes.js` pins `persisted_rank = index + 1` and `explainSelection` preserves array order, so `selection.archetypes` and the explained `selected` are index-aligned by construction; this test is what keeps that construction honest.

### Decision 46 recorded here (the production-role write resolution)

Implement as **column-scoped grants, one per column the writer touches** — never a row-wide UPDATE, because the role's write surface is otherwise SELECT+INSERT only and that invariant is the whole point:

```sql
GRANT UPDATE (budget_floor) ON recommendation_query TO morocco_pc_api;
GRANT UPDATE (engine_version, strategy_key) ON recommendation_result TO morocco_pc_api;
```

BOTH statements are required. The documented role has no UPDATE anywhere, so granting only `budget_floor` leaves the two `recommendation_result` UPDATEs to fail with `42501` in production mode — exactly the class of failure the grant exists to prevent.

The invariant stays provable, and the self-check must assert all three columns: `has_table_privilege('morocco_pc_api','recommendation_query','UPDATE')` → `f` and `has_table_privilege('morocco_pc_api','recommendation_result','UPDATE')` → `f`, while `has_column_privilege('morocco_pc_api','recommendation_query','budget_floor','UPDATE')`, `has_column_privilege('morocco_pc_api','recommendation_result','engine_version','UPDATE')` and `has_column_privilege('morocco_pc_api','recommendation_result','strategy_key','UPDATE')` → `t`. The grants themselves are an operator step, never a migration.

Rejected alternative: a new insert-only `recommendation_diagnostic` table. Reason: a column-scoped GRANT keeps the "no row-wide UPDATE" invariant provable and is the smallest change that lets the facts reach the rows where they belong. An insert-only table would split the floor from the query and create a new PK/UPSERT problem for re-commit handling.

### Verification at the door

- `node --test "src/recommendation/orchestrator/full-run.test.js"` (and the surrounding full-run suite) on its own exit; no pager.
- `npm run test:unit` still 0 fail / 0 cancelled.
- No DB in this sprint; schema not yet created.
- **Known transition hazard — record it here, do not discover it from a red job.** `full-run.js` supplies `passFacts` unconditionally, so from Sprint 2 until 019 lands `persistPassFacts` runs on EVERY pass and fails `42703` against a schema without the three columns (measured 2026-10-14: 0 of 3 present on the shared DB AND on the TEST branch). Every DB-backed write gate is therefore RED on this branch — `test-orchestrator-full-run.js`, `measure-orchestrator.js`, `eval:scenarios`, `verify:pi1`, `test:api:db` — and the nightly `recurring-gates` job would fail at `test:api:db`. Accepted only as a pre-merge branch state on the assumption that Sprint 3 lands 019 immediately; if Sprint 3 is deferred, land 019 alone first.

### Definition of done

- `full-run.js` threads a real `passFacts`.
- Decision 46's production-role resolution is recorded in the decision log (normalized `Status:` line + body).
- The fake full-run seam proves the facts land on the persisted shape, including for an empty zero-build pass where the floor is recorded on the query row.
- The commit and full-run suites read green with the additive path in.

---

## Sprint 3 — author 019 and 020, review against the recipe, branch-apply and replay (60 min)

**Date:** 2026-10-14  
**Purpose:** write the two migrations, review them against the migration recipe, and apply + replay them on the TEST branch. **Do not** run `gen:schema` in this sprint — that runs against the shared DB and would desync the generated docs from the digest gate target.

### Files to add

- `database/migrations/019_recommendation_pass_facts.sql`
- `database/migrations/020_product_identity_and_media.sql`

### Migration 019 shape

```sql
ALTER TABLE recommendation_query
  ADD COLUMN IF NOT EXISTS budget_floor jsonb;

ALTER TABLE recommendation_result
  ADD COLUMN IF NOT EXISTS engine_version text;

ALTER TABLE recommendation_result
  ADD COLUMN IF NOT EXISTS strategy_key text;
```

- CRLF. `IF NOT EXISTS` on every column. All three nullable, no default, no backfill. No CHECK that would block a later archetype: `strategy_key` and `engine_version` are TEXT.
- No `schema_migrations` mutation; no destructive ALTER; no enum change; ledger-applied only.

### Migration 020 shape

```sql
ALTER TABLE product
  ADD COLUMN IF NOT EXISTS display_name text;

ALTER TABLE product
  ADD COLUMN IF NOT EXISTS slug text;

ALTER TABLE product
  ADD COLUMN IF NOT EXISTS image_url text;

ALTER TABLE product
  ADD COLUMN IF NOT EXISTS image_source text;

ALTER TABLE product
  ADD COLUMN IF NOT EXISTS image_licence_note text;

UPDATE product
  SET display_name = regexp_replace(name, '^Seed ', '')
  WHERE display_name IS NULL;

WITH base AS (
  SELECT id,
         trim(both '-' from regexp_replace(lower(regexp_replace(coalesce(display_name, name), '[^a-zA-Z0-9]+', '-', 'g')), '-+', '-', 'g')) AS b,
         row_number() OVER (PARTITION BY trim(both '-' from regexp_replace(lower(regexp_replace(coalesce(display_name, name), '[^a-zA-Z0-9]+', '-', 'g')), '-+', '-', 'g')) ORDER BY id) AS rn
  FROM product
)
UPDATE product p
  SET slug = CASE WHEN b.rn = 1 THEN base.b ELSE base.b || '-' || (base.rn)::text END
  FROM base
  WHERE p.id = base.id;

-- DEAD: the base expression already applies lower(), and the suffix is a
-- hyphen plus digits, so this can never change a row. Drop it, or say why
-- it is kept. See "Note on display_name / slug collisions" below.
UPDATE product SET slug = lower(slug) WHERE slug IS NOT NULL;

ALTER TABLE product ALTER COLUMN slug SET NOT NULL;

ALTER TABLE product ADD CONSTRAINT chk_product_slug_format
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

CREATE UNIQUE INDEX uq_product_slug ON product (slug);
```

- `name` untouched (seeds JOIN on `p.name = v.name`; PIPELINE_DESIGN §7 retires via `name LIKE 'Seed %'`). Both facts re-read in the same sprint before finalizing.
- Deterministic slug generation: ONE pass builds the base slug (whose `lower(...)` already satisfies the CHECK's `^[a-z0-9]+(-[a-z0-9]+)*$`) and suffixes collisions by `row_number() OVER (PARTITION BY base ORDER BY id)`. The `trim(both '-' from ...)` + `lower(...)` inside the base expression is what makes the trailing `UPDATE ... SET slug = lower(slug)` redundant — see the collision note below. Safe on an empty DB (replay): zero rows backfilled, `SET NOT NULL` trivially satisfies.
- Image columns are nullable documentation-only for now; `image_licence_note` is the source/licence note the roadmap asks for.
- `manufacturer_part_number` is not changed (it is used by matching, and is nullable by design).

### Review against the recipe

1. `git status` first.
2. Write both files CRLF.
3. `node scripts/run-migrations.js --dry-run` lists them as the next two pending files, in order, with no `schema_migrations` mutation and no destructive ALTER.
4. `node scripts/run-migrations.js --test-db` applies both on the TEST branch; a second apply is a no-op and the ledger grows by exactly 2 rows.
5. `node scripts/run-migrations.js --test-db --check` reads "No pending migrations".

### Tests in this sprint (migration-correctness tests, not engine semantics)

1. `run-migrations.js --dry-run` on the working tree lists 019 then 020 as the next two pending files, in order.
2. Branch apply idempotency: apply twice, ledger grows by exactly 2 rows, second apply is a no-op.
3. `verify:replay --reference=test` 0 drift on a fresh replay that includes all 20 migrations (this is the single most important correctness check: it proves the two new files replay cleanly to 0 drift on an empty DB and that the live tail matches).
4. Proof step (branch DB, recoverable): a real GAMING@10000 MAD pass on the TEST branch reads back a non-empty `recommendation_query.budget_floor`, and reading back the result through the API's `readRecommendationResult` shows the new columns are visible to the read path. This is a proof step, not a CI gate; it is recoverable because it writes on the TEST branch and the branch ledger is disposable.

### Note on `display_name` / `slug` collisions

- Seed 002 has 5 `INSERT INTO product` statements (multi-row). Duplicate seed names are possible but not observed; the `row_number()` suffix handles them deterministically.
- **The `row_number()` suffix is NOT collision-free ACROSS bases, and the failure mode is a whole-file abort.** `PARTITION BY base ORDER BY id` yields `base`, `base-2`, `base-3`, …, so a DIFFERENT product whose own natural base is literally `base-2` collides with the suffixed slug of a duplicate pair. `CREATE UNIQUE INDEX uq_product_slug` then raises 23505 and the file's single transaction rolls back. The discussion above only considers duplicate NAMES, which is the narrower case. Measured 2026-10-14 against the live catalog (104 products, read-only): **104 distinct slugs, 0 collisions** — so 020 is safe on today's data but unsafe by construction. Before this file is replayed or applied anywhere new, add a pre-flight distinctness check, or make the suffix loop-regenerate until distinct.
- The second `UPDATE product SET slug = lower(slug) WHERE slug IS NOT NULL` is DEAD: the base already applies `lower(...)`, and the suffix is a hyphen plus digits. It can never change a row — drop it, or say in the file why it is kept.
- Lock note: `ALTER COLUMN slug SET NOT NULL`, the validating `ADD CONSTRAINT chk_product_slug_format` and the non-concurrent `CREATE UNIQUE INDEX` each take ACCESS EXCLUSIVE on `product`. Trivially fine on an empty replay target and brief on the branch, but the shared DB is the only dev DB and is where the API connects in P3 — sequence them in a quiet window rather than assuming the lock is free.
- `display_name` does not participate in any seed foreign key; it is purely user-facing.

### Verification at the door

- `node scripts/run-migrations.js --dry-run` → pending: 019, 020 in order.
- `node scripts/run-migrations.js --test-db` → apply idempotent.
- `node scripts/run-migrations.js --test-db --check` → green.
- `npm run verify:replay -- --reference=test` → 0 drift at the 20-migration tail.
- `node scripts/test-db.js` → branch reachable, new columns present (`budget_floor`, `engine_version`, `strategy_key`, `display_name`, `slug`, `image_url`, `image_source`, `image_licence_note`).

### Definition of done

- `019_recommendation_pass_facts.sql` and `020_product_identity_and_media.sql` exist, CRLF, reviewed against `add-a-migration.md`, applied on the TEST branch, and replay-verified 0 drift.
- `name` untouched; `display_name` generated deterministically from the `Seed ` prefix; `slug` unique, deterministic, CHECKed; image fields nullable.
- `gen:schema` **not** run here.

---

## Sprint 4 — API read/wire + presenter + contract v1.1 + tests (60 min)

**Date:** 2026-10-14  
**Purpose:** make the read path and the presenter surface the new columns on both POST and GET, so the two verbs agree on persisted fields, the user sees human-readable names and slugs, and the contract moves to v1.1.

### Files to add or edit

**Add:**
- `apps/api/test/unit/openapi-v1.1.json` — committed snapshot of the OpenAPI document served at `/v1/docs/json` after the v1.1 change. Regenerate only when the contract is deliberately changed; the test pins it byte-for-byte.

**Edit:**
- `apps/api/src/repository.js` — `SELECT_QUERY_SQL` adds `budget_floor`; `SELECT_BUILDS_SQL` adds `r.engine_version`, `r.strategy_key`, `p.slug`, and `COALESCE(p.display_name, p.name) AS product_name`.
- `apps/api/src/routes/recommendations.js` — presenter: `budget_floor` and `engine_version` now come from the persisted row on both verbs (the two-field-difference table in `docs/API.md` collapses to "differs in no persisted field" except `served_by`); per-build `engine_version`, `strategy_key`, and `components[].slug` added; lazy guard asserting no `components[].name` starts with `Seed `.
- `apps/api/src/contracts/recommendations.js` — TypeBox response schemas updated for `budget_floor`, `engine_version`, `strategy_key`, `components[].slug`.
- `apps/api/test/unit/contract.test.js` — updated for the new fields.
- `docs/API.md` — v1.1 deltas: new fields persisted, the "POST and GET differ in no persisted field" table, the reconcile note for the two latency figures (75/142 ms vs 74/147 ms), any new limitations surfaced; **and the §Production-mode role SCRIPT itself, not just prose about it** — it gains `GRANT UPDATE (budget_floor) ON recommendation_query` and `GRANT UPDATE (engine_version, strategy_key) ON recommendation_result`, and its `has_table_privilege` / `has_column_privilege` self-check lines gain the three column assertions (the table-level UPDATE answers stay `f`). A prose note alone would leave the script pinning a role that cannot run the new writer.
- `apps/api/src/server.js` — OpenAPI `info.version` to `1.1.0` (path via `@fastify/swagger`'s `openapi.info`; confirm the exact path during the sprint and pin it).

### Read-path change details

- `SELECT_QUERY_SQL`: `SELECT id, budget_amount, currency, use_case, created_at, budget_floor FROM recommendation_query WHERE id = $1`.
- `SELECT_BUILDS_SQL`: existing query plus `r.engine_version, r.strategy_key`, and the component SELECT now reads `p.slug, COALESCE(p.display_name, p.name) AS product_name`.
- The presenter maps `row.budget_floor` through `JSON.parse` with a null-safe fallback; `row.engine_version` and `row.strategy_key` are text or null; `row.slug` is text or null; `row.product_name` already reflects `COALESCE`.
- The lazy guard: iterate `components` and assert no `name` starts with `Seed `; if one does, fail the test with the offending component and the product id, so the 020 backfill or the presenter's `COALESCE` is proved, not inspected.

### Why these tests are the right ones

1. Fake `readRecommendationResult` with new columns: returns `budget_floor` as a JSONB object, `engine_version`/`strategy_key` as text, and every component's `name` from `display_name` when present (so the presenter's `COALESCE` is exercised, not the `name` column).
2. An **empty pass** POST returns a 200 with a non-null `budget_floor` and the right per-component fields; GET returns the identical payload (the A1/A3 gap is closed to a test).
3. A **post-state parity** test on the branch: a real GAMING pass with builds, POST and GET read back byte-identical persisted fields; re-run twice, third read-back matches the first (idempotency, and the single-read-path design enforced by measurement).
4. A **slug/uniqueness** test on the branch: a product inserted with a colliding slug either suffixes or is rejected by the CHECK/unique index; the row-level behaviour is pinned against the live schema, not only the generated doc.
5. A **no-Seed-guard** test: any component whose name starts with `Seed ` fails the applicable test with the offending product, so the 020 backfill is proved rather than inspected.

### OpenAPI snapshot test

- A committed `openapi-v1.1.json` is compared byte-for-byte to the document served at `/v1/docs/json`; the test fails if the served document differs. Regenerate the snapshot only when the contract is deliberately changed.
- This is the simple version of the P2 "contract v1.1" item; the rest of P2 stays planned.

### Verification at the door

- `node --test "apps/api/test/unit/*.test.js"` on its own exit; no pager.
- `node --test "apps/api/test/db/*.db.test.js"` on its own exit (branch DB; residue 0).
- `npm run test:api:db` (residue 0) confirms the full read path on the branch.
- `node scripts/run-migrations.js --test-db --check` still green.
- `npm run test:unit` and `npm run test:scripts` still 0 fail.
- `npm run verify:docs --offline` to confirm `verify-docs` still passes given the migration-count change (the recipe's verify list includes it).

### Definition of done

- `repository.js`, `recommendations.js`, `contracts/recommendations.js`, `contract.test.js`, `server.js`, `docs/API.md`, and the OpenAPI snapshot are updated for v1.1.
- The read path surface the new columns on both verbs.
- No `components[].name` starts with `Seed ` (backfill or presenter proved by test).
- POST and GET read back byte-identical persisted fields for a real pass on the branch (parity + idempotency).
- `test:api`, `test:api:db`, `test:unit` all 0 fail.

---

## Sprint 5 — shared-apply gate, generated-doc refresh, and P1–P4 carried-as-planned review (60 min)

**Date:** 2026-10-14  
**Purpose:** close the shared-apply-mode decision, refresh generated docs if a shared apply happened, correct stale migration-version language, and record the P1–P4 carryover as cascade notes rather than absorbed-invisible work.

### Shared-apply-mode decision (owner-gated; decide and record)

Choose one:

- **(a) Defer to owner.** Record in `docs/briefs/requests.md`: `019_recommendation_pass_facts.sql` and `020_product_identity_and_media.sql` are finalized, reviewed against the recipe, and applied on the TEST branch; a shared apply is a separate operator step that needs a recorded Neon restore point from the owner; no shared apply in this session. This is the lean path.
- **(b) Apply with a restore point.** Once the owner hands a restore-point id matching `^[A-Za-z0-9_-]{8,}$`, run `node scripts/run-migrations.js --test-db --restore-point=<id>` for the shared DB... actually the shared apply runs as `node scripts/run-migrations.js --restore-point=<id>` against the shared `DATABASE_URL`, not `--test-db`. After it, commit the apply line to `database/migration-applies.jsonl` and run the generated-doc + replay stack. **Only the owner of the Neon restore point can make this decision.**

If (a): sprint's DDL is finalized, reviewed, and committed as a coherent pair.  
If (b): after shared apply, run `npm run gen:schema`, `npm run verify:docs --offline`, `npm run verify:docs --live` (digest gate now reflects the columns), `npm run verify:replay -- --reference=test` (0 drift on the branch after a fresh 20-migration replay), `node scripts/run-migrations.js --test-db --check` green.

### Stale-language sweep

Run a targeted grep:
`grep -rn "migration 019\|019 does not exist\|ends at 018\|current migration" --include="*.md" --include="*.js" .`

Expected stale pointers: `CONTEXT.md`, `docs/API.md`, `src/recommendation/ranking/select-archetypes.js:L34`, `src/recommendation/orchestrator/full-run.js:L71`. Refresh each so none asserts "019 does not exist" or "current migration 018" after the apply. Do not retro-edit old banners in `DOCUMENTATION_AUDIT_2026-09-28.md`; mark supersession in the newer one if needed.

### P1–P4 carried-as-planned review (recorded, not absorbed)

Record in `docs/OPEN_GAPS.md` as cascade notes:

- P1 step 3 (loader batching) is engine-owned; file as a request + Decision + `catalog_version` check; attempt only if steps 1–2 miss the target.
- P1 step 1 (region/topology move) is an operator action, not a code change; the latency target stays a hypothesis to re-derive after step 1.
- P1 step 4 (dedupe) + step 5 (presets) depend on a canonical key and a `catalog_version` concept that does not exist; build after the key is designed.
- P2 catalog endpoints, trustProxy config, the rest of the OpenAPI snapshot+test, and the `meta.js` listUseCases swap (OG-38) are still planned except the snapshot test folded into Sprint 4.
- P3 ops, CI `test:api:db` verification, role rehearsal, error tracking, staging+prod, migration-deploy step are operator/owner work.
- P4 real data, the missing non-seed provenance gate (a real gap — `check-offer-freshness.js` only counts by provenance class), Decision 7 amendment, seed retirement per PIPELINE_DESIGN §7, and the read-path `ACTIVE` audit are blocked on H2 and recorded as still-planned.

### Tests (corroboration, not gates, unless the code under them changed)

1. After shared apply (if it happened): no orphan `TestCompat*` or `TestL4%` rows; `check-deferred-rules.js` 0 violations; `check-offer-freshness.js --fail-days=14` green; `verify:pi1` PASS on the paired re-run; golden harness (`npm run eval:scenarios`) exits 0 at the v1 pin and at `launch-v2@1.1.0`.
2. Replay corroboration: `npm run verify:replay -- --reference=test` 0 drift on the branch after a fresh replay of all 20 migrations (019 and 020 now included), so the ledger tail is exactly the committed tail.
3. Post-state parity on the branch for a shared-state recommendation: GET reads back exactly what POST persisted, including `budget_floor` (nested JSONB), `engine_version`, `strategy_key`, and `slug` per component.
4. No-regression gates if the code changed: `npm run test:unit` 0 fail, `npm run test:scripts` 0 fail, `npm run test:api` 0 fail, `npm run test:api:db` 1/0 with residue 0, `node scripts/test-db.js` reachable.

### Verification at the door (whichever apply mode)

- `npm run gen:schema` → `npm run verify:docs --offline` → `npm run verify:docs --live` (digest gate) → `npm run verify:replay -- --reference=test` → `node scripts/run-migrations.js --test-db --check` → `npm run test:unit` → `npm run test:scripts` → `npm run test:api` → on branch: `npm run test:api:db` (residue 0) and `node scripts/test-db.js`. Each captured on its own exit, not filtered.
- `check-deferred-rules`, `check-offer-freshness`, `verify:pi1`, golden harness run as corroboration.
- `npm run gen:decisions --check` clean after Decision 46 is committed (global=44 / Status=50).
- `AGENTS.md` §4 range refreshed; `migrations-range-documented` passes.

### Definition of done

- The shared-apply-mode decision is recorded with its rationale; either path is fully validated (defer-to-owner with a recorded note, or apply + generated-doc + replay).
- Stale "019 does not exist" / "current migration 018" pointers are gone from the targeted grep sweep.
- P1–P4 carryover is explicitly recorded as still-planned (not absorbed).
- No regression: `test:unit` 0 fail, `test:scripts` 0 fail, `test:api` 0 fail, `test:api:db` 1/0 residue 0, `verify:replay` 0 drift, `verify:pi1` PASS on paired re-run, `check-deferred-rules` 0 violations, `check-offer-freshness --fail-days=14` green, golden harness exits 0 at both pins.

---

## Test scenarios summary (the whole plan's safety net)

1. **Migration correctness** — `run-migrations.js --dry-run` lists 019 then 020 in order; branch apply idempotent; `verify:replay` 0 drift at the 20-migration tail; `--check` green.
2. **Pass-facts writer** — fake client with `passFacts` emits the two parameterized UPDATEs in order (floor first, then one per rank with `rank = index + 1`); the writer mints no ids (UPDATE-only), so the assertion is on the parameter tuples and the statement counts, not on a returned id list; `undefined` ⇒ zero statements; a malformed client or a `strategyKeys`/`selected` length mismatch rejects fast with zero statements; a re-run replaces, never duplicates.
3. **Full-run seam** — fake full-run threads a real `passFacts` and the writer writes `budget_floor` / `engine_version` / `strategy_key` onto the right rows; empty pass records the floor on the query row if the pass computed one.
4. **Read-path parity** — fake `readRecommendationResult` with new columns returns the expected nested `budget_floor`, text `engine_version`/`strategy_key`, and `display_name`-precedence for `name`; no component name starts with `Seed `.
5. **Contract + API contract** — TypeBox schema updated; contract unit test pinned; OpenAPI snapshot equals a committed document; `/v1/docs/json` serves it.
6. **Branch + DB end-to-end** — a real zero-build GAMING@10000 MAD POST returns 200 with a non-null persisted `budget_floor` and the right per-component fields; a subsequent GET returns byte-identical persisted values; a normal GAMING pass with builds reads back the same values across two independent calls (idempotency).
7. **No-regression gates** — `test:unit`, `test:scripts`, `test:api`, `test:api:db` (residue 0), `verify:replay`, `verify:pi1` (paired), `check-deferred-rules`, `check-offer-freshness --fail-days=14`, golden harness at both pins; all on the branch, exit status captured each.

---

## How to run this safely on the agent/platforms branch

- `git status` first (shared checkout; `agent/platforms` is identical to `origin/master` at `c8c16b9`).
- Sprint 1–2: no schema, no DB; work against the engine seam with fake clients; the commit/full-run suites are unit-only and already pinned. Keep the 3/4-arg call sites untouched.
- Sprint 3: create the two migration files, run `run-migrations.js --dry-run` for order, then branch-apply with `run-migrations.js --test-db`. Do **not** run `gen:schema` here.
- Sprint 4: wire the read path, run the fake-read-path tests + contract test, then branch-state parity with `npm run test:api` (DB-free) and a real `test:api:db` parity proof on the branch (residual cleanup asserted).
- Sprint 5: make the shared-apply-mode decision, record it, and if shared apply happens, run the full generated-doc + replay + verify stack. If shared apply is deferred, the DoD is "finalized + reviewed + recorded", and the remaining cascade notes land in `OPEN_GAPS.md`.

---

## Definition of done (whole plan)

The plan is done when:

1. `019_recommendation_pass_facts.sql` and `020_product_identity_and_media.sql` are committed, reviewed against `add-a-migration.md`, applied on the TEST branch, and replay-verified 0 drift at the 20-migration tail.
2. The pass-facts seam is real: `full-run.js` threads a live `passFacts` to the commit, the new writer persists `budget_floor` on `recommendation_query` and `engine_version` / `strategy_key` on `recommendation_result`, with a column-scoped GRANT decided for each of those three columns, and an undefined pass-facts call issues no statements.
3. `name` is untouched, `display_name` is generated deterministically from the `Seed ` prefix, `slug` is unique and deterministic with its own CHECK, and the API's read and write paths both surface them — so the `Seed ` tokens no longer reach end users through `components[].name`.
4. The contract is v1.1 in `docs/API.md` and pinned by a committed OpenAPI snapshot test.
5. The larger P1–P4 items are explicitly recorded as still-planned (engine-owned loader batching, topology move, real-data gate, ops) so nothing is silently absorbed into "done".
6. No regression on the suite that matters: `test:unit` 0 fail, `test:scripts` 0 fail, `test:api` 0 fail, `test:api:db` 1/0 with residue 0, `verify:replay` 0 drift, `verify:pi1` PASS on paired re-run, `check-deferred-rules` 0 violations, `check-offer-freshness --fail-days=14` green, golden harness exits 0 at the v1 pin and at `launch-v2@1.1.0`.

---

## Review corrections applied 2026-10-14 (adversarial review after Sprint 1)

An adversarial pass over this plan against the working tree found defects that would have blocked or silently mis-driven the sprints. The corrections are applied above; this section records them, so a later reader can tell a correction from the original text.

**Corrected in place:**

1. **Error-code vocabulary.** `CANDIDATE_SELECTION_ERROR` is not a member of `ERROR_CODES`. The vocabulary is `INVALID_INPUT | MISSING_REQUIRED_FIELD | INVALID_FIELD_VALUE | INVALID_COMPONENT_ROLE | ROLE_CATEGORY_MISMATCH | INVALID_CANDIDATE | EMPTY_CANDIDATE_POOL | CANONICAL_CATEGORY_AMBIGUITY | SCORING_MODEL_UNAVAILABLE`, carried by the class `CandidateSelectionError`. Sprint 1 now names `ERROR_CODES.INVALID_FIELD_VALUE` / field `passFacts` for a null passFacts and `ERROR_CODES.INVALID_INPUT` / field `client` for a malformed client.
2. **The INSERT-era assertions.** Sprint 1's test 1 and the "returned ids" bullet were written for a writer that INSERTs. This writer is UPDATE-only by design, so it mints no ids; the plan now pins the parameter tuples and the statement counts instead.
3. **The exact-import pin.** `commit.test.js`'s `commit.js imports exactly the error vocabulary and the writer modules` deep-equals the sorted `require` list, so the new `persist-pass-facts` require in `commit.js` fails the suite until the pin gains it. Added to Sprint 1's edit list and its Definition of done.
4. **Governance grants.** The plan granted only `budget_floor`. The documented `morocco_pc_api` role has no UPDATE anywhere, so the two `recommendation_result` UPDATEs would fail `42501` in production mode. Sprint 2 now grants `UPDATE (engine_version, strategy_key)` too, and Sprint 4 updates `docs/API.md`'s §Production-mode role SCRIPT and its `has_column_privilege` self-checks rather than only adding a prose note.
5. **The migration-020 slug hazard.** The `row_number()` suffix is not collision-free across bases, and a collision aborts the whole file at `CREATE UNIQUE INDEX`. Sprint 3's note now says so, records the measured baseline (104 products / 104 distinct slugs / 0 collisions, read-only, 2026-10-14), and names the mitigations. The dead second `lower()` pass and the ACCESS EXCLUSIVE lock note live in the same section.

**Recorded but deliberately NOT resolved here — these change a sprint's shape and need a decision, not an edit:**

- **Sprint 2 has no engine-version source.** There is no engine-owned version constant in `src/` (`grep -rn "ENGINE_VERSION" src/` returns nothing); the only engine version is the API's `env.ENGINE_VERSION` (`apps/api/src/app.js:95`), which Sprint 2 explicitly rules out. Sprint 2 must therefore DECIDE: add an engine-owned constant (with its own decision note and a bump discipline), or accept an explicit API → `options` handoff. The Sprint 1 writer makes `passFacts.engineVersion` a REQUIRED key (null when unknown), so this sits on the critical path.
- **`strategy_key` DOES survive `explainSelection`.** `explanation/explain.js`'s `composeExplanation` returns `{ ...entry, explanation }`, so the explained array — the very array the commit receives as `selected` — already carries `strategy_key` and `persisted_rank` verbatim. The separate `passFacts.strategyKeys` array is therefore a SECOND source of truth for data already present on `selected`. Sprint 1 kept the planned shape and added a length cross-check, but the simpler design (read `selected[i].strategy_key` in the writer) removes the desync class entirely and is worth choosing deliberately in Sprint 2.
- **Plan line references are approximate.** The line numbers in the header's "Database reality" line (`commit.js:118`, `full-run.js:104`) do not point at the commit seam; the call sites moved as Engines 4–6 landed. Cite symbols, not line numbers, in later revisions.

**Verified correct and left alone:** `scripts/verify-docs.js:107` really pins `global === 43 && nested === 5 && status === 49`, so "adding Decision 46 means `global=44` / `Status=50`" is right (AGENTS.md §10's "42/48" is the stale line); `product` 9 / `recommendation_query` 9 / `recommendation_result` 6 columns; migrations end at `018`, seeds at `016`; and `uq_recommendation_result_query_rank (recommendation_query_id, rank)` exists in migration 011, which is what makes the writer's `AND rank = $4` match hit at most one row.
