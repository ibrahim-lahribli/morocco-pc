# Agent 3 — Web sprint board (1–2 h per sprint)

Companion to [agent3-web-plan.md](agent3-web-plan.md) (the validated whole plan). Each sprint
below states **Goal**, **Definition of done** and **Test scenarios**. Unless noted, the shared
DoD applies: lint + typecheck + tests green, renders at 360 px with no horizontal scroll,
keyboard-reachable with visible focus, no raw API enum text rendered, fr copy in sentence case.
Contract dependencies (CD-*) and findings (V*) are defined in the plan §2 — the API and engine
are in progress, so every contract-dependent sprint has a fixtures-first path.

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
check:tokens`, in `web-ci.yml`) is scenario 1. Three things are worth recording:

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
`apps/api/test/unit/openapi-v1.5.json`; `lib/api/client.ts` is the single fetch path (typed
`ApiError`, `details[]`, `retryAfterSeconds`); `lib/api/compile-gate.ts` makes a contract
regression a `tsc` failure; `mock/server.mjs` + `mock/fixtures.mjs` serve every state listed above
plus the dedupe path, the zero-build-with-no-floor case and an open CORS policy; `check:api-types`
runs in `web-ci.yml` between typecheck and build. Two deliberate deviations from this DoD:

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
thumb-width. A curve-mapped position (exponential thumb, still 500 MAD steps in value) is the fix,
and it needs its own sprint because it redefines what an arrow key means.


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

### Phase W5 — Post-beta (excluded from M3)

#### S23 — Component detail v2 + compare (2 h, post-beta)
**Goal:** Deep component pages and a compare view (2–3 components side by side).
**Depends on:** S17, CD-5
**Definition of done:** compare state in URL (shareable), keyboard-operable table semantics,
RTL-safe; spec diffs highlighted with text (not colour alone).
**Test scenarios:** compare URL shared → renders identical selection; diff highlighting has a
text equivalent; 360px compare falls back to stacked cards.

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

### Dependency map (summary)

- **Contract-dependent sprints:** S4 (drift gate), S9 (CD-1), S13 (CD-2), S16 (CD-4), S17
  (CD-5), S12 (CD-6 date), S24 (CD-8) — each has a fixtures-first path, so no sprint blocks
  on the API being final.
- **Hard order:** S1 → {S2, S4, S5} → S3 → S6 → S7 → {S8, S9} → S10 → S11 → {S12, S13, S14,
  S15} → {S16, S17} → {S18, S19} → S20 → S21 → S22 → S26. W5 (S23–S25) is post-beta only.
- **Total:** 26 sprints, each 1–2 h of agent work. Nominal sums: W0–W4 + exit ≈ 40 h,
  W5 ≈ 6 h.
