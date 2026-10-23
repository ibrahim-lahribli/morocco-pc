# Accessibility audit — S21 (2026-10-22)

The record of what was checked, how, and what remains unchecked. The gate is
`apps/web/e2e/a11y.spec.ts` (47 checks at S21, 51 since S23 and S25, run by `npm test`, so CI runs it); this
file is the part a green run cannot carry: the manual list, the proofs that the
gate actually fires, and the limits.

## Result

| Check | Result |
|---|---|
| axe, WCAG 2.0/2.1/2.2 A + AA, over every route × locale | **0 violations** |
| 200 % zoom (layout at 640 px) on the wizard and a result page, both locales | no horizontal scroll, all three landmarks present |
| Viewport meta never forbids zoom | pass (`user-scalable=no` and `maximum-scale=1` absent) |
| Every `<img>` declares `width` + `height` | pass (three routes) |
| No `onClick` on a non-interactive element | pass (static scan of `app/` + `components/`) |
| No `transition: all` / `transition-all` | pass (static scan) |
| Token contrast pairs | pass — measured in `e2e/tokens.spec.ts` (15 text pairs, 3 UI pairs, 4.5:1 / 3:1) |

## Method

`@axe-core/playwright` (devDependency, `^4.14.0`), tags `wcag2a`, `wcag2aa`,
`wcag21a`, `wcag21aa`, `wcag22aa`. Each run waits for `document.fonts.ready`
first: axe measures contrast from what is painted, and a fallback face mid-swap
is a different pixel value from the shipped one.

The route table is written out, not derived from the filesystem, because a route
only counts once someone has decided its URL — the results page needs a fixture
id, the presets need a budget, the 404 is a page too. Each audited route also
asserts its **status** and a **non-empty `h1`**, so a route that fell through to
an error shell cannot pass an axe run that never looked at the page it named.

| Route (below the locale prefix) | `fr` | `ar` |
|---|---|---|
| `/` | ✓ | ✓ |
| `/configurer?etape=usage` | ✓ | ✓ |
| `/configurer?etape=budget…` | ✓ | ✓ |
| `/configurer?etape=resolution…` | ✓ | ✓ |
| `/configurer?etape=priority…` | ✓ | ✓ |
| `/config/<three builds>` | ✓ | ✓ |
| `/config/<one build>` | ✓ | ✓ |
| `/config/<demo prices>` | ✓ | ✓ |
| `/config/<zero build + floor>` | ✓ | ✓ |
| `/config/<over budget>` | ✓ | ✓ |
| `/config-pc-gamer-9000-dh` (committed fixture) | ✓ | ✓ |
| `/config-pc-gamer-20000-dh` (API-served) | ✓ | ✓ |
| `/guides`, `/guides/budget-pc-gamer`, `/guides/choisir-un-gpu` | ✓ | ✓ |
| `/composants/rtx-4060-8gb` | ✓ | ✓ |
| `/format` | ✓ | ✓ |
| `/kit`, `/tokens` | ✓ | **404 by design** |
| a path that names nothing (404 page) | ✓ | ✓ |

`kit` and `tokens` are the style sheets of the design system, left French-only in
S20 on purpose. Their Arabic URLs are asserted to answer 404 rather than skipped
silently, so "French-only" stays a decision.

The wizard is audited at each of its four steps in both languages, because the
step machine swaps the whole form: a violation on the priority step is invisible
from the usage step.

## The manual checklist

The half a machine cannot do. Each line names where it is pinned, so a regression
fails a test rather than relying on someone re-reading this file.

| Checked | How, and where it is pinned |
|---|---|
| Focus order through a page is DOM order; the skip link is the first stop and lands on `main` | `e2e/shell.spec.ts` (skip link), `e2e/kit.spec.ts` (Tab reaches a real button and paints the 2 px ring) |
| The wizard is completable **keyboard-only at 360 px** | `e2e/wizard.spec.ts` ("keyboard-only step 1"), `e2e/wizard-steps.spec.ts` (Enter advances the form, no `div` handlers) |
| Errors announce **and receive focus** | `e2e/wizard-submit.spec.ts` (422 moves back to its field and focuses it; 413/429/503/500 each render as `Alert`) |
| Loading announces progress | `e2e/wizard-submit.spec.ts` (progress block with a real elapsed clock inside 300 ms, `aria-live` on the status line) |
| Step changes announce | `e2e/wizard-steps.spec.ts` (the step's legend names the group; the flow's own announcement copy is rendered in an `aria-live` region) |
| Sliders announce an **amount**, not a number | `e2e/kit.spec.ts`, `e2e/wizard-budget.spec.ts` (`aria-valuetext` in DH in both locales) |
| Zoom to 200 % loses nothing and scrolls nowhere | `e2e/a11y.spec.ts` ("200 % zoom" — 640 px layout on three surfaces) |
| Contrast of every token pair | `e2e/tokens.spec.ts`, provenance in [TOKEN_MAP.md](TOKEN_MAP.md) |
| RTL geometry, digit handling, bidi | `e2e/rtl.spec.ts` (21 specs) |
| Reduced motion collapses the skeleton's shimmer | `e2e/kit.spec.ts` |

**Screen reader: not driven in this pass.** No NVDA, VoiceOver or TalkBack
session was run, so nothing here claims a screen reader "reads well". What the
suite proves is the DOM contract those tools consume — names, roles, states,
`aria-live` regions, `aria-valuetext`, focus movement. Treat an AT session as the
next step, not as covered.

## Proof that the gate fires

A gate nobody has seen fail is a gate nobody can trust, so three deliberate
breaks were made, measured, and reverted:

1. An `<img>` with no `alt` added to the home page → `image-alt [critical]` on
   **both** the `fr` and `ar` home tests, and on no other route.
2. A 900 px-wide fieldset in the budget step → the 200 % zoom test failed with
   **276 px** of horizontal overflow at 640 px.
3. A `<div onClick={…}>` in a page → the static check failed naming
   `app/[locale]/page.tsx:50 <div onClick>`.

## Known limits

- **axe is not the whole of WCAG.** It finds what can be computed (names, roles,
  contrast, labels, landmarks); it does not judge whether copy makes sense or
  whether an announcement is *useful*. The manual table is the other half, and
  the screen-reader session is still missing.
- **200 % zoom is sampled, not exhaustive** — the wizard (both locales) and one
  result page. The other routes hold 360 px (`e2e/rtl.spec.ts`, shell specs), not
  640 px.
- **The API's `disclaimer` is French on Arabic pages.** It is a v1.5 contract
  string rendered verbatim (`/ar/config/...`, `/ar/composants/...`, Arabic preset
  pages); the web layer must not re-author it. This is an API fix, recorded in the
  sprint board since S20.
- **OG cards are French-only** (Satori has no Arabic face), so a shared `/ar`
  link previews French text.
- **The API's error copy** (429/503/500 bodies) is French-only where the page
  renders it verbatim; the page's own sentence is translated.
- **No dark mode**, so no contrast claim in one (S2 removed the scaffold's
  unattended palette).
