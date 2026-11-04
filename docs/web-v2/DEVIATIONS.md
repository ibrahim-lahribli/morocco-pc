# DEVIATIONS — where the build departs from DESIGN.md, and why

One row per deliberate difference. A row is required whenever accessibility, the contract, or a
measured budget overrides the design file. Gate G2 answers the four FEASIBILITY NOs here as well.

| id | Area | DESIGN.md says | We ship | Why |
|---|---|---|---|---|
| D-01 | Colour | amber `#F59E0B` as a CTA (secondary accent) | amber **fill with ink text**; white-on-amber forbidden | `#FFFFFF` on `#F59E0B` measures **2.15:1** (fails AA at any size). `#0B1C30` on it measures **8.00:1** (AAA). |
| D-02 | Colour | `#10B981` as the success/tertiary colour | `#10B981` for **fills and icons only**; success text is `#047857` (`--color-success`) | `#10B981` as text measures **2.54:1** on white and **2.41:1** on its own tint. `#047857` on its soft tint `#ECFDF5` measures **5.21:1**. |
| D-03 | Colour | neutral `#64748B` for secondary body text | `text-muted` is `#475569`; `#64748B` only for placeholders | 4.55:1 is a bare AA pass (one rounding from failing) across 105 `text-muted` usages. 7.24:1 holds up at 360 px on a phone in daylight. |
| D-04 | Type | headline scale 28 / 22 / 18 | keeps 24 / 20 / 18 this phase; sizes move per screen in Phase 4 | Phase 1 changes VALUES only. A global scale change reflows every unpreviewed screen at once, and the LCP budget has 18 ms of headroom. Phase 4 applies the design's sizes with a screenshot diff per screen. |
| D-05 | Type | Arabic line-heights +10 % | not yet applied | Applying it now shifts every RTL screen before its redesign, with no per-screen reference. Lands in Phase 2 with the type ramp, verified against `e2e/rtl.spec.ts`. |
| D-06 | Shape | cards 16 px radius | 12 px (`--radius-card`) | The shipped kit is 12 px; raising it is a kit-wide change, so it belongs to the Phase 2 restyle, not a token value. |
| D-07 | Layout | container max-width 1280 px | 1200 px | The redesign's results grid reads better at 1200; recorded here per the v5 decision D5. Phase 5 owns it. |
| D-08 | Images | component/build photography | drawn fallback per role + category | No image reaches the API: `image_url`/`image_source` are documentation-only in migration 020 and `apps/api/src/repository.js` never selects them. See `FEASIBILITY.md`. |
| D-09 | Detail route | one screen per build | `/{locale}/config/{id}/{rank}` built from `builds[]` | No single-build GET exists in contract 1.10; the page loads the pass and selects by rank, `notFound()` otherwise. See `API_REQUESTS.md` §5. |
| D-10 | Retailers | "Où acheter" with merchant rows | price status + disclaimer only | `components[]` carries `store_offer_id` and no merchant name, URL or per-offer price (`API_REQUESTS.md` §3). |
| D-11 | Compatibility | per-part verdicts | one build-level badge (`PASS`/`UNKNOWN`) | Per-part compatibility is not persisted or served; `CONDITIONAL` exists only as an assembly-time note (`API_REQUESTS.md` §1). |
| D-12 | Naming | ramp `surface` = `#F8F9FF` | app `surface` = card white (`#FFFFFF`); the ramp value is `background` | 96 existing `bg-surface` usages mean "card". Renaming them for a token whose value equals `background` buys nothing, and both design values stay addressable. |
| D-13 | Colour | prose amber/emerald used as text backgrounds | amber carries `on-surface` (8.00:1); emerald is fill/icon only; text uses the ramp's `on-*-container` pairs (4.54/4.60:1) | The design supplies its own accessible pairings; using them is adopting the design, not departing from it. |
| D-14 | Shell | header carries a notification bell and an account avatar | neither is rendered | There is no authentication (D2) and no notification source in contract 1.10, so both would be controls that can never do anything. Owner decision 2026-11-03: a bell that never rings is worse than no bell. Revisit only with auth, not with a disabled icon. |
| D-15 | Kit | one barrel (`@/components/ui`) is the import path for every primitive | the eight Phase 2 primitives are imported from their own module (`@/components/ui/bottom-tab-bar`, `…/sticky-bar`, `…/part-row`, `…/retailer-row`, `…/snap-row`, `…/trust-item`, `…/build-summary-card`, `…/explainer-sheet`) | **Measured, not assumed.** Adding four exports (`StatusBadge`, `StepHeader`, `ChoicePills`, `BudgetPicker`) to the barrel cost **1 410 B of compressed script on BOTH Lighthouse fixtures** — routes that never render any of them: 190 434 → 189 024 B and 189 557 → 188 147 B, with one shared chunk 9 733 → 8 323 B (A/B rebuild, 2026-11-03). Turbopack does not tree-shake a re-export barrel reliably, and the preset route's whole margin was 3 568 B. `Sheet` was already outside the barrel for a contract reason; it is now the rule for everything the redesign adds. |
| D-16 | Results card | the whole card is one link | the card is an `<article>`; the CTA inside it is the link | A save control inside a card-wide link is invalid HTML and gives assistive tech a button nested in a link. The card's clickable area shrinks; the target that remains is the one with words on it. |
| D-17 | Price date | "prix constatés le 12/10" — a per-offer observation date | the pass's `generated_at`, labelled "calculé le", and ONLY beside `verified` | The contract carries no per-offer observed date (CD-6): `components[]` has a price and a `store_offer_id`, nothing about when anyone looked. A date beside an indicative or demo price would claim a survey that never happened. |
| D-18 | Wizard | a drawn reference for each of the four steps | step 2 (`configurateur_tape_2`) was never drawn; it inherits the kit of steps 1/3/4 | The Stitch set has 22 screens and no step-2 art (`SCREENS.md` records it). Inventing one would be design work disguised as implementation; the step is judged against `/kit`, like every route Stitch never drew. |
| D-19 | Kit name | PLAN.md's T6 names this primitive `BuildCard` | shipped as `BuildSummaryCard` (`components/ui/build-summary-card.tsx`) | `components/result/build-card.tsx` already owns that name as the results SCREEN's card; two `build-card.tsx` files would be indistinguishable in an import or a stack trace. Phase 4 decides which of the two survives, and the kit's name says what it is until then. |
| D-20 | Tab bar copy | five cells read "Accueil / Composants / Configurer / Guides / Enregistrements" | "Accueil / **Pièces** / Configurer / Guides / **Gardés**" | Five labels share 360 px, so PLAN.md's own tab-bar rule asks for short keys; the long names stay in the header, the footer and each page's h1. "Pièces" is the shorter true word for the catalogue, "Gardés" for the shelf. Copy only — the destinations and the icons are the design's. Re-check on a real phone before Phase 5 closes. |

## Answered at gate G2 (Phase 2)

The five FEASIBILITY NOs are rows now, not open questions: images **D-08** (a drawn fallback,
never a stock photo of different hardware), the single-build GET **D-09**, retailer rows **D-10**
(reduced to price provenance, because no merchant is served), per-part compatibility **D-11**
(one build-level badge), and the price observation date **D-17**. The undrawn wizard step is
**D-18**.

Two further kit decisions came out of building the primitives, one measured and one forced by
HTML: **D-15** keeps the new primitives out of the barrel (1 410 B on routes that never render
them), and **D-16** makes the results card's CTA the link instead of the card.

The kit's script cost is measured on both fixtures rather than inferred — see the G2 table in
`PROGRESS.md`. The preset route is still the binding one.

## Resolved by the owner decision of 2026-11-03 (DESIGN.md in full)

D-03, D-04, D-05 and D-06 are **closed**: the full palette, the full type scale and the Arabic +10 %
leading now ship, so those rows describe a state that no longer exists and are kept as history. What
remains: the two accessibility overrides (D-01, D-02), the naming reconciliation (D-12, D-13), and the
API-driven reductions (D-08 to D-11).

Measured cost of the full adoption: the stylesheet grows 73 169 -> **89 663 B**, and the two Lighthouse
fixtures moved from LCP medians 2 482/2 486 to **2 485/2 488 ms** (budget 2 500). The margin is now
~12 ms, so anything later that adds above-the-fold weight must re-measure before it lands.
