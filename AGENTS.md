# AGENTS.md

Entry point and map for AI coding agents working in this repository. This file is an **index**:
global rules and links. Implementation detail belongs to the owning document, and each layer's
working instructions live in its own `AGENTS.md` (section 6).

## 1. What this project is

`morocco-pc` is a PC build recommendation platform for the Moroccan market. Given a recommendation
query (budget, currency, use case, resolution), the engine selects compatible components, assembles
builds, scores them, ranks them, picks a diverse top set, explains them and persists the pass.

The engine is a Node.js library plus a PostgreSQL schema. Its stages are separable into pure logic
and SQL-executing loaders/persistence (the architecture RFC §6.2 records that 15 non-ingestion
modules execute SQL). Two thin layers sit on it and own no
engine logic: `apps/api/` (Fastify, the HTTP contract, the connection pool) and `apps/web/`
(Next.js App Router, its own package and lockfile). There is no authentication anywhere in the tree.
`apps/offer-ingestion` does not exist yet; offer ingestion today runs through `scripts/` and
`src/recommendation/ingestion/`.

The repository's layout follows the architecture RFC
([`docs/architecture/SYSTEM_ARCHITECTURE_AND_PROJECT_SEPARATION_RFC.md`](docs/architecture/SYSTEM_ARCHITECTURE_AND_PROJECT_SEPARATION_RFC.md)):
architecture decisions A1-A6 are approved. **Two steps are implemented.** The database-guard package
boundary: the write-target guard lives in `packages/database-guard/` (PR #27, merged 2026-11-11). The
`recommendation-core` boundary harness (step 4B PR 1, PR #29): a loadable `src/index.js` that exports
nothing, a purity gate over every file under `src/` (`npm run test:core`), and a committed export snapshot
at `test/export-surface.json`. **The extraction itself has not started**: no recommendation module has
moved, the core entry point is deliberately empty, `packages/recommendation-runtime/` still carries only
its manifest and planning documentation, and the RFC remains PROPOSED for the remaining work. B1-B8 are
open. Do not start the extraction from a documentation task.

## 2. Read order

0. `git status` and `git log --oneline -5` — FIRST. This is a shared checkout; another agent may have
   changed files since the session started.
1. [`README.md`](README.md) — one page: what this is, safe quick start, navigation.
2. [`CONTEXT.md`](CONTEXT.md) — the current state: what exists, which environment is which.
3. [`docs/OPEN_POINTS.md`](docs/OPEN_POINTS.md) — what is still open (R-01 … R-23). This is the ONLY
   answer to "what is left"; never reconstruct a backlog from a dated report.
4. [`docs/ROADMAP.md`](docs/ROADMAP.md) — the programme and sprint ledger.
5. [`docs/engine/ARCHITECTURE.md`](docs/engine/ARCHITECTURE.md) — the engine contract (pipeline,
   HARD/SOFT rules, compatibility policy, scoring, budget, known gaps).
6. [`docs/RECOMMENDATION_ENGINE_DECISIONS.md`](docs/RECOMMENDATION_ENGINE_DECISIONS.md) — Decisions
   1-65. Every entry opens with a `Status:` line, so `grep -n "^Status:"` answers "is X decided, and
   how?". Adding an entry follows [`docs/decisions/TEMPLATE.md`](docs/decisions/TEMPLATE.md).
7. [`docs/DECISION_INDEX.md`](docs/DECISION_INDEX.md) — GENERATED lookup (number/title/status/date/
   line). Never edit it by hand; `node scripts/gen-decision-index.js --check` fails when stale.
8. `database/migrations/*.sql` — THE authoritative schema (`001` … `023`, applied in filename order,
   tracked in `schema_migrations`). Column-level truth is the SQL, not prose.
9. [`DEVELOPMENT_NOTES.md`](DEVELOPMENT_NOTES.md) — dated operational evidence: verified commands and
   failure modes. Read it before touching migrations, seeds or DB scripts.

## 3. Source of truth

| Question | Trust this |
|---|---|
| What the system actually does | `database/migrations/*.sql` and the code with its tests |
| Why engine behavior is the way it is | `docs/RECOMMENDATION_ENGINE_DECISIONS.md` |
| Engine design and policy | `docs/engine/ARCHITECTURE.md` |
| Loader, snapshot and transaction contract | `packages/recommendation-runtime/docs/LOADERS_AND_TRANSACTIONS.md` |
| The published HTTP contract | `contract/openapi-<major>.<minor>.<patch>.json` |
| The HTTP surface | `docs/api/CONTRACT.md` + `apps/api/src/` module headers |
| Ingestion design | `docs/ingestion/PIPELINE_DESIGN.md` |
| What exists / current status | `CONTEXT.md` |
| What is still open | `docs/OPEN_POINTS.md` (evidence: `docs/OPEN_GAPS.md`) |
| How to run and operate things | `DEVELOPMENT_NOTES.md` |
| Exact columns, enums, indexes | `database/migrations/` then generated `docs/SCHEMA_REFERENCE.md` |
| A module's vocabulary and inputs | that module's `index.js` header comment |

Precedence when they conflict: code + migrations (with tests) > decision log > architecture design >
`CONTEXT.md` > `DEVELOPMENT_NOTES.md`. Follow the code, and report the drift rather than silently
picking a side.

## 4. Repository map

| Path | What lives there |
|---|---|
| `README.md` | orientation and navigation |
| `CONTEXT.md` | current state (not history) |
| `DEVELOPMENT_NOTES.md` | dated operational lessons and measurements |
| `docs/OPEN_POINTS.md`, `docs/OPEN_GAPS.md` | open-points register and its evidence trail |
| `docs/ROADMAP.md` | programme, sprint ledger, owner-gated backlog |
| `docs/GLOSSARY.md`, `docs/TEST_MAP.md` | load-bearing vocabulary; which test pins which contract |
| `docs/RECOMMENDATION_ENGINE_DECISIONS.md` | append-only decision log (Decisions 1-65) |
| `docs/engine/` | pure engine contract, engine recipes, engine agent instructions |
| `docs/api/` | the HTTP contract (`CONTRACT.md`) |
| `docs/ingestion/` | ingestion design, recipes, agent instructions |
| `docs/database/` | migration, seed and role recipes |
| `docs/RECIPES/` | deployment, release and documentation-governance recipes |
| `docs/decisions/`, `docs/briefs/`, `docs/architecture/`, `docs/archive/` | templates, epic briefs, the RFC, superseded documents |
| `docs/DECISION_INDEX.md`, `docs/SCHEMA_REFERENCE.md`, `docs/DATA_STATE.md` | GENERATED — never hand-edit |
| `database/migrations/` | authoritative schema, `001`–`023` |
| `database/seeds/` | idempotent DML-only seed data |
| `src/recommendation/` | the engine, one directory per pipeline stage |
| `apps/api/` | the HTTP API (Fastify, TypeBox contracts, SQL repository, Dockerfile) |
| `apps/web/` | the Next.js frontend, own manifest and lockfile |
| `scripts/` | CLIs: migrations, seeds, schema checks, gates, measurements |

## 5. Hard rules (global)

- **Never reset, drop, truncate or restore the shared Neon database.** It is the only dev database.
- **Write-capable tests and scripts go through `packages/database-guard/src/index.js` / `TEST_DATABASE_URL`.** Never
  run a write test against `DATABASE_URL`. A real-database apply needs a recorded restore point and
  leaves an audit line in `database/migration-applies.jsonl`.
- **Never rewrite or renumber a committed migration**, and never bypass the ledger: apply through
  `scripts/run-migrations.js` (`001` … `023`), which applies only the pending tail.
- **Never commit `.env`, `node_modules` or secrets.** `.env` is never read, printed or copied by an
  agent; use the variable names only.
- **Generated documents stay generated.** `docs/DECISION_INDEX.md`, `docs/SCHEMA_REFERENCE.md` and
  `docs/DATA_STATE.md` are written only by `npm run gen:decisions` / `npm run gen:schema`.
- **Preserve line endings.** Root `AGENTS.md` and `CLAUDE.md` are LF; `CONTEXT.md`,
  `DEVELOPMENT_NOTES.md`, `docs/**` and `database/**` are CRLF. Match the file you edit.
- **Shared checkout.** Stage explicit paths (`git commit -- <paths>`), re-read `git status`/`git log`
  before relying on a row id or file state, and never rewrite another agent's commit.
- **`PASS | FAIL | UNKNOWN | CONDITIONAL` is load-bearing.** NULL is UNKNOWN; UNKNOWN is never PASS
  and never FAIL. Determinism is a requirement, not a preference.
- **Do not change a count, test figure, decision range or migration range without re-measuring it.**
- **A gate verdict is evidence; prose is a claim.** Report PASS / FAIL / BLOCKED and say which ran.

## 6. Layer instructions

Read the owning file before changing that layer:

| Layer | Agent instructions | Authoritative document |
|---|---|---|
| Engine (pure stages) | [`docs/engine/AGENTS.md`](docs/engine/AGENTS.md) | `docs/engine/ARCHITECTURE.md` |
| API | [`apps/api/AGENTS.md`](apps/api/AGENTS.md) | `docs/api/CONTRACT.md` |
| Database (schema, seeds, role) | [`database/AGENTS.md`](database/AGENTS.md) | `database/migrations/` |
| Offer ingestion | [`docs/ingestion/AGENTS.md`](docs/ingestion/AGENTS.md) | `docs/ingestion/PIPELINE_DESIGN.md` |
| Frontend | [`apps/web/AGENTS.md`](apps/web/AGENTS.md) | `apps/web/README.md` |

## 7. Verification

| Command | Purpose |
|---|---|
| `npm run test:unit` | engine unit tests (`src/**/*.test.js`, no DB) |
| `npm run test:scripts` | every `scripts/lib/*.test.js` suite (run after touching `scripts/`) |
| `npm run test:database-guard` | the extracted guard's own suite (`packages/database-guard/test/*.test.js`) |
| `npm run test:core` | the pure core's boundary harness (`packages/recommendation-core/test/*.test.js`): loader, export snapshot, purity scan |
| `npm run test:api` | HTTP API unit tests (DB-free, `fastify.inject`) |
| `npm run check:contract` | one versioned `contract/openapi-*.json`; fails on any second copy |
| `node scripts/check-openapi-compatibility.js --base=origin/master` | contract compatibility against a Git ref (ADDITIVE passes, unapproved BREAKING fails) |
| `npm run test:api:db` | HTTP end-to-end against the TEST branch (nightly; writes) |
| `npm run verify:docs` | doc-claim gates; `--offline` for a DB-free run, `--live` adds read-only DB checks |
| `node scripts/gen-decision-index.js --check` | decision index freshness |
| `npm run verify:replay -- --test-db` | replay every migration into an empty DB and diff by definition |
| `node scripts/run-migrations.js --check` | pending migrations |
| `git diff --check` | whitespace errors |

There is no build, lint or typecheck at the repository root — do not invent one. `apps/web` is its own
package and the exception (see its `AGENTS.md`).

## 8. Documentation commands

| Command | Purpose |
|---|---|
| `npm run gen:decisions` | regenerate `docs/DECISION_INDEX.md` |
| `npm run gen:schema` | regenerate `docs/SCHEMA_REFERENCE.md` + `docs/DATA_STATE.md` (needs `DATABASE_URL`) |
| `npm run verify:docs` | verify fact-shaped doc claims against the tree (offline) or the DB (`--live`) |

Adding a Decision N+1 breaks `verify-docs` by design (it asserts the heading/`Status:` counts and the
"Decisions 1-N" range in this file). Bump the counts in `scripts/verify-docs.js` and the range here in
the same commit; regenerate the index. Editing an entry's `Status:` line also makes the generated
index stale.

## 9. Known drift — check before trusting

These are the traps that have cost the most time; detail and evidence live in
`DEVELOPMENT_NOTES.md` and the owning layer's `AGENTS.md`.

- **Acceptance criteria are easy to attribute to the wrong decision.** PI-1 (pool independence) is
  Decision 23 criterion 3, not Decision 20.
- **The engine architecture document is a design baseline, dated 2026-09-12.** Where it disagrees with
  the decision log or the code, the code wins.
- **All four Decision 26 item B rules are ENFORCED** (Decision 45, E8). A document calling one of them
  unenforced is a defect that `verify-docs` check 9 (`engine-enforcement-claims`) fails.
- **Engine 6 (explanation) is shipped** and wired by `orchestrator/full-run.js` (Decision 22); some
  prose still describes it as planned.
- **`scripts/verify-hardware-schema.js` is broken and not safe to re-run.** Use the read-only
  `verify-schema.js` / `verify-constraints.js` / `verify-fks.js`.
- **Never split a seed file on `;` to run or rehearse it.** A `;` inside a header comment splits
  mid-comment, and a seed carrying its own `BEGIN`/`COMMIT` cannot be rollback-rehearsed by wrapping
  it in an outer transaction. See `database/AGENTS.md`.
- **Old documentation paths.** `docs/ARCHITECTURE.md`, `docs/API.md` and `docs/PIPELINE_DESIGN.md`
  moved on 2026-11-11; citations of the old paths in the append-only decision log,
  `DEVELOPMENT_NOTES.md` and `docs/archive/**` are historical and deliberately left as written.
