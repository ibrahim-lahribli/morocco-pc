# Web redesign plan — v5 (in-place, mobile-first, corrected against the tree)

Status: **approved for Phase 0**. Branch `web-redesign`; phase PRs merge into it; `master` only at release.
Supersedes: v4 (the plan reviewed on 2026-11-03). Every correction cites the file that decided it.

Design source: 22 Stitch screen directories (`code.html` + `screen.png`) + `DESIGN.md`, currently
untracked at `apps/web-v2/stitch_morocco_pc_builder_app/`. Phase 0 Task 1 moves them to
`apps/web/design/stitch/`.

Doc home: `docs/web-v2/` (this file, `PROGRESS.md`, `DEVIATIONS.md`, `FEASIBILITY.md`,
`API_REQUESTS.md`, `SCREENS.md`). The v4 plan proposed `docs/web-redesign/`; that would have
duplicated the existing `docs/web-v2/PHASE0_AUDIT.md`. One home.

## What v4 got wrong (the six amendments)

| # | v4 said | The tree says | v5 |
|---|---|---|---|
| A1 | "Fonts via next/font (Latin + Arabic)" | The Arabic face is vendored on purpose, with `@font-face` + `unicode-range` + locale-conditional preload, because `next/font` put 136 KB of unused Arabic on every `/fr` (206 KB of fonts total). Inter is already `next/font`. | Keep the vendored Arabic face untouched. `next/font` only for a NEW Latin face, and only if it pays for itself. `app/globals.css`, `app/[locale]/layout.tsx:2,39` |
| A2 | Add radix, cva, clsx, tailwind-merge, lucide-react, vitest, testing-library | `components/ui/cn.ts` is deliberately not a tailwind-merge clone (its header says so); `components/ui/icons.tsx` is a bespoke six-glyph set. `npm test` IS Playwright; there is no unit runner and `web.yml` has no test:unit step. | Add **radix dialog** + **cva** only. Keep `cn` and `icons.tsx`. Add `test:unit` (vitest) **and** its `web.yml` step in the same task, or do not add vitest at all. |
| A3 | StatusBadge: Vérifié/Indicatif + `PASS/FAIL/UNKNOWN/CONDITIONAL` | Builds persist as exactly `PASS` or `UNKNOWN` (`validate-selected.js:150` rejects the rest); the price badge already ships **three** states, `demo`/`indicative`/`verified`, with `demo` decided first because an all-SEED build's API status is `indicative`. | Build badge: `PASS` / `UNKNOWN`. Price badge: three states, unchanged. Per-part compat does not exist → `API_REQUESTS.md`. |
| A4 | Phase 6: "LCP ≤ 2.5 s, CLS ≤ 0.1" | `lighthouserc.cjs` enforces four `error` assertions, median of 3 runs, on TWO URLs (result + preset): LCP 2500, CLS 0.1, **script 174 080 B**, **performance ≥ 0.90**. | All four, both URLs. Every added dependency that ships to those routes is measured against 174 080 B before G2. |
| A5 | Phase 0: "verify how price-history.tsx gets its data" | Answered: server component; the page calls `loadPriceHistory(slug)` → `/v1/catalog/products/{slug}/price-history`, revalidated, with a timeout. | Removed from the open list. |
| A6 | "Do not change `lib/` logic" | D7 (Arabic "DH") lives in `lib/i18n/format.ts`, whose own header says the Arabic label is a copy decision belonging in that map. | Replace the blanket rule with an allowlist: `lib/` edits only in a named file, listed in `DEVIATIONS.md` with a one-line reason. |

Also added (missing tasks the v4 plan assumed away): Playwright viewport projects, a `viewport`
export for `viewport-fit=cover` (none exists today), `HEX_EXEMPT` when a third OG card appears,
the named deploy flow, `apps/web/AGENTS.md` + `docs/TEST_MAP.md` in "read first", and a per-screen
rule for an unclosed gap.

## Decisions D1–D8 (resolved from evidence, not preference)

| D | v4 left open | v5 |
|---|---|---|
| D1 build images | "source or illustrated fallback" | **Illustrated fallback only.** No image reaches the API: migration 020 marks `image_url`/`image_source` "documentation-only for now" and `apps/api/src/repository.js` never selects them; the catalog payload has no image field. Every slot renders a drawn fallback keyed by role + category. Real images are an API request, not a web task. |
| D2 bell/avatar | remove | **Removed.** No auth anywhere in the tree. |
| D3 "Où acheter" | kept or reduced | **Reduced.** Components carry `store_offer_id` only — no store name, URL, or per-offer price. The detail screen shows price status + disclaimer + per-part price; retailer rows are deferred to `API_REQUESTS.md`. |
| D4 detail route | decide | **`/{locale}/config/[id]/[rank]` exists**, with rules: rank resolved from `builds[]` (no single-build endpoint exists; only `swap-preview`/`swap`), unknown rank ⇒ `notFound()`, inherits the parent's permanent `noindex`, never enters `sitemap.ts`, no OG card. |
| D5 desktop | generate Stitch desktop or build from rules | **Build from the Phase 5 rules.** No desktop Stitch exists; content max-width **1200 px** (the DESIGN.md 1280 px container is a deviation, logged). |
| D6 dark mode | — | **Deferred.** The token set is light-only; a dark theme needs a contrast pass over the amber CTA and the pale-green buttons, which is its own review. |
| D7 Arabic "DH" | — | **`د.م.` in Arabic**, one line in `CURRENCY_LABEL` (`lib/i18n/format.ts`), the allowlisted edit from A6. |
| D8 PWA manifest | optional | **Out of scope.** No service worker, no manifest. |

## Hard rules (amended)

- Branch `web-redesign`; phase PRs into it; `master` only at release. Hotfixes from `master`.
- Read first: `AGENTS.md`, `CONTEXT.md`, `DEVELOPMENT_NOTES.md`, `docs/ROADMAP.md`,
  **`apps/web/AGENTS.md`** (Next 16 rules: read `node_modules/next/dist/docs/` before writing code),
  **`docs/TEST_MAP.md`** (which spec pins which contract).
- Do NOT modify `apps/api`, `database/`, `src/`. API needs go to `docs/web-v2/API_REQUESTS.md`.
- `lib/` edits only by allowlist (A6): named file, one-line reason, recorded in `DEVIATIONS.md`.
- Never read or print real `.env` values. Keep URL paths; the only new route is D4's.
- One task = one commit. After each: update `docs/web-v2/PROGRESS.md`; report PASS / FAIL / BLOCKED
  with the exact command. Never claim a check that was not run.
- Dependencies: the **installed** set plus radix dialog + cva. Anything else is a new decision.
- Tokens only (`check:tokens`), logical CSS only, all strings via `messages/` (fr + ar parity).
- Fidelity priority: (1) accessibility and real-data resilience, (2) Stitch layout/hierarchy,
  (3) pixel details. Deviations → `DEVIATIONS.md`.
- **Gap rule:** a FEASIBILITY item that stays NO at gate G2 means the screen ships reduced and the
  reduction is named in `DEVIATIONS.md`. No screen blocks a phase mid-flight.

## Mobile-first rules (unchanged, plus what was missing)

Base styles = mobile; `md:` (768) and `lg:` (1024) add layout. Touch targets ≥ 44×44 px; inputs
≥ 16 px font; body ≥ 14 px; captions ≥ 12 px (Arabic one step larger). `viewport-fit=cover` requires
a `viewport` export in `app/[locale]/layout.tsx` — **it does not exist yet** (Phase 2 task). Bars pad
with `env(safe-area-inset-bottom)`; `dvh`, not `vh`; fixed bars never hide content. No hover-only
interactions; visible focus; `prefers-reduced-motion`. Sheets/dialogs via Radix Dialog: focus trap,
Esc/back, scroll lock. `next/image` only where a source exists (D1: nowhere yet) — every slot has a
fallback. Horizontal scrollers: scroll-snap, keyboard reachable, never the only path. RTL mirrors
layout and directional icons; numbers and prices only through `lib/i18n/format.ts`.

Tab bar: 5 items at 360 px. Labels need **short** message keys (new `shell.*` keys, fr + ar parity) —
"Enregistrements" overflows a fifth of 360 px.

## Test viewports

360×800 is today's only Playwright project (`mobile-360`). Phase 2 adds `390×844`, `768`, `1280`
as projects or per-spec resizes, **and** states which specs run at which size: the full 378-spec
suite at four viewports is ~1500 runs, which is not a gate anyone will honour. Working rule:
layout-sensitive specs (shell, wizard, result, detail, saved, compare, rtl) run at all four;
content/model specs run at 360 only.

## Phases (v5)

- **Phase A — pre-flight (human):** move the Stitch source into `apps/web/design/stitch/`, write
  `SCREENS.md`, sign off D1–D8 above and TOKENS.md + DEVIATIONS.md at G1.
- **Phase 0 — baseline and feasibility:** the concrete plan for this phase is
  `docs/superpowers/plans/2026-11-03-web-redesign-phase-0.md`. Gate: documented baseline, failing
  items listed, FEASIBILITY.md answered YES/NO with a file path per answer.
- **Phase 1 — tokens:** `TOKENS.md` from DESIGN.md; replace values in `@theme`, keeping names;
  WCAG AA check on amber CTA, pale-green buttons, badges; fonts per A1. Gate G1.
- **Phase 2 — kit and primitives:** restyle `components/ui/*` keeping props APIs; add StepHeader,
  BudgetPicker (reuses `lib/wizard/model.ts` bounds 500…1 000 000, untouched), choice-card radio,
  BottomTabBar, Sheet (Radix), StickyBar, BuildCard (D1 fallback), PartRow, RetailerRow (D3 reduced),
  StatusBadge (A3 vocabulary), SnapRow, TrustItem, ExplainerSheet; add the `viewport` export; update
  `/kit` + `/tokens` and their specs. Measure bundle against 174 080 B. Gate G2.
- **Phase 3 — shell:** header + bottom tab bar (5 short labels), `md+` top nav, footer, 404, error
  boundaries. Gate G3.
- **Phase 4 — screens, one task each:** configurer (4 steps + loading + options-failure + 429
  countdown) → results list → **build detail (D4, new route)** → home → presets → composants
  (catalog, compare, price history) → guides → enregistrements → legal. Per screen: rewrite markup,
  update specs to `getByRole`/`getByLabel`, compare fr + ar at 360/390/768/1280. Gate G4.n.
- **Phase 5 — tablet/desktop and RTL:** the `md`/`lg` layout rules above, Arabic review,
  directional icons, iOS Safari + Android Chrome. Gate G5.
- **Phase 6 — hardening:** full Playwright green (a11y, rtl, seo, structured-data, sitemap-budget);
  restyle both OG cards (if a third appears, extend `HEX_EXEMPT`); Lighthouse **all four**
  assertions on **both** fixture URLs, median of 3 (A4); `check:i18n` parity; Arabic strings flagged
  needs-review.
- **Phase 7 — release (human):** tag `web-v1-final`; deploy preview; real-phone pass; merge; deploy.
  Rollback = redeploy the tag.

**Deploy flow (named, because v4 said "the documented one" and `docs/RECIPES/` has no web recipe):**
`apps/web` is an OpenNext Worker — `wrangler.jsonc` (`morocco-pc-web`, KV incremental cache) is the
local descriptor, and the deploy path is `sites_prepare_next` → `sites_deploy` with the returned
manifest. Phase 6 writes that as `docs/RECIPES/deploy-web.md` so Phase 7 has a document to follow.

## Baseline recorded on `web-redesign` (2026-11-03)

| Gate | Result |
|---|---|
| `npm run typecheck` | PASS (exit 0) |
| `npm run lint` | PASS at branch start with 2 warnings (`mock/server.mjs:91`, `postcss.config.mjs:2`) — **both fixed in Phase 0**; now exits 0 with 0 warnings |
| `npm run check:tokens` | PASS — 84 files |
| `npm run check:i18n` | PASS — 82 files, 2 catalogues, key + placeholder parity |
| `npm run check:api-types` | PASS — contract 1.10.0, 10 paths, byte-identical |
| `npm run build` | **PASS** (exit 0); `/sitemap.xml` + `/robots.txt` `ƒ` by design, guides/kit/tokens/legal `●` |
| `npm test` | **PASS** — 381 specs, **379 passed / 2 skipped** (35.4 s). `AGENTS.md` still cites 378/376/2; that is stale by three specs (measured 2026-11-03). |
| `npm run test:lighthouse` | **PASS** (exit 0), all four `error` assertions on both fixture URLs |
