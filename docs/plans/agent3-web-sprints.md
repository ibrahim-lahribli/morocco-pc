# Agent 3 — Web sprint board (1–2 h per sprint)

Companion to [agent3-web-plan.md](agent3-web-plan.md) (the validated whole plan). Each sprint
below states **Goal**, **Definition of done** and **Test scenarios**. Unless noted, the shared
DoD applies: lint + typecheck + tests green, renders at 360 px with no horizontal scroll,
keyboard-reachable with visible focus, no raw API enum text rendered, fr copy in sentence case.
Contract dependencies (CD-*) and findings (V*) are defined in the plan §2 — the API and engine
are in progress, so every contract-dependent sprint has a fixtures-first path.

**Board state, 2026-10-23 (S25 landed whole: saved builds and the price history).** 27
sprints: **25 DONE** (S1–S23, S25 and S27, whose status lines below carry the evidence), **1 NOT
STARTED** (S24, W5/post-beta, deliberately outside the M3 gate) and **1 BLOCKED** (S26, which needs a
deployed API and a chosen web host). What is left is not one block: S24 waits on CD-8, and only S26
needs a deployment.

## Sprints

### Phase W0 — Foundation

#### S1 — apps/web scaffold (1.5 h)
**Goal:** A running Next.js App Router + TypeScript app in `apps/web/` with fr as the default
locale, strict TS, Tailwind v4, and its own package manifest (OD4).
**Depends on:** —
**Definition of done:**
- `apps/web/` boots with `npm run dev`; `/fr` renders the app shell (header/footer/skip link).
- Strict TypeScript, ESLint, and `lint`/`typecheck`/`test` scripts exist and pass.
- Own `package.json` + lockfile; root `package.json`, root CI and engine untouched (V14).
- Node 22 used everywhere (matches repo CI).
**Test scenarios:**
1. `npm run build` completes with zero errors on Node 22.
2. `/fr` at 360 px viewport: no horizontal scroll (Playwright assert `scrollWidth ≤ clientWidth`).
3. Root `npm run test:unit` still passes (repo untouched).
4. Lighthouse smoke on `/fr` runs in CI (budgets added in S6).

**Status: DONE 2026-10-20 — checked against the tree on 2026-10-22, not re-run.** The package
declares `dev`, `build`, `start`, `lint`, `typecheck` and `test` (the `check:*`, `gen:api-types` and
`mock:api` scripts arrived with S2/S4/S5), carries its own committed lockfile, and leaves `ci.yml`
untouched — `.github/workflows/web.yml` is the S1 own-CI boundary. One DoD line is true of CI rather
than of every shell: Node 22 is what CI pins and what S6 re-verified from a fresh `npm ci` under
22.23.3 on 2026-10-21, while the local runs recorded in the plan's measured-state section used
Node 24.

#### S2 — Design direction + design tokens (1.5 h)
**Goal:** Turn the Stitch design (registered in the plan §3) into Tailwind v4 CSS-first
`@theme` tokens — brand → semantic → component hierarchy — and critique the extraction against
§3's principles before any component code. The frontend-design two-pass is now **EXTRACT →
critique**, not invent → critique.
**Depends on:** S1, and a readable DESIGN EXPORT (plan §3 records why the Figma copy is not it).
RESOLVED: the Stitch MCP is the source; the Figma copy was never needed.
**Definition of done:**
- Palette, type scale, spacing, radii and component states are EXTRACTED from the Stitch export
  (the exported screen cited per token group) into an in-repo token map, and that extraction
  is critiqued
  against §3's principles before code is written.
- `@theme` block defines semantic tokens (background, foreground, primary, muted, border, ring,
  radius, verified/warn) in OKLCH-compatible form; **no raw hex in components**.
- Logical-properties policy documented and applied in base styles (RTL-safe).
**Test scenarios:**
1. A grep-based check fails if any component file contains a raw `#` color literal.
2. Tokens render on a sample page; foreground/background pairs meet WCAG AA contrast
   (≥ 4.5:1) — measured, not eyeballed.
3. `dir="rtl"` on the sample page mirrors layout correctly (no physical `left/right` classes).

**Status: DONE 2026-10-20 — as built.** `apps/web/app/globals.css` is the token file: a Tailwind v4
`@theme` block with three layers (brand → semantic → component), 21 raw OKLCH colours plus 7
semantic aliases, an 8-step type scale, three radii, the board's two card shadows and two spacing
decisions. `docs/design/TOKEN_MAP.md` carries the provenance (board screen id), the contrast matrix
and the deviations. `app/[locale]/tokens/page.tsx` renders every token at 360 px so the values can be
seen and measured; `e2e/tokens.spec.ts` measures them; `scripts/check-tokens.mjs` (`npm run
check:tokens`, in `web.yml`) is scenario 1. Three things are worth recording:

1. **The board contains one accessibility defect, and the token map does not reproduce it.** It paints
   the warning budget bar in saffron, which measures 1.71:1 against the track. The token is
   `warning` `#B45309` (4.00:1); saffron survives as `--color-accent` for chip fills.
2. **The board's screens are physically-classed.** Its Arabic screen carries 26 `ml-/mr-` and zero
   logical utilities, so copying it makes the Arabic pass (S20) a rewrite. The gate rejects
   `ml-/mr-/pl-/pr-/left-/right-/text-left/text-right`; components use `ms/me/ps/pe/start/end`.
3. **Dark mode was removed, not invented.** The scaffold's `prefers-color-scheme` block went away
   because the design is light-only; a palette nobody designed is fiction.

Two scenarios are satisfied differently than the sprint text implies. Scenario 1's grep gate is
STRICTER than asked (it also fails palette utilities and physical sides, not only `#` literals, and it
scans `lib/` as well as components). Scenario 2's "sample page" is a real route, `/fr/tokens`, set to
`noindex` so a design artifact can never be indexed.

Measured: 29/29 Playwright specs (7 of them S2's); the token gate exit 0 on 7 files and RED on a
hex literal, a palette class and a physical side before being trusted; `build` exit 0 with no CSS
parse warning.

**Review (2026-10-20).** Two amounts on the proof sheet were typed by hand — `Reste 100 MAD` and
`Dépasse de 400 MAD` — beside a third bar in the same block that did use `formatMoney`. Both now
go through the helper (`Reste 100 DH`), which is what the page's own rule says. The gate did not
catch them: its money rule needs a grouped thousand (`500 DH` alone does not match), so the
blind spot is named here rather than papered over. A stricter rule would also flag the legitimate
step copy (`paliers de 500 MAD`), so it stays as it is until a rule can tell a step from a price.

**Review (2026-10-20, second pass).** The page had also drifted from the kit it introduces: written
before S3, it hand-copied Button, ChoiceCard, Badge, ProgressBar and Alert. The copies had lost the
price badges' icons (leaving colour as the only signal between the three states) and had kept the
literal 2 px border S3 replaced to avoid a 1 px layout shift. It now imports `@/components/ui`: 98
lines of hand-copied markup became component calls (the file is 15 lines shorter overall, because
each call states one prop per line), and every state on it now comes from the kit. The same pass
gave the radio groups a real name — `<fieldset>` + `<legend>` on `/fr/kit` and `/fr/tokens`, and a
line in `COMPONENTS.md` saying the group label is the caller's job — because a heading above three
cards is not a name, and S7 will copy whichever pattern it finds.

#### S3 — Base component kit + a11y primitives (2 h)
**Goal:** The small accessible kit the wizard/results need — Button, TextField, Slider,
ChoiceCard, Badge, ProgressBar, Skeleton, Alert — implemented to the Stitch components, not
invented alongside them.
**Depends on:** S2 (tokens) and the exported frames for these eight components.
RESOLVED: S2 shipped the tokens first, so the kit was built only from them.
**Definition of done:**
- Each component reproduces its exported frame's states (default / hover / focus / disabled /
  error) with token-driven classes — no raw hex, no bespoke spacing — and the story route
  records a per-state visual diff against the frame.
- Each component: variants via token-driven classes, `:focus-visible` ring, ≥ 44 px touch
  targets, labels wired (`htmlFor`/`aria-label`), reduced-motion safe.
- Slider is keyboard-operable (arrows/Home/End) and announces its value.
- Components documented with usage notes in one story/demo route.
**Test scenarios:**
1. Tab order through the demo route is logical; every interactive element shows focus.
2. Slider: ArrowRight increments by step; Home/End jump to min/max; value announced via
   `aria-valuenow`/`aria-valuetext`.
3. Icon-only controls carry `aria-label`; decorative icons are `aria-hidden`.
4. `prefers-reduced-motion: reduce` disables the Skeleton shimmer.

**Status: DONE 2026-10-20 — as built.** `apps/web/components/ui/` holds the eight components plus a
barrel (`@/components/ui`); `app/[locale]/kit/page.tsx` is the `noindex` proof sheet with every state
labelled by the board section that defines it, and `docs/design/COMPONENTS.md` is the per-state
record (geometry, API, accessibility contract). `e2e/kit.spec.ts` is 10 specs. Three deviations
and two decisions:

1. **Selected cards use a 1 px border plus a 1 px ring, not a literal 2 px border.** Same 2 px
   edge, zero layout shift when a card is selected — the board's version nudges every card below
   it by a pixel.
2. **`ghost` keeps a 48 px height.** The board's "Bouton Lien / Texte" is a full-width row; a
   20 px text link would have been the obvious reading and the wrong target size.
3. **No `"use client"` in any component.** Behaviour is the native element's; state lives in the
   screen. That is why the story route needs exactly one client island.

Two DoD items are satisfied differently than the text implies. "Records a per-state visual diff
against the frame" is recorded as **specifications plus role and keyboard assertions**, not pixel
snapshots: a baseline image proves only that a page did not change, while these assertions prove
the states exist and the keyboard works — and they survive a font or antialiasing change. The
per-state geometry table in `COMPONENTS.md` is the frame record. And "no bespoke spacing" is
enforced by the token gate, which now also scans `components/` (7 → 20 files).

One visible consequence worth recording: every amount goes through `Intl` with `fr-MA` (plan §2
V11), which groups with a point, so the proof sheet prints `8.500 MAD` where the board's copy
writes `8 500 MAD`. The formatter wins; S5 owns the final money format.

Measured: 39/39 Playwright specs at the time (10 S3; S5 later took the total to 51); `check:tokens`
exit 0 on 20 files, RED on the three rule types; `build` exit 0, 7/7 static routes; `typecheck`
exit 0.

**Review (2026-10-20, second pass).** Three defects, all fixed and re-measured. (1) `ProgressBar`
defaulted `aria-valuetext` to a hand-written `${Math.round(ratio)} %` — a percentage in ASCII
punctuation, which is the one thing `formatPercent` exists to prevent (French separates the sign
with U+00A0; Arabic wraps it in LRM marks). `valueText` is now REQUIRED, both callers pass
`formatPercent`, and the spec asserts the helper's output instead of a literal. (2) A typed budget
that was not a multiple of the step desynced the two controls: the range input snapped its own DOM
value to 500 (4 123 → 4 000) while the slider kept announcing the typed 4 123, so it described a
thumb position it was not on. `commitDraft` now snaps to the step — verified live: field, slider and
`aria-valuetext` all read 4 000. (3) `TextField`'s unit reached a screen reader only through the
hint, and an error state replaces the hint (measured: "Votre enveloppe cible, 1 500" with no unit
anywhere); the label now carries an `sr-only` unit, so the accessible name is "Votre enveloppe cible
MAD". `typecheck`, `build`, `check:tokens`, `check:i18n` exit 0 and Playwright is 55/55 after the
fixes.

#### S4 — Typed API client + fixtures + mock server (2 h)
**Goal:** A typed client generated from a committed `/v1/docs/json` snapshot, plus a fixture
mock server covering every contract state the web consumes — including the provisional ones.
**Depends on:** S1
**Definition of done:**
- Client generated (e.g. openapi-typescript + thin fetch wrapper); generation script committed;
  the OpenAPI snapshot committed alongside.
- Mock server serves: `GET /v1/meta/options`, POST 201 (builds), POST 200 (zero-builds + and
  − `budget_floor`), GET 200, GET 404, 422 (with `details[]`), 413, 429 (with `Retry-After`),
  503, and a slow-response mode (for skeleton testing).
- Fixtures model both `offer_class` values and both `price_status` values (V6).
- CI job fails when regeneration produces a diff against the committed snapshot (drift alarm).
**Test scenarios:**
1. Generated types reject unknown request fields at compile time (e.g. adding `foo` fails
   `typecheck`).
2. Each mock state is reachable and documented; the zero-build fixture has `builds: []` and
   a `reason`.
3. Drift check: mutate the snapshot → CI step goes red.
4. Contract fields used anywhere in `apps/web/` are all present in the snapshot (grep gate for
   `inputs_applied`/`reasons`/`display_name` usage must route through the fallback layer).

**Status: DONE 2026-10-20 — as built.** `npm run gen:api-types` generates `lib/api/schema.d.ts` from
`apps/api/test/unit/openapi-v1.6.json`; `lib/api/client.ts` is the single fetch path (typed
`ApiError`, `details[]`, `retryAfterSeconds`); `lib/api/compile-gate.ts` makes a contract
regression a `tsc` failure; `mock/server.mjs` + `mock/fixtures.mjs` serve every state listed above
plus the dedupe path, the zero-build-with-no-floor case and an open CORS policy; `check:api-types`
runs in `web.yml` between typecheck and build. Two deliberate deviations from this DoD:

1. **The snapshot is not committed a second time.** It is the API's gated file, read in place. A copy
   under `apps/web` would be two plausible contracts in one tree with nothing to say which one the
   service serves — the exact hazard this repo keeps closing elsewhere.
2. **Scenario 4's grep gate was not built, because a type gate subsumes it.** Every field the app can
   reference now comes from `schema.d.ts`, so `inputs_applied`, `reasons` or a component
   `display_name` is a COMPILE error (pinned by the `@ts-expect-error` probes in
   `compile-gate.ts`), not something a text grep would have to notice. The V5 rule that catalogue
   names come from `display_name` is asserted where it can actually regress: the contract spec
   checks a recommendation body contains no `display_name`.

Measured: 29/29 Playwright specs at the time of writing (19 are S4's; S2 added 7; S3 later took the
total to 39); the drift gate red on a mutated type file, a raised version and a changed path set,
PASS after each restore.

#### S5 — i18n skeleton + fonts (1.5 h)
**Goal:** next-intl with fr default and an ar (RTL) locale shell, fr-MA formatting helpers,
and Latin+Arabic font subsets with zero CLS.
**Depends on:** S1, S2
**Definition of done:**
- `/fr` and `/ar` routes; locale switcher; `dir` set per locale (`rtl` for ar).
- Formatting helpers only: `Intl.NumberFormat('fr-MA'|'ar-MA')` for money ("7 300 DH"),
  `Intl.DateTimeFormat` for dates (V11).
- Fonts subset via `next/font`, `display: swap`, preloaded; documented subsetting for Latin +
  Arabic glyphs.
**Test scenarios:**
1. `/ar` sets `lang="ar" dir="rtl"` on `<html>`; `/fr` sets `lang="fr" dir="ltr"`.
2. `formatMoney(7300)` → contains a non-breaking/narrow space and "DH" (both locales).
3. Lighthouse CLS = 0 on a font-heavy fixture page (fonts must not shift layout).
4. No hardcoded date/number strings in components (lint rule or grep gate).

**Status: DONE 2026-10-20 — as built.** `i18n/routing.ts` (two locales, prefix always),
`i18n/request.ts` (locale from `next/root-params`, so every route stays static), `proxy.ts` (Next
16's rename of middleware, `/` → `/fr`), `messages/{fr,ar}.json`, `lib/i18n/format.ts`,
`lib/i18n/paths.ts`, `components/locale-switcher.tsx`, and `app/[locale]/format` as the formatting
proof sheet. `docs/design/I18N.md` is the reference. Four deviations, each deliberate:

1. **No `NextIntlClientProvider`.** next-intl's `Link` is a client component calling `useLocale()`;
   using it in the layout would ship the message catalogue to the browser. Plain `next/link` +
   `localePath()` instead, and the switcher receives the active locale as a prop. The switch is a
   full document load — correct for a different `lang`/`dir`, and it keeps the client bundle free of
   i18n runtime. `i18n/navigation.ts` was written and then deleted for the same reason.
2. **Scenario 2 is satisfied by normalizing, not by accepting CLDR.** `fr-MA` and `ar-MA` both group
   with a full stop; `formatMoney(7300)` returns `7 300 DH` with U+202F and a no-break space before
   the unit, because a full stop reads as a decimal separator in French. The currency LABEL is `DH`,
   not `Intl`'s `MAD` currency style (which adds cents nobody quotes).
3. **Scenario 3's Lighthouse CLS is measured with the layout-shift API, not by running Lighthouse.**
   CLS = 0 on `/ar` after `document.fonts.ready`, and no individual shift is recorded. Lighthouse
   itself belongs to S6's budgets; claiming "Lighthouse CLS = 0" from a Playwright observer would
   be an overreach.
4. **The French proof sheets are fr-only.** `/ar/kit` and `/ar/tokens` 404 via page-level
   `generateStaticParams` + `notFound()`: serving French documentation under `lang="ar"` would
   mispronounce it. S20 translates product screens, not design documentation.

Measured: 55/55 Playwright specs (16 S5); `check:i18n` exit 0 on 21 files, RED on all four rule
types; `check:tokens` exit 0 on 23 files; `build` exit 0, 6 prerendered routes (`/fr`, `/ar`,
`/fr/format`, `/ar/format`, `/fr/kit`, `/fr/tokens`, 9 static pages reported); `typecheck` exit 0.

**Review (2026-10-20).** Three font findings; all three fixed. (1) The Arabic variable class was
applied only for `ar`, so `font-arabic` was an undefined `var()` on a French page and the
`/fr/tokens` type specimen labelled "IBM Plex Sans Arabic" actually rendered in Inter — worse, the
label was Latin text, which the face's `unicode-range` would never paint anyway. The specimen is now
Arabic copy in the face, named in Latin beside it. (2) `preload` was a document-level decision and
there was one root layout, so `/fr` preloaded four IBM Plex subset files (~136 KB) it never used;
`preload: false` was rejected (the face then swaps after first layout and the switcher's Arabic label
reflows its neighbours by 3 px, 0.0007 CLS, against a pinned 0). (3) Fixed by OWNING the file: the
face is now self-hosted (`public/fonts/ibm-plex-sans-arabic/`, OFL beside it), so its URL is stable
and `app/[locale]/layout.tsx` preloads three weights with React 19's `preload()` only when
`dir === "rtl"`. Per-locale root layouts were the other candidate and were not needed.

**Measured, HEAD worktree vs working tree (same probe, production build, 360×800):** `/fr` 206 KB of
fonts in 6 requests → **47 KB in 1** (the four Arabic files and 136 KB are gone, and so is the mono
file with `preload: false`; `/fr/format` and `/fr/kit` likewise emit 0 Arabic preloads). `/ar` 248 KB
→ **178 KB** (4 requests). `/fr/tokens` 219 KB → **112 KB** (one 42 KB Arabic file and the mono file,
both on demand). CLS stays 0 on every route unthrottled, and `e2e/i18n.spec.ts` now pins the split:
3 Arabic preloads on `/ar`, zero on `/fr`, `/fr/format` and `/fr/kit`, and the mono face loaded only
where it is painted. Under a 400 kbps CDP throttle the numbers are no longer all zero (worst 0.00181
on `/ar/format`) — and they are identical with the mono preload restored, so that residue belongs to
preloaded faces arriving after first paint, not to this change (I18N.md §5 has the breakdown).

**Review (2026-10-20, second pass).** next-intl's middleware wrote `NEXT_LOCALE` on every redirect
(measured: `GET /de` → 307 with `set-cookie`), although nothing reads it — with a prefix on every
URL the cookie is state with no owner, and I18N.md §7 already claimed the URL is the preference.
`i18n/routing.ts` now sets `localeCookie: false`; the same redirect is header-clean and the specs
are unchanged.

#### S6 — CI + budgets (1.5 h)
**Goal:** A dedicated `apps/web` CI job: lint, typecheck, unit tests, Playwright at 360 px,
Lighthouse CI budgets — without disturbing the engine's existing jobs.
**Depends on:** S1–S5
**Definition of done:**
- New workflow job (or workflow) for `apps/web/` only; existing `unit-and-docs` and
  `recurring-gates` jobs untouched.
- LHCI budgets expressed in the repo (mobile, throttled 4G profile, 360 px): LCP ≤ 2.5 s,
  CLS ≤ 0.1, initial JS ≤ 170 KB (hypothesis — keep as warning first, fail once W3 lands).
- Playwright runs headless at 360×800 in CI.
**Test scenarios:**
1. A deliberately failing type check turns the job red (prove the gate fires).
2. LHCI runs on a fixture route and uploads results as CI artifacts.
3. The engine's `test:unit` job is unchanged and green on the same commit.

**Status: DONE 2026-10-21 — the job and the budgets are live in `web.yml`, with the three
assertions at `warn`; S19 promoted them to `error` the same day.** The narrative below is the
landing record.

**The dedicated job and the warning-first budgets landed 2026-10-21; S19 promoted them to
failures the same day.** `.github/workflows/web.yml` is the S6 job: its own workflow (the engine's
`ci.yml` jobs untouched), no secrets, no database. It replaces the scaffold-era `web-ci.yml`,
deleted here: the same gates, budgets included, one job per web push instead of two. On
`push`/`pull_request` touching
`apps/web/**` it runs, in `apps/web`, `npm ci`, `typecheck`, `lint`, `check:tokens`,
`check:i18n`, `check:api-types` (the S4 drift gate, which is why the triggers also include
`apps/api/test/unit/openapi-v1.6.json`), `build`, Playwright (`--with-deps chromium`), `npm test`
at 360×800 through the existing `mobile-360` project, then `npm run test:lighthouse` — uploading
`test-results/` on failure and `.lighthouseci/` always. Verified locally from a fresh `npm ci`
under Node 22.23.3 with `CI=true`: **168/168** specs.

**The budgets are `warn`, and they are genuinely evaluated.** `lighthouserc.cjs` measures the
fixture result page (`IDS.threeBuilds`) at 360 px with simulated 4G throttling: LCP ≤ 2500 ms,
CLS ≤ 0.1, script transfer ≤ 174 080 B (the 170 KB hypothesis). `scripts/lighthouse-ci.mjs` owns
both servers, refuses to measure a dev server already on 3210 (or a result route that does
not answer 200 as itself), and stops them even when Lighthouse fails, so the number is the
BUILT app. Measured locally 2026-10-21 (3 runs): LCP
2.32–2.34 s, CLS 0, script transfer 145 981 B (142.6 KB), performance 98; an impossible budget
produced a warning assertion with exit code 0, which is what warning-first means. **Proven on
GitHub the same day:** run 39618370244 (push) and 39618455093 (dispatch) were green end to end,
168/168 specs in 26.1 s; after the artifact fix, run 39619019100 attached a 1.37 MB
`web-lighthouse-report` with three LHRs (CI: LCP 1.79–2.40 s, CLS 0, 145 981 B). Uploading needed
`include-hidden-files: true` — the first two runs reported success and stored nothing, because
`upload-artifact` skips dot-directories such as `.lighthouseci` by default. DoD scenario 1 is
proven too: a deliberate type error on a throwaway ref (run 39619535613) failed the typecheck step
and skipped the rest. **On `master` now:** pushing 3e1a4e7 ran both workflows and the web run
(39620417164) was green step for step, report artifact attached; the engine's `ci` job was green
S19 has since promoted its three metric assertions to `error` with a median
aggregation (see S19 below).

### Phase W1 — Wizard

#### S7 — Wizard shell + step state machine (2 h)
**Goal:** Single-column, four-step wizard with URL-synced state and a use-case step driven by
`GET /v1/meta/options`.
**Depends on:** S3, S4, S5
**Definition of done:**
- Steps in URL (`/fr/configurer?etape=2` or path segments) — refresh/back/forward preserve state.
- Step machine validates per step; "Suivant" disabled until valid; visible progress ("Étape 2
  sur 4" — this is a genuine sequence, so numbering is legitimate here).
- Use-case choices rendered from `meta/options` labels (never raw `GAMING`).
- 360 px single column; touch targets ≥ 44 px.
**Test scenarios:**
1. Deep-link to step 3 with valid state renders step 3 directly; with invalid state redirects
   to the first invalid step.
2. Browser back from step 3 → step 2 with values intact (state never out of sync with URL).
3. `meta/options` 503 → friendly error + retry (never an empty form).
4. Keyboard-only completion of step 1.

**Status: DONE 2026-10-20 — as built.** The route is `/fr/configurer` (`/ar/configurer`), and it is
STATIC: the page reads `params` only, so the build still lists it as SSG. The step and the four
answers live in the query string, and the client component derives everything from them. That is the
decision worth naming: **there is no wizard state in React.** `etape`, `use_case`,
`budget_amount`, `resolution` and `priority` are read on every render by `readState()`, so a
refresh, Back and Forward take the same code path as a first visit and there is no second copy of the
state to fall out of sync. Three consequences:

1. **Steps are NAMED, not numbered** (`?etape=budget`, not `?etape=2`). S9 makes the flow length
   depend on the profile (resolution exists only for gaming), at which point a number would mean
   different screens for different users; the visible "Étape 2 sur 4" is computed from the applicable
   list at render time, where it is a property of what the user sees.
2. **Answers use the contract's own field names**, so the URL, the model and the future POST body are
   one vocabulary — `toRequest()` already returns the exact body S10 sends.
3. **Answers use `router.replace`, steps use `router.push`.** Editing a field must not add history
   entries (Back would walk the user's keystrokes); moving a step must, because this DoD asks Back to
   return to the previous step with its values.

The repair rule is `firstInvalidStepBefore`: a deep link that skips an unanswered step is moved to
that step, and it looks BACKWARDS only, so it never fights a field someone is typing in. `meta/options`
is fetched through S4's typed client with a skeleton, an `AbortController` and a retryable error — a
503 renders a message and "Réessayer", never an empty form.

Two kit additions were needed, both recorded in COMPONENTS.md: `ChoiceGroup` (the fieldset/legend a
radio group needs — the wrapper the earlier review named) and `LinkButton` (the button's geometry on
a link, for the home page's entry point). `ChoiceCard` also gained the controlled pair
(`checked`/`onChange`), because the answers live in the URL.

Measured: **76/76** Playwright specs (12 wizard + 9 model); `check:tokens` 28 files,
`check:i18n` 26 files, `typecheck`/`lint`/`build` exit 0, and the build still reports
`/fr/configurer` and `/ar/configurer` as ● SSG (8 prerendered routes, 11 static pages). The specs
INTERCEPT `**/v1/meta/options`: `NEXT_PUBLIC_*` is inlined at build time, so no test can point the
browser at the fixture server at runtime, and a 503 has to be produced on demand. The fixture body is
imported from `mock/fixtures.mjs`, not copied.

#### S8 — Budget step: slider + numeric field (1.5 h)
**Goal:** Budget input with 500 MAD slider steps, free numeric entry (OD2), fr-MA display.
**Depends on:** S7
**Definition of done:**
- Slider snaps to 500 MAD; numeric field accepts any integer and clamps on blur to
  [500, 1,000,000]; both stay in sync.
- `inputmode="numeric"`, proper `<label>`, `Intl` formatting on display (V11/V12).
- Keyboard-operable slider with `aria-valuetext` in DH.
**Test scenarios:**
1. Type `7300` → field keeps 7 300 DH; slider thumb snaps to 7 500 on commit (documented).
2. Type `50` → clamps to 500 on blur with inline guidance (not a silent reset).
3. Type `2000000` → clamps to 1 000 000 with inline message stating the fix.
4. Arrow keys on the slider move 500 DH; Home → 500; End → 1 000 000.
5. Enter on the numeric field advances to the next step (form semantics, no `div` handlers).
**Status: DONE 2026-10-20 — as built.** The budget is ONE answer with two controls, so S8 is really
a synchronisation rule: the field keeps what was typed (any integer), the slider renders that same
draft snapped onto its 500 MAD grid, and a slider move writes back into both. The URL always holds
the TYPED amount — 7 300 stays 7 300 — which is why the note under the slider exists: instead of
letting the thumb sit on 7 500 and read as a bug, it says where the thumb is and which number is
kept. `snapToStep` rounds to nearest (a tie goes up) and clamps, so `snapToStep(999_600)` is
999 500 because 999 600 is nearer to it than to the top; End reaches the true 1 000 000 only because
the maximum is ON the grid (500 + 1 999 x 500), and a unit check pins that arithmetic.

Clamping is `clampBudget`, which returns the amount AND the bound that moved it (`min` / `max`),
so the guidance is a message-catalogue sentence rather than a string in the component. It runs on
BLUR, not on keystroke: a half-typed "2" on the way to "20000" must not become 500 under the caret.
Enter settles an out-of-range draft first and refuses that press — the guidance would otherwise be
read after the flow had already moved on — so the second Enter advances.

Two smaller decisions. The step is a `<fieldset>` whose `<legend>` is the question, so both
controls share one accessible name; a label on the field alone would name half the answer. And the
field's label lost its hand-written "(MAD)" in favour of the `suffix` copy: the S7 review had made
the accessible name read "... (MAD) MAD", and the suffix is now the locale's own word, so French
says `MAD` and Arabic says `DH`, matching every other formatted amount on the page (S20 still owns
whether Arabic switches to `د.م.`).

Measured: **85/85** Playwright specs (7 budget specs plus 2 model checks added), `check:tokens` 29
files, `check:i18n` 27 files, `typecheck`/`lint`/`build` exit 0. One old spec was REPAIRED rather
than weakened: "an out-of-range amount removes the answer" described S7 and is now "an empty amount
removes the answer", because S8 turns a parseable-but-out-of-range amount into a clamp, and the
clamp path has its own specs. The first draft of the Enter spec raced the navigation (its second
press could land before the settled answer reached the flow); that was fixed in the SPEC by waiting
on the app's own promise, with `--repeat-each=3` used to prove it stable.

Known limitation, recorded rather than papered over: the slider is LINEAR over 500 -> 1 000 000,
exactly as this DoD asks (Home = 500, End = 1 000 000, arrows = 500), so on a 360 px track the first
7 000 MAD occupy roughly 0.7 % of the rail and every realistic budget sits under the first
thumb-width. **CLOSED 2026-10-22 by S27** (below): the rail now speaks POSITIONS and maps them
through an exponential curve, so 7 000 MAD sits at 34.7 % of the track while the amounts it can
produce are still 500 MAD ones. Everything S8 promised survives there — the field keeps the typed
amount, the arrows still move 500 DH, Home and End still reach the bounds.


#### S9 — Resolution + priority steps with the inputs_applied gate (2 h)
**Goal:** Resolution (gaming only) and priority (three choices → 1/3/5) steps, with visibility
governed by the contract's applied-inputs truth (V3/OD1).
**Depends on:** S7
**Definition of done:**
- Resolution step renders only when use_case is gaming-family AND the contract says it is
  applied (CD-1); otherwise the honest-labelled profile variant (OD1).
- Priority maps price→1, balanced→3, performance→5 (only 1/3/5 are ever sent).
- No UI copy implies these inputs change results while they are inert (contract rule).
**Test scenarios:**
1. Gaming selected → resolution step appears; office selected → step skipped, flow is 3 steps.
2. "Équilibré" selected → request payload `priority: 3` exactly.
3. With `inputs_applied` absent from the mock contract → non-influential label is visible on
   both steps; a rendering snapshot pins that copy.
4. With a mock contract that marks priority applied → label disappears (feature-check works).

**Status: DONE 2026-10-20 — as built.** S9 changes what the wizard IS: the flow is now a function
of the answers rather than a constant, and the two optional questions say what the contract actually
does with them. `STEPS` (the canonical order) stays; `stepsFor()` is what a profile walks, and
`normalizeAnswers()` drops an answer whose step is not in that flow, so the URL, the progress line
and the request body cannot disagree.

**The resolution question is a use-case question.** `isGamingFamily()` is the `GAMING` prefix of the
contract's own vocabulary (the vocabulary is DATA — the scoring model's `use_case_profiles` keys —
so a hardcoded list of gaming use cases would stop matching the day a model spelled one
differently). An office profile therefore walks three steps and never sees the resolution step; a
URL that names it (`?etape=resolution&use_case=OFFICE`) is resolved FORWARDS to the first step at
or after that position, because the user was heading that way. And while the use case is still
unanswered the flow is the FULL one: a first screen that guessed the short flow would say "Étape 1
sur 3" and rewrite itself to "sur 4" the moment the user picked gaming.

**Priority is three of the contract's five.** `PRIORITY_CHOICES` = 1/3/5, and the narrowing is the
model's: labels still come from `meta/options` (never from a table here), and 2 and 4 are dropped by
VALUE. The API accepts and advertises all five, so a spec feeds the wizard the real 1..5 list and
asserts three radios — a filter that stopped working would show five. `isStepValid` rejects anything
outside 1/3/5, so only those three can reach the URL or the POST body.

**OD1's honest label is the fallback, not the whole mechanism (CD-1).** `inputs_applied` is absent
from contract v1, so the wizard asks both questions and says so: the label is the group's
`aria-describedby` description, not a separate paragraph, so a screen reader hears the question and
the caveat together. `lib/wizard/applied.ts` is the ONE place that reads the absent field (through
`unknown`, since a field outside `schema.d.ts` must otherwise be a compile error), and it answers
three values, not two: SILENCE is not an empty list. Silence keeps both questions; a response that
names its applied inputs hides the step it did not name. Both paths are driven through `page.route`,
so the feature check is a test: `inputs_applied: ["priority"]` turns the caveat off on the priority
step and removes the resolution step entirely, while the required use-case step stays (the POST body
cannot exist without it).

One copy correction came with the narrowing: the wizard's intro said "Quatre étapes", which became
false the moment an office profile walked three. It now says "Quelques questions" in both languages.

Measured: **97/97** Playwright specs (6 step specs plus 6 model checks added), `check:tokens` 30
files, `check:i18n` 28 files, `typecheck`/`lint`/`build` exit 0, `/fr/configurer` still ● SSG. Two
failures met and fixed rather than worked around: the first draft deep-linked to the priority step
without a resolution, so the (correct) backwards repair moved it to resolution — the SPEC was wrong,
and it now carries the answer its profile requires; and the priority interaction used
`locator.check()`, which waits forever on the kit's `sr-only` native radio, so it drives the group
from the keyboard like every other wizard spec.

#### S10 — Submit path: POST lifecycle, loading, errors, latency budget (2 h)
**Goal:** The wizard→results hand-off: validated POST, progress skeleton, full error mapping,
and a latency budget that reflects measured reality (V1).
**Depends on:** S4, S8, S9
**Definition of done:**
- Client-side validation mirrors the contract (number for `budget_amount`, no unknown fields).
- Loading skeleton with determinate progress appears within 300 ms; `aria-live="polite"`
  announces loading/success/error.
- Error mapping: 422 → inline field errors from `details[]` + focus first error; 413; 429 →
  `Retry-After` countdown (V10); 503 → "service indisponible" + retry; 500 → generic message
  + `request_id` shown for support.
- Zero-build POST (200) routes to the results zero-build state, not an error (S14).
- Budget: skeleton ≤ 300 ms, P95 wall ≤ 15 s on staging; the 3 s target recorded as pending
  API/engine work, not as a failing gate (V1).
**Test scenarios:**
1. Submit with `budget_amount` as string → caught client-side as 422 would (error surfaced
   before the request).
2. Slow mock (8 s) → skeleton shows progress states; page never appears frozen.
3. 429 with `Retry-After: 30` → submit disabled with visible countdown, re-enabled at zero.
4. Zero-build 200 → navigates to `/fr/config/[id]` zero-build state.
5. Double-tap submit sends exactly one request (idempotent UX).

**Status: DONE 2026-10-20 — as built.** The last step is now a request, and the screen owns
everything that can happen to one. Three decisions did the work.

**Validation mirrors the CONTRACT, not the wizard.** `lib/wizard/submit.ts` `validateRequest()` is
a copy of `apps/api/src/contracts/recommendations.js`: `budget_amount` is a NUMBER (0 < n <= 1 000
000), `currency` is exactly three characters, `use_case` non-empty, `priority` an integer 1..5,
unknown fields REJECTED by name. The wizard's own narrowing (500 MAD floor, priorities 1/3/5) is
stricter and lives in `model.ts` — deliberately, because this check is the last line before the
wire and must agree with the thing that will judge it. Scenario 1 is a unit test: a body carrying
`"7300"` never reaches the network and is reported exactly like the 422 it would have been.

**Every failure is a MEANING.** `mapSubmitFailure()` returns one of five states — field refusal,
too large, rate limited, unavailable, server — so no component switches on a status code and
forgets 503. Two mappings are judgement calls: a NETWORK failure is `unavailable` (from the user's
seat an outage and a dropped connection are the same event, and both deserve a retry), and a 422
with no `details[]` is still a field failure with an EMPTY list, so the screen falls back to its
general sentence instead of inventing which field was wrong. A 422 that names a field moves the
user BACK to the step that owns it (`stepForField`), renders the sentence under that control and
focuses it: a message about a screen three steps away is a message nobody can act on. `currency`
has no control anywhere (the wizard fixes it to MAD), so it is the one refusal that is a sentence
instead of a jump.

**One action, not two.** After a failure the primary button becomes "Réessayer" and re-posts; a
second retry control beside it would be one request behind two buttons, and the user would have to
guess which one a countdown applied to. A 429 disables that button for exactly the seconds the API
gave in `Retry-After`, counts them down in the API's own number (formatted by `lib/i18n/format.ts`,
never typed), and says "Réessayez dans un instant" once the number runs out rather than leaving a
stale 0.

**The progress bar does not predict.** `POST` is one request with no progress channel, so a
creeping percentage would be invented. The bar moves only between the two facts the client can
observe — request handed to the network (50), answer received (100) — and says so in
`aria-valuetext`, which is what a screen reader reads instead of the number. What proves the page
is alive is the CLOCK: a real elapsed-seconds caption under the bar, which is a fact. That pairing
is the honest reading of "determinate progress". The polite `role="status"` line exists before the
text it announces (a live region mounted with its message is a coin toss), errors go through
`Alert`'s `role="alert"`, and success needs no announcement because it is a navigation — the
router announces the new page.

A double submit is stopped by a REF, not by state: two clicks in one tick both see the button
enabled, so only a synchronous guard holds the line. A zero-build 200 navigates like any other
result (V2 — S14 owns what that page then says).

**Two things were added that the DoD did not name.** (1) `/fr/config/[id]` — a hand-off page, not
the results page: it shows the id the POST produced and says the detailed screen is the next step,
`noindex`, dynamic by construction. Without it S10 would hand a user who just pressed the primary
button a 404 on success. S11 replaces it wholesale. (2) An API change, because a browser could not
read the header this sprint depends on: `apps/api/src/app.js` now lists `Retry-After` and
`X-Request-Id` in CORS `exposedHeaders`. Chrome filters non-safelisted response headers on a
cross-origin fetch, so without it `retryAfterSeconds` is null and the countdown silently degrades
to a plain retry — the first 429 spec failed for exactly that reason, against a mock that had not
modelled the header either. The mock and the specs now send it, and `apps/api/test/unit/cors.test.js`
pins it on the server side.

Measured: **114/114** Playwright specs (10 submit plus 7 model checks added), `check:tokens` 33
files, `check:i18n` 31 files, `typecheck`/`lint`/`build` exit 0 (`/fr/configurer` still ● SSG,
`/fr/config/[id]` reported ƒ Dynamic), `npm run test:api` 112 pass with the new CORS assertion.
Budget note, unchanged and still open (V1): the 300 ms claim is measured in the spec, the 15 s P95
is NOT — there is no staging origin, so nothing here reports a latency number as a fact, and the
3 s target stays recorded as pending API/engine work rather than as a gate.

One deviation from the scenario text, recorded rather than hidden: scenario 2 describes an 8 s slow
mock and the spec delays 2.5 s. Nothing in the state machine is time-dependent — the progress block
is asserted under 300 ms, the bar carries no fake percentage, and the clock is pinned at one second
and two seconds — so eight seconds would only lengthen the suite. If a real timeout ever enters the
code, the 15 s budget above is where it belongs, not in a test fixture.

**The browser→API leg was stubbed, and is now driven (2026-10-21).** Every spec above intercepts
`**/v1/**`, because `NEXT_PUBLIC_*` is inlined at BUILD time — so the suite proved the form against a
stub, and the results page against the server's own base, but never a real submit between them.
`playwright.config.ts` now also starts the fixture mock on port **3000**, the base `apiBaseUrl()`
falls back to when no build-time env names one, and `e2e/wizard-browser-api.spec.ts` drives the same
last step with NO route interception: a real 201 from `http://localhost:3000`, the hand-off, and the
SSR read-back that follows it. The spec is opt-in (`E2E_BROWSER_API=1`, set by `web.yml` and by
nothing else) because a developer machine may hold the real, write-capable API on that port. The build
deliberately does NOT set `NEXT_PUBLIC_API_BASE_URL`: `lib/presets/load.ts` reads it as a CONFIGURED
API base, so a build-time value would make `next build` consult the API and end S16's offline,
fixture-only prerender.

**The same submit was driven against the real engine, once (2026-10-23).** `e2e/wizard-engine.spec.ts`
is that leg WITHOUT the mock: the real API on 3000 (TEST branch), the Next server pointed at it by
`E2E_APP_API_BASE_URL` (a config seam that still defaults to the mock), and assertions that reach past
the response into PostgreSQL — the committed query, the rank-1 candidate and its 8 components whose
`selected_price` sums to the total the page printed, and a second identical submit answering 200
`reused: true` with the ORIGINAL id (Decision 47). Opt-in (`E2E_ENGINE_API=1` plus that override),
run alone, never in CI, and it deletes its own pass in FK order: a leftover `recommendation_query`
row blocks the golden harness for the whole checkout.

### Phase W2 — Results

#### S11 — Results page: SSR + strategy cards + component list + budget bar (2 h)
**Goal:** `/fr/config/[id]` renders the persisted recommendation from `GET
/v1/recommendations/:id` (SSR), with `builds[]` rendered generically (V13).
**Depends on:** S4, S5, S10
**Definition of done:**
- SSR fetch of the recommendation; unknown id → 404 page (contract: 404 only for unknown
  query); zero-build 200 → zero-build state (S14).
- Total vs budget bar: width proportional, over-budget state visually distinct, `aria` text
  equivalent ("12 450 DH sur 15 000 DH").
- Component list shows role, display name (V5), variant, `price_used` in DH; first card
  visually primary; 1..N cards supported.
**Test scenarios:**
1. Fixture with 3 builds → 3 cards, first emphasized; fixture with 1 build → single card, no
   empty slots.
2. 404 id → styled 404 with CTA to the wizard (not a blank page, not a stack trace).
3. Total > budget fixture → bar overflow state + warning badge.
4. Rendered text never contains "seed"/"SEED_UNVERIFIED"/"TestCompat" (V5).

**Status: DONE 2026-10-20 — as built.** The hand-off page is gone; `/fr/config/[id]` reads
`GET /v1/recommendations/:id` on the server and renders it.

**The fetch IS the sprint.** It happens in a server component, so this is the first screen in the
app whose data a browser route cannot fake. Two consequences were worked through rather than
worked around. (1) A server-side API root: `lib/api/client.ts` gained `serverApiBaseUrl()` and
`getRecommendationForServer()`. `API_BASE_URL` is read at request time and is deliberately NOT
`NEXT_PUBLIC_`, so a deployment can point the server at an internal address while the browser keeps
the public origin; `playwright.config.ts` points the Next process at the fixture mock, which is what
makes the specs exercise the shipping path instead of replacing it. (2) An id that selects the state:
with no browser left to set a header, each fixture carries its own id and the mock's `GET` is a
lookup in `RECOMMENDATIONS_BY_ID` that answers 404 for anything else, as the real API does. S10's
landing assertions were re-pointed at this page, and one fixture defect came out of it: the
zero-build fixture shared the 2-build fixture's id, so revisiting the URL a zero-build POST returned
would have rendered two builds — the opposite of what was just submitted.

**Three outcomes, and a 404 that is not a 503.** `lib/result/load.ts` narrows a read into
`ok | missing | unavailable`: 404 or 400 is `missing` and becomes `notFound()`, which renders
`app/[locale]/not-found.tsx` — with `app/[locale]/[...rest]/page.tsx` beside it, so an unknown path
inside a locale is the same styled page rather than Next's default English one. Anything else (5xx,
refused, non-JSON) is `unavailable`: HTTP 200 with an alert and a retry, because telling someone
their link is dead while our engine is down would both lie and remove their reason to retry. The
retry is a DOCUMENT navigation (`LinkButton reload`) — a router push to the URL already in the
address bar is a no-op that would leave the error on screen looking like a retry.

**Rank is data; position is display.** `orderBuilds()` sorts by `rank` (stable, the API's own order
as the tie-break) instead of trusting the array, and `builds[]` is mapped, never padded (V13): one
build is one card, and zero builds never reach the card component at all.

**The bar is two numbers or nothing.** `barFigures()` returns the pair only when both are positive
and finite, so a NULL total draws no bar rather than a 0 % one. `budgetTone()` is arithmetic above
budget (`over`) and a 90 % band below it (`warning`) — exactly-on-budget is `warning`, not
`over`, because the build is affordable with nothing left. `aria-valuetext` carries the real
sentence (total, "sur", budget) because the browser CLAMPS `aria-valuenow` for an over-budget build
— measured here: 8 594 against 5 000 is announced as 5 000 — so the clamped number alone would read
"exactly on budget".

**Two deviations, recorded rather than hidden.** (1) The DoD asks for a "warning badge" on an
over-budget build; the page uses an `Alert` with the warning tone, because `Badge`'s three tones
are the PRICE-PROVENANCE states (S12 owns them) and a fourth would make one component say two
unrelated things — and a pill cannot say by how much. (2) The component list is a
`<ul aria-label="Composants">` of rows, and the variant is printed only when `display_name` does
not already contain it: the fixture proved that necessary, because the GPU's name ends in "8GB" and
its `variant` is "8GB". `offer_class` is never rendered — `SEED_UNVERIFIED` on screen is a V5
failure — and the API's own `disclaimer` is printed once at the foot of the list until S12 ships
the badge.

Zero-build is deliberately THIN here: a heading, a sentence, and a CTA back to the budget step
pre-filled from the pass. The `budget_floor` advice ("budget minimum conseillé" and its
lower-bound caveat) is S14's DoD; inventing the number now would mean writing it twice, two ways.

Measured: **134/134** Playwright specs (13 result-page and 7 result-model checks added, S10's landing
assertions re-pointed), `check:tokens` 39 files, `check:i18n` 37 files,
`typecheck`/`lint`/`build` exit 0 (`/fr/config/[id]` ƒ Dynamic, `/[locale]/[...rest]` ƒ
Dynamic, `/fr/configurer` still ● SSG). SSR is asserted three ways: the raw response body contains
the builds, no browser request reaches `/v1/recommendations`, and the over-budget arithmetic is read
off the rendered `aria-*` attributes. Not run, by scope: `test:api:db` and `verify:replay` — no
API contract or schema changed.
**Review (2026-10-21).** One real defect, fixed. `ROLE_ORDER` — the vocabulary `roleLabel()`
validates — listed eight roles and omitted `SSD_SECONDARY`, which IS a valid `component_role`
(migration 011; the enum's one non-singular storage role, and `persistence/`'s tests persist one).
No current assembly step emits it, so nothing on screen was wrong yet, but a stored build carrying
one would have been labelled "Autre". The array now follows the enum's declaration order, and its
comment names the enum instead of a non-existent `candidates/roles.js` `EXPANSION_ORDER` (the real
constant is `assembly/assemble.js`'s, in a different order and unused here). fr/ar gained "SSD
secondaire" / "قرص إضافي", and the model spec now pins a label for every role and strategy in BOTH
catalogues, so the vocabulary and the copy cannot drift apart again. Two documentation counts were
wrong and are corrected: S11 added 13 page specs and 7 model specs (20), not 15.

Two things were checked and deliberately NOT changed. (1) The 404's server response is Next's
error shell for BOTH an unknown id and an unknown path — `<html id="__next_error__">`, no
`lang`/`dir`, the styled tree only in the RSC payload. In a browser it renders correctly (404
status, French or Arabic copy, right `dir`, a working CTA), which is the DoD; a JS-disabled reader
sees nothing, and changing that means restructuring the locale-owning root layout. (2)
`getRecommendationForServer` has no request timeout, so a blackholed (as opposed to refused) API can
hold the render — a deployment concern, recorded rather than patched inside S11.

#### S12 — Price provenance badge (démo / indicatif / vérifié + date) (1.5 h)
**Goal:** The pinned three-state badge (V6) with honest date labelling and the API's
`disclaimer` surfaced.
**Depends on:** S11
**Definition of done:**
- Mapping pinned: démo ← all `SEED_UNVERIFIED`; vérifié ← `price_status = verified`;
  indicatif ← otherwise.
- Date renders as "prix constatés le {generated_at}" (CD-6 honest label), `Intl.DateTimeFormat`.
- `disclaimer` from the API is displayed; badge colour tokens from S2 (verified/warn).
**Test scenarios:**
1. All-seed fixture → "démo" badge (warn token); mixed fixture → "indicatif"; all-VERIFIED
   fixture → "vérifié" (verified token) — one test per state, mapping table-driven.
2. Badge text includes the formatted date; snapshot pins the exact French phrasing.
3. JSON-LD is NOT emitted anywhere for démo/indicatif (cross-check S19).

**Status: DONE 2026-10-21 — as built.** Every build card now carries the price badge, and the three
states are computed from BOTH columns rather than read off one.

**The third state is the client's, and it is decided FIRST.** `price_status` is derived by the API
as "verified" only when EVERY component's `offer_class` is VERIFIED, "indicative" otherwise — so an
all-seed pass and a pass with one seed part are INDISTINGUISHABLE to it (both `indicative`).
`priceProvenance()` in `lib/result/model.ts` adds the third state: every component `SEED_UNVERIFIED`
→ `demo`; `price_status = verified` → `verified`; everything else → `indicative`. The demo test runs
first for exactly that reason, and an empty component list is `indicative` rather than the vacuous
`verified` the API's `every()` over no components would produce. The mock gained a `demo` id whose
one build is made only of seed prices, so all three states have a fixture of their own.

**The date says what it dates.** CD-6: `generated_at` is when the pass RAN, not when a shop surveyed
a price, and the contract has no per-offer observed date. So the badge reads "Vérifié · calculé le
16 octobre 2026", NOT the board's "prix constatés le" — a label that would claim a survey nobody
performed. The date comes from `formatDate` (never a hand-written string), appears for `verified`
alone (the kit's rule: the success pair is the only tone allowed to carry a date), and a verified
build with a NULL `generated_at` drops the date rather than inventing one. A spec asserts the badge
never contains "constat", so restoring the board's phrasing is a test failure, not a copy edit.

**One deviation from the scenario text.** It asks for a "démo badge (warn token)"; the kit's tone
map (`TOKEN_MAP.md` §9, pinned by `e2e/kit.spec.ts`) is démo = dashed MUTED, indicatif = the warning
pair, vérifié = success. That is the better reading and it is used unchanged: warning already means
"a price exists but is stale", while a demo price is the LEAST-known state — and the three states
stay distinguishable by shape and word, not only by colour.

The API's `disclaimer` is still printed once at the foot, as the DoD asks: the badge is the
per-build fact, the disclaimer is the pass-wide one, and neither is invented where the other belongs.

Measured: **141/141** Playwright specs (6 badge specs plus 1 model check added), `check:tokens` 39
files, `check:i18n` 37 files, `typecheck`/`lint`/`build` exit 0. The JSON-LD half of scenario 3 is
asserted as an ABSENCE on the demo and mixed pages (`application/ld+json` never appears in the raw
HTML); S19 has since shipped the emitting half, and only for `verified`.

#### S13 — "Pourquoi ce choix" panel (2 h)
**Goal:** The explanation panel: `explanation` text today, code-driven copy from `reasons[]`
the moment CD-2 lands (V4), with French strings in i18n files ready for Arabic.
**Depends on:** S11
**Definition of done:**
- Panel per build, collapsed by default (`<details>`/disclosure with keyboard support).
- Feature check: `reasons[]` present → copy from the French reasons table; absent →
  `explanation` rendered verbatim (never fabricated reasons).
- All reason strings live in `messages/fr.json` with stable keys.
**Test scenarios:**
1. Fixture with `reasons[]` → panel renders mapped French copy lines.
2. Fixture without `reasons[]` → panel renders the explanation string (fallback proven).
3. Unknown reason code → generic fallback line, no crash, no raw code shown to the user.
4. Disclosure is operable by keyboard and announces expanded/collapsed state.

**Status: DONE 2026-10-21 — as built.** Every build card ends with a native `<details>` disclosure.
The panel shows the committed explanation while the contract is silent, and catalogue lines the
moment `reasons[]` is served.

**The feature check is the sprint, and it lives in one module.** `reasons[]` is not in contract v1.5
(CD-2), so `lib/result/reasons.ts` reads it through `unknown` — the second and last place allowed to
name a field outside `schema.d.ts`, after `lib/wizard/applied.ts` does it for `inputs_applied` — and
turns each `{ code, value }` into a typed view. Three rules: absent or empty yields `[]` and the UI
renders `build.explanation` VERBATIM (never a paraphrase, never an invented reason); an unknown code
becomes ONE generic line at the end, never the raw code; and a KNOWN code carrying a malformed value
is treated the same way, so a percentage served as a string cannot become "NaN %". Entries that are
not `{ code, value }` records at all are ignored rather than counted as facts we failed to name.

**The copy never prints vocabulary.** Eight codes, eight catalogue sentences (`result.reasons.*` in
both languages): strategy and dominant role are translated through `strategies.*` / `roles.*`, the
two percentages go through `formatPercent` from a ratio (the component never divides), BIOS versions
are verbatim strings, and `INPUT_APPLIED` / `LIMITED_CATALOG` are GENERIC sentences on purpose —
their values are contract vocabulary (`GAMING`, `1440p`, E4's `FEWER_THAN_THREE…`) and the results
page has no `meta/options` labels to translate them with. Printing them raw would be the V5 failure
in a new place, so those two say what happened without naming the code.

**Native disclosure, no client island.** `<details>`/`<summary>` is collapsed in the SERVER HTML,
opens with Enter or Space, and exposes its own state: the accessibility tree reports a focusable
`DisclosureTriangle "Pourquoi ce choix"`. A hand-rolled ARIA disclosure would be a second state
machine to keep in sync with the first, so the specs assert the DOM's `open` attribute and real key
presses rather than a class name, and the browser's own role is what announces expanded/collapsed.

**The fixture is provisional, and says so.** The mock serves `reasons[]` on one id (`withReasons`),
in Decision 44's `REASON_ORDER` plus a code this client does not know. It has to live in the mock
rather than a `page.route` override because the results page is server-rendered (S11's lesson), so
the suite exercises the shipping path. Every other fixture stays reasons-free, which is the other
branch: the explanation string, verbatim.

V4 stays open on purpose: the persisted trace is still prose only, and this sprint does not change
that — it makes the API's eventual `reasons[]` a data change, not a UI change.

Measured: **152/152** Playwright specs (5 explanation specs plus 6 reason-line checks added),
`check:tokens` 41 files, `check:i18n` 39 files, `typecheck`/`lint`/`build` exit 0.

#### S14 — Zero-build + empty/error/rate-limited states (1.5 h)
**Goal:** The zero-build experience per V2 (both floor-present and floor-absent), plus the
shared state components W4 will reuse.
**Depends on:** S10, S11
**Definition of done:**
- Floor present: "budget minimum conseillé {cheapest_total} DH" + caveat "estimation minimale,
  non garantie" (the floor is a lower bound, not a buildable build).
- Floor absent (GET revisit / CD-7 not landed): generic "budget insuffisant" copy + CTA back
  to the wizard with the previous inputs prefilled.
- `budget_floor.cheapest_total = null` (missing roles) → no number shown; never `0`.
- Empty/error/429 states share one Alert primitive (S3).
**Test scenarios:**
1. POST-response zero-build with floor → advice block shows the number and the caveat.
2. GET revisit of the same id (floor `null`) → generic copy renders; a regression test pins
   that no floor number is invented.
3. `cheapest_total: null` fixture → no numeric advice, guidance copy only.
4. 429 state renders countdown; 503 state offers retry — both keyboard reachable.

**Status: DONE 2026-10-21 — as built.** The zero-build state is one heading and THREE sentences,
chosen by `zeroBuildAdvice()` in `lib/result/model.ts` from the floor's own shape: a priced
`cheapest_total` (the fixture's 4 477 DH) becomes "Budget minimum conseillé : {montant}." with
the caveat "Estimation minimale, non garantie : c'est un plancher, pas une configuration
réalisable."; a floor the engine could not price (`cheapest_total: null` — missing roles)
becomes guidance WITHOUT a number; and a floor absent entirely (`budget_floor: null`, the
GET-revisit shape of a pass committed before CD-7) becomes the generic "Budget insuffisant :"
copy. All three render in the SAME `Alert` primitive (tone `warning`), and every variant keeps
the pre-filled way back to the budget step.

**The no-number rule has teeth.** The three states are one typed union, so the page cannot print
the floor without the narrowing handing it a number — and the narrowing refuses 0, negative and
non-finite `cheapest_total` exactly like NULL: a 0 floor is not a free build, it is one nobody
priced (the standing NULL != 0 rule). The browser regression tests pin it in every zero-build
fixture: no `[^0-9]0 DH` anywhere in the visible text, a check written as a regex because
"6 000 DH" contains the substring "0 DH".

**Scenario 4's "countdown" is the API's fact, statically.** The results page is a server
component (S11), so there is no client timer to tick: a 429 read renders "Réessayez dans
{seconds} s." from the `Retry-After` the client already parsed (`loadRecommendation` now
carries `status` and `retryAfterSeconds` in its `unavailable` outcome), and shows no seconds at
all when the API served none — the wizard's live countdown (S10) remains the ticking one, and
this state does not re-implement it. 503 keeps the generic retry, and both ways out are the
same `LinkButton reload` links result.spec.ts already proved are keyboard-operable document
navigations.

Measured: **158/158** Playwright specs (6 zero-state and model checks added; S11's zero-build
spec now asserts the advice S14 renders in place of its old absence assertion, superseded,
not deleted), `check:tokens` 41 files, `check:i18n` 39 files, `typecheck`/`lint`/`build`
exit 0. The mock grew the `zeroBuildFloorAbsent` fixture and a reserved `rateLimited` id the
GET route serves as a real 429 with `Retry-After: 30`.

#### S15 — Share: WhatsApp, Web Share API, copy-link + share previews (1.5 h)
**Goal:** One-tap sharing of `/fr/config/[id]` (noindex page, rich preview) across the three
channels.
**Depends on:** S11
**Definition of done:**
- wa.me link with pre-filled French text + absolute URL; Web Share API where available with
  clipboard fallback ("Lien copié" via `aria-live`).
- Share buttons: `<a>`/`<button>` semantics, `aria-label`s, ≥ 44 px targets.
- OG/Twitter meta for `/config/[id]` (title includes total + "démo/indicatif/vérifié" honesty
  word), `robots: noindex` retained.
**Test scenarios:**
1. WhatsApp link URL-encodes text correctly and points at the canonical absolute URL.
2. Web Share unavailable (Playwright) → fallback copies link and announces success.
3. Meta tags present on a shared link: `og:title`, `og:description`, `og:image`, `noindex`.
4. Preview image renders within budget (explicit width/height, no CLS).

**Status: DONE 2026-10-21 — as built.** One canonical URL serves all three channels:
`absoluteResultUrl()` derives it from the REQUEST origin (`originFromHeaders()`, x-forwarded-first)
and re-encodes the id in the path, so an id can never become part of the authority and a wa.me
link, the Web Share payload and the og:url cannot disagree. The ORIGIN is validated before it
is used: the first forwarded hop is trimmed and parsed, and a Host that cannot name a URL falls
back to the local default rather than throwing inside generateMetadata (which silently dropped
every og/twitter tag from a page that still answered 200; a padded hop once made og:url resolve
as a relative url). The wa.me anchor is a real `<a>`
(target/rel noopener) built SERVER-side with the fr-formatted total and badge word, so it works
before any JS.

**Web Share is a feature check, not a sniff.** `ShareBar` (the page's ONE client island) reveals
the native-share button through `useSyncExternalStore` — server snapshot `false`, client
snapshot `navigator.share` present, no-op subscribe — so a device with the API gets its third
button with no hydration mismatch and no setState-in-effect cascade, and everything else keeps
WhatsApp + copy. The DoD fallback works both ways: success through the share sheet announces
NOTHING (no false "copied"), a failure copies the canonical URL and announces "Lien copié."
through a live region that exists EMPTY from the first render; a clipboard write without a
secure context falls to the textarea/execCommand path. The share surface is only rendered for
a pass that has builds: a zero-build page has nothing honest to advertise.

**The meta is the badge's vocabulary.** og:title says the REAL total of the RANK-1 build with
its `priceProvenance()` word, computed from the SAME request-scoped loader (`cache()` in
load.ts — `loadRecommendationCached` shares one API read between metadata, page and card;
metadataBase is the BARE origin — a base with a path hollowed og:image out of its own segment
and is pinned by a spec). A pass without a priced primary build shares a numberless sentence;
noindex stays. The og:image is a `next/og` factory (1200x630, Next 16's promised `params`,)
drawing the same total/word — its hex values are the compiled token constants, annotated per
ingredient, and `check:tokens` exempts ONLY the hex rule for that one file (Satori knows no
CSS). The Arabic card stays brand-level until S20 loads a face into Satori.

Measured: **168/168** Playwright specs (10 share + URL-model checks added), `check:tokens`
44 files, `check:i18n` 42 files, `typecheck`/`lint`/`build` exit 0; the og:image route answers
image/png in 34 KB.

### Phase W3 — SEO surface

#### S16 — Preset pages from GET /v1/presets (ISR) (2 h)
**Goal:** `/fr/config-pc-gamer-{budget}-dh` family generated from `GET /v1/presets` (CD-4) via
ISR, fixtures-first; noindex until real prices exist.
**Depends on:** S4, S11
**Definition of done:**
- Route + slug scheme pinned (`config-pc-gamer-{budget}-dh`, `{budget}` the plain integer);
  pages generated from preset data at build/ISR time — **zero client-side data fetch**.
- Feature check: `GET /v1/presets` absent → pages build from committed fixtures and stay
  noindex; present → real data with `revalidate` configured.
- Preset page reuses the results components (no second implementation).
**Test scenarios:**
1. Build-time generation: preset page HTML contains the build data (grep the built HTML for
   the total price) with no client fetch (Playwright asserts zero XHR to the API).
2. ISR: updating the preset fixture and revalidating changes the page.
3. `noindex` present on every preset page while prices are unverified.
4. Invalid budget slug → 404, not a crash.

**Status: DONE 2026-10-21 — as built.** `/fr/config-pc-gamer-{budget}-dh` exists for both locales
and is generated at build/ISR time from the ribbon: `generateStaticParams` prerenders the two
committed fixture budgets, `revalidate = 3600` (the literal Next requires) caches the result, and
`dynamicParams` stays at its default so a budget the ribbon gains later is rendered on first
request and then cached. The route segment is GENERIC — `app/[locale]/[presetSlug]` — because Next
has no partial dynamic segment and `/config-pc-gamer/9000/dh` is not the URL the DoD pins. The slug
grammar (`lib/presets/model.ts`) is one closed pattern built from the family list, and anything it
refuses is `notFound()`; that also means a single-segment typo inside a locale now reaches the same
styled locale 404 the catch-all produced. Concrete siblings (`/configurer`, `/config/[id]`, `/kit`)
still win, because a static segment outranks a dynamic one.

**The feature check is two paths, and both are proven.** At BUILD time the API is consulted only
when an API base is explicitly named (`API_BASE_URL` / `NEXT_PUBLIC_API_BASE_URL`): CI has neither,
so `next build` prerenders the committed fixtures deterministically and offline (the build reports
exactly four preset routes — two budgets × two locales). At REQUEST time the ribbon is always tried,
which is what makes `/fr/config-pc-gamer-20000-dh` — a budget `lib/presets/fixtures.ts` deliberately
omits — render on demand from `GET /v1/presets` and pass its own browser assertions. A named preset
whose pass read then fails PROPAGATES rather than falling back to demo data, so a failed ISR
revalidation keeps the last good page; the fixture fallback covers a budget the ribbon did not name
and a build that could not reach the API at all.

**noindex follows the DATA, in both directions.** `presetIndexable(source, builds)` allows an index
only for a page served by the API whose every build is `verified` — the same `priceProvenance()` the
S12 badge shows and the S19 gate refuses — so the two fixture pages are `noindex, follow` while the
API-served all-verified 20 000 page is not. That is W3's "noindex until real prices exist" as a
predicate rather than a deadline, and S18's sitemap can consume the same function.

**It reuses the results page, and feeds it.** Every build is S11's `BuildCard` (badge, budget bar,
component list, explanation) measured against the SLUG's budget; the page prints the pass's own
`disclaimer` and, when recorded, the calculation date. The ways forward are pre-filled: "Configurer
mon PC" opens the budget step with `use_case` and `budget_amount`, and "Voir la configuration
complète" links the ordinary pass the preset points at (Decision 48).

**One fixture defect was repaired, not routed around.** `PRESETS_OK` named a 6 000 budget with a
15 000 pass and an 8 000 id that did not exist, so any consumer would have shown a heading and a bar
that disagreed. The ribbon is now three resolvable, budget-matching entries (9 000 indicative,
15 000 verified, 20 000 verified), the third backed by a new all-VERIFIED GAMING pass; the
`api-contract` spec's preset counts moved 2 → 3 with it.

**S19's last open item is closed.** The preset page joined `lighthouserc.cjs`, and the harness now
probes EVERY configured URL for a 200 at its own path instead of only the first — the old
`const [measuredUrl]` destructuring would have budgeted one page and passed for the other.

Measured: **194/194** Playwright specs (8 preset-model + 10 preset-page checks added), `typecheck`
(also under Node 22.23.3), `lint` (0 errors, the one pre-existing `postcss.config.mjs` warning),
`check:tokens` (49 files), `check:i18n` (47 files) and `check:api-types` all exit 0, `npm run build`
exit 0 with the preset route reported `●` for exactly `fr` + `ar` × 9 000 + 15 000. Lighthouse on
the 9 000 page: LCP median **2334 ms** (samples 2332.34 / 2475.94 / 2334.02), CLS **0**, script
transfer **150 545 B** of the 174 080 B budget, performance 0.98 — both measured pages green under
the `error`/median assertions. The suite itself ran on the local Node 24; CI pins 22 and the
typecheck was re-run there.

**A rebuilt app can still serve a PRE-BUILD page (measured 2026-10-21).** `next start` keeps the ISR
route cache under `.next/server/route-cache`, and `next build` does not clear it: a page generated
on demand (the 20 000 budget) kept answering with the HTML the PREVIOUS server had written, so a new
assertion about that page failed against a stale copy while the compiled chunk already carried the
change. CI builds from an empty `.next`, so it never sees this; locally, remove `.next` before a
verification run that depends on an on-demand page's output, and never diagnose that failure as a
code defect.

#### S17 — Component pages + editorial guides (H6) (2 h)
**Goal:** Component detail pages from the catalog endpoints (CD-5) plus the editorial guide
content type (MDX), both fixtures-first.
**Depends on:** S4, S16
**Definition of done:**
- Component route renders name, specs, appearances in builds; fixtures drive it until CD-5.
- MDX pipeline for editorial guides (H6) with fr locale, consistent typography (§3), and the
  component pages' noindex policy applied.
**Test scenarios:**
1. Component page renders from fixture; unknown slug → 404.
2. Guide page renders MDX with headings hierarchy `<h1>`–`<h2>` (no skipped levels).
3. Long product names truncate gracefully at 360 px (no overflow).
4. Internal links between guides and preset pages resolve (link checker in CI).

**Status: DONE 2026-10-21 — as built.** `/fr|ar/composants/{slug}` reads
`GET /v1/catalog/products/:slug` (CD-5) on the SERVER, cached for an hour, and renders the
display name, the category as a word, the spec row, every offer with its provenance class, the
same disclaimer the results page prints, and a derived "Apparaît dans" list. `/fr/guides` and
`/fr/guides/{slug}` render committed MDX through `@next/mdx`, from a registry that also owns each
guide's title, description and content date.

**The component route is ISR, and getting there cost one real correction.** A dynamic segment with
`revalidate` but NO `generateStaticParams` is rendered fully DYNAMIC by Next (measured: `no-store`
in the response while the preset pages served `s-maxage=3600`). Declaring an EMPTY param list with
`dynamicParams` left at its default is the documented "render on first request, then cache" shape,
so the first visitor populates the entry and the next ones are served the cached page. The route
still prerenders nothing — CI builds with no API — and `e2e/catalog.spec.ts` pins the
`s-maxage=3600` so a regression to `no-store` is red rather than silent.

**Indexability follows the prices, and the strict half is not `price_status`.** `componentIndexable()`
requires at least one offer, `price_status === "verified"` AND every offer class VERIFIED — the last
clause repeats the API's own derivation on purpose, because an index entry outlives the render that
made it. The verified fixture is indexable; the all-seed GPU and the offer-less RAM kit are
`noindex, follow`. That is S16's rule applied to the catalogue, and S18's sitemap can consume it.

**Appearances are DERIVED, not fetched.** The contract has no "where is this part used" endpoint,
so the page walks the presets the site already serves (`presetsForBuild()` → the request-memoized
`loadPresetCached`) and keeps the builds whose components carry this product's slug. The claim is
therefore narrower than "every build the engine assembled" — it is "a build on a preset page we
serve" — and that is what the page says. Each appearance links its preset page, which is also the
internal-link surface the DoD's link checker exercises.

**The spec list is a module, not a template.** `lib/catalog/specs.ts` owns four rules: NULL is
omitted (never `0 mm` — the standing rule), every `*_id` is skipped (a reference, not a
specification), units come from the column's own naming (`_watts`, `_mm`, `_mtps`, `_mhz`), and a
fraction is NOT rounded (`width_slots: 3.5` rendered as "4" was the first defect found; integers
use the default formatter, non-integers two decimals). An unmapped key is shown verbatim rather
than hidden, so a new column is a visible copy gap; every key the fixtures serve has a label in
both locales, and `catalog.spec.ts` asserts no snake_case, no uuid and no engine word reaches the
page.

**The mock had to stop echoing slugs.** `GET /v1/catalog/products/:slug` answered 200 for ANY
slug, replaying one fixture body with the requested slug patched in, so "unknown product → 404"
was untestable and a component page could describe a product nobody serves. It now reads a
three-entry `CATALOG_PRODUCTS_BY_SLUG` map (verified GPU, offer-less RAM kit, 60-character GPU
name) and returns the real 404. The same defect class as S16's ribbon: a fixture that answers
questions it has no data for.

**MDX: what the pipeline actually required.** `@next/mdx` + `@mdx-js/loader` in `apps/web` only,
`createMDX({})` with NO plugins (Turbopack can only take plugin NAMES as strings, and nothing here
needs a transform), `pageExtensions` widened, and `mdx-components.tsx` at the package root — the
App Router convention, which re-exports the real map from `components/guides/mdx-components.tsx` so
the file that carries the classes stays inside `check:tokens`. That map is where logical properties
(`ps-5`, `border-s-2`) and the token scale live; it also downgrades a stray `#` to an `h2`, because
the PAGE owns the single `h1` and a body must not create a second one.

**The registry split is a test constraint, not a style choice.** `lib/guides/manifest.ts` holds the
metadata (pure TS) and `registry.ts` joins it to the compiled `.mdx` bodies. A spec cannot import
the registry: Playwright's TypeScript transform has no MDX loader, and it failed exactly that way
before the split (`Missing semicolon` at line 1 of the guide, from esbuild reading MDX as JS).

**Guides are French-only, and the Arabic side says so.** (SUPERSEDED 2026-10-22 by S20, which
translated both bodies and translated the index; the paragraph below is S17's record.) `/ar/guides` renders an Arabic note and
the link to `/fr/guides`, `noindex` (thin, and not translated); `/ar/guides/{slug}` is a 404 rather
than an Arabic frame around French prose. S20 owns the translation and the `hreflang ar` alternates
that S18 will then be able to emit.

Measured: **208/208** Playwright specs (7 catalogue + 5 guide checks added), `typecheck` (also
under Node 22), `lint` (0 errors, the one pre-existing `postcss.config.mjs` warning), `check:tokens`
(57 files), `check:i18n` (55 files), `check:api-types` and `npm run build` exit 0 — the build
reports `/[locale]/guides/{slug}` as `●` for exactly `fr` × 2 guides, `/[locale]/composants/[slug]`
as `●` with no params, and the four preset routes unchanged. `test:lighthouse` exit 0 with all
three assertions green on both fixture URLs (LCP 2.32–2.35 s, CLS 0). The link checker (spec
scenario 4) follows every internal href on the index and on both guides and fails on any non-200.

Not done here, deliberately: the canonical origin for prerendered pages, `sitemap.xml`, `robots.txt`,
`hreflang` and the preset/guide OG images are S18's; component names inside `BuildCard` are NOT
linked to these pages (that would re-open S11/S12/S15's pinned cards).

#### S18 — sitemap, robots, canonical + hreflang, OG images (1.5 h)
**Goal:** The crawl surface: sitemap.xml, robots.txt, canonical URLs, hreflang (per V9), and
OG image generation for preset/guide pages.
**Depends on:** S16, S17
**Definition of done:**
- sitemap lists only indexable pages (presets/guides/components when un-noindexed);
  `/config/[id]` **excluded permanently**; robots.txt allows the site, disallows nothing needed,
  points to the sitemap.
- Canonical self-referencing on every page; hreflang `fr` + `x-default` now, `ar` alternates
  only once S20 renders them (V9).
- OG images generated per preset (static, optimized, explicit dimensions).
**Test scenarios:**
1. sitemap.xml validates and contains no `/config/` URLs.
2. `/fr` canonical is absolute and self-referencing; no hreflang to a 404 route.
3. OG image on a preset page passes the sharing debugger's size guidance (≤ 8 MB, ≥ 200×200 —
   assert dimensions and weight in CI).
4. robots.txt references the sitemap and returns 200.

**Status: DONE 2026-10-21 — as built.** `/sitemap.xml` and `/robots.txt` exist as Next metadata
routes, every shipped page carries an absolute self-referencing canonical plus `fr` +
`x-default` `hreflang`, and every preset page has its own 1200 x 630 card.

**The origin comes from CONFIGURATION, and a bad value fails the build.** This was S18's one open
decision: a prerendered page cannot call `headers()` without becoming dynamic, so the canonical
origin had to come from somewhere other than the request. It is `NEXT_PUBLIC_SITE_URL`
(`lib/seo/site.ts`), read at build/request time, with `http://localhost:3210` as the UNSET
default — so no build depends on ambient state and a local crawl is self-consistent. A MALFORMED
value throws (`exemple.ma` with no scheme, a non-http protocol, or an origin carrying a path)
rather than falling back, because a fallback would ship exactly the localhost-canonical defect the
variable exists to prevent. The layout sets `metadataBase` from the same helper, and every page's
canonical is ABSOLUTE anyway, so a future base change cannot silently re-root it. A deployment
MUST set it; the name is documented in `apps/web/.env.example`.

**Every shipped route names itself, including the noindex ones.** Home, `configurer`, preset,
component, guides index, guide and `/config/[id]` all carry a canonical — the result page's is the
request's own URL, matching its S15 `og:url`, because a result is a per-request address rather
than a document with a configured home. The three internal design pages (`kit`, `format`, `tokens`)
stay canonical-free: they are `noindex` style sheets, not crawl surface, and their metadata is
static.

**hreflang is `fr` + `x-default`, both naming the FRENCH page (V9).** (SUPERSEDED 2026-10-22 by
S20: `ar` is now emitted and names its own URL.) Not the page's own locale:
before S20 the Arabic side is not a translated surface, and `/ar/guides/{slug}` is a 404, so an
`ar` alternate would annotate a route that does not exist. `e2e/seo.spec.ts` fetches every
annotated URL and requires a 200 — the "no hreflang to a 404" half of the DoD is a live assertion,
not a review note.

**The sitemap is DYNAMIC, and that is a correctness choice.** A metadata route is static by
default, which would have frozen a build-time catalogue into the artifact: CI builds with no API,
so the committed sitemap would describe the fixture site forever. `force-dynamic` renders it per
request; the reads under it are still `next.revalidate`-cached, so a crawl costs a few cached API
reads. It cannot 500 either — both loaders degrade to FEWER entries
(`indexableComponentSlugs` returns `[]` on a dead list, `presetsForBuild` logs and continues), and
a shorter sitemap is the honest failure for a document whose contract is "only indexable pages".

**"Only indexable" reuses the predicates the pages already use.** Presets are gated by
`presetPageIndexable()` (S16's rule: API-sourced AND every build verified) and components by
`componentPageIndexable()`; both apply that rule to the loader outcome, so the sitemap makes the
same CALL the page's `robots` tag makes rather than a second spelling of it. The catalogue walk is two-phase on purpose: `GET /v1/catalog/products`
carries ONE `offer_class` per product, so it only nominates candidates, and a per-candidate
product read decides — a product with one verified and one placeholder offer is indexable-looking
in the list and not indexable in fact. `/config/` is excluded permanently and asserted absent.
URLs are French only; `ar` URLs and `ar` alternates are S20's, on the same V9 boundary. (S20
landed 2026-10-22: both locales are listed, each entry carrying its `xhtml:link` pair.)

**robots.txt disallows nothing, deliberately.** The obvious candidate — `/config/[id]` — answers
`noindex, follow` in its own HTML, and a `Disallow` would hide that tag from the crawler, which is
how a URL-only index entry happens. `Sitemap:` is absolute, from the same helper.

**The preset card is a file, not a render per fetch.** `opengraph-image.tsx` is a function of the
slug alone (no API, no translations, no clock), so it is deterministic. It needed its own
`generateStaticParams`: without one the image route was `ƒ` in the build table even though the
page it belongs to was `●` — measured, then fixed, and the build now lists four `●` card routes
for the two fixture budgets x two locales. The card carries the BUDGET, never a build total, so a
share preview cannot claim a provenance the page does not have, and its text is French-only like
S15's result card (Satori has no Arabic face).

Measured on the final tree: **215/215** Playwright specs (7 new in `e2e/seo.spec.ts`),
`typecheck`, `lint` (0 errors, the pre-existing `postcss.config.mjs` warning), `check:tokens`
(62 files, with one more hex exemption for the new Satori card), `check:i18n` (60),
`check:api-types`, `npm run build` exit 0 with `/[locale]/[presetSlug]/opengraph-image` `●` for
four routes and `/sitemap.xml` + `/robots.txt` `ƒ`, and `test:lighthouse` exit 0 (median LCP
2328 / 2325 ms, CLS 0, script 145 981 / 150 545 B — unchanged by a metadata-only sprint). The
sitemap was checked in both directions against the fixture mock (the 20 000 API preset and the
verified GPU listed; 9 000, 15 000, the offer-less RAM kit and the long-name GPU absent) and with
NO API configured (four entries, HTTP 200, no error). The card's PNG was decoded: 1200 x 630,
40 190 B, and no ink in the right or bottom margin, so nothing is clipped.

Not done here, deliberately: the `ar` URLs, `ar` alternates and translated guides are S20's;
component names inside `BuildCard` are still not links (S17's boundary); and the canonical origin
is UNSET in CI, so the suite asserts against `http://localhost:3210` — a deployment that forgets
`NEXT_PUBLIC_SITE_URL` will advertise localhost, which the helper documents and the spec pins as
the local default.

**Re-verified 2026-10-22, with one caveat the audit above did not state.** Green on this tree:
`typecheck`, `lint` (0 errors, the same `postcss.config.mjs` warning), `check:tokens` (62 files),
`check:i18n` (60), `check:api-types`, `next build` (four `●` card routes, `ƒ` sitemap + robots),
**215/215** Playwright specs under `E2E_BROWSER_API=1` — 214 + 1 pre-existing skip without it,
which is why a bare local `npm test` reports 214 passed — and `test:lighthouse` exit 0. The
sitemap was re-measured in both directions on a production build: with the fixture API it lists
seven URLs (home, the wizard, the guide index, both guides, the 20 000 preset, the verified GPU)
and all seven answer 200; with NO API and with a CONFIGURED BUT DEAD API
(`http://localhost:3999`) it answers **200 with four** and logs the degradation; a malformed
`NEXT_PUBLIC_SITE_URL=https://exemple.ma/fr` fails `next build` (exit 1) naming the variable, and a
valid one (`https://exemple.ma`) moves
`/sitemap.xml` and `/robots.txt` to that origin. The card was decoded again: PNG signature,
1200 x 630, 40 190 B, and it renders unclipped at 1400 px.

**One predicate per page type, and the wizard listed.** The sitemap and the pages now share one
call each — `presetPageIndexable()` and `componentPageIndexable()`, which apply the existing
`presetIndexable()`/`componentIndexable()` rules to the loader OUTCOME — because three sites (the
page's `robots` tag, its JSON-LD gate and `/sitemap.xml`) each spelled `orderBuilds(...)` plus the
conjunction by hand. That is how a sitemap starts listing a page whose own tag says `noindex`:
the two documents only stay in step while someone remembers both. `/configurer` joined the
listing too — it sets no `robots`, it carries a canonical, and its four steps are query strings
on ONE url — and `e2e/seo.spec.ts` now proves the invariant generically in the other direction:
every advertised URL must answer 200 AND must not say `noindex`. Measured after the change: build
exit 0, 215/215 specs, and all seven listed pages serve `index` (two explicitly, five by the
crawler's default).

**The caveat: `NEXT_PUBLIC_SITE_URL` is a BUILD-TIME value for every prerendered page.** Measured
the same day: a server started with `NEXT_PUBLIC_SITE_URL=https://exemple.ma` but from a build
without it serves `/sitemap.xml` and `/robots.txt` at `https://exemple.ma` **while `/fr` still
answers `http://localhost:3210/fr`**, because a prerendered canonical is baked and the two crawl
routes are `force-dynamic`. That is the split the origin module exists to prevent, so the contract
is: set the variable for `next build` and let `next start` inherit it — the helper's header and
`apps/web/.env.example` now say so, and `e2e/seo.spec.ts` cannot catch it because the suite builds
and serves from one environment.

**The catalogue walk is bounded (same day, measured).** `indexableComponentSlugs()` used to confirm
candidates ONE read at a time inside a single request — 2 000 products meant 2 000 sequential reads,
and a crawl that times out before it receives anything. It now runs four reads at a time inside ONE
15 s wall-clock budget shared with the listing pages, keeps keyset order by writing each result at
the candidate's POSITION rather than in completion order, and stops starting work at the first 429
instead of firing the rest of the list into a limiter that allows 120 requests a minute — four, not
forty, is chosen against that limit. Measured against a contract-shaped fake API: 40 products at
200 ms each -> 45 URLs in 2.2 s (the same reads sequentially: 8.4 s), entries contiguous
`produit-000..039`; 120 products at 800 ms each -> 81 URLs, HTTP 200, a contiguous prefix
`produit-000..075`, and `sitemap: the catalogue walk hit its 15000 ms budget; 44 product(s) went
unverified` in the log; a fake that answers 429 after 8 reads leaves 13 URLs (`produit-000..007`),
`sitemap: the catalogue API rate-limited the walk; 28 product(s) went unverified`, HTTP 200. The
worst case is the budget plus one in-flight read (which keeps its own 5 s timeout),
independent of catalogue size. **Pinned by CI since 2026-10-22.** The fixture mock gained a
slow-catalogue mode (`MOCK_CATALOG_SLOW=1`: a synthetic catalogue of `MOCK_CATALOG_SLOW_SIZE`
products, every one VERIFIED, each detail read delayed by `MOCK_CATALOG_SLOW_DELAY_MS`), because
three fixture products can never reach a 15 s budget. `e2e/sitemap-budget.spec.ts` starts a SECOND
instance of that mock, points the server API root at it and calls `indexableComponentSlugs()`
itself, then asserts what only a real deadline can show: products are left unverified, the call
returns within the budget plus ONE in-flight read's timeout, what it did verify is a clean prefix in
keyset order, the reads overlapped (the same reads sequentially would take far longer), and the log
names the budget and the count left unverified. Measured: 40 products at 2 s each -> 32 verified in
16.2 s, 8 named as unverified, `RESULT` 237/237 in the suite. Proven RED by deleting the deadline
check (`Date.now() >= deadline`): all 40 verified and the prefix assertion failed, so the spec pins
the bound rather than the harness's own arithmetic.

#### S19 — JSON-LD gating + performance budgets (2 h)
**Goal:** Product + Offer JSON-LD (MAD) only when `price_status` is verified — never demo
prices — and the W3 performance budgets enforced in CI.
**Depends on:** S12, S16
**Definition of done:**
- JSON-LD emitted only on `price_status = verified` pages; a build-time/runtime check makes
  "demo price marked up" unrepresentable (the serializer refuses non-verified).
- LHCI budgets enforced as failures: LCP ≤ 2.5 s, CLS ≤ 0.1, initial JS ≤ 170 KB (promote
  from S6's warning), no client-side data fetch on preset pages.
**Test scenarios:**
1. Verified-price fixture page → JSON-LD present with `priceCurrency: "MAD"`; démo/indicatif
   fixture → **no** JSON-LD (regression test).
2. LHCI red when a budget is exceeded (prove with an injected regression).
3. JS budget: initial bundle measured ≤ 170 KB gzip on a preset page (CI check).
4. Structured-data validation passes on the verified fixture (schema.org types correct).

**Status: DONE 2026-10-21 — both halves are in the tree and the budgets are enforced.** DoD
scenario 3 named a PRESET page, which S16 added to the measured URL set the same day; the record
below is what landed.

**Landing 2026-10-21: the budgets are `error`, and the result page carries the gate.**
`lib/result/structured-data.ts` makes "a demo price marked up" UNREPRESENTABLE rather than
guarded: `asVerifiedPricedBuild()` is the only constructor of the branded
`VerifiedPricedBuild` that `productJsonLd()` accepts, and it refuses a demo price, an
indicative one, and a verified build with no total. The gate reuses `priceProvenance()`
(the three-state answer the badge shows), not `price_status` — the API's status cannot tell
an all-SEED_UNVERIFIED pass from a half-quoted one, and it is vacuous for a build with no
components. The page emits ONE `Product`+`Offer` for the rank-1 verified build, priced with
its own unformatted `total_price` in MAD; names come from the localized og:title sentence, so
the unfurled card and the crawled block cannot advertise different amounts. `jsonLdScript()`
escapes `<`, so a product name cannot close the script element. Pinned by
`e2e/structured-data.spec.ts` (8 specs: three refusals, the serializer's own shape, the
escaping, and three page assertions over RAW HTML) plus S12's badge spec.

**`aggregationMethod: "median"` is part of the enforcement.** LHCI's default is `optimistic`
— the MINIMUM of the three runs for a max-assertion — so on master a 3.09 s sample passed the
2.5 s budget because two samples were 2.36 s. Under `median` the aggregate is the middle
sample. **Proven, not asserted:** with the threshold temporarily set to 2000 ms the harness
exited 1 and the assertion reported `found: 2337.2086` from samples 2331.1704 / 2337.2086 /
2476.5688 — the MEDIAN, not the 2331.17 minimum an `optimistic` aggregate would have
reported. Restored to 2500 ms every assertion passes (one run: 2326.6 / 2329.6 / 2341.8 ms,
median 2329.6 ms, CLS 0, script transfer 145 981 B). DoD scenario 2 by construction: the
threshold was the injected regression, and it turned the run red (exit 1).

**CLOSED 2026-10-21 (S16):** DoD scenario 3 named a PRESET page, and presets were S16's — the
`preset` route did not exist when this sprint landed, so the 170 KB script budget was measured on
the fixture RESULT page. S16 added `/fr/config-pc-gamer-9000-dh` to `lighthouserc.cjs` and made the
harness probe every configured URL, so the budget is now enforced on a real preset page too
(median LCP 2334 ms, CLS 0, 150 545 B of script). S18 still owns the crawl surface; nothing here
blocks it.

### Phase W4 — Hardening

#### S20 — Arabic / RTL pass (2 h)
**Goal:** Full ar locale with correct RTL layout on every shipped route; Arabic copy parity.
**Depends on:** S5, S11–S19
**Definition of done:**
- All fr strings have ar translations; `/ar/*` mirrors every shipped fr route.
- Logical-properties audit passes (no physical direction classes anywhere).
- Arabic fonts render correctly (subset verified against actual copy — no tofu).
- hreflang `ar` alternates + sitemap ar URLs now live (completing V9).
**Test scenarios:**
1. Screenshot diff (Playwright) of `/fr` vs `/ar` for wizard step 2 and results: mirrored
   layouts, correct order (progress bar, stepper, share buttons).
2. i18n completeness gate: missing `ar` key fails CI.
3. Mixed-direction content (Latin product names inside Arabic sentences) renders without
   bidi corruption.
4. Numbers remain Western Arabic numerals with `Intl` formatting in `ar-MA` (per product
   choice — pinned by a test).

**Status: DONE 2026-10-22 — as built.** Every shipped route renders in both locales, the guides are
translated prose rather than an Arabic frame around French text, and the crawl surface advertises
the pair. **V9 is CLOSED.**

**The guides' `ar` story WAS the decision, and translating them was the cheap half.** S17 shipped
two French `.mdx` bodies and a deliberate 404 under `ar`; the alternative — an Arabic heading
around French prose — was worse than saying so plainly. S20 wrote `content/guides/*.ar.mdx` and
made the LOCALE a dimension of the registry instead of a branch in the route: `manifest.ts` carries
`{ title, description, updated }` per locale, and `registry.ts` joins `{ fr: body, ar: body }` per
slug, throwing at module load with the slug AND the locale in the message if either is missing.
That check in both directions is what lets `pageAlternates()` emit an `ar` alternate for every
guide: the route prerenders the CROSS PRODUCT (`guideStaticParams()`), `dynamicParams` stays false,
the build lists four `●` guide routes, and the index is ONE list rendered in the route's language —
the `ar` note, its `noindex` and the three `frOnly*` message keys are gone.

**The date is per locale.** `GuideText.updated` is the date THAT prose changed, so the Arabic
bodies read 2026-10-22 while the French text still reads 2026-10-21. One shared date would claim
the French guide changed the day it was translated; a build timestamp would claim both change on
every deploy. `app/sitemap.ts` takes `lastModified` per locale for the same reason.

**hreflang is `fr` + `ar` + `x-default`, and the sitemap emits the same map.** `localeAlternates(path)`
is the single source now: `pageAlternates()` calls it for the `<head>`, and the sitemap calls it per
listed page for the per-entry `xhtml:link` set, so the document and the HTML cannot advertise
different pairs. V9's precondition is ENFORCED, not commented: `e2e/seo.spec.ts` fetches every
annotated URL and requires 200 — the assertion that goes red if a French-only page ever ships an
`ar` alternate. Each page's `fr` and `ar` entries come from one `perLocale()` call, so listing one
sibling without the other is not expressible. Measured on the fixture site: **14 `<loc>` entries**,
`xmlns:xhtml` on the urlset, three alternates on every entry.

**RTL needed two code changes and no stylesheet.** S2's logical-property policy had already done
the work: `app|components|lib` contain no `ml-/mr-/pl-/pr-/left-/right-/border-l-/border-r-/`
`rounded-l-/rounded-r-/text-left/text-right`, no `space-x-`/`divide-x-`, and no inline
`dir="ltr"`; `check:tokens` (62 files) passes unchanged. What the screenshots DID find was bidi
ownership: a Latin product name must resolve its own direction, and putting `dir="auto"` on the
component page's `h1` left-aligned that one heading on `/ar`. The fix is the standard one — the
attribute moved to a `<span>` INSIDE the heading — so the name keeps LTR ordering while the block
keeps the page's alignment. `dir="auto"` also went on `ComponentRow`'s name and on the spec-value
`dd`s, and the component page is the reference case: "RTX 4060 8GB" under a right-aligned Arabic
eyebrow.

**Numbers: Western digits, unit `DH` in both locales — decided, not defaulted.** `ar-MA` selects
the `latn` numbering system, so ICU already emits "7 300" and never the Eastern Arabic-Indic
block. That is right for a page mixing model names ("RTX 4060"), capacities and prices: a second
numeral system would misalign every price column and disagree with the API's own values. The unit
stays `DH` rather than `د.م.` because the Arabic wizard copy already quotes `DH` in three places
(`budgetSuffix`, the clip guidance, the OG description) — switching only `formatMoney()` would
print two spellings of one unit on one page, which is the defect the decision avoids. Changing it
is a copy-wide act, not a formatting one, and `lib/i18n/format.ts` says so. Bidi note for whoever
does change it: in an RTL paragraph `8594\u00A0DH` already renders number-then-unit in READING
order (the unit sits to the LEFT of the digits), so the Latin unit is not "backwards" — measured
with `Range` rects rather than assumed.

**The missing-key gate was the actual hole.** Both catalogues already held 222 keys, but nothing
compared them: `next-intl` resolves a missing key at RENDER time, so a key added to `fr` would
build green and fail only on `/ar`. `scripts/check-i18n.mjs` gained rule 5 — `messages/fr.json` is
the reference and every other catalogue must carry the same KEYS and the same ICU PLACEHOLDER set
per key (a `{amount}`/`{montant}` drift renders literal braces). Proven to fire, not assumed:
injecting one `fr`-only key, then one extra placeholder in `ar`, each produced exit 1 naming the
key; the clean tree passes.

**`e2e/rtl.spec.ts` is the RTL proof, and it asserts GEOMETRY.** 21 specs: the wizard's `<ol>` and
the share group keep their DOM order while their `x` centres strictly descend on `/ar` and ascend
on `/fr`; the budget bar's fill is anchored to the inline start (right edge on `/ar`, left on
`/fr`) at the same fraction; prices carry no Eastern Arabic-Indic digit and do print `DH`; a Latin
name inside the Arabic page computes `direction: ltr`; the Arabic guide body is Arabic prose (not
the French body) in an RTL article with Arabic-only internal links; and all seven Arabic routes
satisfy `scrollWidth - clientWidth <= 0` at 360 px. Six full-page PNGs are attached to the run
(`ar-home`, `ar-wizard-budget`, `ar-result`, `ar-guide`, `ar-component`, `fr-result`) instead of
stored as `toHaveScreenshot()` baselines: a baseline nobody refreshes fails a build on a
font-rendering difference and teaches the team to skip it, while the assertions are what redden.
Reviewing those PNGs is how the `h1` alignment bug above was found — the numbers were green and
the heading was visibly wrong.

**Measured on the final tree:** `typecheck` 0, `lint` 0 errors (the pre-existing
`postcss.config.mjs` warning), `check:tokens` 62 files, `check:i18n` 60 files + 2 catalogues,
`check:api-types`, `next build` exit 0 (four `●` guide routes), and **236/236** Playwright specs
with `E2E_BROWSER_API=1` (215 before this sprint; 235 passed + the pre-existing browser-API skip
without the flag).

**Two honest limits.** First, the API's own `disclaimer` string is served in FRENCH and the web
renders it verbatim on `/ar/config/...`, `/ar/composants/...` and the Arabic preset pages —
visible in the screenshots as "Prix indicatifs, non actualisés." under an otherwise Arabic page.
That text belongs to the v1.5 contract and the web layer must not re-author it, so the fix is a
localized disclaimer in the API, not a string here. Second, the OG cards stay French-only:
Satori has no IBM Plex Sans Arabic face, so a shared `/ar` link previews French text — unchanged
from S15/S18, and still open.

Not done here, deliberately: no visual-regression baselines (above), no per-locale OG cards, and
`kit`/`format`/`tokens` stay French and `noindex` — they are style sheets, not crawl surface.

#### S21 — WCAG AA + Web Interface Guidelines audit (2 h)
**Goal:** A real accessibility pass: axe clean + manual keyboard/screen-reader sweep of the
full FR flow at 360 px.
**Depends on:** S20
**Definition of done:**
- axe (Playwright integration) zero violations on every route; documented manual checklist
  signed off (focus order, announcements, zoom to 200%, contrast).
- Wizard completable keyboard-only at 360 px; error focus management verified.
- No anti-patterns from the guidelines (no `user-scalable=no`, no `transition: all`, no
  click handlers on non-buttons, all images sized).
**Test scenarios:**
1. axe suite over all routes × both locales = 0 violations.
2. 200% browser zoom: no content loss or horizontal scroll.
3. Screen-reader smoke: wizard steps announce step changes; loading announces progress;
   errors announce and receive focus.
4. Contrast ratios of every token pair measured ≥ 4.5:1 (automated).

**Status: DONE 2026-10-22 — as built.** `apps/web/e2e/a11y.spec.ts` is 47 checks and runs in
`npm test`, so CI already runs it: 40 axe runs (20 routes × 2 locales), 3 zoom checks, and 4
interface-guideline checks. `@axe-core/playwright` `^4.14.0` is a devDependency; the workflow
needed no new command. **0 violations.** The audit record — method, route matrix, the manual
table with the spec that pins each line, the three deliberate breaks that proved the gate
fires, and the limits — is [docs/design/ACCESSIBILITY_AUDIT.md](../design/ACCESSIBILITY_AUDIT.md).

Four decisions are worth keeping:

1. **The route table is written out, and every audited route also asserts its STATUS and a
   non-empty `h1`.** The first version had neither, and `/ar/kit` + `/ar/tokens` failed it:
   they answer 404 because S20 left those style sheets French-only. The fix is not to drop
   them but to say so — the Arabic URL is asserted to be a 404, so "French-only" stays a
   decision. Without the status/h1 assertion a route that fell through to an error shell
   would pass an axe run that never looked at the page it named.
2. **`document.fonts.ready` precedes every run.** axe measures contrast from what is
   PAINTED, and a fallback face mid-swap is a different pixel value from the shipped one.
3. **The two source anti-patterns are checked as source, not as DOM.** "No click handler on
   a non-interactive element" and "no `transition: all`" cannot be observed in a rendered
   page, so the spec scans `app/` + `components/` — the first matching a tag's attribute list
   up to its closing `>`, so a handler written on its own line is still caught.
4. **Zoom is browser zoom, i.e. a CSS-pixel change.** "200 %" is the layout at half the
   width: 640 px for a 1280 desktop. Asserted on the wizard (both locales) and a result page:
   no horizontal scroll, and `main` + `banner` + `contentinfo` still in the layout.

Proven RED three times, each reverted: an `<img>` without `alt` failed BOTH home tests and no
other route (`image-alt [critical]`); a 900 px fieldset made the zoom test fail with **276 px**
of overflow at 640 px; a `<div onClick>` failed the static check naming
`app/[locale]/page.tsx:50`. Measured: 47/47 in the spec, no violation reported anywhere.

**The honest gap: no screen reader was driven.** The DoD's "screen-reader smoke" is satisfied
as the DOM contract those tools consume (names, roles, `aria-live`, `aria-valuetext`, focus
movement), each pinned by an S7/S10 spec; no NVDA/VoiceOver/TalkBack session was run, and the
audit record says so instead of implying otherwise. That is the next step, not a passed one.

#### S22 — Legal pages, analytics, final states (1.5 h)
**Goal:** Legal pages (H4) wired in header/footer, analytics integrated behind one module
(OD5), and the empty/error/rate-limited states finalized across the app.
**Depends on:** S21
**Definition of done:**
- Legal pages (mentions légales, confidentialité, contact) linked from every page's footer;
  fr + ar.
- Analytics module (Plausible or Umami) with `lazyOnload`, no PII, no render-blocking; a
  single documented events map (wizard step completed, config generated, share used).
- All error/empty states share the Alert primitive and consistent voice ("what happened + fix").
**Test scenarios:**
1. Analytics script never blocks rendering (LCP unchanged ±5% measured).
2. No query params containing budget/user input are sent to analytics (network assert).
3. Footer legal links resolve in both locales;404 page links them too.
4. Every error state copy reviewed against the voice rules (active voice, fix stated).

**Status: DONE 2026-10-22 — as built.** Three legal pages (mentions légales, confidentialité,
contact) exist in both locales, are listed in the sitemap, and are linked from the footer of every
page — the 404 included, because that page renders inside the layout. Analytics is one module
(`lib/analytics.ts`) behind `GET /api/analytics/config`, so the provider is a DEPLOYMENT setting
rather than a build constant; its events map is three events whose props are closed value sets, and
the injected tag always carries `data-exclude-search` / `data-exclude-hash`. The inventory of states,
the copy review and the analytics contract live in
[docs/design/STATES.md](../../docs/design/STATES.md).

Three things are worth recording, because each one is a place the obvious version is wrong:

1. **The build-time `NEXT_PUBLIC_*` version of analytics cannot be tested, and cannot be switched
   off without a rebuild.** Every page is prerendered, so a public env var is frozen into the HTML.
   The config therefore comes from a force-dynamic route that reads the server's environment, and
   the suite proves the loader by intercepting THAT route (`e2e/analytics.spec.ts`): unconfigured is
   `{provider: null}` and not one third-party request is made; configured, the tag, its attributes,
   the events and their payloads are all asserted.
2. **"After the load event" is not late enough — measured, not assumed.** Starting the loader at
   `load` moved LCP from 2 408 ms to 2 585 ms on the result page and 2 412 -> 2 587 ms on the preset
   page (+7 %, over the 2 500 ms budget CI enforces). The request was competing with the page's web
   font; the fix waits for `document.fonts.ready` and then an idle callback, after which the same
   harness reads 2 329/2 330 ms against 2 337/2 324 ms with analytics off. Both rounds are tabulated
   in STATES.md.
3. **A state must be drawn by the primitive, not merely look like one.** `e2e/states.spec.ts`
   asserts `data-tone` and the live-region role for the clamp, the zero-build result, the 429 and the
   options failure; the clamp moved out of its bespoke `<p>`, and the 429 panel gained the
   `role="status"` it was missing (it is the result of an action, and a warning is not a live region
   by default).

**Honest gaps.** No real Plausible/Umami account was exercised — the vendor half of the
"no query string" claim rests on their documented `data-exclude-search` behaviour plus the attribute
this app sets, and the LCP rounds used a local stub script rather than the vendor's bytes. The legal
pages name the fields that must be filled before commercial launch (publisher identity, host,
contact channel) instead of inventing them; `docs/design/STATES.md` §5 records where they are.

### Phase W5 — Post-beta (excluded from M3)

#### S23 — Component detail v2 + compare (2 h, post-beta)
**Goal:** Deep component pages and a compare view (2–3 components side by side).
**Depends on:** S17, CD-5
**Definition of done:** compare state in URL (shareable), keyboard-operable table semantics,
RTL-safe; spec diffs highlighted with text (not colour alone).
**Test scenarios:** compare URL shared → renders identical selection; diff highlighting has a
text equivalent; 360px compare falls back to stacked cards.

**Status: DONE 2026-10-22 — as built.** `/{locale}/composants/comparer?slugs=a,b` compares two or
three products, and the URL is the whole state: no cookie, no store and no client JavaScript, so
every control is a link and the Back button undoes an addition. The comparison is ONE semantic
table — a caption, `scope="col"` headers and a `scope="row"` header per fact — and below 640 px
the rows STACK as CSS on that same DOM. The per-value labels that appear in the stack are
`hidden`, not `sr-only`, at wide widths, so a wide screen reader does not hear each product’s name
once per cell on top of the column header. A difference carries the WORD « Diffère » (Arabic
«مختلف») and a count line, never colour alone, and a fact only one product publishes reads
« Non renseigné » rather than `0` or a dash — `presentSpecs()` still owns the formatting, so the
two views cannot disagree about a value.

The component page gained the ENTRY POINT, which is what made "v2 depth" a real deliverable: a
« Comparer des composants » section lists same-category siblings as `?slugs=this,that` links, and
« Ouvrir la comparaison » starts a one-product view that the picker (and the whole catalogue, when
the selection is empty) can grow. Two rules stop the view from lying: only the SAME category can
be compared — a GPU beside a RAM kit would render every row as "unknown" and call it a comparison
— and every wrong selection is answered in words rather than by disappearing: a repeated slug, a
fourth slug, a slug the catalogue does not serve, and a catalogue read that FAILED (reported per
product, so one sibling’s hiccup cannot take the view down).

Two smaller decisions worth keeping. **The summary sentence avoids plural agreement** — « Écarts :
4 sur 5. Identiques : 1. » — because "1 identiques" is wrong, and ICU plurals with Arabic’s six
categories is more machinery than the sentence needs. **The candidates come from one page of the
listing**, filtered by `category` in the web layer: the route’s `role` filter speaks the ENGINE’s
vocabulary (`CPU_COOLER`, `RAM`) while a product carries `product_category` (`COOLER`, `MEMORY`),
and restating that mapping here would be a second vocabulary that can drift.

Measured: **11** compare specs and **319/319** in the full suite with `E2E_BROWSER_API=1`;
`typecheck` and `build` exit 0 (the route reports `ƒ` dynamic, `[slug]` keeps `●`), `lint` 0 errors
(the pre-existing `postcss.config.mjs` warning), `check:tokens` 72 files, `check:i18n` 70 files + 2
catalogues, and `e2e/a11y.spec.ts` is now **49** checks — the compare route is audited in BOTH
locales at 360 px, i.e. in the stacked layout, which is why the table’s roles are explicit: a
display change is exactly where table semantics go missing. The fixture gained a SECOND GPU
(`rtx-4070-12gb`) that shares `width_slots` with the first and differs on the rest, plus one fact
the first does not publish, so the diff, the identity and the unknown cell are all real data.
The RTL spec asserts the mirror GEOMETRICALLY: column one sits at the inline start, which is the
right edge on `/ar`, while the DOM order stays A then B.

#### S24 — Swap within a build (2 h, post-beta, CD-8)
**Goal:** Component swap inside a build card, driven by the Platform swap endpoint (CD-8).
**Depends on:** CD-8 (swap endpoint), S11
**Definition of done:**
- Swap UI lists swappable roles; the API's compatibility warnings/price deltas are preserved
  and surfaced (never re-derived client-side).
- While CD-8 is absent: the control renders disabled with an explanatory tooltip, not hidden
  (honest future state), and no fake swap is simulated.
**Test scenarios:**
1. Swap a GPU → totals, budget bar and provenance badges all update from the API response.
2. Swap producing a compatibility warning → warning shown inline, in words.
3. CD-8 absent → control disabled with explanation; no request fired.

**Status: NOT STARTED 2026-10-22 — BLOCKED on CD-8, with one buildable slice.** The swap endpoint
does not exist and no platform sprint owns it, so the DoD's own fallback is the only honest
deliverable today: a control rendered disabled with an explanation, firing no request and
simulating nothing. That slice does not earn a sprint — it must be revisited the moment the endpoint
lands, and alone it proves nothing about the platform path the sprint exists to exercise.

#### S25 — Price history + saved builds (2 h, post-beta)
**Goal:** Price history for components/builds, and saved builds (local-first, no account).
**Depends on:** S11, S23 (component pages)
**Definition of done:**
- Price history chart with a text summary equivalent (accessible), `Intl`-formatted dates and
  prices, RTL-safe.
- Saved builds via `localStorage` with honest copy that saves are device-local and account-less.
**Test scenarios:**
1. Chart renders with `aria` text summary; screen-reader smoke reads the trend sentence.
2. Save a build → survives reload; clearing storage shows the empty state with a CTA.
3. localStorage quota/unavailable (private mode) → graceful inline notice, no crash.

**Status: DONE 2026-10-23 — saved builds SHIPPED, and the price history SHIPPED on the route it unblocked.**
`GET /v1/catalog/products/:slug/price-history` landed the same day (contract v1.6, Decision 51) and
serves one point per observation MOMENT at that moment's cheapest price, oldest first, with the change
fields null until two moments exist — so the chart was built against a real shape and the three thin-data
states are the norm today, not an edge case. The chart reads that route. A build can be
saved from every card, on the results page AND the preset page, and the shelf is
`/{locale}/enregistrements` — reachable from a footer nav on EVERY page (the 404 included), not only
from the link a saved card shows. The footer, not the header, is a measured choice: at 360 px the
header already fills its row, and a third item there scrolled the page to 376 px. An entry is a
POINTER, not a copy — the result id, the engine rank, the
total the page showed and the local `savedAt` — so the list can never print a price the card it
links to does not; opening one is a link back to `/config/[id]`, which answers for itself when the
API no longer serves that id. `localStorage` under `morocco-pc:saved-builds:v1` is the whole store:
no account, no server, no migration, and the page's own copy says the saves are device-local.

The honesty requirements live in the failure paths, not the happy one. Validation is per RECORD, so a
corrupt store costs one entry rather than the shelf — the timestamp is validated by PARSING it
(`Number.isFinite(Date.parse(...))`), because `formatDate` throws `RangeError: Invalid time value` on
an invalid `Date` and one bad `savedAt` would otherwise blank the page. A store that cannot be READ
shows a warning and the way forward instead of the empty state: « rien n’a été enregistré » is a
claim the page cannot make when it cannot see the list. `QuotaExceededError` asks the reader to
remove one, any other refusal says nothing was saved, and a failed write leaves the previous value in
place — so no message ever reports a save that did not happen. A removal is announced in a live
region AND gives focus somewhere to be: the row that owned it is gone, so focus moves to the shelf
itself (the list, or the empty card), never to the next row's « Retirer » — a held Enter would
otherwise delete the shelf one item per keypress.

Measured on the saved-builds branch, BEFORE master's S23 was merged in: **346/346** in the full
suite with `E2E_BROWSER_API=1`, 25 of them new
(`e2e/saved.spec.ts` 11, `e2e/saved-model.spec.ts` 12 — the model half needs no browser — plus 2 in
`e2e/shell.spec.ts` for the footer entry, in both locales);
`typecheck`, `build` (the shelf prerenders `●` per locale) and `lint` (0 errors, the pre-existing
`postcss.config.mjs` warning) exit 0; `check:tokens` 76 files, `check:i18n` 74 files + 2 catalogues,
and `e2e/a11y.spec.ts` is **51** checks with the shelf audited in BOTH locales. One existing spec had
to be scoped, not relaxed: `share.spec.ts` asserted on a page-wide `[aria-live="polite"]`, and a
result page now legitimately carries one polite region per build card, so those two assertions
resolve the share bar's own region instead.

The chart half shipped the same day and no longer plots fixtures. `apps/web/components/price-history.tsx`
reads the route's `points` on the server — already collapsed to one point per observation MOMENT and
ascending — and owns the whole surface: no reading, one reading, and a 2+ series with the SVG chart, the
min / max / latest rows and the up / down / unchanged sentence. Thin data is a SENTENCE, never a zero: one
observation renders « Un seul relevé : 3 200 DH, le 18 septembre 2026. » and draws no line, because a
chart of one point is a picture of nothing. The Arabic page mirrors GEOMETRICALLY, not by reversing the
array: direction is a prop, the time axis grows toward the inline end, and the spec reads the plotted
points back off the rendered SVG's own x positions — a left-to-right axis inside an RTL page fails. The
chart is a labelled image (`role="img"` carrying the count sentence) and every value it plots also exists
in text, which is the DoD's "text summary equivalent".

Measured on the merged tree (master's S23 plus this S25 half): the suite is **359 passed / 1 skipped**
(up from 346, and the skip is the pre-existing `E2E_BROWSER_API` one), of which `e2e/price-history.spec.ts`
is **13** specs across both locales, `e2e/compare.spec.ts` 11 and `e2e/a11y.spec.ts` still **51** checks;
`typecheck`, `lint` (0 errors), `check:tokens` (77 files), `check:i18n` (75 files + 2 catalogues) and
`build` exit 0. `check:api-types` pins contract **1.6.0** and its eight paths. Against the real API the
page renders the single-reading sentence in French and Arabic, with no chart and no 360 px overflow.

The honest limit is DATA, not code: every product's history is a single observation MOMENT today — 99 of
the 100 products carry exactly one row, and the hundredth's two rows (two offers) share one instant — so
the 2+ branches, falling / rising / unchanged, are exercised by fixtures until a second ingestion sweep
exists. The page says the true thing for today's data rather than drawing a trend it never saw.

### M3 exit gate

#### S26 — M3 verification run (1 h)
**Goal:** Prove the exit criteria; produce the evidence bundle.
**Depends on:** S22
**Definition of done:**
- Lighthouse mobile ≥ 90 on preset pages (CI artifact attached).
- Wizard completes at 360 px (Playwright video attached).
- Full FR flow green against the staging API (wizard → results → share), 20 consecutive runs
  without flake.
**Test scenarios:**
1. `LHCI` preset-page score ≥ 90 asserted in CI.
2. Playwright 360 px wizard E2E against staging = green.
3. Staging run log shows zero unhandled console errors and zero 5xx.

**Status: BLOCKED 2026-10-22, criterion 1 LANDED 2026-10-23 — a deployment still stops the
sprint.** The staging runs need a deployed API origin and a chosen web host; neither exists, and what
is genuinely unproven is the FR flow against a staging API, twenty consecutive runs without flake,
and a staging run with zero unhandled console errors and zero 5xx. The DoD's first line used to be
the other gap: "a performance SCORE of 90 or better asserted in CI" was not asserted anywhere,
because `lighthouserc.cjs` selected `onlyCategories: performance` and asserted three metrics, never
the category score. It is asserted now — `categories:performance` ≥ 0.90 at `error` under the same
`median` aggregation as its three siblings — and the assertion is PROVEN, not merely added: with the
floor raised to 0.99 the run failed `expected >=0.99, found 0.98` and exited 1, and the restored 0.90
passed at 0.98 on both measured pages. Criterion 2's wizard at 360×800 is Playwright-covered;
criterion 3 still has no origin.

**Criterion 2's top half is proven locally, the rest still needs staging (2026-10-23).**
`e2e/wizard-engine.spec.ts` drives the wizard's submit through the real API into PostgreSQL on the
TEST branch and reads the committed pass back, so the flow staging would exercise is no longer only a
mock — but twenty consecutive runs, a deployed origin and the zero-5xx / zero-console log are all
staging facts, and no local run claims them.

### Post-M3 refinement (not on the critical path)

#### S27 — Budget slider: curve-mapped thumb (1.5 h)
**Goal:** Put the realistic part of the range under the thumb: the slider's POSITION on the rail
is mapped through a curve while its VALUE stays on S8's 500 MAD grid, so 500 -> 7 000 MAD stops
occupying about 0.7 % of a 360 px track. S8 recorded this as a known limitation rather than a
defect: the linear rail is exactly what S8's definition of done asked for, and every realistic
budget sits under the first thumb-width.
**Depends on:** S8. Deliberately outside the M3 gate — nothing else in the product is waiting on
it, and the rail is correct, only unhelpful in its first centimetre.
**Definition of done:**
- Position <-> value is ONE pair of pure functions, inverses of each other and pinned by a unit
  check, preserving both the 500 MAD step and the true 1 000 000 maximum (which is ON the grid:
  500 + 1 999 x 500 — S8's own arithmetic check).
- Keyboard semantics are STATED, not inherited: the arrow keys' value delta is written down (the
  same 500 DH as today, or a documented different rule), Home stays 500 and End stays 1 000 000,
  and `aria-valuetext` still announces DH.
- S8's synchronisation rule survives untouched: the field keeps what was typed, the URL holds the
  typed amount, and the note under the rail still says where the thumb sits and which number is
  kept.
- The Arabic page mirrors GEOMETRICALLY on a 360 px viewport, as S20's RTL specs require.
**Test scenarios:**
1. At 360 px, a 7 000 MAD budget puts the thumb past 20 % of the rail (measured on the element's
   own box; today it is about 0.7 %).
2. Position/value round-trips exactly for 500, 7 000, 20 000 and 1 000 000, and for a typed
   off-grid amount through S8's snap rule.
3. ArrowRight/ArrowLeft move by the documented amount from three starting points; Home and End are
   unchanged; `aria-valuetext` is in DH in both locales.
4. `/ar/configurer`: the thumb reaches the inline end for the maximum and the arrows still move it
   in the reading direction.

**Status: DONE 2026-10-22 — as built.** The rail's VALUE is now a POSITION
(`0..BUDGET_SLIDER_POSITIONS`, 1 000 of them) and `budgetAtPosition()` maps a position to a 500 MAD
amount on `500 × 2000^(p/1000)`, which lands exactly on both ends. Measured positions: 500 -> 0 %,
1 000 -> 9.1 %, 3 000 -> 23.6 %, 7 000 -> 34.7 %, 20 000 -> 48.5 %, 100 000 -> 69.7 %, 1 000 000 ->
100 %; the same 7 000 was 0.65 % of a linear rail. `positionForBudget()` is the inverse and rounds
to the nearest position, so a drag a hair either side of a rung still shows that rung.

Three things are worth recording, because each one is a place the obvious version lies:

1. **The keyboard is defined in AMOUNTS, not positions.** One position is ~2 DH at the bottom of
   the curve and ~8 000 DH at the top, so the browser's own "one step" would have made the arrow
   keys meaningless. `budgetForSliderKey()` states the rule instead: arrows move 500 DH wherever the
   thumb is, PageUp/PageDown move 5 000 DH, Home and End are the bounds. The handler takes the
   DIRECTION from the rendered element (`getComputedStyle(...).direction`), so in Arabic ArrowRight
   walks DOWN the scale, the way the rail runs, and ArrowUp remains vertical and unmirrored.
2. **The curve is coarser than the 500 grid above ~66 000 MAD.** Below the crossover every grid
   amount round-trips exactly; above it a grid amount can land on a neighbour (±500 MAD), because
   1 000 positions cannot resolve 2 000 grid points everywhere. The rail is allowed to be coarse
   there — the FIELD still keeps any integer, which is S8's rule — and the snap note names the RUNG
   the thumb is on rather than the amount it "should" be, so the sentence stays true.
3. **`aria-valuenow|min|max` are positions; `aria-valuetext` is the amount.** Every label a person
   or a screen reader reads goes through `formatMoney` (header, `aria-valuetext`, the two end
   labels), which is what the tests assert. The native numeric attributes stay in the rail's own
   domain: that is the documented cost of curving a native control instead of replacing it with a
   div, and the reason the alternative was rejected (S3's rule).

Measured: 29/29 in `wizard-budget.spec.ts` + `wizard-model.spec.ts` (5 new S27 checks: the rail
fraction at 360 px, the amount-domain keys, the RTL mirror, and the model's position/value pair and
key map), `typecheck` / `lint` / `build` exit 0, and the full suite 242/242. The e2e specs prove each claim
rather than restating the math: the rail fraction is read off the element's own `value|min|max` and
converted to 125 px of thumb travel, and the Arabic mirror is proven by CLICKING 8 px from the left
edge of the track — 1 000 000 DH there, where the same pixel in French is under 2 000. Proven RED by
putting the rail back on the amount domain (S8's linear version): the fraction spec failed
(`Expected < 2000, Received 1000000` on the RTL click), so the specs pin the curve, not the
component's own arithmetic.

### Dependency map (summary)

- **Contract-dependent sprints:** S4 (drift gate), S9 (CD-1), S13 (CD-2), S16 (CD-4), S17
  (CD-5), S12 (CD-6 date), S24 (CD-8) — each has a fixtures-first path, so no sprint blocks
  on the API being final.
- **Hard order:** S1 → {S2, S4, S5} → S3 → S6 → S7 → {S8, S9} → S10 → S11 → {S12, S13, S14,
  S15} → {S16, S17} → {S18, S19} → S20 → S21 → S22 → S26. W5 (S23–S25) is post-beta only.
- **Total:** 27 sprints — the 26 on the path to M3 plus S27's post-M3 slider refinement (DONE
  2026-10-22) — each 1–2 h of agent work. Nominal sums: W0–W4 + exit ≈ 40 h, W5 ≈ 6 h,
  S27 ≈ 1.5 h.

**State, 2026-10-23 (S25 landed whole):** every node on this map through S22 is DONE,
and so are S27, S23 and both halves of S25, which sit outside it. The hard order’s only remaining node
is S26, and a deployment gates it. What is left: S24, which waits on CD-8 — nobody has scheduled it.
