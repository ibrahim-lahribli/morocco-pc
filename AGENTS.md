# AGENTS.md

Entry point and map for AI coding agents working in this repository.
Keep this file short: it is an index, not the documentation. Deep detail lives in the linked files.

## 1. What this project is

`morocco-pc` is a PC build recommendation platform for the Moroccan market.
Given a recommendation query (budget, currency, use case, scoring model), the engine selects
compatible components, assembles builds, scores them, ranks them, picks a diverse top set, and
persists the results.

The engine is still a pure Node.js library plus a PostgreSQL schema, and it stays that way: the
HTTP surface is a separate, thin layer (`apps/api/`, Decision 36) that calls the engine's public
barrels and owns no engine logic. There is no frontend in THIS tree and no authentication: the
web app lives on its own branch (`apps/web/`, Next.js + Tailwind, scaffolded 2026-10-16) and has
not been merged. The entry
points are the engine's public barrels (`src/recommendation/*/index.js`), the `scripts/` CLIs,
and `apps/api/src/server.js`.

## 2. Read in this order

1. `git status` — do this FIRST. This is a shared checkout; other agents may have changed files.
2. `CONTEXT.md` — canonical project context: status, the four layers, schema, migration rules,
   design decisions. Authoritative for "what exists today."
3. `DEVELOPMENT_NOTES.md` — operational lessons: verified commands, failure modes, DB / Git /
   testing lessons. Read before touching migrations or DB scripts.
4. `docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md` — the engine contract (pipeline, HARD/SOFT rules,
   compatibility policy, scoring, budget, reproducibility, known gaps).
5. `docs/RECOMMENDATION_ENGINE_DECISIONS.md` — the decision log (Decisions 1–50). Check here
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
`docs/PROJECT_STATUS_REVIEW_2026-09-28.md` (whole-project weaknesses W1–W12, options A–I, known/unverified registers K/U).For what is still open — gaps, deferrals, unverified items, closed-findings residue — `docs/OPEN_GAPS.md` is the
consolidated register (ARCHITECTURE §16 + seed 002 D1–D8 + §18 futures + audit D1–D12, each with class/status/owner).


## 3. Technology stack

| Area | Actual |
|---|---|
| Language | Node.js, CommonJS (`require`, `'use strict'`), no TypeScript, no build step |
| Runtime deps | Engine: `pg`, `dotenv`. API: `fastify`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/swagger`, `@sinclair/typebox`, `@sentry/node` — all at the ROOT `package.json` (no nested package.json; the engine resolves `pg`/`dotenv` from the root `node_modules`). `pino-pretty` is a devDependency |
| Database | PostgreSQL on Neon (cloud); single shared dev DB, NOT disposable |
| Data access | Raw parameterized SQL via `pg`; no ORM |
| Engine | Pure-JS modules under `src/recommendation/` |
| Tests | Node's built-in test runner (`node --test`); no Jest/Vitest/Playwright |
| Package manager | npm (`package-lock.json` committed) |
| Frontend / mobile | none |
| Isolated write tests | Neon branch via `TEST_DATABASE_URL` + `scripts/lib/db-url.js` guard |
| Lint / format / typecheck / CI | GitHub Actions CI (`.github/workflows/ci.yml`: `unit-and-docs` = `test:unit` + `test:scripts` + `test:api` + `gen-decision-index --check` + `verify-docs --offline`; `recurring-gates` = freshness + migration replay + `test:api:db`); no lint/format/typecheck |

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
| `database/migrations/` | Authoritative schema (`001`–`022`, apply in filename order; applied state tracked in `schema_migrations`, OG-14) |
| `database/seeds/` | DML-only, idempotent seed data |
| `database/LAYER4_RECONCILIATION_PLAN.md` | Historical Layer 4 reconciliation record |
| `scripts/` | CLIs: migrations, seeds, schema verifiers, engine checks |
| `scripts/lib/db-url.js` | `TEST_DATABASE_URL` guard for write-capable tests |
| `src/recommendation/` | ALL engine application code — the pipeline stages |
| `apps/api/` | The HTTP API (Decision 36): Fastify routes, TypeBox contracts, the SQL repository, a Dockerfile. TEST DB only unless `API_ALLOW_SHARED=1`; no engine logic, no frontend |

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
| `npm run seed` / `node scripts/run-seeds.js [--dry-run]` | Apply `database/seeds/*.sql` (idempotent) to the **shared `DATABASE_URL`** — `run-seeds.js` ignores `--test-db` and has NO `getWriteTestDbUrl()` routing, so `--test-db` routes NOTHING. To apply a seed branch-first, target the TEST branch DB explicitly with the SAME pattern the migration runner uses: `getWriteTestDbUrl()` returns a `{ connectionString, connectionTimeoutMillis }` config object (NOT a URL string), and on connect the client's default `search_path` is `pg_temp`, so the residual `motherboard_memory_support` does not exist until you `SET search_path = public` first. Example branch-first seed apply: connect via `new Client({ ...getWriteTestDbUrl(), connectionTimeoutMillis: 15000 })`, `SET search_path = public`, then `client.query(rawSql)` — do NOT split the file by `;` (a `;` in a header comment splits mid-comment; do not use `client.query(sql.split(';'))`). Dry-run (`--dry-run`) only counts statements/characters and never executes, so it cannot catch a broken INSERT. Delete spec rows before product before product_family when cleaning up a fixture (spec tables are ON DELETE NO ACTION); see AGENTS §7 item 11. |
| `npm run gen:decisions` | Regenerate `docs/DECISION_INDEX.md` from the decision log (`node scripts/gen-decision-index.js --check` fails when it is stale) |
| `npm run gen:schema` | Regenerate `docs/SCHEMA_REFERENCE.md` + `docs/DATA_STATE.md` from the live DB (`node scripts/gen-schema-reference.js --check` fails when stale; needs `DATABASE_URL` — even `--check`, which regenerates in memory and diffs; no-arg run rewrites both files) |
| `npm run verify:docs` | Verify fact-shaped doc claims vs tree (offline) or + read-only DB (`--live`) |
| `node scripts/verify-docs.js --live` | Adds read-only live-DB checks: 15 core tables + counts (INFO), and the schema-digest gate — FAILs when `docs/SCHEMA_REFERENCE.md`'s `schema-digest:` line no longer matches the live tables/columns/enums (fix: `npm run gen:schema`) |
| `node scripts/run-seeds.js --dry-run` | Report seed statements without executing |
| `node scripts/run-migrations.js` | Apply PENDING migrations via the `schema_migrations` ledger (OG-14, 2026-10-03) — re-runnable; flags `--dry-run` (list pending), `--check` (exit 1 on pending), `--offline` (no DB), `--baseline` (adopt an already-migrated DB without running), `--test-db` (guarded `TEST_DATABASE_URL`), `--note=<text>` (record on the audit line of a shared apply WHAT the apply was for — a blank value is refused, exit 2, and a non-blank one is kept verbatim; which DATABASE a line is about is the `target` field itself, a `db:<12 hex>` digest of the connection's normalized host and database that every shared-target run prints as `AUDIT TARGET:` before it writes anything). **A real apply against the shared `DATABASE_URL` REFUSES (exit 1, ledger untouched) unless `--restore-point=<id>` matches `^[A-Za-z0-9_-]{8,}$`** — it prints the pending files instead. **`--baseline` needs one too** (it writes the ledger even though it runs no SQL) and lists each filename it is about to record. `--test-db` and the read-only modes (`--dry-run` / `--check` / `--offline`) never need one. A shared apply appends one line per applied file to the tracked, append-only `database/migration-applies.jsonl` |
| `node --test scripts/lib/db-url.test.js` | Guard unit tests (not in `test:unit`) |
| `node --test scripts/lib/gap-register.test.js` | Gap-register table-shape tests (not in `test:unit`; the check itself runs in `verify:docs` as `gap-register-shape`) |
| `node --test scripts/lib/migrations.test.js` | Applied-migrations ledger helper tests (OG-14; not in `test:unit`) |
| `npm run test:scripts` | Every `scripts/lib/*.test.js` suite (`db-url`, `gap-register`, `migrations`, `run-migrations-cli`, `schema-diff`, `replay-harness`, `model-pin`, `offer-freshness`, `generated-doc-check`, `api-role`, `pass-rows`, plus the CLI suites for `rehearse-api-role` / `apply-api-role` / `smoke-api-role` / `measure-phases` / `generate-presets`). `test:unit` globs `src/**/*.test.js` ONLY, so these never ran in CI until the `test:scripts` step was added — run it after touching anything in `scripts/` |
| `node scripts/rehearse-api-role.js [--budget=N] [--use-case=U]` | Creates the production role `morocco_pc_api` on the **TEST branch only** (`getWriteTestDbUrl()` guard), drives the API write path as the role, asserts the 20-answer privilege self-check, proves a row-wide UPDATE is denied `42501`, then removes the role — a REHEARSAL, never the shared apply |
| `node scripts/apply-api-role.js [--dry-run] --restore-point=<id> [--password-file=<path>]` | The OWNER-GATED shared apply. REFUSES (exit 1, nothing written) without a `^[A-Za-z0-9_-]{8,}$` restore point, refuses an existing role instead of recreating it, prints the `db:<12 hex>` audit digest beside a password-redacted plan and connects to NOTHING in `--dry-run`, and runs the self-check after the grants — a red self-check ROLLS THE ROLE BACK. Read `docs/RECIPES/provision-the-api-role.md` first |
| `node scripts/smoke-api-role.js --confirm-shared` | Runs the API itself as `morocco_pc_api` against the SHARED database (health asserted on the BODY, one real POST that must not be a dedupe reuse and must commit >=1 build, no `42501` on the pool), then deletes its rows and asserts the six Layer 4 counts returned. `--confirm-shared` is required and nothing in CI sets it; a 0-build pass is INCONCLUSIVE, not a pass |
| `npm run test:api` | HTTP API tests (`apps/api/test/unit/*.test.js`) — DB-free: `fastify.inject` + stubbed collaborators. Runs in the push/PR job |
| `npm run test:api:db` | HTTP API end-to-end tests (`apps/api/test/db/*.db.test.js`) against the **`TEST_DATABASE_URL` branch**: the real engine, the real schema, residue asserted 0. The launcher fails fast (never skips) when `TEST_DATABASE_URL` is missing or targets shared, and fails on zero executed tests. Runs in `recurring-gates` + `workflow_dispatch` only |
| `npm run start:api` | Start the HTTP API (`apps/api/src/server.js`). Write-capable: refuses to start unless the target is provably the TEST branch, or `API_ALLOW_SHARED=1` is set explicitly |
| `npm run verify:replay` | Replays every migration into a genuinely EMPTY scratch database on the `TEST_DATABASE_URL` instance and diffs it against the live schema by definition (`pg_get_constraintdef` / `indexdef` / column type+nullability+default). `--test-db` is required so it can never create a database implicitly; `--dry-run` contacts nothing; `--keep-db` skips the drop; `--reference=<test|shared>` picks the diff target (`shared` = `DATABASE_URL`, the default; `test` = the TEST branch). Exits non-zero on any drift |
| `node scripts/check-target-parity.js --a=<url\|env:NAME> --b=<url\|env:NAME>` | Read-only parity gate for a replayed target (Platform P1 Sprint 1): compares the `schema_migrations` ledger, the `public` table list, the full column+enum shape and row counts of the catalog + Layer 4 tables. Every difference is NAMED (first differing index/table), `RESULT: MATCH` exits 0, a DIFF or an unreadable table exits 1, usage exits 2; never prints a URL. Comparison half: `scripts/lib/target-parity.js`, pinned by `npm run test:scripts` |
| `node scripts/check-origin-readiness.js [--app=<name>] [--origin=<url>]` | Deployed-origin preflight for the EU runbook §8.4 (P2 Sprint 2 Step 4): asserts `fly ips list` returns at least one `net.isIP`-valid address AND `GET /v1/health?probe=preflight` answers 2xx with `status: "ok"` and `db: "ok"`. Read-only (one `fly ips list`, one GET; needs flyctl + network); prints `PREFLIGHT OK - addresses:` or `FAIL preflight:`; exit 0 pass, 1 fail, 2 usage. Pinned by `scripts/lib/origin-readiness.test.js` (parsing/verdict) and `scripts/lib/origin-readiness-cli.test.js` (exit codes/messages), both in `npm run test:scripts` |
| `npm run verify:pi1` | Decision 23 criterion 3 (PI-1) **pool independence**: inserts a probe PSU (own `product_family`, 100 kW, NULL connectors) into the TEST branch, re-runs GAMING + OFFICE, asserts no pre-existing `build_score` moved. Writes to the TEST branch, so it is not read-only; the probe is removed in a `finally` and a cleanup failure exits non-zero. Delete `psu_spec` before `product`, and `product` before `product_family` — see §7 item 11. Give any anchor row lookup an explicit `ORDER BY`: a `LIMIT 1` without one made this gate report intermittent false drift |
| `npm run eval:scenarios` | E0 golden harness (`scripts/eval-scenarios.js`): the 20-scenario matrix x assertions A1-A9 on the TEST branch, printing a table and optionally writing `test/golden/baseline-2026-10.md`. GREEN means "no APPROVED assertion failed", NOT "every row PASS": the unchanged engine is 56 PASS / 22 EXPECTED-RED / 3 UNKNOWN and exits 0. `--no-baseline --no-volatile` writes no files; `--filter=S03,S07`, `--with-pi1`, `--cleanup-orphans` narrow it |
| `node scripts/check-offer-freshness.js --fail-days=14` | OG-30 offer-freshness gate: offers at/inside their blackout window. **Equals form is mandatory** — `--fail-days=N`; the space form `--fail-days 14` prints usage and exits 2. CI uses 14, not the default 7, so a nightly run warns with two weeks' lead time |
| `node scripts/test-compatibility.js` | Layer 1 compatibility/provenance fixtures, **`TEST_DATABASE_URL` only since OG-51 (2026-10-18, C-41)**: `getWriteTestDbUrl()` refuses before connecting unless the TEST branch is configured and differs from `DATABASE_URL`, so the shared catalog can no longer be targeted (proven: a `TEST_DATABASE_URL` naming the shared host exits 1 with `must not target the shared database`, having connected to nothing). Cleanup runs in a `finally` and is scoped to the `TestCompat%` fixtures — spec rows, then `product`, then `product_family`, and the `spec_provenance` delete now follows the support rows it is about to remove instead of matching four whole target tables. Exits 1 on a failed assertion, a failed cleanup or non-zero residue, and prints `cleanup: 0 TestCompat product row(s) remain`. Verified 2026-10-18: 47 PASS / 0 FAIL on the branch, residue 0. |
| `node scripts/test-layer3.js --verify --functional` | Layer 3 schema (flags required; needs ALL THREE Layer 3 tables empty — `store` too; non-empty on shared DB AND on the test branch as of 2026-09-28, so it cannot pass in either environment today) |
| `node scripts/test-layer4.js` | Layer 4 canonical schema (unguarded: reads `DATABASE_URL`; writes `TestL4%` fixtures inside one transaction with final ROLLBACK; does NOT require empty Layer 4 tables) |
| `node scripts/verify-schema.js` / `verify-constraints.js` / `verify-fks.js` | Read-only catalog checks |
| `node scripts/test-orchestrator-commit.js` / `test-orchestrator-full-run.js` | Write-path tests (TEST_DATABASE_URL only) |
| `node scripts/check-og01-coverage.js` | OG-01 assessment-coverage gate (read-only; needs `DATABASE_URL`; exits 1 while any active product has no assessment rows; `--strict` also fails REAL (non-fixture) partial coverage) |
| `node scripts/check-deferred-rules.js` | Decision 26 item B violation gate (read-only; needs `DATABASE_URL`; all four rules OG-09…OG-12 — ENFORCED since Decision 45 (E8, 2026-10-14): OG-09 soft/UNKNOWN, OG-10/OG-11/OG-12 HARD/REJECT — measured in catalog AND compatibility-reachable scope; exits 1 while any violating pair exists — this is the binding pre-merge re-check for any CPU/cooler/case/RAM/motherboard seed, per `docs/RECIPES/add-a-seed.md` step 3) |
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
- Only `measure-orchestrator.js`, the two `test-orchestrator-*.js` scripts and
  `test-compatibility.js` (since OG-51) use the `TEST_DATABASE_URL` guard; `test-layer3.js` /
  `test-layer4.js` / `verify-*.js` still read `DATABASE_URL`.
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
- **The golden harness (`npm run eval:scenarios`) is GREEN when no APPROVED assertion fails, not when every row PASSes.** On the unchanged engine it is 56 PASS / 22 EXPECTED-RED / 3 UNKNOWN and exits 0 (`RESULT: EXPECTED-RED`); a `hypothesis` failure is reported but never fatal, and an UNKNOWN escalates to HARD FAIL only once its scenario's `expect_builds_after` epic has LANDED. Never tune a threshold to make a scenario pass, and never read the 22 EXPECTED-RED as a regression (brief E0 acceptance 4).
- **It REFUSES to run while ANY unmarked `recommendation_query` row exists** - `assertNoUnmarkedQueries` is not scoped to its own runs. It marks its rows with a `golden-eval-<runId>` `recommendation_profile` and sweeps its own killed-run leftovers at startup, but a leftover from `measure-orchestrator.js` / `test-orchestrator-*.js` / `verify-pool-independence.js` (none carry the marker) or any row predating the marker blocks the run; the 60 pre-marker rows needed a hand DELETE in FK order (`build_rejection` -> `recommendation_result` -> `build_component` -> `build_candidate` -> `recommendation_query`), done 2026-10-09. `--cleanup-orphans` runs the startup sweep alone and exits, and its short-circuit MUST sit BEFORE that gate, or the "run alone" flag throws the run preflight instead of reporting.
- **Every comparison harness selects its scoring model by a `name@version` PIN** (`scripts/lib/model-pin.js`; default `seed-minimal-v1@1.0.0`, override `--model=<pin>` or `SCORING_MODEL_PIN`), so a two-active-model branch is measurable; the pin fails closed on a malformed, ambiguous, INACTIVE or unmatched pin and prints the active models. Verified 2026-10-09 on a real two-active branch (OG-39 CLOSED, C-36) - a pin is a SELECTOR, never an activation. `scripts/measure-api-pass-phases.js` joined the pinned set on 2026-10-15 (it was the last comparison harness measuring "whichever model was ACTIVE"): it now resolves the pin and measures THAT model, and because the default pin is INACTIVE on the TEST branch a run there must pass `--model=launch-v2@1.0.0` or the pin refuses before writing anything. Its CLI/pin contract is `scripts/lib/measure-phases-cli.test.js`.
- **`--baseline=<scratch path> --no-volatile` then `diff` against the committed `test/golden/baseline-2026-10.md` is how the committed baseline is proven faithful** (byte-identical 2026-10-09, re-proven 2026-10-10 with the E3 engine at pin `launch-v2@1.0.0`). Normalise ONLY the `as_of:` line before diffing; capture diff's own exit status — piping it through `head` returns head's status, which once faked a byte-identity pass until a raw `cmp -s` re-run. The volatile sidecar is gitignored, so regenerate it, never commit it. **Updated 2026-10-14: the COMMITTED v1 file has drifted and no longer proves anything about HEAD.** `baseline-2026-10.md` was generated 2026-10-08 and its `selected` column reads 3 where today's v1-pinned engine yields 1 for every scenario, because Decision 41 replaced `selectDiverseTop` (it read the same under the E6-era engine, so this is not your change). To isolate YOUR change, diff a fresh `--baseline=<scratch>` run against the newer SCRATCH `test/golden/_scratch-v7-e6-v1-parity.md` (byte-identical except `as_of:` 2026-10-14); the committed file shows pre-existing drift that is not yours, and rebaselining it is a review-gated act (see OG-49's sibling note in Decision 43).
- **A repeated guarded write-test run treats its FIRST run's single-build drift as noise only when a paired re-run on unchanged code/data is clean** — `verify:pi1` once reported one build 54.79 -> 54.78 (known intermittent mode) and PASSED on the immediate re-run; record both, never the first alone. The E3 scratch golden runs live in committed `test/golden/_scratch-v*.md` (ungitignored on purpose) — extend the same series, don't invent a new evidence home.
- **`describeTarget` prints the POOLED host while `apply-seed.js` prints the DIRECT host** - `(pooled)` vs `(direct)` for the same branch is not a mismatch.

- A seed file that embeds its own `BEGIN;`/`COMMIT;` cannot be rollback-rehearsed by wrapping it in an outer transaction: the inner COMMIT ends the outer one, so the caller's `ROLLBACK` is a no-op and the write commits. Strip the BEGIN/COMMIT before sending it if a real rollback test is needed, or rehearse on a throwaway branch and reset the branch.

- **CRLF gotcha (cost a whole-file diff twice this session).** Never "normalize" a CRLF file with
  `s.split('\n').join('\r\n')` — the existing `\r` survives and you write `\r\r\n`, which git renders
  as every line changed. Check first with `grep -qU $'\r' <file>`; if it is already CRLF, append the
  new text with `split('\n').join('\r\n')` and `fs.appendFileSync` only. `docs/RECOMMENDATION_ENGINE_DECISIONS.md`
  also carries a UTF-8 BOM; rewriting it as utf8 drops the BOM and adds a spurious first-line diff.
- **`str_replace`'s matcher ignores whitespace, so an anchor that spans a line WRAP in a CRLF doc still matches - and the replacement silently JOINS the two lines.** Anchor wholly inside one physical line, or edit through an exact `split(from).join(to)` script; wrapped prose in `docs/**` is the usual victim (three repairs needed in one session: AGENTS.md, runbook SS1 and SS7).
- `python` is not installed in this shell (Windows alias stub); use `node -e` for file surgery.
  A bare `TEST_DATABASE_URL="$TEST_DATABASE_URL" node -e ...` prefix is a trap — the outer shell has
  no such var, so it exports an EMPTY value that shadows the one `dotenv` just loaded, and the
  failure surfaces as a bare `ERR` with an empty message.
- Adding a decision to the log **breaks `verify-docs` by design**: `scripts/verify-docs.js` hardcodes
  the expected heading and `Status:` counts (now 47 / 53) and derives AGENTS.md's required
  "Decisions 1-N" from that parse. Bump both counts when you add Decision N+1, and update the
  `database/migrations/` range cited in AGENTS.md §4 or `migrations-range-documented` warns. `docs/DECISION_INDEX.md` embeds each entry's WHOLE `Status:` line, so editing that line alone (even with no heading change) makes the index stale — re-run `npm run gen:decisions`; editing only a body section does not.
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

**CI (`.github/workflows/ci.yml`)** has two jobs with disjoint triggers. `unit-and-docs` runs on
`push`/`pull_request` (and `workflow_dispatch`) and skips `schedule`. `recurring-gates` runs only on
`schedule` (nightly, `17 3 * * *` UTC) and `workflow_dispatch`, and needs `DATABASE_URL` +
`TEST_DATABASE_URL` repository secrets — CI has no `.env`, so the job exports both explicitly and
fails fast if either is empty. It is `concurrency`-grouped with `cancel-in-progress: false` because
the replay creates and drops one fixed scratch database name (`migrations_replay_tmp`); do not set
that to true. A dispatch does not need the Actions tab: `gh` is absent on this box, but the REST
`POST /repos/{owner}/{repo}/actions/workflows/ci.yml/dispatches` works with the credential the git
remote already stores (`ref` = the branch to run on) — keep that token out of files and logs.

**The scheduled job HAS now run, twice, on 2026-10-18** (`workflow_dispatch` on `agent/platforms`;
runs 39119596060 and 39120485573). Both doubts that could only be settled by a real run are now
measured, not assumed: both repository secrets exist under the right names, and the Neon instance
accepts connections from a GitHub runner — `npm run test:api:db` answered `test:api:db: 9 passed,
0 failed` IN CI. It was **RED, and only for the documented reason**: `verify-migrations-replay.js --test-db`
reported 4 drift classes against shared (columns **377 vs 370**, checks **84 vs 79**, fks
**61 vs 60**, indexes **102 vs 100**), exactly the objects 021 and 022 create, i.e. the
branch-only state. **CLOSED 2026-10-19** by the owner-approved shared apply of 021/022
(restore point `br-ancient-cake-axh57vpj`, ledger 20 -> 22), after which the same command
reports **0 drift**. A future replay red of that shape is real drift, never something to "fix"
by changing the replay's reference target. Note also that **scheduled
workflows only run from the default branch** and GitHub **disables them automatically after 60 days
of repository inactivity** — an idle repo silently stops getting the nightly gate, which is why
`workflow_dispatch` is wired up too.

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
   throwaway Neon DB; 39/39 tables, 336/336 columns, 14/14 enums — see `docs/OPEN_GAPS.md` C-15),
   and RE-VERIFIED 2026-10-05 through `001→015` with **0 drift by object definition** (C-30). That
   check is now the repeatable `npm run verify:replay` gate, so re-run it after any migration lands
   rather than trusting a one-off measurement. The shared and TEST databases are baselined in the
   `schema_migrations` ledger (OG-14); BOTH databases stand at **022** as of 2026-10-19 —
   `021_recommendation_query_catalog_version.sql` (Decision 47, Platform P1 Sprint 5) and
   `022_recommendation_preset.sql` (Decision 48, Platform P1 Sprint 6) were branch-first and were
   applied to shared on 2026-10-19 from restore point `br-ancient-cake-axh57vpj` (the same restore
   point the production role used). `verify:replay`'s default SHARED reference therefore reports
   **0 drift**; a fresh-only drift of exactly 021's or 022's objects now means a NEW migration is
   waiting for its shared apply, never a broken replay
   (`docs/RECIPES/add-a-migration.md`). Before 021, both databases stood at **020** on 2026-10-15
   (`013_cooler_radiator_size.sql` / OG-28, `014_build_rejection.sql` / OG-04,
   `015_relax_rejection_partner.sql` / OG-32, `016_og02_og03_memory_and_status.sql` / OG-02+OG-03,
   `017_offer_identity_and_provenance.sql` / OG-06, `018_build_component_offer_provenance.sql` /
   Decision 35 — 018 applied to both on 2026-10-07; `019_recommendation_pass_facts.sql` and
   `020_product_identity_and_media.sql` / Decision 46 — the branch on 2026-10-14, shared on
   2026-10-15 from restore point `br-damp-grass-axyri6yl`, so there was no branch-only trail left at
   that point).
   `verify:replay` diffs a fresh replay against `DATABASE_URL` and reports **0 drift** over all
   22 files (re-run 2026-10-19 after the shared apply; the 20-file measurement of 2026-10-15 was
   the previous tail). Use `npm run verify:replay -- --test-db --reference=test` to diff against the branch
   instead of shared.
6. **Migration ledger (OG-14, 2026-10-04).** `run-migrations.js` is ledger-driven: it records each
   applied filename in `schema_migrations` and applies only the pending tail, so it is re-runnable
   (the bare `CREATE TYPE` in `002_enums.sql` no longer aborts a second run). A database that
   predates the ledger is adopted once with `node scripts/run-migrations.js --baseline` (writes the
   ledger only, runs nothing). `--check` is the freshness gate; `--offline` needs no DB. Never rely
   on the old "apply files individually via a throwaway script" workaround — it is superseded.

7. **Empty-database replay: use a real DATABASE, never a scratch schema.** Migrations `008` and `011`
   guard enum creation with a namespace-blind catalog lookup
   (`IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assessment_type')`), and `pg_type` is
   database-global. In a scratch schema the guard sees `public`'s copy and skips creating one, so the
   result is either a phantom 12-vs-14 enum drift (with `public` on `search_path`) or
   `42704: type "assessment_type" does not exist` (without it). Both are harness artifacts. Measured
   on this box: two of three first attempts produced confidently wrong answers this way.
8. **No empty database exists by default.** `TEST_DATABASE_URL` is a full snapshot (41 tables, 15-row
   ledger, 100 products). The `neondb_owner` role on that Neon instance holds `rolcreatedb`, so
   `CREATE DATABASE` on it is permitted — that is how the replay gets a genuinely empty target.
   Neon propagates `CREATE DATABASE` asynchronously, so connecting immediately races it and fails
   with a cached `database ... does not exist (server_login_retry)`; retry, do not report it as a
   replay failure.
9. **Schema diffs must compare definitions, and must exclude `schema_migrations`.** A name-only
   comparison passes a CHECK that kept its name and changed body — C-30's first pass had exactly
   that weakness. `schema_migrations` is created by `run-migrations.js`, not by a numbered migration,
   so a fresh replay legitimately lacks it and including it manufactures drift that does not exist.
   `compareSchemaSnapshot(fresh, live)` takes `Record<string, string[]>` of PRE-FORMATTED definition
   strings (e.g. `product.chk_x :: CHECK (...)`), not column objects — passing objects reports drift
   on two identical snapshots.
10. **A leftover `migrations_replay_tmp` blocks the next replay.** The scratch name is fixed, so a
    crashed or `--keep-db` run makes every later run fail with `database ... is being accessed by
    other users`. Clear it before re-running:
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='migrations_replay_tmp'`
    then `DROP DATABASE IF EXISTS migrations_replay_tmp`. This is also why the CI job sets
    `cancel-in-progress: false`.
11. **Spec tables are `ON DELETE NO ACTION`, not CASCADE — delete children first.** Every
    `<role>_spec` FK back to `product`, and `product`'s own FK to `product_family`, forbid
    cascading, so `DELETE FROM product WHERE id=...` raises a constraint violation and leaks every
    row. `verify-pool-independence.js` hit this and its first cleanup silently failed while the
    gate still printed PASS. Delete spec rows, then the product, then the family — and make a failed
    cleanup fail the run: a gate that cannot prove it cleaned up has not proved anything. Note
    `process.exit(code)` ignores `process.exitCode`, so a cleanup verdict set in a `finally` must be
    folded into the exit path explicitly.
12. **A probe fixture must be inert BY CONSTRUCTION, and its anchor must be deterministic.** PI-1's
    first version anchored the probe to an existing product's family with `LIMIT 1` and no
    `ORDER BY`; it intermittently borrowed a family that participates in a build and reported drift
    that was not pool-dependence at all. A gate that cries wolf gets ignored. When a gate inserts
    fixture data, give the fixture its own parent row so it cannot join anything existing, and order
    every anchor lookup.
13. **`scripts/lib/db-url.js` `resolveTestDbUrl(env)` returns a pg connection CONFIG OBJECT**
    (`{ connectionString, connectionTimeoutMillis }`), not a URL string. Treating it as a string
    surfaces as the deeply unhelpful `TypeError: str.charAt is not a function` from inside `pg`.
14. **Tooling quirks on this box (both have cost real time).** `awk`'s `\r` regex misreports a CRLF
    file as bare-LF — trust `od -c` or a CR-vs-LF count instead; it will otherwise make you "fix"
    line endings that are already correct. And `git status` can report a file as modified while
    `git diff` is empty (CRLF/stat-cache); `git update-index --refresh` or `git checkout --` settles it.
15. **Node-version trap: `node --test` cancels an accidentally-nested test on Node 22 (`cancelledByParent`) but silently runs it on Node 24 — and both CI jobs pin Node 22, so a green local run on 24 can hide a red CI job.** A file with an unterminated `test(...)` registers the tests written after it as its subtests; Node 22 finalizes the parent first and cancels them. Reproduce the CI leg with `npx -y node@22 --test "src/**/*.test.js"` (and `... "scripts/lib/*.test.js"`), and read the `# cancelled` line — a cancelled test is NOT counted as `fail`. There is no `engines` field and no `.nvmrc`.
16. **`node-postgres` returns a `NUMERIC` column as a STRING, so any pure function that claims a read-path caller must accept that shape.** Verified 2026-10-14: `SELECT 1000.00::numeric` -> `"1000.00"` while `3::integer` -> `3` — NUMERIC is deliberately left unparsed (exact decimal vs double). `recommendation_query.budget_amount`, `build_candidate.total_price`, `build_candidate.score` and `build_component.selected_price` are all NUMERIC, which is why the repo's loaders coerce (`offers/select.js` `Number(row.price)`, `filtering/context-loader.js` `Number(row.width_slots)`) and the API presenter has `toNumberOrNull`. A fixture that uses JS numbers for those passes while the LIVE read path throws `INVALID_FIELD_VALUE` — E7 shipped that defect until a read-path probe caught it, so any read-path claim needs a `toFixed(2)`-string fixture.
17. **The API's read path is `apps/api/src/repository.js` `readRecommendationResult(db, queryId)` — probe through it rather than re-writing its SQL.** Two traps: `SELECT_QUERY_SQL` returns only `id, budget_amount, currency, use_case, created_at` (the `priority` and `resolution` columns EXIST but are not fetched, so a read-path derivation of those two needs its own SELECT), and `SELECT_BUILDS_SQL` INNER-joins `recommendation_result`, so a fixture that inserts only `build_candidate` + `build_component` reads back **0 rows**. Order is `recommendation_query` -> `build_candidate` -> `recommendation_result` -> `build_component` (its `product_id` needs a real `product` row); delete children first and assert residue 0 LAST, because a leftover `recommendation_query` row blocks the golden harness preflight.
18. **The golden harness's landing escalation is armed by DATA, not by code landing.** `test/golden/scenarios.json` `current_epic` (currently `"E1"`) is compared against each scenario's `expect_builds_after`, and ANY UNKNOWN becomes a HARD FAIL (exit 1) once `current_epic >= that epic` — so S17/S18 (`expect_builds_after: "E6"`) turn the gate RED the moment the pointer reaches E6, while no GPU-less OFFICE build exists. Advancing `current_epic` is a gate-affecting act, never a status edit.

## 8. Hard rules

- **Never reset, drop, truncate, or restore the shared Neon database.** It is the only dev DB.
- **Never rewrite or renumber a committed migration.** Schema changes require a new sequential
  `NNN_short_description.sql`.
- **Never bypass the migration ledger** — apply migrations only through the ledger-driven
  `run-migrations.js` (OG-14: pending tail only, one transaction per file — re-running on the live DB is safe); never replay the files by hand.
- **Never apply a migration to the shared `DATABASE_URL` without a recorded Neon restore point.**
  `run-migrations.js` refuses — exit 1, ledger untouched — unless `--restore-point=<id>` matches
  `^[A-Za-z0-9_-]{8,}$`, printing the pending files instead. The requirement is scoped to a real
  shared apply: `--test-db` and the read-only modes (`--dry-run` / `--check` / `--offline`) never need it.
  Each applied file is recorded in the **tracked, append-only** `database/migration-applies.jsonl`
  — six whitelisted fields (`applied_at`, `filename`, `git_sha`, `note`, `restore_point`,
  `target`), unknown keys refused, and a null `restore_point` allowed only with a `note` saying why.
  `target` must be a `db:<12 hex>` digest from `applyLogTarget` (the normalized host and database,
  recomputable from `DATABASE_URL`, stable across the pooled/direct pair, distinct per database); the
  `shared`/`test` role names survive only in lines written before 2026-10-15, which a reader accepts and
  the formatter refuses to write.
  Commit that line with the apply. The log is an audit trail, not a guarantee: it records what the
  runner did and cannot prove that nothing else wrote to shared.
- **`--baseline` writes the ledger without running any SQL, so it is guarded too.** On the shared
  target it needs the same `--restore-point=<id>` and prints every filename it is about to record;
  without a valid id it refuses and the ledger is untouched. The hazard it closes: a mis-typed
  `--baseline` could record a migration as applied that was never applied, leaving the database
  silently behind its own ledger while every later run reports "No pending migrations". It cannot
  verify that either, so the future improvement is to confirm the objects those files create
  actually exist (the read-only `verify-schema.js` / `verify-constraints.js` / `verify-fks.js`
  checks) before adopting an already-migrated database.
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
| The HTTP API surface, status codes, option vocabulary | `docs/API.md` (the contract) and each `apps/api/src/` module's header comment |
| Layer 4 reconciliation history | `database/LAYER4_RECONCILIATION_PLAN.md` |

When sources conflict, prefer the more authoritative one, in this order:

1. `database/migrations/*.sql` and the executable code (with its tests) — what the system actually does.
2. `docs/RECOMMENDATION_ENGINE_DECISIONS.md` — the intended engine contract.
3. `docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md` — the design the decisions refine.
4. `CONTEXT.md` — status, which drifts behind the code.
5. `DEVELOPMENT_NOTES.md` — dated operational notes (may describe past states).

Do not silently pick a side: if prose and code disagree, follow the code and report the drift.

## 10. Known doc drift — verify before trusting

- **Acceptance-criterion numbers are easy to attribute to the WRONG decision.** PI-1 (pool
  independence) is **Decision 23** criterion 3, NOT Decision 20 — Decision 20's criteria 1-2 are the
  CPU/GPU pair-diversity claims `measure-orchestrator.js` was built for. Before citing a criterion,
  match it to the decision's own `## Decision NN` heading; `Status:` lines do not disambiguate when
  one decision cross-references another.
- **`.env` is loaded by the scripts themselves, not the shell.** Every DB-touching entry point
  calls `require('dotenv').config()` internally (`check-offer-freshness.js:35`,
  `verify-migrations-replay.js:309`, `verify-docs.js:258`), so `DATABASE_URL` is absent from
  `process.env` in a bare shell yet the commands still work. Do not conclude a secret is unset from
  the shell alone. In CI there is no `.env`, so the workflow must pass both URLs via `env:`.
- **`TEST_DATABASE_URL` is only usable together with `DATABASE_URL`, and the two must be different
  hosts.** `resolveTestDbUrl` needs both and compares normalized hostnames (a `-pooler` suffix is
  stripped first), so it throws if they match. Any CI job or script touching the test DB therefore
  needs both secrets wired up, not just the test one.

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
- **All four Decision 26 item B rules are ENFORCED — none is deferred any more.** Decision 26
  (2026-09-28) deferred all four; **Decision 30 (2026-10-05) UN-deferred air-cooler `height_mm`
  vs `case_spec.max_cpu_cooler_height_mm`** (IMPLEMENTED in `compatibility/cooler-height.js`), and
  **Decision 45 (E8, 2026-10-14) UN-deferred the remaining three**: cooler `max_tdp_watts` vs CPU
  `tdp_watts` (OG-09, SOFT — an apparent shortfall resolves UNKNOWN `COOLER_TDP_INSUFFICIENT` and
  never rejects), and RAM `module_count` vs `motherboard_spec.dimm_slots` (OG-11) and RAM
  `module_count * capacity_per_module_gb` vs `max_memory_capacity_gb` (OG-12), both HARD and
  REJECTing the candidate. The six operands are carried by `filtering/context-loader.js` and each
  pair is registered in BOTH `filtering/filter.js` and `assembly/assemble.js`. The binding trigger
  is unchanged and now guards enforced rules: re-run `node scripts/check-deferred-rules.js` before
  merging any CPU/cooler/case/RAM/motherboard seed — a non-zero count is a LIVE DATA DEFECT,
  not a latent risk. **That gate reports "0 violations", which is NOT evidence that a column's
  stored value is correct** — it only compares stored values to each other, so an unsourced
  literal passes it silently (OG-36).
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
- **The commit wrapper's re-run guard keys on `build_candidate` ONLY** (`commit.js` guard 2, Decision 19.2), and since Decision 31 that is by design: anything else the commit writes must be written REPLACE-style to stay idempotent. `build_rejection` now is — the writer clears its own query's rows (`DELETE ... WHERE recommendation_query_id = $1`) before re-inserting, inside the same transaction, so a zero-build pass can be re-committed without duplicating diagnostics (OG-33, CLOSED 2026-10-05). Before relying on "a re-run cannot duplicate X", check whether X's writer clears its own scope; guard 2 alone will not.
- **Driving `filterCandidatesForRecommendation` by hand: four contract details bite.** `product` has NO `category` column — category is DERIVED from spec-table presence, so build the pool with `scripts/lib/og01-catalog.js`'s `loadOg01Catalog(db)`. `pool` is a FLAT ARRAY of `{ component_role, product_id, product_variant_id, category }`, not an object keyed by role. Role `RAM` maps to category `MEMORY` and `CPU_COOLER` to `COOLER` (see `candidates/roles.js` `ROLE_CATEGORIES`). `input.budget_amount` must be a finite NUMBER (a NUMERIC string is rejected) and `input.required_roles` must list all 8 `EXPANSION_ORDER` roles.
- **A full-catalog pool legitimately yields 2 REJECTs and 12 UNKNOWNs.** The REJECTs are the known `GPU_TOO_THICK` pair and the UNKNOWNs are the OG-07 NULL GPU dimensions. Assert against that baseline, not against "zero REJECT" — an over-strict assertion will look like a regression when nothing is wrong.
- **Never split a seed file with `split(';')` to run its statements.** A `;` inside a header comment splits mid-comment, every chunk then starts with `--`, and a `/^UPDATE/` filter silently drops them all — the apply reports success and writes NOTHING. Run the whole file with `client.query(rawText)` (it carries its own BEGIN/COMMIT), or strip comments first. This happened while applying seed 009 and left the shared DB unchanged with a clean-looking exit 0.
- **`run-seeds.js --dry-run` counts statements and characters; it NEVER executes them, so it cannot catch a broken INSERT — and it splits by `;` so a `;` in a header comment silently inflates the count into a misleading number, not an error.** Correcting a bare literal into a `VALUES` column (seed 011's OG-36 change, `160` -> `v.cooler_h`) widened the tuple from 3 columns to 4, and the dry-run reported the file clean. To prove a rewritten INSERT is still valid SQL: extract just that one `INSERT` (never the whole file — a seed's own `COMMIT` would commit your transaction), `DELETE` the target rows inside your transaction so the `WHERE NOT EXISTS` guard does not suppress it, execute it verbatim, read the rows back, then `ROLLBACK`. **But note `run-seeds.js` (and a hand-rolled `client.query(sql)`) runs the file AS-IS, including any embedded `BEGIN`/`COMMIT` or native `
` escapements — so if you write a seed yourself, give it its own transaction window and verify idempotency with a REAL re-run, not a `split(';')` rehearsal. Never pipe the whole seed file through `split(';')` anywhere near a live client.**
- **A COALESCE-based idempotency guard silently disables a corrective UPDATE.** `WHERE col IS DISTINCT FROM COALESCE(col, desired)` is ALWAYS FALSE when `col` is non-NULL, because COALESCE returns that same value; it updates 0 rows, and it can never write an explicit NULL. For corrections use `WHERE col IS DISTINCT FROM <desired>` with an unconditional SET (seed 008 / seed 009 Block 2). Only use COALESCE when you are filling NULLs.
- **Before scheduling data-research work, check the DATA is real.** A gap can ask for research that cannot exist: `store_offer.seller_name`/`product_url` were 101/101 NULL (OG-19) but the only 2 stores are `Seed %` fixtures on the IANA-reserved `example.ma` domain, so no citable seller or URL exists. Grep `src/` for the column first — nothing read them — then check whether the value is derivable (`seller_name` == `store.name`) before treating NULL as missing work.
- **Prove claims about persisted ids/rows with a real round-trip, not a fake client:** insert, SELECT the row back, compare the stored id to the returned one, and assert residue is 0 in the same script's `finally`. `scripts/lib/db-url.js`'s `getWriteTestDbUrl()` returns a **config OBJECT** (`{ connectionString, connectionTimeoutMillis }`), not a string — pass it straight to `new Client(...)`.
- **A throw INSIDE a probe's `finally` skips every cleanup step after it.** One wrong column name (`build_rejection.query_id`; it is `recommendation_query_id`) aborted the first cleanup statement, so the DELETE of the parent query and the spec restore never ran and the probe's rows survived on the branch DB. Put the residue assertion last, keep each cleanup step independent, and inventory leftovers before deleting them — guard the DELETE on the rows actually being yours.
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
- **Un-deferring a Decision 26 rule is not a status edit — it is a new Decision.** Lifting OG-10 required: the rule, the loader columns, reason codes, unit tests, a Decision record, the register row plus a closed row, a CONTEXT line, AND updating `check-deferred-rules.js` so the standing gate stops calling an enforced rule latent. The gate bumping its hardcoded decision counts (now 34/40) is the documented `verify-docs` breakage for adding Decision N+1, not a regression — see the `agents-decision-range` check.
- **Un-deferring a rule makes BOTH its operands load-bearing — audit the one you did not research.** OG-10 shipped on a researched cooler `height_mm` (seed 010 / OG-34) and an *unresearched* case `max_cpu_cooler_height_mm` that no seed had ever sourced, so `check-deferred-rules.js` reported "0 violations" by comparing good data against a literal. The violation gate answers "do these two stored values agree?", never "are these two stored values true?", so a green gate is not evidence about a column nobody sourced. When a rule starts reading a column, trace that column back to the INSERT that wrote it and ask which products share a literal. This is how OG-36 was found: the bare `160` covering both seed-001 cases was visible one screen from the `CROSS JOIN (SELECT 155 AS h)` that seed 010 had just fixed.
- **A closure that justifies itself with a stored number must survive that number being corrected.** C-26 shipped OG-10 on "smallest case clearance 160mm vs a tallest cooler of 158mm". Both figures were right and the 2mm margin was real, but the 160 was the placeholder, so the margin was computed against a literal. Fixing the data did not change the margin or the verdict set — yet the sentence still had to be corrected, because a reader would have cited the wrong case. When a later correction changes which row holds an extremum, update the earlier prose that named it rather than leaving a figure that is accidentally still true.


- **In this environment a heredoc or shell redirection into `/tmp` is REFUSED, and backticks/'$' inside `node -e` are eaten by bash** — a `node -e` body containing SQL with '$1' or a backtick fence dies with `unexpected EOF` before Node runs. Build such strings from char codes (`String.fromCharCode(39)` for quotes, `96` for backticks) or write the file with a `node -e` that emits each line, then `node --check` it before running. Note a template literal needs NO `backslash-dollar` escape: writing `\`{1}`` emits a literal backslash into the SQL and Postgres fails with `syntax error at or near`.
- **A row-COUNT assertion cannot detect a column silently going back to NULL.** OG-32's partner columns persisted correct rows while every id stayed NULL, and Decision 31's OG-33 harness counted rows only, so it would never have caught it. Whenever a fix is 'the value is finally populated', the durable pin must read the column back and assert its VALUE — a count-only pin passes against the original defect.
- **Check whether a CHECK constraint forbids the fix before designing the producer.** 014's both-or-neither partner CHECK made every product-keyed partner unstorable, so fixing `filter.js` alone would have traded a NULL column for a `23514` on every real rejection. Relaxing the constraint was a prerequisite, not polish — and Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, so a relax migration raises `42710` on re-application; single application comes from the OG-14 ledger, not the file.
- `getWriteTestDbUrl()` is a connection CONFIG OBJECT (`{ connectionString, connectionTimeoutMillis }`), not a URL string — pass straight to `new Client(...)`. When applying a SEED branch-first, the residual table does not exist until you `SET search_path = public` AFTER connecting (the branch client defaults to `pg_temp`), so `INSERT INTO motherboard_memory_support ...` returns `relation "motherboard_memory_support" does not exist` even when the table is there. Pattern: connect via the branch client, `SET search_path = public`, then `client.query(rawSql)` with the whole file. The residual table name in the error is the clue it is a search_path issue, not a missing migration.
- `run-seeds.js` ignores `--test-db` and has NO `getWriteTestDbUrl()` routing — `--test-db` routes NOTHING, and `run-seeds.js` always targets the shared `DATABASE_URL`. To apply a seed branch-first you must target the TEST branch DB yourself with the same pattern `run-migrations.js --test-db` uses. `run-seeds.js --dry-run` only counts statements/characters (it splits by `;`, so a `;` inside a header comment silently inflates the count, it never executes the file).
- Never pipe a seed file through `split(";")` anywhere near a live client — a `;` inside a header comment splits mid-comment (chunks start with `--`), and a `/^UPDATE/` filter silently drops them all with a clean-looking exit. A seed that carries its own `BEGIN;`/`COMMIT;` also cannot be rollback-rehearsed by wrapping it in an outer transaction — the inner COMMIT ends the outer one and the caller rollback becomes a no-op. So if you author a seed, give it its own transaction window and verify idempotency with a REAL re-run (reconnect and apply again, read counts back), not a `split(";")` rehearsal nor a `client.query(sql.split(";"))`.
- **E6's declared `gpu_policy` rule is IMPLEMENTED but INERT on the catalog — its unit tests are not evidence the epic works.** Decision 43 shipped the `IGPU_ALLOWED` hard-skip at Engine 3 GPU depth, yet no GPU-less OFFICE build exists: the OFFICE rank-1 CPU (`Seed AMD Ryzen 5 5500`) has no integrated GPU, so the declared policy correctly resolves to `REQUIRED` and the skip can never fire (measured 2026-10-14: S17/S18 yield 0 ranked builds under BOTH the v1 and launch-v2 pins and assertion A6 is never green). Read OG-49 before assuming E6 is done, and before advancing `current_epic`.
- A `check-deferred-rules.js` green (0 violations) is NOT evidence that a column nobody sourced has a true value — the gate compares stored values to each other only. When a rule starts reading a column, trace that column back to the INSERT that wrote it and ask which products share a literal (this is how OG-36 was found). An enforced rule with 0 violations is indistinguishable from a dead rule unless you force the violation and assert the expected REJECT.
- git stores CRLF text files without the CR bytes in the patch payload (the patch is LF-only) — so `grep -c "\r" < <(git diff -- AGENTS.md)` reads `0` even on a clean pure-CRLF file. Use `file -b AGENTS.md` ("with CRLF line terminators") or byte-level inspection, never the patch, to assert line endings. Git only complains about CRLF→LF normalization in the patch when autocrlf is set; this repo has it unset and the file is pure-CRLF on disk.
- **Appending a Decision entry is not a hand-edit: do it byte-level via a temp Node writer** (read BOM, append CRLF text, write back) and check `git diff --numstat` reads as pure additions (`101+ 0−`); a writer that rewrites via `toString('utf8')` without the BOM round-trip adds a spurious first-line diff. Long entries typed inline in the writer are its weak point: after running it, grep the committed text for mojibake fragments (e.g. `圣人`, `twopre`) — 2026-10-10's Decision 40 pass shipped three operator-level typos that needed a post-write grep sweep to catch.
- **Applying a seed through `scripts/apply-seed.js` is idempotency-provable because its guard is the SET-search_path-scoped, whole-file single query** — a re-run on an already-applied model seed is a no-op but must STILL be executed, not inferred from the guard text: 2026-10-10 verified seeds 014/015/016 by reading `configuration->'candidate_caps'` back per version after a real re-run, not by trusting the NOT EXISTS clause.
- **E3 declared-absence equivalent: when a new optional cap breaks byte-identity hunting, wipe nothing**; the proof-of-identity run is `node scripts/eval-scenarios.js --model=launch-v2@1.0.0 --baseline=test/golden/_scratch-<name>.md --no-volatile` committed to the tree — run BOTH the absent key and the new key (1.0.0 and 1.1.x) in one sweep to show the engine is byte-stable on the old pin and differently-behaving on the new one; the six-file `_scratch-v1..v6` series is the format to extend, never a separate doc dir.

