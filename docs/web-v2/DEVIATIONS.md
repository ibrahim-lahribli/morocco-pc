# DEVIATIONS — where the build departs from DESIGN.md, and why

One row per deliberate difference. A row is required whenever accessibility, the contract, or a
measured budget overrides the design file. Gate G2 answers the four FEASIBILITY NOs here as well.

| id | Area | DESIGN.md says | We ship | Why |
|---|---|---|---|---|
| D-01 | Colour | amber `#F59E0B` as a CTA (secondary accent) | amber **fill with ink text**; white-on-amber forbidden | `#FFFFFF` on `#F59E0B` measures **2.15:1** (fails AA at any size). `#0B1C30` on it measures **8.00:1** (AAA). |
| D-02 | Colour | `#10B981` as the success/tertiary colour | `#10B981` for **fills and icons only**; success text is `#15803D` | `#10B981` as text measures **2.54:1** on white and **2.41:1** on its own tint. `#15803D` on `#DCFCE7` is 4.57:1. |
| D-03 | Colour | neutral `#64748B` for secondary body text | `text-muted` is `#475569`; `#64748B` only for placeholders | 4.55:1 is a bare AA pass (one rounding from failing) across 105 `text-muted` usages. 7.24:1 holds up at 360 px on a phone in daylight. |
| D-04 | Type | headline scale 28 / 22 / 18 | keeps 24 / 20 / 18 this phase; sizes move per screen in Phase 4 | Phase 1 changes VALUES only. A global scale change reflows every unpreviewed screen at once, and the LCP budget has 18 ms of headroom. Phase 4 applies the design's sizes with a screenshot diff per screen. |
| D-05 | Type | Arabic line-heights +10 % | not yet applied | Applying it now shifts every RTL screen before its redesign, with no per-screen reference. Lands in Phase 2 with the type ramp, verified against `e2e/rtl.spec.ts`. |
| D-06 | Shape | cards 16 px radius | 12 px (`--radius-card`) | The shipped kit is 12 px; raising it is a kit-wide change, so it belongs to the Phase 2 restyle, not a token value. |
| D-07 | Layout | container max-width 1280 px | 1200 px | The redesign's results grid reads better at 1200; recorded here per the v5 decision D5. Phase 5 owns it. |
| D-08 | Images | component/build photography | drawn fallback per role + category | No image reaches the API: `image_url`/`image_source` are documentation-only in migration 020 and `apps/api/src/repository.js` never selects them. See `FEASIBILITY.md`. |
| D-09 | Detail route | one screen per build | `/{locale}/config/{id}/{rank}` built from `builds[]` | No single-build GET exists in contract 1.10; the page loads the pass and selects by rank, `notFound()` otherwise. See `API_REQUESTS.md` §5. |
| D-10 | Retailers | "Où acheter" with merchant rows | price status + disclaimer only | `components[]` carries `store_offer_id` and no merchant name, URL or per-offer price (`API_REQUESTS.md` §3). |
| D-11 | Compatibility | per-part verdicts | one build-level badge (`PASS`/`UNKNOWN`) | Per-part compatibility is not persisted or served; `CONDITIONAL` exists only as an assembly-time note (`API_REQUESTS.md` §1). |

## Pending at gate G2 (Phase 2)

- D-08, D-09, D-10, D-11 above become screen-level reductions where they apply.
- The kit's added client JS must be measured against **174 080 B**; the preset route currently has
  **6 973 B** of slack.
- `configurateur_tape_2` has no Stitch reference (never drawn) — it inherits steps 1/3/4.
