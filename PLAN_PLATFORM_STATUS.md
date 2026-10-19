# PLATFORM PROGRAM STATUS — P0–P3 roll-up

**What this page is:** the single answer to "what is left". It rolls up the 21 sprints of
`PLAN_PLATFORM_P0.md` … `PLAN_PLATFORM_P3.md` and the owner-gated backlog registered in
`docs/OPEN_GAPS.md` **OG-52**, so the state can be read here instead of reconstructed from four
plans. The plans own the HOW; the register owns the open-item ledger; this page owns the
where-are-we.

**Date:** 2026-10-19 · **Branch:** `master` (PR #3 merged `agent/platforms` as `b2fe64a`) · **Rules:** [PLAN_PLATFORM_CONSTRAINTS.md](PLAN_PLATFORM_CONSTRAINTS.md).
Passing-test counts are deliberately not restated here — see the dated entries in
`DEVELOPMENT_NOTES.md`.

## Verdict

**16 sprints done, 3 partial, 2 not started. PR #3 landed `agent/platforms` on `master` as `b2fe64a` on 2026-10-18, with identical content on both sides, so what remains is owner actions rather than agent work.**
**The recurring gates now run from the default branch, and the verdict is measured: `unit-and-docs` is green on `master`, and the one red step — `verify-migrations-replay` — was closed at its cause on 2026-10-19.** That red was never code: the replay diffed a 22-file tree against a shared database at ledger 20 and reported the 021/022 objects as fresh-only. The owner-approved apply (restore point `br-ancient-cake-axh57vpj`, ledger 20 -> 22) makes the same command report **0 drift**, so the next `recurring-gates` run is the first that can be wholly green — if it is not, the failure is new. **P1 Sprint 3**'s statement-count half is still measurable on the TEST branch (only its latency table waits for the co-located target). The BETA engine and API surface are live on the TEST branch (contract v1.5, schema at ledger 22 on the branch and, since 2026-10-19, on shared too, where the `morocco_pc_api` role is now provisioned); nothing is deployed and nothing is in production. The unblocking ladder: **P1 Sprint 1** (the EU project + deploy) unblocks the latency sprints and the deployed-host legs; **P1 Sprint 4** (DONE 2026-10-16) unblocked P1 Sprints 5–6 (both DONE 2026-10-16), and P2 Sprint 3 landed 2026-10-17 (Step 7 decided 2026-10-18: public but unlisted); **P3 Sprint 1** is now DONE because the nightly fires from `master` and its per-step result is recorded.

## Sprint completion matrix

| Plan | Sprint | Status | Done / remaining |
|---|---|---|---|
| P0 | 1 — pass-facts writer + 5th-arg seam | **DONE** | Writer + seam committed |
| P0 | 2 — wire the seam + column-scoped grant | **DONE** | `full-run.js` threads `passFacts`; Decision 46 recorded |
| P0 | 3 — author 019 + 020, branch-apply, replay | **DONE** | Both migrations; ledger 18 → 20 on the branch, `verify:replay` 0 drift |
| P0 | 4 — API read/wire + presenter + v1.1/v1.2 | **DONE** | Pass facts on both verbs; product identity; `openapi-v1.2.json` |
| P0 | 5 — shared-apply gate + doc refresh + P1–P4 review | **DONE** | 019+020 applied to shared from `br-damp-grass-axyri6yl`; OG-52 registered |
| P1 | 1 — co-locate (EU Neon + deploy + re-measure) | **PARTIAL** | Steps 1–3 committed (`--note`, audit `target` digest); **Steps 4–6 DONE 2026-10-18** (project `morocco-pc-eu` in `aws-eu-central-1`, 22 migrations + full seed replay through the ledger, parity `RESULT: MATCH` once seed 017 retired a 4-active-model replay drift); **Steps 7–9 remain** (hosting account, deploy, re-measure) — runbook and parity gate ready |
| P1 | 2 — batch the commit to ≤ 6 statements | **DONE** | 2026-10-18: the writer set is at most 5 statements (13 for the measured one); commit phase 19 → 11 statements, 3 331 → 1 838 ms at pin `launch-v2@1.0.0`; rows proven byte-identical on the branch. The co-located ms leg is P1 S1 Step 8 |
| P1 | 3 — reduce loader statements | NOT STARTED | 5 steps; baseline needs P1 S1 |
| P1 | 4 — `catalog_version` + canonical key (design only) | **DONE** | Decision 47 RESOLVED 2026-10-16 and implemented by S5 (`catalogVersion(db)` + migration 021) |
| P1 | 5 — dedupe repeated POSTs (contract change) | **DONE** | Live: 200 + `reused: true` + the original id; contract v1.3 |
| P1 | 6 — presets job + `GET /v1/presets` | **DONE** | Migration 022 + generator + endpoint (contract v1.4, Decision 48); the commit shipped broken and was repaired 2026-10-16 (36620ec) |
| P2 | 1 — use-case vocabulary from the model (OG-38) | **DONE** | `listUseCases` swap; branch serves GAMING/OFFICE/WORKSTATION |
| P2 | 2 — truthful per-IP limits (`trustProxy`) | **PARTIAL** | Steps 1–3 **DONE 2026-10-17** (`TRUST_PROXY` = trusted proxy address/CIDR list, default off, unsafe shapes refused; 14 new tests, `test:api` 89/0; **Decision 49** recorded); Step 5 committed (`aab917f`); **Step 4 needs P1's deployed host**, with the procedure in `docs/RECIPES/deploy-eu-colocation.md` §8.4 |
| P2 | 3 — catalog endpoints (read-only) | **DONE** | Steps 1–6 **DONE 2026-10-17** (two read endpoints, keyset pagination on `slug`, provenance-labelled prices, contract v1.5; `test:api` 98/0, `test:api:db` 9/0 with a 100-row page walk); Step 7 **DECIDED 2026-10-18**: public but unlisted, noindex until prices are VERIFIED, indicative prices behind the disclaimer |
| P2 | 4 — CORS allow-list + 429 contract, proven | **DONE** | 4 CORS tests + the 429 body/`Retry-After` pin, both documented (2026-10-17); `test:api` 75/0 |
| P2 | 5 — contract-completeness gate | **DONE** | `openapi-coverage.test.js` (7 tests); the gate exposed missing 429/500 on all five routes, now declared; snapshot regenerated (2026-10-17) |
| P3 | 1 — prove the recurring CI job | **DONE** | Steps 1–3 **DONE 2026-10-18**: two `workflow_dispatch` runs on `agent/platforms` ([39119596060](https://github.com/ibrahim-lahribli/morocco-pc/actions/runs/39119596060), [39120485573](https://github.com/ibrahim-lahribli/morocco-pc/actions/runs/39120485573)) — `test:api:db` **9 passed / 0 failed on the runner**; the replay was RED only on the branch-only 021/022 objects. **Step 4 DONE 2026-10-19**: PR #3 merged the branch into `master` as `b2fe64a`; the push run is green, and dispatch run [39123812237](https://github.com/ibrahim-lahribli/morocco-pc/actions/runs/39123812237) on `master` fails ONLY at `verify-migrations-replay` (freshness PASS, `test:api:db` PASS, `unit-and-docs` PASS). The remaining red was the shared database sitting at ledger 20 — **CLOSED 2026-10-19** by the shared apply (see the P3 S2 row), not a sprint step. Steps 5–6 recorded in `DEVELOPMENT_NOTES.md` 2026-10-19 |
| P3 | 2 — rehearse the production DB role | **DONE** | Steps 1–4 **DONE 2026-10-17** (`scripts/rehearse-api-role.js`: 20/20 privilege answers, zero `42501` as the role, row-wide UPDATE denied, residue 0, role removed); **Step 5 DONE 2026-10-19** (applied to shared from `br-ancient-cake-axh57vpj`, self-check 20/20, the smoke test ran the API as the role on shared) |
| P3 | 3 — staging + production + schema-gated deploy | NOT STARTED | 6 steps; **owner-gated** (cloud accounts); needs P1 S1 |
| P3 | 4 — observability that pages someone | **PARTIAL** | Steps 1–2 **DONE 2026-10-19**: DSN-gated `@sentry/node` capture behind an injected `captureError` (`apps/api/src/monitoring.js`, lazy require), 13 new tests (`test:api` 111/0 on Node 22 and 24), request data stripped in `beforeSend`; **Steps 3–6 remain** (a delivered event needs the deployed host + a DSN, then the body-asserting monitor, the retention decision and the commit) |
| P3 | 5 — freshness gate sees real offers | **DONE** | Pure helper + tests (2026-10-17); every non-seed offer evaluated by age, SEED stays informational |

**Totals:** 21 sprints — 16 DONE, 3 PARTIAL, 2 NOT STARTED.

## Owner-gated backlog (from OG-52, mapped to sprints)

OG-52 is the register's record of "the work P0 did NOT absorb". Each item below keeps its owner;
"owner" means a human, not the agent.

| OG-52 item | Owning sprint | Owner action needed |
|---|---|---|
| P1 region/co-location move | P1 S1 Steps 7–9 | Steps 4–6 **DONE 2026-10-18** (EU project created, replayed, parity MATCH); remaining: create the hosting account, deploy the API, re-measure |
| P1 engine-owned loader batching | P1 S3 (blocked by P1 S4) | — (agent; needs the `catalog_version` Decision first) |
| P1 dedupe + presets | P1 S5, S6 | — **DONE 2026-10-16** (both landed; owner review of the POST contract still invited before merge) |
| P2 catalog endpoints | P2 S3 | **DONE 2026-10-18** (Steps 1–6 on 2026-10-17; Step 7 decided: public but unlisted) |
| P2 `trustProxy` config | P2 S2 | — (agent; Steps 1–3 **DONE 2026-10-17**: the interface is a trusted-proxy address list, NOT a hop count, because fastify@5.12 disables numeric trust; Step 4 needs P1's deployed host) |
| P2 remainder of the OpenAPI snapshot surface | P2 S5 | — **DONE 2026-10-17** (the gate fails an undocumented route or a missing 429/500) |
| P2 `meta.js` `listUseCases` swap (OG-38) | P2 S1 | — **DONE 2026-10-15** (the swap landed; OG-38's behavioural half stays open) |
| P3 the `morocco_pc_api` role + column-scoped GRANTs | P3 S2 Step 5 | **DONE 2026-10-19** — applied to shared from restore point `br-ancient-cake-axh57vpj` (audit target `db:54ff6ea3f6e6`), self-check 20/20, `smoke-api-role.js --confirm-shared` green with residue 0. **The last residue of P0 Sprint 5 is closed** |
| P3 CI verification of `test:api:db` | P3 S1 Step 2 | **DONE 2026-10-18, PROVEN ON MASTER 2026-10-19** — dispatched on `agent/platforms`; `test:api:db` answered 9/0 on the runner. PR #3 then merged the branch into `master` as `b2fe64a`; the push run is green and dispatch run 39123812237 has `unit-and-docs` and `test:api:db` passing with `recurring-gates` failing only at the replay — that red **closed 2026-10-19** with the shared apply above, not a CI gap |
| P3 error tracking | P3 S4 | **CODE LANDED 2026-10-19, DELIVERY OWNER-GATED**: the DSN-gated capture is wired and unit-tested; a monitoring account + a DSN in the secret store are still what turns it from wired into proven (Step 3) |
| P3 staging + production | P3 S3 | Two named environments + a deploy provider account |
| P3 migration-deploy step | P3 S3 | — (agent, once the environments exist) |
| P4 H2 retailer with readable terms | — (no P4 plan file) | A real retailer; blocks all P4 real-data work |
| P4 non-seed provenance gate | P3 S5 | — **DONE 2026-10-17** (the gate covers non-seed provenance; the P4 real-data work stays open) |
| P4 Decision 7 amendment / seed retirement / read-path `ACTIVE` audit | — (no P4 plan file) | — (agent, but gated behind real data) |

## What is blocked vs. what can start now

**Blocked on an owner action (do not start; prepare the exact command):**
- *The latency half of the P1 chain* — P1 S3's before/after ms table and P2 S2 Step 4's deployed-host leg.
  Their statement counts are measurable on the TEST branch; the ms table is not.
- *P3 S3* (staging + production) needs both the cloud accounts and P1's deployment; *P3 S4* needs a
  monitoring account. *P3 S2 Step 5* and the `verify-migrations-replay` red are DONE 2026-10-19
  (shared ledger 22 + the production role), and *P3 S1* is merged and measured on `master`.

**Startable now, no owner action (agent work):**
- **P1 S4** — DONE 2026-10-16 (Decision 47; implemented by S5). It no longer gates anything here.
- **P1 S3** — its statement-count half is agent work against the TEST branch (as P1 S2's was); the latency table waits for P1 S1.
- **P3 S2** — **DONE 2026-10-19** (Steps 1–4 rehearsed on the TEST branch 2026-10-17; Step 5, the shared apply, ran 2026-10-19).
- **P3 S5** — **DONE 2026-10-17** (the gate covers non-seed provenance; no migration, no write).
- **P2 S4 and P2 S5** — **DONE 2026-10-17** (the CORS/429 proof and the OpenAPI-completeness gate; both DB-free).
- **P2 S3** — **DONE 2026-10-18** (the two read-only catalog endpoints, contract v1.5, plus Step 7's public-but-unlisted decision).
- **P2 S2 Steps 1–3** — **DONE 2026-10-17** (configurable `trustProxy`, default off, with 14 DB-free tests); only Step 4 needs the deployed host.

## The frontend track (its own branch, not this one)

The frontend is NOT on this branch and must not be read as platform work that is "missing".
`apps/web/` exists only on `freebuff/review-and-web-design-guidelines-tailwind-design-s-...`
(commit `245638d`, 25 files: Next.js scaffold, `/fr` shell, its own CI workflow and the S1–S6
sprint board); `agent/web` is currently identical to `master` and has never been pushed. What the
frontend consumes from here is the API contract, so the platform items that matter to it are four,
and none of them is agent work left undone:

- **A deployed origin** (P1 Sprint 1 Steps 7–9) — without it there is nothing for the web app to
  point at, and `ALLOWED_ORIGINS` cannot name a real origin (P2 Sprint 2 Step 4).
- **Catalogue exposure** — public but unlisted, `noindex` until prices are `VERIFIED` (P2 Sprint 3
  Step 7, decided 2026-10-18). The list response carries `offer_class` per product but NO
  `disclaimer` field, so a price grid built from it must render the disclaimer itself.
- **The POST contract review** invited before merge: dedupe (200 + `reused: true`) and presets
  (contract v1.4) change what the wizard may rely on.
- **A write target that is not the TEST branch** — the Neon `frontend-dev` branch
  (`br-proud-frog-ax80h3nv`) plus the gitignored `.env.frontend-dev`, because every distinct POST
  leaves an unmarked `recommendation_query` row and `eval:scenarios` refuses to run while one
  exists.

The frontend branch carries one open defect of its own, and it is NOT a platform item: its
Tailwind v4 build has no PostCSS (or Turbopack) integration wired, so `@theme` is never
processed — recorded in `docs/plans/agent3-web-plan.md` §2.5 on that branch.

## Register sync

The drift this page first exposed was corrected in `docs/OPEN_GAPS.md` on 2026-10-16: OG-52's row
now reads **OPEN (partially started)**, the P2 `listUseCases` swap it listed is marked landed (P2
Sprint 1, 2026-10-15), and the `morocco_pc_api` role names **P3 Sprint 2** as its owning sprint.
The P1 `dedupe + presets` clause landed 2026-10-16 (S5 + S6, with Decision 48 recorded) and the `morocco_pc_api` role closed 2026-10-19; everything else OG-52 lists is still accurate.

## Where things live

| Question | Read |
|---|---|
| The rules every plan works inside | [PLAN_PLATFORM_CONSTRAINTS.md](PLAN_PLATFORM_CONSTRAINTS.md) |
| P0 sprint-by-sprint execution records | [PLAN_PLATFORM_P0.md](PLAN_PLATFORM_P0.md) |
| P1 (latency) | [PLAN_PLATFORM_P1.md](PLAN_PLATFORM_P1.md) |
| P2 (API surface) | [PLAN_PLATFORM_P2.md](PLAN_PLATFORM_P2.md) |
| P3 (ops) | [PLAN_PLATFORM_P3.md](PLAN_PLATFORM_P3.md) |
| What is still open, with class/status/owner | [docs/OPEN_GAPS.md](docs/OPEN_GAPS.md) — OG-52 and OG-38 |
| Measured before/after numbers and run logs | [DEVELOPMENT_NOTES.md](DEVELOPMENT_NOTES.md) |
