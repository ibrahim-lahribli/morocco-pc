# CONTEXT — current state

`morocco-pc` recommends complete PC builds for the Moroccan market. Given a budget, a use case, an
optional resolution and a priority, the engine selects compatible components, assembles, scores,
ranks and explains whole builds, and persists the pass. This file is the current state ONLY: what
exists, where it runs, and the numbers as of **2026-11-02**. It carries no history — that lives in
`docs/RECOMMENDATION_ENGINE_DECISIONS.md` (why) and in git (when).

Open work is [`docs/OPEN_POINTS.md`](docs/OPEN_POINTS.md). Programmes and sprints are
[`docs/ROADMAP.md`](docs/ROADMAP.md).

## 1. The four layers (PostgreSQL, 44 tables, 23 migrations)

| Layer | Tables | State |
|---|---|---|
| 1 — Catalog / Hardware | `product`, `product_family`, `product_variant`, `<role>_spec`, explicit compatibility tables | 113 products, 24 variants, 84 families |
| 2 — Performance / Assessment | `benchmark_source`, `benchmark`, `benchmark_result`, `component_assessment`, `scoring_model` | 319 assessment rows over 112 of 113 products |
| 3 — Market | `store`, `store_offer`, `price_history` | 114 offers, 2 stores, 0 with retailer provenance |
| 4 — Recommendation | `recommendation_profile`, `recommendation_query`, `recommendation_result`, `build_candidate`, `build_component`, `build_rejection`, `recommendation_swap` | 12 queries / 16 results / 16 candidates on shared — API passes from the live demo, which writes to shared (not user data; expected until the demo moves, R-14) |

`database/migrations/001`–`023` are THE schema; `docs/SCHEMA_REFERENCE.md` is its generated mirror.
Every database stands at ledger **23** (`node scripts/run-migrations.js --check` → no pending file).

## 2. The engine (pure JS, `src/recommendation/`)

No DB access, no clock, no randomness inside a stage; loaders and the orchestrator are the only
impure edges. One pass, in order:

| Step | Module | What it does |
|---|---|---|
| 1 | `query/` | `loadQueryInput`: one SELECT, budget as an exact decimal string |
| 2 | `offers/` | Stage 1 price pre-selection (30-day freshness window, Decision 7) |
| 3 | `candidates/` | pool selection (Engine 2B/2C) |
| 4 | `filtering/` | HARD/UNKNOWN/REJECT per candidate + the compatibility context (Engine 2D) |
| 5 | `scoring/` | candidate scores (Engine 4 STEP 2) |
| 6 | `retention/` | top-K per role, price bands (`roleTargets`), cheapest-per-role reservation (Decision 27) |
| 7 | `assembly/` | DFS over `EXPANSION_ORDER`, pairwise re-checks, per-pair quota, VRAM floor, build cap (Engine 3) |
| 8 | `scoring/` | `build_score` = weighted effective scores − `unknown_compat_penalty` × UNKNOWN pairs |
| 9 | `ranking/` | `rankBuilds` (score DESC → price ASC → code-unit signature), then `selectArchetypes` (≤3 pair-distinct) |
| 10 | `explanation/` | Engine 6 text + `deriveReasons` codes from one shared fact set |
| 11 | `orchestrator/commit.js` | ONE write transaction: results, builds, components, rejections, pass facts, swap links |

`orchestrator/run.js` wires steps 1–10 inside a caller-owned `REPEATABLE READ READ ONLY` snapshot;
`orchestrator/full-run.js` composes snapshot → rank → diversity → explanation → commit.
The status vocabulary `PASS | FAIL | UNKNOWN | CONDITIONAL` is load-bearing: NULL means UNKNOWN and
UNKNOWN is never treated as PASS or FAIL. Determinism is enforced: ties break on `product_id` ASC
(then `product_variant_id` NULL-first), never on a UUID draw or `localeCompare`.

## 3. Environments

| Name | What it is | Serves | Use it for |
|---|---|---|---|
| `DATABASE_URL` (shared) | the only dev database | `launch-v2@2.4.0` (newest ACTIVE row) | read-only inspection, the demo origin |
| `TEST_DATABASE_URL` | a Neon branch, full snapshot | `launch-v2` 1.0.0–2.4.0 ACTIVE | every write-capable test and harness |
| `TARGET_DATABASE_URL` (EU) | `morocco-pc-eu`, `aws-eu-central-1` — 113 products, 84 families, 24 variants, 114 offers, 319 assessments, 7 `scoring_model` rows (6 ACTIVE) | `launch-v2@2.4.0`, pinned by `SCORING_MODEL_PIN` in `render.yaml` (Decision 63, PROVISIONAL) and measured ACTIVE on the branch | the release target; served by the live beta host `morocco-pc-api-eu` (free plan, sleeps when idle) |

The shared database is never reset, dropped or truncated. Write-capable scripts route through
`scripts/lib/db-url.js`; the API refuses to start against anything but the TEST branch unless
`API_ALLOW_SHARED=1`. Real-database writes need a recorded restore point and leave an audit line in
`database/migration-applies.jsonl`.

**Deployed origins:** two. `https://morocco-pc.onrender.com` (Render Free, fronting the shared
database, answering `engine_version: "dev"`, spins down after 15 idle minutes) is the demo origin, not
a launch host. `https://morocco-pc-api-eu.onrender.com` (Render Free, Frankfurt, created from
`render.yaml` on 2026-11-02, fronting the EU database as `morocco_pc_api`, answering
`engine_version: "d2de4fb"`) is the private-beta host: it serves the pinned release model and both
gates measured it — `check-origin-readiness` PREFLIGHT OK, `check-deployed-role` PASS. It also sleeps
after 15 idle minutes (its log hostname carries `hibernate`), which is what R-08 still tracks.

## 4. Scoring models and what is served

`scoring_model` holds 7 rows: `seed-minimal-v1@1.0.0` (INACTIVE) and six ACTIVE `launch-v2` versions
1.0.0 … 2.4.0 (2.0.0 resolution floors, 2.1.0 archetype objectives, 2.2.0 pair quota 2, 2.3.0 uniform
CPU depth 10, 2.4.0 CPU-only depth 10). `apps/api/src/repository.js` selects the newest ACTIVE row, so
**shared and the demo origin serve `launch-v2@2.4.0`** and neither sets a pin — that is insertion order,
so a seed apply could move it. The EU service is the exception, and it is MEASURED rather than declared:
`render.yaml` sets `SCORING_MODEL_PIN: launch-v2@2.4.0` (Decision 63), the deployed process boots with
`scoring_model: "launch-v2@2.4.0"` instead of the newest-ACTIVE fallback, and **52** committed passes record
`recommendation_query.scoring_model_id` = 2.4.0 (measured 2026-11-06). R-06 is closed on that evidence.
`launch-v2@2.4.0` is the version the gate measures green (82 PASS / 3 EXPECTED-RED / 1 UNKNOWN); it is
adopted for the private beta as an explicit PROVISIONAL OVERRIDE of Decision 57 item 3, NOT as a
satisfaction of it — A1/A3/A4 are still `hypothesis` and OG-43 is open.

## 5. Measured numbers (2026-11-02; the offer-freshness date, the EU pass count and the R-14 parity
DIFFs re-measured 2026-11-06)

- `npm run test:unit` **1261 pass / 0 fail / 0 cancelled** (Node 24.21.0 and Node 22);
  `npm run test:scripts` **443 / 0**; `npm run test:api` **193 / 0**; `npm run test:api:db` **17 / 0**
  (nightly only — it writes to the TEST branch).
- Doc gates: `gen-decision-index --check` **0**, `verify-docs --offline` **0**,
  `gen-schema-reference --check` **0**.
- `check-catalog-identity.js` **PASS on all three**: shared 113 of 113, TEST 113 of 113 and EU 113 of
  113 after the 2026-11-02 upgrade (EU was 100 of 100 before it). Restore points:
  `shared-backup-pre-028-20261102-1300`, `eu-backup-pre-028-20261102-1312`, and for the whole EU
  upgrade `eu-backup-pre-upgrade-20261102-1427` (`br-divine-king-b97uxsr5`).
- EU after seeds 023–028: **113 products, 84 families, 24 variants, 114 offers, 319 assessments, 22
  cooler socket rows, 7 `scoring_model` rows (6 ACTIVE), identity gaps 0**, ledger at 23. Parity with
  shared is MATCH on ledger-files, `tables` 44, `schema-shape` 470 (digest `4110c1517a14a0ef` on both
  sides), model pins, product, variant, offer, assessment, model, benchmark and store counts;
  the only differences are the six Layer-4 row DIFFs R-14 tracks, shared vs EU: query 12 vs 52,
  result 16 vs 142, candidate 16 vs 142, component 126 vs 1093, rejection 24 vs 104, preset 0 vs 52
  (the EU side is the deliberate preset shelf, the shared side the demo residue).
- `check-offer-provenance.js` **INCONCLUSIVE** everywhere: 114 seed offers, 0 verified, 2 stores on
  the reserved `example.ma` domain. `check-offer-freshness.js` reports the first SEED expiry at
  **2026-12-01** (24.3 days from 2026-11-06).
- Real passes through `orchestrator.runRecommendation`, `launch-v2@2.4.0`: GAMING 21 500 @1440p →
  25 builds over 13 distinct (CPU, GPU) pairs, rank-1 score 60.83 at 19 976; OFFICE at 12 000, 20 000
  and 30 000 all return the identical 9 076 build (score 59.60) — `build_score` carries no budget term.
- `node scripts/check-deployed-role.js` — **split 2026-11-02:** the EU host answers **PASS** (every
  `morocco-pc-api` tagged session authenticated as `morocco_pc_api`), the demo origin still **FAIL**
  (`neondb_owner`). R-05 is narrowed to that one origin.
- One full pass on the EU origin: **201 in 3209 ms**, 3 builds, `catalog_version
  e9997010de60e49634396970f6b23557`; swap-preview 200 (compatibility PASS, 999 → 1499, total 20 195,
  `within_budget: false`); everything deleted back to **0/0/0/0/0/0**. The 3209 ms is on `plan: free`
  (0.1 CPU), which `render.yaml` says is not the plan to measure V1 on.

## 6. The HTTP surface (`apps/api/`)

Thin Fastify layer, contract **v1.10.0**, ten `/v1` paths, no engine logic — `engine.js` is the only
module allowed to require `src/recommendation/**`, and a test enforces it. It serves health, meta,
presets, the read-only catalog (keyset paginated, provenance-labelled prices), the recommendation
POST/GET pair, the swap preview and the append-only swap commit. POST and GET share one read path, so
they cannot disagree about a persisted field. Rate limits are per-IP and `TRUST_PROXY` names the
trusted proxy (default off). Writes are deduped by a catalog-aware key. See `docs/API.md`.

The `apps/web` Next.js app is a separate package consuming the pinned OpenAPI snapshot; it owns no
engine logic and is out of scope for this file.

## 7. Commands

| Command | Purpose |
|---|---|
| `npm run test:unit` / `test:scripts` / `test:api` | DB-free suites (engine / scripts / HTTP) |
| `npm run test:api:db` | end-to-end HTTP against the TEST branch |
| `npm run start:api` | start the API (TEST branch, or `API_ALLOW_SHARED=1`) |
| `npm run eval:scenarios -- --model=<name@version>` | the 20-scenario golden matrix |
| `npm run gen:decisions` / `gen:schema` | regenerate the two generated docs |
| `npm run verify:docs` (`--live` adds the DB checks) | doc-claim gates |
| `npm run verify:replay -- --test-db` | replay every migration into an empty database and diff |
| `node scripts/run-migrations.js --check` | pending migrations |
| `check-offer-provenance.js` / `check-offer-freshness.js --fail-days=14` / `check-catalog-identity.js` | data gates |

Operational detail, gotchas and dated measurements live in `DEVELOPMENT_NOTES.md`.

## 8. Where the answers are

| Question | File |
|---|---|
| What is still open, with class/status/owner | `docs/OPEN_POINTS.md` |
| Why a rule exists | `docs/RECOMMENDATION_ENGINE_DECISIONS.md` |
| How the pipeline fits together | `docs/ARCHITECTURE.md` |
| What the HTTP surface promises | `docs/API.md` |
| Programme and sprint history | `docs/ROADMAP.md` |
| How to run one operation | `docs/RECIPES/` |
| Column-level schema truth | `database/migrations/` then `docs/SCHEMA_REFERENCE.md` |
