# apps/web — the web plan

**What this file is.** The PLAN for the frontend: product shape, stack, the contract dependencies
it consumes, the design direction, the W0–W5 phases and the M3 exit gate. The sprint-level
breakdown (S1–S27, each with its definition of done and test scenarios) lives in
[agent3-web-sprints.md](agent3-web-sprints.md); those sprints are sprints OF this file, not a
separate plan. Everything here is scoped to `apps/web/`, a standalone package with its own manifest
and lockfile (OD4) that does not touch the engine or root CI (V14).

**Status (2026-10-23).** PLAN REGISTERED, with the design registered as the S2/S3 source
(§3 — Stitch, not Figma: the Figma copy is an unread export target). **W0 is COMPLETE — S1–S6 are
done, including the dedicated `web.yml` job and its Lighthouse budgets, which were proven on
GitHub on 2026-10-21; W1 is COMPLETE (S7–S10, the wizard shell, the budget step, the
profile-gated step flow and the POST hand-off); W2 is COMPLETE (S11–S15); W3 is COMPLETE
(S16, S17, S18 and S19's gating are DONE); W4 is COMPLETE — S20 (the Arabic/RTL pass), S21 (the
WCAG AA audit) and S22 (legal pages, analytics, states) are DONE 2026-10-22 — and S27, the
post-M3 slider curve, S23, the compare view, and S25, saved builds plus the price history, are
DONE (2026-10-22 and 2026-10-23), so 25 of the 27 sprints are done. What remains is S24 (swap
inside a build) and S26, the M3 verification run, which is BLOCKED on
deployment. **The web host is now DECIDED (2026-10-23): Cloudflare Workers**, built through the
`@opennextjs/cloudflare` adapter - `apps/web/wrangler.jsonc` and `apps/web/open-next.config.ts` are
committed, the adapter and `wrangler` are devDependencies, and the incremental cache is KV. No
deployment has been made from that config and no API origin exists, so S26's staging legs are still
unmeasurable.

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
| Hosting | **Cloudflare Workers** (decided 2026-10-23) through the OpenNext adapter - committed `wrangler.jsonc` + `open-next.config.ts`, KV incremental cache. Close to users, which the API's latency work assumes (EU co-location). Configured and built locally, NOT deployed |
| Location | entirely in `apps/web/` |

## 2. Contract dependencies and findings

The platform capabilities the web plan consumes (CD-*), the findings it works around (V-*) and the
owner decisions taken around them (OD-*). **None of them blocks the web work**: every
contract-dependent sprint has a fixtures-first path, so the web proceeds against a mock server until
the API catches up.

### 2.1 Contract dependencies (CD-*)

| ID | What it is | Status 2026-10-20 |
|---|---|---|
| CD-1 | `inputs_applied` — which of `use_case` / `resolution` / `priority` actually changed the result | **ABSENT from the contract.** `resolution` and `priority` are inert in v1 (OG-38), so S9 ships the honest label instead of a step that silently does nothing — and the gate is built and tested behind it: the moment a response carries `inputs_applied`, an input it does not name is no longer asked at all |
| CD-2 | `reasons[]` — structured reason codes per build | **NOT SERVED, client ready (S13).** Decision 44's `deriveReasons()` still has no route, so the API returns prose and the panel renders it verbatim; the reasons path is built and proven against a provisional fixture, so serving the field is a data change rather than a UI change |
| CD-4 | `GET /v1/presets` — the landing ribbon | **SHIPPED** (contract v1.4, Decision 48) — consumed by S16's preset pages |
| CD-5 | `GET /v1/catalog/products` and `/…/{slug}` | **SHIPPED** (contract v1.5, Decision 50) |
| CD-6 | An honest per-price obsolescence label | **PARTIAL, resolved as far as the contract allows (S12).** `generated_at` dates the PASS, not a shop survey, so the verified badge says "Vérifié · calculé le …" instead of "prix constatés le …". A true per-price observation date is still absent, and the badge must not pretend to have one |
| CD-7 | `budget_floor` present on the GET revisit | **SHIPPED** (migration 019 + Decision 46; both verbs carry it) |
| CD-8 | A swap endpoint | **NOT BUILT**, and no platform sprint owns it. S24 ships the disabled control with an explanation rather than a simulated swap |

### 2.2 Findings (V-*)

Reconstructed from the sprint board's own references, with today's status. `V7` / `V8` are
referenced by no sprint and `OD3` is unused; they are not invented here.

| ID | Finding | Status |
|---|---|---|
| V1 | The API's POST latency is unproven, so the wizard cannot promise 3 s | open; needs a deployed origin |
| V2 | A zero-build pass is a legitimate outcome and must be explained, not shown as an error | **DONE (S11 + S14)** — the zero-build state, its pre-filled way back and the floor advice all render; a zero-build body is a RESULT, so `wizard.tsx` navigates to it exactly like any other pass |
| V3 | `resolution` / `priority` may be inert (OG-38), and the UI must not imply otherwise | open on the API side |
| V4 | Explanation text is a string today, so copy cannot be composed from codes | **PARTIAL (S13)** — both branches ship: the string verbatim when `reasons[]` is absent, catalogue lines when it is served. The persisted trace is still prose (CD-2) |
| V5 | Catalogue names carry a `Seed ` prefix; the UI must use `display_name` and never render "Seed", `SEED_UNVERIFIED` or `TestCompat` | `display_name` available since v1.2 |
| V6 | A price is two facts — `offer_class` and `price_status` — and showing one without the other misleads | **DONE (S12)** — each card derives démo/indicatif/vérifié from BOTH columns, so an all-seed pass no longer hides inside "indicatif" |
| V9 | `hreflang` for `ar` cannot be emitted before the `ar` routes exist | **DONE (S20)** — every page emits `fr`, `ar` and `x-default`, each naming its OWN locale's URL; `pageAlternates()` and `app/sitemap.ts` share one `localeAlternates()` helper (the sitemap carries the pair as `xhtml:link`), and `e2e/seo.spec.ts` FETCHES every annotated URL and requires a 200, so a French-only page cannot ship an `ar` alternate |
| V10 | 429 must be a first-class state with `Retry-After`, not a generic error | **DONE (S10)** — the countdown, the disable, and the re-enable. S10 also found the header was unreadable cross-origin: the API now lists `Retry-After` and `X-Request-Id` in its CORS `exposedHeaders`, without which `fetch` returns both as null |
| V11 | Money and dates must go through `Intl` (`fr-MA`), never hand-formatted | **DONE (S5)** — `lib/i18n/format.ts`; `npm run check:i18n` fails on inline Intl, a runtime-locale method, a hand-written amount or a literal date |
| V12 | The budget input needs both a 500 MAD slider and a free numeric field, clamped honestly | **DONE (S8)** — `budget-step.tsx` ships both controls (the slider snaps to 500 MAD steps and says so, the numeric field keeps the exact amount), clamps on blur with an inline sentence, and pins the behaviour in `e2e/wizard-budget.spec.ts` + `wizard-model.spec.ts` |
| V13 | `builds[]` is 1..N, not always 3; the results page must not render empty slots | **DONE (S11)** — the array is mapped in rank order, never padded |
| V14 | `apps/web` is a separate package: own manifest, own lockfile, own workflow, root CI untouched | done in S1 |

### 2.3 Owner decisions (OD-*)

| ID | Decision |
|---|---|
| OD1 | When an input is inert, ship an honest-labelled profile variant rather than a step that pretends |
| OD2 | The budget accepts free numeric entry as well as the slider (clamp on blur, state the fix inline) |
| OD4 | `apps/web` keeps its own `package.json` + lockfile; the root manifest and CI stay untouched |
| OD5 | Analytics provider stays open (Plausible or Umami); the constraint is privacy and no PII, not the vendor |

## 3. Design direction

**Design source (CORRECTED 2026-10-20).** The visual design was created in **Google Stitch**,
and Stitch is the S2/S3 source. **S2 and S3 are DERIVED from the Stitch export, not invented next
to it:** S2 extracts palette, type scale, spacing, radii and component states from the exported
HTML + CSS into `@theme` tokens, and S3 implements the eight kit components to their exported
frames. Nothing under `apps/web/` imports the export: it lands in `design/stitch/` as a review
artifact, and each token group cites the exported screen it was measured on.

Stitch's Export menu offers Preview (HTML + images), AI Studio, **Figma**, MCP (preview), Netlify,
Lovable, Bolt, **zip.**, **Code to Clipboard**, **Project Brief** and **Stitch React App**. For S2
the **MCP** endpoint matters first (verified below); **zip.** (the whole project as HTML + assets)
and **Code to Clipboard** (one screen's HTML/CSS) are the fallbacks. *Project Brief* supplies intent
and copy; *Stitch React App* and the hosting targets (Netlify / Lovable / Bolt) are reference only,
because S3 owns those components.

**Access state: RESOLVED 2026-10-20 — the Stitch MCP is the source.** `https://stitch.googleapis.com/mcp`
answers `initialize` and `tools/list` (15 tools) unauthenticated, and `tools/call` with a Stitch API
key in an `X-Goog-Api-Key` header; without the key it is a 401 whose body names the missing
credential. The design lives in `projects/3530106450258598180` ("ConfigPC Mobile Design System", 16
screen instances, 12 listed). `get_screen` returns `htmlCode` and `screenshot` as download URLs that
MUST be fetched WITH the same key header (401 without it) and answer `{ dataString }` — HTML, and
base64 PNG. So S2 reads the design-system board screen (`b4659f8e…`) over MCP: no zip, no Figma.
That id matters: the two HIDDEN board screens (`e137bd84…` and `f5cf4af7…`) are byte-identical
duplicates of each other, and the visible board is the newer, larger copy (39 877 vs 38 523
characters), so S2 measured the one that is actually shown.

The board already yields a CANDIDATE token map from its own `tailwind.config` block: primary
`#3730A3` (soft `#EEF2FF`, hover `#312E81`), saffron `#F59E0B`/`#FEF3C7`, neutrals `#FAFAF9` /
`#FFFFFF` / `#E7E5E4` / `#57534E` / `#1C1917`, success `#15803D`, warning `#B45309`, error
`#B91C1C`, info `#1D4ED8`, WhatsApp `#075E54`, fonts Inter + IBM Plex Sans Arabic, `card-1`/`card-2`
shadows and a 2px `#3730A3` focus ring. **S2 has since shipped this palette as OKLCH tokens**
(2026-10-20, §6); the values below are what the board declares, and every one of them survived
verification. Four DELIBERATE deviations are recorded in the token map: the warning budget bar uses
`#B45309` rather than saffron (measured 1.71:1 against the rail); there is no dark palette, because
none was designed; components use logical properties, because the board's Arabic screens are
physical; and its neutral utilities become role tokens, so no component names a palette.

**`DESIGN.md` does not exist for this project.** Its `designTheme` is empty and `list_design_systems`
returns no systems, so the token truth is the screen HTML rather than a theme asset. (A downloaded
screen is the only export that matters; the zip is now a convenience, not a requirement.)

**Why Figma is NOT the source — measured three times on 2026-10-20 (08:14Z, 08:20Z, 10:26Z).**
Every `get_figma_data` call on file `OwaMKYnDfH2AQqj7y0bn2H` / node `0:1` answered **429
rate-limited** (starter plan), most recently with `retry after 55861` s. The token itself is
accepted — a bad token is 403, not 429 — so this is a quota, not a credentials defect, and waiting
it out costs up to a day per attempt. The registered file is also titled **"Untitled" at node
`0:1`**, the default page of a newly created file, so a successful retry may return an EMPTY
document: the design was created in Stitch, and Figma was only an export destination. **Do not make
the Figma retry S2's gate.** The key stays here as a dated record; nothing in this repo may cite a
token value from it until a token exists.

**S2 is DONE (2026-10-20), and `design/stitch/` is still empty on purpose.** The scratch pull stays
in `tmp/stitch/` (untracked) because nothing under `apps/web/` imports an export: the token map at
[docs/design/TOKEN_MAP.md](../design/TOKEN_MAP.md) cites the board screen id instead, so there is one
source of truth and no copy that can drift. Re-deriving a value is one `get_screen` call.

The design work is a **two-pass review before code** (S2): EXTRACT the design from the
Stitch export first, then critique the extraction against the principles below — before any
component is written.

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

**Today:** **W0 complete — S1–S6 done.** The scaffold, the token system (S2 — the design export
was unblocked by registering Stitch as the source, §3), the eight base components (S3), the typed
client + fixture mock (S4), `next-intl` fr/ar with the Arabic subset (S5) and the dedicated
`web.yml` job with Lighthouse budgets (S6 — warning-first on 2026-10-21, promoted to `error` by
S19 the same day) all exist. `next build`, `eslint`, `tsc --noEmit`, `check:tokens`, `check:i18n`,
`check:api-types` and the Playwright suite pass, and `web.yml` runs them in that order plus
`npm test` and `test:lighthouse`, path-filtered to `apps/web/**`, the API's OpenAPI snapshot and
itself.

S4's pieces: `lib/api/schema.d.ts` (generated, committed), `lib/api/client.ts` (the one fetch path),
`lib/api/compile-gate.ts` (contract probes that only `tsc` can see), `mock/server.mjs` +
`mock/fixtures.mjs` (zero-dependency, every contract state) and `scripts/check-api-types.mjs` (the
drift gate). The snapshot is NOT copied into `apps/web`: the generator reads the API's own gated
`apps/api/test/unit/openapi-v1.6.json`, so the tree keeps ONE contract instead of two.

**Correction, 2026-10-22.** This paragraph used to list the Lighthouse budgets, the token system,
the component kit, `next-intl` and the Arabic subset as missing — all five were built by S2–S6,
and the **Today** paragraph above is the record. Nothing in W0 is outstanding.

### W1 — wizard

Single-column, two to four steps — the length is the profile's (S9): **use case → budget (slider
+ numeric field, 500 MAD steps, fr-MA formatting) → resolution (only for gaming) → priority as
three labelled choices (price / balanced / performance) mapped to 1, 3 and 5 of the contract's
1–5 axis**.

Two rules outrank the visuals here: show only the inputs the contract says are **applied**
(`inputs_applied`), and never render the word "Seed" — use `display_name`.

**Today:** **S7–S10 done, W1 complete** — the shell, the URL state machine, the `meta/options`
step, the budget step (exact field plus a 500 MAD slider), the profile-gated resolution/priority
steps, and the submit path at `/fr/configurer`, with the answers in the query string (see the
sprint board). The flow is DERIVED (`stepsFor`): an office profile walks three steps because the
resolution question is a gaming one, and a response that ever serves `inputs_applied` stops a
question it has declared inert — until then both questions carry an honest "stored, not yet
used" label. The last step now POSTs, maps every failure the API can send, and hands off to
`/fr/config/[id]` — the results page S11 built (see W2), which reads the pass back by id and
renders its cards, budget bar and zero-build state.

### W2 — results

`/fr/config/[id]`: up to three strategy cards, component list, total-vs-budget bar, the price badge
(**démo / indicatif / vérifié** plus its date), "pourquoi ce choix" built from `reasons[]` codes
with French (later Arabic) copy, the zero-build state built on `budget_floor` ("budget minimum
conseillé"), sharing through `wa.me`, the Web Share API and copy-link, and a loading skeleton with
progress.

**POST latency target: under 3 s.** That is a target, not a measurement: no deployed origin exists,
so the wizard's real number is unknown and the sprint board deliberately keeps it out of the gate
until staging exists.

**Today:** **S11–S13 done** (2026-10-20/21) — `/fr/config/[id]` is the results page: an SSR
read of `GET /v1/recommendations/:id`, rank-ordered strategy cards whose first is primary, a
component list per card, a total-vs-budget bar whose `aria-valuetext` carries the real amounts, a
démo/indicatif/vérifié price badge per card, a "pourquoi ce choix" disclosure that switches from
the explanation string to reason codes, a styled 404, and and the budget floor's own advice. **S14 and S15 landed after them (2026-10-21)**, so W2 is
COMPLETE: the zero-build/error/rate-limited states built on `budget_floor` with its lower-bound
caveat, and the share surface (one canonical URL, WhatsApp, Web Share API, copy-link). See the
sprint board's S11–S15 statuses for the recorded deviations and mechanics.

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

**Today:** **S16 is DONE (2026-10-21)** — `/fr|ar/config-pc-gamer-{budget}-dh` is generated by ISR
from the ribbon, reuses S11's build card, stays `noindex` until an API-served page's prices are all
verified, and now carries S19's enforced 170 KB script budget. S19's gating landed 2026-10-21 too.
**S17 is DONE (2026-10-21)**: `/{locale}/composants/{slug}` renders a catalogue product (spec row,
offers with provenance, derived appearances, ISR-cached) from the CD-5 endpoints, and the MDX
pipeline ships the fr-only guides under `/{locale}/guides`. **S18 is DONE (2026-10-21)**: the crawl surface ships —
`/sitemap.xml` (dynamic, listing only the pages whose own `robots` tag says `index`),
`/robots.txt` pointing at it, an absolute self-referencing canonical on every shipped route,
`fr` + `x-default` `hreflang` (V9: no `ar` before S20 — S20 landed 2026-10-22 and the set is now
`fr` + `ar` + `x-default`), and a 1200 x 630 card per preset. The open
decision closed the way it had to: the origin comes from `NEXT_PUBLIC_SITE_URL` (localhost fallback
when unset, a hard failure when malformed), never from `headers()`, so prerendered pages keep their
ISR.

**S20 is DONE (2026-10-22)**: the Arabic side is a translated surface, not a translated shell. Both
guides have Arabic `.mdx` bodies (`content/guides/*.ar.mdx`), the registry is keyed by locale so a
slug cannot exist in one language only, `/{locale}/guides/{slug}` prerenders the cross product, and
the guide index is one list in the route's language. `hreflang` now emits `fr`, `ar` and
`x-default` from one helper that the sitemap shares (`xhtml:link` per entry), so **V9 is closed**;
`e2e/seo.spec.ts` still fetches every annotated URL and requires a 200, which is the gate that
keeps an alternate legal. `check:i18n` gained locale key/placeholder parity (`next-intl` resolves
a missing key at render time, so this was the one hole the build could not see), and
`e2e/rtl.spec.ts` proves the mirror GEOMETRICALLY — stepper and share group mirror with DOM order
intact, the budget bar anchors to the inline start, seven Arabic routes hold 360 px, digits stay
Western and the unit stays `DH` in both locales (recorded decision: one unit spelling per page).
Two limits are recorded in the sprint board: the API's `disclaimer` string is still served in
French and rendered verbatim on Arabic pages (API-owned copy), and the OG cards stay French-only
because Satori has no Arabic face.

### W4 — hardening

Arabic/RTL pass, WCAG AA, legal pages wired (H4). (The empty/error/rate-limited states this
phase used to list shipped in S14, which is W2.)

**Today: W4 is COMPLETE (2026-10-22).** **S20 is DONE** — both locales render every shipped
route, the guides have Arabic bodies, the `hreflang` set is `fr` + `ar` + `x-default` and the
sitemap lists the `ar` pair, and `check:i18n` fails on a locale key/placeholder mismatch.
**S21 is DONE**: `e2e/a11y.spec.ts` runs axe (WCAG 2.0/2.1/2.2 A+AA) over 20 routes × 2 locales
plus zoom and interface-guideline checks — 0 violations — and the manual half, its limits and
the proofs that the gate fires are recorded in
[docs/design/ACCESSIBILITY_AUDIT.md](../design/ACCESSIBILITY_AUDIT.md). **S22 is DONE** — the three
legal pages are indexed and footer-linked in both locales, analytics is one module behind a
per-request config route (unset = off, and off means no third-party request), and every
error/empty/waiting state renders through the alert primitive. Its LCP finding is the part worth
reading: starting the loader at `load` cost 7 % LCP, so it now waits for the page's fonts — the
measurement, the copy review and the state inventory are in
[docs/design/STATES.md](../design/STATES.md).

### W5 — post-beta (excluded from M3)

Component detail v2 and compare, swap inside a build (needs CD-8), price history, saved builds.

**Today (2026-10-23): S23 and S25 are DONE** — the compare view ships at
`/{locale}/composants/comparer?slugs=a,b`, with the component page as its entry point, and the shelf
ships at `/{locale}/enregistrements`; the board’s S23 and S25 statuses carry what landed and what it
measured. **S24 stays outside the M3 gate on purpose.** **S24** (swap inside
a build) waits on **CD-8**, the swap endpoint, which is not built and which no platform sprint owns;
only its disabled-with-an-explanation control is buildable, and the DoD forbids simulating a swap.
**S25** had two halves with different answers, and both have now shipped: saved builds were
`localStorage`-only and now live at `/{locale}/enregistrements`, and price history — a table since
migration 009 that no route read — now renders against
`GET /v1/catalog/products/:slug/price-history` (contract v1.6, Decision 51), which serves one point
per observation MOMENT. `apps/web/components/price-history.tsx` owns the three data states (no
reading, one reading, and a 2+ series with the chart, the min / max / latest rows and the up / down /
unchanged sentence), mirrors geometrically on `/ar`, and is pinned by 13 Playwright specs in the
merged suite’s 359 passed / 1 skipped.

## 5. M3 exit gate

- **Lighthouse mobile ≥ 90** on preset pages.
- The **wizard completes at 360 px**.
- The **full FR flow runs against the staging API** (wizard → results → share).

**Today (2026-10-23): S26 stays BLOCKED on the deployment, with criterion 1 now enforced.** The
web host is now decided (Cloudflare Workers, 2026-10-23 - above and §7), but no environment has been
deployed from it and no API origin exists, so the FR flow and the zero-error staging log remain
unmeasurable rather than merely unmeasured. Criterion 1 no longer
belongs to that list: since 2026-10-23 `lighthouserc.cjs` enforces FOUR assertions (`error`,
`median`) in `web.yml` — LCP ≤ 2 500 ms, CLS ≤ 0.1, script transfer ≤ 174 080 B, and
`categories:performance` ≥ 0.90 — on the fixture result page AND on a real preset page, so the
criterion's own score is measured at the median of three runs (0.98 on both pages, measured
locally). The wizard at 360×800 is Playwright-covered; criterion 3 has no origin to run against.

## 6. Measured state of the scaffold (2026-10-20)

Run in `apps/web` on the rebased branch, Node 24 locally (CI pins 22):

| Check | Result |
|---|---|
| `npm ci` | exit 0 |
| `npm run build` | exit 0 — `next build` (Turbopack), 8 prerendered routes across `/fr` and `/ar` (the build reports 11 static pages), **no CSS parse warning**; `/fr/configurer` and `/ar/configurer` stay ● SSG despite `useSearchParams`, because the hook sits behind a Suspense boundary, and `/fr/config/[id]` is reported ƒ Dynamic because an id is whatever the API minted, and `/[locale]/[...rest]` is ƒ Dynamic beside it so an unknown path inside a locale renders the locale's own 404 |
| `npm run lint` | exit 0 — 0 errors, 1 warning (`postcss.config.mjs` anonymous default export) |
| `npm run typecheck` | exit 0, and also exit 0 with `next-env.d.ts` removed (the clean-CI order is safe) |
| `npm run check:api-types` | exit 0 — contract 1.6.0, 8 paths, `schema.d.ts` byte-identical to the generator |
| `npm run check:tokens` | exit 0 — 0 hex literals, 0 palette utilities, 0 physical side classes across `app/` + `components/` + `lib/` (39 files); proven RED on each of the three rule types before being trusted |
| `npm run check:i18n` | exit 0 — no inline `Intl`, no runtime-locale method, no hand-written amount/date in 37 files; proven RED on all four rule types before being trusted |
| `npm test` (Playwright, 360×800) | 152/152 pass — the 3 shell specs, S4's 19 (every mock state reachable, the typed client mapping those states, one spec pinning the fixtures' own arithmetic, one for a non-JSON 200), S2's 8 (palette count, 15 text contrast pairs, 3 UI pairs, then the rendered page: 360 px, noindex, alias chain, 48 px control + 2 px ring, `ms-auto` mirroring, the mono face's late swap), S3's 10 (per-component geometry, roles, keyboard, reduced motion), S5's 15 (lang/dir, switcher, formatting, fonts, the per-locale Arabic preload, the mono preload that is not there, CLS) and S7's 21 (12 wizard: labels from `meta/options`, keyboard-only step 1, deep link, repair, Back with values, Enter advancing the form, the last step's honest disabled action, 503 + retry, 360 px/legend/targets, Arabic, the home link; 9 model: URL parsing, ranges, backwards-only repair, round-trip, request body) and S8's 9 (7 budget: the snap note, the min and max clamps with their notices, the slider's 500 steps and both ends, Enter settling before it advances, 360 px with a 44 px rail and a real legend, the Arabic clamp; 2 model: the 500 grid with its top-of-range arithmetic, and `clampBudget` naming the bound) and S9's 12 (6 steps: the gaming/office flow lengths, a URL
naming the step an office profile does not have, the three-of-five priority list driven from the
contract's own five labels, the stored-not-applied label as the group's description in both
languages, and a contract that marks priority applied turning the label off and dropping the
resolution step; 6 model: the profile's flow, the dropped answer and the request body, the
forwards repair, the 1/3/5 priority narrowing, and `readAppliedInputs` distinguishing silence
from an empty list) and S10's 17 (10 submit: the contract body and its hand-off, the progress
block inside 300 ms with a real elapsed clock, the 422 that moves back to its field and focuses
it, the 422 about a field with no control, 413, the 429 countdown from `Retry-After`, the 503
sentence and its retry, the 500 reference, one request from a double tap, and a zero-build 200 that is a result; 7 model: the
body the wizard builds passing its own contract check, the numeric-string refusal, the ceilings
and ranges, unknown fields in contract order, and the failure map including silence-vs-empty
`details[]`) and S11's 20 (13 result-page: three cards with the first visually primary, a component row
carrying the translated role plus name, variant and price used, one build rendered as one card,
the bar's measured width and its `aria-valuetext` carrying the real amounts, an over-budget total
whose `aria-valuenow` is clamped while the sentence keeps the excess, a 404 status with a CTA that
works, an unknown path inside a locale reaching the same page, the builds present in the raw SSR
response body, no browser request to `/v1/recommendations`, the seed vocabulary absent from four
states, the zero-build state with its pre-filled way back and no invented floor number, the Arabic
RTL page, and a 503 rendered as "indisponible" with a retrying DOCUMENT navigation rather than a
404; 7 model: rank ordering with its stable tie-break and an unmutated input, the NULL-vs-0 bar
gate, the tone thresholds including the 90 % edge, remaining/over arithmetic, the over fixture's
own invariant, label coverage for every role and archetype, and the variant de-duplication), and S12's 7 (6 badge specs: the demo, indicative and verified states each asserted once, per-build scope on one response, the API disclaimer, no JSON-LD for a non-verified price, and the Arabic copy; plus one table-driven model check of the two-column mapping), and S13 11 (5 explanation specs: the collapsed server-rendered disclosure with the explanation verbatim, the mapped reason lines in order, one generic line for an unknown code with no raw code anywhere on the page, Enter/Space on the focused summary toggling `open`, and the Arabic panel; 6 reason-line checks: absent/empty is silence, the eight codes narrow to typed views, unknown codes collapse, malformed values are unnameable rather than NaN, stray entries are ignored, and roles/strategies map through the catalogue) |
| Tailwind actually processed | yes — the emitted CSS chunk contains `text-2xl`, `mx-auto`, `max-w-5xl`, `sr-only` and the `focus:` variants |

**S5's evidence (2026-10-20).** next-intl 4.14.9, `/fr` and `/ar`, both statically rendered (6
prerendered routes, 9 static pages; no dynamic route). The locale comes from `next/root-params`, never a cookie or header, and
`lang`/`dir` are in the server HTML — a test asserts them before hydration is relevant. Three
findings worth keeping:

1. **next-intl's `Link` is a client component that calls `useLocale()` unconditionally.** Using it
   in a server layout demands `NextIntlClientProvider`, which ships the whole message catalogue to
   the browser so two links can know the language. The app uses `next/link` + one `localePath()`
   helper instead, and the switcher takes `active` as a prop: the client bundle has no i18n runtime.
2. **The formatting scenario and the locale disagree, and the helper settles it.** CLDR writes
   `fr-MA` grouping as a full stop (`7.300`), which a French reader parses as a decimal separator.
   `formatMoney` rebuilds from `formatToParts` and uses U+202F, so the output is `7 300 DH` — the
   narrow space the scenario asks for, with the unit the product uses. `ar-MA` keeps Latin digits:
   that is CLDR for Morocco, not a broken font.
3. **CLS is 0 through the font swap, measured.** A `layout-shift` observer installed before any app
   code runs records nothing on `/ar`; the preloaded face is on screen before first layout. This is
   the metric Lighthouse aggregates, measured directly — Lighthouse itself is S6. Since the review
   the Arabic face is self-hosted and preloaded only for `dir="rtl"`, and Geist Mono is not
   preloaded at all, so the same 0 no longer costs French pages 136 KB of Arabic plus 23 KB of mono
   (I18N.md §5 has the before/after numbers, and the non-zero residue under a 400 kbps throttle).

**S3's evidence (2026-10-20).** Eight components on `@/components/ui`, no `"use client"` in any of
them: the interactivity is a native button, a native radio and a native range, so keyboard support
and the accessibility tree come from the platform. The specs assert what pixels cannot: 48 px / 44 px
targets, `progressbar` values that stay truthful past 100 % while the fill clamps at the rail, one
`alert` and one `status` rather than a page full of live regions, an arrow key that moves both the
slider and the field beside it, and a skeleton whose pulse collapses under `prefers-reduced-motion`.
Three decisions are worth naming: `ChoiceCard` paints selection as border + ring instead of the
board's literal 2 px border so selecting a card does not shift the list; every amount goes through
`Intl` with `fr-MA`, which groups with a point, so the proof sheet prints `8.500 MAD` while the
board's copy writes spaces (S5 owns the final call); and the gate now also scans `components/`,
which is why its file count went 7 → 20.

**S2's evidence (2026-10-20).** The board was read over the Stitch MCP and every literal it declares is
in the token file as OKLCH, with the hex kept in the map because that is what a designer pastes.
**Contrast is COMPUTED, not eyeballed:** the spec parses the `oklch()` values back out of
`globals.css`, converts OKLab → sRGB and applies the WCAG relative-luminance formula, asserting 4.5:1
for 15 text pairs and 3:1 for 3 graphical ones. That measurement is what caught the one real defect
in the board: its saffron warning bar is **1.71:1** against the rail, so the token takes `#B45309`
(4.00:1) and saffron stays a fill-only accent. The two thin margins are named rather than rounded
away — `warning` on `warning-soft` is 4.51:1 and `success` on `success-soft` 4.57:1 — with the tested
darker replacements recorded if either ever needs room. RTL is asserted, not asserted-by-review:
`ms-auto` is measured on both sides of a live `dir` flip. The gate itself was proven red first
(a hex literal, a `bg-stone-200`, an `ml-2`), because a check that has never failed is not a check.

**S4's evidence (2026-10-20).** The drift gate was proven RED four ways and restored to PASS after
each: a hand-edited `schema.d.ts` (stale types, named at the first differing line), a MUTATED
SNAPSHOT (the sprint DoD's literal scenario — red at line 438, with the fix named), a raised
`EXPECTED_VERSION` (the snapshot is 1.6.0), and a removed `EXPECTED_PATHS` entry (a path set that
changed). The comparison normalizes line endings, because this box runs `core.autocrlf=true` and a
CRLF checkout of the same content is not drift: proven PASS on a CRLF copy and FAIL on a CRLF copy
with one changed line, and `.gitattributes` pins `schema.d.ts` to LF so the artifact stays stable.
The contract spec drives the SHIPPING client, not a second implementation: 201 (both
`price_status` values, both `offer_class` values), 200 dedupe (`reused: true`), zero-build with a
computed floor, zero-build with a `null` floor and `missing_roles`, 422 with `details[]`, 413, 429
(`retryAfterSeconds` from `Retry-After`), 503, slow mode, and an unreachable API as
`NETWORK_ERROR` rather than a crash. A 19th spec pins the FIXTURES' own arithmetic — a build's
`total_price` equals its components' sum, a floor repeats the response budget, and `strategy_key`
is a Decision 41 archetype — after review found `PRICE` (not a key) and two totals that did not add
up.

**Superseded finding.** This file previously held only one section, §2.5, reporting that the scaffold
had **no Tailwind v4 integration**: no `@tailwindcss/postcss`, no `postcss.config.*`, and a build that
emitted `Unknown at rule: @theme`. That is **not true of the committed tree**: the scaffold commit
ships `postcss.config.mjs` registering `@tailwindcss/postcss`, the devDependency is in the manifest,
and the build emits real Tailwind utilities with no warning — measured above. It is kept here only as
the record of a review performed against a working tree that was not the committed one; do not act on
it.

## 7. What is missing from the plan, stated plainly

- **The web host is chosen; nothing is deployed.** The decision is Cloudflare Workers through the
  OpenNext adapter (2026-10-23) and the config is committed, but a committed `wrangler.jsonc` is not
  an environment: there is no preview URL, no staging deployment and no CI step that deploys, so the
  M3 staging run is gated by the deploy rather than by the host choice.
- **`/v1/docs/json` is the only contract source, and it is pinned one level up.** S4 generates the
  client types from the API's committed `apps/api/test/unit/openapi-v1.6.json` rather than copying it
  into `apps/web`, so the tree holds one contract; the cost is that the web package's drift gate
  reads a sibling package's file and cannot run from `apps/web` alone.
- **The pinned contract can still be BEHIND the deployed one.** The gate compares the snapshot to the
  generated types, never to a running service; a deployed API one version ahead is invisible to it.
  Comparison-before-first-request is a P1 item (a deployed origin), not an S4 defect.
- **`apps/web` has never spoken to a DEPLOYED API.** Since S4 there is a client, a base-URL
  environment variable (`NEXT_PUBLIC_API_BASE_URL`) and 19 specs (6 driving the client, 13 driving the mock) — but all of them
  point at the local fixture mock. No real origin exists to call, so CORS-to-server, real latency and
  real 429 behaviour are unproven rather than merely untested.
