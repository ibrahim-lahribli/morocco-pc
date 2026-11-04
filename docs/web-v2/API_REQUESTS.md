# API_REQUESTS — what the redesign needs and the contract cannot serve

Scope: `apps/web` only. Nothing here is a request to change `apps/api`, `database/` or `src/` in this
programme — it is the list of what a future API change would have to add for the screens to draw what
Stitch draws. Every row is answered twice: the reduced behaviour that ships now, and the field/route
that would close it.

Status of every row: **OPEN** (no API change proposed yet). The table is the index, in priority
order: **P1** = price observation date, `reasons[]` on a revisit; **P2** = per-part
compatibility; **P3** = images, retailer rows, single-build GET.

| # | Gap | Priority | Status |
|---|---|---|---|
| 4 | Price verification date | **P1** | OPEN |
| 6 | `reasons[]` on a revisit | **P1** | OPEN |
| 1 | Per-part compatibility | **P2** | OPEN |
| 2 | Product / build images | **P3** | OPEN |
| 3 | Retailer rows | **P3** | OPEN |
| 5 | Single-build GET | **P3** | OPEN |

## 1. Per-part compatibility — `components[].compatibility_status`

- **Needed by:** build detail (D4), part rows, the swap sheet's verdicts.
- **Contract gap:** `components[]` carries no compatibility field. Builds persist only `PASS` or
  `UNKNOWN` (`src/recommendation/persistence/validate-selected.js`), and CONDITIONAL exists only as an
  assembly-time note that never reaches `build_component`.
- **Ships now:** one build-level badge; part rows show specs and price only. The swap sheet keeps its
  existing per-swap verdicts (those come from `swap-preview`, not from the result payload).
- **Would close it:** `components[].compatibility_status` + a persisted per-component note, or a
  `GET /v1/recommendations/{id}/builds/{rank}` that returns verdicts alongside the build.

## 2. Product / build images — `image_url`, `image_source`, licence

- **Needed by:** build cards, part rows, component detail, preset pages.
- **Contract gap:** migration 020 added `image_url` / `image_source` as "documentation-only for now";
  `apps/api/src/repository.js` never selects them, and the catalog payload has no image field.
- **Ships now:** a drawn fallback per role + category (D1). No `next/image` source exists, so the
  fallback is the only rendering path and it must be present in every slot.
- **Would close it:** serve `display_name`-adjacent media from the catalog response, plus
  `image_licence_note` so the app can attribute what it shows.

## 3. Retailer rows — store name, offer URL, per-offer price, verification date

- **Needed by:** "Où acheter" (D3), retailer rows, per-merchant totals.
- **Contract gap:** `components[]` carries `store_offer_id` only. No merchant name, no URL, no
  per-offer price, and no `fetched_at`. The offer-provenance machinery exists in the database
  (`build_component_offer_provenance`, migration 018) but is not on the read path.
- **Ships now:** price status + disclaimer + the build total; no merchant rows, no outbound links.
- **Would close it:** `components[].offers[] { store_name, product_url, price, fetched_at,
  offer_class }`, plus a build-level merchant summary if the UI is to show "from N stores".

## 4. Price verification date

- **Needed by:** the "Vérifié · calculé le {date}" line and any freshness note.
- **Contract gap:** the payload has `generated_at` (when the pass ran), not when a price was observed.
- **Ships now:** the existing line, which dates the computation. It must not be relabelled as a
  verification date — that would claim a fact the payload does not carry.
- **Would close it:** `components[].price_observed_at` (or the `offers[]` field above).

## 5. Single-build GET

- **Needed by:** D4's detail route, and share links that open one build directly.
- **Contract gap:** only `POST .../swap-preview` and `POST .../swap` exist under `builds/{rank}`.
- **Ships now:** the detail page reads `GET /v1/recommendations/{id}` (no-store for a fresh pass,
  revalidated for a static one) and selects by `rank`; an unknown rank is `notFound()`. Cost: the
  whole pass is fetched for one build.
- **Would close it:** `GET /v1/recommendations/{id}/builds/{rank}` returning the same build shape,
  which also lets the OG card for a build be generated without the full payload.

## 6. Build reasons on a revisit — `builds[].reasons[]` (PARTIAL)

- **Needed by:** the "pourquoi ce choix" disclosure on a result page (S13), and most of all on a
  pass opened from a saved build or a share link, where the submit response is not in hand.
- **Contract gap:** `reasons[]` is not in contract 1.10. Decision 44's `deriveReasons()` returns
  frozen `{ code, value }` records in a fixed order in the engine, but no route serialises them and
  the OpenAPI document names no such field. Item 5 of that decision adds that only
  `BUDGET_USED_PCT`, `GPU_SHARE` and `INPUT_APPLIED` are derivable from persisted rows, so even a
  route that served them would serve a SUBSET on a GET revisit — the other five need facts the
  engine holds at the seam.
- **Ships now:** PARTIAL by construction. No response carries reasons, so the page renders the
  committed `explanation`; a pass read back from `GET /v1/recommendations/{id}` would render the
  same or fewer lines, never more. `lib/result/reasons.ts` renders only what it is given and never
  invents a fact, which is why the reduction is a missing line rather than a wrong one.
- **Would close it:** serialise `reasons[]` on the POST response and on the GET read, and persist
  the derivable subset with the build, so a revisit states at least those three facts.

## Deliberately NOT requested

- **Auth / accounts.** D2 removes the bell and avatar; there is no authentication anywhere in the tree
  and the redesign does not add one.
- **Dark mode.** D6 is deferred; a dark palette is a token exercise (and a contrast pass over the
  amber CTA), not an API surface.
- **Wishlist / saved builds server-side.** Saved builds stay in `localStorage`
  (`apps/web/lib/saved/builds.ts`) by design — no account, no cookie, stated on the page itself.
