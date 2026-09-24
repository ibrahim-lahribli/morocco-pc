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
5. `docs/RECOMMENDATION_ENGINE_DECISIONS.md` — the decision log (Decisions 1–22) with resolution
   status. Check here before changing engine behavior.
6. `database/migrations/*.sql` — THE authoritative schema. Column-level truth is in the SQL, not prose.

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
| Lint / format / typecheck / CI | none configured |

## 4. Repository map

| Path | What lives there |
|---|---|
| `CONTEXT.md` | Canonical project context and current status |
| `DEVELOPMENT_NOTES.md` | Operational lessons and verified commands |
| `docs/` | Engine architecture and decision log |
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
  code-unit based (never `localeCompare`).

## 6. Commands that exist

| Command | Purpose |
|---|---|
| `npm run test:unit` | Engine unit tests (`src/**/*.test.js`, no DB) |
| `npm run test:db` | DB connection + table listing |
| `npm run seed` | Apply `database/seeds/*.sql` (idempotent) |
| `node scripts/run-seeds.js --dry-run` | Report seed statements without executing |
| `node scripts/run-migrations.js` | Apply migrations — FRESH DB ONLY (not re-runnable) |
| `node --test scripts/lib/db-url.test.js` | Guard unit tests (not in `test:unit`) |
| `node scripts/test-compatibility.js` | Layer 1 compatibility/provenance fixtures |
| `node scripts/test-layer3.js --verify --functional` | Layer 3 schema (flags required) |
| `node scripts/test-layer4.js` | Layer 4 canonical schema |
| `node scripts/verify-schema.js` / `verify-constraints.js` / `verify-fks.js` | Read-only catalog checks |
| `node scripts/test-orchestrator-commit.js` / `test-orchestrator-full-run.js` | Write-path tests (TEST_DATABASE_URL only) |
| `node scripts/measure-orchestrator.js` | Decision 20 measurement harness (test-scratch only) |
| `git --no-pager log --oneline` / `diff` / `status --porcelain` | Repo inspection (use `--no-pager` in agent shells) |

No build, lint, typecheck, format, or E2E/browser commands exist. Do not invent or add them.

## 7. Verification workflow

1. Run `npm run test:unit` after any engine change; it needs no database.
2. For schema/DB work, use the read-only `verify-*.js` scripts and the targeted `test-*.js` scripts.
   Some require empty Layer 3 / Layer 4 tables and clean up transactionally.
3. Write-capable tests MUST go through `scripts/lib/db-url.js` and `TEST_DATABASE_URL` (an isolated
   Neon branch). Never run a write test against the shared `DATABASE_URL`.
4. Report results as **PASS / FAIL / BLOCKED**. Never claim a test passed unless it ran, and say so
   explicitly when an environment limitation prevents a run.
5. Note: a fresh `001→011` migration is NOT VERIFIED (no isolated empty database exists). Do not
   fake that result against the shared DB.

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

## 9. Source of truth

| Question | Trust this |
|---|---|
| Will this command/test run, how do I operate this? | `DEVELOPMENT_NOTES.md` |
| What exists / current status | `CONTEXT.md` |
| Exact table/column definitions | `database/migrations/*.sql` |
| Engine pipeline, compatibility, scoring, budget | `docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md` |
| Why engine behavior is the way it is (the contract) | `docs/RECOMMENDATION_ENGINE_DECISIONS.md` |
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
