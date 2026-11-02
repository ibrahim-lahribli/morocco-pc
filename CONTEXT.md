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
| 4 — Recommendation | `recommendation_profile`, `recommendation_query`, `recommendation_result`, `build_candidate`, `build_component`, `build_rejection`, `recommendation_swap` | 12 queries / 16 results / 16 candidates on shared — probe residue, not user data |

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
| `TARGET_DATABASE_URL` (EU) | `morocco-pc-eu`, `aws-eu-central-1` | `launch-v2@1.0.0` (not re-measured 2026-11-02: unset in this shell) | the release target; no host is deployed |

The shared database is never reset, dropped or truncated. Write-capable scripts route through
`scripts/lib/db-url.js`; the API refuses to start against anything but the TEST branch unless
`API_ALLOW_SHARED=1`. Real-database writes need a recorded restore point and leave an audit line in
`database/migration-applies.jsonl`.

**Deployed origins:** exactly one — `https://morocco-pc.onrender.com` (Render Free, fronting the
shared database, answering `engine_version: "dev"`, spins down after 15 idle minutes). It is a demo
origin, not a launch host.

## 4. Scoring models and what is served

`scoring_model` holds 7 rows: `seed-minimal-v1@1.0.0` (INACTIVE) and six ACTIVE `launch-v2` versions
1.0.0 … 2.4.0 (2.0.0 resolution floors, 2.1.0 archetype objectives, 2.2.0 pair quota 2, 2.3.0 uniform
CPU depth 10, 2.4.0 CPU-only depth 10). `apps/api/src/repository.js` selects the newest ACTIVE row, so
**shared and the demo origin serve `launch-v2@2.4.0`**; nothing sets `SCORING_MODEL_PIN`, so no origin
pins a model deliberately. `launch-v2@2.4.0` is the version the gate measures green (82 PASS / 3
EXPECTED-RED / 1 UNKNOWN) and it is NOT adopted for release — that is a decision, not a measurement.

## 5. Measured numbers (2026-11-02, this checkout)

- `npm run test:unit` **1261 pass / 0 fail / 0 cancelled** (Node 24.21.0 and Node 22);
  `npm run test:scripts` **443 / 0**; `npm run test:api` **193 / 0**; `npm run test:api:db` **17 / 0**
  (nightly only — it writes to the TEST branch).
- Doc gates: `gen-decision-index --check` **0**, `verify-docs --offline` **0**,
  `gen-schema-reference --check` **0**.
- `check-catalog-identity.js` **PASS on all three**: shared 113 of 113, EU 100 of 100 and TEST 113 of 113, after seed 028 was applied to the two that
  lacked it (EU's whole 100-row catalogue, shared's 13). Re-measured 2026-11-02 after the applies.
  Restore points: `shared-backup-pre-028-20261102-1300` and `eu-backup-pre-028-20261102-1312`;
  the API walk on shared now serves 113 products (100 before) and all 13 new slugs resolve.
- `check-offer-provenance.js` **INCONCLUSIVE** everywhere: 114 seed offers, 0 verified, 2 stores on
  the reserved `example.ma` domain. `check-offer-freshness.js` reports the first SEED expiry at
  **2026-11-03**.
- Real passes through `orchestrator.runRecommendation`, `launch-v2@2.4.0`: GAMING 21 500 @1440p →
  25 builds over 13 distinct (CPU, GPU) pairs, rank-1 score 60.83 at 19 976; OFFICE at 12 000, 20 000
  and 30 000 all return the identical 9 076 build (score 59.60) — `build_score` carries no budget term.
- `node scripts/check-deployed-role.js` **FAIL**: the deployed app authenticates as `neondb_owner`,
  not `morocco_pc_api` (provisioned on shared and EU, self-check 21/21).

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
