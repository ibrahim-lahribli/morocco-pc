# Step 3.3 — Homepage → Configurator Journey: report

**Date:** 2026-11-07
**Branch:** `feature/v2-design`
**Baseline:** `8da9521` (Step 3.2 report)
**Plan:** `docs/superpowers/plans/2026-11-07-step-3-3-homepage-configurator-journey.md`
**Scope:** `apps/web-v2` only. V1 (`apps/web/`) and `apps/api/` are untouched.

## A. Implementation summary

The homepage finder's CTA now hands its two answers to `/{locale}/configurateur` instead of
scrolling. One module owns both directions of the URL contract: `buildConfiguratorHref` was added
beside `parseConfiguratorSearchParams` in `lib/configurator/schema.ts`, returns `null` rather than
inventing an answer, and emits exactly `use_case` and `budget`. The finder calls it and pushes the
result through next-intl's locale-aware router, so the visitor arrives at the configurator with both
answers already seeded and nothing written.

The configurator side needed no new state. The summary panel gains the pass's own `use_case` beside
its budget (from one shared `USE_CASE_MESSAGE_KEYS` map, so a label cannot disagree with the radio
that produced it) and a submitted/unsubmitted distinction for the empty state: before a submit it
explains what to do, after a submit it recaps the two answers and states plainly that no
configuration has been generated yet. `Continuer` still generates nothing and the URL is never
rewritten.

What was deliberately not built: the recommendation `POST`, the results route, the floor line, the
`reused` label and any resolution/priority question. They are Step 3.4's subject (Q-08) and are
recorded as open in §H rather than implied by copy.

## B. Modified files

Source: `lib/configurator/schema.ts` (+46), `components/home/budget-usage-finder.tsx` (CTA replaced,
doc comment updated), `components/configurator/build-summary-panel.tsx` (+40), `configurator-shell.tsx`
(+3), `lib/homepage/config.ts` (comment only), `messages/fr.json` and `messages/ar.json` (+5 each).

Tests: `tests/configurator/handoff.test.ts` (new, 4 tests), `tests/configurator/build-summary-panel.test.tsx`
(+3), `tests/components/finder.test.tsx` (2 rewritten), `e2e/journey.spec.ts` (new, 10 specs),
`e2e/support/configurator-api.ts` (answers `GET /v1/presets`), `e2e/configurator.spec.ts` (one
`exact: true`), `e2e/homepage-finder.spec.ts` and `e2e/homepage-builds.spec.ts` (scroll assertions
replaced by the destination URL).

Docs: `README.md`, `docs/sections/01-homepage.md` §5.5, `docs/finder-validation.md` (three rows),
this report.

Separate, pre-existing work preserved from the working tree and committed on its own:
`scripts/screenshots.mjs` and the six `docs/screenshots/*.png` (`aefef1d`).

## C. The journey

`e2e/journey.spec.ts` drives both screens through one stub. Each test ends on
`expectNoApiViolations`, which fails on any non-GET call or any API path no route handled.

| # | Scenario | Pinned result |
| - | -------- | ------------- |
| 1 | Gaming 12 000 from the homepage | `/fr/configurateur?use_case=GAMING&budget=12000`, radio checked, field `12000`, recap `Vos réponses : Jeux vidéo & Gaming · 12 000 DH` |
| 2 | Office 8 000 | same, `OFFICE` / `8000`, recap `Études et bureautique · 8 000 DH` |
| 3 | Workstation 15 000 | same, `WORKSTATION` / `15000`, recap `Création et travail pro · 15 000 DH` |
| 4 | Direct entry `/ar/configurateur?use_case=OFFICE&budget=8000` | `dir="rtl"`, office radio checked, budget `8000`, **no** alert on arrival |
| 5 | Reload | same radio, same value, no alert |
| 6 | Browser back | lands on `/fr` with the h1 visible; the finder's answers are deliberately not restored (the budget is form-local) |
| 7 | fr → ar | `/ar/configurateur?use_case=GAMING&budget=12000`, gaming radio checked |
| 8 | ar → fr after a submit | both parameters survive, the review phase does not (the URL never carried it) |
| 9 | 360 px Arabic | `scrollWidth - clientWidth = 0`; bar's bottom sits exactly on the nav content top; the new meta line renders and still overflows nothing |
| 10 | `from` + `budget=12` | the pass renders (11 946 DH, its own use case and budget) **and** the range message shows; the field keeps `12` |

Measured: 10 passed in 9.1 s, then 20 passed with `--repeat-each=2`, then 54 passed with the whole
suite.

## D. API behaviour — no writes introduced

- The homepage leg issues `GET /v1/meta/options`, one `GET /v1/presets` per use case and one
  `GET /v1/recommendations/{id}` per rendered card, exactly as Step 2.2 did.
- The configurator issues `GET /v1/meta/options` once, and one `GET /v1/recommendations/{id}` only
  when the URL carries `from`.
- No `useMutation` exists anywhere in the app, and `e2e/support/configurator-api.ts` still records
  any non-GET as a write and answers `405`; `expectNoApiViolations` asserts that list is empty in
  every spec.
- The 28-cell viewport sweep below made **42** stubbed API calls: **0 writes, 0 unmatched**.

## E. French / Arabic and RTL

Every new string comes from `messages/fr.json` and `messages/ar.json` under identical keys, with
identical placeholders (`summary.reviewRecap` = `{useCase}` · `{budget}`). `tests/i18n/messages.test.ts`
proves key and placeholder parity. Arabic keeps `dir="rtl"` from the layout, and the meta line uses
logical spacing only, so it mirrors without a second stylesheet.

**Arabic is machine-authored and is not native-approved.** `docs/homepage-arabic-review.md` remains an
open gate; nothing here claims that review. The Arabic assertions prove mechanics — direction,
pre-selected values, mirrored overflow, key parity — not the quality of the prose.

## F. Viewports

Measured with a temporary sweep harness (deleted after the run) on the configurator, in both locales,
for a loaded pass and the empty state — 7 widths × 2 locales × 2 states = 28 cells:

| Width | Height | Horizontal overflow | Bar → nav gap | Meta line (pass / empty) |
| ----- | ------ | ------------------- | ------------- | ------------------------ |
| 360   | 800    | 0 px                | 0 px          | 1 / 0                    |
| 390   | 844    | 0 px                | 0 px          | 1 / 0                    |
| 430   | 932    | 0 px                | 0 px          | 1 / 0                    |
| 768   | 1024   | 0 px                | 0 px          | 1 / 0                    |
| 1024  | 768    | 0 px                | nav hidden    | 1 / 0                    |
| 1280  | 900    | 0 px                | nav hidden    | 1 / 0                    |
| 1440  | 900    | 0 px                | nav hidden    | 1 / 0                    |

`gap = 0` means the bar's bottom edge is exactly on the nav's content box, as designed (the nav's
1 px top border is covered, not overlapped). The meta line appears on a loaded pass and never on the
empty state, in both locales. Which suite pins what: the homepage overflow sweep across five widths
lives in `e2e/homepage-i18n.spec.ts`; the configurator's 360 px bars and 1280 px target sizes in
`e2e/configurator.spec.ts`; 360 px Arabic with the meta line in `e2e/journey.spec.ts`.

## G. Gates

Run in one session, from `apps/web-v2`, on 2026-11-07 after the documentation edits:

| Command | Exit | Result |
| ------- | ---- | ------ |
| `npm run typecheck` | 0 | clean (strict, `noUncheckedIndexedAccess`) |
| `npm run lint` | 0 | clean |
| `npm run format:check` | 0 | Prettier-clean |
| `npm run check:api-types` | 0 | `schema.d.ts` matches `openapi-v1.10.json` |
| `npm test` | 0 | **138 passed** across 25 files (baseline 129) |
| `npm run test:e2e` | 0 | **54 passed** in 19.7 s (baseline 44) |
| `npm run build` | 0 | `/` static not-found, `/[locale]` and `/[locale]/configurateur` dynamic, middleware compiled |

Scope proof (`git diff --stat 8da9521` over the protected set — `components/home`, `lib/homepage`,
`app/[locale]/page.tsx`, `app/globals.css`, both manifests, `apps/web`, `apps/api`): the only entries
are `components/home/budget-usage-finder.tsx` and the comment-only `lib/homepage/config.ts`. No V1 or
API file, no manifest and no lockfile changed.

## H. Remaining issues

1. **A generated pass with zero builds is mislabelled.** `resolveState` maps
   `detail.builds.length === 0` to `"empty"`, so a `from` link to a real pass that assembled nothing
   shows "Choisissez un usage et un budget, puis continuez" — or, after a submit, the
   "aucune configuration n'a encore été générée" recap. Both are false: a configuration *is* loaded.
   `budget_floor` is in the contract and read by nothing, so the plan's "a zero-build pass shows the
   floor" line is unbuilt. This is a Step 3.2 state-machine gap that Step 3.3 exposes rather than
   introduces; it needs its own small state (e.g. `"loadedNoBuilds"`) plus floor copy.
2. **`reused: true` is not labelled.** The field is typed and returned; the summary never says that
   the pass it shows already existed. Harmless while nothing posts, load-bearing at 3.4.
3. **Resolution and priority are still not asked** — nothing to gate on `inputs_applied` yet. That is
   correct for this step, not a defect.
4. **Arabic is not native-approved** (§E).
5. **Two review judgement calls left in place:** the use-case label expression is duplicated between
   the summary header and the recap, and `buildConfiguratorHref` sits after
   `parseConfiguratorSearchParams` rather than above it as the plan's prose suggested (the doc comment
   carries the intent either way).

## I. Git state

Four commits on `feature/v2-design`, nothing pushed:

```
9fff580 test(web-v2): pin the homepage to configurator journey end to end
c4fd2e2 docs(web-v2): record the configurator step plans and the 3.1 review
d996273 feat(web-v2): hand the homepage answers to the configurator
aefef1d chore(web-v2): wait for the homepage cards before capturing screenshots
8da9521 docs(web-v2): record the Step 3.2 configurator foundation
```

The pre-existing working tree was preserved rather than reverted: the six evidence screenshots and
`scripts/screenshots.mjs` were committed intact as `aefef1d`, alongside — not mixed into — the Step 3.3
change. `app/[locale]/simulateur-preview/` does not exist in this tree and nothing was removed.

The plan says "do not commit or push"; the commits exist because the owner asked for them explicitly.
Nothing was pushed.

## J. Step 3.4 recommendation

Build the recommendation `POST` and a results view, per Q-08: the finder's CTA becomes the write
path behind `NEXT_PUBLIC_HOMEPAGE_SUBMIT`, the results route is addressed by the pass `id`, and the
summary becomes the pre-generation proposal view. The swap rows already exist in the contract
(`swapped`, `price_status`), and the two gaps in §H — the zero-build state and the `reused` label —
belong with that work rather than with this one, because only a real generation makes them reachable.
The architecture fork at `docs/superpowers/specs/step-3-1-configurator-architecture.md` §13.2 (picker
before or after the pass) still gates the catalogue grid and the GPU swap path, and not this step.

## Verdict

**CONDITIONAL** — the URL contract, the handoff, the truthful summary meta line and the whole
journey pass every gate with no writes anywhere, but the summary still cannot distinguish "no pass
loaded" from "a pass loaded and produced no build" (§H 1), and the Arabic copy is not
native-approved (§E).
