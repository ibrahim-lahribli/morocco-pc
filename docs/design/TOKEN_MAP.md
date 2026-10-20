# Design token map (S2)

**What this file is.** The in-repo record of every design token in
`apps/web/app/globals.css`: where each value came from, what it measures, and
where it deliberately differs from the Stitch board. A token value is only
truthful if it can be traced; this file is the trace.

**Source.** The Stitch project `projects/3530106450258598180` ("ConfigPC Mobile
Design System"), read over the Stitch MCP on 2026-10-20. Values come from two
places and both are cited:

- the board screen `b4659f8eea5c410791a48ad27cc1fb93` ("Design System Board
  (360px)"), whose embedded `tailwind.config` declares the palette, fonts and
  card shadows, and whose 16 documented sections declare the type scale, radii
  and component states;
- the 11 remaining **visible** screens, used only to CHECK that the palette is
  actually what the product screens use. The four hidden screens are excluded by
  decision: two are byte-identical duplicates of each other, the rest duplicate
  a canvas variant of a visible screen.

Re-derive rather than trust: `get_screen` on the board id returns `htmlCode` as
a download URL (fetch it with the same `X-Goog-Api-Key` header; it answers
either `{ dataString }` JSON or raw `text/html`, so read the content-type). The
gate is `apps/web/scripts/check-tokens.mjs`; the measurement is
`apps/web/e2e/tokens.spec.ts`.

## 1. Palette

Every value is OKLCH in the token file; the hex column is the board's literal,
kept here because it is what a designer will paste from Stitch.

| Token | OKLCH | Hex | Role |
|---|---|---|---|
| `--color-primary` | `oklch(39.84% 0.1773 277.37)` | `#3730A3` | actions, links, selected state |
| `--color-primary-soft` | `oklch(96.19% 0.0179 272.31)` | `#EEF2FF` | selected-card fill |
| `--color-primary-hover` | `oklch(35.88% 0.1354 278.70)` | `#312E81` | pressed/active |
| `--color-accent` | `oklch(76.86% 0.1647 70.08)` | `#F59E0B` | saffron accent; fill only, never text |
| `--color-accent-soft` | `oklch(96.19% 0.0580 95.62)` | `#FEF3C7` | accent tint |
| `--color-whatsapp` | `oklch(43.35% 0.0754 182.23)` | `#075E54` | share action |
| `--color-page` | `oklch(98.48% 0.0013 106.42)` | `#FAFAF9` | page background (stone-50) |
| `--color-surface` | `oklch(100.00% 0.0000 89.88)` | `#FFFFFF` | cards, sheets |
| `--color-subtle` | `oklch(96.99% 0.0013 106.42)` | `#F5F5F4` | secondary fill (stone-100) |
| `--color-track` | `oklch(92.32% 0.0026 48.72)` | `#E7E5E4` | borders and progress rails (stone-200) |
| `--color-muted` | `oklch(44.44% 0.0096 73.64)` | `#57534E` | secondary text (stone-600) |
| `--color-ink` | `oklch(21.61% 0.0061 56.04)` | `#1C1917` | primary text (stone-900) |
| `--color-placeholder` | `oklch(71.61% 0.0091 56.26)` | `#A8A29E` | input hints (stone-400) |
| `--color-success` | `oklch(52.73% 0.1371 150.07)` | `#15803D` | verified |
| `--color-success-soft` | `oklch(96.24% 0.0434 156.74)` | `#DCFCE7` | verified badge fill |
| `--color-warning` | `oklch(55.53% 0.1455 49.00)` | `#B45309` | indicative |
| `--color-warning-soft` | `oklch(96.19% 0.0580 95.62)` | `#FEF3C7` | indicative badge fill |
| `--color-error` | `oklch(50.54% 0.1905 27.52)` | `#B91C1C` | error, over budget |
| `--color-error-soft` | `oklch(93.56% 0.0309 17.72)` | `#FEE2E2` | error banner fill |
| `--color-info` | `oklch(48.82% 0.2172 264.38)` | `#1D4ED8` | information |
| `--color-info-soft` | `oklch(93.19% 0.0316 255.59)` | `#DBEAFE` | info banner fill |

**Semantic aliases** — the only colour names a component may use:
`--color-background` → `page`, `--color-foreground` → `ink`, `--color-border` →
`track`, `--color-ring` → `primary`, `--color-verified` → `success`,
`--color-warn` → `warning`, `--color-danger` → `error`.

The board's neutral ramp turns out to be Tailwind's **stone** scale exactly
(`#FAFAF9`, `#F5F5F4`, `#E7E5E4`, `#57534E`, `#1C1917`, `#A8A29E`), so the tokens
name the roles rather than repeating the ramp.

## 2. Type scale

The board's 7 sizes map onto Tailwind's default scale; the tokens name the role.

| Token | Size / line-height / weight | Board section |
|---|---|---|
| `--text-display` | 30 / 1.25 / 700 | §2, "Grand titre / Valeur clé" |
| `--text-heading` | 24 / 1.25 / 700 | §2, "Titre de niveau 2" |
| `--text-title` | 20 / 1.25 / 700 | §2, "Titre de section" |
| `--text-subtitle` | 18 / 1.375 / 600 | §2, "Sous-titre / Emphase" |
| `--text-body` | 16 / 1.5 / 400 | §2, "Corps de texte de base" |
| `--text-compact` | 14 / 1.43 / 400 | §2, "Texte compact / Badges" |
| `--text-caption` | 12 / 1.33 / 400 | §2, "Légende / Micro-copie" |
| `--text-micro` | 11 / 1.45 / 400 | §2, mono labels |

Fonts: `--font-sans` = Inter and `--font-mono` = Geist Mono, both compiled in
`app/[locale]/layout.tsx`; `--font-arabic` = IBM Plex Sans Arabic (S5 compiles
the `arabic` subset and its class is on `<html>` for BOTH locales, so the token
resolves on `/fr/tokens` too — see [I18N.md](I18N.md) §5). Amounts use
`.num-tabular` (board §2, "12 500 MAD").

**Board inconsistency recorded, not hidden:** the label for the 16 px body says
line-height 1.5, while the sample element uses `leading-relaxed` (1.625). The
token takes **1.5** (the stated spec) and S5/S11 may revisit when real copy is
measured.

## 3. Space, radius, elevation

- Spacing: the board's 4 / 8 / 12 / 16 / 24 / 32 / 48 px are Tailwind's
  `1 / 2 / 3 / 4 / 6 / 8 / 12`. No second scale is defined.
- `--radius-control` 8 px (inputs, buttons), `--radius-card` 12 px (cards,
  sheets), `--radius-pill` 9999 px (badges, chips, radios).
- `--shadow-card-1` (`0 1px 2px 0 rgb(28 25 23 / .05)`) and `--shadow-card-2`
  (`0 4px 6px -1px rgb(28 25 23 / .08)`), both from the board's config. The board
  is explicit that **borders carry structure and shadows are ambient only**.
- `--spacing-control` 48 px is the board's minimum interactive height; 44 px is
  the accessibility floor and is only acceptable for secondary in-text controls.

## 4. Component decisions the board fixed

| Element | Decision (board §) |
|---|---|
| Primary button | 48 px tall, 8 px radius, `primary` fill, `surface` text, 16 px/500; pressed → `primary-hover` (§4) |
| Secondary button | `surface` fill, 1 px `border`, `ink` text (§4) |
| Disabled | `subtle` fill, `muted` text at 70 %, `cursor-not-allowed` (§4) |
| Focus | 2 px `primary` outline, 2 px offset, everywhere (§4) |
| Option card | 12 px radius, 1 px border; selected: `primary-soft` + 2 px `primary` (§6) |
| Segmented control | `track` container, 48 px tall, active segment `surface` + `primary` text (§7) |
| Budget field | 48 px tall, 8 px radius, `page` fill, `MAD` suffix inside the field (§8) |
| Price badge | pill, 12 px/500, icon + text, `nowrap`; démo = dashed `muted`, indicatif = `warning-soft`, vérifié = `success-soft` + date (§9) |
| Budget bar | 10 px rail `track`, 8 px radius; normal `primary`, warning `warning`, over `error` (§10) |
| Component row | 32 px icon tile on `subtle`, 14 px name, 12 px detail, right-aligned tabular price (§11) |
| Strategy card | 16 px padding, 12 px radius, 12 px uppercase `primary` eyebrow, 18 px name, 20 px total (§12) |
| Disclosure | `<details>` summary 48 px min, 16 px/600, chevron `primary` rotating (§13) |
| Share | WhatsApp `whatsapp` fill 48 px; two secondary buttons in a 2-column grid (§14) |
| Skeleton | `subtle` blocks, pulse disabled under `prefers-reduced-motion` (§15) |
| Alert | 12 px/400, soft fill + 20 % border, 20 px icon (§16) |

## 5. Measured contrast

Computed from the OKLCH values in `globals.css` by `e2e/tokens.spec.ts` (OKLab →
sRGB → WCAG relative luminance). Thresholds: **4.5:1** for text, **3:1** for a
graphical object or focus indicator.

| Pair | Ratio | Threshold |
|---|---|---|
| ink on page | 16.74 | 4.5 |
| ink on surface | 17.49 | 4.5 |
| muted on page | 7.30 | 4.5 |
| muted on surface | 7.63 | 4.5 |
| muted on subtle | 6.99 | 4.5 |
| surface on primary | 9.93 | 4.5 |
| primary on page | 9.51 | 4.5 |
| primary on primary-soft | 8.88 | 4.5 |
| surface on primary-hover | 11.42 | 4.5 |
| surface on whatsapp | 7.67 | 4.5 |
| success on success-soft | 4.57 | 4.5 |
| warning on warning-soft | **4.51** | 4.5 |
| error on error-soft | 5.30 | 4.5 |
| info on info-soft | 5.49 | 4.5 |
| ink on accent | 8.14 | 4.5 |
| primary fill on track | 7.91 | 3 |
| warning fill on track | 4.00 | 3 |
| focus ring on page | 9.51 | 3 |

**Thin margins, named.** `warning` on `warning-soft` is 4.51:1 — 0.01 above the
floor — and `success` on `success-soft` is 4.57:1. Both pass, and both would
fail if the softer background were darkened. If either ever needs more room, the
tested replacement is `#92400E` (6.37:1 on `warning-soft`) / `#166534`
(6.49:1); it is not in the token set because the board does not define it.

## 6. Deliberate deviations from the board

1. **Warning budget bar uses `warning`, not `accent`.** The board paints that
   fill with saffron (`#F59E0B`), which measures **1.71:1** against the `track`
   rail and fails the 3:1 non-text floor — the bar would be nearly invisible for
   a low-vision user. `#B45309` measures **4.00:1**. Saffron stays available as
   `--color-accent` for chips, where `ink` sits on it at 8.14:1.
2. **No dark mode.** The board is light-only, so the scaffold's
   `prefers-color-scheme: dark` block was removed rather than inventing a
   palette nobody designed. If dark mode is wanted it needs its own board.
3. **Logical properties only.** The board's screens are `<html dir="ltr">` with
   an inner `dir="rtl"` wrapper and **physical** classes (26 `ml-/mr-` in the
   Arabic budget screen, zero logical ones). Copying that would make S20 a
   rewrite, so the gate rejects `ml-`, `pr-`, `left-`, `text-right` and the
   components use `ms/me/ps/pe/start/end/text-start`.
4. **Neutral utilities replaced by role tokens.** The board uses
   `bg-stone-200` / `bg-stone-100` directly. Those become `track` / `subtle`, so
   a component never names a palette.

## 7. Critique against the plan's principles (§3)

- **Honest data surfaces.** The three price states exist as three distinct token
  pairs, and the "démo" state is deliberately the *least* prominent (dashed
  border, muted text) rather than a reassuring colour. `verified` is the only
  state that may carry a date.
- **Mobile-first at 360 px.** The board draws every frame inside a 360 px
  column; the token page is asserted at 360 with no horizontal scroll.
- **RTL-safe by construction.** Enforced by the gate, not by review.
- **Keyboard and screen-reader parity.** One global `:focus-visible` rule
  (2 px, 2 px offset); controls are 48 px.
- **Tokens, not literals.** The gate fails a hex literal, a palette utility or a
  physical direction class in `app/`, `components/` and `lib/`; the only literals
  left are the provenance comments here and in `globals.css`. (`components/` was
  added in S3, when the kit moved there.)
- **Motion optional.** The reduced-motion block neutralises animation and
  transitions globally; the skeleton is a static block under that setting.
- **French copy.** The proof page is written, not generated; error copy states
  what happened and what to do.

## 8. Not in this map

- The eight S3 components (Button, TextField, Slider, ChoiceCard, Badge,
  ProgressBar, Skeleton, Alert) are BUILT — their states, geometry and
  accessibility contracts live in [COMPONENTS.md](COMPONENTS.md), and this file
  remains the only place a colour value is defined.
- The Arabic font file and its subset (S5), and the `ar` route (S20).
- Any value from the hidden screens, which are excluded by decision.
