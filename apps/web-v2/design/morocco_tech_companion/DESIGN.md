---
name: Morocco Tech Companion
colors:
  surface: '#f9f9ff'
  surface-dim: '#cddaf8'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f0f3ff'
  surface-container: '#e8eeff'
  surface-container-high: '#dfe8ff'
  surface-container-highest: '#d7e3ff'
  on-surface: '#0e1c31'
  on-surface-variant: '#474553'
  inverse-surface: '#243147'
  inverse-on-surface: '#ecf0ff'
  outline: '#787585'
  outline-variant: '#c8c4d5'
  surface-tint: '#564cc5'
  primary: '#1d008d'
  on-primary: '#ffffff'
  primary-container: '#3527a4'
  on-primary-container: '#a59fff'
  inverse-primary: '#c5c0ff'
  secondary: '#865300'
  on-secondary: '#ffffff'
  secondary-container: '#ffa51b'
  on-secondary-container: '#694000'
  tertiary: '#1f2939'
  on-tertiary: '#ffffff'
  tertiary-container: '#353f50'
  on-tertiary-container: '#a0aabf'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e3dfff'
  primary-fixed-dim: '#c5c0ff'
  on-primary-fixed: '#130067'
  on-primary-fixed-variant: '#3e31ac'
  secondary-fixed: '#ffddb8'
  secondary-fixed-dim: '#ffb961'
  on-secondary-fixed: '#2b1700'
  on-secondary-fixed-variant: '#663e00'
  tertiary-fixed: '#d9e3f9'
  tertiary-fixed-dim: '#bdc7dc'
  on-tertiary-fixed: '#121c2b'
  on-tertiary-fixed-variant: '#3d4759'
  background: '#f9f9ff'
  on-background: '#0e1c31'
  surface-variant: '#d7e3ff'
typography:
  display:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '800'
    lineHeight: 56px
    letterSpacing: -0.03em
  display-mobile:
    fontFamily: Inter
    fontSize: 34px
    fontWeight: '800'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  title:
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
    letterSpacing: 0.01em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.03em
  price-display:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '800'
    lineHeight: 28px
    letterSpacing: -0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 1rem
  margin: 2rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system drives a consumer hardware advisory and custom configuration platform built specifically for the Moroccan technology market. It merges high-utility technical precision with warm, approachable retail accessibility, guiding students, creative professionals, developers, and gamers through complex hardware decisions.

The design movement combines **Modern Tactile UI** with **Editorial Soft-Tech**:
- **Clarity over intimidation**: Translating complex compute metrics (thermals, benchmarks, socket compatibility) into intuitive, high-legibility visual summaries.
- **Warm engineering**: Cool indigo and functional white layers offset by luminous saffron-orange highlights, evoking clarity, optimism, and domestic trust.
- **Localized ergonomics**: Built from the ground up to balance dual-script French and Arabic terminology, transparent currency notations (`DH` / `MAD`), and immediate verification cues for local market logistics and availability.

## Colors

The palette establishes high semantic contrast, pristine surface hierarchy, and functional validation badges.

### Core Roles
- **Primary Indigo (`#3527A4`)**: Anchor brand color used for dominant actions, active tab states, primary CTA buttons, and critical configuration titles.
- **Deep Indigo (`#231778`)**: High-emphasis structural color for active navigation bars, footer baselines, key headers, and pressed interactive states.
- **Accent Vibrant Orange (`#FFA51A`)**: Energizing, high-visibility accent reserved for performance highlights, price-drop badges, "Best Match" flags, and critical micro-actions.
- **Soft Blue Container (`#DFE9FF`)**: Subtle background fill for highlighted spec modules, compatibility alerts, chip tags, and secondary action button states.
- **Neutral Canvas (`#F5F7FF`)**: A cool, clean slate-tinted canvas that prevents screen glare and sets a premium stage for modular cards.
- **Card Surface (`#FFFFFF`)**: Pure white containers with crisp borders that float gracefully above the slate-tinted canvas.
- **Dark Navy Text (`#152238`)**: Primary typography fill delivering maximum contrast and readability across numeric specs and Latin/Arabic script.
- **Secondary Slate Text (`#686D7C`)**: Secondary typography for hardware sub-metrics, disclaimers, and contextual hints.
- **Border Stroke (`#E2E8F0`)**: Low-contrast boundary lines reinforcing visual containment without visual clutter.

### Semantic Tints
- **Success (`#10B981`)**: Verified socket match, in-stock notice, component compatibility confirmed.
- **Warning / Bottleneck (`#F59E0B`)**: Thermal throttling risk, power supply headroom warning.
- **Destructive (`#EF4444`)**: Incompatible component, missing driver, out of stock.

## Typography

The type system prioritizes computational data clarity, crisp visual weight transitions, and cross-language parity.

- **Primary Typeface**: **Inter** handles Latin-script product names, technical specifications, and tabular performance data. `font-feature-settings: "cv02", "cv03", "cv04", "cv11", "tnum"` should be enabled by default for clean numeric alignment in price and benchmarking tables.
- **Localized Script Support**: Pair Inter with **IBM Plex Sans Arabic** as the primary font family fallback in stylesheets (`font-family: 'Inter', 'IBM Plex Sans Arabic', sans-serif;`). This preserves consistent baseline geometry and readable weight distribution across multilingual English, French, and Darija/MSA user flows.
- **Price Hierarchy**: Prices always render in tabular numerals. The currency designator (`DH` or `د.م.`) matches the label weight at 70% font size, positioned adjacent to the amount with non-breaking whitespace.

## Layout & Spacing

A disciplined 8-point base rhythm powers all grid channels and interior component spacing.

### Grid Architecture
- **Desktop (1200px and up)**: 12-column fluid grid, `margin: 2rem` (max-width bounded container at 1360px), `gutter: 1.5rem` (24px).
- **Tablet (768px – 1199px)**: 8-column fluid grid, `margin: 1.5rem`, `gutter: 1.25rem` (20px).
- **Mobile (below 768px)**: 4-column fluid grid, `margin: 1rem` (16px), `gutter: 1rem` (16px).

### Spacing Rules
- **Component Interiors**: Compact elements (badges, chips, toggles) utilize `space-xs` and `space-sm`. Standard form controls, list items, and summary rows strictly use `space-md`.
- **Card Padding**: Spec cards and config summaries use `space-lg` (24px) on desktop, shifting down to `space-md` (16px) on mobile viewports.
- **Section Separation**: Large view divisions and category steps use `space-xl` (40px) to give hardware blueprints room to breathe.

## Elevation & Depth

This system avoids heavy drop shadows, instead pairing ambient indigo-tinted drop shadows with clean border definition.

### Ambient Shadow Levels
- **Level 0 (Flat)**: Borders only (`1px solid #E2E8F0`). Used for table dividers, inactive fields, and secondary spec containers.
- **Level 1 (Subtle Rest)**: `box-shadow: 0 1px 3px 0 rgba(35, 23, 120, 0.04), 0 1px 2px -1px rgba(35, 23, 120, 0.03);` with a border stroke (`1px solid #E2E8F0`). Used for hardware item cards, comparison tiles, and neutral inputs.
- **Level 2 (Hover & Active)**: `box-shadow: 0 8px 20px -4px rgba(53, 39, 164, 0.08), 0 4px 8px -2px rgba(35, 23, 120, 0.04);` with a dynamic border transition to `#DFE9FF` or `#3527A4`. Used for interactive product cards during hover and elevated dropdown menus.
- **Level 3 (Modal / Floating Rig)**: `box-shadow: 0 20px 32px -8px rgba(35, 23, 120, 0.14), 0 8px 16px -4px rgba(35, 23, 120, 0.06);`. Used for hardware compatibility drawers, builder summaries, and fixed bottom conversion bars on mobile.

### Tactile Edge Detail
All primary action surfaces incorporate an interior micro-highlight via inset shadow: `box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.2);`, providing a crisp physical edge that sets the action apart from the background.

## Shapes

The design system uses a friendly, high-curvature shape profile (`roundedness: 2` with extended tier curves) that softens technological rigidity.

### Curvature Hierarchy
- **Base Element Radius (`0.5rem` / 8px)**: Inputs, dropdown items, filter checkboxes, and hardware metric pills.
- **Button & Chip Radius (`0.75rem` / 12px)**: Primary CTAs, secondary action triggers, and filter chips.
- **Card & Sheet Radius (`1rem` to `1.5rem` / 16px to 24px)**: Component containers, product recommendation tiles, and wizard steps use `rounded-2xl` (24px) on desktop to establish a tactile, modern handheld aesthetic.
- **Badge & Status Radius (`9999px`)**: Full pill shape reserved strictly for status chips, stock counters, compatibility verifications, and pricing indicators.

## Components

### Buttons
- **Primary Action**: Deep-indigo to primary gradient or solid Indigo `#3527A4` fill, text `#FFFFFF`, radius 12px. Minimum height: 48px. Includes top inset highlight (`inset 0 1px 0 rgba(255,255,255,0.2)`) and micro active-press state (`transform: scale(0.98)`).
- **Secondary Action**: Background `#DFE9FF`, text `#231778`, border `1px solid transparent`. Hover shifts background to `#D0E0FF`.
- **Accent Action**: Background `#FFA51A`, text `#152238` with heavy 700 weight. Used strictly for "Add to Rig", "Buy Now", or final configuration checkout.

### Cards & Hardware Tiles
- **Structure**: Background `#FFFFFF`, border `1px solid #E2E8F0`, radius 24px (`rounded-2xl`), elevation Level 1.
- **Hover Transition**: Elevates to Level 2 with border transition to `#3527A4`.
- **Internal Content Rhythm**: Header row contains category badge + compatibility status; middle area contains high-contrast hardware imagery on neutral `#F5F7FF` framed thumb; footer anchors full price and spec tag array.

### Badges & Compatibility Indicators
- **Verified Match**: Pill badge with background `#ECFDF5`, text `#065F46`, paired with an explicit emerald checkmark icon.
- **Warning / Check Needed**: Pill badge with background `#FFFBEB`, text `#92400E`.
- **Hardware Spec Badge**: Subtle capsule with background `#F5F7FF`, border `1px solid #E2E8F0`, text `#152238`, font size 12px.

### Moroccan Price Tags
- **Style**: Displayed in prominent tabular typography. Text `#152238` with secondary Dirham suffix `#686D7C`.
- **Best Price Variant**: Wrapped in a pill container with background `#FFF7ED`, border `1px solid #FFEDD5`, text `#C2410C`.

### Form Controls & Inputs
- **Text Inputs**: Height 44px, radius 8px, background `#FFFFFF`, border `1px solid #E2E8F0`, text `#152238`. Focus state introduces a crisp `2px solid #3527A4` ring offset with `2px` transparent space.
- **Checkboxes & Radios**: 20px box with 6px radius. Checked state fills with `#3527A4` displaying a crisp white SVG check.

### Selection Chips & Filter Pills
- **Inactive**: Background `#FFFFFF`, border `1px solid #E2E8F0`, text `#686D7C`.
- **Selected**: Background `#3527A4`, text `#FFFFFF`, border `1px solid #3527A4`. Includes tactile shadow.

### Onboarding & Diagnostic Steps
- **Progress Track**: 4px slim bar with neutral `#E2E8F0` track and `#FFA51A` active fill.
- **Step Containers**: Card surface featuring gentle illustrative hardware icons, plain-language usage queries (e.g., "Architecture 3D", "Esports Gaming 144Hz"), and instant price range feedback in MAD.