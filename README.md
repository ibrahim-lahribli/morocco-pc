# morocco-pc

PC build recommendation platform for the Moroccan market. Given a budget, a use case, an optional
resolution and a priority, it selects compatible components, assembles whole builds, scores and ranks
them, explains the choice, and stores the pass. Node.js, CommonJS, no build step; PostgreSQL on Neon;
raw parameterized SQL; the Fastify API and the Next.js app are thin layers over a pure engine.

**Status:** the engine and the API are implemented and tested; the catalogue is seed data, so no price
is verified and no offer carries retailer provenance. There is one demo origin
(`https://morocco-pc.onrender.com`, fronting the shared dev database) and no production deployment.
What is open, with severity and owner, is [`docs/OPEN_POINTS.md`](docs/OPEN_POINTS.md).

## Quick start

```bash
npm install
npm run test:unit        # engine suite, no database needed (1261 tests)
npm run test:scripts     # gate/CLI suites (443)
npm run test:api         # HTTP contract suites, DB-free (193)
npm run test:db          # connectivity + table listing
npm run start:api        # TEST branch, or API_ALLOW_SHARED=1
```

`DATABASE_URL` (shared dev), `TEST_DATABASE_URL` (an isolated Neon branch) and
`TARGET_DATABASE_URL` (EU) come from `.env`, which is never committed and never printed.

## The four layers

| Layer | Tables | Meaning |
|---|---|---|
| 1 — Catalog / Hardware | `product*`, `<role>_spec`, explicit compatibility tables | what exists, and which combinations are legal |
| 2 — Performance / Assessment | `benchmark*`, `component_assessment`, `scoring_model` | how good a part is, and the model that weighs it |
| 3 — Market | `store`, `store_offer`, `price_history` | what it costs, where, and when it was seen |
| 4 — Recommendation | `recommendation_*`, `build_candidate`, `build_component`, `build_rejection`, `recommendation_swap` | the passes, their builds and their evidence |

The engine mirrors the layers and runs one pass: query → offer pre-selection → candidate pool →
compatibility filtering → candidate scoring → per-role retention → DFS assembly → build scoring →
ranking and archetype selection → explanation → one write transaction. Engine stages are pure: no DB,
no clock, no randomness, and ties break deterministically on `product_id` ASC.

## Guard rails

- **Never reset, drop or truncate the shared Neon database.** It is the only dev database.
- **Write tests only against `TEST_DATABASE_URL`.** Scripts route through `scripts/lib/db-url.js`; the
  API refuses to start against anything else unless `API_ALLOW_SHARED=1` is explicit.
- **Never rewrite a committed migration.** Schema changes are a new sequential `NNN_*.sql` applied
  through the `schema_migrations` ledger; a shared apply needs a recorded restore point.
- **`PASS | FAIL | UNKNOWN | CONDITIONAL` is load-bearing.** NULL is UNKNOWN, and UNKNOWN is never
  treated as PASS or as FAIL.
- **A gate verdict is evidence; prose is a claim.** Report PASS / FAIL / BLOCKED, and say which.
- **Never invent data.** A missing spec stays NULL and the verdict stays UNKNOWN (Decision 61).

## Where to read

| Question | File |
|---|---|
| What exists today, and which environment is which | [`CONTEXT.md`](CONTEXT.md) |
| What is still open | [`docs/OPEN_POINTS.md`](docs/OPEN_POINTS.md) |
| Why a rule exists (62 decisions) | [`docs/RECOMMENDATION_ENGINE_DECISIONS.md`](docs/RECOMMENDATION_ENGINE_DECISIONS.md) |
| Pipeline, compatibility policy, scoring | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| The HTTP contract | [`docs/API.md`](docs/API.md) |
| Programme and sprints | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| How to run one operation | [`docs/RECIPES/`](docs/RECIPES/) |
| Agent instructions and verified commands | [`AGENTS.md`](AGENTS.md), [`DEVELOPMENT_NOTES.md`](DEVELOPMENT_NOTES.md) |
| Schema columns / live row counts (generated) | [`docs/SCHEMA_REFERENCE.md`](docs/SCHEMA_REFERENCE.md), [`docs/DATA_STATE.md`](docs/DATA_STATE.md) |
| Superseded documents | [`docs/archive/`](docs/archive/README.md) |
