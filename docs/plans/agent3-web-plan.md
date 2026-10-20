# apps/web — the web plan

**What this file is.** The PLAN for the frontend: product shape, stack, the contract dependencies
it consumes, the design direction, the W0–W5 phases and the M3 exit gate. The sprint-level
breakdown (S1–S26, each with its definition of done and test scenarios) lives in
[agent3-web-sprints.md](agent3-web-sprints.md); those sprints are sprints OF this file, not a
separate plan. Everything here is scoped to `apps/web/`, a standalone package with its own manifest
and lockfile (OD4) that does not touch the engine or root CI (V14).

**Status (2026-10-20).** PLAN REGISTERED. **W0 has one sprint done (S1, green — measured in §6) and
five not started (S2–S6); W1–W5 and the M3 gate are not started.** No `apps/web` code makes an API
call yet, so nothing here has been exercised against a real API.

## 1. Product shape and stack

Web, **mobile-first and SEO-first**: the wizard must be completable at 360 px, and the SEO surface
(preset pages, component pages, guides) is a first-class deliverable rather than an afterthought.

| Area | Choice |
|---|---|
| Framework | Next.js **App Router**, TypeScript (strict), SSR/SSG/ISR as each route needs |
| Styling | Tailwind v4, CSS-first `@theme` tokens |
| API client | **typed client generated from `/v1/docs/json`**, with the OpenAPI snapshot committed and a drift gate in CI |
| i18n | `next-intl`, **fr default**, `ar` with RTL |
| Analytics | privacy-friendly, no PII (Plausible or Umami — OD5 leaves the provider open) |
| Hosting | close to users (the API's latency work assumes EU co-location; the web host is still unchosen) |
| Location | entirely in `apps/web/` |

## 2. Contract dependencies and findings

The platform capabilities the web plan consumes (CD-*), the findings it works around (V-*) and the
owner decisions taken around them (OD-*). **None of them blocks the web work**: every
contract-dependent sprint has a fixtures-first path, so the web proceeds against a mock server until
the API catches up.

### 2.1 Contract dependencies (CD-*)

| ID | What it is | Status 2026-10-20 |
|---|---|---|
| CD-1 | `inputs_applied` — which of `use_case` / `resolution` / `priority` actually changed the result | **ABSENT from the contract.** `resolution` and `priority` are inert in v1 (OG-38), so S9 ships the honest label instead of a step that silently does nothing |
| CD-2 | `reasons[]` — structured reason codes per build | **NOT SERVED.** `explainSelection` text is what the API returns; Decision 44's `deriveReasons()` exists but is additive and unwired, so S13 renders `explanation` and keeps the code path ready |
| CD-4 | `GET /v1/presets` — the landing ribbon | **SHIPPED** (contract v1.4, Decision 48) |
| CD-5 | `GET /v1/catalog/products` and `/…/{slug}` | **SHIPPED** (contract v1.5, Decision 50) |
| CD-6 | An honest per-price obsolescence label | **PARTIAL.** The recommendation response carries `generated_at` (when the pass ran), which is NOT when a price was observed, and the API has no per-offer observed-on date — so any "prix constatés le …" label must say what it is actually dating |
| CD-7 | `budget_floor` present on the GET revisit | **SHIPPED** (migration 019 + Decision 46; both verbs carry it) |
| CD-8 | A swap endpoint | **NOT BUILT**, and no platform sprint owns it. S24 ships the disabled control with an explanation rather than a simulated swap |

### 2.2 Findings (V-*)

Reconstructed from the sprint board's own references, with today's status. `V7` / `V8` are
referenced by no sprint and `OD3` is unused; they are not invented here.

| ID | Finding | Status |
|---|---|---|
| V1 | The API's POST latency is unproven, so the wizard cannot promise 3 s | open; needs a deployed origin |
| V2 | A zero-build pass is a legitimate outcome and must be explained, not shown as an error | contract has `budget_floor`; UI not built |
| V3 | `resolution` / `priority` may be inert (OG-38), and the UI must not imply otherwise | open on the API side |
| V4 | Explanation text is a string today, so copy cannot be composed from codes | open (CD-2) |
| V5 | Catalogue names carry a `Seed ` prefix; the UI must use `display_name` and never render "Seed", `SEED_UNVERIFIED` or `TestCompat` | `display_name` available since v1.2 |
| V6 | A price is two facts — `offer_class` and `price_status` — and showing one without the other misleads | both in the contract |
| V9 | `hreflang` for `ar` cannot be emitted before the `ar` routes exist | deferred to S20 by design |
| V10 | 429 must be a first-class state with `Retry-After`, not a generic error | contract declares it |
| V11 | Money and dates must go through `Intl` (`fr-MA`), never hand-formatted | not started |
| V12 | The budget input needs both a 500 MAD slider and a free numeric field, clamped honestly | not started |
| V13 | `builds[]` is 1..N, not always 3; the results page must not render empty slots | not started |
| V14 | `apps/web` is a separate package: own manifest, own lockfile, own workflow, root CI untouched | done in S1 |

### 2.3 Owner decisions (OD-*)

| ID | Decision |
|---|---|
| OD1 | When an input is inert, ship an honest-labelled profile variant rather than a step that pretends |
| OD2 | The budget accepts free numeric entry as well as the slider (clamp on blur, state the fix inline) |
| OD4 | `apps/web` keeps its own `package.json` + lockfile; the root manifest and CI stay untouched |
| OD5 | Analytics provider stays open (Plausible or Umami); the constraint is privacy and no PII, not the vendor |

## 3. Design direction

The design work is a **two-pass review before code** (S2): a written plan first — palette hex values,
type roles, wireframes, principles — critiqued against the principles below, then implemented.

Those principles, and they are the checklist S2 is graded against:

- **Honest data surfaces.** A price is never shown without its provenance state; a build-less pass is
  never dressed up; the word "Seed" never reaches a user (V5, V6, V2). Where an input is inert, say
  so (OD1) rather than showing a control that changes nothing.
- **Mobile-first at 360 px.** One column, touch targets ≥ 44 px, no horizontal scroll, no content
  loss at 200 % zoom.
- **RTL-safe by construction.** Logical properties only (`start`/`end`, never `left`/`right`), so the
  Arabic pass (S20) is a translation and a mirror, not a rewrite.
- **Keyboard and screen-reader parity.** Visible focus, real `<button>`/`<a>` semantics, no click
  handlers on non-interactive elements, announcements for loading and errors.
- **Tokens, not literals.** A brand → semantic → component token hierarchy in `@theme`; **no raw hex
  in a component** (grep-enforced in S2), and contrast measured, never eyeballed.
- **Motion is optional.** Respect `prefers-reduced-motion`; the loading states must communicate
  progress without animation.
- **French copy is written, not generated**: sentence case, active voice, "what happened + how to
  fix" for every error state.

## 4. Phases

### W0 — foundation (days 1–3)

Scaffold; CI (lint, typecheck, Playwright at a **360 px** viewport, Lighthouse CI budgets); mock
server built from fixtures; design tokens; i18n skeleton; Latin + Arabic font subsets.

**Today:** S1 done, S2–S6 not started. What exists: `next build`, `eslint`, `tsc --noEmit` and the 3
Playwright specs all pass, Tailwind compiles real utilities, and `web-ci.yml` runs lint → typecheck →
build → Playwright path-filtered to `apps/web/**` and itself. What does not: Lighthouse CI budgets,
the fixture mock server, the typed client, the token system (today's tokens are create-next-app
defaults), the component kit, `next-intl` and the Arabic subset (only Latin Geist is loaded).

### W1 — wizard

Single-column, four steps: **use case → budget (slider + numeric field, 500 MAD steps, fr-MA
formatting) → resolution (only for gaming) → priority as three labelled choices (price / balanced /
performance) mapped to 1–5**.

Two rules outrank the visuals here: show only the inputs the contract says are **applied**
(`inputs_applied`), and never render the word "Seed" — use `display_name`.

**Today:** not started (S7–S10).

### W2 — results

`/fr/config/[id]`: up to three strategy cards, component list, total-vs-budget bar, the price badge
(**démo / indicatif / vérifié** plus its date), "pourquoi ce choix" built from `reasons[]` codes
with French (later Arabic) copy, the zero-build state built on `budget_floor` ("budget minimum
conseillé"), sharing through `wa.me`, the Web Share API and copy-link, and a loading skeleton with
progress.

**POST latency target: under 3 s.** That is a target, not a measurement: no deployed origin exists,
so the wizard's real number is unknown and the sprint board deliberately keeps it out of the gate
until staging exists.

**Today:** not started (S11–S15).

### W3 — SEO surface

Preset pages (`/fr/config-pc-gamer-{budget}-dh`, …) generated from `GET /v1/presets` via **ISR**,
component pages from the catalogue endpoints, editorial guides (H6), `sitemap.xml`, `robots.txt`,
canonical + `hreflang` (fr/ar), Open Graph images.

Structured data is gated on truth: **JSON-LD (Product + Offer, MAD) only when `price_status` is
`verified` — never for demo prices.** Until real prices exist, preset and component pages ship
`noindex`; user-generated `/config/[id]` pages stay `noindex` permanently but keep rich share
previews.

Performance budgets for low-end Android on 4G: **LCP ≤ 2.5 s, CLS ≤ 0.1**, small initial JS
(hypothesis ≤ 170 KB), and **no client-side data fetch on preset pages**.

**Today:** not started (S16–S19).

### W4 — hardening

Arabic/RTL pass, WCAG AA, empty/error/rate-limited states, legal pages wired (H4).

**Today:** not started (S20–S22).

### W5 — post-beta (excluded from M3)

Component detail v2 and compare, swap inside a build (needs CD-8), price history, saved builds.

**Today:** not started, and deliberately out of scope for M3 (S23–S25).

## 5. M3 exit gate

- **Lighthouse mobile ≥ 90** on preset pages.
- The **wizard completes at 360 px**.
- The **full FR flow runs against the staging API** (wizard → results → share).

**Today:** unmeasurable. All three need a deployed API; two of them need a chosen web host. S26 is
the verification sprint that produces the evidence.

## 6. Measured state of the scaffold (2026-10-20)

Run in `apps/web` on the rebased branch, Node 24 locally (CI pins 22):

| Check | Result |
|---|---|
| `npm ci` | exit 0 |
| `npm run build` | exit 0 — `next build` (Turbopack), 5/5 static pages, **no CSS parse warning** |
| `npm run lint` | exit 0 — 0 errors, 1 warning (`postcss.config.mjs` anonymous default export) |
| `npm run typecheck` | exit 0, and also exit 0 with `next-env.d.ts` removed (the clean-CI order is safe) |
| `npm test` (Playwright, 360×800) | 3/3 pass — shell renders with no horizontal scroll, `/` redirects to `/fr`, skip link takes focus and moves to `#main` |
| Tailwind actually processed | yes — the emitted CSS chunk contains `text-2xl`, `mx-auto`, `max-w-5xl`, `sr-only` and the `focus:` variants |

**Superseded finding.** This file previously held only one section, §2.5, reporting that the scaffold
had **no Tailwind v4 integration**: no `@tailwindcss/postcss`, no `postcss.config.*`, and a build that
emitted `Unknown at rule: @theme`. That is **not true of the committed tree**: the scaffold commit
ships `postcss.config.mjs` registering `@tailwindcss/postcss`, the devDependency is in the manifest,
and the build emits real Tailwind utilities with no warning — measured above. It is kept here only as
the record of a review performed against a working tree that was not the committed one; do not act on
it.

## 7. What is missing from the plan, stated plainly

- **No web host is chosen.** Hosting "close to users" is a requirement without a decision, and it
  gates the M3 staging run.
- **`/v1/docs/json` is the only contract source**, and the web package has no committed snapshot
  yet — S4's drift gate cannot exist until it does.
- **`apps/web` has never spoken to the API.** There is no fetch, no client library and no API base
  URL in the package, so "the frontend talks to the API" is unproven by construction, not merely
  unverified.
