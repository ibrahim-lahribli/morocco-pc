# PLATFORM PROGRAM STATUS — P0–P3 roll-up

**What this page is:** the single answer to "what is left". It rolls up the 21 sprints of
`PLAN_PLATFORM_P0.md` … `PLAN_PLATFORM_P3.md` and the owner-gated backlog registered in
`docs/OPEN_GAPS.md` **OG-52**, so the state can be read here instead of reconstructed from four
plans. The plans own the HOW; the register owns the open-item ledger; this page owns the
where-are-we.

**Date:** 2026-10-17 · **Branch:** `agent/platforms` · **Rules:** [PLAN_PLATFORM_CONSTRAINTS.md](PLAN_PLATFORM_CONSTRAINTS.md).
Passing-test counts are deliberately not restated here — see the dated entries in
`DEVELOPMENT_NOTES.md`.

## Verdict

**12 sprints done, 5 partial, 4 not started. Almost every remaining sprint of agent work is gated
behind an owner action — most of them behind two: the EU Neon project + hosting account (P1
Sprint 1) and the GitHub dispatch (P3 Sprint 1). No agent-only sprint remains: every one of the
nine open sprints is blocked on the co-located target, an owner decision, or an owner account.** The BETA engine and API surface are live on the TEST branch (contract v1.5,
schema at ledger 22 on the branch and 20 on shared); nothing is deployed, nothing is in production, and the CI
job that would prove the end-to-end path has never been run. The unblocking ladder: **P1 Sprint 1** (the EU project + deploy) unblocks the latency
sprints and the deployed-host legs; **P1 Sprint 4** (DONE 2026-10-16) unblocked P1 Sprints 5–6 (both DONE 2026-10-16), and
P2 Sprint 3 landed 2026-10-17; **P3 Sprint 1** (the CI dispatch) is the only way to turn the CI claim from
unverified into evidence.

## Sprint completion matrix

| Plan | Sprint | Status | Done / remaining |
|---|---|---|---|
| P0 | 1 — pass-facts writer + 5th-arg seam | **DONE** | Writer + seam committed |
| P0 | 2 — wire the seam + column-scoped grant | **DONE** | `full-run.js` threads `passFacts`; Decision 46 recorded |
| P0 | 3 — author 019 + 020, branch-apply, replay | **DONE** | Both migrations; ledger 18 → 20 on the branch, `verify:replay` 0 drift |
| P0 | 4 — API read/wire + presenter + v1.1/v1.2 | **DONE** | Pass facts on both verbs; product identity; `openapi-v1.2.json` |
| P0 | 5 — shared-apply gate + doc refresh + P1–P4 review | **DONE** | 019+020 applied to shared from `br-damp-grass-axyri6yl`; OG-52 registered |
| P1 | 1 — co-locate (EU Neon + deploy + re-measure) | **PARTIAL** | Steps 1–3 committed (`--note`, audit `target` digest); **Steps 4–9 OWNER**, with a runnable runbook (`docs/RECIPES/deploy-eu-colocation.md`) and the parity gate (`scripts/check-target-parity.js`) ready |
| P1 | 2 — batch the commit to ≤ 6 statements | NOT STARTED | 5 steps; needs the co-located target to measure |
| P1 | 3 — reduce loader statements | NOT STARTED | 5 steps; baseline needs P1 S1 |
| P1 | 4 — `catalog_version` + canonical key (design only) | **DONE** | Decision 47 RESOLVED 2026-10-16 and implemented by S5 (`catalogVersion(db)` + migration 021) |
| P1 | 5 — dedupe repeated POSTs (contract change) | **DONE** | Live: 200 + `reused: true` + the original id; contract v1.3 |
| P1 | 6 — presets job + `GET /v1/presets` | **DONE** | Migration 022 + generator + endpoint (contract v1.4, Decision 48); the commit shipped broken and was repaired 2026-10-16 (36620ec) |
| P2 | 1 — use-case vocabulary from the model (OG-38) | **DONE** | `listUseCases` swap; branch serves GAMING/OFFICE/WORKSTATION |
| P2 | 2 — truthful per-IP limits (`trustProxy`) | **PARTIAL** | Steps 1–3 **DONE 2026-10-17** (`TRUST_PROXY` = trusted proxy address/CIDR list, default off, unsafe shapes refused; 14 new tests, `test:api` 89/0; **Decision 49** recorded); Step 5 committed (`aab917f`); **Step 4 needs P1's deployed host** |
| P2 | 3 — catalog endpoints (read-only) | **PARTIAL** | Steps 1–6 **DONE 2026-10-17** (two read endpoints, keyset pagination on `slug`, provenance-labelled prices, contract v1.5; `test:api` 98/0, `test:api:db` 9/0 with a 100-row page walk); **Step 7 OWNER** (public exposure) |
| P2 | 4 — CORS allow-list + 429 contract, proven | **DONE** | 4 CORS tests + the 429 body/`Retry-After` pin, both documented (2026-10-17); `test:api` 75/0 |
| P2 | 5 — contract-completeness gate | **DONE** | `openapi-coverage.test.js` (7 tests); the gate exposed missing 429/500 on all five routes, now declared; snapshot regenerated (2026-10-17) |
| P3 | 1 — prove the recurring CI job | **PARTIAL** | Ref rationale recorded (commit `438ecf6`); **Step 2 dispatch OWNER**; Steps 3–6 not started |
| P3 | 2 — rehearse the production DB role | **PARTIAL** | Steps 1–4 **DONE 2026-10-17** (`scripts/rehearse-api-role.js`: 20/20 privilege answers, zero `42501` as the role, row-wide UPDATE denied, residue 0, role removed); **Step 5 OWNER** (role on shared) |
| P3 | 3 — staging + production + schema-gated deploy | NOT STARTED | 6 steps; **owner-gated** (cloud accounts); needs P1 S1 |
| P3 | 4 — observability that pages someone | NOT STARTED | 6 steps; **owner gate** (monitoring account) |
| P3 | 5 — freshness gate sees real offers | **DONE** | Pure helper + tests (2026-10-17); every non-seed offer evaluated by age, SEED stays informational |

**Totals:** 21 sprints — 12 DONE, 5 PARTIAL, 4 NOT STARTED.

## Owner-gated backlog (from OG-52, mapped to sprints)

OG-52 is the register's record of "the work P0 did NOT absorb". Each item below keeps its owner;
"owner" means a human, not the agent.

| OG-52 item | Owning sprint | Owner action needed |
|---|---|---|
| P1 region/co-location move | P1 S1 Steps 4–7 | Create an EU Neon project (Frankfurt), a hosting account, deploy the API |
| P1 engine-owned loader batching | P1 S3 (blocked by P1 S4) | — (agent; needs the `catalog_version` Decision first) |
| P1 dedupe + presets | P1 S5, S6 | — **DONE 2026-10-16** (both landed; owner review of the POST contract still invited before merge) |
| P2 catalog endpoints | P2 S3 | Steps 1–6 **DONE 2026-10-17**; Step 7: decide whether catalog pages may be public |
| P2 `trustProxy` config | P2 S2 | — (agent; Steps 1–3 **DONE 2026-10-17**: the interface is a trusted-proxy address list, NOT a hop count, because fastify@5.12 disables numeric trust; Step 4 needs P1's deployed host) |
| P2 remainder of the OpenAPI snapshot surface | P2 S5 | — **DONE 2026-10-17** (the gate fails an undocumented route or a missing 429/500) |
| P2 `meta.js` `listUseCases` swap (OG-38) | P2 S1 | — **DONE 2026-10-15** (the swap landed; OG-38's behavioural half stays open) |
| P3 the `morocco_pc_api` role + column-scoped GRANTs | P3 S2 Step 5 | Apply the role to the shared DB (DDL on the only dev DB; needs a recorded restore point + the secret) — **the only residue of P0 Sprint 5**. PREPARED 2026-10-17: the guarded apply and the smoke test exist and are dry-run verified, with the owner runbook `docs/RECIPES/provision-the-api-role.md`; the human action is now two commands |
| P3 CI verification of `test:api:db` | P3 S1 Step 2 | Dispatch `recurring-gates` on `agent/platforms` |
| P3 error tracking | P3 S4 | A monitoring account + a DSN in the secret store |
| P3 staging + production | P3 S3 | Two named environments + a deploy provider account |
| P3 migration-deploy step | P3 S3 | — (agent, once the environments exist) |
| P4 H2 retailer with readable terms | — (no P4 plan file) | A real retailer; blocks all P4 real-data work |
| P4 non-seed provenance gate | P3 S5 | — **DONE 2026-10-17** (the gate covers non-seed provenance; the P4 real-data work stays open) |
| P4 Decision 7 amendment / seed retirement / read-path `ACTIVE` audit | — (no P4 plan file) | — (agent, but gated behind real data) |

## What is blocked vs. what can start now

**Blocked on an owner action (do not start; prepare the exact command):**
- *Everything down the P1 co-location chain* — P1 S2, P1 S3 (their measurement baseline is the
  co-located target), and P2 S2 Step 4's deployed-host leg.
- *P3 S3* (staging + production) needs both the cloud accounts and P1's deployment; *P3 S4* needs a
  monitoring account; *P3 S1* needs the GitHub dispatch; *P3 S2 Step 5* needs the DB password and a
  restore point.
- *P2 S3 Step 7* needs the public-exposure decision.

**Startable now, no owner action (agent work):**
- **P1 S4** — DONE 2026-10-16 (Decision 47; implemented by S5). It no longer gates anything here.
- **P3 S2 Steps 1–4** — **DONE 2026-10-17** (the role is rehearsed end to end on the TEST branch); only Step 5, the shared apply, still touches shared.
- **P3 S5** — **DONE 2026-10-17** (the gate covers non-seed provenance; no migration, no write).
- **P2 S4 and P2 S5** — **DONE 2026-10-17** (the CORS/429 proof and the OpenAPI-completeness gate; both DB-free).
- **P2 S3 Steps 1–6** — **DONE 2026-10-17** (the two read-only catalog endpoints, contract v1.5); only the owner's public-exposure decision remains.
- **P2 S2 Steps 1–3** — **DONE 2026-10-17** (configurable `trustProxy`, default off, with 14 DB-free tests); only Step 4 needs the deployed host.

## Register sync

The drift this page first exposed was corrected in `docs/OPEN_GAPS.md` on 2026-10-16: OG-52's row
now reads **OPEN (partially started)**, the P2 `listUseCases` swap it listed is marked landed (P2
Sprint 1, 2026-10-15), and the `morocco_pc_api` role names **P3 Sprint 2** as its owning sprint.
The P1 `dedupe + presets` clause landed 2026-10-16 (S5 + S6, with Decision 48 recorded); everything else OG-52 lists is still accurate.

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
