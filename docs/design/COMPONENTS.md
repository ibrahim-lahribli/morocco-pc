# Component kit (S3)

**What this file is.** The reference for the eight components in
`apps/web/components/ui/`: what board section each one reproduces, the geometry
it was built to, the small API it exposes, and the accessibility contract the
tests pin. It is the per-state record S3's definition of done asks for; the
pixels themselves are on `/fr/kit` (a `noindex` proof sheet), and the assertions
are in `apps/web/e2e/kit.spec.ts`.

**Source.** The Stitch board `b4659f8eea5c410791a48ad27cc1fb93` ("Design System
Board (360px)"), sections 4 and 6–10 and 15–16. Token values and their measured
contrast live in [TOKEN_MAP.md](TOKEN_MAP.md); nothing here redefines a colour.

**The eight, one import path.** `import { Button, TextField, … } from "@/components/ui"`.

| Component | Board | States built | Height |
|---|---|---|---|
| `Button` | §4 | primary, secondary, ghost, whatsapp, disabled, compact | 48 px (`compact` 44 px) |
| `TextField` | §8 | default + hint, filled with `MAD` suffix, error | 48 px input |
| `Slider` | §8 | default, disabled | 44 px hit area, 8 px rail, 24 px thumb |
| `ChoiceCard` | §6 | unselected, selected, disabled | ≥ 48 px |
| `Badge` | §9 | `demo`, `indicative`, `verified` | pill |
| `ProgressBar` | §10 | `normal`, `warning`, `over` | 10 px rail |
| `Skeleton` | §15 | card placeholder, line blocks | — |
| `Alert` | §16 | `info`, `warning`, `error` | 12 px padding |

## What each one is built on

The kit's oldest decision is that **interactive behaviour comes from a native
element**, not from a hook. That is where keyboard support, the accessibility
tree and mobile behaviour actually come from, and it is why none of these files
has `"use client"`.

- **Button** is a `<button>` with `type="button"` by default. A `<button>`
  without a type submits any form it lands in; that default has caused more bugs
  than any styling decision here. `ghost` keeps a 48 px target: the board's "lien
  / texte" is a full-width row, not a 20 px text link.
- **TextField** is a labelled `<input>`; the unit inside the field is
  `aria-hidden`, because a screen reader should hear "Votre enveloppe cible,
  8 500 DH" once, not "MAD MAD". Error replaces hint rather than stacking, so
  `aria-describedby` never points at two competing sentences.
- **Slider** is `<input type="range">`. Arrow keys, Home/End, PageUp/PageDown,
  `aria-valuemin|max|now` are the browser's. The component adds the two things
  native does not: an accessible name, and `aria-valuetext` ("8 500 DH"
  instead of "8500"). `app/globals.css` styles only the track and thumb.
- **ChoiceCard** is a native radio, `sr-only` but focusable, inside a `<label>`
  that is the whole card. Arrow keys move the selection; the ring is painted on
  the card because the input is invisible.
- **Badge** is a `<span>`: it is a status, not a control, so it has no role and
  no tab stop. Three tones, each with its own word AND its own icon shape, so
  the states survive greyscale and a screen reader.
- **ProgressBar** is a `div[role="progressbar"]` with an explicit `aria-label`
  (the sentence that says WHAT is being measured), the real `aria-valuenow`
  (104 % stays 104) and a fill clamped to 100 % so nothing paints outside the
  rail.
- **Skeleton** is `aria-hidden` decoration. Progress is announced by the
  screen's own live region, not by each shimmering rectangle.
- **Alert** is a `div` whose role depends on tone: `error` is `role="alert"`
  because the next click may be wrong; `info`/`warning` are not live regions,
  because they are usually already there on load and announcing them would be a
  lie about when they appeared. A banner that IS the result of an action passes
  `role="status"` explicitly.

## Geometry, as measured

| Property | Value | Source |
|---|---|---|
| Control height | 48 px (`--spacing-control`) | board §4 |
| Compact / secondary tap target | 44 px (`--spacing-tap`) | WCAG 2.5.8 floor |
| Slider hit area | 44 px (`--spacing-tap`), 8 px rail, 24 px thumb | board §8 + WCAG 2.5.8 floor |
| Control / card / pill radius | 8 / 12 / 9999 px | board §3 |
| Input padding | 14 px inline start, 56 px when a suffix is present | board §8 |
| Notice padding | 12 px, icon 20 px, gap 10 px | board §16 |
| Badge padding | 10 px inline, 4 px block, 14 px icon | board §9 |
| Progress rail | 10 px tall, pill radius | board §10 |
| Focus ring | 2 px `primary`, 2 px offset, everywhere | board §4 |

## Money is formatted, not typed

Every amount on the proof sheet goes through `formatMoney` from
`lib/i18n/format.ts` (plan §2 V11), which S5 added after this kit landed. The
final format is **`8 500 DH`**: a narrow no-break space between groups and a
no-break space before the unit. S3 had briefly printed `8.500 MAD` straight from
CLDR; a full stop reads as a decimal separator in French, and `MAD` adds cents
nobody quotes. See [I18N.md](I18N.md) §4 — that is where the decision lives now.

## Two visual deviations from the board

1. **The selected card is a 1 px border plus a 1 px ring**, not the board's
   literal 2 px border. Same 2 px edge, but selecting a card does not nudge every
   card below it by a pixel. The selected fill and dot are the board's.
2. **The warning bar is the dark amber token**, not saffron: measured 1.71:1 on
   the rail. See [TOKEN_MAP.md](TOKEN_MAP.md) §6.

## What the tests actually assert

`e2e/kit.spec.ts` runs at 360 px and checks what a screenshot cannot:

- geometry — 48 px buttons, 44 px compact, 48 px inputs and cards;
- roles — `progressbar` with 79 / 99 / 10400 values, one `alert`, one `status`,
  icons `aria-hidden`, badges `nowrap`;
- keyboard — Tab reaches a real button and paints a 2 px ring; ArrowRight moves
  the slider by one step and updates the field beside it; ArrowDown moves the
  radio selection and focuses the next card;
- reduced motion — the skeleton's animation collapses to ~0 ms;
- token landing — the three badge tones and the three bar fills resolve to three
  distinct colours, so a component cannot silently fall back to one.

Contrast is not re-measured here: `e2e/tokens.spec.ts` owns the palette matrix,
and these components are built only from those tokens.

## Consumers

| Component | First real use |
|---|---|
| `Button`, `TextField`, `Slider`, `ChoiceCard` | S7–S9 (wizard steps) |
| `Badge`, `ProgressBar` | S10–S11 (results, build cards) |
| `Alert`, `Skeleton` | S10, S14 (loading, zero-result, errors) |

## Not in the kit

- The step indicator (§5), component row (§11), strategy card (§12), disclosure
  (§13) and share bar (§14) are composition, not primitives — they belong to the
  screens that own them.
- The `ar` locale, its font subset and the locale switcher (S5, S20).
- Dark mode: no board defines one, so no component pretends to support it.
