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

1. `CONTEXT.md` — canonical project context: status, the four layers, schema, migration rules,
   design decisions. Authoritative for "what exists today."
2. `DEVELOPMENT_NOTES.md` — operational lessons: verified commands, failure modes, DB / Git /
   testing lessons. Read before touching migrations or DB scripts.
3. `docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md` — the engine contract (pipeline, HARD/SOFT rules,
   compatibility policy, scoring, budget, reproducibility, known gaps).
4. `docs/RECOMMENDATION_ENGINE_DECISIONS.md` — the decision log (Decisions 1–22) with resolution
   status. Check here before changing engine behavior.
5. `database/migrations/*.sql` — THE authoritative schema. Column-level truth is in the SQL, not prose.
6. `git status` — this is a shared checkout; other agents may have changed files.

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

Engine modules (`src/recommendation/`). Most expose a boundary-only `index.js` barrel;
`persistence/` is the exception — it is imported directly via `persistence/persist-ranked`:

- `compatibility/` — Engine 1, pure compatibility resolver
- `candidates/` — Engine 2A/2B/2C: contracts, DB loader, pool selector
- `offers/` — Engine 2 Stage 1: offer price selection
- `filtering/` — Engine 2D: DB context loader + pure hard-compatibility filter
- `retention/` — Decision 12/14: top-K per role
- `assembly/` — Engine 3: build assembly (pure)
- `scoring/` — Decision 11 scoring-model loader + Engine 4 scoring
- `query/` — `recommendation_query` input loader
- `ranking/` — Engine 5a ranking + Decision 20 diversity selection (pure)
- `persistence/` — Engine 5b: validation + DML construction
- `orchestrator/` — composition only: no-writes run, snapshot transaction, commit, full run
- `explanation/` — Engine 6 (planned; contract in Decision 22)

## 5. Architecture at a glance

- **Four data layers** in PostgreSQL: Layer 1 Catalog/Hardware, Layer 2 Performance/Assessment,
  Layer 3 Market, Layer 4 Recommendation. The pure-JS engine modules mirror the schema.
- **Pure engine, impure edges.** Engine modules perform no DB access, no clock reads, no
  randomness, and never mutate inputs. DB access lives in the loaders (`candidates/loader`,
  `filtering/context-loader`, `scoring/load-*`, `query/`) and the orchestrator.
- **Orchestration is boundary-only.** `orchestrator/run.js` wires loaders and pure stages inside
  a caller-owned `REPEATABLE READ READ ONLY` snapshot; `orchestrator/commit.js` owns the single
  write transaction; `orchestrator/full-run.js` composes snapshot → rank → diversity → commit.
- **Pipeline:** query → 2B/2C pool → Stage 1 offers → 2D filtering → retention → Engine 3
  assembly → Engine 4 scoring → ranking → diversity → persistence.
- **Status vocabulary is load-bearing:** `PASS | FAIL | UNKNOWN | CONDITIONAL`. `NULL` means
  UNKNOWN and UNKNOWN must never be treated as PASS. UNKNOWN survives with a penalty; FAIL rejects.
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

No build, lint, typecheck, format, or E2E/browser commands exist.

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

## 9. Where to look for more

| Question | Go to |
|---|---|
| What exists / current status | `CONTEXT.md` |
| Why a design choice was made | `docs/RECOMMENDATION_ENGINE_DECISIONS.md` |
| Engine pipeline / compatibility / scoring rules | `docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md` |
| Exact table/column definitions | `database/migrations/*.sql` |
| How to run things / known failure modes | `DEVELOPMENT_NOTES.md` |
| Layer 4 reconciliation history | `database/LAYER4_RECONCILIATION_PLAN.md` |
| Per-module contracts and vocabulary | the module `index.js` header comments |

## 10. Known doc drift (verify before trusting)

- `CONTEXT.md` lists Engine 6 as not implemented; Decision 22 items 7 and 8a/8b (budget exposure,
  `compatibility_notes` carry) have already landed in code. Treat Decision 22 as the current
  Engine 6 contract.
- `scripts/verify-hardware-schema.js` is currently BROKEN and not safe to re-run
  (see `DEVELOPMENT_NOTES.md`, 2026-09-19 entry).
