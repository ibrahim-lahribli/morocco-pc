Superseded by: docs/ROADMAP.md on 2026-11-02

# apps/web-v2: new home page from the Stitch design

Status: draft, awaiting approval. No scaffolding or installs until approved.

## Goal

Build a new frontend for morocco-pc, starting with the home page from the Stitch export, as a
standalone project beside `apps/web`. `apps/web` keeps running unchanged. Once the new project
is reviewed and accepted, the team decides whether to replace it. That decision is out of scope.

## Design source

- `apps/web/design-v2/home-page-design/code.html`: Stitch home-page export.
- `apps/web/design-v2/home-page-design/DESIGN.md`: tokens and rules.
- `apps/web/design-v2/home-page-design/screen.png`: reference screenshot.

## Approach (chosen)

A new Next.js 16 app at `apps/web-v2/`, with its own `package.json` and lockfile. It uses the
same stack as `apps/web`: App Router, Tailwind v4, next-intl (fr/ar), Playwright, and the
generated API contract types. It keeps server rendering so the SEO surface (canonical,
hreflang, sitemap) can be reproduced.

Alternatives considered and rejected:
- Vite + React SPA: no server rendering, so the SEO surface would have to be rebuilt or dropped.
- Static HTML/CSS port: a prototype only, with no i18n, typed API client or tests.

## Export problems to fix in the build

- Tailwind loads from `cdn.tailwindcss.com`; replace with the Tailwind v4 build.
- Google Fonts and Material Symbols load from external CDNs; self-host or use `next/font`.
- Unsplash images and the logo on `lh3.googleusercontent.com`; replace with local assets.
- `.no-scrollbar` is used but not defined in the export; define it in the new `@theme`/CSS.
- The `modal-status-info` dialog needs a React equivalent (native `<dialog>` with focus handling).

## Tokens

Map `DESIGN.md` into Tailwind `@theme`: indigo primary `#3730a3`, saffron secondary, emerald
success, Inter (Latin) and IBM Plex Sans Arabic. Radii: cards 16px, buttons 10–12px, pill
badges. Touch targets 48px. Prices formatted as `8 594 DH`.

Open conflict: `DESIGN.md`'s YAML lists `primary` as `#1f108e`, while the prose says `#3730a3`.
This needs your decision before tokens are finalised. Proposed default: `#3730a3`.

## Scope (home page only)

- Header with FR/عربية switch and saved-builds count.
- Budget and usage chips, "Voir mes configurations" CTA.
- Popular-builds carousel.
- Trust block with the status dialog.
- Guides section, advisor CTA, footer.
- Bottom tab nav: Accueil, Composants, Configurer, Guides, Enregistrés (mobile).

Data: the home page reads from the existing API contract. Until the API is wired, it uses
fixtures in the same way `apps/web` does for its mock.

## Gates the new project must pass

- `typecheck`, `lint`, `build`.
- `check:tokens` (no hex literals, palette classes or physical-side classes), adapted to the new
  tokens.
- `check:i18n` for fr/ar key parity.
- Playwright: a11y (axe) and RTL specs for the home page.
- Lighthouse budget for the home page.

Repo rules: no write access to the shared Neon database from any test; read
`node_modules/next/dist/docs` before Next.js work.

## Out of scope

- Replacing or modifying `apps/web`.
- Other pages (wizard, results, components, guides, saved builds).
- Engine, database or API changes.

## Open questions for approval

1. Confirm the primary colour (`#3730a3` proposed).
2. Confirm the home page only for this pass.
