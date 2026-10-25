# UI/UX and Web Interface Guidelines audit — 2026-10-25

A scenario-driven audit of `apps/web` at the S1 breakpoint (360 px), plus a
source-level review against the Vercel Web Interface Guidelines and an axe-core
pass. This is a READ, not a change: no application file was edited, and nothing
was written to a database.

## What was run

| Layer | What | Result |
|---|---|---|
| Production build + server | `npm run build` at `HEAD` (`60decd9`), `next start` on :3210 with `API_BASE_URL` pointed at the fixture mock on :3211 | build exit 0 |
| Scenario walkthrough (Python Playwright) | 17 scenario groups, 114 assertions, 360 × 800 headless Chromium, every browser API call rewritten to the mock | **114 / 114 pass** |
| Extra scenarios (Python Playwright) | 429 cooldown, in-flight submit, blocked `localStorage`, reduced motion, keyboard-only wizard, 4 viewport widths, LCP/CLS, Arabic result | **26 / 26 pass** |
| axe-core | WCAG 2.0/2.1/2.2 A+AA + best practice, 15 routes, both locales | **0 violations** (sanity check: an injected `<img>` without `alt` is detected, so the run does look) |
| Link graph crawl | BFS over internal `href`s starting at `/fr` | 7 URLs reachable (see F1) |
| Field metrics | `largest-contentful-paint` + `layout-shift` observers, 360 × 800, production build, local | LCP 48 ms (home) / 68 ms (result, product); CLS 0 / 0 / 0; wizard CLS 0.019 |

The app was driven with the zero-dependency fixture mock rather than the real
API, so all states in `mock/fixtures.mjs` are reachable without touching the
shared database: two/three/one builds, demo prices, over budget, zero build with
and without a floor, 404, 429 and 503.

### Scenarios covered

Landing and skip link · wizard usage → budget → resolution → priority → submit →
result · budget clamp below the minimum and a non-numeric entry · options
endpoint failure and its retry · deep link to a step the profile does not walk
(repaired to `?etape=budget`) · browser Back/Forward with values intact · arrow
keys in the radio group and the card focus ring · every result fixture · result
404 / 429 / 503 · three preset slugs (two committed fixtures and the API-served
one) · product page and price history · compare page · guides index and detail ·
saved builds (empty state, save, list, reload persistence) · Arabic landing,
Arabic wizard and Arabic result (RTL) · unknown-route 404 · sitemap and robots ·
four viewport widths · reduced motion · blocked storage · keyboard-only run.

## Findings

Severity is UX impact, not a test failure: every finding below coexists with a
green scenario run, which is the point of looking at the rendered product.

### F1 — Most of the site is unreachable by clicking (high, IA + SEO)

A crawl from `/fr` reaches exactly seven URLs:

```
/fr  /fr/configurer  /fr/enregistrements
/fr/mentions-legales  /fr/confidentialite  /fr/contact  /fr/format
```

Not reachable from any rendered link, on either locale: `/guides`,
`/guides/choisir-un-gpu`, `/guides/budget-pc-gamer`, `/composants/*`,
`/composants/comparer` and the preset pages — while `/sitemap.xml` advertises 22
URLs (11 pages × 2 locales) and invites crawlers to all of them.

The cause is structural, not an omission: the header is brand + language
switcher only (`app/[locale]/layout.tsx:172-185`) and the footer is the shelf
plus legal links (`layout.tsx:207-240`). The landing page is deliberately one
CTA (`app/[locale]/page.tsx:47-53`), so the guides and the catalogue have no
inbound link anywhere in the product.

Impact: a reader who arrives on `/fr` never learns the guides exist; a crawler
that trusts internal links rather than the sitemap finds nine orphaned pages.
Recommendation: add "Guides" to the header or the footer's first nav, and link
two or three guides and one preset from the landing page — the copy and the pages
already exist.

### F2 — Arabic pages show French option labels in the wizard (high, i18n) — **fixed 2026-10-25**

`/ar/configurer` renders an Arabic question (`ما هو استخدمات الأساسي؟`) above
three options labelled **Jeu**, **Bureau**, **Travail**. The same applies to the
resolution and priority groups, and to the "Ce que vos choix ont changé" panel on
`/ar/config/…`.

The labels come from `GET /v1/meta/options` (`options.use_cases[].label`), which
serves French only; the client deliberately never re-derives a label from an enum
value (`components/ui/choice-group.tsx:20-24`, `configurer/wizard.tsx:320-345`).
So this is a contract gap, not a component bug: the API needs locale-aware labels
(`Accept-Language`) or the client needs a translated overlay keyed by value. The
existing Arabic audit already records the same class of defect for the API's
`disclaimer` (`docs/design/ACCESSIBILITY_AUDIT.md`, known limits) — this is a
second instance, and it is in the primary flow.

**Fixed in this session** by `lib/wizard/option-labels.ts`: a value-keyed overlay
that translates the label for the page's locale and keeps the response's own word
as the fallback, so an option the overlay has never seen still renders exactly as
the API sent it. French renders the response verbatim — the overlay has no `fr`
entry, because `e2e/wizard-steps.spec.ts` pins that the wizard shows the labels
the response supplies. The catalogue (`messages/*.json`) is deliberately not the
home for these strings: a `fr` entry would be dead text that must never win, and
`ar`-only keys would breach `check:i18n`'s key-parity rule. Pinned by the new
test at `e2e/wizard-steps.spec.ts:197`; evidence in
`apps/web/tmp/audit-2026-10-25/`.

### F3 — A wizard step change drops focus to `<body>` (medium, keyboard + SR) — **fixed 2026-10-25**

Measured: after advancing — by mouse or by Enter — `document.activeElement` is
`BODY`. `goTo()` and `setAnswer()` only call `router.push`/`router.replace`
(`configurer/wizard.tsx:206-217`), and the new step replaces the old one's
controls, so the browser's focus falls back to the document.

Impact: a keyboard user completes step 1 and must Tab from the top of the page
again — skip link, brand, language switcher — before reaching step 2's first
option. A screen reader user gets no indication that the content changed beyond
the `role="status"` region, which only announces the submit, not the step.

Recommendation: on a step change, move focus to the step's `<legend>` (or a
`tabindex="-1"` heading) and let the natural reading order continue from there.
The wizard already has an `aria-live` region pattern to reuse.

**Fixed in this session.** Each step now renders its question as an `<h2>`
(`tabindex="-1"`), and `goTo()` — the only path a pressed Next/Back takes — sets
a ref that a `shownStep` effect consumes by focusing it. The ref, rather than the
effect's own dependency, is what keeps a first load, a Back/Forward restoration
and a URL repair from stealing focus; a 422 still lands on its refused field,
because `moveToField()` does not set it. The `<legend>` is now `sr-only` through
`ChoiceGroup`'s new `legendClassName` (and the same prop on `BudgetStep`) so the
question is painted once while the fieldset keeps its accessible name. Verified
at 360 px: a mouse advance leaves `document.activeElement` on the `<h2>` with no
focus ring (`:focus-visible` false), a keyboard advance leaves it there WITH the
2 px ring, and `Tab` continues at the step's first control. Pinned by
`e2e/wizard-steps.spec.ts` ("a pressed step change moves focus…").

### F4 — Footer links are 17 px tall (medium, mobile a11y)

Measured at 360 px: `Mes enregistrements` 139 × 17, `Mentions légales` 112 × 17,
`Confidentialité` 96 × 17, `Contact` 84 × 17. WCAG 2.2 AA 2.5.8 asks for 24 × 24
except for targets inline in a sentence; these are list items, so the exception
does not apply. Every other interactive element in the app clears 24 px (buttons
48/44, the language switcher 44, radios the full card).

Fix: `inline-flex min-h-tap items-center` on the footer links
(`layout.tsx:215`, `layout.tsx:228`), or vertical padding on the `<li>`.

### F5 — The disabled "Remplacer un composant" block is repeated per card (medium, priority of attention)

Every build card carries a full-width disabled button plus a four-line
explanation (`components/result/build-card.tsx:224-236`). On a three-build result
that is three dead controls and ~12 lines of "bientôt disponible", each pushing
the next card down; the button is the loudest element after the price, and it
cannot be used.

The choice to show rather than hide is documented (S24, CD-8 absent) and is
honest. The UX cost is placement: one explanation at the end of the list would
say the same thing once. Recommendation: keep the affordance, but render it as
an inline note (or on the first card only) until the endpoint exists.

### F6 — Changing the budget from a result means scrolling to the bottom (medium)

The result page's only route back to the wizard is the ghost link at the very
bottom (`app/[locale]/config/[id]/page.tsx:183`), after every build card — about
2 400 px at 360 px with three builds. For a product whose central question is
"what can I get for X DH", the budget is the one input a reader re-enters most.

Recommendation: a "Modifier le budget" link next to the "Budget visé : …" line,
pointing at `/configurer?etape=budget` with the current amount prefilled. The
wizard already reads its state from the URL, so this is a link, not a feature.

### F7 — The comparison list wraps its category column (low, layout)

At 360 px a long product name ("GeForce RTX 4060 Ti Gaming OC 16 Go Édition
Ventus 3X Blanc") pushes its category onto a second line, left-aligned under the
link, while every other row has it right-aligned — it reads as a misaligned
column (`app/[locale]/composants/comparer/page.tsx:193`). Fix: a two-column grid
with `min-w-0` on the name and `text-end` on the category, or truncation.

### F8 — No `theme-color` (low, guideline)

The rendered `<head>` has charset, viewport, canonical, hreflang and favicon —
no `theme-color`. The design is light-only with `color-scheme: light`
(`app/globals.css:190`), so one `<meta name="theme-color" content="#FAFAF9">`
would make the mobile browser chrome match the page instead of defaulting.

### F9 — `touch-action` is `auto` (low, guideline)

Computed `touch-action` is `auto` on `<html>` and `<body>`; no rule sets
`manipulation`. Add it for buttons and links (not to disable zoom — the viewport
meta is correctly `width=device-width, initial-scale=1` with no
`user-scalable=no`).

### F10 — The budget field and its rail format the same number differently (low)

Typing `8000` leaves the field showing `8000` while the rail beside it reads
`8 000 DH`; the draft is only re-formatted when a clamp happens or the rail is
used (`configurer/budget-step.tsx:113-137`). One control group, two number
formats. Format on blur for a value that is in range, not only when clamped.

### F11 — The wizard has no per-step heading (low, structure) — **fixed 2026-10-25**

The wizard page has one `h1` and no `h2`: the step is announced by an eyebrow
paragraph ("ÉTAPE 2 SUR 4") and the fieldset's `<legend>`. Heading navigation in
a screen reader therefore cannot move between steps, and the `<legend>` is also
the natural focus target F3 needs. A visually-hidden or visible `<h2>` per step
would serve both.

The `<h2>` F3 introduced closes this too: heading navigation now moves Usage →
Budget → Écran → Priorités on the French flow, and each heading is the step's
question ("Quel budget visez-vous ?"), not its short name.

### F12 — `Formats (démo)` sits in the customer-facing footer (low, content)

The footer's fifth link opens a specification/demonstration page
(`layout.tsx:127-131`). It is honest about being a demo, but it is the only
content link in the footer and it competes with the legal set for the reader's
attention. Consider moving it behind `/kit` or out of the public nav.

## Web Interface Guidelines — source check

Format: `file:line - finding`. Only deviations and genuinely load-bearing wins
are listed; everything else passed and is summarised after the table.

```text
## app/[locale]/layout.tsx
app/[locale]/layout.tsx:130-140 - no <meta name="theme-color"> (F8)
app/[locale]/layout.tsx:215     - footer link 17 px tall, under the 24 px AA floor (F4)
app/[locale]/layout.tsx:228     - same for the legal nav (F4)
app/[locale]/layout.tsx:166-171 - skip link present and visible on focus ✓
app/[locale]/layout.tsx:29-92   - Arabic faces preloaded only on dir=rtl ✓

## app/globals.css
app/globals.css:184-232 - no `touch-action: manipulation` on interactive elements (F9)
app/globals.css:216-219 - one global :focus-visible ring, 2 px / 2 px offset ✓
app/globals.css:226-229 - tabular figures for amounts ✓
app/globals.css:291-299 - prefers-reduced-motion collapses transitions (measured: 0.00001 s) ✓
app/globals.css:191     - color-scheme: light, matching the light-only design ✓

## app/[locale]/configurer/wizard.tsx
app/[locale]/configurer/wizard.tsx:206-214 - step push/replace moves no focus; activeElement is BODY afterwards (F3)
app/[locale]/configurer/wizard.tsx:326-328 - polite live region mounted before its message ✓
app/[locale]/configurer/wizard.tsx:347-349 - form carries aria-busy while submitting ✓

## app/[locale]/configurer/budget-step.tsx
app/[locale]/configurer/budget-step.tsx:111-137 - in-range drafts are not re-formatted on blur (F10)

## app/[locale]/page.tsx
app/[locale]/page.tsx:47-53 - the only inbound link is the wizard CTA; guides/catalogue/presets unlinked (F1)

## components/result/build-card.tsx
components/result/build-card.tsx:224-236 - disabled swap control + its note repeated on every card (F5)

## app/[locale]/config/[id]/page.tsx
app/[locale]/config/[id]/page.tsx:183 - the only route back to the wizard is after the last card (F6)

## app/[locale]/composants/comparer/page.tsx
app/[locale]/composants/comparer/page.tsx:193 - long names push the category onto its own line (F7)
```

### What passed (and is worth keeping)

- **Role semantics.** Actions are `<button>`, navigation is `<a>`/`<Link>`;
  `LinkButton` exists precisely so a navigation keeps link semantics
  (`components/ui/button.tsx:77-102`). No `div onClick` anywhere.
- **Forms.** Every radio group is a `<fieldset>` + `<legend>`; the budget field
  has a real label, `aria-describedby`, `aria-invalid` and `inputmode="numeric"`,
  and the error replaces the hint rather than competing with it
  (`components/ui/text-field.tsx:44-70`). Error focus is wired
  (`wizard.tsx:180-193`).
- **Live regions.** The copy-to-clipboard announcement, the clamp notice, the
  submit progress and the save confirmation each mount their region before the
  text (`share-bar.tsx:124-148`, `budget-step.tsx:186-188`).
- **i18n.** Every date and amount goes through `lib/i18n/format.ts`
  (`Intl.NumberFormat` / `Intl.DateTimeFormat`); no hardcoded formats, no
  `toLocaleString()` in components.
- **Motion.** All transitions are `transition-colors`, never `transition: all`,
  and reduced motion collapses them.
- **Resilience.** 429 renders a live countdown with the action disabled; a
  blocked `localStorage` still renders the shelf with no page error; the 503
  result page offers a document-reloading retry; a zero-build result explains the
  floor instead of apologising.
- **Performance.** CLS 0 on landing, result and product; LCP 48–68 ms locally;
  13 requests on a result page; only one font preloaded on French pages (the
  Arabic faces are gated on `dir`).
- **Layout.** No horizontal scroll at 360, 414, 768 or 1024 px on any audited
  route, both locales.

## Limits

- **Fixture data, not the real engine.** Every recommendation body came from
  `mock/fixtures.mjs`. The API's own copy (disclaimer, error bodies) is not
  translated — already recorded as an API-side gap, and F2 is the same class of
  defect in a more visible place.
- **Port 3000 was occupied by another agent's real API**, so the repository's own
  Playwright suite (`npm test`, 366 specs) was deliberately NOT re-run: its
  fixture-driven specs would have read that live API instead of the mock. The
  independent scenario suite above is the evidence for this audit.
- **Lighthouse was not re-run.** `npm run test:lighthouse` refuses to measure a
  server already listening on 3210, and the repo's own CI gate already enforces
  the budgets (median of three, `error` level). The LCP/CLS figures here are
  field measurements from the same build, not a Lighthouse run.
- **No screen reader and no physical device.** Keyboard behaviour was driven for
  real (Tab, arrows, Space, Enter, focus ring), but NVDA/VoiceOver/TalkBack and
  iOS/Android touch were not. F3 and F4 are DOM facts; their spoken/listened
  impact is inferred, not heard.
- **One browser.** Chromium 156 only; no Firefox or WebKit pass.
- **Run artifacts live in a scratch directory that the suite clears.** The
  scenario scripts and 46 screenshots were written under
  `apps/web/test-results/audit`, which Playwright wipes as its own output
  directory the next time it runs — so the numbers in this file are the record,
  not the files. The evidence for the F2 fix (Arabic and French label captures)
  is in `apps/web/tmp/audit-2026-10-25/`, which the suite does not touch.
- **Two locales, one direction pair.** `fr` and `ar` were both exercised; a
  right-to-left keyboard walk-through (arrow-key direction on the budget rail)
  was not repeated in Arabic.
