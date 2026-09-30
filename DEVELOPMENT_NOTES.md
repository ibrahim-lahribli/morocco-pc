# Development Notes

Operational knowledge base for `morocco-pc`. Purpose: capture verified workflows, failure modes, and lessons so future agents avoid repeating investigations.

- `CONTEXT.md` = what the project is and how it is designed.
- `DEVELOPMENT_NOTES.md` = what has been learned while developing it and how to avoid previous mistakes.

## ENVIRONMENT

- Node.js project. Dependencies: `pg` (PostgreSQL client), `dotenv`. Node's built-in test runner for unit tests. No local PostgreSQL required.
- Database: PostgreSQL on **Neon** (cloud). Single shared development database; not disposable.
- Connection: `DATABASE_URL` from `.env`. `.env.example` contains the key name only, never a real value.
- Scripts bootstrap with `require('dotenv').config()` and exit immediately when `DATABASE_URL` is missing.
- Migration execution: `node scripts/run-migrations.js` applies `database/migrations/*.sql` in sorted filename order, then prints tables / foreign keys / enums / a UUID check. **The runner is not re-runnable against an already-migrated database** (see failure modes).
- Test execution:
  - `npm run test:db` — connection + `public` table listing (`scripts/test-db.js`).
  - `npm run test:unit` — engine unit tests (`node --test "src/**/*.test.js"`).
  - Targeted DB scripts run directly with `node scripts/<name>.js` (see VERIFIED COMMANDS).

## VERIFIED COMMANDS

Commands verified to work in this repository/environment:

| Command | What it does | Re-run safe |
|---|---|---|
| `npm run test:db` | DB connection + table listing | yes |
| `node scripts/run-migrations.js` | applies all migrations + verification | only on a fresh DB — see failure modes |
| `node scripts/test-compatibility.js` | Layer 1 compatibility/provenance constraints (fixture-based) | yes (47/47) |
| `node scripts/verify-hardware-schema.js` | hardware schema tables/constraints | no — BROKEN, see TESTING LESSONS 2026-09-19 bullet |
| `node scripts/test-layer3.js --verify --functional` | Layer 3 canonical schema functional tests (requires ALL THREE Layer 3 tables empty; bare run = preflight only) | only with flags + empty Layer 3 tables — **BLOCKED 2026-09-28** (store=2 / store_offer=101 / price_history=101 on shared DB *and* on the TEST branch; preflight fails before any write) |
| `node scripts/test-layer4.js` | Layer 4 canonical schema functional/integration tests (single transaction + SAVEPOINTs + final ROLLBACK); does NOT require empty Layer 4 tables; targets DATABASE_URL, not yet migrated to the TEST_DATABASE_URL guard | yes (transactional rollback; unguarded, runs on DATABASE_URL) |
| `node scripts/verify-schema.js` | columns/types for core tables | yes |
| `node scripts/verify-constraints.js` | indexes / primary keys | yes |
| `node scripts/verify-fks.js` | foreign keys | yes |
| `npm run test:unit` | recommendation engine unit tests (`src/recommendation/**`) | yes |
| `npm run seed` | applies `database/seeds/*.sql` in order (DML-only, idempotent) | yes (WHERE NOT EXISTS guards; fixed AND/OR precedence 2026-09-19) |
| `node scripts/run-seeds.js --dry-run` | reports seed statement counts without executing | yes |
| `git status`, `git diff`, `git log --oneline`, `git remote -v`, `git mv` | repo inspection / rename | — |

Note: commit and push commands were NOT executed in this session (the documentation task explicitly forbade them), so they are not listed as verified. UPDATE 2026-09-28: superseded — commits and pushes have since been exercised repeatedly on `master`. Deliberately no hash list here: an enumerated set of pushed/unpushed commits goes stale on the next push (the first such list was already wrong the same day it was written), so read the live state from `git status` / `git --no-pager log origin/master..HEAD`; see GIT LESSONS.

## KNOWN WORKING TOOLS

### Applying a new migration to the shared Neon database

#### Problem

`scripts/run-migrations.js` re-executes the full sequence every time with no applied-migrations tracking, and `002_enums.sql` uses a bare `CREATE TYPE`. Re-running the full sequence against the already-migrated Neon DB aborts at `type "product_category" already exists`.

#### Failure

The full-sequence runner cannot be used twice against the live database.

#### Working solution

1. Create the new `NNN_*.sql` migration in `database/migrations/`.
2. Apply ONLY that file with a one-off temp script (`pg.Client` + `fs.readFileSync`), run it, verify with read-only catalog queries, then delete the temp script.
3. Confirm idempotency by applying the new file a second time when its safety gate allows (this is exactly how 011 was applied).

#### Rule for future agents

Never re-run the full runner on the live DB. Apply new migration files individually and delete the one-off script afterwards.

### Live-database inspection before corrective migrations

#### Problem

The live Neon DB has drifted from the migrations before (undocumented Layer 3 and Layer 4 implementations).

#### Failure

Assuming the live DB matches the migration files leads to corrective migrations that do not apply or silently alter unintended objects.

#### Working solution

Inspect the live catalogs first with read-only queries and scripts: `node scripts/test-db.js`, `verify-schema.js`, `verify-constraints.js`, `verify-fks.js`, and one-off read-only SELECTs over `information_schema` / `pg_type`.

#### Rule for future agents

Never assume the live DB contains only the objects in Git migrations. Inspect tables, columns, enums, constraints, indexes, and row counts before planning schema work.

### Git operations

#### Working solution

- Working branch: `master`. Remote `origin` = https://github.com/ibrahim-lahribli/morocco-pc.git.
- Renaming a tracked file preserves history: `git mv <old> <new>` (used this session for `PROJECT_CONTEXT.md` → `CONTEXT.md`).
- Commit history uses conventional prefixes (feat, fix, docs, test) per `git log --oneline`.
- Change review: `git status --porcelain`, `git diff`.

#### Common failures

- None recorded this session. Historical (2026-09-18): untracked `.kilo/kilo.jsonc` observed (tool config — keep out of commits). UPDATE 2026-09-28: not present; `git status` is clean.

#### Rule for future agents

Stage only intended files; never stage `.env` or `node_modules`. Do not commit or push during documentation-only tasks unless instructed.

## IMPORTANT FAILURE MODES

Deduplicated historical lessons. Each entry records the problem, what failed, the working solution, and the rule for future agents.

### Migration numbering conflict (2026-09-11)

Problem: two migration files shared the same numeric prefix (a duplicate number was introduced), making filename-sort ordering ambiguous.

Failure: ordering was no longer deterministic; `005` and `006` prefixes collided.

Working solution: renamed `005_compatibility_tables.sql` → `006_compatibility_tables.sql` and `006_provenance_tables.sql` → `007_provenance_tables.sql`, and updated internal references.

Rule: always use padded sequential numbering (001, 002, …) and never reuse a number. Fix a conflict by renaming the affected files and updating references — never by inserting a new number mid-sequence.

### Hardware schema corrections after 004 (2026-09-11)

Problem: migration 004 introduced fields that were later removed or changed (inferred GPU fields, incorrect column types).

Failure: the initial hardware migration disagreed with the decided architecture.

Working solution: migration 004 was updated to the corrected schema for fresh databases, and a corrective `005_hardware_schema_corrections.sql` was added for the existing database using `IF EXISTS` / `IF NOT EXISTS` and safe casts — no data loss.

Rule: after a migration has been applied to a shared environment, add a corrective migration rather than rewriting history. Keep corrective SQL defensively idempotent for fresh and existing databases.

### test-compatibility.js cleanup ordering (2026-09-11, pre-existing)

Problem: re-runs failed with `ERROR: update or delete on table "product" violates foreign key constraint "motherboard_spec_product_id_fkey"`.

Cause: cleanup deleted `TestCompat%` products before the one-to-one spec rows, `component_assessment`, `benchmark_result`, `store_offer`/`price_history`, `product_variant`/`gpu_board_spec`, and seeded reference rows that FK-reference them; a leftover `memory_type 'TestDDR5Compat'` also blocked re-seeding.

Working solution: dependency-safe cleanup order — junction/compat rows → one-to-one spec rows → Layer 2/3 dependents → provenance/candidate/alias → `product` → reference rows (`product_family`, `chipset`, `socket`, `memory_type`, `manufacturer`). The test now passes 47/47 and is re-runnable.

Rule: when adding fixtures, add matching cleanup in dependency-safe order. Never delete `product` before its FK dependents.

### No fresh-migration verification (standing limitation)

Problem: a fresh 001→011 migration test requires an empty, isolated PostgreSQL database. A `TEST_DATABASE_URL` Neon branch has existed since 2026-09-21, but it snapshots parent data, so it is NOT an empty-DB migration test (no local `psql`, no Docker, no empty scratch DB).

Failure: `run-migrations.js` full re-run on the already-migrated DB aborts at `002_enums.sql` (bare `CREATE TYPE`, not idempotent).

Working solution: none yet. Layer 3 and Layer 4 reconciliations (010/011) were applied in place after confirming the target tables had 0 rows.

Rule: report fresh-migration as NOT VERIFIED / BLOCKED until run on an empty database (a Neon branch copy does not qualify — see the 2026-09-21 entry). Do not fake a fresh-migration result against the shared Neon DB or the branch. (Corrected 2026-09-28, audit D9: the pre-2026-09-21 reason "no isolated database exists at all" was wrong from 2026-09-21 onward; only the run itself is outstanding.)

### Isolated test DB via Neon branch (2026-09-21)

Purpose: the shared Neon DB is not disposable, and Engine 5 will be the first code that writes to Layer 4, so write-capable tests must target an isolated Neon branch — never the shared DB.

Working solution: `TEST_DATABASE_URL` (key only in `.env.example`, never a value) + `scripts/lib/db-url.js` guard (`resolveTestDbUrl(env)` pure + `getWriteTestDbUrl()` dotenv wrapper; `connectionTimeoutMillis: 15000` convention kept). The guard THROWS when `TEST_DATABASE_URL` is unset, empty, or unparseable, when `DATABASE_URL` is unset, or when the normalized hosts match (lowercased host, `-pooler` suffix stripped from the first label, so pooled-vs-direct same endpoint is rejected); error messages are fixed strings that never include any URL, credential, or host value. Existing scripts keep reading `DATABASE_URL` unchanged. Guard tests: `node --test scripts/lib/db-url.test.js` (not part of `npm run test:unit`).

Rule: all Engine 5 write tests must use the guard helper. A Neon branch copies current state (snapshots the parent at creation), so it is NOT a fresh-migration test — if seeds or migrations change on the parent later, test-scratch drifts and must be reset from the parent before write tests. Fresh 001→011 migration stays reported as NOT VERIFIED unless run on an empty database.

### Neon connection intermittency

Problem: Neon is a shared cloud service; connections can stall or be slow.

Failure: scripts without a timeout can hang; intermittent connectivity was observed during development.

Working solution: DB scripts set an explicit connection timeout — e.g. `connectionTimeoutMillis: 15000` in `scripts/test-layer3.js`. Prefer short-lived connections and read-only catalog queries for inspection.

Rule: always set explicit timeouts in DB scripts; never assume a long-lived connection.

### Layer 3 schema drift (2026-09-11)

Problem: live `store` / `store_offer` / `price_history` did not match migration 009 — a pre-existing, undocumented earlier implementation with different CHECK constraints, nullable NOT-NULL columns, extra indexes, and an old offer-level unique constraint.

Working solution: all three tables had 0 rows, so migration 010 reconciled in place (naive timestamps → `TIMESTAMPTZ`, canonical checks, removed `uq_store_offer_store_product_variant`, canonical indexes).

Rule: migration 009 is the authoritative fresh-DB Layer 3 schema; post-009 changes need new corrective migrations. Multiple offers per store/product/variant are legitimate — do not reintroduce offer-level uniqueness.

### Minimal seed set (2026-09-19)

Working solution: `database/seeds/001_minimal_builds.sql` (15 products; 2 variants — 1 GPU product x 2 variants; 16 offers; 25 assessments; 1 scoring_model `seed-minimal-v1/1.0.0`: 2 CPUs incl. one iGPU for the OPTIONAL path, 2 MB/RAM/SSD/PSU/case/cooler) + `scoring_model seed-minimal-v1/1.0.0` with the complete Decision 3(a) JSONB + `scripts/run-seeds.js` (`npm run seed`, `--dry-run`), verified: re-run safe, live `verify-schema.js` shows no `product_variant.overrides` column (CONTEXT.md overrides note corrected 2026-09-21), one-off E2E (temp script, deleted) ran Engine 1→2→3→4 live: GAMING and OFFICE both yield 25 capped builds with PASS+UNKNOWN verdicts and finite scores.

Rule: seeds are DML-only, idempotent `INSERT ... WHERE NOT EXISTS` on natural keys, `Seed %`/`SEED-` prefixed, applied via `run-seeds.js` — never through `run-migrations.js`. Layer-4 tables stay empty (Engine 5 future). `product_variant.overrides` doc-drift RESOLVED 2026-09-21 (CONTEXT.md corrected; column does not exist).

### Layer 4 schema drift (2026-09-12)

Problem: the live DB already contained the five Layer 4 tables plus a `component_role` enum — undocumented, empty, and with defects vs the agreed architecture (naive timestamps, nullable `scoring_model_id`, redundant `build_component.category`, `>= 0` price checks, missing uniqueness on ranks/roles).

Working solution: `011_reconcile_layer4.sql` (dual-mode: fresh-create vs 0-row reconcile, with a safety gate) applied and re-applied to confirm idempotency, then verified with read-only catalog queries. Full details: `database/LAYER4_RECONCILIATION_PLAN.md`.

Rule: migration 011 is the canonical Layer 4 schema — do not create Layer 4 tables from scratch. `scripts/test-layer4.js` exercises the canonical schema (single transaction, SAVEPOINTs, rollback).

### run-migrations.js non-idempotency (tool limitation)

Problem: the runner re-executes every file with no applied-migrations tracking; `002_enums.sql` uses a bare `CREATE TYPE`.

Failure: a second full run against the live DB aborts; new migrations (010, 011) had to bypass the runner.

Working solution: apply new migration files individually through a one-off temp script, then delete it (011 was additionally re-applied to confirm idempotency).

Rule: treat the runner as safe only for the first run on a fresh database; otherwise apply files individually.

### Timestamp double-conversion pitfall (migration 011)

Problem: `ALTER COLUMN ... TYPE TIMESTAMPTZ USING col AT TIME ZONE 'UTC'` is only safe for `timestamp without time zone`. If the column is already `TIMESTAMPTZ`, `AT TIME ZONE 'UTC'` produces a naive timestamp that PostgreSQL re-interprets in the session timezone — shifting values on non-UTC sessions.

Working solution: 011 loops over `information_schema.columns` and converts ONLY columns still typed `timestamp without time zone`, so it is safe against both starting states.

Rule: guard timezone-conversion SQL by the starting column type; never assume a single starting state in corrective migrations.

### Documentation status drift (2026-09-18)

Problem: engine implementation commits landed without updating CONTEXT.md's status sections. Both `CONTEXT.md` and this file were last touched at `3131ab5` (feat(engine2c), 2026-09-12) while later commits (2026-09-14…18) implemented Engine 2D filtering, Stage 1 offer pre-selection (`offers/`), Engine 3 assembly Steps 1–4 + barrel (`assembly/`), and the Decision 11 scoring-model loader (`scoring/`) — leaving CURRENT STATUS / "Currently next" / "NOT implemented" stale for 6 days.

Failure: any agent trusting CONTEXT.md's "NOT implemented (Engines 3–6)" would re-implement existing modules or mis-plan follow-up work.

Rule: update CONTEXT.md's status sections in the same session/commit that lands engine code; never trust status sections without cross-checking `git log -1 -- src/recommendation/<module>` dates first.

## DATABASE LESSONS

- The shared Neon database is **not a disposable test database** — never reset, drop, or restore it.
- Never use destructive reset operations (DROP / TRUNCATE / restore) for testing.
- Use a transaction for fixture-based functional tests and roll back fixtures — see `scripts/test-layer4.js` (single transaction + SAVEPOINTs + explicit reverse-dependency cleanup + final ROLLBACK). Fixture tests that do not use transactions (`test-compatibility.js`, `verify-hardware-schema.js`) must delete their fixtures explicitly in dependency-safe order.
- Roll back or delete test fixtures so tests stay re-runnable.
- Use connection timeouts in scripts (Neon intermittency).
- Distinguish schema drift from migration history: the live DB has drifted before (Layers 3 and 4) while the migrations became authoritative for fresh databases.
- Inspect live metadata (tables, columns, enums, constraints, indexes, row counts) before creating corrective migrations.
- `NULL` means UNKNOWN; UNKNOWN never means PASS. Do not write migrations that blur this distinction.
- Never claim a fresh migration was verified unless it ran on an isolated empty database.

## TESTING LESSONS

- `npm run test:db` — connection + table listing. No fixtures. Safe to rerun.
- `node scripts/test-compatibility.js` — Layer 1 compatibility tables, partial unique indexes, provenance/data-quality rules. Uses and cleans `TestCompat%` fixtures. Safe to rerun (47/47). Do **not** use the `TestCompat%` prefix for real data.
- `node scripts/verify-hardware-schema.js` — hardware spec tables and CHECK constraints. BROKEN — not safe to re-run; see 2026-09-19 bullet below.
- `node scripts/test-layer3.js` — Layer 3 canonical schema (columns, CHECKs, indexes, enums). Requires all three Layer 3 tables to be empty (`store`, `store_offer`, `price_history`); transactional cleanup. Safe to rerun ONLY when they are empty — **cannot pass in either environment as of 2026-09-28** (2/101/101 rows on the shared DB and on the TEST branch); preflight fails cleanly before any write.
- `node scripts/test-layer4.js` — Layer 4 canonical schema (migration 011): 9-FK layout, CHECKs, uniqueness (ranks, component roles), `component_role` enum; fixture-based with final rollback; does NOT require empty Layer 4 tables. Safe to rerun. Unguarded — reads `DATABASE_URL`.
- **2026-09-30 — OG-13 CLOSED (fresh-migration verification, the U1/F13 residue):** ran the full `run-migrations.js` 001→011 replay on a throwaway Neon DB (user-supplied; emptied to 0 tables / 0 enums first via a one-off script, deleted after). All 11 migrations applied in order with zero errors. Structural diff vs live (tables/columns/enums/constraints/indexes): 39/39 tables, 336/336 columns, 14/14 enums identical. 15 diff lines, all live-has-more: 3 benchmark CHECKs stricter live (live drops the `IS NULL OR` escape on `sample_size`/`resolution_width`/`resolution_height`), `chk_benchmark_result_metric_value_finite` live-only, 5 live-only performance indexes (benchmark_source name UNIQUE + id, component_assessment product_id + type, scoring_model is_active) — none in any migration or doc; provenance unknown (pre-migration manual work or a lost migration). Lesson: the drift is in benchmark-table hardening, which no engine code reads — engine-relevant structures replay faithfully. Forward-tracked as OG-25 (migration 012 to reconcile vs document live-only provenance).
- **2026-09-28 — audit D8 (guard coverage + operational consequence):** only 3 scripts use the `TEST_DATABASE_URL` guard (`measure-orchestrator.js`, `test-orchestrator-commit.js`, `test-orchestrator-full-run.js`); 10 read `DATABASE_URL` unchanged (`run-migrations.js`, `run-seeds.js`, `test-compatibility.js`, `test-db.js`, `test-layer3.js`, `test-layer4.js`, and the 4 `verify-*.js`). Consequence: the documented `AGENTS.md` §6 command `node scripts/test-layer3.js --verify --functional` **cannot pass today** — its preflight asserts all three Layer 3 tables are empty and throws `STOP: Layer 3 tables contain rows` before any write (live counts 2026-09-28: store=2, store_offer=101, price_history=101). Pointing the script at `TEST_DATABASE_URL` does NOT help either: the branch was measured on 2026-09-28 to hold the same 2/101/101 rows (a Neon branch is a snapshot/reset of the parent, never an empty database). To actually run it, clear Layer 3 tables on the branch or use a fresh isolated DB. Also verified: `test-layer4.js` never asserts empty tables (it only logs counts and checks `TestL4%` leftovers).
- `npm run test:unit` — pure unit tests for `src/recommendation/**` (Engines 1–4 + retention/Stage 1/2D/assembly + ranking; 829 tests as of 2026-09-28); no database required.
- Engine 2C: `selectCandidatePool()` (`src/recommendation/candidates/select.js`) is the canonical pool selector; `pool.test.js` covers eligibility, variant-identity, dedup, global-only `EMPTY_CANDIDATE_POOL`, ordering, determinism, and non-responsibilities. Existing `candidates.test.js` fixtures updated to valid Engine 2B identities (GPU variants carry ids; non-GPU carry null).
- Environmental limitations: fresh 001→011 migration cannot be verified (branch exists via `TEST_DATABASE_URL` since 2026-09-21, but it snapshots parent data — only an empty-DB run qualifies; corrected 2026-09-28, audit D9); DB-backed scripts need network access to Neon and a configured `DATABASE_URL`.
- Fixture cleanup requirement: everything created must be removed/rolled back in reverse-dependency order; row counts return to baseline.
- 2026-09-19 session — Engine 4 (Decision 13 STEP 1-3) + Decision 15: `npm run test:unit` = 584 pass / 0 fail. Engine 4 scoring arithmetic now fully implemented: `load-assessments.js` (component_assessment loader), `effective-score.js` (STEP 1), `candidate-score.js` (STEP 2), `build-score.js` (STEP 3). Decision 15 resolved: UNKNOWN pairwise-count producer (Engine 2D verdict → Engine 3 build → Engine 4 batch fallback). Two items worth recording:

  - **NULL-score bug caught by tests (effective-score.js / STEP 1):** `component_assessment` has no unique constraint on `(product_id, assessment_type)`, so multiple rows per (product, type) are legal. Decision 13's formula treats a NULL-score row identically to a missing row (`effective = max(0, neutral_baseline - no_evidence_penalty)`). The adopted `selectAssessmentRow` policy ("newest assessed_at, id ASC tie-break wins", same pattern as Decision 8) means a newer NULL-score row **shadows** an older scored row — the formula's "the row's score column is NULL" branch reads exactly as the policy produces. Verified by existing test `A2: a newer NULL-score row shadows an older scored row (formula verbatim)` in `candidate-score.test.js` (P3: newest VALUE row has score null → VALUE effective 40, both branches agree). If the row-selection policy were ever changed (e.g. "pick the newest *scored* row, skip NULLs"), this test would break — it is the contract boundary for the NULL-as-missing semantics.

  - **Decision 15 producer/consumer split (ENGINE 2D → ENGINE 3 → ENGINE 4):** the UNKNOWN pairwise-count flows as a plain integer across three modules with no re-derivation. Engine 2D (`filtering/filter.js`) counts, per verdict, the pair records whose aggregated status resolved UNKNOWN and emits `unknown_pairwise_count` on the frozen verdict. Engine 3 (`assembly/assemble.js`) sums those counts per assembled build in the same EXPANSION_ORDER pass, emitting `unknown_pairwise_count` on the frozen build (GPU-omit path contributes 0). Engine 4 (`scoring/build-score.js`) makes `unknownPairwiseCounts` OPTIONAL in the batch form: an explicit injected array still wins; when absent, the count is read per build from `build.unknown_pairwise_count` (Decision 15 fallback), and a missing/invalid build count fails fast via the existing `MISSING_REQUIRED_FIELD` / `INVALID_FIELD_VALUE` vocabulary. The rejected alternatives (pair-identity lists carried through builds; per-build pair recomputation among chosen components) remain documented in Decision 15's "Rejected alternatives" — do not silently revive them. **Partially superseded (2026-09-21, Decision 16):** the per-build pair recomputation is now adopted for VALIDATION only — Engine 3's DFS gates branches on Engine 2D's own pair evaluators over picked combinations — while the count producer chain above is untouched (the DFS pairs are never counted into `unknown_pairwise_count`). **Superseded (2026-09-27, Decision 23 O2):** Engine 3 no longer sums the verdict counts — `finishPath` recomputes the count build-locally over the picked components (`countBuildLocalUnknownPairs`, each co-occurring pair once, absent partner → 0, verdict field never read); the verdict-level field is kept and validated but no longer consumed by scoring.
- 2026-09-18 reconciliation run (all verified live): `npm run test:unit` = 499 pass / 0 fail, covering Engine 1, Engine 2 (2A–2D), Stage 1 offers, Engine 3 assembly Steps 1–4, and the Decision 11 scoring-model loader + iGPU handoff (supersedes the "Engine 1–2C" scope note above). DB scripts: test-compatibility 47/47, verify-hardware-schema 31/31, test-layer4 67/67 (+ verified clean rollback), test-layer3 full mode PASS.
- `node scripts/test-layer3.js` is flag-gated: a bare run executes ONLY the preflight. Full coverage requires `node scripts/test-layer3.js --verify --functional` (verified 2026-09-18: Preflight / Metadata / Functional all PASS).
- Fixture leftovers observed (2026-09-18): the live DB still holds 20 fixture products (10 × `Test Product%`/`TEST-SKU-%`, 4 × `TestCompat%`, plus their manufacturers) — pre-existing rows from earlier runs, not created by that day's passing runs (each script deletes only its own run's fixtures; cause of the leftovers not investigated). Account for these when checking "row counts return to baseline". **RESOLVED (2026-09-19):** the 20 leftover fixture products were removed from the live DB by a guarded, transactional delete; 0 fixture products remain as of 2026-09-19, so the "row counts return to baseline" caveat no longer applies — the live-catalog baseline is now the seed set (`Seed %`/`SEED-` rows; see "Minimal seed set" above).
- 2026-09-19: `node scripts/verify-hardware-schema.js` is currently BROKEN against the seeded DB (not fixed in this session). Its startup cleanup step aborts with an FK violation when deleting the `memory_type 'DDR5'` row — the seed now owns that natural key via its `platform_memory_support` row (`Seed AMD AM5` ↔ `DDR5`) — and its setup recreates ~10 products / 8 variants with no final cleanup, so its fixtures accumulate across runs (self-polluting). Needs a fix before it can run again safely: rescope reference rows away from seed-owned natural keys, add a real end-of-run cleanup, add row-count output — supersedes the "Safe to rerun" note above and the VERIFIED COMMANDS table entry for this script until then.
- Engine-behavior flag (2026-09-19, recurring pattern — not resolved): Engine 2D's best-of-partner aggregation has now been observed twice masking pair-level FAIL/UNKNOWN at the relationship-status level — Engine 3 GPU-wiring session (UNKNOWN masked) and the 2026-09-19 session (two FAIL pairs masked: CPU↔MB exact-SKU override, GPU length). Worth a dedicated look at whether relationship-level status should ever surface "has at least one FAIL partner" alongside best-of, before Engine 5 ranking consumes these verdicts — flagged as a recurring pattern only; not resolved here. **RESOLVED for the assembly stage (2026-09-21, Decision 16):** Engine 3's DFS now re-checks picked combinations pairwise with Engine 2D's own evaluators and abandons branches whose pair aggregates to FAIL, so masked pair-level FAILs no longer reach assembled builds (UNKNOWN pairs stay eligible by contract). The verdict-level question itself stays open for Engine 5 separately.
- 2026-09-21 Decision 16 implementation pass (all verified live: `npm run test:unit` = 619 pass / 0 fail): Engine 3 pairwise branch validation. `filtering/filter.js` exports the 8 pair evaluators + `aggregateCompatibilityResults` + `FINAL_STATUSES` (re-exports; no barrel change — assemble.js consumes `../filtering/filter` directly, igpu-map precedent). The Engine 3 input contract is now TEN fields (`filtering_context`, validated top-level-shape-only, reference-preserved; pipeline.js passes its already-required `sources.filteringContext` through). `assemble.js` gates every tentative pick with a frozen per-role check table (MOTHERBOARD/RAM/PSU/CASE/CPU_COOLER; canonical arg order flipped only for `case_radiator`); a FAIL pair abandons the branch silently (no new output field, no log); GPU-omit paths evaluate no GPU pair; `unknown_pairwise_count` semantics unchanged. Test-surface updates: assemble.test.js boundary tests (dropped the `'filtering/'` needle; five allowed requires), 5 new unit tests + 1 end-to-end pipeline test reproducing the seeded CPU2×MB1 exact-SKU-FAIL shape (fixture extensions are pool-scoped, so no existing assertion changed); input.test.js / gpu-input.test.js fixture builders carry the new field.
- 2026-09-21 query/ loader implementation pass (all verified live: `npm run test:unit` = 636 pass / 0 fail, +17 new): `src/recommendation/query/` (`load-query-input.js`, `index.js` barrel, `load-query-input.test.js`). Real lesson: `validateScoringModelId` (load-scoring-model.js:76-91) checks non-empty string only — no UUID-shape check — so `validateQueryId` does the same by convention; a malformed (but non-empty-string) query id therefore reaches PostgreSQL as `$1`, which raises 22P02 (invalid text representation) and ABORTS the Decision 17.5 `REPEATABLE READ READ ONLY` snapshot transaction. Consequence: the future orchestrator wrapper (`runRecommendationSnapshot`) must ROLLBACK on ANY thrown error, not only on loader-mapped `CandidateSelectionError`s, or the connection is left in an aborted-transaction state. Same hazard already exists for `loadScoringModel`'s pinned id. Second lesson: whole-source substring boundary tests self-match the loader's own comments (e.g. a test banning `BEGIN` fails on the header's "NO BEGIN" sentence) — assert `require()` allow-lists plus SQL-constant/executed-query checks instead of raw source substring bans for documented policy words.
- 2026-09-22 Engine 5a ranking implementation pass (all verified live: `npm run test:unit` = 724 pass / 0 fail, +55 new): `src/recommendation/ranking/` (`rank.js`, `index.js` barrel, `rank.test.js`, `index.test.js`). Pure Decision 18 ranking: sort (rounded build_score DESC → rounded total_price ASC → signature ASC by code unit), G1 status gate, contiguous ranks, duplicate-signature fail-fast, `TOP_N_PERSISTED = 10`, `explanation: null`; `EXPANSION_ORDER` imported from the assembly public barrel. Two lessons worth recording:

  - **deepFreeze ordering pitfall (rank.js):** pre-freezing an array (or any container) BEFORE handing it to the private `deepFreeze` short-circuits the recursion — the `!Object.isFrozen(value)` guard skips the whole subtree, leaving the ELEMENTS unfrozen while the container reads as frozen (`Object.isFrozen(result.ranked)` true, `Object.isFrozen(result.ranked[0])` false). The fix: build the plain (unfrozen) arrays and let one `deepFreeze({ ranked, top_n })` walk children-first, freezing containers last. Caught by the "every ranked entry is deeply frozen" test; the same guard pattern exists in assemble.js/context-loader.js deepFreeze copies — never pre-freeze a container you expect deepFreeze to seal deeply.

  - **round2 shortest-decimal half-up (rank.js):** `Math.round(x * 100) / 100` is NOT half-up on the shortest decimal representation — `Math.round(1.005 * 100)` yields 100 (binary float: 1.005 stores as 1.00499999...), so 1.005 → 1.00 instead of the Decision 18.3-addendum-required 1.01. The string-exponent technique reads `String(x)`, shifts the decimal point two places right in the digits themselves, rounds the resulting integer on the first discarded digit (>= '5' rounds up), and scales back by /100 — 1.005 → "100"+"5" → 101 → 1.01, 2.675 → 2.68, 87.4949 → 87.49. Values whose `String()` form uses scientific notation fall back to the plain `Math.round(x * 100) / 100` guard per the recorded rule. Verified by dedicated round2 table tests.
- Engine-behavior flag (2026-09-20 — not fixed): retention/retain.js validates incoming verdicts as "object + eligible status" only, lighter than assembly/assemble.js's full 8-field validateVerdict(); currently safe — retention's only documented producer is filterCandidates' trusted frozen output — but a corrupt REJECT record would be silently dropped rather than fail-fasting if retention is ever called with an untrusted/hand-built filterResult; not fixed (would duplicate validateVerdict logic across two modules) — flagged for the future orchestrator to be aware of the trust boundary.

## GIT LESSONS

- Branch convention: work on `master` (the only branch in the repository).
- Change checking: `git status --porcelain`, `git diff`, `git log --oneline`.
- Renames preserve history: `git mv <old> <new>` (verified this session: `PROJECT_CONTEXT.md` → `CONTEXT.md`).
- Commit history uses conventional prefixes (feat, fix, docs, test) — keep that style.
- Commit/push: history shows commits on `master` pushed to `origin`. Historical (2026-09-18): the exact commit/push commands were NOT re-verified in that session (the task forbade committing). UPDATE 2026-09-28: superseded — commits and pushes have since been exercised repeatedly on `master`. No hash list is kept here (the first one went stale the same day it was written); check `git status` / `git --no-pager log origin/master..HEAD` for what is unpushed.
- Common failures: none recorded this session. Historical (2026-09-18): working-tree noise untracked `.kilo/kilo.jsonc` (tool config — keep out of commits). UPDATE 2026-09-28: not present; `git status` is clean.
- `.env`, `node_modules`, logs are gitignored; never force-add or expose them.
- Non-interactive/agent shells: plain `git log` / `git diff` open an interactive pager and can hang the session; use `git --no-pager log ...` / `git --no-pager diff ...` (verified 2026-09-18).

## DOCUMENTATION UPDATE RULE

At the end of every significant development session, update `DEVELOPMENT_NOTES.md` when you discover:

- a new failure
- a new working solution
- an environment limitation
- a database-specific issue
- a migration lesson
- a testing lesson
- a Git/tooling lesson

Do not record trivial events. Never store secrets. Never claim something was tested if it was not actually executed.
## 2026-09-23 — Decision 20 real measurement (measure-orchestrator.js first execution)

Seed: the minimal seed (`database/seeds/001_minimal_builds.sql`) — 15 products / 16 offers (preflight `{"products":15,"models":1,"offers":16,"assessments":25,"queries":0}`, seed scoring_model pinned by id, isolated test-scratch branch only; measurement queries inserted then deleted, `recommendation_query back to 0 rows`).

Fix: `scripts/measure-orchestrator.js` local duplicate `rankBuilds` removed; script now imports the real `rankBuilds` from `src/recommendation/ranking/` (Decision 18) and calls `rankBuilds({ builds }).ranked[0]` for the rank-1 lines (real `ROLE:product_id:variant` signatures incl. the `GPU::` omitted slot).
Raw output of `node scripts/measure-orchestrator.js` (query ids redacted — per-run UUIDs; every number verbatim, unrounded):

```text
target: test-scratch only (host redacted — isolated branch, never the shared DATABASE_URL)
the shared DATABASE_URL is never contacted and never printed
preflight ok: {"products":15,"models":1,"offers":16,"assessments":25,"queries":0} (seed scoring_model <uuid>)
inserted measurement queries: <uuid>, <uuid>

== query GAMING | budget 15000 MAD | id <uuid>

  configured cap: 25 build(s)
      scores: build_score min 28.50 | max 49.78 | mean 40.23 | distinct 22 | gap 21.28
    structure (role / distinct / first-change / predicted / deviation):
      CPU           distinct  1  first-change    -  predicted     64  | single value in the run
      MOTHERBOARD   distinct  1  first-change    -  predicted     64  | single value in the run
      RAM           distinct  2  first-change   19  predicted     32  | earlier than predicted (pruning / GPU-omit shorten later chains)
      GPU           distinct  2  first-change   16  predicted     16  | matches the mixed-radix prediction
      PSU           distinct  2  first-change    8  predicted      8  | matches the mixed-radix prediction
      CASE          distinct  2  first-change    4  predicted      4  | matches the mixed-radix prediction
      CPU_COOLER    distinct  2  first-change    2  predicted      2  | matches the mixed-radix prediction
      SSD_BOOT      distinct  2  first-change    1  predicted      1  | matches the mixed-radix prediction

  raised cap 100000 (in-memory copy; DB value untouched): 113 build(s)
      scores: build_score min 26.86 | max 53.98 | mean 40.43 | distinct 96 | gap 27.13
    structure (role / distinct / first-change / predicted / deviation):
      CPU           distinct  2  first-change   79  predicted    128  | earlier than predicted (pruning / GPU-omit shorten later chains)
      MOTHERBOARD   distinct  2  first-change   39  predicted     64  | earlier than predicted (pruning / GPU-omit shorten later chains)
      RAM           distinct  2  first-change   19  predicted     32  | earlier than predicted (pruning / GPU-omit shorten later chains)
      GPU           distinct  2  first-change   16  predicted     16  | matches the mixed-radix prediction
      PSU           distinct  2  first-change    8  predicted      8  | matches the mixed-radix prediction
      CASE          distinct  2  first-change    4  predicted      4  | matches the mixed-radix prediction
      CPU_COOLER    distinct  2  first-change    2  predicted      2  | matches the mixed-radix prediction
      SSD_BOOT      distinct  2  first-change    1  predicted      1  | matches the mixed-radix prediction

  rank 1 (real Decision 18 ranking/ module):
    configured cap : score 49.78 | total 13150.00 | signature <full canonical signature, differs from raised only in MOTHERBOARD+SSD_BOOT picks>
    raised cap     : score 53.98 | total 12250.00 | signature <full canonical signature, differs from configured only in MOTHERBOARD+SSD_BOOT picks>
    rank 1 is a DIFFERENT build capped vs uncapped (score differs)

== query OFFICE | budget 10000 MAD | id <uuid>

  configured cap: 18 build(s)
      scores: build_score min 28.02 | max 48.48 | mean 38.87 | distinct 18 | gap 20.46
    structure (role / distinct / first-change / predicted / deviation):
      CPU           distinct  2  first-change    1  predicted    128  | earlier than predicted (pruning / GPU-omit shorten later chains)

      MOTHERBOARD   distinct  2  first-change    1  predicted     64  | earlier than predicted (pruning / GPU-omit shorten later chains)
      RAM           distinct  2  first-change    1  predicted     32  | earlier than predicted (pruning / GPU-omit shorten later chains)
      GPU           distinct  2  first-change    1  predicted     16  | earlier than predicted (pruning / GPU-omit shorten later chains)
      PSU           distinct  2  first-change    1  predicted      8  | earlier than predicted (pruning / GPU-omit shorten later chains)
      CASE          distinct  2  first-change    2  predicted      4  | earlier than predicted (pruning / GPU-omit shorten later chains)
      CPU_COOLER    distinct  2  first-change    3  predicted      2  | later than predicted (option combinations pruned)
      SSD_BOOT      distinct  2  first-change    4  predicted      1  | later than predicted (option combinations pruned)

  raised cap 100000 (in-memory copy; DB value untouched): 18 build(s)
      scores: build_score min 28.02 | max 48.48 | mean 38.87 | distinct 18 | gap 20.46
    structure (role / distinct / first-change / predicted / deviation):
      CPU           distinct  2  first-change    1  predicted    128  | earlier than predicted (pruning / GPU-omit shorten later chains)
      MOTHERBOARD   distinct  2  first-change    1  predicted     64  | earlier than predicted (pruning / GPU-omit shorten later chains)
      RAM           distinct  2  first-change    1  predicted     32  | earlier than predicted (pruning / GPU-omit shorten later chains)
      GPU           distinct  2  first-change    1  predicted     16  | earlier than predicted (pruning / GPU-omit shorten later chains)
      PSU           distinct  2  first-change    1  predicted      8  | earlier than predicted (pruning / GPU-omit shorten later chains)
      CASE          distinct  2  first-change    2  predicted      4  | earlier than predicted (pruning / GPU-omit shorten later chains)
      CPU_COOLER    distinct  2  first-change    3  predicted      2  | later than predicted (option combinations pruned)
      SSD_BOOT      distinct  2  first-change    4  predicted      1  | later than predicted (option combinations pruned)

  rank 1 (real Decision 18 ranking/ module):
    configured cap : score 48.48 | total 9800.00 | signature <canonical signature with GPU:: omitted slot>
    raised cap     : score 48.48 | total 9800.00 | signature <identical canonical signature>
    rank 1 is THE SAME build capped vs uncapped (score equal)

== K=5 extrapolation (arithmetic only; the synthetic run was SKIPPED - see note)
  CPU           first change at build 78125 (beyond the cap)
  MOTHERBOARD   first change at build 15625 (beyond the cap)
  RAM           first change at build 3125 (beyond the cap)
  GPU           first change at build 625 (beyond the cap)
  PSU           first change at build 125 (beyond the cap)
  CASE          first change at build 25 (within the cap)
  CPU_COOLER    first change at build 5 (within the cap)
  SSD_BOOT      first change at build 1 (within the cap)
  With K=5 options per role and cap 25 the only roles that can vary inside the cap are
  SSD_BOOT (every build) and CPU_COOLER (every 5th build); CASE changes at build 26, the
  first build beyond the cap. That is the shape Decision 18.4 describes (vary only
  CPU_COOLER and SSD_BOOT), and each additional varying role costs K times more builds.
  SKIPPED-RUN NOTE: the synthetic in-memory K=5 assembleBuilds run was NOT executed: its
  fixture builders live inside assemble.test.js / pipeline.test.js (not exported), so
  reusing them would have required editing existing test files. These numbers are
  arithmetic, not a run.

== FACTUAL SUMMARY (a measurement; NOT a Decision 20 outcome)
  GAMING: configured cap -> 25 build(s); raised cap -> 113 build(s); rank 1 DIFFERENT build capped vs uncapped
    varying roles at the configured cap: RAM(2), GPU(2), PSU(2), CASE(2), CPU_COOLER(2), SSD_BOOT(2)
    varying roles at the raised cap:     CPU(2), MOTHERBOARD(2), RAM(2), GPU(2), PSU(2), CASE(2), CPU_COOLER(2), SSD_BOOT(2)
  OFFICE: configured cap -> 18 build(s); raised cap -> 18 build(s); rank 1 SAME build capped vs uncapped
    varying roles at the configured cap: CPU(2), MOTHERBOARD(2), RAM(2), GPU(2), PSU(2), CASE(2), CPU_COOLER(2), SSD_BOOT(2)
    varying roles at the raised cap:     CPU(2), MOTHERBOARD(2), RAM(2), GPU(2), PSU(2), CASE(2), CPU_COOLER(2), SSD_BOOT(2)
  With 2 candidates per role on this seed, the last roles of EXPANSION_ORDER are expected
  to vary inside 25 builds (mixed-radix discovery order); that is not a contradiction of
  Decision 18.4, whose K-scaling half needs K at or below the per-role option counts - the
  K=5 arithmetic above stands in for it (synthetic run skipped, see its note).
  No Decision 20 outcome is recommended or implied by this output.
cleanup verified: recommendation_query back to 0 rows
```

- 113 valid builds (GAMING, raised cap): MATCHES exactly (113; delta 0).
- 27.37-point GAMING spread: CLOSE — real gap is 27.13 (delta -0.24); min 26.86 / max 53.98 verbatim.
- 7/10 top slots on one CPU-GPU pair (OFFICE): NOT PRODUCED by this script — the harness prints build counts, score spreads, structure rows, and rank-1 only; no top-10 pair-concentration analysis exists in its output, so the claim is unverifiable from this run and pending review.
- Decision 20 text, MAX_PER_PAIR, run.js, ranking/, persistence/ untouched; nothing committed or pushed.
Note: the full 8-role canonical rank-1 signatures (product UUIDs per role) were replaced above by bracketed shape notes to keep this file readable; they are printed in full on the console by the script. Keyed comparison vs Decision 20 (run 2026-09-23, three consecutive identical runs):

## 2026-09-23 (run 2) — Decision 20 top-10 (CPU, GPU) pair concentration (measure-orchestrator.js)

Seed: the minimal seed (`database/seeds/001_minimal_builds.sql`) — 15 products / 16 offers (preflight `{"products":15,"models":1,"offers":16,"assessments":25,"queries":0}`, seed scoring_model pinned by id, isolated test-scratch branch only; measurement queries inserted then deleted, `recommendation_query back to 0 rows`; 6 runs, every captured exit code 0).

Add: `scripts/measure-orchestrator.js` now measures the one number Decision 20 section 1 turns on that the 2026-09-23 run never produced — the **top-10 (CPU, GPU) pair concentration**. Per query and per cap variant it ranks that run's build set with the real `rankBuilds()` (Decision 18, unchanged), takes `ranked.slice(0, TOP_N_PERSISTED)` (10 entries), groups them by the Decision 20 section 2 pair `(CPU product_id, GPU product_variant_id-or-OMITTED)` read from each build's component list through the script's existing `roleValue()` by-role path and cross-checked against the entry's Decision 18 signature (10/10 identical in every block), prints the distinct-pair / per-pair counts, and compares those counts with Decision 20 section 1's wording on a printed band (delta 0 = HOLDS EXACTLY, |delta| <= 2 = CLOSE, else WAY OFF). Two seed-scoped read-only SELECTs were added for pair display labels (product name / variant SKU); the write path is unchanged (same 2 INSERTs + finally-DELETE, read-only preflight before any write).

Raw output of `node scripts/measure-orchestrator.js` (query ids and seed scoring_model id redacted — per-run UUIDs; product/variant UUIDs kept verbatim so every pair stays identifiable; every number verbatim, unrounded). Only omissions: the two `.env` lines dotenv v17 prints (rotating tip text) and pg's SSL-mode warning, which goes to stderr — no numeric output is trimmed:

```text
target: test-scratch only (host redacted — isolated branch, never the shared DATABASE_URL)
the shared DATABASE_URL is never contacted and never printed
preflight ok: {"products":15,"models":1,"offers":16,"assessments":25,"queries":0} (seed scoring_model <uuid>)
pair labels loaded (read-only): 15 product name(s), 2 variant SKU(s)
inserted measurement queries: <uuid>, <uuid>

== query GAMING | budget 15000 MAD | id <uuid>

  configured cap: 25 build(s)
      scores: build_score min 28.49 | max 49.77 | mean 40.23 | distinct 22 | gap 21.28
    structure (role / distinct / first-change / predicted / deviation):
      CPU           distinct  1  first-change    -  predicted     64  | single value in the run
      MOTHERBOARD   distinct  1  first-change    -  predicted     64  | single value in the run
      RAM           distinct  2  first-change   19  predicted     32  | earlier than predicted (pruning / GPU-omit shorten later chains)
      GPU           distinct  2  first-change   16  predicted     16  | matches the mixed-radix prediction
      PSU           distinct  2  first-change    8  predicted      8  | matches the mixed-radix prediction
      CASE          distinct  2  first-change    4  predicted      4  | matches the mixed-radix prediction
      CPU_COOLER    distinct  2  first-change    2  predicted      2  | matches the mixed-radix prediction
      SSD_BOOT      distinct  2  first-change    1  predicted      1  | matches the mixed-radix prediction
    top-10 (CPU, GPU) pair concentration (configured cap; real rankBuilds, TOP_N_PERSISTED = 10):
      ranked 25 build(s); top-10 slice 10 (rank 1..10); component-list pair keys cross-checked against the Decision 18 signature: 10/10 identical
      Decision 20 pair definition (CPU product_id, GPU product_variant_id-or-OMITTED):
        distinct pairs 2 | distinct CPU product_ids 1 | distinct GPU pair values 2
        pair counts, descending:
           8 of 10  CPU Seed Ryzen 5 7500F (fcf4fbb7-db40-467e-9927-c253e8d43468) | GPU SEED-RTX4060-DUAL-8G (77061b03-8742-473b-baaf-3553d715fd27)
           2 of 10  CPU Seed Ryzen 5 7500F (fcf4fbb7-db40-467e-9927-c253e8d43468) | GPU SEED-RTX4060-TRIO-OC-8G (c35235e5-ee10-4381-acbc-9f47351650c6)
      Decision 20 section 1, as written: "the ranked top-10 still collapsed to 1 CPU / 2 GPU pairs"
        distinct CPU product_ids in the top-10: actual 1 | claimed 1 -> HOLDS EXACTLY (delta 0)
        distinct GPU pair values in the top-10: actual 2 | claimed 2 -> HOLDS EXACTLY (delta 0)
      coarser reading (CPU product_id, GPU product_id) - the variants of one GPU product merge into one pair:
        distinct pairs 1; pair counts, descending:
          10 of 10  CPU Seed Ryzen 5 7500F (fcf4fbb7-db40-467e-9927-c253e8d43468) | GPU Seed RTX 4060 8GB (e4e4fe46-135f-4b45-936a-0ab8ce279f46)

  raised cap 100000 (in-memory copy; DB value untouched): 113 build(s)
      scores: build_score min 26.85 | max 53.98 | mean 40.43 | distinct 96 | gap 27.13
    structure (role / distinct / first-change / predicted / deviation):
      CPU           distinct  2  first-change   79  predicted    128  | earlier than predicted (pruning / GPU-omit shorten later chains)
      MOTHERBOARD   distinct  2  first-change   39  predicted     64  | earlier than predicted (pruning / GPU-omit shorten later chains)
      RAM           distinct  2  first-change   19  predicted     32  | earlier than predicted (pruning / GPU-omit shorten later chains)
      GPU           distinct  2  first-change   16  predicted     16  | matches the mixed-radix prediction
      PSU           distinct  2  first-change    8  predicted      8  | matches the mixed-radix prediction
      CASE          distinct  2  first-change    4  predicted      4  | matches the mixed-radix prediction
      CPU_COOLER    distinct  2  first-change    2  predicted      2  | matches the mixed-radix prediction
      SSD_BOOT      distinct  2  first-change    1  predicted      1  | matches the mixed-radix prediction
    top-10 (CPU, GPU) pair concentration (raised cap 100000; real rankBuilds, TOP_N_PERSISTED = 10):
      ranked 113 build(s); top-10 slice 10 (rank 1..10); component-list pair keys cross-checked against the Decision 18 signature: 10/10 identical
      Decision 20 pair definition (CPU product_id, GPU product_variant_id-or-OMITTED):
        distinct pairs 2 | distinct CPU product_ids 1 | distinct GPU pair values 2
        pair counts, descending:
           6 of 10  CPU Seed Ryzen 5 7500F (fcf4fbb7-db40-467e-9927-c253e8d43468) | GPU SEED-RTX4060-DUAL-8G (77061b03-8742-473b-baaf-3553d715fd27)
           4 of 10  CPU Seed Ryzen 5 7500F (fcf4fbb7-db40-467e-9927-c253e8d43468) | GPU SEED-RTX4060-TRIO-OC-8G (c35235e5-ee10-4381-acbc-9f47351650c6)
      Decision 20 section 1, as written: "the ranked top-10 still collapsed to 1 CPU / 2 GPU pairs"
        distinct CPU product_ids in the top-10: actual 1 | claimed 1 -> HOLDS EXACTLY (delta 0)
        distinct GPU pair values in the top-10: actual 2 | claimed 2 -> HOLDS EXACTLY (delta 0)
      coarser reading (CPU product_id, GPU product_id) - the variants of one GPU product merge into one pair:
        distinct pairs 1; pair counts, descending:
          10 of 10  CPU Seed Ryzen 5 7500F (fcf4fbb7-db40-467e-9927-c253e8d43468) | GPU Seed RTX 4060 8GB (e4e4fe46-135f-4b45-936a-0ab8ce279f46)
      top-10 listing (rank | build_score | total_price | Decision 20 pair):
        rank  1 | score 53.98 | total 12250.00 | CPU Seed Ryzen 5 7500F (fcf4fbb7-db40-467e-9927-c253e8d43468) | GPU SEED-RTX4060-DUAL-8G (77061b03-8742-473b-baaf-3553d715fd27)
        rank  2 | score 53.98 | total 13850.00 | CPU Seed Ryzen 5 7500F (fcf4fbb7-db40-467e-9927-c253e8d43468) | GPU SEED-RTX4060-TRIO-OC-8G (c35235e5-ee10-4381-acbc-9f47351650c6)
        rank  3 | score 52.92 | total 11800.00 | CPU Seed Ryzen 5 7500F (fcf4fbb7-db40-467e-9927-c253e8d43468) | GPU SEED-RTX4060-DUAL-8G (77061b03-8742-473b-baaf-3553d715fd27)
        rank  4 | score 52.36 | total 11550.00 | CPU Seed Ryzen 5 7500F (fcf4fbb7-db40-467e-9927-c253e8d43468) | GPU SEED-RTX4060-DUAL-8G (77061b03-8742-473b-baaf-3553d715fd27)
        rank  5 | score 52.36 | total 13150.00 | CPU Seed Ryzen 5 7500F (fcf4fbb7-db40-467e-9927-c253e8d43468) | GPU SEED-RTX4060-TRIO-OC-8G (c35235e5-ee10-4381-acbc-9f47351650c6)
        rank  6 | score 51.30 | total 11100.00 | CPU Seed Ryzen 5 7500F (fcf4fbb7-db40-467e-9927-c253e8d43468) | GPU SEED-RTX4060-DUAL-8G (77061b03-8742-473b-baaf-3553d715fd27)
        rank  7 | score 49.95 | total 11550.00 | CPU Seed Ryzen 5 7500F (fcf4fbb7-db40-467e-9927-c253e8d43468) | GPU SEED-RTX4060-DUAL-8G (77061b03-8742-473b-baaf-3553d715fd27)
        rank  8 | score 49.95 | total 13150.00 | CPU Seed Ryzen 5 7500F (fcf4fbb7-db40-467e-9927-c253e8d43468) | GPU SEED-RTX4060-TRIO-OC-8G (c35235e5-ee10-4381-acbc-9f47351650c6)
        rank  9 | score 49.77 | total 13150.00 | CPU Seed Ryzen 5 7500F (fcf4fbb7-db40-467e-9927-c253e8d43468) | GPU SEED-RTX4060-DUAL-8G (77061b03-8742-473b-baaf-3553d715fd27)
        rank 10 | score 49.77 | total 14750.00 | CPU Seed Ryzen 5 7500F (fcf4fbb7-db40-467e-9927-c253e8d43468) | GPU SEED-RTX4060-TRIO-OC-8G (c35235e5-ee10-4381-acbc-9f47351650c6)

  rank 1 (real Decision 18 ranking/ module):
    configured cap : score 49.77 | total 13150.00 | signature CPU:fcf4fbb7-db40-467e-9927-c253e8d43468:|MOTHERBOARD:5917f68f-e753-41fc-8e79-b4b4ed236382:|RAM:45368a17-902d-4ea0-a766-b5bf74edb60d:|GPU:e4e4fe46-135f-4b45-936a-0ab8ce279f46:77061b03-8742-473b-baaf-3553d715fd27|PSU:19c255bd-3aeb-4258-9ec0-fe86adce6f3b:|CASE:477f03ce-f84d-43ef-8898-8b8616e49460:|CPU_COOLER:beca2d5b-d1e0-44c7-9ebb-c2ff179935e3:|SSD_BOOT:66f73b8a-083c-4220-9805-f434f261efe2:
    raised cap     : score 53.98 | total 12250.00 | signature CPU:fcf4fbb7-db40-467e-9927-c253e8d43468:|MOTHERBOARD:7885421c-f392-4832-a269-1f062e5a912e:|RAM:45368a17-902d-4ea0-a766-b5bf74edb60d:|GPU:e4e4fe46-135f-4b45-936a-0ab8ce279f46:77061b03-8742-473b-baaf-3553d715fd27|PSU:19c255bd-3aeb-4258-9ec0-fe86adce6f3b:|CASE:477f03ce-f84d-43ef-8898-8b8616e49460:|CPU_COOLER:beca2d5b-d1e0-44c7-9ebb-c2ff179935e3:|SSD_BOOT:66f73b8a-083c-4220-9805-f434f261efe2:
    rank 1 is a DIFFERENT build capped vs uncapped (score differs)

== query OFFICE | budget 10000 MAD | id <uuid>

  configured cap: 18 build(s)
      scores: build_score min 28.02 | max 48.47 | mean 38.87 | distinct 18 | gap 20.46
    structure (role / distinct / first-change / predicted / deviation):
      CPU           distinct  2  first-change    1  predicted    128  | earlier than predicted (pruning / GPU-omit shorten later chains)
      MOTHERBOARD   distinct  2  first-change    1  predicted     64  | earlier than predicted (pruning / GPU-omit shorten later chains)
      RAM           distinct  2  first-change    1  predicted     32  | earlier than predicted (pruning / GPU-omit shorten later chains)
      GPU           distinct  2  first-change    1  predicted     16  | earlier than predicted (pruning / GPU-omit shorten later chains)
      PSU           distinct  2  first-change    1  predicted      8  | earlier than predicted (pruning / GPU-omit shorten later chains)
      CASE          distinct  2  first-change    2  predicted      4  | earlier than predicted (pruning / GPU-omit shorten later chains)
      CPU_COOLER    distinct  2  first-change    3  predicted      2  | later than predicted (option combinations pruned)
      SSD_BOOT      distinct  2  first-change    4  predicted      1  | later than predicted (option combinations pruned)
    top-10 (CPU, GPU) pair concentration (configured cap; real rankBuilds, TOP_N_PERSISTED = 10):
      ranked 18 build(s); top-10 slice 10 (rank 1..10); component-list pair keys cross-checked against the Decision 18 signature: 10/10 identical
      Decision 20 pair definition (CPU product_id, GPU product_variant_id-or-OMITTED):
        distinct pairs 2 | distinct CPU product_ids 2 | distinct GPU pair values 2
        pair counts, descending:
           9 of 10  CPU Seed Ryzen 5 8600G (7801beec-5d86-4c2a-8025-34544543f844) | GPU OMITTED (no GPU component)
           1 of 10  CPU Seed Ryzen 5 7500F (fcf4fbb7-db40-467e-9927-c253e8d43468) | GPU SEED-RTX4060-DUAL-8G (77061b03-8742-473b-baaf-3553d715fd27)
      Decision 20 section 1, as written: "OFFICE collapsed to 1 CPU-GPU pairing in 7/10 top slots"
        top-10 slots held by the largest single pair: actual 9 | claimed 7 -> CLOSE (delta +2)
      coarser reading (CPU product_id, GPU product_id) - the variants of one GPU product merge into one pair:
        distinct pairs 2; pair counts, descending:
           9 of 10  CPU Seed Ryzen 5 8600G (7801beec-5d86-4c2a-8025-34544543f844) | GPU OMITTED (no GPU component)
           1 of 10  CPU Seed Ryzen 5 7500F (fcf4fbb7-db40-467e-9927-c253e8d43468) | GPU Seed RTX 4060 8GB (e4e4fe46-135f-4b45-936a-0ab8ce279f46)

  raised cap 100000 (in-memory copy; DB value untouched): 18 build(s)
      scores: build_score min 28.02 | max 48.47 | mean 38.87 | distinct 18 | gap 20.46
    structure (role / distinct / first-change / predicted / deviation):
      CPU           distinct  2  first-change    1  predicted    128  | earlier than predicted (pruning / GPU-omit shorten later chains)
      MOTHERBOARD   distinct  2  first-change    1  predicted     64  | earlier than predicted (pruning / GPU-omit shorten later chains)
      RAM           distinct  2  first-change    1  predicted     32  | earlier than predicted (pruning / GPU-omit shorten later chains)
      GPU           distinct  2  first-change    1  predicted     16  | earlier than predicted (pruning / GPU-omit shorten later chains)
      PSU           distinct  2  first-change    1  predicted      8  | earlier than predicted (pruning / GPU-omit shorten later chains)
      CASE          distinct  2  first-change    2  predicted      4  | earlier than predicted (pruning / GPU-omit shorten later chains)
      CPU_COOLER    distinct  2  first-change    3  predicted      2  | later than predicted (option combinations pruned)
      SSD_BOOT      distinct  2  first-change    4  predicted      1  | later than predicted (option combinations pruned)
    top-10 (CPU, GPU) pair concentration (raised cap 100000; real rankBuilds, TOP_N_PERSISTED = 10):
      ranked 18 build(s); top-10 slice 10 (rank 1..10); component-list pair keys cross-checked against the Decision 18 signature: 10/10 identical
      Decision 20 pair definition (CPU product_id, GPU product_variant_id-or-OMITTED):
        distinct pairs 2 | distinct CPU product_ids 2 | distinct GPU pair values 2
        pair counts, descending:
           9 of 10  CPU Seed Ryzen 5 8600G (7801beec-5d86-4c2a-8025-34544543f844) | GPU OMITTED (no GPU component)
           1 of 10  CPU Seed Ryzen 5 7500F (fcf4fbb7-db40-467e-9927-c253e8d43468) | GPU SEED-RTX4060-DUAL-8G (77061b03-8742-473b-baaf-3553d715fd27)
      Decision 20 section 1, as written: "OFFICE collapsed to 1 CPU-GPU pairing in 7/10 top slots"
        top-10 slots held by the largest single pair: actual 9 | claimed 7 -> CLOSE (delta +2)
      coarser reading (CPU product_id, GPU product_id) - the variants of one GPU product merge into one pair:
        distinct pairs 2; pair counts, descending:
           9 of 10  CPU Seed Ryzen 5 8600G (7801beec-5d86-4c2a-8025-34544543f844) | GPU OMITTED (no GPU component)
           1 of 10  CPU Seed Ryzen 5 7500F (fcf4fbb7-db40-467e-9927-c253e8d43468) | GPU Seed RTX 4060 8GB (e4e4fe46-135f-4b45-936a-0ab8ce279f46)
      top-10 listing (rank | build_score | total_price | Decision 20 pair):
        rank  1 | score 48.47 | total 9800.00 | CPU Seed Ryzen 5 8600G (7801beec-5d86-4c2a-8025-34544543f844) | GPU OMITTED (no GPU component)
        rank  2 | score 45.65 | total 9800.00 | CPU Seed Ryzen 5 8600G (7801beec-5d86-4c2a-8025-34544543f844) | GPU OMITTED (no GPU component)
        rank  3 | score 44.99 | total 9550.00 | CPU Seed Ryzen 5 8600G (7801beec-5d86-4c2a-8025-34544543f844) | GPU OMITTED (no GPU component)
        rank  4 | score 44.07 | total 10000.00 | CPU Seed Ryzen 5 8600G (7801beec-5d86-4c2a-8025-34544543f844) | GPU OMITTED (no GPU component)
        rank  5 | score 43.76 | total 9100.00 | CPU Seed Ryzen 5 8600G (7801beec-5d86-4c2a-8025-34544543f844) | GPU OMITTED (no GPU component)
        rank  6 | score 43.41 | total 9750.00 | CPU Seed Ryzen 5 8600G (7801beec-5d86-4c2a-8025-34544543f844) | GPU OMITTED (no GPU component)
        rank  7 | score 42.17 | total 9300.00 | CPU Seed Ryzen 5 8600G (7801beec-5d86-4c2a-8025-34544543f844) | GPU OMITTED (no GPU component)
        rank  8 | score 41.16 | total 9900.00 | CPU Seed Ryzen 5 7500F (fcf4fbb7-db40-467e-9927-c253e8d43468) | GPU SEED-RTX4060-DUAL-8G (77061b03-8742-473b-baaf-3553d715fd27)
        rank  9 | score 40.59 | total 9750.00 | CPU Seed Ryzen 5 8600G (7801beec-5d86-4c2a-8025-34544543f844) | GPU OMITTED (no GPU component)
        rank 10 | score 39.35 | total 9300.00 | CPU Seed Ryzen 5 8600G (7801beec-5d86-4c2a-8025-34544543f844) | GPU OMITTED (no GPU component)

  rank 1 (real Decision 18 ranking/ module):
    configured cap : score 48.47 | total 9800.00 | signature CPU:7801beec-5d86-4c2a-8025-34544543f844:|MOTHERBOARD:5917f68f-e753-41fc-8e79-b4b4ed236382:|RAM:45368a17-902d-4ea0-a766-b5bf74edb60d:|GPU::|PSU:118ed719-2771-4b13-bc86-398011fde333:|CASE:477f03ce-f84d-43ef-8898-8b8616e49460:|CPU_COOLER:beca2d5b-d1e0-44c7-9ebb-c2ff179935e3:|SSD_BOOT:1355a4ae-6847-44ad-a210-a8977fbfaf56:
    raised cap     : score 48.47 | total 9800.00 | signature CPU:7801beec-5d86-4c2a-8025-34544543f844:|MOTHERBOARD:5917f68f-e753-41fc-8e79-b4b4ed236382:|RAM:45368a17-902d-4ea0-a766-b5bf74edb60d:|GPU::|PSU:118ed719-2771-4b13-bc86-398011fde333:|CASE:477f03ce-f84d-43ef-8898-8b8616e49460:|CPU_COOLER:beca2d5b-d1e0-44c7-9ebb-c2ff179935e3:|SSD_BOOT:1355a4ae-6847-44ad-a210-a8977fbfaf56:
    rank 1 is THE SAME build capped vs uncapped (score equal)

== K=5 extrapolation (arithmetic only; the synthetic run was SKIPPED - see note)
  CPU           first change at build 78125 (beyond the cap)
  MOTHERBOARD   first change at build 15625 (beyond the cap)
  RAM           first change at build 3125 (beyond the cap)
  GPU           first change at build 625 (beyond the cap)
  PSU           first change at build 125 (beyond the cap)
  CASE          first change at build 25 (within the cap)
  CPU_COOLER    first change at build 5 (within the cap)
  SSD_BOOT      first change at build 1 (within the cap)
  With K=5 options per role and cap 25 the only roles that can vary inside the cap are
  SSD_BOOT (every build) and CPU_COOLER (every 5th build); CASE changes at build 26, the
  first build beyond the cap. That is the shape Decision 18.4 describes (vary only
  CPU_COOLER and SSD_BOOT), and each additional varying role costs K times more builds.
  SKIPPED-RUN NOTE: the synthetic in-memory K=5 assembleBuilds run was NOT executed: its
  fixture builders live inside assemble.test.js / pipeline.test.js (not exported), so
  reusing them would have required editing existing test files. These numbers are
  arithmetic, not a run.

== FACTUAL SUMMARY (a measurement; NOT a Decision 20 outcome)
  GAMING: configured cap -> 25 build(s); raised cap -> 113 build(s); rank 1 DIFFERENT build capped vs uncapped
    varying roles at the configured cap: RAM(2), GPU(2), PSU(2), CASE(2), CPU_COOLER(2), SSD_BOOT(2)
    varying roles at the raised cap:     CPU(2), MOTHERBOARD(2), RAM(2), GPU(2), PSU(2), CASE(2), CPU_COOLER(2), SSD_BOOT(2)
    raised cap top-10 pairs (Decision 20 definition): 2 distinct | largest pair 6 of 10 | distinct CPU product_ids 1 | distinct GPU pair values 2
    Decision 20 "distinct CPU product_ids in the top-10": actual 1 | claimed 1 -> HOLDS EXACTLY (delta 0)
    Decision 20 "distinct GPU pair values in the top-10": actual 2 | claimed 2 -> HOLDS EXACTLY (delta 0)
  OFFICE: configured cap -> 18 build(s); raised cap -> 18 build(s); rank 1 SAME build capped vs uncapped
    varying roles at the configured cap: CPU(2), MOTHERBOARD(2), RAM(2), GPU(2), PSU(2), CASE(2), CPU_COOLER(2), SSD_BOOT(2)
    varying roles at the raised cap:     CPU(2), MOTHERBOARD(2), RAM(2), GPU(2), PSU(2), CASE(2), CPU_COOLER(2), SSD_BOOT(2)
    raised cap top-10 pairs (Decision 20 definition): 2 distinct | largest pair 9 of 10 | distinct CPU product_ids 2 | distinct GPU pair values 2
    Decision 20 "top-10 slots held by the largest single pair": actual 9 | claimed 7 -> CLOSE (delta +2)
  With 2 candidates per role on this seed, the last roles of EXPANSION_ORDER are expected
  to vary inside 25 builds (mixed-radix discovery order); that is not a contradiction of
  Decision 18.4, whose K-scaling half needs K at or below the per-role option counts - the
  K=5 arithmetic above stands in for it (synthetic run skipped, see its note).
  No Decision 20 outcome is recommended or implied by this output.
cleanup verified: recommendation_query back to 0 rows
```

- Decision 20's OFFICE "7/10 top slots" (section 1): **NOT exact — the real number is 9 of the 10 top slots** on one pair. The dominant pair is `Seed Ryzen 5 8600G (7801beec-5d86-4c2a-8025-34544543f844) | GPU OMITTED (no GPU component)` with 9 slots; the 10th slot (rank 8) is `Seed Ryzen 5 7500F | SEED-RTX4060-DUAL-8G`. Delta +2 against the doc's 7 → the printed band says CLOSE (not way off): the doc understates the same collapse by 2 slots.
- OFFICE's "1 CPU-GPU pairing" is right in spirit but not literally: the top-10 holds 2 distinct pairs, 2 distinct CPU product_ids (8600G on 9 slots, 7500F on 1) and 2 distinct GPU pair values (OMITTED 9, DUAL-8G 1) — one pair dominates, but the collapse is not total.
- Decision 20's GAMING "1 CPU / 2 GPU pairs": **HOLDS EXACTLY** (1 distinct CPU product_id and 2 distinct GPU pair values, both delta 0). GAMING is not a 7/10 case at all — its largest single pair holds 6 of 10 (SEED-RTX4060-DUAL-8G 6, SEED-RTX4060-TRIO-OC-8G 4).
- Coarser reading (the literal "(CPU_id, GPU_id)" wording): using GPU *product_id* instead of the GPU variant, GAMING's top-10 collapses to a single pair 10/10 (both variants share GPU product `Seed RTX 4060 8GB`) while OFFICE is unchanged (9 + 1). The variant-keyed key is the one the shipped code uses (`select-diverse.js` pairKey / `MAX_PER_PAIR`, Decision 20 section 2), so "2 pairs" is the GAMING reading that matches the decision; 10/10 only appears under the coarser reading.
- Determinism: two full consecutive runs (both stdout captured, UUIDs normalised) were identical line-for-line except the dotenv tip and three `scores:` means (GAMING raised mean 40.43 vs 40.42; OFFICE 38.87 vs 38.86); three further runs printed 40.42 / 38.86. Every pair-concentration line was byte-identical in all of them, as were the build counts and the structure rows.
- Score-spread lines are stable to ~0.01, not to the last printed decimal: this session printed GAMING configured min/max 28.49/49.77 and raised min 26.85, OFFICE max 48.47, where the 2026-09-23 entry has 28.50/49.78, 26.86 and 48.48 (OFFICE min 28.02 and both gaps 21.28 / 20.46 unchanged). Decision 20's "27.37-point GAMING spread" comparison (real 27.13, delta -0.24) is unaffected in conclusion. Cause not investigated in this pass — no scoring, seed or ranking file was touched (only `scripts/measure-orchestrator.js` changed, and its new code runs only after the orchestrator has produced the builds).
- The 2026-09-23 entry annotated the GAMING rank-1 as differing between caps in "MOTHERBOARD+SSD_BOOT" picks; with the signatures printed verbatim this run they differ in MOTHERBOARD only (CPU, RAM, GPU, PSU, CASE, CPU_COOLER and SSD_BOOT identical). Flagged because that entry substituted bracketed shape notes for the signature UUIDs.
- Supersedes the 2026-09-23 bullet "7/10 top slots on one CPU-GPU pair (OFFICE): NOT PRODUCED ... pending review" — it is now produced and measured: OFFICE 9/10 (delta +2, CLOSE), GAMING largest pair 6/10 with the doc's "1 CPU / 2 GPU pairs" exact.
- Decision 20 text, MAX_PER_PAIR, run.js, ranking/, persistence/ untouched; nothing committed or pushed.

### 2026-09-25: Catalog expansion to 100 products (002_catalog_expansion.sql) & score degeneracy

- Applied `database/seeds/002_catalog_expansion.sql` (85 new products, 85 offers, 85 variants, specs and compat mappings across all 8 roles) bringing baseline counts to 100 products, 101 offers, 25 assessments.
- Preflight counts updated in `scripts/test-orchestrator-full-run.js` and `scripts/measure-orchestrator.js` (`products: 100`, `offers: 101`).
- `test-orchestrator-full-run.js`: 28 pass / 0 fail on the isolated branch (`TEST_DATABASE_URL`).
- **Score degeneracy finding**: Under the expanded catalog, `measure-orchestrator.js` reports `build_score min 0.00 | max 0.00 | mean 0.00 | distinct 1` for all 25 builds (and all 35,982 builds under raised cap 100,000). Every build score clamps to 0.00.
  - *Root cause*: `build-score.js` applies `unknown_compat_penalty` (5.0 per occurrence) to the raw score. Engine 2D counts UNKNOWN pairwise checks per candidate across ALL candidate pool partners (pool-wide, not build-wide). With 9 new PSUs lacking connector matrices (`connector_pcie_8pin IS NULL`) and 20 new GPU variants lacking connector requirements (`required_power_connectors IS NULL`), every chosen GPU and PSU candidate accumulates dozens of UNKNOWN pairs across both evaluation directions. The resulting compound penalty (~145+ points) exceeds the raw score (~40) and clamps `build_score` to 0.
  - *Impact*: Rankings become entirely tie-break-driven; persisted explanation texts read `best weighted score 0`.
  - *Resolution needed*: Populate PSU connector matrices (9 rows) and GPU connector specs (20 rows) in Layer 1, or revise the candidate-level UNKNOWN penalty semantics to be build-local rather than pool-wide. *Resolved (2026-09-27, Decision 23)*: O2 build-local `unknown_pairwise_count` implemented (per DECISIONS.md:3116 doc-sync); O1 seed 003 pending. UPDATE 2026-09-28 (Decision 23 O1): `database/seeds/003_gpu_psu_connector_data.sql` applied (commit `4e70f9e`); acceptance criteria 1–2 measured MET, criterion 3 / PI-1 still unbuilt.

### 2026-09-27: Decision 23 O2 build-local unknown_pairwise_count

- Code: `assembly/assemble.js` `finishPath` no longer sums verdict counts; new `countBuildLocalUnknownPairs` helper recomputes the count over the picked components (same PAIRWISE_CHECKS/evaluators/aggregation as the Decision 16 FAIL gate, each pair once, absent partner to 0, UNKNOWN-only, verdict field never read). Comment corrections in `assemble.js`, `scoring/build-score.js`, `ranking/rank.js`, `orchestrator/run.js`, plus a scoping note on `filtering/filter.test.js:313`; `filtering/filter.js` unchanged; no migration, no seed.
- Tests: `assembly/assemble.test.js` gains a hand-derived `o2MixedContext` fixture (expected 2 / 4-vs-2), a verdict-independence check, and a once-per-pair check; the Decision 16 gate test's trailing pin is now 8-vs-6 with its derivation; branch-abandonment assertions unchanged.
- Docs: `CONTEXT.md` status pointers; `DEVELOPMENT_NOTES.md` Decision 15 bullet supersession note plus the 2026-09-25 resolution pointer.
- Verification: `npm run test:unit` 815 to 817, 0 failures; nothing committed or pushed.

## 2026-09-28 — D2 hybrid (Decision 26): S5.2 HIGH-TGP connector escalation implemented, the four S5.3/S6 HARD rules deferred

Scope: audit finding D2 only (D1/D3/D4 were committed earlier the same day; the D5 generator exists as untracked WIP).

Code (4 files; unit tests 817 -> 829, 0 failures):
- `compatibility/reason-codes.js`: new FAIL code `GPU_PSU_CONNECTOR_NULL_HIGH_TGP`.
- `compatibility/gpu.js` Rule 11: constant `HIGH_TGP_WATTS = 200`; a required, KNOWN connector whose PSU availability is NULL/absent now FAILs when `board_tgp_watts >= 200` (inclusive, finite TGP required). Decided BEFORE the unknown-name branch, so FAIL outranks UNKNOWN. Explicitly unchanged: GPU requirement NULL / unknown connector NAME / NULL-non-finite TGP -> UNKNOWN; verifiable deficit incl. an INTEGER 0 -> `GPU_PSU_CONNECTOR_UNAVAILABLE`. A non-finite availability value stays UNKNOWN (unreachable through the B2-C loader, which normalizes `psu_spec` to number-or-NULL).
- `filtering/context-loader.js`: `GPU_VARIANT_SPEC_SQL` + `normalizeGpuSpec` carry `board_tgp_watts` (NULL preserved, never 0).
- `filtering/filter.js`: `evaluateGpuPsuPair` passes `gpu_board_tgp_watts`. NO assembly change was needed: `assembly/assemble.js` reuses the same `evaluateGpuPsuPair`, so Engine 3's Decision 16 gate prunes the pair and the Decision 23 O2 build-local count stops seeing it as UNKNOWN.

Live measurements (read-only `DATABASE_URL` SELECTs; no writes, `TEST_DATABASE_URL` not needed):
- 22 `gpu_board_spec` rows, 13 with TGP >= 200 (max 575 W), all 22 carry `required_power_connectors`; all 13 high-TGP rows require exactly `{"12vhpwr": 1}`.
- 11 `psu_spec` rows; 3 with `connector_12vhpwr IS NULL` (`Seed Antec G850`, `Seed Connect PSU 850`, `Seed HYBROK PSU 650`) - the same 3 are NULL on PCIe 8-pin; 4 are NULL on EPS.
- Exactly 39 (GPU, PSU) pairs flip UNKNOWN -> FAIL.
- The four deferred rules: 0 violations, counted both over every catalog combination and over the compat-reachable subsets (cooler<->CPU via non-FAIL `cooler_socket_support`; RAM<->motherboard with matching `memory_type_id`).

Lessons (each changed this session's plan):
- The plan's baseline (`fe2a816`) was already 2 commits behind HEAD (`6c69baa`), which had partly fixed the same audit items. Always `git status` + `git log` before an audit-fix session; a plan's stated baseline is a guess.
- `filtering/context-loader.test.js` asserts the GPU variant spec with a WHOLE-OBJECT `deepEqual` - adding one normalized field breaks it. New loader fields need the fixture row AND that expectation updated.
- `filtering/filter.test.js`'s `gpuSpec()` helper is SHARED with the NULL-vs-0 pin (which asserts UNKNOWN). Never add a TGP default to a shared fixture: it would flip an unrelated pin to FAIL. New coverage goes in self-contained tests.
- `scripts/gen-decision-index.js` (untracked, another session) hard-codes `EXPECTED_GLOBAL_DECISIONS = 25` and exits non-zero on drift, so Decision 26 required bumping it to 26; its heading regex requires `## Decision N — title`. It also references `npm run gen:decisions`, which is not in `package.json`.
- Line endings: `core.autocrlf=true`, no `.gitattributes`, so the working copy genuinely mixes conventions (`AGENTS.md` is LF-dominant, everything else CRLF). The editor tool rewrote `AGENTS.md` to CRLF; it was restored to LF (dropping the two pre-existing stray CRLF lines) and every CRLF file was re-normalized. Re-check CRLF/LF counts after any doc-editing session.
- `DEVELOPMENT_NOTES.md` lives at the REPO ROOT (not `docs/`); the newest entries were `###` headings nested under the 2026-09-23 run-2 section - this entry is a new `##` heading at EOF instead.

Docs updated: `docs/RECOMMENDATION_ENGINE_DECISIONS.md` (Decision 26 + Final Status + Engine 1 readiness note), `docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md` (supersession rows 15-19; inline markers at §2 stage 6, §3 item 9, §3 list, §3.3, §5.2, §5.3, §6, §11 steps 3/7, §16 (4 new IMPORTANT/latent rows), §17, §18, §"First implementation task"), `docs/DOCUMENTATION_AUDIT_2026-09-28.md` (D2 resolution block, rule table, evidence, impact split, deferral reframe, Fix outcome, fix-order rows + status note), `AGENTS.md` §2/§10, `CONTEXT.md` (Engine 1 bullet, test count, decision pointers, NOT-implemented bullet), `database/seeds/003_gpu_psu_connector_data.sql` (header comment pointer only - no data change, no re-apply).

Verification: `npm run test:unit` 829 pass / 0 fail; `board_tgp_watts` now read by 4 `src/` files by design; the deferred columns still appear only in test-fixture scripts; all marker sites and attributions grep-verified. Nothing committed or pushed.

## 2026-09-28 — D5 closure: generated decision index + normalized `Status:` lines

Scope: audit finding D5 only (audit items 1–4 were committed earlier the same day; D6/D7/D8/D12 remain open under audit items 6–7).

What landed:
- `docs/RECOMMENDATION_ENGINE_DECISIONS.md` (3,542 → 3,598 lines): a normalized `Status:` line is now the first content line of every decision entry — 30 `^Status:` lines total (24 `## Decision` + 5 Engine-3-local `### Decision` + the Decision 18 addendum). The 12 old `### Status:` headings were moved up and removed; Decision 22's long status line was shortened (detail kept in its UPDATE block). A navigation block was added under the title (index pointer, the global-4/5 numbering quirk with its `ARCHITECTURE.md` §11 evidence, and the "`TBD` only appears in historical paragraphs" note). `TBD - not yet decided` now appears 4×, all historical.
- `scripts/gen-decision-index.js` (rewritten): **requires** the `Status:` line and hard-fails without it — no heuristics, no `UNKNOWN` (the previous version reported global Decision 4 as `UNKNOWN`); adds the Date column D5/A1 asked for; replaces the hard-coded `EXPECTED_GLOBAL_DECISIONS = 26` with contiguity + the documented 4/5-alias rule + an exact `[1..5]` Engine-3 set check; and adds `--check` (exit 1 on a stale index, ignoring only the volatile `Generated <date>` line so the gate is date-stable).
- `docs/DECISION_INDEX.md` regenerated: 24 global rows + 5 Engine-3-local rows (number, title, status, date, line anchor), an "Open decisions" section (currently *none*), and a reconciliation block that states the alias mapping instead of leaving it implied.
- `package.json`: added `gen:decisions` (it was referenced by the WIP script and absent — the lesson recorded in the D2 entry above).
- Pointers/trackers: `AGENTS.md` §2 (the "It has NO index and almost no `Status:` lines" claim was now false), §4 map, §6 command table, §9 source-of-truth row; `CONTEXT.md` decision-record line; audit `D5` RESOLVED banner + fix-order row 5 + end-of-day status (items 1–5 done); `PROJECT_STATUS_REVIEW_2026-09-28.md` `:17` (25 → 26 decisions) and register item **U13** (now VERIFIED).

Verification: `npm run gen:decisions` writes; two consecutive runs are byte-identical (sha256 equal); `--check` exits 0 on the committed index; deliberately removing one `Status:` line makes the generator exit 1 with the exact entry line number and the file was hash-restored; deliberately editing the index makes `--check` exit 1 (`STALE`); anchor check 29/29 rows point at their own headings (0 mismatches); `npm run test:unit` 829 pass / 0 fail; encodings preserved (`DECISIONS.md` CRLF + BOM, `AGENTS.md` LF, script + index CRLF).

Lessons:
- The WIP generator's `inEngine3` never reset after the Engine 3 section, so its nested `### Decision` matcher leaked to `### Decision 18 addendum`; it only passed because `if (!m) continue` silently skipped unparseable headings. When a heading fails to parse, fail loudly — silent `continue` is how wrong indexes get committed.
- A generated artifact that is committed needs a staleness gate; putting the volatile date on its own line is what keeps `--check` usable across days.
- Two mutating shell commands issued in the same tool-batch ran concurrently and raced on the same file. Run dependent/mutating tests sequentially, one command per batch.
- The editor tool matches `old_text` with LF while writing CRLF back correctly on CRLF files; still re-check CRLF/BOM counts after any doc-editing session (AGENTS.md §8).

## 2026-09-28 — D7 backlog: seed 003, O1 acceptance, seed-size note, Decisions 24–25, CONTEXT audit

Scope: audit finding D7 only (the `DEVELOPMENT_NOTES.md` entry backlog; D6 was closed in `35b0618`, D2/D5 have their own 2026-09-28 entries above). One consolidated history entry for five commits/sessions that landed 2026-09-28 without a notes entry. History only: no code, no migration, no seed, no DB access in this pass.

### 1. Seed 003 applied — Decision 23 O1 (`4e70f9e`)

- File: `database/seeds/003_gpu_psu_connector_data.sql` (new, 324 lines, DML-only, single BEGIN/COMMIT). Scope exactly the 20 GPU variants + 9 PSUs added by `002_catalog_expansion.sql`; `001_minimal_builds.sql` rows neither read nor written.
- Idempotency: every column written through `COALESCE(<existing>, <researched>)` — NULLs filled, existing non-NULL never overwritten, second run changes zero rows. A later correction must be a new seed file.
- Auditable decisions D1–D9 in the header (not copied here): D1 connector vocabulary (`24pin_atx, eps, pcie_8pin, 12vhpwr, sata`; unknown names never written); D2 `width_slots` = published mm / 20.32 rounded to 0.5; D3 conflict policy (stored length never rewritten; 1 conflict `SEED-MSI-RTX5080-VENTUS3X` 304 vs 303 mm = noise).
- D4 identity rule (dims seeded only on exact single-model match within 2 mm; 7 rows stay NULL with reasons); D5 NULL vs 0 (0 = verifiable FAIL, NULL = UNKNOWN; Decision 26 amendment noted inline 2026-09-28, comment-only, no re-apply); D6 no adapter modelling (`{"12vhpwr": 1}` regardless of box adapter).
- D7 three PSUs stay NULL (`Seed HYBROK PSU 650`, `Seed Connect PSU 850`, `Seed Antec G850` ambiguity Atom G850 vs GSK ATX 850); D8 29 cited source URLs (vendor spec pages, retailer listings, cybenetics); D9 forward effect (13x 12vhpwr GPUs FAIL vs `MAG A650BN` 12vhpwr=0; two 3.50-slot cards FAIL every 3-slot case).
- `002_catalog_expansion.sql` header gained the measured `top_k_per_role = 5` truncation + random-UUID tie-break hazard + blocking assessment-research item (same commit).
- Prior pointer: the 2026-09-25 entry already records `applied (commit 4e70f9e); criteria 1–2 MET, criterion 3 / PI-1 unbuilt` — this section supplies the session history it points to.

### 2. O1 acceptance harness — criteria 1–2 (`1693de3`)

- File: `scripts/measure-orchestrator.js` (+263/-6). Adds the rank-1 net-score gate (`build_score` = `raw − penalty × count` after 0..100 clamp) + distinct-score-spread gate on the configured-cap variant; thresholds fixed in advance in Decision 23, printed MET / NOT MET. Criterion 3 (PI-1 pool independence) explicitly out of scope with its own procedure.
- Preflight moved 15 → 100 (`EXPECTED = { products: 100, models: 1, offers: 101, assessments: 25, queries: 0 }`) covering 001+002+003; reads the penalty for the margin. Safety contract unchanged (TEST_DATABASE_URL only, 2 INSERTs + finally-DELETE, in-memory high-cap copy).
- Measured result (recorded in Decision 23 / `PROJECT_STATUS_REVIEW_2026-09-28.md`, not re-measured here): criteria 1–2 MET — GAMING rank-1 58.83 / count 0 / 12 distinct; OFFICE 57.60 / 10 distinct.

### 3. Decision 20 seed-size reconciliation (`752e884`)

- File: `docs/RECOMMENDATION_ENGINE_DECISIONS.md` (+19/-2, docs-only). Decision 20's 15-product figures (113 GAMING builds, 27.13/20.46-point ranges, OFFICE 9-of-10 pair) predate seeds 002/003; the SEED-SIZE NOTE scopes them to seed 001 and records what the harness reports on the 100-product catalog. Difference recorded only; adopted O4 / `MAX_PER_PAIR = 3` not re-opened.

### 4. Decisions 24–25 (`bc2d737`, `bfdc5b8`)

- Both docs-only, measured read-only on a TEST_DATABASE_URL branch through the real chain `loadCandidates → selectCandidatePool → selectOfferPrices → filterCandidates → computeCandidateScores → retainTopKPerRole → assembleBuildsForRecommendation → computeBuildScores → rankBuilds → selectDiverseTop` (`limit = TOP_N_PERSISTED (10)`, `maxPerPair = 3`).
- Decision 24 (`bc2d737`, +88): O4 re-evaluated on 001+002+003. GAMING configured (25) 25 ranked → naive top-10 1 pair → O4 k=3; OFFICE configured (25) same k=3; GAMING raised (100000) 35982 ranked → 3 pairs → k=10 (4 pairs); OFFICE raised 793 ranked → 1 pair → k=9 (3 pairs, pair-cap under-fill). Constant retained; O4 recorded as post-ranking filter that cannot manufacture diversity.
- Decision 25 (`bfdc5b8`, +103): upstream cause — shipped `max_builds_per_query = 25` truncates the depth-first `EXPANSION_ORDER` walk before CPU/GPU vary, so the 25-build pool holds exactly one (CPU, GPU) pair and no `MAX_PER_PAIR` value can yield more (any value > 1 only cuts 10 → 3). Raising the cap is necessary but insufficient: GAMING needs ≥ ~1600 builds for 4 pairs / k=10; OFFICE is pair-space-bounded at k=9 by the retention-starved catalog (Decision 23 D2: flat-40 scores + `top_k_per_role = 5` cut 17–18 of 20 new GPUs). Joint follow-up recorded: (a) seed-004 assessments, (b) cap above first GPU change, (c) fill-back question (`k < 10` acceptable?).

### 5. CONTEXT audit (`e8d5bc7`, plus `9b0f014` drift fixes)

- `e8d5bc7` (CONTEXT.md +8/-7, no code): benchmark rows corrected to live rows (`Seed TechPowerUp`, `Seed Cinebench R23 Multi`); Layer 4 empty-table claim replaced with real status; Engine 4 entry added; Decisions 24–25 pointers added; seeding/data-gap list reconciled post-003 (GPU + PSU-connector gaps closed; 7 NULL GPU dimensions + 3 NULL PSUs + radiator matrices + unverified prices remain).
- `9b0f014` (AGENTS.md/CONTEXT.md/ARCHITECTURE.md docs-only drift: decision range, Engine 6 status, price-carrier item) folded here as minor; see its commit message for the item list.

Verification (this D7 pass): read-only. `git status --porcelain` clean before edit; anchors re-checked against `4e70f9e` / `1693de3` / `752e884` / `bc2d737` / `bfdc5b8` / `e8d5bc7` stats, Decision 23/24/25 verdict blocks, `003` D1–D9 + D8 list, `measure-orchestrator.js:21-56`, `PROJECT_STATUS_REVIEW_2026-09-28.md:104`. No harness re-run (TEST_DATABASE_URL + operator approval required; must not be part of a docs-only fix), no `npm run test:unit` needed (docs-only; last run 829 pass / 0 fail per D5 entry).

## 2026-09-29 — audit A2: verify-docs.js + CI (item 8 DONE)

- New `scripts/verify-docs.js` (CRLF, Node built-ins only; `pg`/`dotenv` required only for `--live`). Offline checks: migration filenames contiguous `001..011`; decision log parses to 24 global headings + 5 nested Engine-3-local entries (local 4/5 = global 4/5, i.e. 26 global) with 30 `^Status:` lines; `AGENTS.md` cites `Decisions 1-26`; `docs/DECISION_INDEX.md` fresh (in-process `--check` semantics); `src/recommendation/` holds the 12 documented stages with `index.js` barrels everywhere except `persistence/` (imported via `persist-ranked`, the documented exception); `package.json` exposes `test:unit` + `gen:decisions` + `verify:docs`. `--live` adds read-only `information_schema` presence for the 15 core Layer 1–4 tables plus row counts as INFO only (instance-specific per A12: products/variants/offers/assessments/candidates — never asserted). Usage errors exit 2, any FAIL exits 1.
- New `.github/workflows/ci.yml`: `test:unit` + `gen-decision-index.js --check` + `verify-docs.js --offline` on push/PR (first CI in repo history; AGENTS.md §3 row updated from `none configured`).
- Collateral fix: `scripts/gen-decision-index.js` `--check` went STALE overnight (2026-09-28 → 29) because `stripDate` normalized only the `Generated <date>` line, not the `as of <date>` open-decisions line. Extended the normalizer to both; the voluntary regeneration dated 2026-09-29 was reverted (kept 2026-09-28) so the diff is the one-line `stripDate` fix only.
- `package.json`: added `verify:docs`. `AGENTS.md` §6 command table gained the `verify:docs` row. Audit `DOCUMENTATION_AUDIT_2026-09-28.md` §5 row 8 marked DONE (item 9 `OPEN_GAPS`/`SCHEMA_REFERENCE`/`GLOSSARY`/`TEST_MAP`/`RECIPES` still open for the second agent).
- Verification: `node scripts/verify-docs.js --offline` OK (6 PASS + INFO); `node scripts/verify-docs.js --live` OK (7 PASS + counts products=100 variants=22 offers=101 assessments=25 candidates=0, read-only vs `DATABASE_URL`); bad-flag run exits 2; `npm run verify:docs` OK; `gen-decision-index.js --check` OK; `npm run test:unit` 829 pass / 0 fail. No migration, no seed, no engine change.


## 2026-09-29 — audit A3: `docs/OPEN_GAPS.md` (item 9, part 1)

- New `docs/OPEN_GAPS.md` (CRLF): the consolidated open-gap register demanded by audit A3 / fix-order row 9. One register table `OG-01…OG-24` with class (`BLOCKING / IMPORTANT / ACCEPTABLE / FUTURE`), status (`OPEN / DEFERRED / UNVERIFIED / CLOSED`), owner (`data-research / engine-code / schema-migration / tooling / docs / —`) and sources, over exactly the four named sources: `ARCHITECTURE.md` §16 (all 16 gap rows), seed `002_catalog_expansion.sql` D1–D8, `ARCHITECTURE.md` §18 future list (multi-GPU recorded as missing from §16 — omission made visible), and audit D1–D12. Only OG-01 (seed-002 assessment research, the audit's one BLOCKING data gap) is BLOCKING; OG-09…OG-12 are the Decision 26 four-rule DEFERRED rows with their seed-time re-check triggers.
- Closed tables: audit D1–D12 as `C-01…C-08` (with resolution commits and residue pointers → OG-13/OG-09…12/OG-14); source rows no longer open as `C-09…C-13` (002 D3 by-design, 002 D6 connector half closed by seed 003, 002 D7 precedence, §18 clarification items 1–7, Engine 6 prose); plus an `A1–A12` recommendation-status table (A2 marked CLOSED 2026-09-29 per the other agent's row-8 banner; A5–A8 map to OG-24).
- Contradictions section resolves the audit's own example — GPU connectors open in 002 D6 prose vs closed by seed 003 → **CLOSED**, residue = OG-07 (7 NULL dimensions) + OG-08 (3 NULL PSUs); plus the four-rule "deferred not missing" framing and the corrected fresh-migration reason (OG-13 / U1/F13). Status-review K/U registers are linked, never duplicated; no live row/test figures are copied in (maintenance rule §6 keeps them from going stale).
- `AGENTS.md`: three pointer rows only — §2 doc-map sentence, §4 repository-map row, §9 source-of-truth row. §3/§6 were left untouched (A2's `verify:docs` territory in the same shared session).
- Audit file: A3 entry RESOLVED banner; §5 row 9 marked `OPEN_GAPS.md DONE 2026-09-29` with the A5–A8 remainder; final status paragraph now says item 8 DONE (A2's own row-8 banner) and item 9 partially done. Row 8 and the A2 entry were not touched.
- Verification (docs-only): `npm run test:unit` **829 pass / 0 fail**; `node scripts/verify-docs.js --offline` (A2's new gate) **6 PASS + OK, exit 0** — proves the AGENTS.md additions did not break `agents-decision-range` / decisions-parse / CRLF checks; `node scripts/gen-decision-index.js --check` clean (via verify-docs). Line endings: `docs/OPEN_GAPS.md` 115/115 CRLF; `git ls-files --eol` shows `i/lf w/crlf` for AGENTS/audit/notes as before (git normalizes on commit).
- **No commit.** The other agent's completed A2 work (`ci.yml`, `verify-docs.js`, `package.json`, `gen-decision-index.js`, its AGENTS/audit/notes edits) is staged in the same shared index; committing from this session would sweep it in. Both workstreams are left staged/unstaged in the working tree for coordinated commit (AGENTS §8: stage only intended files).

