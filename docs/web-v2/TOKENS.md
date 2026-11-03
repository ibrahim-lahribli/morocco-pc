# TOKENS.md — the token map, with measured contrast

Source: `apps/web/design/stitch/moroccan_hardware_studio/DESIGN.md` (the Stitch design system) and
the 22 screen exports. Implementation: the `@theme` block in `apps/web/app/globals.css`, which is the
only file allowed a raw colour (`scripts/check-tokens.mjs` scans `app/`, `components/`, `lib/` and
never that file).

Every ratio below was **measured** with the WCAG 2.x relative-luminance formula on 2026-11-03, and the
same pairs are asserted at build time by `apps/web/e2e/tokens.spec.ts` (15 text pairs at ≥ 4.5:1, 3
graphical pairs at ≥ 3:1). Nothing here is quoted from the design file; where DESIGN.md and AA
disagree, AA wins and the deviation is in `DEVIATIONS.md`.

## 1. Colour roles

Names are unchanged from the existing token set (v5 rule A6: values change, names do not), so no
component needs an edit for a Phase 1 value change.

| Token | Value | Role |
|---|---|---|
| `--color-primary` | `#3730A3` | high-emphasis actions, links, focus ring |
| `--color-primary-hover` | `#312E81` | pressed/hover of primary |
| `--color-primary-soft` | `#EEF2FF` | tinted surface behind primary content |
| `--color-accent` | `#F59E0B` | saffron highlight, savings/labels — **never a text background for white** |
| `--color-accent-soft` | `#FEF3C7` | the accent's tinted surface |
| `--color-whatsapp` | `#075E54` | the WhatsApp share affordance |
| `--color-page` | `#F8FAFC` | canvas (DESIGN.md `surface` / `background`) |
| `--color-surface` | `#FFFFFF` | cards, sheets, bars |
| `--color-subtle` | `#F1F5F9` | inset rows, hover fills on surface |
| `--color-track` | `#E2E8F0` | dividers, slider track, card border |
| `--color-muted` | `#475569` | secondary body text |
| `--color-ink` | `#0B1C30` | primary text |
| `--color-placeholder` | `#64748B` | input placeholder text |
| `--color-success` / `-soft` | `#15803D` / `#DCFCE7` | verified status, success text |
| `--color-warning` / `-soft` | `#B45309` / `#FEF3C7` | indicative price, caution |
| `--color-error` / `-soft` | `#B91C1C` / `#FEE2E2` | validation, failure |
| `--color-info` / `-soft` | `#1D4ED8` / `#DBEAFE` | neutral notice |

Aliases (`--color-background`, `-foreground`, `-border`, `-ring`, `-verified`, `-warn`, `-danger`)
are `var()` references and are not counted by the token gate.

**The neutral ramp changed from stone to slate** (`#FAFAF9/#F5F5F4/#E7E5E4/#57534E/#1C1917` →
`#F8FAFC/#F1F5F9/#E2E8F0/#475569/#0B1C30`). The previous ramp came from the earlier board; DESIGN.md's
canvas is `#F8FAFC` (slate-50) with `#0B1C30` on-surface, and a redesigned card on a stone canvas
would sit on the wrong grey. Contrast improved or held on every pair.

## 2. Measured contrast (the pairs the suite asserts)

| Pair | Ratio | Verdict |
|---|---|---|
| ink on page | 16.41:1 | AAA |
| ink on surface | 17.17:1 | AAA |
| muted on page | 7.24:1 | AAA |
| muted on surface | 7.58:1 | AAA |
| muted on subtle | 6.92:1 | AAA |
| surface on primary (button label) | 9.93:1 | AAA |
| primary on page | 9.49:1 | AAA |
| surface on primary-hover | 11.42:1 | AAA |
| surface on whatsapp | 7.67:1 | AAA |
| success on success-soft | 4.57:1 | AA |
| warning on warning-soft | 4.51:1 | AA (thinnest pair in the set) |
| error on error-soft | 5.30:1 | AA |
| info on info-soft | 5.49:1 | AA |
| **ink on accent** | **8.00:1** | AAA |
| primary fill on track (UI) | 8.06:1 | passes 1.4.11 |
| warning fill on track (UI) | 4.07:1 | passes 1.4.11 |
| primary ring on page (UI) | 9.49:1 | passes 1.4.11 |

## 3. The three decisions the design file gets wrong for the web

1. **An amber CTA cannot carry white text.** `#FFFFFF` on `#F59E0B` measures **2.15:1** — a fail at
   any size. Amber is a surface for **ink**: `#0B1C30` on amber measures **8.00:1**. So the CTA
   treatment is amber fill + ink label, and white-on-amber is forbidden in the kit.
2. **`#10B981` (DESIGN.md "tertiary / success") cannot be text.** On white it measures **2.54:1**, on
   its own `#ECFDF5` tint **2.41:1**. It stays a **fill/icon** colour only; success *text* uses
   `#15803D` (4.57:1 on `#DCFCE7`).
3. **`#64748B` as body text is a bare pass.** DESIGN.md's "Neutral" is 4.55:1 on the canvas — one
   rounding away from failing, across 105 `text-muted` usages. `text-muted` is `#475569` (7.24:1);
   `#64748B` is used only for placeholder text (4.55:1).

## 4. Price-badge states — mapped, not added

DESIGN.md defines three price badges. They map onto existing triples, so **no new colour token is
needed** and the gate's pinned count stays 21:

| State | Text on surface | Ratio | Tokens |
|---|---|---|---|
| Vérifié / مؤكد | `#15803D` on `#DCFCE7` | 4.57:1 | `success` / `success-soft` |
| Indicatif / تقريبي | `#B45309` on `#FEF3C7` | 4.51:1 | `warning` / `warning-soft` |
| Estimé / تقديري | `#475569` on `#F1F5F9` | 6.92:1 | `muted` / `subtle` |

This third state is the existing `demo` provenance (`lib/result/model.ts`), which the redesign keeps.

## 5. Type scale, radii, spacing, elevation

The scale is **unchanged** in Phase 1 — see `DEVIATIONS.md` D-04 for the delta against DESIGN.md and
why it moves per screen in Phase 4 instead of globally now.

| Token | Size | Line height |
|---|---|---|
| `--text-display` | 30 px | 1.25 |
| `--text-heading` | 24 px | 1.25 |
| `--text-title` | 20 px | 1.25 |
| `--text-subtitle` | 18 px | 1.375 |
| `--text-body` | 16 px | 1.5 |
| `--text-compact` | 14 px | 1.43 |
| `--text-caption` | 12 px | 1.33 |
| `--text-micro` | 11 px | 1.45 |

Radii: `--radius-control` 8 px, `--radius-card` 12 px (DESIGN.md asks 16 px — D-06), pill 9999.
Elevation: two ambient shadows, borders carry the structure. Spacing: `--spacing-control` 48 px,
`--spacing-tap` 44 px (the accessibility floor; DESIGN.md asks 48 px for every interactive surface —
the 44 px floor is the shipped rule, and Phase 2 enforces it).

## 6. Fonts (unchanged on purpose)

`--font-sans` is Inter via `next/font`; `--font-arabic` is the **vendored** IBM Plex Sans Arabic
(`@font-face` + `unicode-range` + an `ar`-only preload in the layout). It is not `next/font` because
that measured 136 KB of unused Arabic on every `/fr` page (206 KB of fonts total). `--font-mono` is
Geist Mono with `preload: false`. Phase 1 changes no font.
