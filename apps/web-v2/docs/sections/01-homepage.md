# 01 — Homepage implementation specification

**Status:** **approved specification, Step 1 implemented.** The Step 1 homepage ships on
branch `feature/v2-design` (baseline `0dff27b`), and this document remains the
authoritative product and acceptance contract for it. Two release-readiness checks are
still outstanding: integration against the real API (the independent review ran against
stubbed `/v1/**` responses) and the native-language review of the Arabic copy recorded in
`../homepage-arabic-review.md`. Neither weakens an approved requirement in this document.

**Scope of this document.** The approved Morocco-PC V2 homepage: layout, section
behaviour, component architecture, API mapping, states, i18n/RTL, accessibility and
acceptance criteria. It does not cover the recommendation-results page, the
configurator wizard, the catalogue, guide pages or saved builds beyond the seams named
here.

**Non-goals.** No new UI library, no new state library, no backend change, no endpoint
invention, no design-token change, no change to V1 (`apps/web`), no V2 workflow change,
no rework of the approved Figma frames.

## Product decisions confirmed for this homepage

1. **The initial three cards represent three use cases:** one Gaming (`GAMING`), one
   Studies & Office (`OFFICE`), and one Professional & Creation (`WORKSTATION`). These
   are peers, not VALUE / BALANCED / PERFORMANCE tiers. Do not call one "the most
   recommended", "best", or "most popular" and do not compare their scores across use
   cases.
2. **Initial representative budget is 12,000 MAD.** For each use case, select the
   highest preset row from the API's ascending list whose `budget_amount` is less than
   or equal to `12_000`. This keeps the three generic homepage examples aligned with
   the finder's 5,000–15,000 DH choices. The selected row's `budget_amount` remains its
   actual served tier: 12,000 MAD is the selection ceiling, not a claim that the PC costs
   exactly 12,000 MAD. If a use case has no preset at or below this ceiling, preserve its
   card slot and show the no-configuration state; never select a more expensive preset.
3. **Finder selection is budget-aware but not a new recommendation.** While homepage
   POST remains disabled, choose the highest pre-generated preset for the selected use
   case whose `budget_amount` is less than or equal to the visitor's budget. If none
   exists, show an honest no-match state. If the visitor's budget is above the largest
   available tier, show the highest available tier with a clear cap note; do not imply
   that it is tailored to the full budget.
4. **Prices and scores are described literally.** Show price provenance from the API;
   never imply live retailer verification. Label `build_score` as a configuration score,
   not FPS, benchmark, or gaming performance.

---

## 1. Design references

| Frame            | Figma node | Role                                          |
| ---------------- | ---------- | --------------------------------------------- |
| Desktop homepage | `19:3`     | Desktop layout reference (1280 container)     |
| Mobile homepage  | `23:1179`  | **Primary UX reference** (390 designed width) |

Both are one product at two widths, not two pages.

### 1.1 What each frame actually contains

Desktop (`19:3`), in order: announcement banner (`19:5`), hero + finder (`19:23`),
recommended configurations (`19:172`), trust (`19:371`), categories & usages (`19:426`),
guides (`19:495`), final CTA (`19:586`).

Mobile (`23:1179`), in order: header (`23:1465`), hero (`23:1182`), finder
(`23:1193`), recommended configurations (`23:1270`), resolution shortcuts (`23:1344`),
trust (`23:1355`), guides (`23:1392`), final CTA (`23:1427`), footer (`23:1440`), bottom
nav (`23:1489`).

Two structural differences are therefore **by design**, and the responsive strategy in
§2 reconciles them:

1. Mobile has a **resolution-shortcut** row (`23:1344`: Gaming 1080p / Gaming 1440p).
   Desktop has no such row; it has a four-tile **categories & usages** grid (`19:426`)
   that mobile does not show. Step 1 keeps both as responsive variants of one discovery
   pathways component.
2. Mobile shows **2 guides**, mobile's final CTA is a compact card; desktop shows
   **4 guides** in one row and a wide gradient CTA banner.

The eight sections the implementation must ship (per the Step 1 brief) are:

1. Header and navigation — banner (desktop) + sticky header + bottom nav (mobile).
2. Hero and budget/usage finder.
3. Recommended complete PC configurations.
4. Discovery pathways — desktop `Catégories & usages` grid; the mobile Gaming 1080p / 1440p
   resolution shortcuts ship hidden in the first release (Q-20). This is one responsive
   section with two frame-accurate variants.
5. Trust and recommendation methodology.
6. Featured guides.
7. Final CTA.
8. Footer and mobile navigation.

**Numbered order is authoritative where a frame's node order differs.** The frame audits
above are the design reference; the shipped page renders recommended configurations, then
discovery pathways, then trust, following the eight-section sequence in this list, §7 and
the §16.1 acceptance checks. A frame's node order is never edited to match the
implementation — it records what the design file contains.

### 1.2 Fidelity deltas between the frames and the Step 0 token set

The Step 0 foundation is the source of truth for tokens (`app/globals.css`,
`docs/DESIGN_SYSTEM.md`), and this step must not change them. The frames use a few
values that are **near-misses** of the token palette. Map them to the nearest semantic
token; do not add a token, and do not hard-code the Figma hex.

| Frame value                  | Where                    | Token to use                                               | Delta                                        |
| ---------------------------- | ------------------------ | ---------------------------------------------------------- | -------------------------------------------- |
| `#F9F9FF` / `#F5F7FF` canvas | page background          | `bg-background` (`#F8F9FF`)                                | imperceptible                                |
| `#0E1C31` text               | headings                 | `text-foreground` (`#0B1C30`)                              | imperceptible                                |
| `#474553` body               | body copy                | `text-muted` (`#464553`)                                   | imperceptible                                |
| `#3527A4` / `#1D008D`        | CTA fill, "Détails" link | `primary` (`#3730A3`) / `primary-deep` (`#1F108E`)         | imperceptible                                |
| `#FFA51B` CTA fill           | "Trouver mon PC"         | `accent` (`#F59E0B`) with `text-on-accent`                 | **visible**: the frame's saffron is brighter |
| `#FFDDB8` pill               | "Recommandé · Équilibré" | `accent-soft` (`#FEF3C7`) + `accent-ink`                   | small                                        |
| `#E8EEFF` / `#DFE8FF`        | inset tiles, active pill | `surface-sunken` (`#E5EEFF`) / `surface-muted` (`#EFF4FF`) | small                                        |
| 48 px / 800 hero heading     | desktop hero             | `text-display-lg` (40/48/700)                              | **visible**: 40 px, not 48 px                |
| 24 px hero heading           | mobile hero              | `text-display` (30/38/700) or `text-headline-lg` (28)      | see Q-02                                     |

These deltas are **approved by the owner for the first functional release** (Q-01, Q-02).
Retain the existing semantic token system: the existing `accent` and `bg-background`
tokens, and the 40 px `text-display-lg` heading. No new token and no hard-coded visual
exception is introduced without explicit design-owner approval, and this table is the
record of the differences accepted from the approved frames. The authoritative fidelity
target is "the approved frame's layout and hierarchy, rendered with the Step 0 token
set", not a pixel-for-pixel colour clone.

Images: the frames use photographic build shots and guide thumbnails. No image asset is
in the repository. Step 1 renders **token-only placeholders** (the existing
`BuildCardPreview` gradient frame pattern) and must not hot-link Figma images. Real
imagery is a separate content task (Q-03).

---

## 2. Responsive implementation strategy

One page, one component tree, mobile-first, with Tailwind breakpoints. There is **no**
`HomeDesktop` / `HomeMobile` fork.

### 2.1 Breakpoints and container

The kit already fixes the container: `mx-auto w-full max-w-page px-margin-mobile
md:px-margin` (`max-w-page` = 1280 px, `margin-mobile` = 16 px, `margin` = 32 px). The
locale layout owns it; sections do not re-declare horizontal padding.

| Viewport           | Grid                      | Header                | Finder                             | Builds                     | Pathways               | Trust             | Guides         |
| ------------------ | ------------------------- | --------------------- | ---------------------------------- | -------------------------- | ---------------------- | ----------------- | -------------- |
| 360 px             | 1 col, 16 px margins      | 56 px sticky          | stacked, 2×2 presets               | 1 card + 2 compact rows    | 2 tiles, 1 per column  | stacked list card | 2 cards, 1 col |
| 390 px             | same                      | same                  | same                               | same                       | same                   | same              | same           |
| 430 px             | same (wider gutters only) | same                  | same                               | same                       | same                   | same              | same           |
| 768–1023 px (`md`) | 1–2 col                   | 64 px, horizontal nav | presets in one row of 4            | 2 col, third spans         | 2 tiles inline         | 3 col             | 2 col          |
| 1280 px (`lg`+)    | 12-col, 40 px gap         | 64 px, horizontal nav | 2 answers side by side in the card | 3 equal cards, fixed order | 4-tile categories grid | 3 col             | 4 col          |

Tailwind's stock breakpoints (`sm` 640, `md` 768, `lg` 1024, `xl` 1280) are enough. No
custom breakpoint token is added.

### 2.2 Shared components vs genuine variants

Shared, identical at every width (only spacing/columns change):

- `Button`, `Badge`, `Card`, `TextField` (existing kit).
- `HomepageHero` — same markup; the desktop-only featured-rig preview is a `lg:block`
  slot inside it.
- `BudgetPresetGrid` — 2×2 on mobile, one row of 4 from `sm`.
- `UsageSelector` — stacked cards on mobile, unchanged on desktop (the desktop frame
  stacks them too).
- `RecommendedBuildSection`, `FeaturedBuildCard`, `CompactBuildRow`,
  `TrustHighlights`, `FeaturedGuides`, `FinalRecommendationCTA`, `DiscoveryPathways`.

Genuinely different presentation (one component, two variants driven by a prop, never
two files):

| Component                 | Variant                       | Difference                                                                                                                                                |
| ------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FeaturedBuildCard`       | `featured` (mobile + desktop) | identical structure; the desktop 2 px primary ring is decorative only; no "Le plus recommandé" badge, because the three use cases are peers               |
| `RecommendedBuildSection` | —                             | grid switches from "1 card + 2 compact rows" to "3 equal cards in fixed use-case order"; the **same** three items drive both, the layout prop is CSS only |
| `FeaturedGuides`          | —                             | renders 4 items; items 3–4 are `max-lg:hidden` (2 on mobile, 4 on desktop). Content stays in the DOM for one code path                                    |
| `FinalRecommendationCTA`  | —                             | desktop gradient banner with a large button; mobile compact primary-variant card with a 48 px button. Same copy, same action                              |
| `DiscoveryPathways`       | —                             | desktop shows the four-tile categories grid; mobile resolution shortcuts deferred (Q-20)                                                                  |

**Discovery pathways (responsive variants).** Keep the desktop frame's `Catégories &
usages` grid (`19:426`) and the mobile frame's Gaming 1080p / 1440p shortcuts
(`23:1344`). They are two presentations of one `DiscoveryPathways` component, not two
page implementations. Desktop tiles preselect their mapped finder use case; the mobile
resolution tiles ship hidden in the first release (Q-20) and, once enabled, set Gaming
plus a resolution only when `resolution` appears in `inputs_applied`. Neither variant
submits a recommendation. This resolves Q-04 in favour of preserving the approved
desktop frame.

### 2.3 Layout rules

- Sections are `<section aria-labelledby="…">` with `scroll-mt-24` (the sticky header's
  `scroll-padding-top` is already set in `globals.css`).
- Vertical rhythm: `gap-12` between sections on mobile, `lg:gap-16` (matches the Step 0
  page rhythm).
- All direction-sensitive utilities are logical: `ms/me`, `ps/pe`, `start/end`,
  `text-start`, `border-s`. Arrow icons that imply direction use `rtl:-scale-x-100`.
- No horizontal scroll anywhere at 360 px; tiles and pill rows wrap or scroll in their
  own `overflow-x-auto` container (the finder's preset row and the filter chips), never
  the page.

---

## 3. Section 1 — Header and navigation

**Purpose.** Establish brand, language and the three destinations a visitor needs before
they scroll: configure, browse guides, saved builds. On mobile it also carries the
persistent finder entry point.

**Desktop composition.** Announcement banner (full-bleed, `bg-surface-muted`, 10 px 32 px
padding): an 8 px accent dot and one neutral label in `text-label-md` (`banner.label`),
then, on the end side, the Arabic availability chip (`bg-surface-sunken`, `text-primary`,
`banner.arabicBadge`) rendered only when the Arabic experience is live. Below it, the
existing `SiteHeader` (64 px, sticky,
`bg-background/90` + blur): brand mark + wordmark, primary nav anchors (`lg` only),
locale switcher.

**Mobile composition.** The existing 56 px `SiteHeader`: 32 px brand tile + "MoroccoPC",
then the locale switcher (FR · العربية as two links). The Figma header also shows a
saved-builds icon with a count badge and an unidentified circular trailing icon; Step 1
renders neither (no saved-builds route exists and no count source exists) — Q-05.

**Components.** `SiteHeader` (exists), `LocaleSwitcher` (exists), `Logo` (exists), new
`AnnouncementBanner`, new `PrimaryNav` (anchors only), `MobileNav` (exists).

**Content keys** (`Homepage` namespace unless stated).

| Key                                                    | French source (from frame)                  |
| ------------------------------------------------------ | ------------------------------------------- |
| `Shell.nav.home` / `.configure` / `.guides` / `.saved` | Accueil / Configurer / Guides / Enregistrés |
| `Shell.mobileNav`                                      | Navigation mobile                           |
| `Shell.primaryNav`                                     | Navigation principale                       |
| `banner.label`                                         | Configurations PC pour le Maroc             |
| `banner.arabicBadge`                                   | متوفر باللغة العربية                        |

**Banner copy (Q-17, approved).** The monthly-verification sentence (`banner.updateText`)
and the live-index pill (`banner.currencyIndex`) are removed by owner decision and must
not exist in `fr.json` or `ar.json`: no source backs a verification cadence or a real-time
MAD index. What remains is neutral and truthful — the `banner.label` text and, only when
the Arabic experience is live, `banner.arabicBadge`. No update date is displayed because
no verified freshness timestamp exists for this banner.

**Interactions.** Nav anchors scroll to `#configurations`, `#guides`, `#confiance`.
Locale switch preserves the page (already implemented by `LocaleSwitcher`). `aria-current`
on the active anchor; the mobile nav marks "Accueil" current.

**Responsive behaviour.** Banner `hidden md:flex`. Primary nav `hidden lg:flex`. Bottom
nav `lg:hidden` (exists). Sticky header stays 56 px mobile / 64 px desktop; content
scrolls under it (`scroll-mt-24`).

**States.** No loading or error states: nothing here fetches. If the locale switch is
mid-navigation, links remain enabled (next-intl prefetch handles it).

**Accessibility.** One `<header>`; nav landmarks each have a distinct `aria-label`
(`primaryNav`, `language`, `mobileNav`). Skip link already precedes the header. The
banner is a `<div role="note">`, not a live region (it is static). Language links use
`hrefLang` and `aria-label` ("Afficher en العربية"). Touch targets ≥ 44 px; the 56 px
header keeps them inside `h-11` links. Icon-only controls are forbidden in Step 1 except
the existing locale pill.

---

## 4. Section 2 — Hero and budget/usage finder

**Purpose.** State the promise in one sentence and capture the two inputs the engine
needs (`budget_amount`, `use_case`) with as little friction as possible. This is the only
interactive block above the fold.

**Desktop composition.** 12-column grid, two 6-column halves, 40 px gap, 64 px vertical
padding:

- **Start column** (hero copy): pill "Configurateur PC pour le Maroc"; H1 in two
  lines — "Le bon PC," then "au **bon budget**." with the second phrase in the primary
  gradient (`bg-linear-to-r from-primary-deep to-primary` + `bg-clip-text`); intro
  paragraph; three trust chips ("1 minute chrono", "100 % Gratuit", "Sans inscription
  requise"); the featured rig preview card (176 px media, "Vue Référence" overlay,
  eyebrow "SÉLECTION DU MOMENT", "Aperçu de configuration" pill, title, one-line rationale,
  price + "Détails specs →").
- **End column** (finder card, `rounded-sheet` 24 px, `shadow-level-2`): header row
  ("Simulateur Express" + dot, "Étape 1 sur 2" pill), question 1 (budget), question 2
  (usage), the saffron CTA, microcopy.

**Mobile composition.** Concise hero: eyebrow pill "Guide & Configurateur Maroc", H1
"Le bon PC, au bon budget." (single line-break control), two-line intro. No preview
card. The finder is a `rounded-card` sheet with 16 px padding: numbered stepper "1" +
"Quel est votre budget ?", right-aligned "À définir" until a choice exists, 2×2 preset
grid, "Autre budget personnalisé" disclosure, numbered "2" + usage question, three slim
usage cards, 48 px CTA, microcopy "Gratuit · Sans compte · Environ 1 minute".

**Components.** `HomepageHero` (new, server), `HeroTrustChips` (new, server),
`HeroRigPreview` (new, server; reuses `Badge`, `Card`), `BudgetUsageFinder` (new,
client island), `BudgetPresetGrid`, `CustomBudgetField`, `UsageSelector`,
`FinderCta`. Price rendering wherever an amount appears: `formatPrice(value, currency)`,
with `currency` taken from the rendered detail when one exists and from `meta/options`
otherwise.

**Content keys.**

| Key                                     | French source                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hero.eyebrow`                          | Configurateur PC pour le Maroc                                                                                                                                     |
| `hero.titleLead`                        | Le bon PC,                                                                                                                                                         |
| `hero.titleAccent`                      | au bon budget.                                                                                                                                                     |
| `hero.intro`                            | Gaming, études ou travail : trouvez une configuration selon votre budget et votre usage. Les prix affichés sont indicatifs et exprimés en dirhams marocains (MAD). |
| `hero.chip.time`                        | 1 minute chrono                                                                                                                                                    |
| `hero.chip.free`                        | 100 % Gratuit                                                                                                                                                      |
| `hero.chip.noAccount`                   | Sans inscription requise                                                                                                                                           |
| `hero.preview.eyebrow`                  | Sélection du moment                                                                                                                                                |
| `hero.preview.score`                    | Score de configuration : {score}/100                                                                                                                               |
| `hero.preview.caption`                  | Vue Référence                                                                                                                                                      |
| `hero.preview.details`                  | Détails specs →                                                                                                                                                    |
| `finder.badge`                          | Simulateur Express                                                                                                                                                 |
| `finder.step`                           | Étape {current} sur {total}                                                                                                                                        |
| `finder.budget.question`                | Quel est votre budget ?                                                                                                                                            |
| `finder.budget.hint`                    | Marché marocain (MAD)                                                                                                                                              |
| `finder.budget.unset`                   | À définir                                                                                                                                                          |
| `finder.budget.presetLabel`             | Budget de {amount}                                                                                                                                                 |
| `finder.budget.customToggle`            | Autre budget personnalisé                                                                                                                                          |
| `finder.budget.customLabel`             | Budget exact en dirhams                                                                                                                                            |
| `finder.budget.customHint`              | Entre {min} et {max} DH                                                                                                                                            |
| `finder.usage.question`                 | Que voulez-vous faire avec votre PC ?                                                                                                                              |
| `finder.usage.gaming.title` / `.body`   | Jeux vidéo & Gaming / Fortnite, Valorant, GTA V, EA FC 24, Cyberpunk 2077…                                                                                         |
| `finder.usage.office.title` / `.body`   | Études et bureautique / Cours, navigation 40+ onglets, Office, visioconférences HD                                                                                 |
| `finder.usage.creation.title` / `.body` | Création et travail pro / Montage 4K Premiere / DaVinci, Blender 3D, code et virtualisation                                                                        |
| `finder.cta`                            | Trouver mon PC                                                                                                                                                     |
| `finder.ctaPending`                     | Recherche en cours…                                                                                                                                                |
| `finder.note`                           | 1 minute · 100 % Gratuit · Sans compte · Prix actualisés en DH                                                                                                     |
| `finder.error.required`                 | Choisissez un budget et un usage pour continuer.                                                                                                                   |
| `finder.error.budgetRange`              | Saisissez un budget entre {min} et {max} DH.                                                                                                                       |
| `finder.error.submit`                   | La recherche a échoué. Réessayez.                                                                                                                                  |
| `finder.error.rateLimited`              | Trop de recherches. Réessayez dans {seconds} s.                                                                                                                    |

**Interactions.** See §5 for the finder as a unit. Hero has no interaction except the
preview card's "Détails specs" link, which is disabled in Step 1 (no product page yet —
Q-06) and rendered as text, not a dead link.

**Responsive behaviour.** Hero copy is always start-aligned. The desktop preview card is
`hidden lg:block` inside `HomepageHero`; nothing else changes. H1 uses
`text-display lg:text-display-lg`, `max-w-3xl`, `text-balance`.

**States.** The finder's own states are specified in §5. The hero's preview card: when
no preset data is available it renders the text-only shell (no price, no score) instead
of fake numbers; while loading it renders a skeleton of the same height (no layout
shift).

**Accessibility.** Exactly one `<h1>` on the page (the hero). The finder is a `<form>`
with `noValidate`; each question is a `<fieldset>` with a `<legend>` (the question), so
the visible numbered markers are decorative (`aria-hidden`). Preset amounts and usage
cards are native radios, not `aria-pressed` buttons, so screen readers announce "2 of 4"
and arrow keys work. The selected state is never colour-only: selected chips get a
`ring-2 ring-primary` plus a check icon. Validation errors render in a `role="alert"`
region and are referenced by `aria-describedby` on the group. The CTA reports
`aria-busy` while pending and stays focusable. Contrast: saffron CTA text is
`text-on-accent` (existing token), never white on `#F59E0B`.

---

## 5. Budget and usage finder (detail)

### 5.1 Four budget presets

`5 000`, `8 000`, `12 000`, `15 000` DH — the same four the Step 0 `lib/demo/store.ts`
already declares (`BUDGET_OPTIONS`). The mobile frame renders the last one as "15 000
DH+" — the label is `foreground`/`15 000 DH` visually, but the value submitted is
exactly `15000`; the "+" is copy, never a range query. The store constant is reused (not
copied) and the homepage store is a **new** module (§6.3); `lib/demo/store.ts` is left untouched for the preview page until that page is deleted. A preset button is a **budget**, not a promise of a card: section 3 renders the ladder row at or below it (§6), so choosing 5 000 DH against a 6 000 DH cheapest preset produces the no-match state, never a substituted card.

### 5.2 Custom budget

Revealed by the "Autre budget personnalisé" disclosure (mobile) or always visible as the
desktop slider block. Step 1 ships the **input** on both widths and the slider only from
`lg` (the desktop frame's range control); the slider and the numeric field share one
value.

Validation (Zod, `lib/homepage/finder-schema.ts`):

| Rule     | Value                                | Rationale                                                                                   |
| -------- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| Type     | integer, JSON **number** on the wire | the API rejects numeric strings (contract v1.10)                                            |
| Min      | `3 500` DH                           | the frame's range starts at 3 500 DH; below it no configuration assembles                   |
| Max      | `100 000` DH                         | sanity bound for a consumer build; the API allows 1 000 000 but the slider stops at 15 000+ |
| Step     | `500` DH                             | matches the API's documented client snapping and makes dedupe hits likely                   |
| Messages | dictionary-supplied                  | `finder.error.budgetRange` with `{min}`/`{max}`                                             |

Defaults: **nothing is selected on first visit** (explicit requirement). The budget group
has no checked radio, the custom field is empty, the usage group has no checked radio,
and the CTA is disabled with `aria-disabled="true"` until both answers are present. A
disabled CTA must not be the only feedback: the group status line reads "À définir" until
then.

### 5.3 Three usage options

| UI option               | API `use_case` | Frame copy                                                        |
| ----------------------- | -------------- | ----------------------------------------------------------------- |
| Jeux vidéo & Gaming     | `GAMING`       | Fortnite, Valorant, GTA V, EA FC 24, Cyberpunk 2077…              |
| Études et bureautique   | `OFFICE`       | Cours, navigation 40+ onglets, Office, visioconférences HD        |
| Création et travail pro | `WORKSTATION`  | Montage 4K Premiere / DaVinci, Blender 3D, code et virtualisation |

The three values are the active scoring model's vocabulary (`launch-v2` seeds
`GAMING`, `WORKSTATION`, `OFFICE`) and are fetched at runtime from
`GET /v1/meta/options`; the mapping above is the **fallback** used when that call fails,
because the finder must never render without options. The label of each option comes
from the dictionary, not from the API's French labels, so the UI keeps its own voice and
Arabic has a translation; the API value is used as the key.

### 5.4 Resolution choice and performance shortcuts

The finder does **not** ask for resolution: the engine treats it as optional and the API
reports whether the model even accepts it (`inputs_applied`). Resolution can enter the
journey only through a shortcut tile that pre-sets `resolution` and `use_case=GAMING` and
moves focus to the finder.

**First functional release: the shortcuts are hidden.** `GET /v1/presets` cannot filter by
resolution, and the recommendation `POST` stays disabled until the Step 2 results route
exists (Q-08). A tile a visitor can press but whose resolution reaches no served card is
worse than no tile, so the 1080p / 1440p row is not rendered in either variant and no
`resolution` is stored for it (Q-20). The frames' shortcut row is the target for the
future state, not a Step 1 deliverable.

- Mobile: the two-tile row ("Gaming 1080p", "Gaming 1440p") is deferred with the rest of
  the shortcut surface. The frame's "Dès 5 500 DH" / "Dès 11 000 DH" prices were never
  renderable (`GET /v1/presets` has no resolution parameter — Q-07), so hiding the row
  loses no served price.
- Desktop: the four-tile `Catégories & usages` grid (§7) offers the three use cases, which
  is the only discovery affordance the first release ships.
- **Future enhancement.** Enable both variants once the results route consumes
  `resolution` and the API can answer a resolution-scoped card; keep the `inputs_applied`
  gate, set `resolution` in the finder store, mark the tile `aria-pressed="true"`, and
  still never submit from a tile.

### 5.5 Main recommendation CTA

Submit is a TanStack Query **mutation** (`retry: false`, per the established policy —
a POST runs and persists an engine pass).

- **Payload:** `{ budget_amount, currency, use_case, resolution? }`. `currency` is `MAD`,
  confirmed as an advertised value by `GET /v1/meta/options`; it is never read from a
  recommendation detail, because the first submit has none. `priority` is not sent (the
  API's default order).
- **Pending:** button shows `finder.ctaPending`, `aria-busy="true"`, spinner replaces the
  arrow; the rest of the form is `pointer-events-none` but keeps its values.
- **Success:** `router.push` to `/[locale]/resultats/{id}` (Step 2 route). The response
  is **not** rendered on the homepage.
- **Error:** the form stays filled; an inline `role="alert"` block shows
  `finder.error.submit`, plus a "Réessayer" button that re-submits the same values.
  A `429` uses `ApiError.retryAfterSeconds` for `finder.error.rateLimited` and disables
  submit for that countdown. A `503` (no active model) reads as a service error, not a
  validation error, and offers retry. A `422` is a bug in our form: log it and show the
  generic error.
- **Double submit:** the mutation is guarded by `isPending` and the button is disabled
  while pending; identical requests are deduped server-side (`reused: true`), which is the
  second line of defence.

**Seam to the recommendation journey.** The finder writes
`{ budgetAmount, useCase, resolution }` into the homepage store, and since Step 3.3 its CTA
hands the two answers to `/{locale}/configurateur` as query params — `use_case` and
`budget` — through `buildConfiguratorHref` and next-intl's locale-aware `router.push`. It
posts nothing: no `POST /v1/recommendations` is issued from the homepage, so no orphan
engine pass can be created. The URL is the only carrier, and the configurator parses it
back with the one module that also builds it, so a link cannot disagree with the route's
own contract. **Q-08's scroll fallback is superseded** by this navigation: the CTA no
longer scrolls to `#configurations`. The POST and a results route remain the future step,
still behind `NEXT_PUBLIC_HOMEPAGE_SUBMIT` (default **off**), which now gates only that
future write.

---

## 6. Section 3 — Recommended complete PC configurations

**Purpose.** Show one real, complete example for each supported use case so a first-time
visitor can understand the breadth of Morocco-PC before using the finder.

**Initial card decision (confirmed).** The three initial cards are:

1. Gaming — API value `GAMING`.
2. Studies & Office — API value `OFFICE`.
3. Professional & Creation — API value `WORKSTATION`.

These are three use-case examples, not VALUE / BALANCED / PERFORMANCE strategy tiers.
The cards are peers. Do not call one "the most recommended", "best", or "most popular"
and do not compare their `build_score` values across different use cases.

**Data source.** `GET /v1/presets?use_case=…&currency=MAD` (read-only, one request per
use case confirmed by `meta/options`) plus `GET /v1/recommendations/{recommendation_id}`
for the three initially selected preset IDs. A later selection reads its own detail (§6,
**Dynamic detail reads**). Full mapping is in §13 and
`01-homepage-api-mapping.md`.

**Deterministic initial selection (owner decision: 12,000 MAD).** The presets endpoint
returns rows ordered by `budget_amount` ascending. For each use case, select the
highest row whose `budget_amount <= 12_000`. In implementation terms, filter the
ascending list to rows at or below 12,000 and select the final row in that filtered list.
Do not select the median of the entire ladder and do not fall back to a row above 12,000.
This keeps the generic homepage examples relevant to the finder's 5,000 / 8,000 / 12,000 /
15,000 DH choices. The selected preset's actual `budget_amount` is the displayed tier;
it may be below 12,000 and must not be labelled as an exact 12,000 DH build. Keep a
stable display order: GAMING, OFFICE, WORKSTATION (titled PC Gaming / PC Bureautique /
PC Création & Professionnel on the cards). Do not sort use
cases by score, price, API response order, or strategy. Request detail only for the
selected `recommendation_id` in each use-case slot. If a use case has no preset at or
below 12,000, preserve its slot and show the no-configuration state.

If one use case returns no presets or its selected detail cannot be loaded, preserve that
use-case card slot and show its own empty/unavailable state. Do not silently substitute a
second Gaming preset or another use case. If the selected detail has no builds, show no
complete configuration for that slot; never render a `budget_floor` value as a build
price or as proof that a compatible build exists.

**Dynamic detail reads.** The three detail requests on first paint are the initial
fan-out, not a lifetime limit. When the finder selects a different preset the section
reads that preset's detail: a cached entry for the same `recommendation_id` and
`catalog_version` is reused, and otherwise exactly one `GET /v1/recommendations/{id}` is
issued. The query key is `["recommendation", recommendationId, catalogVersion]`, so a
catalog bump cannot answer with a detail whose prices were invalidated. While it loads,
the card keeps its slot and shows no components, score or price badge; a 404 renders the
card without detail and logs; `builds: []` shows no complete-PC claim; a request error
degrades that card only, with retry. The previous selection's components are cleared as
soon as the selection changes — stale specifications from another preset are never
displayed.

**Desktop composition.** Eyebrow "CONFIGURATIONS PRÊTES À MONTER", H2 "Trois usages,
trois configurations", one-line intro, then three cards in fixed use-case order. Each
card's H3 is the **localized use-case label**, the approved card title (Q-16):
`builds.category.gaming` = "PC Gaming", `.office` = "PC Bureautique", `.workstation` =
"PC Création & Professionnel". No configuration name is invented, because neither the
preset nor the build carries one. Under the H3, a `builds.budgetLabel`
line showing the served `budget_amount`, a price-status badge, a 192 px token-only media
placeholder, up to four spec pills, an optional rationale, the served total price and a
compact details action. The budget line always renders from the preset; the price renders
only when `total_price` is non-null, so a null price never turns the budget into a price.
The price badge comes from that build's `builds[0].price_status`; with no complete build
there is no badge, and a `null` status is never rendered as "indicatif".
Use equal visual weight across all three cards. The Figma centre-card ring may be
retained as decoration only; it must not be paired with "Le plus recommandé" or any
claim that ranks OFFICE above the other use cases.

**Mobile composition.** The same three cards in the same order — PC Gaming, PC Bureautique,
PC Création & Professionnel (the approved `builds.category.*` titles, Q-16). Render PC
Gaming first, followed by the other two as compact
cards if required by the approved mobile frame. A compact/featured layout is a responsive
density choice only; it must not imply that Gaming is objectively more recommended.

**Components.** `RecommendedBuildSection` (client island, owns preset queries and
budget-aware selection), `FeaturedBuildCard`, `CompactBuildRow`, `SpecPill`,
`PriceStatusBadge` (wraps `Badge`), `BuildMediaPlaceholder`. Filter tabs are not
needed for the initial state: the three use cases are shown simultaneously. After finder
selection, the section shows the matching selected-use-case preset, not an arbitrary
cross-use-case ranking.

**Content keys.**

| Key                           | French source                                                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `builds.eyebrow`              | Configurations prêtes à monter                                                                                               |
| `builds.title`                | Trois usages, trois configurations                                                                                           |
| `builds.intro`                | Découvrez un exemple de configuration pour le jeu, les études et le travail.                                                 |
| `builds.category.gaming`      | PC Gaming                                                                                                                    |
| `builds.category.office`      | PC Bureautique                                                                                                               |
| `builds.category.workstation` | PC Création & Professionnel                                                                                                  |
| `builds.badge.verified`       | Prix vérifié                                                                                                                 |
| `builds.badge.indicative`     | Prix indicatif                                                                                                               |
| `builds.priceLabel`           | Prix de la configuration                                                                                                     |
| `builds.budgetLabel`          | Budget visé                                                                                                                  |
| `builds.scoreLabel`           | Score de configuration                                                                                                       |
| `builds.scoreHelp`            | Score calculé à partir des évaluations des composants et des inconnues de compatibilité. Ce n'est ni un FPS ni un benchmark. |
| `builds.cta`                  | Voir la configuration                                                                                                        |
| `builds.empty.title`          | Aucune configuration disponible pour cet usage                                                                               |
| `builds.empty.body`           | Aucune configuration complète n'est disponible dans les budgets pré-générés pour le moment.                                  |
| `builds.error.title`          | Les configurations n'ont pas pu être chargées                                                                                |
| `builds.error.body`           | Vérifiez votre connexion, puis réessayez.                                                                                    |
| `builds.error.retry`          | Réessayer                                                                                                                    |
| `builds.loading`              | Chargement des configurations…                                                                                               |
| `builds.budgetCap`            | Configuration pré-générée la plus élevée disponible : {amount}                                                               |

**Interactions.** On first visit, render one generic preset per use case using the 12,000 MAD ceiling: the highest preset whose `budget_amount` is at or below 12,000. Never use a higher preset for the generic state. The finder
selection narrows the display to the selected use case and chooses the greatest preset
budget that does not exceed the visitor's chosen budget. The chosen preset may be below
the requested budget; label it by its actual served preset budget. If the requested budget
exceeds the largest available preset, show `builds.budgetCap` and do not imply the PC is
tailored to the full amount. If no preset budget is less than or equal to the visitor's
budget, show `builds.empty.*`. No filter change or scroll action makes an API write. In
Step 1, the card details action is non-navigating until the Step 2 result route is
available; never link to a missing route.

**Responsive behaviour.** Desktop: three equal columns from `lg`; `md`: two columns
with the third spanning as needed; mobile: one card followed by two compact cards. The
featured treatment is visual only and does not imply ranking. Media height 144 px mobile /
192 px desktop.

**States.**

| State                              | Rendering                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Loading                            | Three skeletons matching the three use-case slots; `aria-busy="true"` and `builds.loading` in a polite live region |
| Detail pending (selection changed) | Keep the slot; clear the previous preset's pills, score and price badge until the new detail arrives               |
| Detail missing (404)               | Render the card without pills or price badge and log the 404; never fall back to another preset's detail           |
| Empty use case                     | Keep that category's slot and show `builds.empty.*`; do not substitute another use case                            |
| No preset within visitor budget    | Show `builds.empty.*`; never show a more expensive preset as suitable                                              |
| Budget above highest served tier   | Show the highest available tier plus `builds.budgetCap`; do not describe it as an exact-budget result              |
| Detail with no build               | Do not render a complete-PC claim or a price; never present `budget_floor.cheapest_total` as an assembled build    |
| Indicative price                   | Badge comes from the rendered build's `price_status`; show the API disclaimer and do not imply a retailer quote    |
| Error (5xx/timeout/offline)        | `builds.error.*` block with retry; the rest of the page stays usable                                               |

**Accessibility.** The three categories have explicit accessible names. Card order is fixed
and does not change after hydration. Cards are `<article>` with `aria-labelledby`
pointing at the H3. Price text carries an `aria-label` with the full formatted amount.
Status badges' text comes from the dictionary, never from the API's English enum. The
featured visual treatment is decorative and has no "recommended" accessible label. No
auto-rotating carousel.

## 7. Section 4 — Discovery pathways

**Purpose.** Preserve each approved frame's discovery affordance without building two
homepage implementations.

**Desktop composition.** Render the approved four-tile `Catégories & usages` grid
(`19:426`) after the recommended configurations and before the trust section, with
actions that preselect the corresponding finder use case. Keep the Figma tile hierarchy
and visual treatment. Use only product-supported use cases mapped in the Homepage
dictionaries; a resolution tile is a discovery shortcut, not a new API use case.

**Mobile composition.** The frame's two Gaming resolution shortcuts (`23:1344`: Gaming
1080p, Gaming 1440p) are **not rendered in the first functional release** (Q-20, §5.4):
the presets endpoint cannot filter by resolution and the `POST` is gated until Step 2, so
the choice would reach no served card. **No simulated resolution filtering is
implemented** (Q-20, approved): the tiles are hidden rather than wired to a client-side
approximation the served cards would ignore. When they are enabled, each tile sets
`use_case=GAMING` plus its resolution and moves focus to the finder.

**Components.** One `DiscoveryPathways` client component with desktop-category and
mobile-resolution variants. It is one responsive component tree, not a desktop page and
a mobile page.

**Content keys.**

| Key                    | French source                    |
| ---------------------- | -------------------------------- |
| `pathways.eyebrow`     | Catégories & usages              |
| `pathways.gaming`      | Gaming                           |
| `pathways.office`      | Études & bureautique             |
| `pathways.workstation` | Création & travail professionnel |
| `pathways.gaming1080`  | Gaming 1080p                     |
| `pathways.gaming1440`  | Gaming 1440p                     |

`pathways.gaming1080` and `pathways.gaming1440` are authored with the deferred tiles
(Q-20); the first release renders neither key.

**Interactions.** Desktop tiles set their mapped use case in the finder and focus its
usage group. No pathway makes a network write. The mobile resolution tiles ship hidden
(Q-20); when enabled they set Gaming plus the selected resolution, focus the finder, and
stay hidden unless `inputs_applied` includes `resolution` — an advertised resolution value
alone does not prove the active model reads it.

**Responsive behaviour.** Desktop category grid is shown from `lg`. The mobile resolution
tiles are deferred in the first release (Q-20); once enabled they are shown below `lg`.
Use responsive placement to match the two approved frame sequences while retaining one
component and one state owner. Verify keyboard and screen-reader reading order at both
breakpoints.

**States.** Static. The mobile resolution tiles are absent in the first release (Q-20);
once enabled they are also hidden when the active model does not read resolution or
authoritative metadata is unavailable.

**Accessibility.** Every tile is a labelled button with a 44 px minimum target and a
visible focus ring. Selected shortcuts expose `aria-pressed`. Hidden variants are absent
from the accessibility tree.

## 8. Section 5 — Trust and recommendation methodology

**Purpose.** Answer "why should I believe these numbers?" without a sales claim: no
hardware is sold, prices are in dirhams, and recommendations are free.

**Desktop composition.** Centred eyebrow "TRANSPARENCE & RIGUEUR", H2 "Pourquoi faire
confiance à Morocco-PC ?", centred two-line intro ("Nous ne vendons aucun composant en
direct…"), then three white cards in a row (icon tile, H3, body, a divider-separated
foot note), then a centred link "Comment fonctionnent nos recommandations et algorithmes
d'analyse ?".

**Mobile composition.** Same H2 (breaking after "Morocco-"), no eyebrow, no intro, then
**one** bordered card containing three rows separated by hairlines (icon, H3, body), then
the methodology link start-aligned.

**Components.** `TrustHighlights` (server), `TrustPillar` (server, `variant="card" |
"row"`), `MethodologyLink`.

**Content keys.**

| Key                                 | French source                                                                                                                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trust.eyebrow`                     | Transparence & rigueur                                                                                                                                                                         |
| `trust.title`                       | Pourquoi faire confiance à Morocco-PC ?                                                                                                                                                        |
| `trust.intro`                       | Nous ne vendons aucun composant en direct. Notre seul objectif est de vous éviter les erreurs d'achat et les dépenses superflues.                                                              |
| `trust.pillars.compatibility.title` | Compatibilité analysée                                                                                                                                                                         |
| `trust.pillars.compatibility.body`  | Les composants sont contrôlés selon les caractéristiques et les règles de compatibilité disponibles (socket, mémoire, dimensions et alimentation). Certaines données peuvent rester inconnues. |
| `trust.pillars.compatibility.foot`  | Les statuts reflètent les contrôles réellement effectués                                                                                                                                       |
| `trust.pillars.prices.title`        | Prix indicatifs en dirhams (MAD / DH)                                                                                                                                                          |
| `trust.pillars.prices.body`         | Les montants proviennent des offres enregistrées et leur provenance est indiquée. Ils peuvent différer des prix actuellement pratiqués en boutique.                                            |
| `trust.pillars.prices.foot`         | Prix non actualisés en temps réel                                                                                                                                                              |
| `trust.pillars.free.title`          | 100 % Gratuit & sans compte                                                                                                                                                                    |
| `trust.pillars.free.body`           | Obtenez vos recommandations en toute liberté, sans avoir besoin de créer un compte ni laisser de coordonnées personnelles ou numéro de téléphone.                                              |
| `trust.pillars.free.foot`           | Libre accès immédiat                                                                                                                                                                           |
| `trust.methodologyLink`             | Comment fonctionnent nos recommandations ?                                                                                                                                                     |

Copy caution: the pillar copy now describes only what the API returns (`price_status`, `compatibility_status`) and claims neither a refresh cadence nor a complete compatibility verdict. Do not reintroduce "actualisation hebdomadaire", "vérification TDP" or a live-figure sentence without a data source behind it (Q-09).

**Interactions.** The methodology link is a real link only when the page exists; Step 1
renders it as a link to `#confiance` (self-anchor) with `aria-disabled="true"` and muted
styling, never to a 404 (Q-10).

**Responsive behaviour.** 1 column (`< md`) with the card variant; 3 columns (`lg`). The
intro is hidden below `md`. Icon tiles are 56 px (`accent-soft`, `primary-soft`,
`verified-soft` per pillar) and decorative (`aria-hidden`).

**States.** Static; no loading or error. The section is server-rendered so it is present
with JavaScript disabled.

**Accessibility.** Section heading is the `<h2>`; each pillar is an `<h3>`. The 56 px icon
tile is decorative; the heading carries the meaning. Hairline separators are
`border-t border-border`, not images. Body text uses `text-body-md text-muted` (4.5:1 on
white).

---

## 9. Section 6 — Featured guides

**Purpose.** Offer editorial proof and capture long-tail search intent; establishes the
guides surface that later steps fill.

**Desktop composition.** Eyebrow "CONSEILS PRATIQUES", H2 "Bien choisir son PC au Maroc",
intro "Nos guides d'achat indépendants…", and an end-aligned link "Tous les guides
d'achat (14)". Then four article cards in a row: 160 px media, a category pill + "·" +
reading time row, H3 (two lines), and a "Lire le guide" row with an arrow.

**Mobile composition.** H2 only (no eyebrow, no intro), then **two** article cards: 64 px
square thumbnail end-side or start-side per the frame, reading-time row, H3, then a
centred "Tous les guides d'achat (14)" link.

**Components.** `FeaturedGuides` (server), `GuideCard` (server; `layout` prop `"grid" |
"row"`), `GuideMediaPlaceholder`.

**Data.** There is **no guides endpoint** in the contract and no guides content in the
repository. Step 1 ships a static, typed content module
(`lib/homepage/guides.ts`) with exactly four entries matching the frame:

| Slug (future route)                  | Category        | Reading time | Title                                                      |
| ------------------------------------ | --------------- | ------------ | ---------------------------------------------------------- |
| `quel-budget-pc-gamer-maroc`         | Guide pratique  | 4 min        | Quel budget pour un PC gamer au Maroc ?                    |
| `choisir-carte-graphique-nvidia-amd` | Comparatif      | 6 min        | Bien choisir sa carte graphique : Nvidia RTX vs AMD Radeon |
| `combien-de-ram-16-ou-32-go`         | Conseils        | 3 min        | Combien de RAM faut-il vraiment : 16 Go ou 32 Go ?         |
| `pc-fixe-vs-pc-portable-maroc`       | Dossier spécial | 5 min        | PC fixe vs PC portable au Maroc : le vrai comparatif       |

The titles live in the dictionary (not in the module) so Arabic is translatable; the
module holds only slug, category key and minutes. The "(14)" count and the guide bodies
belong to Step 4; Step 1 does not invent thirteen more guides and does not render a count
(Q-11) — the link copy is `guides.all` without `{count}` when the count is unknown.

**Content keys.**

| Key                                                                    | French source                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `guides.eyebrow`                                                       | Conseils pratiques                                                             |
| `guides.title`                                                         | Bien choisir son PC au Maroc                                                   |
| `guides.intro`                                                         | Nos guides d'achat indépendants pour comprendre le matériel avant de dépenser. |
| `guides.all`                                                           | Tous les guides d'achat                                                        |
| `guides.readingTime`                                                   | {minutes} min de lecture                                                       |
| `guides.cta`                                                           | Lire le guide                                                                  |
| `guides.categories.practical` / `.comparison` / `.advice` / `.special` | Guide pratique / Comparatif / Conseils / Dossier spécial                       |
| `guides.items.budget.title` … `guides.items.portable.title`            | four titles above                                                              |

**Interactions.** Cards are links to `/[locale]/guides/{slug}`. Until Step 4 ships that
route, `NEXT_PUBLIC_GUIDES_ENABLED=off` (default in Step 1) renders the card as an
`<article>` with `data-disabled="true"` and no `href` (Q-12). The attribute is a data
hook, not ARIA: `aria-disabled` is only supported on widget roles and `article` is not one,
so it announced nothing and tripped `jsx-a11y/role-supports-aria-props`. The card contains
no interactive element for it to disable.

**Responsive behaviour.** Mobile: 2 items, one column; `md`: 2 columns, 4 items; `lg`: 4
columns. Items 3–4 are visually hidden below `md` with `max-md:hidden`, so one data array
drives both and there is no duplicated markup. Card media is a token gradient with a
`BookOpen` mark (no photography available).

**States.** Static content: no loading state. If the module is empty (impossible by
construction) the section is omitted rather than rendering an empty heading.

**Accessibility.** Cards are `<article>`s; when navigable, the whole card is one link with
a single accessible name (H3 text), not a link wrapping several headings. Reading time
is text, not an icon-only badge. The hidden mobile items are `display:none`, so they are
absent from the accessibility tree on mobile only.

---

## 10. Section 7 — Final CTA

**Purpose.** Last conversion opportunity for a reader who scrolled past the finder
without answering.

**Desktop composition.** Full-width gradient panel (`linear-gradient` from
`primary-deep` through a slate-indigo to `primary-deep`), 40 px padding, an ambient
saffron flare (blurred circle, decorative), a translucent pill "✨ Diagnostic
Personnalisé", H2 in white, light-indigo body, and a large saffron link-button "Trouver
mon PC en 1 minute" with an arrow.

**Mobile composition.** A `primary`-filled card (`rounded-card`, 16 px padding): H2
"Pas sûr de votre choix de configuration ?", two-line body in `#A59FFF`-equivalent
(`text-primary-soft` at 80 % or `text-on-primary/80` — use an existing token, no hex), a
full-width 44 px saffron button.

**Components.** `FinalRecommendationCTA` (client, because the action scrolls and may
submit), reusing `Button` (`variant="cta"`, see §11.2).

**Content keys.**

| Key                | French source                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `finalCta.eyebrow` | Diagnostic personnalisé                                                                                                                    |
| `finalCta.title`   | Pas sûr de votre choix de configuration ?                                                                                                  |
| `finalCta.body`    | Laissez-nous vous guider pas à pas pour trouver le PC exactement adapté à votre budget, à vos jeux préférés et à vos logiciels de travail. |
| `finalCta.cta`     | Trouver mon PC en 1 minute                                                                                                                 |

**Interactions.** Scrolls to `#simulateur` and focuses the budget group (does not submit,
does not submit a second POST). Analytics: one `home_cta_click` event if an analytics
seam exists; Step 1 has none, so nothing is emitted (Q-13).

**Responsive behaviour.** Same component, `bg-linear-to-br from-primary-deep via-primary
to-primary-deep` on desktop; the mobile variant uses `bg-primary` for contrast at small
sizes. Gradient text is avoided; body text uses a token with verified contrast.

**States.** Static.

**Accessibility.** The panel is not a landmark; the H2 is. The decorative flare is
`aria-hidden` and `pointer-events-none`. The gradient background must keep ≥ 4.5:1 for
body text — the implementation verifies with a contrast calculation in review, and falls
back to `text-on-primary` if `primary-soft` fails.

---

## 11. Section 8 — Footer and mobile navigation

**Purpose.** Close the page with brand, promise, legal entries and the persistent mobile
navigation.

**Desktop composition.** Top hairline, one row: brand tile + wordmark, tagline
"Configurations PC compatibles, prix en dirhams.", copyright. (Step 0 already ships this
exact `SiteFooter`.) The desktop frame does not show a footer; the existing footer is
kept as-is.

**Mobile composition.** Per `23:1440`: hairline, brand row (24 px tile + "Morocco**PC**")
and "Casablanca · Rabat · Maroc" on the end side, a wrapped link row (À propos ·
Boutiques · Méthodologie · Contact), then a copyright row. Then the fixed bottom nav
(`23:1489`): Accueil (current), a raised circular Configurer FAB, and only destinations
that exist in Step 1. Composants and Enregistrés are hidden or visibly disabled without
an `href` until their routes exist; Guides is likewise non-navigating until Step 4.
Keep the 56 px + `env(safe-area-inset-bottom)` geometry.

**Components.** `SiteFooter` (extend props: optional `location` and `links[]`),
`MobileNav` (exists; add `saved` only when the saved route exists).

**Content keys.**

| Key                                                            | French source                                   |
| -------------------------------------------------------------- | ----------------------------------------------- |
| `Shell.footerTagline`                                          | Configurations PC compatibles, prix en dirhams. |
| `Shell.footerCopyright`                                        | © 2026 morocco-pc · Prix en dirhams             |
| `footer.location`                                              | Casablanca · Rabat · Maroc                      |
| `footer.links.about` / `.stores` / `.methodology` / `.contact` | À propos / Boutiques / Méthodologie / Contact   |

**Interactions.** Footer links are placeholders until their pages exist (same pattern as
the methodology link: `aria-disabled`, no `href`). The mobile nav's centre action scrolls
to `#simulateur`; unavailable Composants, Guides and Enregistrés destinations have no
`href` and never point at an unrelated homepage anchor. Only actual homepage anchors
such as Accueil and Configurer remain interactive.

**Responsive behaviour.** Footer: stacked and centred on mobile, one row `lg`. Bottom nav
`lg:hidden`; the layout already reserves `pb-24` for it.

**States.** Static.

**Accessibility.** `<footer>` + `<nav aria-label="Navigation mobile">` (existing). Links
are 44 px minimum; the FAB has an `aria-label`. The bottom nav must not cover the last
section: the layout's `main pb-24` plus the footer wrapper already handles it, and
Playwright asserts the final CTA's bottom edge sits above the nav at 360 px.

---

## 12. Component architecture

### 12.1 Where files go

Follows the Step 0 conventions (server components by default, one client island per
interactive area, `components/ui` stays hook-free).

```
app/[locale]/
  page.tsx                        REPLACED: composes the eight sections (server)
components/home/
  homepage-hero.tsx               server   hero copy + trust chips + rig preview slot
  hero-rig-preview.tsx            server   preview card (Badge/Card only)
  announcement-banner.tsx         server   desktop banner
  budget-usage-finder.tsx         client   the form island (RHF + Zod + mutation)
  budget-preset-grid.tsx          client   radios (or server markup driven by RHF)
  custom-budget-field.tsx         client   numeric input + slider (lg)
  usage-selector.tsx              client   three radios
  discovery-pathways.tsx          client   desktop categories; resolution tiles deferred (Q-20)
  recommended-build-section.tsx   client   query + budget-aware selection + layout
  featured-build-card.tsx         server   presentational
  compact-build-row.tsx           server   presentational
  spec-pill.tsx                   server   presentational
  trust-highlights.tsx            server
  featured-guides.tsx             server
  guide-card.tsx                  server
  final-cta.tsx                   client
lib/homepage/
  finder-schema.ts                Zod schema + inferred type
  store.ts                        Zustand: budget, useCase, resolution, step
  guides.ts                       static guide metadata (4 entries)
  builds.ts                       preset → card view-model mapping
  use-presets.ts                  TanStack Query hooks (presets + per-selection detail)
lib/api/
  types.ts                        ADD aliases: Preset, PresetBuild, BuildComponent
```

Sections are **not** one component each when they are purely presentational: §12.2 lists
the minimum set. `RecommendedBuildSection` is the only new data owner; everything else is
props.

### 12.2 Kit additions (components, not tokens)

| Addition                                         | Why                                                                                                                                        | Risk                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `Button` variant `cta`                           | the frames' saffron primary action (`bg-accent text-on-accent hover:bg-accent-strong`) has no existing variant; `secondary` is a pale fill | additive; no token change; document in `DESIGN_SYSTEM.md` |
| `SiteFooter` optional `location` + `links` props | mobile footer rows                                                                                                                         | backwards compatible (props optional)                     |

Everything else reuses `Button`/`Badge`/`Card`/`TextField` unchanged. No new dependency:
React Hook Form, Zod, Zustand, TanStack Query and `lucide-react` are already installed.

A `Badge tone="accent"` was proposed for the "Recommandé" pill; the per-use-case decision
drops that badge, so it is no longer a required addition.

### 12.3 State ownership

| State                                | Owner                             | Persistence                                                                                                                               |
| ------------------------------------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Budget preset / custom amount        | `lib/homepage/store.ts` (Zustand) | memory only (matches Step 0's deliberate no-cookie rule)                                                                                  |
| Usage, resolution                    | same store                        | memory only                                                                                                                               |
| Server data (presets, preset detail) | TanStack Query                    | 60 s `staleTime`, no `gcTime` override; details keyed by `recommendation_id` + `catalog_version`, cached entries reused across selections |
| Form validation                      | React Hook Form + Zod resolver    | —                                                                                                                                         |

The finder's answers outlive the finder because the shortcuts and the final CTA write to
the same store; that is the seam the results page (Step 2) reads.

---

## 13. API mapping (summary)

Full field-level mapping: `01-homepage-api-mapping.md`. Contract version: **1.10.0**
(`apps/api/test/unit/openapi-v1.10.json`); types are generated from it, never hand-written.

| Need                                                  | Operation                             | Homepage?                                        |
| ----------------------------------------------------- | ------------------------------------- | ------------------------------------------------ |
| Usage options + whether resolution is accepted        | `GET /v1/meta/options`                | **yes** (finder), fallback constants if it fails |
| Currency vocabulary                                   | `GET /v1/meta/options` (`currencies`) | **yes**, only to confirm `MAD`                   |
| One generic preset per use case; budget-aware lookup  | `GET /v1/presets?use_case&currency`   | **yes** (section 3)                              |
| Build detail (components, score, status) for a preset | `GET /v1/recommendations/{id}`        | **yes** (3 initial; +1 per later selection)      |
| Personalised answer for the finder                    | `POST /v1/recommendations`            | **yes**, on CTA only, gated (Q-08)               |
| A persisted pass by id                                | `GET /v1/recommendations/{id}`        | no — Step 2                                      |
| Catalogue listing / product / price history           | `GET /v1/catalog/...`                 | no — Steps 4–6                                   |
| Component swap preview/commit                         | `/swap-preview`, `/swap`              | no — Step 7                                      |
| Liveness / DB reachability                            | `GET /v1/health`                      | no (build gate only)                             |

Rules that follow from the contract:

- **No invented endpoints.** There is no guides, saved-builds, "featured builds" or
  "methodology" resource; those sections are static content or later steps.
- **No duplicated engine logic.** The homepage never computes compatibility, scores,
  budgets or price status: `compatibility_status`, `build_score` and `price_status` are
  rendered as served, and `budget_floor` is never rendered at all.
- **`GET /v1/presets` is not a build list.** A preset is
  `{ budget_amount, recommendation_id, build_score, price_status }` — a **pointer**. The
  card's component summary requires the detail read: the three initial reads are the
  homepage's starting fan-out, not a cap on how many details it may ever show (§6,
  **Dynamic detail reads**).
- **Presets have no resolution and no title.** The card title is the localized use-case label (`builds.category.*` — PC Gaming / PC Bureautique / PC Création & Professionnel, Q-16 approved); no field carries a build name, so none is invented. Resolution comes only from the finder.
- **Prices are never invented.** The frames' prices (7 450 / 4 890 / 13 900 / 5 500 /
  11 000 / 3 200 / 9 800) are design placeholders; only served `total_price` /
  `budget_amount` values are rendered, through `formatPrice(value, currency)` with the detail currency when non-null, otherwise the confirmed `MAD` query currency.
- **Rate limits are real.** 120/min for reads, 30/min for POST; a 429 is a UI state with
  `retryAfterSeconds`, never a silent retry (the query client already refuses 429).

---

## 14. UI states

| Surface                         | Loading                                                  | Empty                                                                                                        | Error                                             | Notes                                                                                         |
| ------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Finder options (`meta/options`) | render the three fallback usages immediately; no spinner | never empty (fallback)                                                                                       | silent fallback, logged; the form still works     | a form must never be blocked by a vocabulary call                                             |
| Recommended builds (presets)    | 3 skeletons, section `aria-busy`                         | `builds.empty.*` + retry                                                                                     | `builds.error.*` + retry                          | `presets: []` is a **valid 200**; each use case keeps its slot                                |
| Finder-applied budget filter    | n/a                                                      | no preset ≤ visitor budget → `builds.empty.*`; budget above the top tier → highest tier + `builds.budgetCap` | n/a                                               | filters the already-fetched ladder, no request                                                |
| Preset detail (per card)        | card renders without pills; pills appear when loaded     | preset with `build_score: null` → "—"                                                                        | card renders its preset budget, no component line | one failed detail must not fail the section                                                   |
| Finder submit                   | CTA pending state                                        | `builds: []` → results page (Step 2) owns that state                                                         | inline alert + retry; 429 countdown               | the homepage never renders a pass                                                             |
| Shortcuts                       | n/a                                                      | **not rendered in the first release** (Q-20)                                                                 | n/a                                               | hidden first release; no simulated filtering; later only when `resolution` ∈ `inputs_applied` |
| Hero preview                    | skeleton of equal height                                 | text-only shell                                                                                              | text-only shell                                   | no fake price/score                                                                           |
| Rest of the page                | n/a                                                      | n/a                                                                                                          | n/a                                               | server-rendered static                                                                        |

Global conditions: **offline** (fetch TypeError → the query's one retry, then the error
block with retry); **429** (`retryAfterSeconds` countdown, disabled submit); **503**
("service indisponible", retry offered); **catalog version change** (the query key
includes `catalog_version` when known, so a change refetches rather than serving a stale
preset whose prices were invalidated).

---

## 15. Internationalisation and RTL

- Two locales, `fr` (default) and `ar`, prefix always (`/fr`, `/ar`). The homepage is
  `app/[locale]/page.tsx`, so both come from one file.
- New namespace **`Homepage`** in `messages/fr.json` and `messages/ar.json`, structurally
  identical (`tests/i18n/messages.test.ts` enforces key and placeholder parity). The
  preview's `Home` namespace is removed in the same change that replaces the preview page;
  no key is shared between the two.
- French copy in §3–§11 is the **source** (taken from the frames). Arabic must be
  authored, not machine-copied: same keys, same placeholders, Arabic-Indic vs Latin digits
  as the existing dictionaries use (Latin digits, per `lib/format/price.ts`).
- **Arabic is complete for the release (Q-15, approved).** Every `Homepage` key ships in
  `ar.json` with the same placeholders as `fr.json` — no key is left French-only and no
  machine text ships. The Arabic copy requires a **native-language review signed off
  before production**, and the RTL layout plus Arabic typography are verified on that
  reviewed copy (§16.6, §16.7).
- Every visible string comes from the dictionary or a prop: no literal in a component
  (including "DH", which comes from the currency `formatPrice` is given: the rendered detail's when one exists, otherwise the `MAD` confirmed by `meta/options`).
- Plurals/placeholders: `{minutes}`, `{count}`, `{score}`, `{amount}`, `{seconds}`,
  `{current}`/`{total}`. Amounts inside a translated sentence are passed already
  formatted with `formatPrice`, never concatenated around a symbol.
- RTL: logical properties only; flex/grid mirror automatically. Directional icons
  (`ArrowRight` on CTAs, guide arrows) use `rtl:-scale-x-100`. The desktop 12-column grid
  starts at the inline start. The mobile bottom nav's FAB stays centred and its first item
  is at the inline start (Playwright asserts mirrored x positions, as Step 0 does).
- Arabic typography: `html[lang="ar"] body` already switches to IBM Plex Sans Arabic with
  a 1.6 line-height; no per-component override. Arabic headings inherit the same type
  steps; if a heading overflows, fix the copy, not the token.

---

## 16. Definition of Done

Every item is a check someone can run or inspect. **PASS** requires evidence; a skipped
item is reported as skipped.

### 16.1 Visual fidelity

- [ ] At 390 px the page order matches `23:1179`: hero → finder → configurations →
      shortcuts → trust → guides → CTA → footer, with the bottom nav fixed.
- [ ] At 1440 px the composition matches `19:3`: banner, hero with preview card and
      side-by-side finder, three use-case cards, the desktop Catégories & usages grid,
      trust in three columns, four guides in a row, gradient CTA.
- [ ] Every colour used is a token utility; `npm run lint` plus a diff review finds no hex
      literal and no `ml/mr/pl/pr/left/right/text-left` utility in the new components.
- [ ] Type steps come from the existing scale; no new `text-[…]` arbitrary size.
- [ ] The three cards share one anatomy and equal weight; the desktop ring, if kept, is decorative only and no card carries a "most recommended" badge. Media heights match the frame within a few pixels.

### 16.2 Responsive behaviour

- [ ] No horizontal page scroll at 360, 390, 430, 1280 or 1440 px, in `fr` and `ar`.
- [ ] 360/390/430 render the single-column composition; 1280/1440 render `max-w-page`
      centred with the 12-column layout.
- [ ] The configuration section is "1 card + 2 compact rows" up to `md` and "3 equal cards" from `lg`, from one component tree (no duplicated markup).
- [ ] The bottom nav never covers the final CTA or the footer at 360 px.
- [ ] Touch targets are ≥ 44 px (48 px on mobile) — audited on every interactive element.

### 16.3 Budget and usage interactions

- [ ] First visit: no preset, no usage and no custom amount selected; the CTA is
      disabled; the status line reads "À définir".
- [ ] Selecting a preset selects exactly one (`aria-checked`/native radio), updates the
      status line, and enables the CTA once a usage is also chosen.
- [ ] Custom budget accepts only integers within 3 500–100 000, step 500; out-of-range
      input shows the range message and keeps the CTA disabled.
- [ ] Usage choice is a single selection across three options; keyboard arrows move
      within the group and `Space` selects.
- [ ] No resolution shortcut tile is rendered in the first release (Q-20); when the tiles
      are enabled they set `GAMING` + `1080p|1440p` and move focus to the finder without
      submitting.
- [ ] Submit sends `{ budget_amount, currency: "MAD", use_case, resolution? }` — asserted
      on the intercepted request body in Playwright.

### 16.4 Personalised vs generic states

- [ ] Generic (default) state shows exactly one preset for each of GAMING, OFFICE and
      WORKSTATION, in that fixed order: the highest available preset with
      `budget_amount <= 12,000 MAD`. No preset above 12,000 is used for the initial cards.
      If no qualifying preset exists for a use case, its slot shows the no-configuration
      state. No price or score is hard-coded and no placeholder number reaches the DOM.
- [ ] The three cards are peers; the UI does not rank unlike use cases or call one "most
      recommended".
- [ ] Any displayed `build_score` is labelled "Score de configuration" and help text
      states it is neither FPS nor a benchmark.
- [ ] The card's price badge reads `builds[0].price_status` only: `verified` shows
      `builds.badge.verified`, `indicative` shows `builds.badge.indicative`, and a `null`
      status or an empty `builds` array shows **no badge**. `presets[].price_status` is
      never the card badge source, and an unknown price is never labelled indicative.
- [ ] No real-time, weekly-refresh or verified-retailer claim appears while price
      evidence remains unverified.
- [ ] With homepage POST disabled, finder selection chooses only the greatest same-use-
      case preset with `budget_amount <= visitorBudget`; it never shows an over-budget
      preset as suitable and no match produces the no-match state.
- [ ] With `NEXT_PUBLIC_HOMEPAGE_SUBMIT=on`, the CTA posts once and navigates to
      `/[locale]/resultats/{id}`.
- [ ] A zero-build preset renders "—" for the score and never shows `0`.
- [ ] `presets: []` renders the empty copy, not an error; a 500 renders the error copy.

### 16.5 API integration

- [ ] Types come from `lib/api/schema.d.ts` (generated from
      `apps/api/test/unit/openapi-v1.10.json`); `npm run check:api-types` passes.
- [ ] No endpoint, path or field is used that is absent from the contract.
- [ ] `GET /v1/presets` is called once per use case and cached 60 s; the initial detail
      read is three parallel `GET /v1/recommendations/{id}` calls, and a later finder
      selection reuses a cached detail or issues exactly one more — never a lifetime cap.
- [ ] 429/503/offline each produce their documented state; no silent retry of a 429.
- [ ] The app still renders (static sections + error state in section 3) when the API is
      unreachable at request time.

### 16.6 Localisation

- [ ] `fr.json` and `ar.json` have identical `Homepage` key trees and identical
      placeholders (`npm test` passes the parity test).
- [ ] Arabic copy for every `Homepage` key is reviewed, and the native-language sign-off
      is recorded before production (Q-15).
- [ ] No visible string is hard-coded in a component (grep for French copy outside
      `messages/`).
- [ ] `/fr` and `/ar` render the complete page; switching locale keeps the page and
      direction.

### 16.7 RTL

- [ ] `<html dir="rtl">` on `/ar`; the hero, cards, pills and price rows mirror.
- [ ] Directional arrows/chevrons flip; text alignment is `text-start`; icons do not
      overlap text.
- [ ] Arabic uses IBM Plex Sans Arabic with the 1.6 line-height; no Latin-only fallback
      for Arabic copy.
- [ ] The mobile nav mirrors (first item on the right in `/ar`).

### 16.8 Accessibility

- [ ] Exactly one `<h1>`; sections are `aria-labelledby`; heading levels do not skip.
- [ ] Finder: `<form>` + two `<fieldset>`/`<legend>` groups, native radios, errors in a
      `role="alert"` region referenced by `aria-describedby`, `aria-busy` on submit.
- [ ] All interactive elements reachable and operable by keyboard, in DOM order, with a
      visible focus ring.
- [ ] Icon-only controls have `aria-label`; decorative icons are `aria-hidden`.
- [ ] Contrast ≥ 4.5:1 for body text and ≥ 3:1 for large text, including the saffron CTA
      (`text-on-accent`) and the gradient panel.
- [ ] Status is never conveyed by colour alone (icon + text).
- [ ] `prefers-reduced-motion` honoured (global rule already in `globals.css`).

### 16.9 Browser testing

- [ ] `e2e/homepage.spec.ts` — layout/order at 390 and 1440, section headings, no
      overflow at 360/390/430/1280/1440, footer/nav do not overlap.
- [ ] `e2e/homepage-finder.spec.ts` — no default selection, preset + usage enabling the
      CTA, custom-budget validation, shortcut focus move, request body assertion with
      `page.route` stubbing `/v1/**`.
- [ ] `e2e/homepage-builds.spec.ts` — loading skeletons, populated cards, `presets: []`
      empty state, 500 error state, zero-build score "—".
- [ ] `e2e/homepage-i18n.spec.ts` — `/ar` mirroring, locale switch, Arabic heading and nav
      labels.
- [ ] The API is never contacted in CI: every `/v1/**` request is stubbed in the specs
      (the homepage's own requests are client-side, which is what makes this possible).

### 16.10 Production build

- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run check:api-types`,
      `npm test`, `npm run build`, `npm run test:e2e` all pass in `apps/web-v2`.
- [ ] `next build` succeeds with no API running (no build-time fetch dependency).
- [ ] The homepage route is served for `/fr` and `/ar`; `/` still redirects to `/fr`.
- [ ] Bundle: no new dependency appears in `package.json`/`package-lock.json`; the island
      count is the six listed in §12.1.
- [ ] The V2 workflow (`web-v2.yml`) is unchanged and still green.

---

## 17. Proposed implementation order

Each step is a reviewable, independently green change.

1. **Content and types first (no UI).** Add the `Homepage` namespace to `fr.json`/`ar.json`
   with every key from §3–§11; add `lib/homepage/guides.ts`, `finder-schema.ts`, `store.ts`;
   add the `Preset`/`BuildComponent` aliases to `lib/api/types.ts`. Gate: `npm test`
   (parity), `typecheck`.
2. **Kit additions.** `Button variant="cta"`, `SiteFooter` props,
   with one unit test each for the accessibility contract; document them in
   `DESIGN_SYSTEM.md`. Gate: `npm test`, `lint`, `format:check`.
3. **Static shell of the page.** Replace the preview page with a server page composing
   hero, trust, guides, final CTA, footer and the banner — no network, no finder yet.
   Gate: `build`, plus a first Playwright spec for layout/order/overflow.
4. **Finder island.** Budget presets, custom budget, usage selector, shortcuts, store,
   no submit behaviour yet (CTA disabled). Gate: `e2e/homepage-finder.spec.ts`.
5. **Recommended configurations.** `use-presets` hook + section + cards, with loading,
   empty, error and zero-build states. Gate: `e2e/homepage-builds.spec.ts` with stubs.
6. **Submit seam.** Mutation, pending/error/429 states, navigation behind
   `NEXT_PUBLIC_HOMEPAGE_SUBMIT` (default off). Gate: request-body assertion.
7. **RTL and Arabic pass.** Mirror audit, Arabic copy review, `homepage-i18n.spec.ts`.
8. **Full gate run + docs.** All four suites, `build`, update `README.md` and
   `docs/DESIGN_SYSTEM.md` for the new kit variants; add the homepage section to the README's
   structure table.

Nothing in step 1–8 touches `apps/api`, V1, the workflows or the tokens.

---

## 18. Open questions

Defaults are chosen so implementation can start; each answer may change the spec.

| #    | Question                                                                                                                                        | Default taken                                                                                                                                                                             | Impact if changed                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Q-01 | The frames' saffron `#FFA51B` and canvas `#F9F9FF` differ from the token palette. Accept the token-mapped rendering, or change tokens?          | **approved**: retain the semantic token system — existing `accent` / `bg-background`; no new token and no hard-coded hex without design-owner approval                                    | visible brand delta on CTAs                    |
| Q-02 | Desktop H1 is 48 px in the frame, `text-display-lg` is 40 px. Add a 48 px step or use 40?                                                       | **approved**: use the 40 px `text-display-lg`; no 48 px step is added                                                                                                                     | hero height, line breaks                       |
| Q-03 | Build and guide photography is unavailable. Token placeholders acceptable for Step 1?                                                           | yes                                                                                                                                                                                       | visual fidelity                                |
| Q-04 | Desktop's "Catégories & usages" 4-tile section is not in the mobile section list. Ship it?                                                      | resolved: preserve desktop category grid; mobile resolution shortcuts deferred to a later release (Q-20)                                                                                  | one responsive section with two frame variants |
| Q-05 | Mobile header shows a saved-builds icon with a count and an unidentified circular icon.                                                         | omit both                                                                                                                                                                                 | header parity                                  |
| Q-06 | Hero preview card's "Détails specs →" has no destination until a product page exists.                                                           | render as text, no link                                                                                                                                                                   | one dead-ish CTA                               |
| Q-07 | `GET /v1/presets` has no `resolution` parameter, so 1080p/1440p "Dès X DH" cannot be derived.                                                   | resolved: the shortcut tiles are deferred (Q-20); no price is derived from a resolution                                                                                                   | needs a resolution-scoped read                 |
| Q-08 | The results route (`/[locale]/resultats/{id}`) is Step 2. Ship the POST-on-CTA now or gate it?                                                  | gated off (`NEXT_PUBLIC_HOMEPAGE_SUBMIT=off`); CTA scrolls to the best pre-generated preset within budget                                                                                 | orphan passes vs. a non-functional CTA         |
| Q-09 | Trust copy makes claims ("actualisation hebdomadaire", "vérification TDP"). Keep as static copy?                                                | resolved: remove freshness and absolute compatibility claims; describe API statuses only                                                                                                  | misleading product claims                      |
| Q-10 | Methodology link has no page.                                                                                                                   | self-anchor, `aria-disabled`                                                                                                                                                              | one placeholder link                           |
| Q-11 | Guides section shows "(14)" but only four guides exist and no endpoint serves them.                                                             | render "Tous les guides d'achat" without a count                                                                                                                                          | copy                                           |
| Q-12 | Guide cards have no routes until Step 4.                                                                                                        | `NEXT_PUBLIC_GUIDES_ENABLED=off`, non-navigating cards                                                                                                                                    | four placeholder cards                         |
| Q-13 | No analytics provider exists in V2.                                                                                                             | emit no events                                                                                                                                                                            | measurement                                    |
| Q-14 | Which budget determines the generic homepage configurations before finder selection?                                                            | resolved by owner: 12,000 MAD ceiling; choose the highest same-use-case preset at or below it; finder later uses the visitor's own budget                                                 | no backend write in homepage MVP               |
| Q-15 | Arabic copy for the new namespace has no approved source.                                                                                       | **approved**: ship a complete Arabic `Homepage` namespace with exact key/placeholder parity and verified RTL + typography; a native-language review is signed off before production       | launch readiness                               |
| Q-16 | `GET /v1/presets` carries no title and a build has no name field. What heads the card?                                                          | **approved**: the localized use-case label — PC Gaming / PC Bureautique / PC Création & Professionnel; the served budget stays on `builds.budgetLabel`; no configuration name is invented | card hierarchy, copy, SEO                      |
| Q-17 | Banner copy ("Tarifs et disponibilités vérifiés ce mois-ci", "Index MAD temps réel") asserts verification and a live index that nothing serves. | **approved**: remove both claims and their keys; render neutral copy only, plus the Arabic chip when the Arabic experience is live                                                        | header parity, trust                           |
| Q-18 | The peer rule drops the approved frame's filter tabs and the "Le plus recommandé" badge. Accept the fidelity trade?                             | yes: three peers, no tabs, no ranking badge                                                                                                                                               | visual fidelity to `19:172`                    |
| Q-19 | With one card per use case, which preset backs the hero's "Sélection du moment" preview?                                                        | the Gaming card's preset already fetched for section 3 (highest at or below 12,000 MAD; no extra request)                                                                                 | hero content, request count                    |
| Q-20 | Resolution cannot be applied before the Step 2 results route: should the 1080p / 1440p shortcuts ship in the first release?                     | **approved**: hide both variants in the first release, implement no simulated resolution filtering, and restore them once a selected resolution reaches a served card                     | discovery parity with the mobile frame         |

## 19. Deferred cosmetic polish (not release-gating)

Two desktop-only presentation defects were observed during the independent review. They are
recorded here so they are not lost, and they are deliberately **not** fixed in the closure
pass: changing them would move approved card geometry.

1. **Spec-pill wrapping at desktop widths.** Four pills can wrap to a second line in the
   third card, which makes the three peer cards read as unequal heights.
2. **Score/price row offset.** The score row and the price row do not share a baseline
   across the three cards when a rationale is present.

Any fix belongs to a design-reviewed change that keeps the three cards at equal weight, may
not alter the token set, and must re-run `e2e/homepage-builds.spec.ts` plus
`e2e/homepage.spec.ts`. A visible loading indicator or `aria-busy` redesign is a separate
proposal and is not part of this backlog.
