# PLATFORM PLAN — P2: the API surface (vocabulary, proxy truth, catalog, contract)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** finish the API surface the M3 exit criterion calls "contract v1.1 live" — a vocabulary that comes from the active model, per-IP limits that are true behind a proxy, catalog endpoints a frontend can build on, and a contract document that a test proves complete.

**Architecture:** everything here is an edge change. `apps/api/src/engine.js` is the ONLY module allowed to require `src/recommendation/**` (enforced by `import-boundary.test.js`), and no file under `src/` may be modified by this plan. New SQL lives in `apps/api/src/repository.js`, which is the API's single owner of statements; new routes are thin and get their collaborators by decoration.

**Tech Stack:** Fastify 4, `@fastify/rate-limit`, `@fastify/swagger`, `@sinclair/typebox`, `pg` raw SQL, Node 22 (the version both CI jobs pin).

**Spec:** this file; the P2 section of the M3 roadmap; `docs/API.md` (the contract, which this plan extends rather than replaces); Decision 36 in `docs/RECOMMENDATION_ENGINE_DECISIONS.md` (items 7, 9, 10, 11 and 13 are the constraints this plan works inside); **OG-38** (the vocabulary swap) and **OG-52** (the P2 carryover) in `docs/OPEN_GAPS.md`.

**Date:** 2026-10-15 · **Branch:** `agent/platforms` · **Decision id:** only Sprint 5 needs a decision entry (the catalog read contract); take the next free number from the log's tail at write time.

**Contract version note.** The live contract is **v1.2** (`apps/api/test/unit/openapi-v1.2.json`; the v1.1 snapshot was deleted, not kept). Sprint 3 and P1 Sprint 5 both want a new minor, so the version is allocated at merge time: whichever lands first takes v1.3, the next v1.4. Never commit two snapshots and never leave a superseded one in the tree.

## Global Constraints

- **No engine logic in `apps/api/`.** Only `engine.js` may require `src/recommendation/**`, and only through stage barrels. `import-boundary.test.js` enforces it and must stay green.
- **The API never recomputes a persisted fact.** A value absent from the database is `null`, never derived (Decision 36 item 4).
- **Price provenance is never inflated.** `price_status` is `"verified"` only when EVERY component's persisted `offer_class` is `VERIFIED`; anything else is `"indicative"`, and the French `disclaimer` restates it. Catalog responses carry the same rule.
- **The beta option stays pinned.** `engine.js` passes `{ allow_unverified_seed_offers: true }` always; it is not a request field and must not become one.
- **Unknown body fields are 422**, not dropped (`additionalProperties: false`, `removeAdditional: false`), and a numeric-string budget stays rejected (`coerceTypes: false`).
- **No new runtime dependency without an explicit owner decision.** Adding one means updating `package.json`, the lockfile, `AGENTS.md` §3, and CI's `npm ci`.
- **DB-free tests stay DB-free.** `test:api` uses `fastify.inject` + stubs and runs in the push/PR job; anything needing the real engine goes to `test:api:db` (TEST branch, residue 0, fails fast when `TEST_DATABASE_URL` is missing or targets shared).
- **Docs are CRLF**, `docs/API.md` included. Contract changes update `docs/API.md`, `docs/TEST_MAP.md` and the committed snapshot in one commit.
- **The committed snapshot is the contract.** `openapi-snapshot.test.js` compares the served document to the committed file; a route added without a snapshot update fails the suite.

## Review Focus

Five failure modes this plan's own tests do not fully cover, most likely first.

1. **A trusted `X-Forwarded-For` that is spoofable.** Turning `trustProxy` on without pinning the hop count lets any caller set their own IP and bypass every per-IP limit. Owning sprint: Sprint 2.
2. **An OFFICE request that 422s only because no model declares it.** The vocabulary swap is observable ONLY with a profiles-declaring model active, and today neither database has one. Owning sprint: Sprint 1.
3. **A catalog page that shows a seed price as if it were real.** The beta waiver keeps unverified seed offers in play; exposing prices on a public page without the class and the disclaimer makes indicative data look confirmed. Owning sprint: Sprint 3.
4. **A cursor that skips or repeats rows.** Any keyset pagination over a table whose order is not unique (product names are not unique — there is no unique constraint on `product.name`) can drop or duplicate a product page. Owning sprint: Sprint 3.
5. **A 429 with no `Retry-After`**, which clients and proxies treat as a permanent failure rather than a wait. Owning sprint: Sprint 4.

---

## Sprint 1 — the use-case vocabulary comes from the model (OG-38) (~60 min)

**Summary.** `apps/api/src/meta.js` derives the accepted `use_case` vocabulary from `configuration.gpu_required_use_cases` — the same list that makes the GPU mandatory — so OFFICE is rejected 422 even when a model declares it with `gpu_policy: IGPU_ALLOWED`. Swap the source to the scoring barrel's `listUseCases(configuration)`.

**Why now.** Decision 37 built `listUseCases` for exactly this and the API never used it; per `docs/RECOMMENDATION_ENGINE_DECISIONS.md`, the decoupling is only observable once seed 013 is active.

**Files:**
- Modify: `apps/api/src/meta.js` (the vocabulary source only)
- Modify: `apps/api/src/engine.js` if the active model's `configuration` is not already available to `meta.js` (it must be — the API resolves the active model, Decision 36 item 9)
- Test: `apps/api/test/unit/meta.test.js` (create if absent) and `apps/api/test/unit/contract.test.js`
- Modify: `docs/API.md` (the option vocabulary section), `docs/briefs/requests.md` (this request is closed by it)

**Interfaces:**
- Consumes: `listUseCases(configuration)` from `src/recommendation/scoring`'s barrel — returns a frozen `string[]`: the `use_case_profiles` keys when present, otherwise `gpu_required_use_cases` (the legacy fallback), and throws `INVALID_INPUT` / field `configuration` when neither exists.
- Produces: the same `{ value, label }` pairs `GET /v1/meta/options` serves today, with French labels; the POST validator accepts exactly the values it advertises, because both come from one list.

- [ ] **Step 1: write the failing tests.** With a stubbed active model carrying `use_case_profiles` for `{GAMING, OFFICE, WORKSTATION}` and `gpu_required_use_cases: ['GAMING','WORKSTATION']`, assert `GET /v1/meta/options` advertises all three and that `POST /v1/recommendations` with `use_case: "OFFICE"` is **not** a 422 at the vocabulary gate. With the legacy model (`seed-minimal-v1`), assert the vocabulary is exactly `{GAMING, WORKSTATION}` — byte-identical to today. Run: `npm run test:api`. Expected: FAIL on the OFFICE case.
- [ ] **Step 2: implement the swap** — one source for the list, and the validator reading the same array so the two cannot drift.
- [ ] **Step 3: prove the fallback is inert.** `npm run test:api` 0 fail, and `npm run test:api:db` 1/0 against the branch, where `seed-minimal-v1` is the only active model: the served vocabulary must be unchanged.
- [ ] **Step 4: apply seed 013 to the branch to make OFFICE observable** (`database/seeds/013_scoring_model_launch_v2.sql`, branch-first through an explicit target — `run-seeds.js` ignores `--test-db` and routes nothing). Re-run `test:api:db`; the DB suite must now advertise OFFICE. Then the onboarding caveat: **`launch-v2` is ACTIVE on neither database as of 2026-10-15** (measured), so without this step the swap changes nothing observable anywhere.
- [ ] **Step 5: update `docs/API.md`'s vocabulary section and `docs/briefs/requests.md`, then commit.**

**Definition of done**
- The advertised vocabulary and the POST validator both come from `listUseCases(activeModel.configuration)`; no `gpu_required_use_cases` read remains in `meta.js`.
- With `launch-v2` active, OFFICE is advertised and accepted at the gate; with `seed-minimal-v1` active, the response is unchanged.
- `test:api` 0 fail; `test:api:db` 1/0 with residue 0; `docs/API.md` matches the behaviour.

**Test scenarios**
| # | Scenario | Expected |
|---|---|---|
| 1.1 | Profiles-declaring model (stub) | `{GAMING, OFFICE, WORKSTATION}` advertised, OFFICE accepted |
| 1.2 | Legacy model (stub + branch) | `{GAMING, WORKSTATION}`, byte-identical to pre-change |
| 1.3 | A model with neither key | `INVALID_INPUT` / `configuration` surfaces as a 503-class failure, not a silent empty list |
| 1.4 | A value not in the advertised list | still 422 with per-field `details` |
| 1.5 | `GET /v1/meta/options` under `launch-v2` on the branch | OFFICE present with its French label |

---

## Sprint 2 — truthful per-IP limits behind a proxy (`trustProxy`) (~60 min)

**Summary.** Configure Fastify's `trustProxy` from the environment and pin the hop count, so the rate limiter sees the real client IP instead of collapsing every user behind the platform's proxy into one bucket.

**Why now.** Verified 2026-10-15: `trustProxy` appears **nowhere** in `apps/`, `src/` or `docs/API.md` — only in the plan and the gap register as an open item. On Fly.io or Render the app always sits behind a proxy, so today 30 POST/min is 30/min for the entire internet.

**Files:**
- Modify: `apps/api/src/app.js` (`buildApp` gains `trustProxy`; passed to the Fastify factory)
- Modify: `apps/api/src/server.js` (read `TRUST_PROXY` from env — it is the only file that reads `process.env` for connection settings)
- Modify: `apps/api/.env.example` (document `TRUST_PROXY`, default off)
- Test: `apps/api/test/unit/rate-limit.test.js`, `apps/api/test/unit/app.test.js`
- Modify: `docs/API.md` (the Operational limits paragraph)

**Interfaces:**
- Consumes: `buildApp({ pool, repository, engine, env, logger })` — gains an optional `trustProxy` (a number of hops, or `false`).
- Produces: `TRUST_PROXY=<number|false>`; `request.ip` is the client IP when set correctly.

- [ ] **Step 1: write the failing tests.** With `trustProxy: 1`, two `inject` calls carrying different `X-Forwarded-For` values must occupy separate rate-limit buckets (one gets a 429 while the other does not). With `trustProxy: false` (the default), the same two headers must be ignored and the two calls must share one bucket. Run: `npm run test:api`. Expected: FAIL.
- [ ] **Step 2: implement** — pass the hop count through, defaulting to `false` so nothing changes for a directly reachable process.
- [ ] **Step 3: pin the hop count for the chosen host.** One proxy hop on both Fly.io and Render; record the value in `docs/API.md` and in the deployment notes so the next person does not have to rediscover it.
- [ ] **Step 4: re-run the exact per-IP behaviour on the deployed host** once P1's deployment exists: two requests from the same client keep one bucket; a spoofed header does not create a new one. Record both results.
- [ ] **Step 5: commit.**

**Definition of done**
- `trustProxy` is configurable, defaults to `false`, and the default is proven to ignore `X-Forwarded-For`.
- With a hop count set, distinct forwarded addresses get distinct buckets and a spoofed header cannot mint one.
- `docs/API.md` states the limit, the unit (per IP), the in-process caveat (limits do not survive a multi-instance deploy) and the configured hop count.

**Test scenarios**
| # | Scenario | Expected |
|---|---|---|
| 2.1 | `trustProxy: false`, two different `X-Forwarded-For` | shared bucket → the 31st request is 429 |
| 2.2 | `trustProxy: 1`, two different `X-Forwarded-For` | separate buckets → neither 429s early |
| 2.3 | `trustProxy: 1`, a chain of two hops | the client IP is taken from the correct position, not the nearest hop |
| 2.4 | GET limit (120/min) vs POST limit (30/min) | unchanged: the two do not share a budget |
| 2.5 | Deployed origin, two clients | separate buckets (recorded evidence, not asserted in CI) |

---

## Sprint 3 — catalog endpoints (read-only) (~120 min)

**Summary.** Add the two read endpoints a storefront needs: a paginated product list and a product detail by `slug` — the column migration 020 added and backfilled for exactly this.

**Why now.** `slug` and `display_name` landed in 020 and are on BOTH databases; nothing serves them except as component names inside a recommendation.

**Files:**
- Create: `apps/api/src/routes/catalog.js`, `apps/api/src/contracts/catalog.js`
- Modify: `apps/api/src/repository.js` (the two read statements), `apps/api/src/app.js` (register), `apps/api/src/contracts/index.js`
- Create: `apps/api/test/unit/catalog.test.js`; modify `apps/api/test/db/recommendations.db.test.js` (a real read against the branch)
- Create: `apps/api/test/unit/openapi-v1.3.json` (or v1.4; see the version note) — delete the superseded snapshot in the same commit
- Modify: `docs/API.md`, `docs/TEST_MAP.md`, `CONTEXT.md`

**Interfaces:**
- Produces: `GET /v1/catalog/products?use_case=&role=&limit=&cursor=` → `{ products: [{ slug, display_name, category, from_price, offer_class, has_offer }], next_cursor }`; `GET /v1/catalog/products/:slug` → `{ slug, display_name, category, specs: {...}, offers: [{ price, offer_class, currency }], price_status, disclaimer }`. Both read-only, rate-limited like the other GETs (120/min).
- Consumes: `product.slug` / `display_name` (migration 020), the spec tables, `store_offer.price` / `offer_class`.

- [ ] **Step 1: write the failing route tests** (DB-free, stubbed repository): a list returns the advertised shape; an unknown slug is a 404 with the standard envelope; `limit=0` and `limit=1000` are 422s; a product with no offer reports `has_offer: false` and a null `from_price` rather than being filtered out silently.
- [ ] **Step 2: implement the reads in `repository.js`** — keyset pagination on `(slug)` (unique since 020's `uq_product_slug`), never `OFFSET`; `from_price` is the lowest offer price for the product, and **`offer_class` travels with it**.
- [ ] **Step 3: implement the routes** with TypeBox schemas for both responses.
- [ ] **Step 4: apply the pricing rule in the response** — `price_status` derived exactly as the recommendation response derives it (`"verified"` only when every contributing offer is `VERIFIED`), with the French `disclaimer`; the seed data will therefore report `indicative`, which is correct and must not be special-cased.
- [ ] **Step 5: pin the contract** — regenerate the snapshot, run `npm run test:api` (0 fail) and `npm run test:api:db` (a real read of a real slug on the branch, residue 0).
- [ ] **Step 6: update `docs/API.md` + `docs/TEST_MAP.md` + `CONTEXT.md`, then commit.**
- [ ] **Step 7 (owner): decide whether catalog pages may be public before any frontend is pointed at them** — this is the same beta-waiver question the recommendation endpoint answered, and it is not the implementer's call.

**Definition of done**
- Both endpoints are served, documented, and pinned by the committed snapshot.
- Pagination is keyset-based on a unique column; a page boundary revisited returns the same rows.
- No response advertises a seed price as verified; the disclaimer is present.
- `test:api` 0 fail; `test:api:db` 1/0 with residue 0.

**Test scenarios**
| # | Scenario | Expected |
|---|---|---|
| 3.1 | List, default limit | ≤ the advertised default, `next_cursor` present when more rows exist |
| 3.2 | Walk every page | the union equals the full set, with no duplicate and no missing slug |
| 3.3 | Detail for a real branch slug | specs + offers; `price_status: indicative`; disclaimer present |
| 3.4 | Unknown slug | 404, standard envelope, no SQL detail |
| 3.5 | A product with zero offers | present in the list with `has_offer: false` |
| 3.6 | `limit=1000` | 422 (bounded), not a slow query |

---

## Sprint 4 — CORS allow-list and the 429 contract, proven (~45 min)

**Summary.** CORS is already implemented (`ALLOWED_ORIGINS` → `parseOrigins`, and an empty value disables CORS entirely rather than reflecting any origin) and 429 is documented. What is missing is proof: a preflight test, and the `Retry-After` question answered rather than assumed.

**Files:**
- Test: `apps/api/test/unit/cors.test.js`, `apps/api/test/unit/rate-limit.test.js`
- Modify: `docs/API.md` (the CORS + 429 paragraphs), `apps/api/.env.example` (an example origin in the comment)

**Interfaces:** Consumes `parseOrigins(raw)` (already exported) and the per-route `config.rateLimit` objects. Produces: documented, tested behaviour; no new env var.

- [ ] **Step 1: write the failing tests.** (a) With `ALLOWED_ORIGINS=https://example.ma`, a request with `Origin: https://example.ma` gets `Access-Control-Allow-Origin: https://example.ma` and a successful preflight; the same request with another origin gets **no** ACAO header. (b) With `ALLOWED_ORIGINS` empty, no ACAO header is sent for any origin. (c) Exceed the POST limit and assert the 429 body's shape **and whether a `Retry-After` header is present**.
- [ ] **Step 2: implement whatever (c) shows is missing** — if the plugin does not send `Retry-After`, either configure it or document its absence explicitly in `docs/API.md`. Do not assert a header the server does not send.
- [ ] **Step 3: document** the allow-list semantics (empty = disabled, not reflected), the limits, and the header/absence found in Step 2.
- [ ] **Step 4: commit.**

**Definition of done**

- The four CORS behaviours are pinned by tests.
- The 429 contract (body + any `Retry-After`) is stated in `docs/API.md` and matches the server.

**Test scenarios**
| # | Scenario | Expected |
|---|---|---|
| 4.1 | Allowed origin | ACAO echoes the exact origin; preflight 204/200 |
| 4.2 | Disallowed origin | no ACAO header; the request itself is still served |
| 4.3 | Empty allow-list | no ACAO header for any origin |
| 4.4 | Over the POST limit | 429 with the standard envelope and `request_id` |
| 4.5 | `Retry-After` | present-and-asserted, or absent-and-documented — never assumed |

---

## Sprint 5 — the contract-completeness gate (~60 min)

**Summary.** Make the OpenAPI document a *checked* artifact rather than a snapshot: every served route must appear in the document, and every response must declare a schema, so an undocumented route or an untyped error cannot ship.

**Files:**
- Test: `apps/api/test/unit/openapi-coverage.test.js`
- Modify: `docs/API.md` (a line stating the document is a gate, not a description), `docs/TEST_MAP.md`
- Optional (owner decision): the Decision entry for the catalog read contract if Sprint 3 does not record one

**Interfaces:** Consumes `app.swagger()` (the document) and Fastify's route table. Produces: a test that fails when a route exists without a documented path or without a response schema.

- [ ] **Step 1: write the failing test.** Enumerate every registered route (method + path, excluding GET `/v1/docs/json` itself by an explicit allow-list), and for each assert a matching `paths` entry with at least one response schema. Add a synthetic route in the test to prove the gate fires.
- [ ] **Step 2: fill whatever the gate exposes** — most likely missing error-response schemas for 422/429/500.
- [ ] **Step 3: run the suite** (`npm run test:api` 0 fail), regenerate the snapshot if a schema was added, and commit.

**Definition of done**

- The coverage test fails when a route is added without documentation (proven by the synthetic route).
- Every served route is documented with at least one response schema.
- The snapshot matches.

**Test scenarios**
| # | Scenario | Expected |
|---|---|---|
| 5.1 | Served routes vs document | one-to-one, no orphans |
| 5.2 | A route registered without a schema | the gate FAILS |
| 5.3 | Error responses | 422/429/500 declared, or their absence is explicitly justified |
| 5.4 | `/v1/docs/json` | still served and still excluded from its own coverage requirement |

---

## Definition of done (whole plan)

1. The use-case vocabulary comes from the active model; OFFICE is reachable with a profiles-declaring model and the legacy behaviour is byte-identical.
2. `trustProxy` is configurable, defaults off, and the hop count is pinned for the deployed host with evidence.
3. `GET /v1/catalog/products` and `/v1/catalog/products/:slug` serve documented, keyset-paginated, provenance-labelled data.
4. CORS and 429 behaviour are pinned by tests and stated in `docs/API.md`; no header is claimed that the server does not send.
5. The contract is one version with one committed snapshot, and a test proves every served route is documented.
6. No regression: `test:api` 0 fail, `test:api:db` 1/0 with residue 0, `test:unit` 0 fail, `verify:docs --offline` OK, `gen-decision-index --check` clean, and `import-boundary.test.js` green.

## How to run this safely

- Read `apps/api/src/app.js`'s header before touching it: the route plugin ordering (routes registered INSIDE a plugin, after the `onRoute` hooks) is load-bearing for both swagger and rate limiting.
- `test:api` must stay DB-free; anything needing rows goes to `test:api:db`, which fails fast on a missing or shared `TEST_DATABASE_URL` and fails on zero executed tests.
- Sprint 1 Step 4 applies a seed. Branch-first with an explicit target; seeds are idempotent but `run-seeds.js` has **no** `--test-db` routing.
- Never serve a price without its `offer_class`. The beta waiver is a documented exemption, not a licence to present indicative data as verified.
- Every contract change updates `docs/API.md`, `docs/TEST_MAP.md` and the committed snapshot in ONE commit — a route without a snapshot is a red suite.

## Self-review (run against this plan)

- **Spec coverage:** the roadmap's P2 list maps to Sprints 1 (vocabulary/final snapshot test), 2 (trustProxy), 3 (catalog endpoints), 4 (CORS + 429), 5 (remainder of the OpenAPI surface). The two items already done (v1.1 contract, snapshot + tests) are recorded as done in the header rather than re-planned. ✔
- **Step scan:** each step names a file, a command and an expected result; no step says "as needed" or transcribes a body. ✔
- **Type consistency:** `listUseCases(configuration)`, `buildApp({ pool, repository, engine, env, logger })`, `parseOrigins(raw)`, `readRecommendationResult(db, queryId)` and the `slug` field are spelled once each. ✔
- **Review Focus:** all five lines have an owning sprint and a numbered scenario (2.2, 1.5, 3.3/3.5, 3.2, 4.5). ✔
- **Proportion:** no implementation bodies; every step is a decision the implementer could not make alone. ✔
