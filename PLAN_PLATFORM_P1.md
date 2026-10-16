# PLATFORM PLAN — P1: the latency program (co-locate, then batch, then dedupe)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** get a `POST /v1/recommendations` pass from a measured p95 of 13.3 s to p95 ≤ 2.5 s uncached and ≤ 300 ms cached, by co-locating the API with the database first and only then batching statements.

**Architecture:** the latency is per-statement round-trip latency to a remote Postgres multiplied by a sequential pipeline (74 statements, ~147 ms each), not HTTP overhead. So the order is: (1) remove the distance — deploy the API in the same region as the database, and move the database to the EU; (2) remove statements — batch the commit's INSERTs; (3) remove loader statements; (4) only if those miss, add a cache behind its own Decision and a `catalog_version`; (5) then the two features that fall out of the same canonical key (request dedupe, presets).

**Tech Stack:** Node.js 22 CommonJS, Fastify 4, `pg` raw SQL, PostgreSQL 18 on Neon, Fly.io or Render (EU region), GitHub Actions.

**Spec:** this file, plus the measured baseline in `docs/RECOMMENDATION_ENGINE_DECISIONS.md` (Decision 36 "Load — MEASURED" / "Cause — MEASURED"), the P1 section of the M3 roadmap, and **OG-52** in `docs/OPEN_GAPS.md` (which owns the claim that this work is not absorbed).

**Date:** 2026-10-15 · **Branch:** `agent/platforms` · **Decision id:** the next free number taken from `docs/RECOMMENDATION_ENGINE_DECISIONS.md`'s tail at write time (46 today) — never pre-reserved, because another agent may be committing.

**Owner gates in this plan:** Sprint 1 needs a new Neon project and a hosting account (spend + new cloud resources) — owner approval before creation. Sprint 5 changes the POST contract — owner review before merge.

**Program rules:** the Global Constraints, the run-safely protocol and the self-review protocol this plan works inside live once, for P0–P3, in [PLAN_PLATFORM_CONSTRAINTS.md](PLAN_PLATFORM_CONSTRAINTS.md). This plan adds only what is specific to it, and its self-review verdict is recorded there.

## Review Focus

The five failure modes this plan's own tests do not fully cover, most likely first. Each gets a test in the owning sprint.

1. **A batch INSERT that reorders rows.** A 3-build pass persists 3 candidates, ~24 components and 3 results; a multi-row INSERT may return rows in an order the writer did not intend, and the golden harness compares *ranked* output. Owning sprint: Sprint 2.
2. **Statement batching that silently drops a NULL.** `product_variant_id`, `selected_price` provenance and `budget_floor`'s `cheapest_by_role` all carry NULLs legitimately; `UNNEST` over a JS array converts `undefined` to NULL, which is correct, but a JS `null` inside a nested array is not the same shape. Owning sprint: Sprint 2.
3. **A spoofable client IP after the proxy change** (Sprint 2 of P2 changes `trustProxy`), which would make every rate-limit measurement and every per-IP quota meaningless. Owning sprint: P2 Sprint 2 — named here because a load test is where it would be discovered.
4. **The co-located database being a different database.** Row counts, the ledger tail and the schema digest must match the old target exactly, or every later measurement compares two catalogs. Owning sprint: Sprint 1.
5. **A cached answer served while the catalog changed.** The whole cache design turns on `catalog_version`; a cache without it returns stale builds after a seed or a price update. Owning sprint: Sprint 4.

---

## Sprint 1 — Co-locate: the EU Neon project and a deployed API, then re-measure (owner-gated, ~90 min)

**Summary.** Create a Neon project in the EU, replay the full migration + seed stack into it, deploy the API into the co-located region, and re-run the same measurements against it. This is the step the roadmap puts first and the one that decides whether Sprints 2–3 are required at all.

**Why now.** The recorded ~147 ms per round trip is measured from a client to `aws-us-east-2` (Ohio): verified 2026-10-15, the `morocco-pc` Neon project (`gentle-fog-04615130`) is `region_id: aws-us-east-2`. The catalog is ~104 products, so most of that latency is distance, not work, and no amount of batching removes distance.

**Files:**
- Create: `fly.toml` (repo root; the container's app definition, health check, internal port, region)
- Create: `scripts/check-target-parity.js` (read-only: compares two databases' ledger tail, table list and row counts, and prints a table)
- Modify: `scripts/run-migrations.js` and `scripts/lib/run-migrations-cli.js` — add `--note=<text>` so an apply can say WHAT it was for (see the task below; the `note` field already exists in `APPLY_LOG_FIELDS` and `formatApplyLogLine` validates it, but the runner hardcodes `note: null` and there is no flag)
- Modify: `docs/API.md` — a "Deploy (EU)" subsection: the region, the host, the env var list, the health-check path, and the deploy command
- Modify: `DEVELOPMENT_NOTES.md` — the measured before/after table and every command used
- Test: `scripts/lib/run-migrations-cli.test.js`, `scripts/lib/migrations.test.js` (the `--note` flag and its audit-line shape)

**Interfaces:**
- Consumes: `apps/api/Dockerfile` (builds from the repository root, copies `src`, `apps/api`, `scripts/lib`), `apps/api/.env.example` (the complete env-var list: `PORT`, `HOST`, `ALLOWED_ORIGINS`, `LOG_LEVEL`, `LOG_PRETTY`, `ENGINE_VERSION`, `DATABASE_URL`, `TEST_DATABASE_URL`, `API_ALLOW_SHARED`), `scripts/run-migrations.js`, `scripts/run-seeds.js`, `scripts/measure-api-pass-phases.js`
- Produces: `TARGET_DATABASE_URL` (the new EU project's connection string) and `API_BASE_URL` (the deployed origin) for every later sprint; `fly.toml`; the parity table from `check-target-parity.js`

- [x] **Step 1: add `--note=<text>` to the migration runner.**

`parseArgs(argv)` gains `note` (default `null`, non-empty string when present); the parsed object becomes `{ flags, restorePoint, note }`; `recordSharedApply({ restorePoint, files, note })` threads it into the line instead of the hardcoded `note: null` at `scripts/run-migrations.js:175`. Why this is a step and not a nicety: the runner reads whichever URL `DATABASE_URL` holds, and `APPLY_LOG_TARGETS` is exactly `['shared', 'test']` (verified in `scripts/lib/migrations.js`), so an apply against a NEW EU project would append lines claiming `target: "shared"` with nothing to correct them. The `note` field is the existing, whitelisted way to say otherwise.

**SUPERSEDED 2026-10-15 — the `target` field itself now NAMES the database, so the note stops carrying that job.** `applyLogTarget` derives `db:<12 hex>` from the connection string (normalized host + database), the formatter refuses any other shape, the runner prints the value as `AUDIT TARGET:` before it writes anything, and `LEGACY_APPLY_LOG_TARGETS` keeps the four pre-existing `shared` lines readable without accepting a new one. Step 1 stands: a note is still the human half of a line, and it is now prose about intent rather than the only field that can name a database.

- [x] **Step 2: write the failing tests for the flag.**

In `scripts/lib/run-migrations-cli.test.js`: a parse for `--note=a new EU project` returns that note; `--note=` (empty) is an error with the usage text; a note is carried into the audit line. In `scripts/lib/migrations.test.js`: `formatApplyLogLine({ applied_at, filename, git_sha, note: 'x', restore_point: 'abc12345', target: 'shared' })` round-trips with `note: 'x'`, and an unknown key still throws. Run: `npm run test:scripts`. Expected before the implementation: FAIL.

- [x] **Step 3: implement, then verify.**

Run: `npm run test:scripts` → expected 0 fail. Then `node scripts/run-migrations.js --dry-run` → expected: the pending list plus the `AUDIT TARGET: db:…` line the run would log (added 2026-10-15), no write (the audit log is untouched: `git --no-pager diff --stat -- database/migration-applies.jsonl` prints nothing).

- [ ] **Step 4 (OWNER): create the EU Neon project, and record its id and region.**

Target: Frankfurt, co-located with Fly's `fra` / Render's `frankfurt`. `list_regions` is **not available to this account's organization API key** (measured 2026-10-15: HTTP 404 "not allowed for organization API keys"), so confirm the region id in the Neon console rather than assuming it — `create_project` rejects an invalid id, which is the check. Record the project id and region in `DEVELOPMENT_NOTES.md`. Nothing else in this sprint can start before this exists.

- [ ] **Step 5: create the restore point, then replay into the new project.**

`create_branch(parent = the new project's default branch, name = 'pre-p1-replay', no_compute = true)` → take its id. Then, with `DATABASE_URL` pointed at the new project and `scripts/lib/db-url.js`'s guard satisfied (the two URLs must have different hostnames — keep `TEST_DATABASE_URL` on the original branch):

`node scripts/run-migrations.js --restore-point=<new branch id> --note="P1 co-location: new EU project <id> (<region>)"`

Expected: 20 files `MIGRATED`, one audit line each with the note naming the EU project, and `target` = the EU project's OWN `db:<12 hex>` digest — never `shared`, because since 2026-10-15 the field names the database, so a `shared` value on a line written now means the runner wrote to the wrong one. Then run every seed: **`run-seeds.js` ignores `--test-db` and has no routing**, so apply `database/seeds/*.sql` through a script that uses `getWriteTestDbUrl()`-style explicit targeting — or point `DATABASE_URL` at the new project and run it, then reset `DATABASE_URL`. Either way, run each file as it is (`client.query(rawText)`), never split on `;`.

- [ ] **Step 6: prove parity with `check-target-parity.js`.**

`node scripts/check-target-parity.js --a="$DATABASE_URL" --b="$TARGET_DATABASE_URL"` (read-only) prints, per target: the `schema_migrations` tail and count, the table count, and row counts for `product`, `product_variant`, `store_offer`, `component_assessment`, `scoring_model`, `benchmark_result`, `store`. Also compare the schema digest lines: run `npm run gen:schema` against each and `diff` the `schema-digest:` lines. Expected: identical digest, identical counts. **A difference means stop** — every later measurement would compare two catalogs.

- [ ] **Step 7: deploy.**

Preferred: Fly.io, region `fra` (Frankfurt). `fly.toml` sets `primary_region = "fra"`, `internal_port` matching `PORT` (the app reads `PORT`, default 3000), a health check on `/v1/health`, and `[[vm]] shared-cpu-1x 256MB` to start; then `fly secrets set DATABASE_URL=... TEST_DATABASE_URL=... ENGINE_VERSION=$(git rev-parse --short HEAD) API_ALLOW_SHARED=0` and `fly deploy` (it builds the repo-root Dockerfile). Alternative: Render, region `frankfurt`, Docker from the repo root, `PORT=10000`, `healthCheckPath=/v1/health`. **Verify current pricing and the region list before committing spend** — Fly's smallest always-on machine is roughly $2.28–2.53/month and Render's smallest paid web service ~$7/month (researched 2026-10-15; the sources are in the sprint record).

- [ ] **Step 8: re-measure, twice, and record both.**

`node scripts/measure-api-pass-phases.js --budget=20000 --use-case=GAMING --model=<name@version>` against the new target (per-phase statement counts and timings, **with the pin recorded** — the instrument refuses to measure an inactive pin, and two runs pinned differently are not a comparison), then the 50-POST HTTP load profile that produced the recorded baseline (min 9 988.6 / p50 11 898.8 / p95 13 313.0 / max 14 425.5 ms). Record: statements per phase, ms per phase, ms per round trip, and the p50/p95/max, next to the target host and region.

- [ ] **Step 9: commit.**

`git commit -m "P1 Sprint 1: co-locate the API with an EU database and record the before/after" -- fly.toml scripts/check-target-parity.js scripts/run-migrations.js scripts/lib/run-migrations-cli.js scripts/lib/run-migrations-cli.test.js scripts/lib/migrations.test.js docs/API.md DEVELOPMENT_NOTES.md`

**Definition of done**
- `--note=<text>` exists, is validated, and reaches the audit line; `test:scripts` 0 fail.
- The EU project exists, carries the same schema tail (20) and the same row counts as the original target, and its schema digest matches.
- The API is deployed and answering `GET /v1/health` → `{"status":"ok","db":"ok",...}` on the deployed origin (a local 200 or a startup banner does not count).
- The before/after table exists in `DEVELOPMENT_NOTES.md` with both commands, both hosts, both regions and both dates.
- The owner has re-derived the target from the measurement, or confirmed the roadmap's hypothesis.

**Test scenarios**
| # | Scenario | Expected |
|---|---|---|
| 1.1 | `--note=` with an empty value | usage error, exit 2, no write |
| 1.2 | Apply against the new project without `--restore-point` | refuses, exit 1, ledger and audit log untouched |
| 1.3 | `check-target-parity.js` on two identical databases | every row MATCH, exit 0 |
| 1.4 | `check-target-parity.js` after deleting one product on B | a named difference for `product`, exit 1 |
| 1.5 | `GET /v1/health` on the deployed origin | 200, `status: ok`, `db: ok`, an `engine_version` equal to the deployed short SHA |
| 1.6 | The same instrument run against both targets | a statement count that is IDENTICAL (the pipeline did not change) and a lower ms/round trip |

**Status 2026-10-15 — Steps 1-3 DONE and committed; Steps 4-9 remain OWNER-gated.**

`--note=<text>` exists on `scripts/run-migrations.js` and reaches every audit
line of a shared apply. Three findings worth keeping:

- **The formatter was already ready; only the FLAG was missing.**
  `formatApplyLogLine` has validated a `note` field since the audit log was
  added, and the runner hardcoded `note: null`. So the two
  `scripts/lib/migrations.test.js` cases written first PASSED before any
  implementation - the only failing tests were the three in
  `scripts/lib/run-migrations-cli.test.js` (`parseArgs` default/value/blank,
  and the note reaching the persisted line). Read that as the real shape of
  the gap: plumbing, not the log format.
- **A blank note is refused (exit 2); a non-blank one is kept verbatim.** The
  note says WHAT the apply was for — a note that explains nothing is worse
  than none, and evidence is never normalized. The `=<value>` form is
  mandatory, exactly as for `--restore-point`.
- **FOLLOW-UP (2026-10-15): the audit `target` NAMES the database.** `applyLogTarget(connectionString)`
  returns `db:<12 hex>` — the first 12 hex characters of `sha256("<normalized host>/<database>")` — and
  `formatApplyLogLine` refuses every other shape, so a role name can only be READ
  (`LEGACY_APPLY_LOG_TARGETS`), never written again. Every shared-target run prints `AUDIT TARGET:
  <digest>` right after it connects and BEFORE the restore-point guard, so a refused apply still names
  its target; `--test-db` prints none because it writes no audit line at all. The print is deliberately
  not dry-run-only: the state a reviewer is in when checking an EXISTING line is the one with nothing
  pending. Measured: `npm run test:scripts` 0 fail (see `DEVELOPMENT_NOTES.md`, 2026-10-15); the
  Node 22 leg also cancels nothing (`# cancelled 0`), live shared `db:54ff6ea3f6e6` vs TEST branch `db:798b3aa04976`.
- **The flag is inert on a `--test-db` run**, which writes no audit line at
  all. That is documented in the runner header rather than enforced, so a
  scripted invocation may pass `--note` in any mode.

Verified: `npm run test:scripts` 0 fail (see `DEVELOPMENT_NOTES.md`; 3 failing
before the implementation); `--dry-run` and `--check` both exit 0 against the
shared DB with the audit log byte-identical (`git diff --stat --
database/migration-applies.jsonl` prints nothing); `--note=` and the space
form both exit 2 with the usage text. Steps 4-7 (the EU project, the replay,
parity, the deploy) and Step 8 (re-measurement) need owner resources and are
untouched.

---

## Sprint 2 — Batch the commit: 37 statements to ≤ 6 (engine-owned, ~90 min)

**Summary.** `orchestrator/commit.js`'s write path issues one statement per row. Replace the per-row INSERTs with multi-row statements so a 3-build pass commits in ≤ 6 statements.

**Why now.** The commit is the single largest time block of a pass (the roadmap records 37 statements and 4.9 s of the 12.1 s; **Step 1 confirms or corrects that with the instrument before any code is written**).

**Files:**
- Modify: `src/recommendation/persistence/persist-ranked.js` (three per-row INSERTs become three multi-row INSERTs)
- Modify: `src/recommendation/persistence/persist-rejections.js` (one DELETE stays; the per-row INSERT becomes one)
- Test: `src/recommendation/persistence/persist-ranked.test.js`, `src/recommendation/persistence/persist-rejections.test.js`, `src/recommendation/orchestrator/commit.test.js`
- Test (integration, branch): `scripts/test-orchestrator-commit.js`

**Interfaces:**
- Consumes: `persistRanked(client, { queryId, selected })` and `persistRejections(client, { queryId, rejections })` — **both signatures stay unchanged**; only the SQL and the parameter shape change.
- Produces: the same rows, in the same order, with the same NULLs. Any later module sees no difference.

- [ ] **Step 1: measure first, on the current code.**

`node scripts/measure-api-pass-phases.js --budget=20000 --use-case=GAMING --model=<name@version>` against the co-located target. Record the commit phase's statement count and ms **together with the pin**. The roadmap's 37 statements / ~4.9 s is a `seed-minimal-v1` figure — it predates `launch-v2` (created 2026-10-15) — and the pin is what stops the difference from being silent: the same command pinned to `launch-v2@1.0.0` on 2026-10-15 measured 19 statements / 2 607 ms for `engine.commit` on the same branch, against the v1-era 37 / 4 906. Both the model and the code changed between those two runs, so the pin removes ONE variable, not both. Expect the figure to be confirmed or corrected PER PIN, and note that a v1 comparison is not measurable on the TEST branch at all (`seed-minimal-v1` is inactive there; a pin never activates a model).

- [ ] **Step 2: write the failing statement-count tests.**

In `persist-ranked.test.js`, drive a recording fake client with a 3-build fixture (3 selected entries; one build with 8 components, one with 8, one with 6) and assert **exactly three** `INSERT INTO` statements total, with parameter arrays whose row counts are 3 / 22 / 3. In `persist-rejections.test.js`, assert exactly two statements (`DELETE`, then one `INSERT`) for 4 rejections. Run: `npm run test:unit`. Expected: FAIL with the current per-row counts (10 and 5).

- [ ] **Step 3: implement the multi-row INSERTs.**

Use `INSERT INTO ... SELECT * FROM UNNEST($1::uuid[], $2::uuid[], ...)`, one row per array element, in the fixture's order. Keep the existing column list and the existing `ON CONFLICT`-free replace semantics exactly; keep the `build_component` → `build_candidate` ordering dependency explicit by inserting candidates before components and components before results.

- [ ] **Step 4: run the tests and prove row-for-row identity.**

`npm run test:unit` → 0 fail. Then, on the branch, `node scripts/test-orchestrator-commit.js` (TEST_DATABASE_URL only): the same pass must persist the same rows. Capture the rows before the change and after (`SELECT ... ORDER BY rank, component_role, product_id`), and `diff` the two dumps — byte-identical is the acceptance, because the golden harness compares ranked output.

- [ ] **Step 5: re-measure and commit.**

Re-run Step 1's command; record the new commit-phase counts. `git commit -m "P1 Sprint 2: batch the commit's INSERTs to <=6 statements" -- src/recommendation/persistence/persist-ranked.js src/recommendation/persistence/persist-ranked.test.js src/recommendation/persistence/persist-rejections.js src/recommendation/persistence/persist-rejections.test.js src/recommendation/orchestrator/commit.test.js`.

**Definition of done**
- A 3-build pass commits in ≤ 6 statements, pinned by a fake-client assertion (not by a comment).
- The persisted rows are byte-identical to the pre-change rows on a real branch pass.
- `test:unit` 0 fail / 0 cancelled on Node 22 and Node 24; `verify:pi1` PASS; `eval:scenarios` exit 0 at the unchanged-engine baseline.
- The before/after statement counts and ms are recorded.

**Test scenarios**
| # | Scenario | Expected |
|---|---|---|
| 2.1 | 3-build fixture, recording client | exactly 3 INSERTs, row counts 3 / 22 / 3 |
| 2.2 | 0-build pass | 0 candidate/component/result INSERTs; the floor UPDATE still issued |
| 2.3 | A build with a NULL `product_variant_id` | the NULL round-trips as NULL, not as the string "null" |
| 2.4 | 4 rejections | 2 statements (DELETE then one INSERT) |
| 2.5 | Real branch pass, rows dumped before/after | `diff` empty |
| 2.6 | Re-run the same pass twice | replace-not-append: row counts unchanged (Decision 31's idempotence holds) |

---

## Sprint 3 — Reduce loader statements (engine-owned, ~60 min)

**Summary.** Merge the read-side queries that dominate the snapshot phase so a pass issues materially fewer read statements.

**Files:**
- Modify: `src/recommendation/filtering/context-loader.js` (the roadmap records 14 statements; confirm first)
- Modify: `src/recommendation/candidates/loader.js` (the roadmap records 9; confirm first)
- Test: the two modules' existing `*.test.js` files, plus `src/recommendation/filtering/pipeline.test.js`

**Interfaces:**
- Consumes: the current `loadFilteringContext(input, pool)` / `loadCandidates(pool)` contracts.
- Produces: **unchanged output shapes.** These loaders feed pure stages whose exact-shape fixtures are pinned by tests; the fixtures must not change.

- [ ] **Step 1: measure the read-side baseline.** `measure-api-pass-phases.js` prints per-phase INCLUSIVE and EXCLUSIVE counts; record the snapshot/loader phases before touching them.
- [ ] **Step 2: write the failing count assertions** in each loader test: N statements for the fixture, where N is the measured value minus the merges performed.
- [ ] **Step 3: merge queries** — one statement per role family per table, returned as rows the loader then groups (JS grouping is free; a round trip is not). No new dependency, no ORM.
- [ ] **Step 4: prove output identity**: `npm run test:unit` 0 fail, then the same before/after row-dump comparison as Sprint 2 using a real branch pass (`eval:scenarios` at the unchanged baseline is the end-to-end gate).
- [ ] **Step 5: re-measure and commit.**

**Definition of done**

- The loaders issue fewer statements than the recorded baseline, pinned by an assertion.
- Every downstream shape is byte-identical.
- `test:unit`, `verify:pi1` and `eval:scenarios` all match their pre-change results.

**Test scenarios**
| # | Scenario | Expected |
|---|---|---|
| 3.1 | Full-catalog pool | the known baseline verdicts (87 PASS / 12 UNKNOWN / 2 REJECT) are unchanged |
| 3.2 | A role with no candidates | the merged query returns zero rows; the loader's existing error path still fires |
| 3.3 | Exact-shape fixtures | `deepStrictEqual` on the loader output, unmodified |
| 3.4 | Statement count | ≤ the planned budget, asserted |

---

## Sprint 4 — `catalog_version` and a canonical product key (design only, ~45 min)

**Summary.** Write the Decision that both the in-process cache and request dedupe stand on: what identifies the catalog state, and what identifies a product. **No code in this sprint** — Sprints 5 and 6 depend on it, and both are wrong without it.

**Why design-only.** The roadmap records steps 3–5 as blocked on "a canonical key and a `catalog_version` concept that does not exist"; verified 2026-10-15: `grep -rn catalog_version` finds it only in the plan and register, never in code.

**Files:**
- Create: the Decision entry in `docs/RECOMMENDATION_ENGINE_DECISIONS.md` (next free number), following `docs/decisions/TEMPLATE.md`
- Modify: `scripts/verify-docs.js` (the heading / `Status:` counts), `AGENTS.md` §2 (the decision range), `CONTEXT.md`
- Modify: `docs/GLOSSARY.md` (`catalog_version`, canonical key)

**Interfaces:**
- Produces: `catalogVersion(db)` — one pure-ish read (a single `SELECT`) returning a deterministic string that changes when the catalog changes, and a canonical product key definition usable as an identity (`product.slug` from migration 020 is the candidate; the Decision must justify it or reject it).

- [x] **Step 1: decide and record.** The Decision must answer: what `catalog_version` is computed FROM (a max `updated_at`, a content digest, a seeded counter), what invalidates it, whether it is persisted anywhere, and what the canonical key is.
- [x] **Step 2: update the entry's `Status:` line, the counts in `scripts/verify-docs.js`, the range in `AGENTS.md` §2, `CONTEXT.md`, and the glossary.**
- [x] **Step 3: run the gates.** `npm run gen:decisions` then `node scripts/gen-decision-index.js --check` (0), `npm run verify:docs --offline` (OK).
- [ ] **Step 4: commit.**

**Definition of done**

- The Decision exists with a normalized `Status:` line.
- `gen-decision-index --check` and `verify-docs --offline` are green.
- No code changed.

**Test scenarios**
| # | Scenario | Expected |
|---|---|---|
| 4.1 | Decision index freshness | `--check` exits 0 |
| 4.2 | `verify-docs --offline` counts | OK |
| 4.3 | A second reader can find the key definition from `docs/GLOSSARY.md` alone | the term is defined with its Decision id |

---

## Sprint 5 — Dedupe repeated POSTs (contract change, ~90 min)

**Summary.** Key a POST on `(budget, currency, use_case, resolution, priority, model id, catalog version, engine version)` and, when an identical request already has a result, return that recommendation id instead of running a second pass.

**Why.** Every POST today inserts a new `recommendation_profile` with a UUID name; dedupe removes that growth and makes share links stable. The web frontend snaps budget to 500 MAD steps, which makes hits common.

**Owner gate:** this changes the POST response contract — owner review before merge.

**Files:**
- Modify: `apps/api/src/repository.js` (`findReusableQuery(db, key)`; a read before `createRecommendationQuery`)
- Modify: `apps/api/src/routes/recommendations.js` (the hit path re-reads the existing rows through the SAME `readRecommendationResult`)
- Modify: `apps/api/src/contracts/recommendations.js`, `apps/api/test/unit/contract.test.js`, `apps/api/test/unit/openapi-v1.3.json` (new snapshot; delete v1.2 rather than keep two plausible contracts)
- Modify: `docs/API.md` (the contract, the new status/field, the doc line in `docs/TEST_MAP.md`)

**Interfaces:**
- Consumes: `readRecommendationResult(db, queryId)`, `createRecommendationQuery(client, input)`, `catalogVersion(db)` from Sprint 4.
- Produces: POST 201 with `reused: false` on a miss and 200 with `reused: true` plus the existing `id` on a hit; `ServedBySchema` unchanged.

- [x] **Step 1: write the failing tests** (DB-free, stubbed repository): a second identical POST returns the SAME id, `reused: true`, a 200, and does NOT insert a profile; a POST with a different budget returns a new id.
- [x] **Step 2: implement the lookup keyed on the persisted profile+query columns, excluding the profile's UUID name.**
- [x] **Step 3: prove it on the branch** (`npm run test:api:db`): two identical POSTs → one `recommendation_profile` row, one `recommendation_query` row, residue 0.
- [x] **Step 4: update the contract + docs + snapshot; `npm run test:api` 0 fail.**
- [ ] **Step 5: commit.**

**Definition of done**

- A repeated identical POST creates no new rows and returns the original id.
- The contract is a new minor (allocated at merge time, see the version note in `PLAN_PLATFORM_P2.md`), pinned by a committed snapshot.
- `test:api` and `test:api:db` green with residue 0.

**Test scenarios**
| # | Scenario | Expected |
|---|---|---|
| 5.1 | Two identical POSTs | same id, `reused: true`, profile row count unchanged |
| 5.2 | A POST differing only in budget | a new id |
| 5.3 | A POST after a seed/pricing change | `catalog_version` changed → a new id (NOT a stale hit) |
| 5.4 | A GET of a reused id | byte-identical to the POST reply, as today |
| 5.5 | A zero-build pass reused | still 200 with `reason`, per Decision 17.2 |

---

## Sprint 6 — Presets job and `GET /v1/presets` (~90 min)

**Summary.** Generate recommendations for budget 6k–40k (step 2k) × use case after each price update, persist them, and serve them from a new read-only endpoint. This is also the SEO landing-page source.

**Files:**
- Create: `database/migrations/021_*.sql` (the presets table: `recommendation_preset(query_id, budget_amount, currency, use_case, catalog_version, generated_at)`), `scripts/generate-presets.js`, `apps/api/src/routes/presets.js`
- Modify: `apps/api/src/app.js`, `apps/api/src/repository.js`, `docs/API.md`, `apps/api/test/unit/*`, `scripts/verify-docs.js` (nothing — no decision count moves unless a Decision is recorded)
- Modify: `AGENTS.md` §4's migration range (`001`–`021`) and `docs/SCHEMA_REFERENCE.md` / `docs/DATA_STATE.md` via `npm run gen:schema`

**Interfaces:**
- Consumes: the full-run orchestrator, `catalogVersion`.
- Produces: `GET /v1/presets?use_case=&currency=` → `{ catalog_version, generated_at, presets: [{ budget_amount, recommendation_id, build_score, price_status }] }`.

- [x] **Step 1: author the migration** (never edit a committed one), following `docs/RECIPES/add-a-migration.md`; `--dry-run` lists it; apply to the branch with `--test-db`.
- [x] **Step 2: write the failing route test** (DB-free): an empty table returns an empty list with the catalog version, not a 404.
- [x] **Step 3: implement the generator** (`--dry-run` first, then `--commit`), writing idempotently per `(budget, use_case, catalog_version)`.
- [x] **Step 4: branch-apply, generate, then verify the endpoint end-to-end** (`test:api:db`) — green 2026-10-16 after the repair pass (commit `36620ec`; the original commit landed with the route unregistered and the repository layer missing).
- [x] **Step 5: `npm run gen:schema`, `verify:docs --offline --live`, `verify:replay --test-db`, then commit** — including the audit line if the migration is applied to a non-branch target.

**Definition of done**

- The endpoint serves presets generated from the current catalog version.
- A regeneration for the same catalog version is idempotent.
- `verify:replay` 0 drift and the generated docs match.

**Test scenarios**
| # | Scenario | Expected |
|---|---|---|
| 6.1 | Empty table | 200, empty list, catalog version present |
| 6.2 | Generator run twice | no duplicate rows |
| 6.3 | Generator after a price change | new rows for the new `catalog_version`; old ones retained or pruned per the Decision, stated explicitly |
| 6.4 | `GET /v1/presets?use_case=OFFICE` with a model that has no OFFICE profile | 422 with the vocabulary error, not an empty list |

---

## Definition of done (whole plan)

1. A co-located deployment exists and is measured: the API and its database are in the same region, and the before/after numbers are recorded with commands, hosts and dates.
2. The commit issues ≤ 6 statements, pinned by a fake-client assertion, with persisted rows byte-identical to before.
3. The loaders issue fewer statements than the recorded baseline, with all downstream shapes unchanged.
4. `catalog_version` and the canonical key are DECIDED in the decision log before either dependent feature is built.
5. Dedupe returns the existing id for an identical request and creates no new rows; the contract is v1.3 with a committed snapshot.
6. Presets are generated idempotently and served by `GET /v1/presets`.
7. No regression: `test:unit`, `test:scripts`, `test:api`, `test:api:db` (residue 0), `verify:replay` 0 drift, `verify:pi1` PASS, `check-deferred-rules` 0 violations, `check-offer-freshness --fail-days=14` green, `eval:scenarios` exit 0 at the unchanged-engine baseline.
8. **Never a raised budget or threshold to make a step pass.** If a target is missed after Sprints 1–3, the target is re-derived with the owner — not the measurement.
