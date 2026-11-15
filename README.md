# morocco-pc

PC build recommendation platform for the Moroccan market. Given a budget, a use case, an optional
resolution and a priority, it selects compatible components, assembles whole builds, scores and ranks
them, explains the choice, and stores the pass. Node.js, CommonJS, no build step; PostgreSQL on Neon;
raw parameterized SQL; the Fastify API and the Next.js app are thin layers over the engine.

**Status:** the engine and the API are implemented and tested; the catalogue is seed data, so no price
is verified and no offer carries retailer provenance. One Render origin exists: the private-beta host
(`https://morocco-pc-api-eu.onrender.com`, EU database as `morocco_pc_api`, pinned to
`launch-v2@2.4.0`). The Render demo service that fronted the shared dev database was suspended on
2026-11-06 and its deletion is pending (R-05, `docs/OPEN_POINTS.md`). It is not a production
deployment.

This file is the way in. It is not a contract and not a status page: current state is `CONTEXT.md`,
open work is `docs/OPEN_POINTS.md`, and every implementation question has one owner document linked
below.

## Quick start (safe by default)

```bash
npm install
npm run test:unit        # engine suite, no database needed (1284 tests)
npm run test:scripts     # gate/CLI suites (750)
npm run test:api         # HTTP contract suites, DB-free (193)
npm run test:db          # connectivity + table listing
npm run start:api        # TEST branch, or API_ALLOW_SHARED=1
```

`DATABASE_URL` (shared dev), `TEST_DATABASE_URL` (an isolated Neon branch) and
`TARGET_DATABASE_URL` (EU) come from `.env`, which is never committed and never printed. Nothing
above writes to the shared database; `start:api` refuses to target it unless `API_ALLOW_SHARED=1` is
explicit.

## What the system is

Four logical layers in one PostgreSQL database, mirrored by the engine modules:

| Layer | Tables | Meaning |
|---|---|---|
| 1 — Catalog / Hardware | `product*`, `<role>_spec`, explicit compatibility tables | what exists, and which combinations are legal |
| 2 — Performance / Assessment | `benchmark*`, `component_assessment`, `scoring_model` | how good a part is, and the model that weighs it |
| 3 — Market | `store`, `store_offer`, `price_history` | what it costs, where, and when it was seen |
| 4 — Recommendation | `recommendation_*`, `build_candidate`, `build_component`, `build_rejection`, `recommendation_swap` | the passes, their builds and their evidence |

One pass: query → offer pre-selection → candidate pool → compatibility filtering → candidate scoring →
per-role retention → DFS assembly → build scoring → ranking and archetype selection → explanation →
one write transaction. Engine stages are pure: no DB, no clock, no randomness, and ties break
deterministically on `product_id` ASC. The loaders, the read snapshot and the write transaction are
the impure edges, owned by `packages/recommendation-runtime/docs/LOADERS_AND_TRANSACTIONS.md`.

## Guard rails

- **Never reset, drop or truncate the shared Neon database.** It is the only dev database.
- **Write tests only against `TEST_DATABASE_URL`.** Scripts route through `packages/database-guard/src/index.js`; the
  API refuses to start against anything else unless `API_ALLOW_SHARED=1` is explicit.
- **Never rewrite a committed migration.** Schema changes are a new sequential `NNN_*.sql` applied
  through the `schema_migrations` ledger; a shared apply needs a recorded restore point.
- **`PASS | FAIL | UNKNOWN | CONDITIONAL` is load-bearing.** NULL is UNKNOWN, and UNKNOWN is never
  treated as PASS or as FAIL.
- **A gate verdict is evidence; prose is a claim.** Report PASS / FAIL / BLOCKED, and say which.
- **Never invent data.** A missing spec stays NULL and the verdict stays UNKNOWN (Decision 61).

## Where to read

**Start here**

| Question | File |
|---|---|
| What exists today, and which environment is which | [`CONTEXT.md`](CONTEXT.md) |
| What is still open (R-01 … R-23, class/owner) | [`docs/OPEN_POINTS.md`](docs/OPEN_POINTS.md) |
| Programme, sprint ledger and open backlog | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| Vocabulary and the decision-id conventions | [`docs/GLOSSARY.md`](docs/GLOSSARY.md) |
| Which test pins which contract | [`docs/TEST_MAP.md`](docs/TEST_MAP.md) |
| Agent entry point and global rules | [`AGENTS.md`](AGENTS.md) |

**By owner**

| Area | Read | Recipes |
|---|---|---|
| Engine (pure logic) | [`docs/engine/ARCHITECTURE.md`](docs/engine/ARCHITECTURE.md) — pipeline, HARD/SOFT policy, compatibility, scoring, budget | [`docs/engine/recipes/`](docs/engine/recipes/) |
| Runtime (loaders, snapshot, transaction) | [`packages/recommendation-runtime/docs/LOADERS_AND_TRANSACTIONS.md`](packages/recommendation-runtime/docs/LOADERS_AND_TRANSACTIONS.md) | — |
| HTTP API | [`docs/api/CONTRACT.md`](docs/api/CONTRACT.md), then `apps/api/src/` module headers | [`docs/database/recipes/provision-the-api-role.md`](docs/database/recipes/provision-the-api-role.md) |
| Offer ingestion | [`docs/ingestion/PIPELINE_DESIGN.md`](docs/ingestion/PIPELINE_DESIGN.md) | [`docs/ingestion/recipes/import-offers.md`](docs/ingestion/recipes/import-offers.md) |
| Database (schema, migrations, seeds, role) | `database/migrations/*.sql` (the schema), `docs/SCHEMA_REFERENCE.md` (generated mirror) | [`docs/database/recipes/`](docs/database/recipes/) |
| Frontend (Next.js) | [`apps/web/README.md`](apps/web/README.md) | — |
| Deployment and first launch | [`docs/RECIPES/`](docs/RECIPES/) | [`deploy-eu-colocation.md`](docs/RECIPES/deploy-eu-colocation.md), [`first-eu-launch.md`](docs/RECIPES/first-eu-launch.md), [`release-in-two-stages.md`](docs/RECIPES/release-in-two-stages.md) |

**Evidence and history**

| Question | File |
|---|---|
| Why a rule exists (the decision log) | [`docs/RECOMMENDATION_ENGINE_DECISIONS.md`](docs/RECOMMENDATION_ENGINE_DECISIONS.md) |
| Which decisions exist, and their status | `grep -n "^Status:"` in that file, or the generated [`docs/DECISION_INDEX.md`](docs/DECISION_INDEX.md) |
| Detailed gap evidence behind the register | [`docs/OPEN_GAPS.md`](docs/OPEN_GAPS.md) |
| Verified commands, dated measurements, failure modes | [`DEVELOPMENT_NOTES.md`](DEVELOPMENT_NOTES.md) |
| Superseded documents | [`docs/archive/README.md`](docs/archive/README.md) |
| The architecture decision that produced this layout | [`docs/architecture/SYSTEM_ARCHITECTURE_AND_PROJECT_SEPARATION_RFC.md`](docs/architecture/SYSTEM_ARCHITECTURE_AND_PROJECT_SEPARATION_RFC.md) |

## Documentation layout

```
README.md            this page: what the project is, safely, and where to read
AGENTS.md            agent index: read order, precedence, safety rules, links
CONTEXT.md           current state (not a handoff, not history)
DEVELOPMENT_NOTES.md dated operational evidence
docs/
  OPEN_POINTS.md  OPEN_GAPS.md  ROADMAP.md  GLOSSARY.md  TEST_MAP.md
  RECOMMENDATION_ENGINE_DECISIONS.md      append-only decision log
  DECISION_INDEX.md  SCHEMA_REFERENCE.md  DATA_STATE.md    GENERATED (never hand-edit)
  engine/       ARCHITECTURE.md, recipes/, AGENTS.md
  api/          CONTRACT.md
  ingestion/    PIPELINE_DESIGN.md, recipes/, AGENTS.md
  database/     recipes/
  RECIPES/      deployment, release and documentation-governance recipes
  decisions/  briefs/  architecture/  archive/
```

`docs/ARCHITECTURE.md`, `docs/API.md` and `docs/PIPELINE_DESIGN.md` no longer exist at those paths:
they moved to `docs/engine/ARCHITECTURE.md`, `docs/api/CONTRACT.md` and
`docs/ingestion/PIPELINE_DESIGN.md` on 2026-11-11. Citations of the old paths in the append-only
decision log, `DEVELOPMENT_NOTES.md` and `docs/archive/**` are historical and are left as written.
