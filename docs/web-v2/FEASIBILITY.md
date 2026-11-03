# FEASIBILITY — can the API feed each element the redesign draws?

Contract: **1.10.0** (`apps/api/test/unit/openapi-v1.10.json`, generated into
`apps/web/lib/api/schema.d.ts`). Answered 2026-11-03, before any screen was touched.

Rule for reading this table: **YES** means the field is in the contract and reaches the component;
**PARTIAL** means something renders but not what the Stitch screen draws; **NO** means the data does
not exist on the read path and the screen ships reduced (recorded in `DEVIATIONS.md` at gate G2, per
the gap rule in `PLAN.md`).

| Element | Answer | Field path or gap | Evidence |
|---|---|---|---|
| usage, resolution, priority values | **YES** | `GET /v1/meta/options` → `use_cases[]`, `resolutions[]`, `priorities[]`, each `{value,label}` | `apps/web/lib/api/schema.d.ts` (`/v1/meta/options`) |
| budget min/max | **YES — client-owned** | API serves no bounds. `BUDGET_MIN = 500`, `BUDGET_MAX = 1_000_000`, log-scale snap to 2000 slider positions | `apps/web/lib/wizard/model.ts` |
| tier labels ("Meilleur rapport qualité/prix", "Le moins cher", "Le plus performant") | **YES, from strategy** | `builds[].strategy_key` ∈ `PERFORMANCE | BALANCED | VALUE`; `strategyLabel()` maps unknown/null to `OTHER`. Tiers come from strategy, **not** from `rank`, and a one-build pass has one tier | `apps/web/lib/result/model.ts` |
| price status (Vérifié / Indicatif) | **YES, but three states on screen** | `builds[].price_status` ∈ `indicative | verified`; the app derives `demo` when every component's `offer_class` is `SEED_UNVERIFIED`, and `demo` must be decided first (an all-seed pass's API status is already `indicative`) | `apps/web/lib/result/model.ts` (`priceProvenance`) |
| price verification date | **NO** | the payload carries `generated_at` only; a per-price `fetched_at` exists in the database but never leaves it | `apps/web/lib/api/schema.d.ts` (`/v1/recommendations/{id}`), `apps/web/messages/fr.json` (`result.provenance.verifiedDated`) |
| compatibility per build | **YES — two states only** | `builds[].compatibility_status`; the persistence layer accepts exactly `PASS` or `UNKNOWN` and rejects the rest, so FAIL and CONDITIONAL can never appear on a persisted build | `src/recommendation/persistence/validate-selected.js` |
| compatibility per part | **NO** | `components[]` has `role, product_id, name, slug, variant, price_used, offer_class, store_offer_id` — no compatibility field. CONDITIONAL exists only as an assembly-time note (`source_status`), never persisted per component | `apps/web/lib/api/schema.d.ts` (`builds[].components[]`), `src/recommendation/assembly/assemble.js` |
| images per build / product / preset | **NO** | `image_url` and `image_source` are declared "documentation-only for now" and the API repository never selects them; the catalog product payload has no image field either | `database/migrations/020_product_identity_and_media.sql`, `apps/api/src/repository.js` |
| retailer-level totals and links | **NO** | `components[]` carries `store_offer_id` and nothing else — no store name, no `product_url`, no per-offer price. A build total is the sum the API computed, and it cannot be attributed to a merchant | `apps/web/lib/api/schema.d.ts` (`builds[].components[]`) |
| retailer price provenance (class per line) | **YES** | `components[].offer_class` is served per component, which is what powers the three-state price badge | `apps/web/lib/result/model.ts` |
| reason lines for "Pourquoi cette configuration ?" | **PARTIAL** | `reasons[]` is **not** in contract 1.10 — no route serves Decision 44's frozen records. The committed per-build `explanation` string renders verbatim, plus the client-derived facts in `lib/result/reasons.ts` when a response happens to carry them. A GET revisit will carry fewer reasons than a fresh POST, and the module renders fewer lines rather than inventing the difference | `apps/web/lib/result/reasons.ts` |
| remaining budget | **YES — client** | `remainingBudget(total_price, budget_amount)` is implemented and tested; NULL is never treated as 0 | `apps/web/lib/result/model.ts` |
| zero-build / budget floor | **YES** | `budget_floor { cheapest_total, currency, budget_amount, within_budget, cheapest_by_role, missing_roles }` with three distinct copy states (priced / unpriced / absent) | `apps/web/lib/result/model.ts` (`zeroBuildAdvice`) |
| single build by rank | **NO** | only `builds/{rank}/swap-preview` (POST) and `builds/{rank}/swap` (POST) exist — there is no GET for one build, so D4's detail route must load the whole recommendation and select from `builds[]` | `apps/web/lib/api/schema.d.ts` (path list) |
| swap after commit | **YES** | `builds[].swapped { role, committed_at, engine_version }` marks a committed swap; the swap sheet reads it to badge the result | `apps/web/lib/api/schema.d.ts` |
| input effects (what a setting changed) | **YES** | `input_effects[] { input, effect: APPLIED | NO_EFFECT | UNKNOWN, reason }` | `apps/web/lib/api/schema.d.ts` |

## What this means for the phases

- **Five NOs gate G2**: per-part compatibility, images, retailer rows, price verification date, and
  the single-build GET. None of them blocks a screen from shipping; each one changes what the screen
  draws, and each is named in `DEVIATIONS.md` at G2 and collected in `API_REQUESTS.md`.
- **Two elements are decided by the app, not the API**: budget bounds (500…1 000 000, client) and
  remaining budget (pure function, client). Neither may move into a component as a literal.
- **One is a correction, not a gap**: the status badge is two build states plus three price states.
  A four-state compatibility vocabulary (`PASS/FAIL/UNKNOWN/CONDITIONAL`) cannot be rendered because
  three of those values cannot be persisted.

## Not verified here (deliberately)

Live database content, offer freshness and per-merchant data. Those are engine/data questions gated
elsewhere (`scripts/check-offer-provenance.js`, `scripts/check-offer-freshness.js`) and no Phase 0 task needs them:
the redesign must render whatever the contract serves, including the seed-only catalogue.
