# AGENTS.md

Entry point and map for AI coding agents working in this repository.
Keep this file short: it is an index, not the documentation. Deep detail lives in the linked files.

## 1. What this project is

`morocco-pc` is a PC build recommendation platform for the Moroccan market.
Given a recommendation query (budget, currency, use case, scoring model), the engine selects
compatible components, assembles builds, scores them, ranks them, picks a diverse top set, and
persists the results.

It is currently a Node.js library plus a PostgreSQL schema — NOT a running service:
there is no HTTP server, no API layer, no frontend, and no authentication. The only entry
points are the engine's public barrels (`src/recommendation/*/index.js`) and the `scripts/` CLIs.

## 2. Read in this order

1. `git status` — do this FIRST. This is a shared checkout; other agents may have changed files.
2. `CONTEXT.md` — canonical project context: status, the four layers, schema, migration rules,
   design decisions. Authoritative for "what exists today."
3. `DEVELOPMENT_NOTES.md` — operational lessons: verified commands, failure modes, DB / Git /
   testing lessons. Read before touching migrations or DB scripts.
4. `docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md` — the engine contract (pipeline, HARD/SOFT rules,
   compatibility policy, scoring, budget, reproducibility, known gaps).
5. `docs/RECOMMENDATION_ENGINE_DECISIONS.md` — the decision log (Decisions 1–26). Check here
   before changing engine behavior. Every entry opens with a normalized `Status:` line, so
   `grep -n "^Status:" docs/RECOMMENDATION_ENGINE_DECISIONS.md` answers "is X decided, and how?"
   To ADD a decision entry, follow `docs/decisions/TEMPLATE.md` (audit A10) — its post-write
   checklist covers the gates that will fail if steps are skipped.
   For one table with number / title / status / date / line anchor, use the generated
   `docs/DECISION_INDEX.md` (regenerate: `npm run gen:decisions`; staleness gate:
   `node scripts/gen-decision-index.js --check`). Numbering note: there are no `## Decision 4` /
   `## Decision 5` headings — Decisions 4–5 are nested sub-headings under "Engine 3 contract
   decisions" (the index reconciles this explicitly).
6. `database/migrations/*.sql` — THE authoritative schema. Column-level truth is in the SQL, not prose.

For a current map of what is stale and why: `docs/DOCUMENTATION_AUDIT_2026-09-28.md` (per-finding doc drift) and
`docs/PROJECT_STATUS_REVIEW_2026-09-28.md` (whole-project weaknesses W1–W12, options A–I, known/unverified registers K/U).
For what is still open — gaps, deferrals, unverified items, closed-findings residue — `docs/OPEN_GAPS.md` is the
consolidated register (ARCHITECTURE §16 + seed 002 D1–D8 + §18 futures + audit D1–D12, each with class/status/owner).

## 3. Technology stack

| Area | Actual |
|---|---|
| Language | Node.js, CommonJS (`require`, `'use strict'`), no TypeScript, no build step |
| Runtime deps | `pg`, `dotenv` only |
| Database | PostgreSQL on Neon (cloud); single shared dev DB, NOT disposable |
| Data access | Raw parameterized SQL via `pg`; no ORM |
| Engine | Pure-JS modules under `src/recommendation/` |
| Tests | Node's built-in test runner (`node --test`); no Jest/Vitest/Playwright |
| Package manager | npm (`package-lock.json` committed) |
| Frontend / mobile | none |
| Isolated write tests | Neon branch via `TEST_DATABASE_URL` + `scripts/lib/db-url.js` guard |
| Lint / format / typecheck / CI | GitHub Actions CI (`.github/workflows/ci.yml`: `test:unit` + `gen-decision-index --check` + `verify-docs --offline`); no lint/format/typecheck |

## 4. Repository map

| Path | What lives there |
|---|---|
| `CONTEXT.md` | Canonical project context and current status |
| `DEVELOPMENT_NOTES.md` | Operational lessons and verified commands |
| `docs/` | Engine architecture, decision log, and dated audit/status reports |
| `docs/DECISION_INDEX.md` | GENERATED decision lookup table (number/title/status/date/line) — never edit by hand |
| `docs/OPEN_GAPS.md` | Consolidated open-gap register (architecture §16 + seed 002 D1–D8 + §18 futures + audit D1–D12) with class/status/owner — hand-maintained |
| `docs/SCHEMA_REFERENCE.md` | GENERATED column-level schema lookup (information_schema) — never edit by hand; `npm run gen:schema` |
| `docs/DATA_STATE.md` | GENERATED live row-count/coverage snapshot — instance-specific, never cite as a permanent claim |
| `docs/GLOSSARY.md` | Load-bearing vocabulary (status vocabulary, decision ids, the `D2` vs `Decision 2` collision) |
| `docs/TEST_MAP.md` | Which test pins which contract — check before changing pinned behavior |
| `docs/RECIPES/` | Task checklists: add a migration/seed/scoring-model/pair-evaluator/stage/status-claim |
| `database/migrations/` | Authoritative schema (`001`–`011`, apply in filename order) |
| `database/seeds/` | DML-only, idempotent seed data |
| `database/LAYER4_RECONCILIATION_PLAN.md` | Historical Layer 4 reconciliation record |
| `scripts/` | CLIs: migrations, seeds, schema verifiers, engine checks |
| `scripts/lib/db-url.js` | `TEST_DATABASE_URL` guard for write-capable tests |
| `src/recommendation/` | ALL application code — the engine |

`src/recommendation/` has one directory per pipeline stage: `compatibility`, `candidates`,
`offers`, `filtering`, `retention`, `assembly`, `scoring`, `query`, `ranking`, `persistence`,
`orchestrator`, `explanation`. Most expose a boundary-only `index.js` barrel; `persistence/` is
the exception — it has no barrel and is imported directly via `persistence/persist-ranked`.

For the detailed engine/module structure — which stage owns what, in pipeline order — read
`docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md` (§2 "Complete pipeline", §17 "Future implementation
boundaries") and the `index.js` header comment of the module you are changing. That detail is
deliberately not duplicated here.

## 5. Architecture at a glance

- **Four data layers** in PostgreSQL: Layer 1 Catalog/Hardware, Layer 2 Performance/Assessment,
  Layer 3 Market, Layer 4 Recommendation. The pure-JS engine modules mirror the schema.
- **Pure engine, impure edges.** Engine modules perform no DB access, no clock reads, no
  randomness, and never mutate inputs. DB access lives only in the loaders (`candidates/loader`,
  `filtering/context-loader`, `scoring/load-*`, `query/`) and the orchestrator.
- **Orchestration is boundary-only.** `orchestrator/run.js` wires loaders and pure stages inside
  a caller-owned `REPEATABLE READ READ ONLY` snapshot; `orchestrator/commit.js` owns the single
  write transaction; `orchestrator/full-run.js` composes snapshot → rank → diversity → explanation
  → commit. Keep new composition there, not inside engine modules.
- **Status vocabulary is load-bearing:** `PASS | FAIL | UNKNOWN | CONDITIONAL`. `NULL` means
  UNKNOWN, and UNKNOWN must never be treated as PASS or FAIL.
- **Determinism is a requirement**, not a nicety: identical DB state + query + scoring-model
  version must yield identical candidates, scores, ranks, and text. Tie-breaks are fixed and
  code-unit based (never `localeCompare`). One known gap: retention ties fall through to random
  `product.id`, so which products reach builds is NOT stable across a database reset.

## 6. Commands that exist

| Command | Purpose |
|---|---|
| `npm run test:unit` | Engine unit tests (`src/**/*.test.js`, no DB) |
| `npm run test:db` | DB connection + table listing |
| `npm run seed` | Apply `database/seeds/*.sql` (idempotent) |
| `npm run gen:decisions` | Regenerate `docs/DECISION_INDEX.md` from the decision log (`node scripts/gen-decision-index.js --check` fails when it is stale) |
| `npm run gen:schema` | Regenerate `docs/SCHEMA_REFERENCE.md` + `docs/DATA_STATE.md` from the live DB (`node scripts/gen-schema-reference.js --check` fails when stale; needs `DATABASE_URL` — even `--check`, which regenerates in memory and diffs; no-arg run rewrites both files) |
| `npm run verify:docs` | Verify fact-shaped doc claims vs tree (offline) or + read-only DB (`--live`) |
| `node scripts/verify-docs.js --live` | Adds read-only live-DB checks: 15 core tables + counts (INFO), and the schema-digest gate — FAILs when `docs/SCHEMA_REFERENCE.md`'s `schema-digest:` line no longer matches the live tables/columns/enums (fix: `npm run gen:schema`) |
| `node scripts/run-seeds.js --dry-run` | Report seed statements without executing |
| `node scripts/run-migrations.js` | Apply migrations — FRESH DB ONLY (not re-runnable) |
| `node --test scripts/lib/db-url.test.js` | Guard unit tests (not in `test:unit`) |
| `node scripts/test-compatibility.js` | Layer 1 compatibility/provenance fixtures |
| `node scripts/test-layer3.js --verify --functional` | Layer 3 schema (flags required; needs ALL THREE Layer 3 tables empty — `store` too; non-empty on shared DB AND on the test branch as of 2026-09-28, so it cannot pass in either environment today) |
| `node scripts/test-layer4.js` | Layer 4 canonical schema (unguarded: reads `DATABASE_URL`; writes `TestL4%` fixtures inside one transaction with final ROLLBACK; does NOT require empty Layer 4 tables) |
| `node scripts/verify-schema.js` / `verify-constraints.js` / `verify-fks.js` | Read-only catalog checks |
| `node scripts/test-orchestrator-commit.js` / `test-orchestrator-full-run.js` | Write-path tests (TEST_DATABASE_URL only) |
| `node scripts/check-og01-coverage.js` | OG-01 assessment-coverage gate (read-only; needs `DATABASE_URL`; exits 1 while any active product has no assessment rows; `--strict` also fails partial coverage) |
| `node scripts/measure-orchestrator.js` | Decision 20 measurement harness (test-scratch only) |
| `git --no-pager log --oneline` / `diff` / `status --porcelain` | Repo inspection (use `--no-pager` in agent shells) |

Command gotchas (verified 2026-09-28):

- `node scripts/test-layer3.js` needs BOTH `--verify --functional` AND empty Layer 3 tables (all
  three, `store` included), so it cannot pass against `DATABASE_URL` now that the shared DB holds
  rows — and not against `TEST_DATABASE_URL` either: the TEST branch holds the same 2/101/101 rows
  (measured 2026-09-28; a branch is a parent snapshot/reset, never an empty database).
  The failure is clean: preflight throws before any write.
- Only `measure-orchestrator.js` and the two `test-orchestrator-*.js` scripts use the
  `TEST_DATABASE_URL` guard; `test-layer3.js` / `test-layer4.js` / `verify-*.js` still read `DATABASE_URL`.
- `TEST_DATABASE_URL` went UNREACHABLE on 2026-10-01 (`password authentication failed`, old host
  `ep-old-cherry-...`) and was RE-CREATED the same day as `ep-weathered-art-...` (verify with a
  1-row SELECT before relying on any guarded script — hosts are recorded only in `.env`, never in
  docs). All three guarded scripts RE-VERIFIED GREEN 2026-10-01 on the restored branch
  (`preflight {products:100, models:1, offers:101, assessments:112, queries:0}`):
  `test-orchestrator-full-run.js` 28 pass / 0 fail; `measure-orchestrator.js` Decision-20
  criteria 1+2 MET for GAMING and OFFICE. Historical note: while the branch was dead, seed-004a
  reach was measured by read-only pipeline replication on the shared DB (stages 4-11 of
  `orchestrator/run.js` need only SELECTs until stage 12 persistence) — see
  `DEVELOPMENT_NOTES.md` 2026-10-01.
- `node scripts/run-seeds.js --dry-run` counts statements with a naive `split(';')`, so a semicolon
  inside a SQL comment inflates the count (Postgres ignores it; the number is just misleading).

No build, lint, typecheck, format, or E2E/browser commands exist. Do not invent or add them.

## 7. Verification workflow

1. Run `npm run test:unit` after any engine change; it needs no database.
2. For schema/DB work, use the read-only `verify-*.js` scripts and the targeted `test-*.js` scripts.
   Only `test-layer3.js` requires empty tables (all three Layer 3 tables); `test-layer4.js` does not —
   it only writes `TestL4%` fixtures inside one transaction with a final ROLLBACK. Both still read
   `DATABASE_URL` (unguarded — the known gap recorded in `DEVELOPMENT_NOTES.md`, not a pattern to
   copy for new tests).
3. Write-capable tests MUST go through `scripts/lib/db-url.js` and `TEST_DATABASE_URL` (an isolated
   Neon branch). Never run a write test against the shared `DATABASE_URL`.
4. Report results as **PASS / FAIL / BLOCKED**. Never claim a test passed unless it ran, and say so
   explicitly when an environment limitation prevents a run.
5. Note: the fresh `001→011` migration was VERIFIED 2026-09-30 (OG-13: empty-DB replay on a
   throwaway Neon DB; 39/39 tables, 336/336 columns, 14/14 enums — see `docs/OPEN_GAPS.md` C-15).
   Do not re-run it against the shared DB; the surfaced live-only drift is tracked as OG-25.

## 8. Hard rules

- **Never reset, drop, truncate, or restore the shared Neon database.** It is the only dev DB.
- **Never rewrite or renumber a committed migration.** Schema changes require a new sequential
  `NNN_short_description.sql`.
- **Never re-run the full migration runner on the live DB** — `002_enums.sql` uses a bare
  `CREATE TYPE`, so it is not idempotent. Apply new files individually.
- **Never commit `.env`, `node_modules`, or secrets.** `.env.example` holds key names only.
- **Never add a migration just to make a test pass.**
- Keep engine modules pure; put DB access in loaders/orchestrator only.
- Keep `component_role` and other enum vocabularies in sync with the migrations; never drop or
  destructively alter an enum.
- Preserve `NULL` = UNKNOWN and UNKNOWN ≠ PASS in any new code or migration.
- Do not create compatibility tables for relationships that can be derived from numeric specs
  (GPU↔case, GPU↔PSU).
- When engine code lands, update `CONTEXT.md`'s status sections in the same session — stale status
  has caused re-implementation attempts before.
- Stage only intended files; check `git status` first (shared checkout).
- Preserve the repo's line endings: root `AGENTS.md` is LF; `CONTEXT.md`, `DEVELOPMENT_NOTES.md`,
  `docs/*.md` and `database/**` are CRLF. Match the file you edit — a stray-LF file reads as a
  whole-file diff.

## 9. Source of truth

| Question | Trust this |
|---|---|
| Will this command/test run, how do I operate this? | `DEVELOPMENT_NOTES.md` |
| What exists / current status | `CONTEXT.md` |
| Exact table/column definitions | `database/migrations/*.sql` (generated lookup: `docs/SCHEMA_REFERENCE.md`) |
| Engine pipeline, compatibility, scoring, budget | `docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md` |
| Why engine behavior is the way it is (the contract) | `docs/RECOMMENDATION_ENGINE_DECISIONS.md` |
| Which decisions exist, and their current status | each entry's `Status:` line + the generated `docs/DECISION_INDEX.md` (lookup aid, never a source of truth) |
| What is still open (gaps, deferrals, unverified items) | `docs/OPEN_GAPS.md` (consolidated register; the underlying sources stay authoritative individually) |
| Vocabulary/inputs/outputs of one module | that module's `index.js` header comment |
| Layer 4 reconciliation history | `database/LAYER4_RECONCILIATION_PLAN.md` |

When sources conflict, prefer the more authoritative one, in this order:

1. `database/migrations/*.sql` and the executable code (with its tests) — what the system actually does.
2. `docs/RECOMMENDATION_ENGINE_DECISIONS.md` — the intended engine contract.
3. `docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md` — the design the decisions refine.
4. `CONTEXT.md` — status, which drifts behind the code.
5. `DEVELOPMENT_NOTES.md` — dated operational notes (may describe past states).

Do not silently pick a side: if prose and code disagree, follow the code and report the drift.

## 10. Known doc drift — verify before trusting

- **Engine 6 status is stale in prose.** `src/recommendation/explanation/` exists and
  `orchestrator/full-run.js` wires it (Decision 22 items 2/3/4, plus 7 and 8a/8b), while some
  docs still describe Engine 6 as planned/unimplemented. Decision 22 is the Engine 6 contract —
  do not re-implement it from a stale status line.
- **`scripts/verify-hardware-schema.js` is BROKEN and not safe to re-run** (FK violation in its
  startup cleanup; its fixtures accumulate). Use the read-only `verify-schema.js` /
  `verify-constraints.js` / `verify-fks.js` instead. Details: `DEVELOPMENT_NOTES.md`, 2026-09-19 entry.
- **`database/LAYER4_RECONCILIATION_PLAN.md` — status header FIXED 2026-09-28 (audit D1).** It now says IMPLEMENTED
  with a per-item applied/deferred ledger; §5.4 VERIFIED 2026-09-30 (OG-13).
- **`ARCHITECTURE.md` is dated 2026-09-12 and cites no decision after 9.** Decision 18 item 7
  records that its stage table and stage-9 ranking wording are superseded with the doc refresh
  "deferred", so its §2/§13 rank ordering and its "templates versioned with the scoring model"
  claim contradict shipped code. It is a design baseline, not current behaviour.
- **Four HARD rules in `ARCHITECTURE.md` §5.3/§6 are implemented NOWHERE**: cooler
  `max_tdp_watts` vs CPU TDP, air-cooler `height_mm` vs `case_spec.max_cpu_cooler_height_mm`,
  RAM `module_count` vs `dimm_slots`, and total RAM capacity vs `max_memory_capacity_gb`. Those
  columns exist and no non-test code reads them — do not assume these constraints are enforced. **Decision 26 (2026-09-28) records all four as EXPLICITLY DEFERRED and UNENFORCED** - 0 live violations on the shared catalog as of that date, and a binding trigger: re-run the four violation queries before merging any cooler/RAM/case/motherboard seed.
- **GPU/PSU high-TGP connector escalation IS implemented (Decision 26, 2026-09-28).** `gpu.js`
  Rule 11 returns FAIL `GPU_PSU_CONNECTOR_NULL_HIGH_TGP` when a required, KNOWN connector's PSU
  availability is NULL and `gpu_board_spec.board_tgp_watts >= 200` (inclusive, finite); the
  escalation is decided BEFORE the unknown-name branch, so FAIL outranks UNKNOWN. NULL GPU
  requirements, unknown connector NAMES, and a NULL/non-finite TGP stay UNKNOWN; a verifiable
  deficit (including a 0 count) keeps `GPU_PSU_CONNECTOR_UNAVAILABLE`. `board_tgp_watts` is
  carried by `filtering/context-loader.js` + `filtering/filter.js`; Engine 3 inherits the FAIL
  through the shared `evaluateGpuPsuPair` evaluator with no assembly change.

- **Decision 22 status - FIXED 2026-09-28 (audit D3).** Its `Status:` line said implementation was
  future work; it now records items 1-5 as IMPLEMENTED with a dated UPDATE block in the decision
  itself. Engine 6 is shipped - do not re-implement it.
Full findings, with evidence: `docs/DOCUMENTATION_AUDIT_2026-09-28.md` — every finding (D1–D12) plus items 8/9-part-1 was independently re-verified 2026-09-29 (all green: 829 unit tests, verify:docs offline + live, decision-index `--check`); treat its RESOLVED banners as trustworthy and do not re-open the findings without new evidence. **The audit is CLOSED (2026-09-29/30)**: all recommendations A1–A12 landed and the last residue, OG-13 (fresh 001→011 empty-DB run), was RAN AND VERIFIED 2026-09-30 — see `docs/OPEN_GAPS.md` OG-13 / C-15. The drift that run surfaced is tracked forward as OG-25 (schema-migration).
- When a session's job is to verify prior work, verify against the working tree and re-run the mechanical gates (not just the banners), then append a dated VERIFIED note to the audit doc itself so the next session does not repeat the pass.
- Gap-closure propagation: when a gap closes in `docs/OPEN_GAPS.md`, grep the tree for its ID + key phrases in the SAME commit — closures have landed twice now without the same-session propagation the register §6 rule requires (OG-13 needed a follow-up 6-file sync, commit 7d336cd). Shape: `grep -rn "<OG-id>|<key phrase>" --include="*.md" .`
- Dated RESOLVED/CLOSED banners in audit/status docs are historical records — update only current status sections (`CONTEXT.md`, AGENTS §10, register rows); never retro-edit an old banner, mark supersession in the newer one instead.
- Generated-docs freshness: `gen-decision-index --check` is DB-free (runs in CI); `SCHEMA_REFERENCE.md` is gated by a schema digest — `verify-docs --live` hashes the DB's tables/columns/enums and fails when the digest line in the doc no longer matches (run `npm run gen:schema` after any seed or migration). The digest query is duplicated in `gen-schema-reference.js` and `verify-docs.js` — change both together. `DATA_STATE.md` is deliberately NOT digest-gated: its figures describe the instance and drift legitimately.
