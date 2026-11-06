# Morocco-PC V2 — design system

Source of truth for tokens: `app/globals.css` (`@theme`).
Visual source: `stitch_morocco_pc_builder_app/moroccan_hardware_studio/DESIGN.md`
and the supplied screens. Step 0 implements the direction; it does not redesign it.

## Layers

| Layer     | What it is                  | Where                                                                            |
| --------- | --------------------------- | -------------------------------------------------------------------------------- |
| Brand     | Palette exactly as designed | `--color-primary`, `--color-accent`, `--color-background`…                       |
| Semantic  | What a surface means        | `--color-foreground`, `--color-border`, `--color-verified`, `--color-indicative` |
| Component | Decisions fixed once        | `--radius-card`, `--shadow-level-1`, `--spacing-control-mobile`                  |

Components use brand tokens through semantic or named utilities only. No hex
literal appears in a component.

## Colour

| Token            | Value                                            | Use                                |
| ---------------- | ------------------------------------------------ | ---------------------------------- |
| `primary`        | `#3730A3`                                        | primary actions, active nav, brand |
| `primary-deep`   | `#1F108E`                                        | darkest brand / gradient end       |
| `primary-hover`  | `#312E81`                                        | primary hover                      |
| `primary-soft`   | `#EEF2FF`                                        | quiet icon tiles, ghost hover      |
| `accent`         | `#F59E0B`                                        | saffron highlight, FAB glyph       |
| `accent-soft`    | `#FEF3C7`                                        | secondary button fill              |
| `accent-ink`     | `#92400E`                                        | secondary button text              |
| `background`     | `#F8F9FF`                                        | page canvas                        |
| `surface`        | `#FFFFFF`                                        | cards, inputs, header              |
| `surface-muted`  | `#EFF4FF`                                        | inset panels                       |
| `surface-sunken` | `#E5EEFF`                                        | unselected chips                   |
| `foreground`     | `#0B1C30`                                        | primary text                       |
| `muted`          | `#464553`                                        | body secondary text                |
| `subtle`         | `#64748B`                                        | hints, placeholder                 |
| `border`         | `#E2E8F0`                                        | card and divider lines             |
| `outline`        | `#C8C4D5`                                        | input and outline-button borders   |
| `verified`       | text `#047857` / fill `#ECFDF5` / line `#A7F3D0` | verified price                     |
| `indicative`     | text `#B45309` / fill `#FFFBEB` / line `#FDE68A` | indicative price                   |
| `estimated`      | text `#475569` / fill `#F1F5F9` / line `#CBD5E1` | estimated price                    |
| `danger`         | `#BA1A1A`                                        | invalid field                      |

Status badges are pills (`rounded-pill`, 26 px high). Their labels always come
from the dictionary; a component never re-words a state.

## Typography

Inter for Latin, IBM Plex Sans Arabic for Arabic. Arabic gets a 1.6 body
line-height (+10 % over the Latin scale) and is applied by
`html[lang="ar"] body`.

| Utility            | Size / line / weight                    |
| ------------------ | --------------------------------------- |
| `text-display-lg`  | 40 / 48 / 700, -0.02em                  |
| `text-display`     | 30 / 38 / 700, -0.01em (mobile display) |
| `text-headline-lg` | 28 / 36 / 600                           |
| `text-headline-md` | 22 / 28 / 600                           |
| `text-headline-sm` | 18 / 24 / 600                           |
| `text-body-lg`     | 16 / 24 / 400                           |
| `text-body-md`     | 14 / 20 / 400                           |
| `text-body-sm`     | 12 / 16 / 400                           |
| `text-label-lg`    | 14 / 20 / 600                           |
| `text-label-md`    | 12 / 16 / 500                           |
| `text-label-sm`    | 10 / 12 / 600, 0.04em                   |
| `text-price`       | 24 / 28 / 700, -0.01em                  |

Prices are formatted by `lib/format/price.ts`: `8 594 DH` in French,
`8 594 د.م.` in Arabic, always with non-breaking separators and tabular figures
(`tabular-nums`).

## Spacing, radius, elevation

- Spacing tokens: `space-xs` 4, `space-sm` 8, `space-md` 16, `space-lg` 24,
  `space-xl` 40; page `margin` 32 / `margin-mobile` 16; `gutter` 20 /
  `gutter-mobile` 12; container `max-w-page` = 1280 px.
- Touch targets: 48 px on mobile (`h-12`, `spacing-control-mobile`), 44 px
  accessibility floor (`h-11`, `spacing-tap`).
- Radii: `rounded-control` 10 px (buttons), `rounded-field` 12 px (inputs,
  nested media), `rounded-card` 16 px, `rounded-sheet` 24 px, `rounded-pill`.
- Elevation: `shadow-level-1` default card, `shadow-level-2` hover/active,
  `shadow-level-3` sticky bottom bar, `shadow-fab` raised mobile action.

## Components

All shared components live in `components/ui` and are exported from its barrel.
They are plain functions with no hooks, so they render on the server.

### Button

```tsx
<Button variant="primary" size="md">Action</Button>
<Button asChild variant="outline"><Link href="/">Lien</Link></Button>
```

- `variant`: `primary` | `secondary` | `outline` | `ghost`
- `size`: `sm` (40) | `md` (48 mobile / 44 desktop) | `lg` (48) | `icon` (44)
- Defaults to `type="button"`; pass `type="submit"` explicitly.
- `asChild` puts the same geometry on a link (Radix Slot).
- Icon-only buttons require `aria-label`.

### Badge

```tsx
<Badge tone="verified">
  <Check />
  Vérifié
</Badge>
```

- `tone`: `verified` | `indicative` | `estimated` | `primary` | `neutral`
- 26 px pill; labels are props, never built in.

### Card

```tsx
<Card variant="default">
  <CardHeader>
    <CardTitle>…</CardTitle>
    <CardDescription>…</CardDescription>
  </CardHeader>
  <CardContent>…</CardContent>
  <CardFooter>…</CardFooter>
</Card>
```

- `variant`: `default` | `muted` | `elevated`
- 16 px radius, 1 px border and ambient shadow by default.

### TextField

```tsx
<TextField id="search" label="Rechercher" hint="…" error={message} leadingIcon={<Search />} />
```

- Required `id` (no hooks, server-safe) for label/description wiring.
- Emits `aria-invalid` and `aria-describedby` for the hint and error.
- `type="search"` is supported; the icon is decorative.

Feature islands (`components/demo`) compose these and own client state:

- `BudgetPicker` — Zustand preset selection, `aria-pressed`, status line.
- `SearchDemo` — React Hook Form + Zod with dictionary-supplied messages.
- `BuildCardPreview` — the build card used twice by the preview.

## RTL and logical properties

- Never use `ml/mr/pl/pr`, `left/right`, `text-left/right`, `border-l/r` or
  `rounded-l/r`. Use `ms/me`, `ps/pe`, `start/end`, `text-start/end`,
  `border-s/e`, `rounded-s/e`.
- `<html dir>` flips flex rows, grids and inline flow automatically.
- Direction-aware icons use `rtl:-scale-x-100` (see the budget CTA arrow).
- Anchor offsets use `scroll-mt-*`; the sticky header sets `scroll-padding-top`.
- Playwright asserts the mobile nav mirrors: in `/ar` the first item's x is
  greater than the last item's.

## i18n rules

- Locale prefix on every URL; French is the default.
- `useTranslations` in client islands, `getTranslations` in server components.
- Props for shared components — no `t()` calls inside `components/ui`.
- Keep `fr.json` and `ar.json` structurally identical; the unit test enforces
  key parity and matching `{placeholders}`.
- Don't concatenate translated sentences; use interpolated messages.

## Adding a component

1. Add it to `components/ui` and export it from `index.ts`.
2. Use tokens and logical properties only; keep it hook-free unless interaction
   requires otherwise (then isolate the hook in a feature island).
3. Give it a Vitest test for its accessibility contract.
4. Document its props here.
