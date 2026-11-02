# ROADMAP — the platform programme

**What this file is.** The plan of record for the API/platform track: what the 21 sprints of P0–P3
were meant to do, what shipped, what is owner-gated, and what the web track and the cross-agent
requests need. It replaces `PLAN_PLATFORM_P0..P3.md`, `PLAN_PLATFORM_STATUS.md`,
`PLAN_PLATFORM_CONSTRAINTS.md`, `docs/briefs/requests.md` and `docs/briefs/step2-launch-v2-runbook.md`
(all now in `docs/archive/`).

**This file does not answer "what is still open".** That is [`OPEN_POINTS.md`](OPEN_POINTS.md)
(R-01 … R-23, with class, status and owner). This file is the programme history and the sprint ledger.

## 1. Rules the programme works inside

Unchanged from `PLAN_PLATFORM_CONSTRAINTS.md`, and the same rules `AGENTS.md` §8 enforces:

- the shared Neon database is never reset, dropped or truncated; a write needs an owner-recorded
  restore point and leaves an audit line in `database/migration-applies.jsonl`;
- anything write-capable targets `TEST_DATABASE_URL`; the shared `DATABASE_URL` needs an explicit
  opt-in (`API_ALLOW_SHARED=1`, `--confirm-shared`) and the owner's approval;
- schema changes are NEW sequential migrations applied through the `schema_migrations` ledger, never
  edits to a committed file;
- a step is done when its gate is green, reported as PASS / FAIL / BLOCKED — never "should pass";
- an owner action (a cloud account, a secret rotation, a restore point, a real retailer) is named as
  such and never simulated by an agent.

## 2. Position on 2026-11-02 (measured, not asserted)

| Thing | State |
|---|---|
| Schema | 23 migrations, ledger **23** on shared, TEST and EU; `run-migrations.js --check` reports no pending file |
| API | Fastify, contract **v1.10.0**, ten paths, snapshot `apps/api/test/unit/openapi-v1.10.json` |
| Deployed origins | **one** — `https://morocco-pc.onrender.com` (Render Free, serves the SHARED database, answers `engine_version: "dev"`, spins down after 15 idle minutes). No EU host has ever been deployed. |
| DB roles | `morocco_pc_api` provisioned on shared and EU, self-check 21/21, smoke green as the role — and **not used by the deployed app** (`check-deployed-role.js`: FAIL, `neondb_owner`) |
| Served scoring model | the newest ACTIVE row; on shared that is `launch-v2@2.4.0` (six ACTIVE `launch-v2` versions, `seed-minimal-v1` INACTIVE). Nothing pins a model at deploy. |
| CI | `unit-and-docs` on push/PR; `recurring-gates` nightly + dispatch |
| Tests | engine **1261**, scripts **443**, API **193** (0 failed, measured 2026-11-02); `test:api:db` **17**, nightly only |

## 3. Sprint ledger (21 sprints: 16 DONE, 3 PARTIAL, 2 NOT STARTED)

| Plan | Sprint | Status | What remains |
|---|---|---|---|
| P0 | 1 — pass-facts writer + 5th-arg seam | DONE | — |
| P0 | 2 — wire the seam + column-scoped grant | DONE | Decision 46 recorded |
| P0 | 3 — author 019 + 020, branch-apply, replay | DONE | — |
| P0 | 4 — API read/wire + presenter + v1.1/v1.2 | DONE | — |
| P0 | 5 — shared-apply gate + doc refresh | DONE | 019+020 applied to shared from `br-damp-grass-axyri6yl` |
| P1 | 1 — co-locate (EU Neon + deploy + re-measure) | **PARTIAL** | EU project `morocco-pc-eu` (`lingering-heart-20497074`, `aws-eu-central-1`) replayed and at parity. Steps 7–9 remain: hosting account, deploy, re-measure |
| P1 | 2 — batch the commit | DONE | commit phase 19 → 11 statements; the ms table needs P1 S1 |
| P1 | 3 — reduce loader statements | **NOT STARTED** | 5 steps; its baseline needs P1 S1 |
| P1 | 4 — `catalog_version` + canonical key | DONE | Decision 47, implemented by S5 (migration 021) |
| P1 | 5 — dedupe repeated POSTs | DONE | 200 + `reused: true`; contract v1.3 |
| P1 | 6 — presets job + `GET /v1/presets` | DONE | migration 022; contract v1.4; repaired 2026-10-16 (`36620ec`) |
| P2 | 1 — use-case vocabulary from the model | DONE | `listUseCases` swap; GAMING/OFFICE/WORKSTATION served |
| P2 | 2 — truthful per-IP limits (`trustProxy`) | **PARTIAL** | Steps 1–3 + 5 done; Step 4 needs the deployed host |
| P2 | 3 — catalog endpoints | DONE | contract v1.5 → v1.6; public but unlisted, noindex until prices are VERIFIED |
| P2 | 4 — CORS allow-list + 429 contract | DONE | pinned by tests and documented |
| P2 | 5 — contract-completeness gate | DONE | `openapi-coverage.test.js` |
| P3 | 1 — prove the recurring CI job | DONE | dispatch 39207745723 on `master`, every step PASS |
| P3 | 2 — rehearse the production DB role | DONE | applied on shared and EU, 21/21 re-grant 2026-10-29 |
| P3 | 3 — staging + production + schema-gated deploy | **NOT STARTED** | owner-gated: cloud accounts, needs P1 S1 |
| P3 | 4 — observability that pages someone | **PARTIAL** | DSN-gated `@sentry/node` wired and tested; a delivered event needs a deployed host + DSN |
| P3 | 5 — freshness gate sees real offers | DONE | every non-seed offer evaluated by age; SEED stays informational |

## 4. Owner-gated backlog

Each item's current state, evidence and severity live in `OPEN_POINTS.md`; this is the owner-to-action map.

| Action | Unblocks | R-id |
|---|---|---|
| Rotate the deployed host's DB credential onto `morocco_pc_api` | P3 S2's whole point; the measured FAIL in `check-deployed-role.js` | R-05 |
| Pin (or deliberately activate) the release scoring model at deploy | the served-model drift between environments | R-06 |
| Choose and pay for an always-on host (Fly is paid; Render Free sleeps) | P1 S1 Steps 7–9, P1 S3's latency table, P2 S2 Step 4, P3 S3, Sentry Step 3, web S26 | R-08 |
| A retailer with readable terms | every P4 real-data item: real offers, provenance PASS, freshness PASS | R-01 |
| A monitoring account + DSN | P3 S4 Steps 3–6 | R-08 |

## 5. The web track (`apps/web`)

S1–S27 of `docs/archive/plans/agent3-web-sprints.md`: 26 done, S26 blocked on a deployment. Its own
package, lockfile and workflow (`web.yml`), consuming this API through types generated from
`apps/api/test/unit/openapi-v1.10.json` with `check:api-types` as the drift gate. Measured 2026-10-26:
378 Playwright specs, 376 passed / 2 skipped on a fresh build.

The host is DECIDED — Cloudflare Workers via the OpenNext adapter (`apps/web/wrangler.jsonc`,
`open-next.config.ts`, committed 2026-10-23; OG-53) — and **nothing is deployed**: no web environment
exists, no workflow step deploys, and the app has never called a deployed API. What it still needs from
this side is one deployed origin, the catalogue's public-but-unlisted posture (the list response has no
`disclaimer` field, so a price grid must render its own), and a write target that is not the TEST branch
(the Neon `frontend-dev` branch `br-proud-frog-ax80h3nv`).

## 6. Cross-agent requests (was `docs/briefs/requests.md`)

| Date | Request | Status |
|---|---|---|
| 2026-10-15 | Provision `morocco_pc_api` on the shared database | FULFILLED 2026-10-19 (`br-ancient-cake-axh57vpj`, self-check 20/20, smoke green) |
| 2026-10-14 | Remove four `TestCompat*` fixtures from shared; widen `filtering/context-loader.js` for E8 | RESOLVED 2026-10-18 (C-41): the leak was 27 rows across 7 tables, not four products; the script is now guarded AND self-cleaning |
| 2026-10-08 | Persist the explicit run `as_of` on `recommendation_query` | **OPEN** — engine half shipped (Decision 38); the column is still unbuilt. Tracked as R-23 |
| 2026-10-08 | Wire `listUseCases` into the API vocabulary | CLOSED 2026-10-15 (P2 Sprint 1; the derivation lives in `engine.js`, not `meta.js`, because `import-boundary.test.js` pins that) |
| 2026-10-08 | Reserve seed numbers 014+ for Platform (013 taken by Engine) | HISTORICAL — the seed series is now at 028 |

## 7. Completed operator runs (was `docs/briefs/step2-launch-v2-runbook.md`)

The launch-v2 activation run completed on 2026-10-09: seed 013 applied to the TEST branch, both models
active, and the pinned v1 golden run byte-identical to its baseline except the model-identity header. The
reversal steps are historical and are kept only in `docs/archive/briefs/step2-launch-v2-runbook.md`; the
live procedure for a model activation is `docs/RECIPES/add-a-scoring-model-version.md`.

## 8. Where things live

| Question | Read |
|---|---|
| What is implemented, and which environment is which | [`../CONTEXT.md`](../CONTEXT.md) |
| What is still open | [`OPEN_POINTS.md`](OPEN_POINTS.md) |
| Why a rule exists | [`RECOMMENDATION_ENGINE_DECISIONS.md`](RECOMMENDATION_ENGINE_DECISIONS.md) |
| How the pipeline fits together | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| What the HTTP surface promises | [`API.md`](API.md) |
| How to run one operation | [`RECIPES/`](RECIPES/) |
| How to add a decision / migration / seed / model | [`RECIPES/`](RECIPES/) and [`decisions/TEMPLATE.md`](decisions/TEMPLATE.md) |
| Operational lessons and measured numbers | [`../DEVELOPMENT_NOTES.md`](../DEVELOPMENT_NOTES.md) |
| The superseded originals | [`archive/`](archive/) |
