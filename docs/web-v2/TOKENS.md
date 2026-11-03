# TOKENS.md — DESIGN.md, adopted in full

Source: `apps/web/design/stitch/moroccan_hardware_studio/DESIGN.md`. Implementation: the `@theme`
block in `apps/web/app/globals.css` — the only file allowed a raw colour (`scripts/check-tokens.mjs`
scans `app/`, `components/`, `lib/` and never that file).

**Counts: 67 raw colours + 13 `var()` aliases.** `e2e/tokens.spec.ts` pins that count and asserts
29 text pairs at ≥ 4.5:1 and 5 graphical pairs at ≥ 3:1. Every ratio below was measured on
2026-11-03; the suite prints the live figures on every run.

## 1. Why the ramp, not the prose palette

DESIGN.md contains **two** palettes: a Material-style tonal ramp (the front-matter YAML, 47 colours)
and a prose brand section (19 colours). Measured before choosing:

- **The ramp's `on-X` / `X` pairs all pass AA**, 4.54–16.34:1. It is a tonal system designed to be
  legible, and `on-secondary-container` on `secondary-container` (4.60:1) is the design's own
  accessible answer where the prose's white-on-amber is 2.15:1.
- The prose section supplies brand *identity* (indigo, saffron, emerald) but three of its pairings
  fail: white on amber 2.15:1, emerald as text 2.54:1, emerald on its own tint 2.41:1.

So: **the ramp is the system**, the prose supplies the accents and the three price states, and any
text that the prose would put at < 4.5:1 uses the ramp's container pair instead. That is adopting
everything the design defines — including its accessible alternatives — without shipping illegible
text.

## 2. The ramp (47 raw)

| Group | Tokens |
|---|---|
| Surface | `surface-dim` `surface-bright` `surface-container-lowest` `-low` `-container` `-high` `-highest` `surface-variant` `inverse-surface` |
| On-surface | `on-surface` `on-surface-variant` `on-background` `inverse-on-surface` |
| Primary | `primary` `on-primary` `primary-container` `on-primary-container` `inverse-primary` `primary-fixed` `primary-fixed-dim` `on-primary-fixed` `on-primary-fixed-variant` `surface-tint` |
| Secondary | `secondary` `on-secondary` `secondary-container` `on-secondary-container` `secondary-fixed` `secondary-fixed-dim` `on-secondary-fixed` `on-secondary-fixed-variant` |
| Tertiary | `tertiary` `on-tertiary` `tertiary-container` `on-tertiary-container` `tertiary-fixed` `tertiary-fixed-dim` `on-tertiary-fixed` `on-tertiary-fixed-variant` |
| Error | `error` `on-error` `error-container` `on-error-container` |
| Structure | `outline` `outline-variant` `background` |

## 3. Brand + money states (20 raw)

`accent` `#F59E0B` · `emerald` `#10B981` · `whatsapp` `#075E54` · `muted` `#475569` ·
`placeholder` `#64748B` · `success`/`success-soft` · `warning`/`warning-soft` · `info`/`info-soft`,
plus nine `price-*` tokens — one trio per money state:

| State | Text on surface | Ratio |
|---|---|---|
| Vérifié / مؤكد | `#047857` on `#ECFDF5` | 5.21:1 |
| Indicatif / تقريبي | `#B45309` on `#FFFBEB` | 4.84:1 |
| Estimé / تقديري | `#475569` on `#F1F5F9` | 6.92:1 |

## 4. Aliases (13, not counted)

The names every component already uses keep working, so a value change needs no component edit:
`page`→`background`, `ink`→`on-surface`, `subtle`→`surface-container-low`,
`track`→`outline-variant`, `primary-soft`→`primary-fixed`,
`primary-hover`→`on-primary-fixed-variant`, `accent-soft`→`secondary-fixed`,
`foreground`→`on-surface`, `border`→`outline-variant`, `ring`→`primary`,
`verified`→`success`, `warn`→`warning`, `danger`→`error`.

**One naming reconciliation** (D-12): the app's `surface` means *card* (`#FFFFFF`, the ramp's
`surface-container-lowest`), while the ramp's `surface` is `#F8F9FF` — identical to `background`.
Keeping `surface` as the card name is what lets 96 existing usages stand; the ramp's value is
available as `background`.

## 5. Measured contrast (the suite's pairs)

| Pair | Ratio |
|---|---|
| on-surface on surface | 16.34:1 |
| on-surface on surface-container-lowest | 17.06:1 |
| on-surface on background | 16.34:1 |
| on-surface-variant on surface | 7.58:1 |
| on-surface-variant on surface-variant | 7.29:1 |
| on-primary on primary | 13.79:1 |
| on-primary-container on primary-container | 4.57:1 |
| on-secondary on secondary | 6.49:1 |
| **on-secondary-container on secondary-container** | **4.60:1** (the accessible amber pairing) |
| on-tertiary on tertiary | 13.88:1 |
| on-tertiary-container on tertiary-container | 4.54:1 |
| on-error on error | 6.46:1 |
| on-error-container on error-container | 7.24:1 |
| on-background on background | 16.34:1 |
| on-primary-fixed / on-secondary-fixed / on-tertiary-fixed | 13.26 / 13.34 / 13.22:1 |
| inverse-on-surface on inverse-surface | 13.14:1 |
| **on-surface on accent** | **8.00:1** |
| price-verified / indicative / estimated | 5.21 / 4.84 / 6.92:1 |
| success / warning / info on their soft tints | 4.57 / 4.51 / 5.49:1 |
| muted on surface · muted on container-lowest | 7.58 / 7.87:1 |

Graphical (≥ 3:1): primary on surface 13.79 · primary-container on surface 9.93 · error on surface
6.46 · surface-tint on surface 5.66 · primary on container-low 12.36.

**Forbidden, measured:** white on `accent` (2.15:1) and `emerald` as text (2.54:1). Amber is a
surface for `on-surface`; emerald is fill/icon only.

## 6. Type scale — the design's, in full

Mobile-first: the base token is the design's **mobile** size; `display-lg` is the desktop step, used
from `md:` up.

| Token | Mobile | Line height (fr) | Line height (ar, +10 %) |
|---|---|---|---|
| `text-display-lg` | 40 px | 48 px | 52.8 px |
| `text-display` | 30 px | 38 px | 41.6 px |
| `text-heading` | 28 px | 36 px | 39.6 px |
| `text-subtitle` | 22 px | 28 px | 30.8 px |
| `text-title` | 18 px | 24 px | 26.4 px |
| `text-body` | 16 px | 24 px | 26.4 px |
| `text-compact` | 14 px | 20 px | 22 px |
| `text-caption` | 12 px | 16 px | 17.6 px |
| `text-micro` | 10 px | 12 px | 13.2 px |
| `text-price` | 24 px | 28 px | 30.8 px |

Weights and tracking follow DESIGN.md: display/price 700 with −0.01/−0.02 em, heading 600, subtitle 600,
title 600, micro 600 at +0.04 em. Arabic leading is applied by overriding the `--text-*--line-height`
variables on `html[lang="ar"]`, so every step moves at once rather than component by component.

## 7. Radii, elevation, spacing

Radii: `sm` 4 px, `control` 10 px (buttons/inputs), `md` 12 px, `card` **16 px**, `xl` 24 px (sheets),
`pill`. Elevation: three levels from DESIGN.md — card 1 (ambient 0 1 3 + 0 2 8), card 2 (lifted,
tinted indigo), bar (the sticky bottom bar's 0 −4 20). Spacing: `gutter` 20 px, `gutter-mobile` 12 px,
`margin` 32 px, `margin-mobile` 16 px, `control` 48 px, `tap` 44 px.

## 8. Fonts (unchanged)

`--font-sans` Inter via `next/font`; `--font-arabic` the **vendored** IBM Plex Sans Arabic with an
`ar`-only preload (converting it to `next/font` measured 136 KB of unused Arabic on every `/fr`);
`--font-mono` Geist Mono, `preload: false`.
