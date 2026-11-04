<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## The web-v2 redesign

This package is being redesigned in place (branch `web-redesign`). Before touching UI, read:

- `docs/web-v2/CONTEXT.md` — the operational state, the budgets, and the traps that have already cost time
- `docs/web-v2/AGENT.md` — the operating rules (scope, gates, verification, escalation)
- `docs/web-v2/PLAN.md` · `TOKENS.md` · `DEVIATIONS.md` · `SCREENS.md` · `FEASIBILITY.md`

Colours and type come from DESIGN.md in full; tokens live only in `app/globals.css`.

## Test viewports (S6 layout gate)

`npm test` runs four Playwright projects. **`mobile-360`** (360x800) runs the WHOLE suite: it is the
product's primary width, and every spec must pass there. **`mobile-390`** (390x844),
**`tablet-768`** (768x1024) and **`desktop-1280`** (1280x800) run ONLY the specs tagged `@layout`.

Tagged: `shell`, `wizard`, `wizard-steps`, `wizard-budget`, `result`, `saved`, `compare`, `rtl` —
the specs whose assertions can change with the viewport (breakpoint visibility, overflow, mirroring,
card geometry). Everything else is width-independent by construction and runs once, on mobile-360:
SEO/sitemap, structured data, share, legal, states, a11y, analytics, catalogue, guides, presets, kit,
i18n, inputs-applied, swap and the opt-in engine harnesses.

A spec joins the layout set by tagging its `test(` or `test.describe(`:
`test("name", { tag: "@layout" }, async ({ page }) => …)`. Tag only assertions that can actually
differ by width — a spec that navigates and reads text does not need three more runs.
