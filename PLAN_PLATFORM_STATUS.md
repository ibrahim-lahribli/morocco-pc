# PLATFORM PROGRAM STATUS — P0–P3 roll-up

**What this page is:** the single answer to "what is left". It rolls up the 21 sprints of
`PLAN_PLATFORM_P0.md` … `PLAN_PLATFORM_P3.md` and the owner-gated backlog registered in
`docs/OPEN_GAPS.md` **OG-52**, so the state can be read here instead of reconstructed from four
plans. The plans own the HOW; the register owns the open-item ledger; this page owns the
where-are-we.

**Date:** 2026-10-19, **revised 2026-10-26** for contract v1.10.0, then **revised 2026-10-29** for the 023 shared/EU applies and the Render demo origin (all three ledgers now 23) · **Branch:** `master` (PR #3 merged `agent/platforms` as `b2fe64a`) · **Rules:** [PLAN_PLATFORM_CONSTRAINTS.md](PLAN_PLATFORM_CONSTRAINTS.md).
Passing-test counts are deliberately not restated here — see the dated entries in
`DEVELOPMENT_NOTES.md`.

## Verdict

**16 sprints done, 3 partial, 2 not started. PR #3 landed `agent/platforms` on `master` as `b2fe64a` on 2026-10-18, with identical content on both sides, so what remains is owner actions rather than agent work.**
**The recurring gates now run from the default branch, and the verdict is measured: `unit-and-docs` is green on `master`, and the one red step — `verify-migrations-replay` — was closed at its cause on 2026-10-19.** That red was never code: the replay diffed a 22-file tree against a shared database at ledger 20 and reported the 021/022 objects as fresh-only. The owner-approved apply (restore point `br-ancient-cake-axh57vpj`, ledger 20 -> 22) makes the same command report **0 drift**, and dispatch run [39207745723](https://github.com/ibrahim-lahribli/morocco-pc/actions/runs/39207745723) on `master` (`3f0c166`) is the first **wholly green** `recurring-gates` — every step PASS, `unit-and-docs` included. **P1 Sprint 3**'s statement-count half is still measurable on the TEST branch (only its latency table waits for the co-located target). The BETA engine and API surface are live, with schema at ledger **23** on all three databases since 2026-10-29 (branch, shared and EU) and the `morocco_pc_api` role provisioned on shared and EU. **A demo origin is deployed; nothing is in production.** `https://morocco-pc.onrender.com` (Render Free, 2026-10-28) runs this API against the shared database, answers `/v1/health` with `db:"ok"`, and has served the recommendation and the committed-swap verbs since the 023 apply; it spins down after 15 idle minutes, so it is a demo origin for wiring and smoke checks, never the launch path and never a source of latency numbers. That contract is now **v1.10.0** (2026-10-26, Decision 56) with **ten** paths: the product **price history** (`GET /v1/catalog/products/:slug/price-history`, one point per observation MOMENT, oldest first — v1.6, and no migration needed because `price_history` dates from 009), the read-only **swap preview** (v1.8, Decision 55) and the append-only **swap commit** (v1.10, Decision 56) all belong to it, `apps/web`'s S25 price-history section and S24's swap panel consume them, and the pin is `apps/api/test/unit/openapi-v1.10.json`. The unblocking ladder: **P1 Sprint 1** (the EU project + deploy) unblocks the latency sprints and the deployed-host legs; **P1 Sprint 4** (DONE 2026-10-16) unblocked P1 Sprints 5–6 (both DONE 2026-10-16), and P2 Sprint 3 landed 2026-10-17 (Step 7 decided 2026-10-18: public but unlisted); **P3 Sprint 1** is now DONE because the nightly fires from `master` and its per-step result is recorded.

**Web frontend (outside the 21 sprints, recorded here because it shares the deployment gate).**
`apps/web` has 26 of its 27 sprints done and its host is now DECIDED - **Cloudflare Workers** through
the OpenNext adapter, recorded 2026-10-23 in `docs/plans/agent3-web-plan.md` §1/§5/§7 and as
**OG-53**: `apps/web/wrangler.jsonc` (worker `morocco-pc-web`, `main: .open-next/worker.js`, assets
binding `ASSETS`, `NEXT_INC_CACHE_KV`), `apps/web/open-next.config.ts` (KV incremental cache - the
config's own note records R2 as unavailable on this account without a payment method), and `@opennextjs/cloudflare` +
`wrangler` as devDependencies, all committed. The decision closes the host question and NOTHING else:
no Workers environment is deployed, no web workflow step deploys, and the web app has never called a
deployed API, so web S26's staging legs wait on the same owner-gated deploy as P1 Sprint 1's Steps
7-9, and V1 (POST latency) **remains open**, though its DB-side input is now measured: from GitHub Actions the round trip to Neon is ~56 ms and a 49-statement pass pays ~2.7 s before the engine does any work (commit [644804d](https://github.com/ibrahim-lahribli/morocco-pc/actions/runs/39936779287), dispatch run [39936779287](https://github.com/ibrahim-lahribli/morocco-pc/actions/runs/39936779287)); `trustProxy` Step 4 and Sentry Steps 3-6 remain unmeasured for the same
reason.

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
| P2 | 3 — catalog endpoints (read-only) | **DONE** | Steps 1–6 **DONE 2026-10-17** (two read endpoints, keyset pagination on `slug`, provenance-labelled prices, contract v1.5, superseded by v1.6 on 2026-10-23; `test:api` 98/0, `test:api:db` 9/0 with a 100-row page walk); Step 7 **DECIDED 2026-10-18**: public but unlisted, noindex until prices are VERIFIED, indicative prices behind the disclaimer |
| P2 | 4 — CORS allow-list + 429 contract, proven | **DONE** | 4 CORS tests + the 429 body/`Retry-After` pin, both documented (2026-10-17); `test:api` 75/0 |
| P2 | 5 — contract-completeness gate | **DONE** | `openapi-coverage.test.js` (7 tests); the gate exposed missing 429/500 on all five routes, now declared; snapshot regenerated (2026-10-17) |
| P3 | 1 — prove the recurring CI job | **DONE** | Steps 1–3 **DONE 2026-10-18**: two `workflow_dispatch` runs on `agent/platforms` ([39119596060](https://github.com/ibrahim-lahribli/morocco-pc/actions/runs/39119596060), [39120485573](https://github.com/ibrahim-lahribli/morocco-pc/actions/runs/39120485573)) — `test:api:db` **9 passed / 0 failed on the runner**; the replay was RED only on the branch-only 021/022 objects. **Step 4 DONE 2026-10-19**: PR #3 merged the branch into `master` as `b2fe64a`; the push run is green, and dispatch run [39123812237](https://github.com/ibrahim-lahribli/morocco-pc/actions/runs/39123812237) on `master` fails ONLY at `verify-migrations-replay` (freshness PASS, `test:api:db` PASS, `unit-and-docs` PASS). The remaining red was the shared database sitting at ledger 20 — **CLOSED 2026-10-19** by the shared apply (see the P3 S2 row), not a sprint step. **PROVEN GREEN 2026-10-19**: dispatch run [39207745723](https://github.com/ibrahim-lahribli/morocco-pc/actions/runs/39207745723) completed success with every `recurring-gates` step PASS. Steps 5–6 recorded in `DEVELOPMENT_NOTES.md` 2026-10-19 |
| P3 | 2 — rehearse the production DB role | **DONE** | Steps 1–4 **DONE 2026-10-17** (rehearsal: 20/20 privilege answers, zero `42501` as the role, row-wide UPDATE denied, residue 0, role removed); **Step 5 DONE 2026-10-19 on shared and 2026-10-23 on EU** — shared from restore point `br-ancient-cake-axh57vpj` (audit target `db:54ff6ea3f6e6`), EU from `br-late-rice-b906upai` (audit target `db:2d66f26d7ddc`), 8 statements and self-check 20/20 on each, both smoke runs green (`health db:"ok"`, POST 201 with 1 build, residue 0). Both owner scripts take `--target-env=<NAME>`; TEST keeps the create-and-drop rehearsal by design. Residual: the EU host's secret still carries the owner's credentials (OG-54) |
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
| P3 the `morocco_pc_api` role + column-scoped GRANTs | P3 S2 Step 5 | **DONE 2026-10-19** — applied to shared from restore point `br-ancient-cake-axh57vpj` (audit target `db:54ff6ea3f6e6`), self-check 20/20, `smoke-api-role.js --confirm-shared` green with residue 0. **Re-granted to the full 21-answer contract on BOTH databases 2026-10-29** (`GRANT INSERT ON recommendation_swap` from restore points `br-silent-cake-ax5q21at` / `br-bitter-sky-b96jh91p`, self-check 21/21 each, smoke green as the role on both), so the role now matches the schema it sits on. **The last residue of P0 Sprint 5 is closed** |
| P3 CI verification of `test:api:db` | P3 S1 Step 2 | **DONE 2026-10-18, PROVEN ON MASTER 2026-10-19** — dispatched on `agent/platforms`; `test:api:db` answered 9/0 on the runner. PR #3 then merged the branch into `master` as `b2fe64a`; the push run is green and dispatch run 39123812237 has `unit-and-docs` and `test:api:db` passing with `recurring-gates` failing only at the replay — that red **closed 2026-10-19** with the shared apply above, not a CI gap |
| P3 error tracking | P3 S4 | **CODE LANDED 2026-10-19, DELIVERY OWNER-GATED**: the DSN-gated capture is wired and unit-tested; a monitoring account + a DSN in the secret store are still what turns it from wired into proven (Step 3) |
| P3 staging + production | P3 S3 | Two named environments + a deploy provider account |
| P3 migration-deploy step | P3 S3 | — (agent, once the environments exist) |
| P4 H2 retailer with readable terms | — (no P4 plan file) | A real retailer; blocks all P4 real-data work |
| P4 non-seed provenance gate | P3 S5 | — **DONE 2026-10-17** (the gate covers non-seed provenance; the P4 real-data work stays open) |
| P4 offer provenance (the evidence half) | P3 S5 | **GATE LANDED 2026-10-23** — `scripts/check-offer-provenance.js` (`--target=env:NAME`) classifies every offer by retailer evidence (ingestion record, listing id, URL on the store's own host, seller, observation time) and prints INCONCLUSIVE — never PASS — when no non-seed offer exists. Measured INCONCLUSIVE on shared, TEST and EU: 101 seed offers, 0 verified. The freshness gate now says INCONCLUSIVE for the same population. Real offers still need a retailer (OG-19 / OG-37 / OG-54) |
| P4 Decision 7 amendment / seed retirement / read-path `ACTIVE` audit | — (no P4 plan file) | — (agent, but gated behind real data) |

## What is blocked vs. what can start now

**Blocked on an owner action (do not start; prepare the exact command):**
- *The latency half of the P1 chain* — P1 S3's before/after ms table and P2 S2 Step 4's deployed-host leg.
  Their statement counts are measurable on the TEST branch; the ms table is not.
- *P3 S3* (staging + production) needs both the cloud accounts and P1's deployment; *P3 S4* needs a
  monitoring account. *P3 S2 Step 5* and the `verify-migrations-replay` red are DONE 2026-10-19
  (shared ledger 22 + the production role), and *P3 S1* is merged and measured on `master`.

**The LAUNCH host itself is still unchosen, and that is the root of every item above.** A Render Free demo origin now exists (2026-10-28: `https://morocco-pc.onrender.com`, serving the shared database and answering both recommendation verbs since the 023 apply), but it spins down after 15 idle minutes — it can carry wiring and smoke checks and cannot carry the always-on measurement requirement. P1 S1 Steps 7-9 need
a hosting account, and `fly.toml` is written for Fly.io, which is a PAID service - so the committed
config is a candidate, not a decision. Two constraints bound the choice, both already in the runbook:
the API needs the repository root as its Docker context (`apps/api/Dockerfile` imports the engine),
and the latency sprints need an ALWAYS-ON instance - `fly.toml` sets `min_machines_running = 1`
precisely because a machine that sleeps makes p95 meaningless, which rules out the free sleeping tiers
(Render free spins down after 15 minutes) for the MEASUREMENT even though it is fine for development.
§12 of the runbook (Render) is the documented non-Fly fallback; a free-tier survey was done 2026-10-19
but the choice stays the owner's, so no host is written into this page as decided.
**Startable now, no owner action (agent work):**
- **P1 S4** — DONE 2026-10-16 (Decision 47; implemented by S5). It no longer gates anything here.
- **P1 S3** — its statement-count half is agent work against the TEST branch (as P1 S2's was); the latency table waits for P1 S1.
- **P3 S2** — **DONE 2026-10-19** (Steps 1–4 rehearsed on the TEST branch 2026-10-17; Step 5, the shared apply, ran 2026-10-19).
- **P3 S5** — **DONE 2026-10-17** (the gate covers non-seed provenance; no migration, no write).
- **P2 S4 and P2 S5** — **DONE 2026-10-17** (the CORS/429 proof and the OpenAPI-completeness gate; both DB-free).
- **P2 S3** — **DONE 2026-10-18** (the two read-only catalog endpoints, contract v1.5 at the time, plus Step 7's public-but-unlisted decision); the contract they belong to is v1.10.0 since 2026-10-26.
- **P2 S2 Steps 1–3** — **DONE 2026-10-17** (configurable `trustProxy`, default off, with 14 DB-free tests); only Step 4 needs the deployed host.

## The frontend track (merged on this branch since 2026-10-21)

`apps/web/` is part of this tree — sprint S1-S27 of `docs/plans/agent3-web-sprints.md`, 26 done and S26
blocked on a deployment — in its own package with its own lockfile and `.github/workflows/web.yml`. It
consumes this API through types generated from `apps/api/test/unit/openapi-v1.10.json`, with
`check:api-types` as the drift gate; measured 2026-10-26 the Playwright suite is 378 specs (376 passed /
2 skipped on a fresh build), `e2e/swap.spec.ts` carrying 10 of them.

What the web app still needs from this side is ONE owner action and three facts:

- **A deployed origin** (P1 Sprint 1 Steps 7-9) — without it there is nothing for the web app to point
  at, `ALLOWED_ORIGINS` cannot name a real origin (P2 Sprint 2 Step 4), and web S26's staging legs
  cannot run. The host is DECIDED (Cloudflare Workers via the OpenNext adapter, 2026-10-23, OG-53);
  no web environment is deployed. The **API** does have a live origin — `https://morocco-pc.onrender.com`
  (Render Free, deployed 2026-10-28, able to answer a full pass only after 023 reached shared on
  2026-10-29) — but it is an acceptance sandbox, not a
  launch origin: Free spins down, so it cannot carry latency measurement or S26's staging legs.
- **Catalogue exposure** — public but unlisted, `noindex` until prices are `VERIFIED` (P2 Sprint 3
  Step 7). The list response carries `offer_class` per product but NO `disclaimer` field, so a price
  grid built from it must render the disclaimer itself.
- **CORS is proven, DB-free** (2026-10-19): an allow-listed origin gets `ACAO` echoed on both the
  preflight (204) and the served POST (201), a non-listed origin is served without `ACAO`, and an
  invalid body answers 422 `VALIDATION_ERROR` with a per-field `details` array. The served document is
  3.0.3 / `info.version` **1.10.0** with exactly **ten** paths.
- **A write target that is not the TEST branch** — the Neon `frontend-dev` branch
  (`br-proud-frog-ax80h3nv`) plus the gitignored `.env.frontend-dev`, because every distinct POST
  leaves an unmarked `recommendation_query` row and `eval:scenarios` refuses to run while one
  exists.

The Tailwind defect that used to be listed here is **SUPERSEDED (2026-10-20, measured)**: the
committed scaffold ships `postcss.config.mjs` registering `@tailwindcss/postcss`, and `next build`
emits real Tailwind utilities (`text-2xl`, `mx-auto`, `sr-only`) with no CSS warning, while lint,
typecheck and the 3 Playwright specs pass. The old claim (no PostCSS or Turbopack integration
wired, so `@theme` is never processed) described an uncommitted working tree, not the branch. The
frontend's real open items are the DEPLOYMENT of its decided host and the swap surface, which has
landed on both halves (Decision 55's preview 2026-10-25, Decision 56's append-only commit 2026-10-26).

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
