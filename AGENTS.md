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
5. `docs/RECOMMENDATION_ENGINE_DECISIONS.md` — the decision log (Decisions 1–30). Check here
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
| `database/migrations/` | Authoritative schema (`001`–`014`, apply in filename order; applied state tracked in `schema_migrations`, OG-14) |
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
  code-unit based (never `localeCompare`). Retention ordering is fully deterministic:
  `compareCandidates()` breaks ties on `product_id` ASC (then `product_variant_id`
  NULL-first then ASC), and since Decision 27 the cheapest-per-role reservation breaks its own
  `selected_price` ties by that same Rule 3/5 position — pinned by
  `retention/retain.test.js`. There is no random tie-break anywhere in the engine.

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
| `node scripts/run-migrations.js` | Apply PENDING migrations via the `schema_migrations` ledger (OG-14, 2026-10-03) — re-runnable; flags `--dry-run` (list pending), `--check` (exit 1 on pending), `--offline` (no DB), `--baseline` (adopt an already-migrated DB without running), `--test-db` (guarded `TEST_DATABASE_URL`) |
| `node --test scripts/lib/db-url.test.js` | Guard unit tests (not in `test:unit`) |
| `node --test scripts/lib/gap-register.test.js` | Gap-register table-shape tests (not in `test:unit`; the check itself runs in `verify:docs` as `gap-register-shape`) |
| `node --test scripts/lib/migrations.test.js` | Applied-migrations ledger helper tests (OG-14; not in `test:unit`) |
| `node scripts/test-compatibility.js` | Layer 1 compatibility/provenance fixtures |
| `node scripts/test-layer3.js --verify --functional` | Layer 3 schema (flags required; needs ALL THREE Layer 3 tables empty — `store` too; non-empty on shared DB AND on the test branch as of 2026-09-28, so it cannot pass in either environment today) |
| `node scripts/test-layer4.js` | Layer 4 canonical schema (unguarded: reads `DATABASE_URL`; writes `TestL4%` fixtures inside one transaction with final ROLLBACK; does NOT require empty Layer 4 tables) |
| `node scripts/verify-schema.js` / `verify-constraints.js` / `verify-fks.js` | Read-only catalog checks |
| `node scripts/test-orchestrator-commit.js` / `test-orchestrator-full-run.js` | Write-path tests (TEST_DATABASE_URL only) |
| `node scripts/check-og01-coverage.js` | OG-01 assessment-coverage gate (read-only; needs `DATABASE_URL`; exits 1 while any active product has no assessment rows; `--strict` also fails REAL (non-fixture) partial coverage) |
| `node scripts/check-deferred-rules.js` | Decision 26 item B violation gate (read-only; needs `DATABASE_URL`; the four DEFERRED HARD rules OG-09…OG-12 measured in catalog AND compatibility-reachable scope; exits 1 while any violating pair exists — this is the binding pre-merge re-check for any CPU/cooler/case/RAM/motherboard seed, per `docs/RECIPES/add-a-seed.md` step 3) |
| `node scripts/og01-research-checklist.js [--csv] [--out <file>]` | OG-01 batch-2 research worksheet from live DB (read-only; 56 target products / 168 rows, seed 001 no-evidence + partial fixtures excluded; `docs/OG01_BATCH2_RESEARCH_CHECKLIST.md` is its committed output — regenerate, never hand-edit) |
| `node scripts/measure-og01-reach.js [--budget N] [--use-case U]` | OG-01 reach measurement, read-only pipeline replication of orchestrator stages 4-11 against `DATABASE_URL` (Decision 17-safe: no writes; use `measure-orchestrator.js` instead when the full Decision-20 write-path acceptance is needed) |
| `scripts/lib/og01-catalog.js` | Shared OG-01 derivation (category from spec-table presence, required types from `role_weights`, fixtures). The single script-side owner — the gate, checklist, and reach scripts all consume it; do not re-copy the SQL maps. `DELIBERATE_NO_EVIDENCE` (products with no assessment rows) and `DELIBERATE_PARTIAL` (products missing only SOME required types, keeping Decision 13 STEP 1's missing-type branch live) are deliberate seed-001 fixtures — never research targets |
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
- `TEST_DATABASE_URL` went UNREACHABLE on 2026-10-01 (`password authentication failed`) and the
  branch was RE-CREATED — twice, on 2026-10-01 and again on 2026-10-02, each re-creation minting a
  NEW endpoint. So: verify with a 1-row SELECT before relying on any guarded script, and treat any
  host named in a doc (including this one) as historical — hosts and credentials live only in `.env`.
  Credential staleness and a dead branch look identical from the client (`28P01`), so the SELECT is
  what tells them apart. All three guarded scripts RE-VERIFIED GREEN 2026-10-01 and again 2026-10-02
  on the restored branch (`preflight {products:100, models:1, offers:101, assessments:112, queries:0}`):
  `test-orchestrator-full-run.js` 28 pass / 0 fail; `measure-orchestrator.js` Decision-20
  criteria 1+2 MET for GAMING and OFFICE. Historical note: while the branch was dead, seed-004a
  reach was measured by read-only pipeline replication on the shared DB (stages 4-11 of
  `orchestrator/run.js` need only SELECTs until stage 12 persistence) — see
  `DEVELOPMENT_NOTES.md` 2026-10-01.
- `node scripts/run-seeds.js --dry-run` counts statements with a naive `split(';')`, so a semicolon
  inside a SQL comment inflates the count (Postgres ignores it; the number is just misleading).
- **Seed 004b changed the canonical catalog; Decision 27 then made the harness budgets
  re-derivable again.** The guarded harnesses pin live row counts (`assessments: 280`
  after 004a 87 + the three applied 004b files 63 + 60 + 45). Their query budgets are now
  **GAMING 10000 MAD and OFFICE 10000 MAD**, measured 2026-10-02.
  Until then they were **raised** (GAMING 15000 -> 20000, OFFICE 10000 -> 12000) purely to
  keep the harnesses finding builds, because retention was score-driven and budget-blind
  (OG-26): after real assessments the retained CPU set was 2699 MAD and up, so GAMING@15000
  assembled **0 builds**. Decision 27 reserves 1 of K slots per role for the cheapest eligible
  candidate, which dropped the cheapest-per-role sum from **7426 to 4477 MAD** and the
  retained per-role minima from CPU 2699 -> 899, GPU 9000 -> 3200, SSD_BOOT 899 -> 599,
  PSU 999 -> 599, CASE 949 -> 849, CPU_COOLER 699 -> 350. **Never raise a budget to make a
  harness pass — a raised budget is what hid OG-26 in the first place.** Re-measure instead;
  `node scripts/measure-og01-reach.js --budget N --use-case U` prints the floor on every run.
  Two facts worth keeping: the floor is a **lower bound, not a build** — the cheapest build
  that actually assembles is 7677 MAD, so 4500-7000 MAD legitimately returns 0 builds while
  `budget_floor.within_budget` is `true` (the emptiness is compatibility, not budget); and
  `budget_floor` is a data field only, deliberately not wired into Engine 6 explanation text.

- A seed file that embeds its own `BEGIN;`/`COMMIT;` cannot be rollback-rehearsed by wrapping it in an outer transaction: the inner COMMIT ends the outer one, so the caller's `ROLLBACK` is a no-op and the write commits. Strip the BEGIN/COMMIT before sending it if a real rollback test is needed, or rehearse on a throwaway branch and reset the branch.

- **CRLF gotcha (cost a whole-file diff twice this session).** Never "normalize" a CRLF file with
  `s.split('\n').join('\r\n')` — the existing `\r` survives and you write `\r\r\n`, which git renders
  as every line changed. Check first with `grep -qU $'\r' <file>`; if it is already CRLF, append the
  new text with `split('\n').join('\r\n')` and `fs.appendFileSync` only. `docs/RECOMMENDATION_ENGINE_DECISIONS.md`
  also carries a UTF-8 BOM; rewriting it as utf8 drops the BOM and adds a spurious first-line diff.
- `python` is not installed in this shell (Windows alias stub); use `node -e` for file surgery.
  A bare `TEST_DATABASE_URL="$TEST_DATABASE_URL" node -e ...` prefix is a trap — the outer shell has
  no such var, so it exports an EMPTY value that shadows the one `dotenv` just loaded, and the
  failure surfaces as a bare `ERR` with an empty message.
- Adding a decision to the log **breaks `verify-docs` by design**: `scripts/verify-docs.js` hardcodes
  the expected heading and `Status:` counts (now 28 / 34) and derives AGENTS.md's required
  "Decisions 1-N" from that parse. Bump both counts when you add Decision N+1, and update the
  `database/migrations/` range cited in AGENTS.md §4 or `migrations-range-documented` warns.
- Writing a spec-data seed: put the guard in the DML, not only the header comment. `UPDATE..FROM
  (VALUES) JOIN product ON p.name = v.name WHERE cs.radiator_size_mm IS NULL` honours any name you
  list, so also constrain the type column (e.g. `AND cs.cooling_type = 'LIQUID'`) — then prove it by
  pointing one VALUES row at a wrong-type product and observing no write.
- To exercise the engine against a real DB without the orchestrator, call
  `filterCandidatesForRecommendation({input, pool}, db)` — positional args, not an object. A pool
  entry needs `component_role`, `product_id`, `product_variant_id: null` and `category`, where
  `category` is the `product_category` enum (`COOLER`, not the `CPU_COOLER` role). `input` needs a
  valid Engine 2A selection input (all 8 `EXPANSION_ORDER` roles, `RAM` not `MEMORY`); each failure
  mode raises its own missing-field error, which is the fastest way to discover the contract.

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
   The live-only benchmark drift it surfaced was RECONCILED 2026-10-04 by migration
   `012_reconcile_benchmark_drift.sql` (OG-25), so the tree reached `001→012`. The shared and TEST
   databases are baselined in the `schema_migrations` ledger (OG-14) and both now stand at **014**
   as of 2026-10-04 (`013_cooler_radiator_size.sql` / OG-28, `014_build_rejection.sql` / OG-04).
6. **Migration ledger (OG-14, 2026-10-04).** `run-migrations.js` is ledger-driven: it records each
   applied filename in `schema_migrations` and applies only the pending tail, so it is re-runnable
   (the bare `CREATE TYPE` in `002_enums.sql` no longer aborts a second run). A database that
   predates the ledger is adopted once with `node scripts/run-migrations.js --baseline` (writes the
   ledger only, runs nothing). `--check` is the freshness gate; `--offline` needs no DB. Never rely
   on the old "apply files individually via a throwaway script" workaround — it is superseded.

## 8. Hard rules

- **Never reset, drop, truncate, or restore the shared Neon database.** It is the only dev DB.
- **Never rewrite or renumber a committed migration.** Schema changes require a new sequential
  `NNN_short_description.sql`.
- **Never bypass the migration ledger** — apply migrations only through the ledger-driven
  `run-migrations.js` (OG-14: pending tail only, one transaction per file — re-running on the live DB is safe); never replay the files by hand.
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
- **Scope a policy exemption to the SUBJECT of the record, never to free prose elsewhere in it.**
  The gap-register's closed-row exemption must read a closed row's ID/Item cells only: harvesting
  every `OG-nn` in the row excused OG-26 (C-16 name-drops it in its resolution) and made the check
  pass on the exact damage it was added for.
- **Fixing a register row is not done until the grep sweep is clean.** A corrected claim that was
  copied into `CONTEXT.md` and a plan doc stays false everywhere it was copied —
  `grep -rn "<key phrase>" --include="*.md" .` in the same commit. Leave dated `DEVELOPMENT_NOTES.md`
  entries alone; they record what was believed then.
- Stage only intended files; check `git status` first (shared checkout).
- **Another agent may commit to this checkout while you work — re-read `git log`/`git status` before you rely on any row ID or file state.** Commit with an explicit pathspec (`git commit <msg> -- <paths>`) rather than staging, so the index and other agents' staged files are untouched. A shared file (e.g. `docs/OPEN_GAPS.md`) can pick up both agents' rows; say so in the commit body rather than silently including it, and re-read the register right before adding a row — `gap-register-shape` FAILs on a duplicate ID, which is exactly the collision that happens when both agents pick the next free number.
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
Full findings, with evidence: `docs/DOCUMENTATION_AUDIT_2026-09-28.md` — every finding (D1–D12) plus items 8/9-part-1 was independently re-verified 2026-09-29 (all green: 829 unit tests, verify:docs offline + live, decision-index `--check`); treat its RESOLVED banners as trustworthy and do not re-open the findings without new evidence. **The audit is CLOSED (2026-09-29/30)**: all recommendations A1–A12 landed and the last residue, OG-13 (fresh 001→011 empty-DB run), was RAN AND VERIFIED 2026-09-30 — see `docs/OPEN_GAPS.md` OG-13 / C-15. The drift that run surfaced was tracked as OG-25 and is now CLOSED too (reconciled 2026-10-04 by migration `012_reconcile_benchmark_drift.sql`; the migration runner gained a `schema_migrations` ledger, OG-14/C-19).
- When a session's job is to verify prior work, verify against the working tree and re-run the mechanical gates (not just the banners), then append a dated VERIFIED note to the audit doc itself so the next session does not repeat the pass.
- Gap-closure propagation: when a gap closes in `docs/OPEN_GAPS.md`, grep the tree for its ID + key phrases in the SAME commit — closures have landed twice now without the same-session propagation the register §6 rule requires (OG-13 needed a follow-up 6-file sync, commit 7d336cd). Shape: `grep -rn "<OG-id>|<key phrase>" --include="*.md" .`
- Dated RESOLVED/CLOSED banners in audit/status docs are historical records — update only current status sections (`CONTEXT.md`, AGENTS §10, register rows); never retro-edit an old banner, mark supersession in the newer one instead.
- Generated-docs freshness: `gen-decision-index --check` is DB-free (runs in CI); `SCHEMA_REFERENCE.md` is gated by a schema digest — `verify-docs --live` hashes the DB's tables/columns/enums and fails when the digest line in the doc no longer matches (run `npm run gen:schema` after any seed or migration). The digest query is duplicated in `gen-schema-reference.js` and `verify-docs.js` — change both together. `DATA_STATE.md` is deliberately NOT digest-gated: its figures describe the instance and drift legitimately.

- **A seed's own citation must be re-fetchable by a second reader before you apply it.** A value whose sole source 404s (or 403s) to automated fetches is UNVERIFIED, however confident the authoring session was — treat it as you would a missing spec. Vendor-neutral spec aggregators converge faster and survive vendor-site blocks (gigabyte.com and msi.com both 403); a vendor spec page outranks an aggregator when both are reachable.
- **When a data-identity argument rests on ONE stored column, verify that column is actually true before trusting the argument.** A wrong Layer-1 value does not only mislead queries — it misdirects RESEARCH: `psu_spec.modularity = NON_MODULAR` on the Antec G850 (published design is Semi-Modular, OG-31) caused two wrong research passes in a row (seed 003 D7, seed 005 first pass) before anything was written.
- **A layer-1 value can be correct LIVE but not REPRODUCIBLE FROM THE TREE.** The G850 `modularity` was fixed to `SEMI_MODULAR` by hand on the shared DB while `002_catalog_expansion.sql` still inserts `NON_MODULAR`, so a fresh replay silently restores the wrong value. After any live data correction, grep the seeds for the row and confirm a committed file writes the corrected value — a live-only fix is not a fix.
- **A `|` inside any `docs/OPEN_GAPS.md` table cell breaks that row silently.** The row renders as an extra column, and `gap-register-shape` FAILs with `ROW_CELL_COUNT`. It bites when a Status cell reads like `**OPEN — but MIS-FRAMED, see 2026-10-04**`: the em-dash plus emphasis is fine, but any literal `|` inside prose (e.g. `ACCEPTABLE | OPEN`) is not. Put the explanation in the LAST cell (Source(s)), which is prose-tolerant, and keep cells 1-6 free of pipes.
- **A writer that returns generated ids MUST pass them to the INSERT.** Leaving `id` to the column DEFAULT makes every returned id a reference to a row that does not exist, because Postgres applies `DEFAULT gen_random_uuid()`. Fake-client unit tests cannot catch this — they accept any params. Only a real round-trip can.
- **The commit wrapper's re-run guard keys on `build_candidate` ONLY** (`commit.js` guard 2, Decision 19.2). Anything else the commit writes is unguarded: a zero-build pass that wrote `build_rejection` rows can be committed repeatedly and duplicates them (OG-33). Before relying on "a re-run cannot duplicate X", confirm guard 2's SQL actually mentions X's table.
- **Driving `filterCandidatesForRecommendation` by hand: four contract details bite.** `product` has NO `category` column — category is DERIVED from spec-table presence, so build the pool with `scripts/lib/og01-catalog.js`'s `loadOg01Catalog(db)`. `pool` is a FLAT ARRAY of `{ component_role, product_id, product_variant_id, category }`, not an object keyed by role. Role `RAM` maps to category `MEMORY` and `CPU_COOLER` to `COOLER` (see `candidates/roles.js` `ROLE_CATEGORIES`). `input.budget_amount` must be a finite NUMBER (a NUMERIC string is rejected) and `input.required_roles` must list all 8 `EXPANSION_ORDER` roles.
- **A full-catalog pool legitimately yields 2 REJECTs and 12 UNKNOWNs.** The REJECTs are the known `GPU_TOO_THICK` pair and the UNKNOWNs are the OG-07 NULL GPU dimensions. Assert against that baseline, not against "zero REJECT" — an over-strict assertion will look like a regression when nothing is wrong.
- **Never split a seed file with `split(';')` to run its statements.** A `;` inside a header comment splits mid-comment, every chunk then starts with `--`, and a `/^UPDATE/` filter silently drops them all — the apply reports success and writes NOTHING. Run the whole file with `client.query(rawText)` (it carries its own BEGIN/COMMIT), or strip comments first. This happened while applying seed 009 and left the shared DB unchanged with a clean-looking exit 0.
- **A COALESCE-based idempotency guard silently disables a corrective UPDATE.** `WHERE col IS DISTINCT FROM COALESCE(col, desired)` is ALWAYS FALSE when `col` is non-NULL, because COALESCE returns that same value; it updates 0 rows, and it can never write an explicit NULL. For corrections use `WHERE col IS DISTINCT FROM <desired>` with an unconditional SET (seed 008 / seed 009 Block 2). Only use COALESCE when you are filling NULLs.
- **Before scheduling data-research work, check the DATA is real.** A gap can ask for research that cannot exist: `store_offer.seller_name`/`product_url` were 101/101 NULL (OG-19) but the only 2 stores are `Seed %` fixtures on the IANA-reserved `example.ma` domain, so no citable seller or URL exists. Grep `src/` for the column first — nothing read them — then check whether the value is derivable (`seller_name` == `store.name`) before treating NULL as missing work.
- **Prove claims about persisted ids/rows with a real round-trip, not a fake client:** insert, SELECT the row back, compare the stored id to the returned one, and assert residue is 0 in the same script's `finally`. `scripts/lib/db-url.js`'s `getWriteTestDbUrl()` returns a **config OBJECT** (`{ connectionString, connectionTimeoutMillis }`), not a string — pass it straight to `new Client(...)`.
- **Probe scripts must delete dependents before the parent.** `build_candidate` rows block deleting their `recommendation_query`, so order is `build_rejection` -> `recommendation_result` -> `build_component` -> `build_candidate` -> `recommendation_query`. Leftovers break the guarded harnesses' `queries: 0` preflight.
- **`grep -c '^. (tests|pass|fail)'` on `node --test` output matches nothing** — those summary lines start with a unicode `ℹ`, so the grep exits 1 and reads like a test failure. Capture `$?` from the test command itself, never from the output filter.
- **Prove a data correction is inert DIFFERENTIALLY, not by grep.** `grep -n height_mm src/` returning 0 rules out only direct column reads, not a downstream consumer. Run the real Engine 2C-2D path (`candidates.loadCandidates` -> `selectCandidatePool` -> `offers.selectOfferPrices` -> `filtering.loadFilteringContext` -> `filtering.filterCandidates`), then run it AGAIN with the corrected value forced back to the old one and assert the two verdict sets are byte-identical. Assert against the known baseline (101 verdicts: 87 PASS / 12 UNKNOWN / 2 REJECT), never "zero REJECT".
- **Classify a spec correction by which DIRECTION it moves the value before deciding whether to defer it.** Lowering a cooler height is conservative (over-reserves clearance); raising one is not (seed 010's Noctua 155 -> 158 was UNDERSTATED, so the old value would have let a 158mm cooler pass a 156mm-clearance case). A gap whose corrections all move one way can wait; one with a single wrong-way value should ship now, because shipping only the safe half leaves the unsafe value in place.
- **A safety margin measured from the CURRENT catalog is not a guarantee — say so in the seed header.** Seed 010's OG-10 trigger passed only because the smallest case `max_cpu_cooler_height_mm` (160mm) exceeds the tallest cooler (158mm). Adding a tighter case erases that headroom, so the gap is closed because the data is right, not because the catalog is forgiving.
- **A corrective seed's green exit does NOT prove every target row was corrected.** A `VALUES` row matching no product updates 0 rows with no error, because an UPDATE cannot violate a constraint the way an INSERT can. Renaming one target inside a transaction showed the other three corrected and the renamed one left stale, exit 0. To assert coverage, query the values back; to hard-fail on a miss you need a plpgsql `DO` block, which breaks the seeds directory's DML-only convention (008/009/010 all accept the documented exposure instead).
- **Do NOT rehearse a seed inside `BEGIN`/`ROLLBACK` — the seed carries its own `COMMIT` and will commit your outer transaction.** Postgres lets the inner COMMIT end the outer one, so the ROLLBACK is a silent no-op and the rehearsal leaves its "temporary" damage live. This happened while probing seed 010: a renamed product and a stale 155 survived, and the only reason it was caught was a post-rollback assertion. Rehearse against the branch DB and repair forward, or wrap the whole probe so a wrong state is impossible.
- **`product.name` has NO unique constraint** (`migrations/003_core_tables.sql`), so any seed matching `JOIN product p ON p.name = v.name` would silently widen to every duplicate rather than failing. Zero duplicates today, measured — but this is the same missing-unique-key family as OG-06's `store_offer`, and a future ingestion pass (F8) could introduce one.
- **Adding a spec column to the loader breaks exact-shape test fixtures across FOUR files, and the failures are legitimate.** `deepStrictEqual` on a spec object fails on the new key even when the value is correct `null`. The fix is to give the fixture real data, never to relax the assertion: with the column absent the new pair is correctly UNKNOWN, so an "all-PASS" fixture would quietly stop being all-PASS. Sites hit when OG-10 landed: `filtering/context-loader.test.js`, `filtering/filter.test.js`, `filtering/integration.test.js`, `filtering/pipeline.test.js`, `assembly/assemble.test.js`.
- **Prove an implemented rule FIRES, not just that it returns 0 violations.** A rule with no violations is indistinguishable from a rule that never runs. Force the violation (e.g. set a cooler taller than every case) and assert the expected REJECT and reason code appear, then restore and assert the verdict set is byte-identical. For OG-10 this was the only check that distinguished a live rule from dead code.
- **Un-deferring a Decision 26 rule is not a status edit — it is a new Decision.** Lifting OG-10 required: the rule, the loader columns, reason codes, unit tests, a Decision record, the register row plus a closed row, a CONTEXT line, AND updating `check-deferred-rules.js` so the standing gate stops calling an enforced rule latent. The gate bumping its hardcoded decision counts (now 28/34) is the documented `verify-docs` breakage for adding Decision N+1, not a regression — see the `agents-decision-range` check.

