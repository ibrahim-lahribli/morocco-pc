# Phase 0 progress — web redesign

Branch `web-redesign` (created 2026-11-03 from `master` @ `e3fe882`). Plan: `PLAN.md`.
Implementation plan: `docs/superpowers/plans/2026-11-03-web-redesign-phase-0.md`.

Every row below was RUN on this machine unless it says BLOCKED. No `.env` value was read.

## Baseline 2026-11-03 (Task 2)

| Gate | Command (from `apps/web`) | Exit | Result |
|---|---|---|---|
| Typecheck | `npm run typecheck` | 0 | PASS, no output |
| Lint | `npm run lint` | 0 | PASS with **2 warnings**: `mock/server.mjs:91` unused `VARIANTS_BY_SLUG`, `postcss.config.mjs:2` anonymous default export |
| Tokens | `npm run check:tokens` | 0 | PASS — 84 files, no hex / palette utility / physical side |
| i18n | `npm run check:i18n` | 0 | PASS — 82 files, 2 catalogues, keys + placeholders identical |
| API types | `npm run check:api-types` | 0 | PASS — contract 1.10.0, 10 paths, `schema.d.ts` byte-identical |
| Build | `npm run build` | 0 | PASS. `/sitemap.xml` + `/robots.txt` `ƒ`; guides, kit, tokens, legal `●`; `ƒ Proxy (Middleware)` |
| Suite | `npm test` | 0 | **379 passed / 2 skipped, 381 specs, 35.4 s** |
| Lighthouse | `npm run test:lighthouse` | 0 | PASS — all four `error` assertions, median of 3, both fixture URLs |

**The documented suite size is stale.** `AGENTS.md` says 378 specs / 376 passed / 2 skipped. Measured
today: **381 specs, 379 passed, 2 skipped**. Three specs were added since that line was written. Any
document asserting 378 is wrong; this file records the measurement.

The two skips are by design: `e2e/wizard-browser-api.spec.ts` (needs `E2E_BROWSER_API=1`) and
`e2e/wizard-engine.spec.ts` (the opt-in real-engine harness).

## Performance headroom (the binding constraint for Phases 2-6)

Measured medians of three runs, `lighthouserc.cjs` profile (360×800, throttled mobile):

| Fixture URL | LCP (median) | CLS | Script transfer | Performance |
|---|---|---|---|---|
| `/fr/config/<threeBuilds>` | **2 482 ms** (2 342 / 2 484 / 2 482) | 0 | **158 831 B** | 98 |
| `/fr/config-pc-gamer-9000-dh` | **2 486 ms** (2 874 / 2 483 / 2 486) | 0 | **167 107 B** | 98 |

Budgets are `error`-level: LCP ≤ 2 500 ms, CLS ≤ 0.1, script ≤ 174 080 B, performance ≥ 0.90.

Two consequences, and they are not negotiable:

1. **LCP has ~18 ms of slack on both routes.** A redesign that grows the above-the-fold tree — a
   bigger hero, an extra row of cards, a web font — will fail the gate on a slow runner. Every
   screen task in Phase 4 must re-run the Lighthouse gate, and the preset page is the one to watch
   (it already sampled 2 874 ms on one run).
2. **Script has 15 249 B of slack on the result page and only 6 973 B on the preset page.** The
   preset page is the binding route. Radix Dialog + cva + any icon set added to a route that shares
   their bundle is measured against 6 973 B, not 15 249 B — which is why `PLAN.md` requires a bundle
   measurement at gate G2 before the kit lands.

## Task ledger

| Task | Status | Commit |
|---|---|---|
| 1 Stitch source + `SCREENS.md` | **done** | b4b38a9 |
| 2 Baseline record | **done** | 7da1c0c |
| 3 `FEASIBILITY.md` + `API_REQUESTS.md` | **done** | see `git log` |
| 4 `@types/node` ^22 | not started | — |
| 5 Two lint warnings | not started | — |
| 6 `@tailwindcss/turbopack` decision | not started | — |
| 7 v1 reference captures | not started | — |
| 8 Phase 0 exit record | not started | — |

## Next

Task 3 is the one that unblocks Phase 2's gate: five of its twelve answers are already verified NO or
PARTIAL (per-part compatibility, images, retailer rows, price verification date, single-build GET),
and per the gap rule each one becomes a named reduction in `DEVIATIONS.md` at G2 rather than a
blocker.
