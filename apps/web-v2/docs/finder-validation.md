# Homepage finder — functional validation (Step 2.2)

**Date:** 2026-11-07
**Branch:** `feature/v2-design`
**Scope:** the shipped homepage finder and its recommended-configuration cards, in `fr` and `ar`,
against the EU staging API. Validation only: no product behaviour is changed by this record.

## How to read this record

Sections 1–2 are the baseline and the intended-vs-implemented matrix, written before any test was
run. Sections 3–8 are the live evidence, regression results and verdict, written by the live
passes. A cell in the matrix marked _deferred_ is a scope decision recorded in
`docs/sections/01-homepage.md`, not a defect.

## 1. Repository state

Captured 2026-11-07 before any change:

```text
branch       feature/v2-design
HEAD         4e54d6c2eba7a22be815d5957a24392cdf1abfa2
             docs(web-v2): flip the staging smoke verdict to pass
status       ?? apps/web-v2/app/[locale]/simulateur-preview/
             ?? docs/superpowers/
```

The tree carries **no modified tracked files**. The `NEXT_PUBLIC_API_BASE_URL` inlining fix is
committed as `04e6f77` and is not part of the working tree. Both untracked paths are preserved.

Baseline suite, all from `apps/web-v2`, before this record existed:

| Command                   | Exit | Result                                     |
| ------------------------- | ---- | ------------------------------------------ |
| `npm run typecheck`       | 0    | clean                                      |
| `npm run lint`            | 0    | clean                                      |
| `npm run format:check`    | 0    | Prettier-clean                             |
| `npm run check:api-types` | 0    | `schema.d.ts` matches `openapi-v1.10.json` |
| `npm test`                | 0    | 98 passed across 18 files                  |
| `npm run test:e2e`        | 0    | 22 passed in 10.0 s                        |

Those counts are the baseline the Step 2.2 additions are measured against.

## 2. Intended vs implemented behaviour

Every row cites what proves it: the approved spec (`docs/sections/01-homepage.md`) and the file
that implements it today.

| Behaviour               | Intended                                                                                                      | Implemented today                                                                                                                                                                          | Deferred                                                                                                                              | Source                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Use-case selection      | three peers, no default; labels from the dictionary, API value as key                                         | native radios in `UsageSelector`; `lg`-only pathway tiles also write the same store field                                                                                                  | —                                                                                                                                     | spec §5.3, §7; `usage-selector.tsx`, `discovery-pathways.tsx`  |
| Budget presets          | 5 000 / 8 000 / 12 000 / 15 000 DH; one answer only                                                           | preset radios; choosing a preset clears typed text and typing clears the preset                                                                                                            | —                                                                                                                                     | spec §5.1; `budget-preset-grid.tsx`, `budget-usage-finder.tsx` |
| Custom budget           | 3 500–100 000 DH, step 500; numeric field plus `lg` range                                                     | numeric field always visible, `lg` range shares one value, Zod range check with dictionary message                                                                                         | the mobile "Autre budget personnalisé" disclosure: `finder.budget.customToggle` is authored in both dictionaries but no code reads it | spec §5.2; `finder-schema.ts`, `custom-budget-field.tsx`       |
| Currency                | `MAD`, confirmed by `meta/options`, never switched by the visitor                                             | `currency = meta.currencies[0].value` (fallback `MAD`) feeds the preset query and `formatPrice`; no control exists                                                                         | switching is not planned for this surface                                                                                             | spec §5.5, §13; `use-presets.ts`                               |
| Cards on load           | three peers at the 12 000 ceiling, never the median                                                           | three slots; `selectPresetAtOrBelow(ladder, 12 000)`                                                                                                                                       | —                                                                                                                                     | spec §2 decision 2; `builds.ts`                                |
| Cards after answers     | one slot for the chosen use case, at or below the budget                                                      | `slots = useCase === null ? HOME_USE_CASES : [useCase]` and `selectedBudget = useCase === null ? null : budgetAmount`, so the budget has no effect until a use case is chosen              | —                                                                                                                                     | `recommended-build-section.tsx`                                |
| Cap and no-match        | above the top tier → highest tier + cap note; below the cheapest tier → honest empty slot, never a substitute | `capped` when `budgetAmount > highest.budget_amount`; `null` selection renders `builds.empty.*`                                                                                            | —                                                                                                                                     | spec §2 decision 3, §14; `selectSlotPreset`                    |
| Finder CTA              | no write until the results route exists (Q-08)                                                                | `preventDefault`, `buildConfiguratorHref`, locale-aware `router.push` to `/configurateur?use_case=…&budget=…`; nothing written                                                             | `POST /v1/recommendations` and the results route                                                                                      | spec §5.5; `budget-usage-finder.tsx`                           |
| Card CTA                | not a link yet                                                                                                | `<span aria-disabled="true">` plus an icon; no handler, so there is no actionable card element                                                                                             | results route                                                                                                                         | `featured-build-card.tsx`                                      |
| Resolution shortcuts    | hidden in the first release, no `resolution` in the store                                                     | absent in both variants; a test asserts no 1080p/1440p text at 390 and 1280                                                                                                                | Q-20                                                                                                                                  | spec §5.4, §7; `finder-schema.ts`, `store.ts`                  |
| Discovery pathways      | desktop grid preselects the mapped use case and focuses the finder                                            | three tiles, `hidden lg:block`, `aria-pressed`, writes the store then focuses `#finder-usage`                                                                                              | mobile resolution tiles (Q-20)                                                                                                        | spec §7; `discovery-pathways.tsx`                              |
| Loading / empty / error | per-slot skeleton, empty state, error + retry; one failed detail must not fail the section                    | skeleton while pending; empty keeps the category heading; presets error keeps the slot with retry; a detail 404 is logged and the card keeps its budget line without pills, score or badge | —                                                                                                                                     | spec §14; `recommended-build-section.tsx`                      |
| Detail freshness        | a selection change must never leave the previous card's specifications visible                                | query key is `["recommendation", id, catalog_version]` with no `placeholderData`, so a changed key returns `undefined` until it answers                                                    | —                                                                                                                                     | spec §6; `use-presets.ts`                                      |
| French / Arabic and RTL | every visible string from the dictionary; logical properties; mirrored directional icons                      | `fr` and `ar` dictionaries with key parity, `dir` from the locale, `rtl:-scale-x-100` on arrows                                                                                            | native Arabic sign-off (separate gate)                                                                                                | spec §15; `messages/*.json`, `eslint` i18n gate                |

### 2.1 Observations recorded, deliberately not changed

1. `BudgetUsageFinder` keeps a `values.useCase` field that is always `null`: the store owns the
   usage answer, and the local field only exists on the form values shape. Harmless today.
2. The cap note compares against the **highest served tier**, which is 15 000 in the stub ladder,
   so the note is only reachable with a custom budget above 15 000 — never with the 15 000 radio.
3. `finder.budget.customToggle` is authored in both dictionaries and read by nothing; the custom
   field is unconditional. A copy key with no consumer is a spec/implementation delta, not a
   functional failure, and it is not in this step's scope.
4. The pathway section is absent below `lg`, so any pathway test must run at ≥1024 px.
   Confirmed in the live pass: at 288 CSS px `#pathways` computes to `display: none` while
   its three buttons stay in the DOM; at 1280 px the tiles render and are clickable (§4 step 7).

## 3. Live ladder

Measured 2026-11-07 against `https://morocco-pc-api-eu.onrender.com` with `GET
/v1/presets?use_case=…&currency=MAD`. `catalog_version` is `e9997010de60e49634396970f6b23557`
for all three ladders; `/v1/health` answered `{"status":"ok","db":"ok","engine_version":"d2de4fb"}`
after a 23.7 s cold start.

| Use case    | Rows | Cheapest | Highest | Served for the 12 000 ceiling          | Detail behind it                              |
| ----------- | ---- | -------- | ------- | -------------------------------------- | --------------------------------------------- |
| GAMING      | 17   | 8 000    | 40 000  | `366d0fae-2828-4e04-90bd-d60e180d7328` | 3 builds, 11 946 MAD, indicative, score 56.88 |
| OFFICE      | 18   | 6 000    | 40 000  | `20417fa9-4691-4a84-b12b-33cb23486142` | 3 builds, 9 247 MAD, indicative, score 63.47  |
| WORKSTATION | 17   | 8 000    | 40 000  | `3b157941-b4df-4945-a6ae-e6e079644e4c` | 3 builds, 11 995 MAD, indicative, score 57.47 |

The three selected ids match the plan's expectation exactly. Two facts the stub cannot show:

- the ladder's top tier is **40 000**, not the stub's 15 000, so the cap note is only reachable
  above 40 000;
- the cheapest tier differs per use case — GAMING and WORKSTATION start at 8 000, OFFICE at 6 000
  — so "below the cheapest tier" is a different number per use case.

Every `presets[]` row reports `indicative`, and every served build reports `indicative` as well, so
no card can show a verified badge against this catalog.

## 4. French pass

Walked at `http://localhost:3220/fr` against the staging origin at 1280×900. Every request below
came from the page's own resource timeline; all are `GET` and all answered `200`.

| Step                                      | Visible result                                                                                  | Requests                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1. Load `/fr`                             | three cards, each `Budget visé · 12 000 DH`, ids `366d0fae`, `20417fa9`, `3b157941`; `dir=ltr`  | 7 reads: `meta/options`, three `presets`, three details                      |
| 2. Gaming only                            | one card, `366d0fae`, 12 000; budget still unset                                                | none                                                                         |
| 3. Preset 8 000                           | one card, `6fbc2ff2`, `Budget visé · 8 000 DH`, no cap note                                     | `GET /v1/recommendations/6fbc2ff2…`                                          |
| 4a. Enter 20 000                          | one card, `ec33902d`, `Budget visé · 20 000 DH`, **no cap note**                                | `GET /v1/recommendations/ec33902d…`                                          |
| 4b. Enter 45 000                          | highest tier served: `f0da6e29`, `Budget visé · 40 000 DH`, cap note names 40 000               | `GET /v1/recommendations/f0da6e29…`                                          |
| 5. Enter 3 500                            | `Aucune configuration disponible pour cet usage`; category kept, no budget line, no price       | none                                                                         |
| 6. Gaming → Office → Workstation → Gaming | one card each time: `20417fa9`, `3b157941`, then `366d0fae`; no previous category left anywhere | one `presets` + one detail per switch, once the 60 s `staleTime` had expired |
| 7. Pathway `Études & bureautique`         | office radio checked, `#finder-usage` receives focus, one office card at 12 000                 | none                                                                         |
| 8. CTA submit                             | `→ /fr/configurateur?use_case=OFFICE&budget=…`, values seeded, nothing written (Step 3.3)       | none                                                                         |
| 9. Card text click                        | no navigation, no request                                                                       | none                                                                         |

Two plan assumptions are corrected by the live ladder:

- **Step 4's cap does not fire at 20 000.** The top tier is 40 000, so 20 000 is an ordinary row
  (`ec33902d`). The note appears only above the top tier: 45 000 serves `f0da6e29` at 40 000 and
  names it. This is the same class of premise error as §6.2 — the stub's four-row ladder is not
  the live one.
- **Step 6 issues no request only while the ladder is fresh.** The three ladders are fetched at
  first paint with a 60 s `staleTime`; a switch made after that refetches in the background
  **without** a skeleton, because the cached row is still displayed. This is the mechanism §6.2
  measured from the other side.

Writes: 16 API requests in total across the session, all `GET`/`200`. The browser's network log for
the pass contains no `POST`, `PUT`, `PATCH` or `DELETE`.

## 5. Arabic pass

Walked at `http://localhost:3220/ar` on 2026-11-07.

| Check                                                       | Observed                                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Document                                                    | `lang="ar"`, `dir="rtl"`                                                                                                       |
| Load                                                        | three cards, every badge `سعر إرشادي`; headings `حاسوب للألعاب` / `حاسوب للمكتبيات` / `حاسوب للإبداع والعمل`                   |
| Budget 8 000 + `الدراسة والمكتبيات`                         | one card, `4648eacc-e525-48e5-9225-dbb9d50b2304` (the live office 8 000 row), `الميزانية المستهدفة · 8 000 د.م.`, `سعر إرشادي` |
| Explanation                                                 | served in French — `Ranked 1: best weighted score 60.72; PASS compatibility…` — the known non-mapping, not a defect            |
| Rapid switch GAMING → OFFICE → WORKSTATION → OFFICE, 120 ms | final card `4648eacc`, heading `حاسوب للمكتبيات`; exactly one article, no intermediate card left                               |
| CTA `اعثر على حاسوبي`                                       | `→ /ar/configurateur?use_case=…&budget=…`, values seeded, nothing written (Step 3.3)                                           |
| Writes                                                      | no `POST`, `PUT`, `PATCH` or `DELETE` in the network log for either pass                                                       |

**360 px is not measurable from this browser.** The panel renders at 288 CSS px `innerWidth` (274
`clientWidth`, `devicePixelRatio` 1.25), so the requested 360 px viewport is unreachable here; the
105 px overflow it reports at 274 px describes a width below every supported breakpoint. The
360 px claim therefore rests on `e2e/homepage-finder-ar.spec.ts`, which drives a real 360×800
Playwright viewport and asserts overflow `<= 0` — it passes, including `--repeat-each=3`, and no
product code changed during the live pass.

## 6. Regression

### 6.1 Task 2 — the budget-boundary tests pin their own behaviour

A passing test proves nothing until it fails for the right reason. Each mutation below was applied
to `components/home/recommended-build-section.tsx`, measured, then reverted with
`git checkout --` before the next one (`0` dirty lines after each revert). Same command, both
times: `npx playwright test e2e/homepage-builds.spec.ts`.

| Mutation                                                                                                            | Expected sole failure                                                    | Measured                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| A — `selectSlotPreset`'s no-match return becomes `selectPresetAtOrBelow(ladder, budgetAmount) ?? ladder[0] ?? null` | _shows the honest empty slot when the budget is below the cheapest tier_ | **1 failed, 8 passed** — only that test, on `Aucune configuration disponible pour cet usage` (the 5 000 row rendered instead) |
| B — `if (budgetAmount > highest.budget_amount)` becomes `if (false && …)`                                           | _caps a budget above the top tier and names the tier it served_          | **1 failed, 8 passed** — only that test, on the cap note at `homepage-builds.spec.ts:163`                                     |

Each mutation produced exactly one failure and it was the owning test, so neither test passes
vacuously and neither is held up by the other. `HOMEPAGE_BUDGET_CEILING` was deliberately **not**
used as a mutation: both tests set a custom budget, so the `budgetAmount === null` branch never
runs.

After the reverts the file is green again — `9 passed` in 5.6 s on HEAD `4e54d6c` — and
`git status --porcelain` lists the spec as the only modified tracked file.

The full Step 2.2 regression run follows in Task 8.

### 6.2 Tasks 3–4 — stub latency options and the use-case switch

`e2e/support/homepage-api.ts` gained two test-only latency knobs, `presetsDelayMs` and
`detailDelayMs`, awaited before `route.fulfill` in the presets and detail branches only — never in
the non-GET branch or on `meta/options`. `presetsDelayMs` is consumed by the first-paint skeleton
test below; `detailDelayMs` is defined by the plan's interface and has no consumer yet.

**The plan's in-flight premise does not hold here, and the cause is not a defect.** Review Focus
line 4 expects a use-case switch to clear the card and put a skeleton in its place. Measured on
HEAD `4e54d6c` with `presetsDelayMs: 900`, at the moment the previous heading disappears:

```text
expect(page.getByText("Chargement des configurations…")).toHaveCount(1) -> Received: 0
```

The previous GAMING card _is_ gone immediately, but nothing is ever pending: first paint renders
all three peer slots and therefore fetches all three ladders (`meta/options` plus three
`/v1/presets`), each cached under `["presets", useCase, currency]` with a 60 s `staleTime`, and
`BuildSlot` is keyed by use case — so the entry the switch lands on is already fresh. Serving it
from cache is the correct behaviour; a skeleton over an answer the client already holds would be
the regression.

The switch test therefore asserts the invariant that is both reachable and actually at risk: the
previous category is gone, exactly one card remains, and that card carries the office answer —
proven by its `aria-labelledby` (`build-rec-OFFICE-12000`), not by its heading alone, because a
stale cached build would keep the gaming id under an office heading. The pending state a visitor
can really see on this page (first paint) is covered by its own skeleton test, which is what
consumes `presetsDelayMs`.

| Command                                                                                             | Result                                               |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `npx playwright test e2e/homepage-finder.spec.ts e2e/homepage.spec.ts`                              | **10 passed** (Task 3 step 3; the plan predicted 12) |
| `npx playwright test e2e/homepage-builds.spec.ts`                                                   | **11 passed**                                        |
| `npx playwright test e2e/homepage-builds.spec.ts -g "clears the previous use case" --repeat-each=5` | **5 passed**                                         |
| `npx playwright test e2e/homepage-builds.spec.ts -g "skeleton per slot" --repeat-each=5`            | **5 passed**                                         |

### 6.3 Tasks 5–6 — the pathway tile and the Arabic finder

`e2e/homepage-finder.spec.ts` gained _narrows the cards to the pathway's use case_: at 1280 px the
section starts at three cards, a click on the `Études & bureautique` tile checks the office radio,
and the section settles at one office card with no gaming heading — the count assertion is what
separates "the tile writes the store" from "the tile only moved the radio".

`e2e/homepage-finder-ar.spec.ts` (new) covers the Arabic page as an interaction: `dir="rtl"`, the
`ميزانية 8 000` preset and `الدراسة والمكتبيات` usage produce one `حاسوب للمكتبيات` card carrying
`الميزانية المستهدفة`, and the narrowed grid measures 0 px of horizontal overflow at 360 px wide.

| Command                                                                   | Result                                                                  |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `npx playwright test e2e/homepage-finder.spec.ts -g "pathway's use case"` | **1 passed**                                                            |
| `npx playwright test e2e/homepage-finder.spec.ts`                         | **7 passed**                                                            |
| `npx playwright test e2e/homepage-finder-ar.spec.ts`                      | **2 passed**                                                            |
| `npx playwright test e2e/homepage-finder-ar.spec.ts --repeat-each=3`      | **6 passed**                                                            |
| `npm run test:e2e`                                                        | **29 passed** — 22 baseline + 2 Task 2 + 2 Task 4 + 1 Task 5 + 2 Task 6 |

The suite stands at 29 rather than the plan's 28 because Task 4 became two specs: the switch test
and the first-paint skeleton test that replaced the unreachable in-flight leg (§6.2).

### 6.4 Tasks 7–8 — regression after the live passes

Run from `apps/web-v2` on 2026-11-07:

| Command                   | Result                            |
| ------------------------- | --------------------------------- |
| `npm run typecheck`       | exit 0                            |
| `npm run lint`            | exit 0                            |
| `npm run format:check`    | exit 0                            |
| `npm run check:api-types` | exit 0                            |
| `npm test`                | **98 passed** across 18 files     |
| `npm run test:e2e`        | **29 passed**, twice, exit 0 both |

The first regression run overlapped the manual browser pass and failed once:
`homepage-finder.spec.ts:43 › takes the typed amount as the budget and rejects out-of-range values`,
with `locator.check: Clicking the checkbox did not change its state`. That is the hydration race
the other specs already guard against — the usage click landed before the island attached, so React
reverted the radio's state. The same spec then passed **21/21** across three isolated repeats
(`--repeat-each=3`), and the whole suite passed **29/29** twice with nothing else running. The spec
was given the same `waitForSettledCards` boundary its siblings use; no assertion, timeout or worker
count was changed.

## 7. Defects

No product defect was found. The two plan-premise corrections (§4 step 4, §6.2) are errors in the
plan's model of the data and the cache, not defects in the page. The single red check in §6.4 was a
harness race, fixed by the shared settled-card guard rather than by relaxing the assertion.

## 8. Verdict

**PASS** for the finder and the recommended-configuration cards as shipped, with these limits
stated as limits rather than as evidence:

- **Mocked coverage is not API evidence.** Every `e2e/*` spec stubs `/v1/**`; the API evidence is
  §3 and the live walks in §4–§5 against `morocco-pc-api-eu.onrender.com` (`catalog_version
e9997010…`, `engine_version d2de4fb`).
- **Deferred by design and not exercised:** the finder POST and the results route (Q-08), the card
  CTA (an `aria-disabled` span with no handler), resolution shortcuts (Q-20), and currency
  switching (no control exists).
- **Arabic copy is parity-tested but not natively signed off.** `docs/homepage-arabic-review.md` is
  still the open gate; nothing in this record claims that review.
- **The 360 px guarantee is a Playwright measurement**, not a browser-panel one (§5).
- The two plan-premise corrections (§4 step 4, §6.2) are corrections to the plan's model of the
  live ladder and the query cache, not defects in the page.
