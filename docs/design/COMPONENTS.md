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
## The submit states (S10)

The last step's button posts the body `toRequest()` describes, and `SubmitPanel` renders what comes
back. Two rules are worth keeping.

**One action.** A failure turns the primary button into "Réessayer" rather than adding a second
retry control: the countdown applies to the one button the user is already looking at. The failure
kinds are `fields | too-large | rate-limited | unavailable | server` (`lib/wizard/submit.ts`), and
the words for each live in the catalogue, never in the component.

**The bar does not predict.** `POST` reports nothing until it answers, so the progress bar moves
only between the two observable facts — sent (50) and answered (100) — and carries that in
`aria-valuetext`. The proof that the page is alive is the elapsed-seconds caption, which is a real
measurement. A bar that creeps toward 90 % would be a number nobody can check, which is the same
reason `budget_floor` is never invented and a NULL price is never drawn as `0`.

`ChoiceGroup` grew an `error` prop for the 422 case, with the kit's existing rule applied: an error
beats the hint, so `aria-describedby` points at the fix rather than at two competing sentences,
and the group's selection is never cleared.
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
| `Badge` | **S12** — the price-provenance pill on every build card (démo / indicatif / vérifié) |
| `ProgressBar` | **S11** — the total-vs-budget bar on every build card |
| `Alert`, `Skeleton` | S10, S11 (the over-budget warning and the unavailable state), S14 (zero-result, errors) |
| `buttonClasses` | **S15** — the share bar's external wa.me `<a>` on the kit's WhatsApp variant |

## The results composition (S11)

`/fr/config/[id]` is where the kit's parts are composed for the first time, and the composition
lives in `apps/web/components/result/` rather than in the kit: a build card (§12) and a component
row (§11) are shapes a screen owns, not primitives.

**Rank is data, position is display.** `lib/result/model.ts` `orderBuilds()` sorts by the API's
`rank` with a stable tie-break, and the page maps `builds[]` without padding it — one build renders
one card (V13). The first card is primary by a 1 px border plus a 1 px ring and the board's ambient
shadow, so nothing reflows when the count changes.

**The bar is drawn only from two positive numbers.** `barFigures()` refuses a NULL total or budget,
which is why the page has no bar to draw for an unrecorded price and never paints 0 %. The bar's
`aria-valuetext` is the SENTENCE the DoD asks for — the total, "sur", the budget — because ARIA
clamps `aria-valuenow` to the maximum: an over-budget build would otherwise be announced as exactly
on budget. The over state is the `over` tone plus an `Alert` that names the excess; it is
deliberately not a fourth `Badge` tone, because those three tones are the price-provenance states
(S12) and a pill cannot say by how much.

**Roles and variants are words.** The component row translates the engine's role enum
(`roleLabel()`, with "Autre" for anything it does not know) and prints `variant` only when
`display_name` does not already contain it — the fixture's GPU is named "RTX 4060 8GB" with
`variant: "8GB"`, which would otherwise read "8GB · 8GB". `offer_class` is never rendered:
`SEED_UNVERIFIED` on screen is the V5 failure this page exists to avoid.

**A retry must re-run the server.** `LinkButton` gained `reload`: it renders a plain `<a>`
instead of `next/link`, because a router push to the URL already in the address bar is a no-op and
the unavailable state's "Réessayer" would look like one. It is the only place in the app that wants a
document navigation, and it is documented on the prop.

**The price badge dates the CALCULATION, not a survey (S12).** `priceProvenance()` folds the
build's derived `price_status` and its components' `offer_class` into the board's three states, so an
all-seed pass says "démo" instead of hiding inside "indicatif" — the API's two-state field cannot
tell those apart. Only `verified` carries a date, and it reads "calculé le {generated_at}": the
contract has no per-offer observed date (CD-6), so "prix constatés le" would claim a survey nobody
performed. The tones are the kit's unchanged — démo dashed muted, indicatif warning, vérifié
success — and a card's `data-tone` is the BUDGET tone, which is why the badge carries its own
`data-tone` on its own element.

**The explanation is a native disclosure (S13).** `BuildExplanation` is a `<details>`/`<summary>`
pair, collapsed in the server HTML: the element owns its expanded state, its Enter/Space
operation and the announcement of both, so there is no client island and no ARIA to keep in sync
with the DOM. It renders the committed `explanation` verbatim while the contract is silent
(CD-2) and switches to catalogue lines the moment `reasons[]` is served; the parser
(`lib/result/reasons.ts`) never prints a code, and a malformed value gets the same generic line
an unknown code does.

## The zero-build and error states (S14)

A zero-build pass has one heading and three sentences, and `lib/result/model.ts`
`zeroBuildAdvice()` chooses which: a priced floor renders "Budget minimum conseillé : {montant}"
plus the caveat "Estimation minimale, non garantie : c'est un plancher, pas une configuration
réalisable.", an unpriced floor (`cheapest_total: null`, roles missing) renders guidance WITHOUT
a number, and a floor absent entirely (`budget_floor: null`, a GET revisit of a pass committed
before CD-7) renders the generic "Budget insuffisant". All three share one `Alert` primitive,
tone `warning`, and none can show a 0 — the narrowing refuses 0, negative and non-finite the
same way it refuses NULL (NULL != 0).

A 429 read keeps the API's `Retry-After` seconds as a STATIC sentence ("Réessayez dans
{seconds} s."): the results page is a server component, so it has no client timer and does not
re-implement the wizard's ticking countdown (S10). A 429 without a usable `Retry-After` shows
no number at all, and 503 keeps the generic retry. Both live in the same error-state `Alert`,
and the ways out are the `LinkButton reload` links result.spec.ts pins.

## The share bar (S15)

`The results page shares a result through ONE canonical URL (`absoluteResultUrl()` in
`lib/result/share.ts`), three channels and one composition: a wa.me `<a>` built server-side, a
copy `Button` and — revealed only where `navigator.share` exists — a native-share button
(`useSyncExternalStore`, no effect-set cascade). The strings arrive as props because the
layout ships no client catalogue; `buttonClasses()` (exported from the kit) puts the button's
geometry on the external anchor so two owners of the styles stay one owner.

The copy path writes the canonical URL and announces it in a live region that exists EMPTY
from the first render; success through the share sheet announces nothing, because no false
"copied" is better than an announcing copy. `og:`/`twitter:` meta and the 1200x630 `next/og`
card draw the RANK-1 build's total and the badge's own word, from a request-scoped
`cache()`d read so one visitor request is one API call; a pass with no priced primary build
gets a numberless preview, never a 0. `check:tokens` exempts the card's hex literals only,
because Satori speaks neither CSS nor Tailwind.
## Not in the kit

- The step indicator (§5) and share bar (§14) are composition, not primitives — they belong
  to the screens that own them. The component row (§11), the strategy card (§12) and the
  explanation disclosure (§13) are now built, at `components/result/`.
- The `ar` locale, its font subset and the locale switcher (S5, S20).
- Dark mode: no board defines one, so no component pretends to support it.
