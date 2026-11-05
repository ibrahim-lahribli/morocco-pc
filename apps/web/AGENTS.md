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

Colours and type come from DESIGN.md; tokens live only in `app/globals.css`. Two pieces are NOT
carried — `space-xs…xl`, `label-lg`/`label-md` — see `TOKENS.md` §9.

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
differ by width — a spec that navigates and reads text does not need three more runs. Never write a
project or spec total into prose: `npx playwright test --list` prints the current truth.
## Lighthouse scripts

`npm run test:lighthouse` runs the ENFORCED budgets (`lighthouserc.cjs`: CLS 0.1, script
174 080 B, `categories:performance` 0.90, all `error`, median of three, two fixture URLs) and
needs `npm run build` first; the harness starts the app on 3210 and the fixture mock on 3211
itself and refuses a busy port. Its LCP assertion is a `warn` since 2026-11-05 (D-29), so the
run still exits 0 when only LCP misses.

`npm run test:lighthouse:devtools` measures the same two URLs under
`throttlingMethod: "devtools"` (`lighthouserc.devtools.cjs`), asserting LCP <= 2500 ms as `error`
inside that config, and writes `.lighthouseci-devtools/`. It is NON-BLOCKING in CI (its job is
`continue-on-error`) until the promotion rule in that config's header is met — read its LCP
rather than treating a red run as a regression.
