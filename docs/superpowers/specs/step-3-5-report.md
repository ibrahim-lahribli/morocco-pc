# Step 3.5 — Homepage completion report

> **Status: IMPLEMENTATION COMPLETE — ACCEPTANCE PENDING.**
>
> PR **#17** (`feature/v2-design-step-3-5` → `feature/v2-design`) merged as **`39a3ee0`**; the
> reviewed implementation commit was **`90bcda6`**. `git diff 39a3ee0 90bcda6` is empty and both
> commits carry tree **`0d5ea44`**, so the merge tree is the reviewed tree — not a re-created one.
>
> C1–C10 are implemented and covered by tests listed below. **C11 (approved imagery) and C12
> (native Arabic review) are BLOCKED on external input**, and final owner acceptance is
> outstanding. Nothing in this report is claimed from a command that did not run, and every
> fixture-backed number is labelled as such.

## 1. Provenance

| Fact | Value |
| --- | --- |
| Pull request | #17 |
| Merge commit | `39a3ee0` (merge of `feature/v2-design-step-3-5` into `feature/v2-design`) |
| Reviewed implementation commit | `90bcda6` |
| Tree identity | `39a3ee0^{tree}` = `90bcda6^{tree}` = `0d5ea442e79dcce67ec4fbbda4d0ea405ab43006` |
| Post-merge fixes | `3066a0e` (label size + card title wrap), `075e302` (real-API verification + both evidence sets) |
| Evidence tip | `ce46065` - the commit carrying this report and the full Step 3.5 evidence; CI green at this SHA (section 3) |
| Package | `apps/web-v2` (own manifest, lockfile and workflow) |

## 2. Gate snapshot

Run from `apps/web-v2` on 2026-11-08 on this tree (post-merge fixes applied). Each exit code was
captured, not inferred.

| Command | Exit | Printed |
| --- | --- | --- |
| `npm run typecheck` | 0 | no output |
| `npm run lint` | 0 | no output |
| `npm run format:check` | 0 | "All matched files use Prettier code style!" |
| `npm run check:api-types` | 0 | "api types are up to date (openapi-v1.10.json → lib/api/schema.d.ts)" |
| `npm test` | 0 | **172 passed**, 31 files |
| `npm run build` | 0 | compiled; `ƒ /[locale]`, `ƒ /[locale]/configurateur` |
| `npx playwright test` | 0 | **81 passed** |

The unit and browser counts are unchanged from `90bcda6` (172 / 81), which is the expected result
for two CSS-only changes plus one added script.

## 3. CI

`.github/workflows/web-v2.yml`, job `web-v2`, Node 22, `apps/web-v2` working directory.

| Trigger | Paths |
| --- | --- |
| `push` / `pull_request` | `apps/web-v2/**`, `apps/api/test/unit/openapi-v1.10.json`, `.github/workflows/web-v2.yml` |
| `workflow_dispatch` | — (never `schedule`) |

Steps: `npm ci` → `typecheck` → `lint` → `format:check` → `check:api-types` → `npm test` →
`npm run build` → `playwright install --with-deps chromium` → `npm run test:e2e` → upload
`apps/web-v2/test-results` on failure.

| Run | Commit | Result | URL |
| --- | --- | --- | --- |
| 42464961357 | `ce46065` (tip) | success | https://github.com/ibrahim-lahribli/morocco-pc/actions/runs/42464961357 |
| 42464961287 | `ce46065` (tip, ci.yml unit-and-docs) | success | https://github.com/ibrahim-lahribli/morocco-pc/actions/runs/42464961287 |
| 42435132704 | `39a3ee0` | success | https://github.com/ibrahim-lahribli/morocco-pc/actions/runs/42435132704 |
| 42434617577 | `90bcda6` | success | https://github.com/ibrahim-lahribli/morocco-pc/actions/runs/42434617577 |
| 42434613699 | `90bcda6` | success | https://github.com/ibrahim-lahribli/morocco-pc/actions/runs/42434613699 |

GitHub runs one workflow per **push**, not per commit, so `3066a0e` and `075e302` have no run of
their own: the push that published all five commits ran at the tip **`ce46065`** (run 42464961357)
and covered every one of them. The engine ci.yml unit-and-docs job ran on the same push (run
42464961287), which is where verify-docs and the decision-index gate live. `web-v2` is path-filtered (`apps/web-v2/**`, the OpenAPI snapshot, its own file), so a docs-only
commit re-runs `ci.yml` and correctly does NOT re-run `web-v2`: the `web-v2` evidence for this
work stays run 42464961357 at `ce46065`. This report own docs-only commit behaved exactly that way
(ci.yml run 42465334439, success; no `web-v2` run at all).

**What CI does not cover.** The job has no secret, no database and no API. `npm run test:e2e`
drives the committed stub, so nothing in CI proves the recommendation API. That is what
`scripts/verify-real-api.mjs` is for, and it is deliberately not a gate.

## 4. Real API verification

`scripts/verify-real-api.mjs` drives a **production build** against a **real deployed API** and
asserts what a visitor sees against the JSON the browser actually received — not against a second
API call.

| Fact | Value |
| --- | --- |
| API origin | `https://morocco-pc-api-eu.onrender.com` |
| Health | `200`, `db: "ok"`, `engine_version: "d2de4fb"` |
| App | `NEXT_PUBLIC_API_BASE_URL=<that origin> npm run build && npm run start` on `localhost:3220` |
| Command | `VERIFY_BASE_URL=http://localhost:3220 node scripts/verify-real-api.mjs` |
| Result | **55/55 checks passed, exit 0** (re-run 2026-11-08 while preparing this report) |
| Served GAMING rank-1 | score **56.88** → `56,9/100` (fr) / `56.9/100` (ar); total **11 946** → `11 946 DH` / `11 946 د.م.` |
| Served peer cards | `11 946` / `9 247` / `11 995` DH |

What the 55 checks assert, verbatim from the run:

- Request set: one `/v1/meta/options`, exactly one ladder read per use case (GAMING, OFFICE,
  WORKSTATION), one detail read per rendered card, **no duplicate request, no failed request, no
  4xx/5xx**, no console error.
- Hero: ready state; rendered score and price equal the served rank-1 build's `build_score` and
  `total_price`.
- Each card: title, score, price, badge, component pills (CPU/GPU/RAM/SSD_BOOT names) and CTA
  (`/fr/configurateur?use_case=<UC>&budget=<served tier>`) match the served build.
- Switching the finder to OFFICE: exactly one card remains, it is the OFFICE one, the hero keeps
  its Gaming score and price, and **no new ladder or detail read is issued**.
- Empty state from real data: a 3 500 budget shows the empty slot, no price, and issues no detail
  read.
- Configurator handoff: opens on the handed use case and served tier, and invents no build before
  a submit.
- Arabic: `dir="rtl"`, decimal point in the score, Arabic currency suffix, no console error, no
  failed request.
- 360 px in both locales: no horizontal overflow, mobile nav right edge ≤ 360, no console error.

**Separation of evidence.** These numbers are `served`. The fixture-backed numbers in §5 are
`72,5/100` and `11 500 DH`. The two sets are never interchangeable, and the fixture set is not
production verification.

No credential, cookie, request header or request body appears in this report or in any committed
artifact; the script prints paths, status codes and public response fields only.

## 5. Fixture-backed evidence

`MEASURE_SOURCE=fixture node scripts/measure-step35.mjs` → **14/14 cells, exit 0**.
Screenshots: `apps/web-v2/docs/screenshots/step-3-5/after/`; served set (same script,
`MEASURE_SOURCE=served`, real API): `docs/screenshots/step-3-5/production/`.

| Width | Overflow (fr / ar) | Hero preview (served set) | Pathways | Cards | Footer clears nav | dir |
| --- | --- | --- | --- | --- | --- | --- |
| 360 | 0 / 0 | hidden | 3 tiles, 3 rows | 3, 3 rows | yes | ltr / rtl |
| 390 | 0 / 0 | hidden | 3 tiles, 3 rows | 3, 3 rows | yes | ltr / rtl |
| 430 | 0 / 0 | hidden | 3 tiles, 3 rows | 3, 3 rows | yes | ltr / rtl |
| 768 | 0 / 0 | hidden | 3 tiles, 1 row | 3, 3 rows | yes | ltr / rtl |
| 1024 | 0 / 0 | `56,9/100`, `11 946 DH` | 3 tiles, 1 row | 3, 1 row | n/a (desktop nav) | ltr / rtl |
| 1280 | 0 / 0 | `56,9/100`, `11 946 DH` | 3 tiles, 1 row | 3, 1 row | n/a | ltr / rtl |
| 1440 | 0 / 0 | `56,9/100`, `11 946 DH` | 3 tiles, 1 row | 3, 1 row | n/a | ltr / rtl |

Smallest measured controls: locale links **44 px**, pathway tiles **54 px**. Below 1024 px the
preview is CSS-hidden and the script records `null` rather than a value a reader could not see.

## 6. Criterion table

| # | Criterion | State | Evidence |
| --- | --- | --- | --- |
| C1 | Hero shows the served rank-1 Gaming build at 12 000, no extra request | PASS | `e2e/homepage-hero.spec.ts` "shows the served Gaming score and price without a second request"; real-API run §4 |
| C2 | Pending / empty / zero-build / 404 invent no score or price | PASS | 8 unit tests in `tests/homepage/hero-rig-preview.test.tsx`; "keeps the text shell when the Gaming ladder is empty" |
| C3 | A phone gets a discovery affordance | PASS | `e2e/homepage-finder.spec.ts` "offers the same three tiles on a phone and keeps the focus move" |
| C4 | "Voir la configuration" reaches the configurator with the served tier | PASS | `e2e/homepage-builds.spec.ts` "opens the configurator from a card with the tier it serves" and "links the capped tier, never the budget the visitor typed" |
| C5 | Mobile "Guides" tab is a real in-page anchor | PASS | `e2e/homepage.spec.ts` "points the Guides item at the guides section" and "keeps the Guides destination in the Arabic navigation" |
| C6 | One `h1`, no skipped level, every section named | PASS | `e2e/homepage-a11y.spec.ts` "keeps one h1 and never skips a heading level", "gives every section an accessible name" |
| C7 | Keyboard focus visible, ordered, no trap | PASS | "walks exactly the page's own focusable elements, in order" |
| C8 | Touch targets meet the floor | PASS | "keeps every control at the WCAG minimum and the locale switcher at 44 px"; measured 44 / 54 px |
| C9 | Body copy and both CTAs clear 4.5:1 | PASS | "keeps body copy and both calls to action above 4.5:1" |
| C10 | Both locales render completely and mirror, no overflow | PASS | 14/14 cells, overflow 0; `dir=rtl` on `/ar`; `tests/format/score.test.ts`; "never overflows in Arabic at 360" |
| C11 | Media slots show approved local imagery | **BLOCKED** | no approved photography exists; placeholders remain the intentional treatment (Q-03) |
| C12 | Arabic copy carries a native-language sign-off | **BLOCKED** | `apps/web-v2/docs/homepage-arabic-review.md` is unsigned; not self-signed |
| C13 | Full gate set green and evidence complete | **PENDING** | §2, §3, §4, §5 complete; owner acceptance outstanding |

**Tally: 10 PASS, 2 BLOCKED, 1 PENDING** of 13.

## 7. What changed

- **Task 1 — hero preview.** `HeroRigPreview` renders the rank-1 Gaming preset at the 12 000
  ceiling through the ladder the cards already fetch; no extra request, and no number in an
  incomplete state.
- **Task 2 — mobile discovery.** `#pathways` renders at every width: one tile per row below `sm`,
  three across from `sm`. Resolution tiles stay deferred (Q-20).
- **Task 3 — card CTA.** A real `Link` to `/{locale}/configurateur?use_case=…&budget=<served
  tier>`, carrying the tier the card shows (15 000 for a capped 20 000 request), keeping a 44 px
  target.
- **Task 4 — Guides tab.** `href: "#guides"`; Composants and Enregistrés remain non-focusable
  text.
- **Task 5 — heading scale.** The discovery heading joins `text-headline-md lg:text-headline-lg`,
  pinned by "gives the four section headings one size per breakpoint".
- **Task 6 — a11y evidence.** `lib/a11y/contrast.ts` with no new dependency, plus
  `e2e/homepage-a11y.spec.ts`.
- **Post-merge `3066a0e` — two CSS defects only the served data exposed.**
  `cn()` goes through tailwind-merge, whose font-size group did not list `text-label-sm`, so the
  mobile-nav labels fell through to a text **colour** and rendered at 16 px, clipped at 360 px.
  Separately, the featured card header is a flex row, and a long served title (WORKSTATION at
  12 000) pushed the badge past the card edge; `min-w-0` lets the title wrap. No markup contract,
  API call, token value or copy changed.
- **Post-merge `075e302` — real-API proof and re-captured evidence.** `scripts/verify-real-api.mjs`
  added; `after/` re-captured with `MEASURE_SOURCE=fixture` and `production/` captured with
  `MEASURE_SOURCE=served`.

## 8. Deviations recorded

1. **Arabic scores keep the point** (`56.9`) while French uses the comma (`56,9`), with Latin
   digits in both, because a decimal comma in Arabic copy would read as a thousands separator.
   Pinned by `tests/format/score.test.ts`.
2. **Focus stops are derived, not counted.** The plan's fixed stop count could not hold; the a11y
   test derives the page's own focusable DOM and compares the Tab walk to it element by element.
3. **Two deferred cosmetic defects stay open and are not release-gating:** spec-pill wrapping and
   a score/price baseline offset on desktop cards (section spec §19). Fixing them would move
   approved card geometry, so they belong to a design-reviewed change.

## 9. Remaining blockers and sign-off

| Kind | Item | State | Who closes it |
| --- | --- | --- | --- |
| Missing approved assets | hero rig, three build cards, four guides (Q-03) | BLOCKED | owner supplies approved local assets under `apps/web-v2/public/` |
| Native Arabic review | homepage Arabic copy (Q-15) | BLOCKED | a qualified native reviewer signs `apps/web-v2/docs/homepage-arabic-review.md`; corrections then re-run the Arabic unit + Playwright suites |
| Owner acceptance | C13 release signoff | PENDING | owner's explicit decision, with name and date |

| Role | Decision | Name | Date |
| --- | --- | --- | --- |
| Owner | accept C1–C10 as complete | — | — |
| Owner | confirm Q-03 imagery is deferred | — | — |
| Native Arabic reviewer | sign-off (C12) | — | — |

Automatic RTL tests are **not** native Arabic approval, a green fixture run is **not** API
verification, and PR #17 being merged is **not** owner acceptance. Until the rows above are filled
this homepage is implemented, verified against the real API, and **not accepted**.
