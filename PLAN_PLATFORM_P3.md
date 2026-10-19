# PLATFORM PLAN — P3: ops (CI truth, the production role, two environments, observability)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** close the gap between "the pipeline is wired" and "the pipeline has run" — a dispatched CI job that is green, a production database role proven under load, two named environments with a deploy that refuses to ship ahead of its schema, and error/uptime signal that would actually page someone.

**Architecture:** every sprint here produces EVIDENCE, not features. Three of the five are owner-gated (GitHub dispatch, cloud accounts, database DDL on shared); the agent's job in those is to prepare the exact command, then read and record the result. Nothing in this plan may weaken a gate to make it pass.

**Tech Stack:** GitHub Actions (`.github/workflows/ci.yml`, Node 22), PostgreSQL 18 on Neon, `scripts/run-migrations.js` (ledger-driven, restore-point-guarded), Fastify/pino JSON logs, Fly.io or Render, Sentry (`@sentry/node`) per the service catalog.

**Spec:** this file; the P3 section of the M3 roadmap; `docs/API.md` §Production mode (the role script, its self-check and its three-step TEST-branch rehearsal plan, designed 2026-10-07 and **applied to shared 2026-10-19**); `docs/DEVELOPMENT_NOTES.md` (CI/DB operational lessons); **OG-52** (the P3 carryover) and **OG-30** (offer freshness) in `docs/OPEN_GAPS.md`.

**Date:** 2026-10-15 · **Branch:** `agent/platforms` · **Decision id:** only Sprint 3 needs one (the environment/deploy contract).

**State this plan starts from (all measured 2026-10-15):** `recurring-gates` exists with `workflow_dispatch` and has **never been dispatched**; the `morocco_pc_api` role does not exist on shared (and therefore no column-scoped GRANT is applied); there is no staging or production environment, no deploy workflow, no error tracking, no uptime check, no log drain; `apps/api/Dockerfile` has never been built because no Docker is available on the authoring box; `/v1/health` answers **200 even when the database is down**, with `{ status, db, engine_version }`.

**Program rules:** the Global Constraints, the run-safely protocol and the self-review protocol this plan works inside live once, for P0–P3, in [PLAN_PLATFORM_CONSTRAINTS.md](PLAN_PLATFORM_CONSTRAINTS.md). This plan adds only what is specific to it, and its self-review verdict is recorded there.

## Review Focus

Five failure modes this plan's own tests do not fully cover, most likely first.

1. **A monitor that trusts HTTP 200.** `/v1/health` answered 200 while the database was unreachable — by design, so the endpoint can distinguish "app broken" from "database broken". A naive uptime check therefore reports a total database outage as healthy. Owning sprint: Sprint 4.
2. **A deploy that ships code ahead of its schema.** New API code against a database below the columns it reads is a 500 per request (an undefined column is an unexpected error, and 503 means only "no active scoring model"). Owning sprint: Sprint 3.
3. **A role with a row-wide UPDATE it was never meant to have.** Decision 46 grants `UPDATE` per column so the table-level answer stays `f`; a reset that grants `UPDATE ON recommendation_result` silently re-opens the invariant. Owning sprint: Sprint 2.
4. **A scratch database left behind by a crashed CI run.** `verify-migrations-replay.js` creates and drops one fixed name (`migrations_replay_tmp`); a killed run makes every later run fail with "database is being accessed by other users" — and the nightly is the only thing that would notice. Owning sprint: Sprint 1.
5. **A secret that is present but wrong**, which fails as a connection timeout far from the cause. Owning sprint: Sprint 1.

---

## Sprint 1 — prove the recurring CI job (owner-gated, ~45 min)

**Summary.** Dispatch `recurring-gates` and read the run. Record the outcome whether it passes or fails; if it fails, fix the cause (not the gate) and dispatch again.

**Why now.** This is the cheapest high-value item in P3: two of its three steps (migration replay, `test:api:db`) are the strongest end-to-end checks the project has, and neither has ever executed in CI.

**Owner gate:** a human with repository access must open the Actions tab and dispatch the workflow. `workflow_dispatch` accepts a **ref**, which matters — see Step 1.

**Files:**
- Modify: `.github/workflows/ci.yml` only if the run exposes a defect
- Modify: `docs/DEVELOPMENT_NOTES.md` (a dated entry with the run URL, the ref, the conclusion and any fix)
- Modify: `AGENTS.md` §10 / `CONTEXT.md` (the "UNVERIFIED in CI" claim, once and only once it is true)
- Modify: `docs/OPEN_GAPS.md` (OG-52's P3 item, when closed)

**Interfaces:** Consumes the two repository secrets (`DATABASE_URL`, `TEST_DATABASE_URL`) and the `concurrency` group `recurring-gates`. Produces: a recorded conclusion per step.

- [ ] **Step 1: choose the ref deliberately and record why.** Dispatch against `agent/platforms`, NOT the default branch. **Verified 2026-10-15:** `origin/master` (`c8c16b9`) already carries `apps/api`, the `test:api:db` step and the whole `recurring-gates` job, so the default branch is not missing them. The reason is different and sharper: master's migration tail ends at **018** while the replay's default reference (`DATABASE_URL`) is at **020**, and `verify-migrations-replay.js --test-db` diffs a fresh replay against that reference. A default-branch dispatch would therefore fail the replay step with drift that is an ARTIFACT of this branch being unmerged, not a defect — a false red is worse than no run, because it teaches the team to ignore the gate. **Corollary to record:** the nightly `schedule` only ever runs from the default branch, so until this branch merges the recurring gate is red BY CONSTRUCTION at the replay step; the merge is part of making the gate meaningful. Record the ref on the same line as the outcome.
- [x] **Step 2 (OWNER): dispatch `ci` → `recurring-gates` on that ref.** **DONE 2026-10-18,** twice, on `agent/platforms`: run 39119596060 (replay red, `test:api:db` skipped) and run 39120485573 (replay red on exactly the 021/022 objects — columns 377 vs 370, checks 84 vs 79, fks 61 vs 60, indexes 102 vs 100 — while `test:api:db` answered **9 passed / 0 failed** on the runner). Both reds are the branch-only ledger state Step 1 warned about; neither was fixed by changing the reference.
- [ ] **Step 3: read the run step by step and record the conclusion of each.** Expected shape and the failure each step would surface: `Assert secrets are present` (a named error instead of a timeout), `check-offer-freshness --fail-days=14` (a real expiry inside 14 days), `verify-migrations-replay --test-db` (drift between a fresh replay and the reference, or a leftover scratch DB), `test:api:db` (the real engine against the branch; residue must be 0).
- [ ] **Step 4: if it fails, fix the CAUSE, then re-dispatch.** The three named failure classes: a missing/misnamed secret; the Neon instance refusing a GitHub runner (dynamic IPs — the project's `allowed_ips` is empty, i.e. unrestricted, verified 2026-10-15, so this is unlikely but must be checked before assuming it); a leftover `migrations_replay_tmp`, cleared with a documented `pg_terminate_backend` + `DROP DATABASE IF EXISTS`.
- [ ] **Step 5: update the "UNVERIFIED in CI" claims** in `AGENTS.md`, `CONTEXT.md`, `docs/API.md` and Decision 36's limitations, in the same commit as the evidence. Until the run is green, those claims stay as they are.
- [ ] **Step 6: commit** (`docs/` + `.github/workflows/ci.yml` if changed).

**Definition of done**
- A dispatched run on a named ref is recorded with its conclusion, per step.
- If a step failed, the cause was fixed and a second run recorded — never a gate weakened.
- The "UNVERIFIED in CI" wording exists nowhere in current-status docs once green, and everywhere it still applies if not.

**Test scenarios**
| # | Scenario | Expected |
|---|---|---|
| 1.1 | Dispatch on the right ref | `recurring-gates` executes (not skipped by its `if:`) |
| 1.2 | Missing secret | the named `::error::` line, not a connection timeout |
| 1.3 | Scratch DB left from a crashed run | the documented clear, then a green replay |
| 1.4 | `test:api:db` | executes ≥1 test (zero executed is a failure by design) and asserts residue 0 |
| 1.5 | An unmarked `recommendation_query` row left on the branch | the harness fails loudly rather than silently |

---

## Sprint 2 — rehearse the production database role (TEST branch first, ~90 min)

**Summary.** Apply the role script from `docs/API.md` §Production mode on the TEST branch, prove the engine's whole write path runs as `morocco_pc_api` with no `42501`, run the self-check with every expected value asserted, and remove the role afterwards. Only then is the shared application a measured step instead of a hope.

**Why now.** It is the last residue of Platform P0 Sprint 5 (OG-52, P3): the script exists, the role does not. Every production question below (access, privilege, deploy) depends on it.

**Files:**
- Create: `scripts/rehearse-api-role.js` (creates the role + grants on the TEST branch, runs the probe as that role, asserts the self-check, then drops the role — cleanup in `finally`, residue asserted last, non-zero exit if cleanup fails)
- Create: `scripts/lib/api-role.js` (the ONE owner of the privilege contract: the 20-answer fixture, the GRANT block, the self-check SQL, the `REVOKE`-sweep teardown) + `scripts/lib/pass-rows.js` (the Layer 4 row bookkeeping every writer-side cleanup shares)
- Create: `scripts/apply-api-role.js` (the owner-gated shared apply: refuses without `--restore-point=<id>`, refuses an existing role, self-check 20/20, rolls the role back on red) + `scripts/smoke-api-role.js` (the API itself as the role: `--confirm-shared`, health on the body, one real POST, the six Layer 4 counts asserted back)
- Create: `docs/RECIPES/provision-the-api-role.md` (the owner runbook: restore point, apply, smoke, rollback, what to record)
- Modify: `docs/API.md` §Production mode (record that the rehearsal ran, with the date and the commands)
- Test: `scripts/lib/*.test.js` for the pure parts (the privilege expectation table), following the `scripts/lib/*.test.js` + `test:scripts` convention

**Interfaces:**
- Consumes: the `CREATE ROLE` / `GRANT` block and the `has_table_privilege` / `has_column_privilege` self-check in `docs/API.md`; `scripts/measure-api-pass-phases.js` (whose POST path is the probe); `getWriteTestDbUrl()` — a pg **config object**, not a URL string.
- Produces: `scripts/rehearse-api-role.js` and a recorded privilege table (expected vs actual, all 20 assertions).

- [x] **Step 1: write the pure expectation table as a fixture** — the 20 privilege answers from `docs/API.md` (table-level `f` for `product`/`store_offer`, `t` for the six INSERT targets, `f` for row-wide UPDATE on `recommendation_query`/`recommendation_result`, `t` for the three column-scoped UPDATEs). Unit-test that the table is well-formed and that a missing expectation is a failure, not a skip.
- [x] **Step 2: write the rehearsal script.** Order: create the role (idempotent: `DROP ROLE IF EXISTS` first is destructively wrong if the role pre-exists with grants — instead fail loudly if it exists, so the rehearsal never silently mutates a role someone else created); apply the grants; open a SECOND connection authenticated as the role; drive the full POST path (`selectActiveScoringModel` → `createRecommendationQuery` → `runFullRun` → `readRecommendationResult`); assert no `42501` and residue 0; run the self-check and compare every answer to the fixture; then `DROP ROLE` in `finally` and assert `pg_roles` no longer lists it.
- [x] **Step 3: run it on the branch** and record the output verbatim in `docs/API.md` §Production mode. Expected: the pass completes end-to-end as `morocco_pc_api`; every privilege matches; the role is gone afterwards.
- [x] **Step 4: prove the negative.** Deliberately attempt one forbidden action as the role (`UPDATE recommendation_result SET rank = rank` — a row-wide UPDATE) and assert it fails `42501`; then assert the column-scoped one succeeds. A privilege test that only shows the allowed paths does not distinguish a correctly-scoped role from an over-granted one.

**Steps 1–4 MEASURED GREEN 2026-10-17.** `node scripts/rehearse-api-role.js` on the TEST branch: the 20 privilege answers all matched (a missing answer is a FAILURE, never a skip), the whole POST path ran AS `morocco_pc_api` with zero `42501` in 61 statements (25 builds, model `launch-v2@1.0.0`, the API's own active-model selection), the row-wide UPDATE was denied `42501` while both column-scoped UPDATEs succeeded, residue returned to 0/0/0/0/0/0, and the role was removed — verified absent from `pg_roles` on BOTH the branch and the shared instance, whose Layer 4 tables stayed at 0. Both runs agreed on every hard assertion; teardown is a REVOKE sweep because a bare `DROP ROLE` fails `2BP01` (see `DEVELOPMENT_NOTES.md`, 2026-10-17). Record: `docs/API.md` § Production mode.
- [x] **Step 5 (OWNER): apply the role to the shared database.** **DONE 2026-10-19** from restore point `br-ancient-cake-axh57vpj` (HEAD `3f0c166`, audit target `db:54ff6ea3f6e6`): the 8-statement block applied, the self-check answered **20/20**, and `node scripts/smoke-api-role.js --confirm-shared` ran the API itself as `morocco_pc_api` — health `db:"ok"`, POST `201` with 1 build in 52 statements, no `42501`, all six Layer 4 counts back to 0. The prerequisite was met first: 021/022 landed on shared in the same session (ledger 20 -> 22, `verify:replay` 0 drift), so the smoke test ran on a current schema. Recorded in `DEVELOPMENT_NOTES.md` 2026-10-19 (3); the procedure is `docs/RECIPES/provision-the-api-role.md`.
- [ ] **Step 6: commit** the script + docs.

**Definition of done**
- The rehearsal runs end to end on the branch as `morocco_pc_api` with no `42501`, residue 0, and the role removed at the end.
- The self-check's 20 answers are asserted against a fixture, including the three `t` column-scoped UPDATEs and the two `f` row-wide ones.
- A forbidden action is proven to fail (Step 4).
- The shared application is either recorded as done with its restore point, or explicitly recorded as still pending with the reason.

**Test scenarios**
| # | Scenario | Expected |
|---|---|---|
| 2.1 | Full POST path as the role | completes; no `42501`; residue 0 |
| 2.2 | Column-scoped UPDATE | `t` for `budget_floor`, `engine_version`, `strategy_key` |
| 2.3 | Row-wide UPDATE | `f` at table level AND a real `42501` when attempted |
| 2.4 | Catalog writes | `f` for INSERT/UPDATE/DELETE on `product` and `store_offer` |
| 2.5 | Cleanup | the role is absent afterwards; a failed `DROP` fails the run |
| 2.6 | Re-running the script while the role exists | fails loudly, does not mutate an existing role |

---

## Sprint 3 — staging and production, with a deploy that respects the schema (owner-gated, ~120 min)

**Summary.** Stand up two named environments and a deploy workflow that refuses to ship code whose schema is not present: staging (the TEST branch) and production (the EU project from P1, or shared once the owner decides).

**Why now.** The M3 exit criterion is "deployed staging + prod"; and the failure this prevents is concrete — a new image against a database below 019/020 answers every request with a generic 500.

**Files:**
- Create: `.github/workflows/deploy.yml`, and one deploy config per environment
- Modify: `docs/API.md` (a `Deploy` section: the environments, their database targets, the env vars, the pre-flight, the rollback)
- Modify: `apps/api/.env.example` if a NEW variable is added — `TRUST_PROXY` from P2 Sprint 2 is already documented there (2026-10-17), and P3 S3 adds the environment names, not the proxy list
- Create: the Decision entry for the environment contract (names, targets, who may deploy, what the rollback is)

**Interfaces:**
- Consumes: `fly.toml` + the deployed origin from P1 Sprint 1; `npm run verify:replay`; `node scripts/run-migrations.js --check`.
- Produces: `deploy-staging` / `deploy-production` procedures; `ENGINE_VERSION` set to the deployed short SHA on each.

- [ ] **Step 1: write the pre-flight as the first step of the deploy job** — `node scripts/run-migrations.js --check` against the environment's database, exiting non-zero when anything is pending, so a deploy cannot ship ahead of its schema. Run it locally against both targets first and record both answers.
- [ ] **Step 2: define the environments** — both environments use ONE env shape and differ only in their `DATABASE_URL`: `API_ALLOW_SHARED=1` on BOTH, and `TEST_DATABASE_URL` on NEITHER.

  | Environment | `DATABASE_URL` | `API_ALLOW_SHARED` | `TEST_DATABASE_URL` |
  |---|---|---|---|
  | staging | the **TEST branch** pooled URL | `1` | unset |
  | production | the **EU project** pooled URL, connecting as `morocco_pc_api` | `1` | unset |

  Never the same database for both, and never shared for staging. The flag is a guard bypass, not a claim that the target is shared: `apps/api/src/db.js` `resolvePoolConfig` pools on `DATABASE_URL` when it is exactly `1` and never reads `TEST_DATABASE_URL`, while with any other value the pool is `TEST_DATABASE_URL` and `DATABASE_URL` is only a hostname baseline.

  **CORRECTED 2026-10-18 — this step used to say staging runs `API_ALLOW_SHARED=0`, which is not deployable.** With `0` the pool would come from `TEST_DATABASE_URL`, so staging would need a SECOND database purely to sit in `DATABASE_URL` as a baseline (the guard refuses equal hosts). That is "config B" in `docs/RECIPES/deploy-eu-colocation.md` §1, which the 2026-10-15 deploy runbook marks **do not deploy**: a script run on the host would read the wrong database. The P1 deploy would have had the same shape, and it would have answered every health check while writing to the old database.
- [ ] **Step 3: wire the deploy** (build → pre-flight → deploy → `GET /v1/health` assertion → record `ENGINE_VERSION`), keeping the provider token in GitHub secrets.
- [ ] **Step 4: document the rollback**: redeploy the previous image; for the database, the restore point recorded with each apply. A rollback procedure that has never been rehearsed is a paragraph, not a procedure — rehearse the image rollback once on staging and record it.
- [ ] **Step 5: record the Decision** (environments, targets, deploy authority, rollback, and the explicit rule that a migration apply against a production database is a separate owner-gated step with its own restore point).
- [ ] **Step 6: run the gates a decision entry triggers** (`npm run gen:decisions`, `gen-decision-index --check`, `verify:docs --offline`) and commit.

**Definition of done**
- Two environments exist and are named in `docs/API.md` with their database targets.
- The deploy refuses to run when the target database has pending migrations (proven by forcing it).
- A deploy records the `ENGINE_VERSION` that is then served by `/v1/health`.
- The rollback is documented AND rehearsed once on staging.

**Test scenarios**
| # | Scenario | Expected |
|---|---|---|
| 3.1 | Deploy with a pending migration on the target | the job FAILS at the pre-flight, before any image swap |
| 3.2 | Deploy with a current schema | proceeds; `/v1/health` responds with the new `ENGINE_VERSION` |
| 3.3 | Wrong database target (staging pointed at shared) | refused by the API's own write-target guard at startup |
| 3.4 | Image rollback | the previous image serves again; `ENGINE_VERSION` reverts |
| 3.5 | A deploy while the DB is unreachable | fails with a named error, no half-deployed state |

---

## Sprint 4 — observability that would actually page someone (~90 min)

**Summary.** Capture unhandled errors with a request id, and monitor health in a way that notices a database outage. The second half is the subtle one: `/v1/health` returns 200 even when `db` is `"down"`, so a monitor that only checks the status code would report a total database outage as healthy.

**Why now.** It is the cheapest insurance in the plan, and the health-endpoint design makes the naive implementation wrong in exactly the failure people care about.

**Owner gate:** adding a monitoring service is a new dependency and a new account — owner approval, and the DSN/token come from the secret store.

**Files:**
- Modify: `apps/api/src/app.js` (capture in the existing `setErrorHandler`, before the generic 500 reply), `apps/api/src/server.js` (initialise the client once, before `listen`), `package.json` + lockfile (the SDK), `apps/api/.env.example` (`SENTRY_DSN`, optional `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`)
- Test: `apps/api/test/unit/errors.test.js` (capture is invoked once per 5xx with the request id; a 4xx is NOT captured); `apps/api/test/unit/import-boundary.test.js` stays green
- Modify: `docs/API.md` (an Observability paragraph: what is captured, what is never captured, the health-body contract for monitors)
- Modify: `CONTEXT.md`, `AGENTS.md` §3 (the dependency), `.github/workflows/ci.yml` (only if `npm ci` needs nothing new — it does not)

**Interfaces:**
- Consumes: `buildApp({ pool, repository, engine, env, logger })`; the existing error handler's `String(request.id)`; `apps/api/src/db.js`'s `ping(pool, PING_TIMEOUT_MS)`.
- Produces: `SENTRY_DSN` (absent ⇒ the SDK is not initialised and nothing changes — the same feature-detection pattern `pino-pretty` already uses).

- [x] **Step 1: write the failing tests** — with a stubbed capture function injected through `buildApp`, an unexpected error calls it exactly once with the request id attached; a 422/429/413 does NOT call it; with no DSN the API boots and serves normally. **DONE 2026-10-19** — 13 tests: `apps/api/test/unit/monitoring.test.js` (6: the DSN gate, tracing off, PII off, `beforeSend` stripping the whole request object, and that importing the module does not load the SDK) and 7 in `errors.test.js` (one event per unexpected 500, carrying the SAME `request_id` the client is given; 422/413/429/404/mapped-503 uncaptured; a throwing sink cannot change the response). Seen RED first (`Cannot find module ../../src/monitoring` plus an uncalled stub), then green: `test:api` 111/0 on Node 22 and Node 24.
- [x] **Step 2: install and wire `@sentry/node`** — initialise in `server.js` (never in a module that a test imports), capture inside the existing error handler, and attach the request id as a tag so a user-reported 500 maps to an event. **DONE 2026-10-19**, with one deliberate deviation from the file list: the init lives in `apps/api/src/monitoring.js`, CALLED BY `server.js`, because the DSN gate, the init options and the capture wrapper are what the tests assert; `monitoring.js` requires `@sentry/node` LAZILY inside `createCapture`, so a test that imports it never loads the SDK (pinned through `require.cache`). `@sentry/node@^11.8.0` installed, `npm ci --dry-run` clean. `app.js` takes an injected `captureError` (default no-op) and calls it only on the generic 500; `server.js` passes the capture or null and logs `monitoring: disabled|sentry` at startup. `beforeSend` deletes the whole `request` object, `sendDefaultPii` is false and `tracesSampleRate` is 0. The real SDK path was probed once with a no-op transport: client initialised, options accepted, the `request_id` tag applied, nothing sent. Step 3 (an event actually delivered from a deployed host) is still open, so this is wired and unit-proven, not production-proven.
- [ ] **Step 3: prove it end-to-end on the deployed staging environment** — force one 500 through an admin-only path or a temporary route on staging, confirm the event arrives with the request id, then remove the trigger. A capture call that has never delivered an event is unproven.
- [ ] **Step 4: fix the monitor's contract.** Configure the uptime check to assert the BODY (`db == "ok"`), not the status code, and document that in `docs/API.md`. If the chosen monitor cannot parse a body, add a separate readiness endpoint that returns 503 when `db != "ok"` — and say which was chosen and why.
- [ ] **Step 5: decide on log retention explicitly.** JSON logs already go to stdout and the platform captures them; long-term retention needs a drain (a new service). Record the decision as "no drain yet, and here is what is lost" rather than leaving it ambiguous.
- [ ] **Step 6: commit** (including the dependency update and the docs).

**Definition of done**
- Unexpected 5xx errors produce one captured event carrying the request id; 4xx do not; an absent DSN changes nothing.
- The uptime check fails when `db` is not `"ok"` (proven by pointing it at an instance whose database is unreachable, or by a readiness endpoint asserted in a test).
- No configured sink can receive a request body, a query string or a credential.
- `test:api` 0 fail; `import-boundary.test.js` green; the dependency is recorded in `AGENTS.md` §3.

**Test scenarios**
| # | Scenario | Expected |
|---|---|---|
| 4.1 | Unexpected 500 | one capture, request id attached, detail logged |
| 4.2 | 422 / 429 / 413 | no capture |
| 4.3 | No DSN configured | normal boot and normal responses |
| 4.4 | Database down, `/v1/health` | 200 with `db: "down"` — and the MONITOR reports the outage |
| 4.5 | Body/URL in an error path | never captured (asserted on the payload passed to the stub) |

---

## Sprint 5 — make the offer-freshness gate see real offers (~60 min)

**Summary.** `check-offer-freshness.js` classifies offers by provenance CLASS, so a non-seed, non-`VERIFIED` offer can age out without the nightly gate noticing. Extract the classification into a pure helper, extend it to non-seed offers regardless of class, and pin the behaviour with unit tests.

**Why now.** This is the one P3 item that does not need real data to be *built*: the gate can be written and proven with fixtures today, so it is armed before the first real offer lands (P4 depends on a retailer; this does not).

**Files:**
- Create: `scripts/lib/offer-freshness.js` (pure: classify + decide, no DB) and `scripts/lib/offer-freshness.test.js` (runs in `test:scripts`)
- Modify: `scripts/check-offer-freshness.js` (use the helper; keep `--fail-days=N` equals-form only, since the space form exits 2 by design)
- Modify: `docs/OPEN_GAPS.md` (OG-52's P4 provenance-gate item), `DEVELOPMENT_NOTES.md`

**Interfaces:**
- Consumes: `store_offer` rows with `last_checked_at`, `fetched_at`, `offer_class`, `product_url`, `ingestion_record_id`.
- Produces: `classifyOffer(row)` → `'VERIFIED' | 'SEED' | 'UNVERIFIED' | 'NON_SEED_UNVERIFIED'` and `evaluateFreshness(rows, { failDays, asOf })` → `{ failing: [...], warnings: [...], firstExpiry }`; the script keeps its current PASS/FAIL wording and exit contract.

- [x] **Step 1: write the failing tests** — a non-seed offer with a stale `fetched_at` FAILS even when its class is not `VERIFIED`; the current 101 seed offers produce no failure (SEED/UNVERIFIED stay informational, as today); the boundary is inclusive at `failDays`; a NULL `fetched_at` on a non-seed offer is reported, not silently passed.
- [x] **Step 2: implement the helper and switch the script to it**, keeping the existing output and exit codes for today's data.
- [x] **Step 3: prove both directions on the shared database, read-only** — the current run must stay PASS (101 seed offers, first SEED expiry 2026-11-03), and a forced fixture (a fake non-seed row passed to the pure helper) must FAIL. A gate with no violations is indistinguishable from a gate that never runs.
- [x] **Step 4: run `npm run test:scripts` (0 fail) and `node scripts/check-offer-freshness.js --fail-days=14` (PASS on today's data), then commit.** No migration, no seed, no write.

**Definition of done**
- A non-seed offer of ANY class is evaluated by age and can fail the gate.
- Today's data still passes, and the informational seed line is unchanged.
- The pure helper is unit-tested in `test:scripts`; the script's CLI contract (`--fail-days=N`, equals form) is unchanged.
- The gap row is updated to say the gate now covers non-seed provenance, while P4's real-data work stays open.

**Test scenarios**
| # | Scenario | Expected |
|---|---|---|
| 5.1 | Stale non-seed UNVERIFIED offer | FAIL |
| 5.2 | Fresh non-seed offer | PASS |
| 5.3 | The 101 current seed offers | PASS, informational line unchanged |
| 5.4 | Boundary at exactly `fail-days` | inclusive |
| 5.5 | Non-seed offer with NULL `fetched_at` | reported as unknown, not passed |
| 5.6 | `--fail-days 14` (space form) | usage error, exit 2 (unchanged by design) |

---

## Definition of done (whole plan)

1. A dispatched `recurring-gates` run is recorded with its per-step conclusion, and the "UNVERIFIED in CI" wording is updated only where the evidence supports it.
2. The production role is rehearsed on the branch (full write path, no `42501`, all 20 privilege answers asserted, a forbidden action proven to fail, role removed) and its shared application is either done with a restore point or explicitly pending.
3. Staging and production exist, the deploy refuses a pending schema, and the rollback is rehearsed.
4. Error capture and a body-aware uptime check are live, and neither can leak a body, a query string or a credential.
5. The offer-freshness gate covers non-seed provenance regardless of class, with the boundary and the NULL case pinned.
6. No regression anywhere: `test:unit`, `test:scripts`, `test:api`, `test:api:db`, `verify:replay`, `verify:pi1`, `check-deferred-rules`, `check-offer-freshness --fail-days=14`, `eval:scenarios` at the unchanged-engine baseline, `verify:docs --offline` and `gen-decision-index --check`.
7. **No gate was weakened to reach any of the above.** If a dispatched run failed, the failure and the fix are both recorded.
