---
name: Moroccan Hardware Studio
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#464553'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#777584'
  outline-variant: '#c8c4d5'
  surface-tint: '#544fc0'
  primary: '#1f108e'
  on-primary: '#ffffff'
  primary-container: '#3730a3'
  on-primary-container: '#a9a7ff'
  inverse-primary: '#c3c0ff'
  secondary: '#855300'
  on-secondary: '#ffffff'
  secondary-container: '#fea619'
  on-secondary-container: '#684000'
  tertiary: '#003421'
  on-tertiary: '#ffffff'
  tertiary-container: '#004d33'
  on-tertiary-container: '#2dc68d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c3c0ff'
  on-primary-fixed: '#0f0069'
  on-primary-fixed-variant: '#3b35a7'
  secondary-fixed: '#ffddb8'
  secondary-fixed-dim: '#ffb95f'
  on-secondary-fixed: '#2a1700'
  on-secondary-fixed-variant: '#653e00'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  label-sm:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 12px
    letterSpacing: 0.04em
  price-display:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 28px
    letterSpacing: -0.01em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.25rem
  gutter-mobile: 0.75rem
  margin: 2rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system serves hardware buyers, creators, students, and competitive gamers across Morocco seeking clarity in an opaque PC market. Rather than leaning into the aggressive neon-magenta "RGB gamer" tropes, the visual language establishes a grounded, warm, and highly dependable consumer advisory identity. It bridges technical precision with regional reliability, instilling absolute transparency regarding part availability, local market pricing, and physical store trust.

The aesthetic fuses modern tech minimalism with warm Maghrebi-inspired accentuation. Crisp white surfaces sit on cool, airy off-whites, balanced by authoritative deep indigo and luminous saffron highlights. Visual elements prioritize readability, touch accessibility for mobile-first shoppers navigating sprawling computer souks, and immediate clarity across dual-script interfaces (French and Arabic).

## Colors

The palette establishes technical rigor softened by welcoming warmth:

- **Primary (`#3730A3` - Deep Indigo):** Anchor color for high-emphasis actions, navigation bars, headers, and core brand identifiers. Communicates stability, institutional integrity, and computational precision.
- **Secondary (`#F59E0B` - Warm Saffron/Amber):** Dynamic accent used for savings badges, interactive micro-highlights, rating stars, and secondary callouts. It injects a warm, local cultural touchpoint.
- **Tertiary / Semantic Success (`#10B981` - Emerald Green):** Reserved exclusively for confirmed status indicators, specifically store-verified stock and vetted local merchants.
- **Neutral (`#64748B` - Slate):** Anchors secondary body text, structural divider lines, inactive states, and estimated price calculations.
- **Canvas & Surface Palette:**
  - Base Background: `#F8FAFC` (Slate 50) creates subtle ambient depth beneath white cards.
  - Surface Containers: `#FFFFFF` (Pure White) with 1px border lines (`#E2E8F0`).
- **Semantic Price Badges:**
  - *Vérifié / مؤكد:* Surface `#ECFDF5`, Border `#A7F3D0`, Text `#047857`.
  - *Indicatif / تقريبي:* Surface `#FFFBEB`, Border `#FDE68A`, Text `#B45309`.
  - *Estimé / تقديري:* Surface `#F1F5F9`, Border `#CBD5E1`, Text `#475569`.

## Typography

The typographic hierarchy prioritizes tabular number legibility, bilingual harmony, and rapid component scanning:

- **Typefaces:** **Inter** serves all Latin script implementations (French / English interfaces). For localized Arabic pages or RTL toggles, swap seamlessly to **IBM Plex Sans Arabic**, matching optical sizes and scaling line-heights up by 10% to accommodate Arabic ascenders and descenders.
- **Price Formatting Rule:** Prices must strictly format with a non-breaking thousand separator space followed by the Moroccan Dirham currency symbol: `8 594 DH` (or `8 594 د.م.` in Arabic mode). Never contract to "MAD" in end-user build builders; preserve regional consumer familiarity.
- **Tabular Figures:** All numeric listings, component spec badges, benchmark charts, and price cards must activate `font-variant-numeric: tabular-nums` to prevent horizontal jitter during filtering and total computation animations.

## Layout & Spacing

This design system uses a responsive 12-column grid layout on desktop and a continuous 4-column flow on mobile viewports:

- **Breakpoints:**
  - Mobile: `< 640px` (4 columns, `margin-mobile: 1rem`, `gutter-mobile: 0.75rem`).
  - Tablet: `640px – 1023px` (8 columns, `margin: 1.5rem`, `gutter: 1rem`).
  - Desktop: `≥ 1024px` (12 columns, max container width `1280px`, `margin: 2rem`, `gutter: 1.25rem`).
- **Touch Target Enforcements:** Any interactive surface (checkboxes, dropdown selects, quick filters, counter steppers) must strictly observe a minimum dimension of `48px` on mobile screens to facilitate comfortable single-handed operation on low-friction runs through Casablanca or Rabat tech alleys.
- **RTL Adaptive Layout:** Layout gutters, inline margins, and card splits flip symmetrically when rendering in Arabic mode without manual property recalculations.

## Elevation & Depth

To remain grounded, tactile, and distinct from sterile dark gaming apps, this system relies on soft ambient shadow dispersion layered over crisp 1px borders:

- **Surface Level 0 (Canvas):** Pure `#F8FAFC`. Zero elevation.
- **Surface Level 1 (Card Default):** `#FFFFFF` paired with an ultra-thin perimeter outline (`1px solid #E2E8F0`) and an ambient, low-contrast drop shadow: `box-shadow: 0 1px 3px 0 rgba(15, 23, 42, 0.04), 0 2px 8px -1px rgba(15, 23, 42, 0.03)`.
- **Surface Level 2 (Card Hover & Active Drag):** Lifted state for configuration cards and part items: `box-shadow: 0 8px 24px -4px rgba(55, 48, 163, 0.08), 0 2px 6px -1px rgba(15, 23, 42, 0.04)`. Border transitions to `#CBD5E1`.
- **Surface Level 3 (Sticky Bottom Bar & Modals):** Fixed interaction planes suspended over the screen use an elevated barrier: `box-shadow: 0 -4px 20px -2px rgba(15, 23, 42, 0.08)`, reinforced with an upper border of `1px solid rgba(226, 232, 240, 0.8)`.

## Shapes

The geometry balances structured technical data blocks with human, approachable corners:

- **Cards & Primary Modules:** Standardized to a uniform `16px` border-radius (`rounded-lg` in this configuration), framing component photos and spec sheets cleanly.
- **Buttons & Input Fields:** Styled with `10px` to `12px` roundedness, providing soft tactile purchase without sliding into exaggerated bubble forms.
- **Status Tags & Price Badges:** Fully rounded pill geometry (`rounded-full` / `9999px`) to create clear separation between data containers and interactive tag filters.
- **Hardware Component Preview Frames:** Standardized `12px` interior radius to nest naturally within outer `16px` cards with an equal `8px` or `12px` padding perimeter.

## Components

### Buttons
- **Primary Button:** `#3730A3` background, pure white bold text, subtle hover lift to `#312E81`. Minimum height `48px` on mobile, `44px` on desktop. Border radius `10px`.
- **Secondary Accent Button:** `#FEF3C7` background, `#92400E` text, border `1px solid #FDE68A`. Hover shifts to `#FDE68A`.
- **Ghost/Outline:** Transparent background, `1px solid #CBD5E1`, text `#334155`.

### Chips & Pill Badges
- **Semantic Verification Badges:** 
  - *Vérifié:* Height `26px`, horizontal padding `10px`, emerald pill, includes small checkmark icon, price text formatted as `8 594 DH`.
  - *Indicatif:* Amber pill, clock or pin icon, denotes crowd-sourced market price.
  - *Estimé:* Slate pill, calculates algorithmic conversion or historical estimate.
- **Filter Chips:** Pill-shaped, neutral idle (`#F1F5F9`, text `#475569`), selected active state in primary indigo (`#3730A3`, text `#FFFFFF`).

### Cards & Build Rows
- **PC Component Card:** Pure white background, 16px radius, `1px solid #E2E8F0`. Features a clear visual split: left-side hardware thumbnail, middle spec summary (socket, wattage, form-factor in `#64748B`), and right-aligned price column accompanied by merchant availability tag and single-click "Remplacer" / "Ajouter" action button.
- **Build Summary Header:** Displays cumulative power draw (Watts), compatibility indicator (Emerald status badge: "100% Compatible"), and gross sum in large bold `Inter` glyphs.

### Inputs & Selection Controls
- **Form Inputs & Dropdowns:** `48px` standard height, `#FFFFFF` fill, `#CBD5E1` border, `#0F172A` input text. On focus: ring `2px solid rgba(55, 48, 163, 0.25)` and border `#3730A3`.
- **Checkboxes & Radios:** `20px x 20px` surface, `6px` radius on checkboxes, `#3730A3` active fill with white tick.

### Sticky Bottom CTA Bar (Mobile & Builder View)
- Fixed viewport bottom container: height `76px`, background `rgba(255, 255, 255, 0.95)` with `backdrop-filter: blur(12px)`.
- Left side: Total label in `label-sm` slate text stacked above `8 594 DH` in `price-display`.
- Right side: Full-height `48px` primary action CTA ("Commander le build" / "Exporter le devis").