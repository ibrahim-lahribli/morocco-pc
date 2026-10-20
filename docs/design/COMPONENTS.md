# Component kit (S3)

**What this file is.** The reference for the kit in `apps/web/components/ui/`:
the eight primitives S3 built (what board section each reproduces, the geometry it
was built to, the small API it exposes, the accessibility contract the tests pin)
and the two wrappers S7 added. It is the per-state record S3's definition of done asks for; the
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
- **TextField** is a labelled `<input>`. The unit painted inside the field is
  `aria-hidden`, but the label carries an `sr-only` copy of it, so the
  accessible name is "Votre enveloppe cible MAD" — the unit is announced once,
  and never only through the hint (which an error state replaces). Error replaces
  hint rather than stacking, so `aria-describedby` never points at two
  competing sentences.
- **Slider** is `<input type="range">`. Arrow keys, Home/End, PageUp/PageDown,
  `aria-valuemin|max|now` and `step` are the browser's: the component adds
  only what native does not — an accessible name, and `aria-valuetext` (the
  amount with its currency through the caller's `format`, instead of a bare
  8500). `app/globals.css` styles only the track and thumb.
- **ChoiceCard** is a native radio, `sr-only` but focusable, inside a `<label>`
  that is the whole card. It is uncontrolled by default and takes `checked` +
  `onChange` when the screen owns the value (S7's answers live in the URL). Arrow keys move the selection; the ring is painted on
  the card because the input is invisible. The group's NAME belongs to the
  caller: cards must sit in a `<fieldset>` with a `<legend>`, which is what a
  screen reader announces before "1 sur 3" — a heading above the cards is not a
  name. `/fr/kit` and `/fr/tokens` both show the pattern.
- **Badge** is a `<span>`: it is a status, not a control, so it has no role and
  no tab stop. Three tones, each with its own word AND its own icon shape, so
  the states survive greyscale and a screen reader.
- **ProgressBar** is a `div[role="progressbar"]` with an explicit `aria-label`
  (the sentence that says WHAT is being measured), an `aria-valuenow` clamped to
  `[min, max]` and the real percentage in `aria-valuetext`, plus a fill clamped
  to 100 % so nothing paints outside the rail. The clamp is not cosmetic: ARIA
  forbids an out-of-range `aria-valuenow` and browsers clamp it in the
  accessibility tree anyway (measured in review: 104 % of 10 000 was announced as
  10 000), so passing the excess through `aria-valuetext` is the only way a
  screen reader hears it.
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

## Two wrappers S7 added

Neither is a board frame; both exist because a screen kept getting something wrong
by hand.

| Component | What it is | Why |
|---|---|---|
| `ChoiceGroup` | A `<fieldset>` whose `<legend>` is the question, containing `ChoiceCard`s for a `{ value, label }` list | The GROUP is the question and only a legend gives a group its name. Its `options` is the shape `GET /v1/meta/options` returns, so a list maps straight in and no screen derives a label from an enum |
| `LinkButton` | `next/link` with the button's base/size/variant classes | A link that navigates must be a link (open-in-new-tab, context menu, honest role). The classes have one owner, so it cannot drift from `Button`; `disabled` is absent by design |

## The budget pair (S8)

`/fr/configurer`'s budget step is the first screen that needed two controls for one answer, and the
rule it settled is worth keeping: **the slider never owns the value.** `TextField` keeps the typed
draft, `Slider` renders that same draft through `snapToStep` (the model's 500 MAD grid), and a
slider move writes back into both. The URL keeps the TYPED amount, so a 7 300 DH answer survives a
refresh while the thumb sits on 7 500; a `role="status"` note under the rail says where the thumb
is and which number is kept, instead of leaving the mismatch to read as a defect.

Clamping is `clampBudget` in `lib/wizard/model.ts`, which returns the bound that moved the
amount — the sentence itself is the message catalogue's. It runs on BLUR and never on a keystroke,
so a half-typed number is not rewritten under the caret. The pair sits in one `<fieldset>` whose
`<legend>` is the question, because a label on the field alone would name half the answer.

## The flow is derived, not fixed (S9)

`/fr/configurer` has two to four steps, and the number is a property of the answers. `stepsFor()`
in `lib/wizard/model.ts` returns the list a profile walks — the resolution question is a gaming one,
and a question the contract has declared inert is not asked — while `normalizeAnswers()` drops an
answer whose step is not in that list. That pair is the whole rule: the progress line, the step
indicator, the Back/Next targets and the POST body all read the same list, so none of them can drift
from another.

Two consequences worth keeping. A URL that names a step the profile does not have is resolved
FORWARDS (the user was heading that way) rather than reset to the beginning. And while the use case
is unanswered the flow stays FULL, because a wizard that shortens itself before the answer that
decides its length will have to rewrite what it just said.

When a question IS asked but the contract does not say the answer is read, the caveat goes on the
group as its `hint` — `ChoiceGroup` already renders that as `aria-describedby`, so the question and
the caveat are one utterance for a screen reader instead of two unrelated sentences.
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
