# Phase 2 — kit and mobile primitives (execution plan)

**Goal:** the shared vocabulary every screen will consume exists, is restyled to DESIGN.md, and has been
measured before a single screen is touched. **Gate: G2.**

**Entry state:** G1 closed — 67 raw colours + 13 aliases, full type scale, Arabic +10 % leading.
Baseline: 381 specs / 379 passed / 2 skipped; CSS 89 663 B; Lighthouse LCP medians 2 485 / 2 488 ms,
CLS 0, script 158 831 / 167 107 B, performance 98.

**Budgets that bind here:** script ≤ **174 080 B**, but the preset fixture has only **6 973 B** of slack
(result has 15 249 B), so anything entering a chunk both routes share is judged at 6 973 B. LCP ≤ 2 500 ms
with ~12 ms of measured headroom.

**Rules:** one task = one commit; props APIs unchanged on existing primitives; tokens only; strings via
`messages/`; every measurement recorded in `PROGRESS.md`; a design departure is a `DEVIATIONS.md` row.

## Task ladder

| # | Task | Verification | Why here |
|---|---|---|---|
| T1 | Install `@radix-ui/react-dialog` + `class-variance-authority`; nothing imports them yet | `build`, full suite, Lighthouse — all must be **identical** to the entry baseline | An unimported dependency must cost 0 B. If it does not, the bundler is pulling it in and the G2 numbers would be lies. |
| T2 | `Sheet` on Radix Dialog, imported **only** by `/kit` | script bytes on both fixtures + axe on `/kit` | The one decision that is expensive to reverse after 8 screens import `Sheet`. If Radix costs more than the preset's 6 973 B once it reaches that route, the answer is a native `<dialog>` — decided on data, at T2, not at G4.7. |
| T3 | `StatusBadge`: build state `PASS`/`UNKNOWN` + the three price states | unit-by-render on `/kit`; axe | The vocabulary correction (A3). The v1 badge already ships `demo`/`indicative`/`verified`; only the build badge is new. |
| T4 | Restyle the nine existing primitives (`button`, `text-field`, `slider`, `progress-bar`, `skeleton`, `alert`, `badge`, `choice-card`, `choice-group`) | `check:tokens`, `typecheck`, full suite | Props APIs unchanged is the constraint; the suite is the proof, because it drives them through the real pages. |
| T5 | New primitives, batch 1: `StepHeader`, `BudgetPicker` (bounds 500…1 000 000 from `lib/wizard/model.ts`, untouched), choice-card radio | `/kit` renders each in its states; axe | Wizard-specific pieces, needed by Phase 4's first screen. |
| T6 | New primitives, batch 2: `BottomTabBar`, `StickyBar`, `BuildCard`, `PartRow`, `RetailerRow`, `SnapRow`, `TrustItem`, `ExplainerSheet` | `/kit`; axe; no horizontal scroll at 360 | The rest of the vocabulary. `BuildCard` renders the drawn fallback (D-01: no images), `RetailerRow` the reduced form (D-10). |
| T7 | `/kit` + `/tokens` rebuilt as the real gallery; add the `viewport` export (`viewport-fit=cover`) | `build`; both routes 200; axe | The gallery is how G2 is inspected by a human in the right-side browser. |
| T8 | **G2 evidence pack** | bundle table, LCP/CLS medians, axe count, screenshots fr + ar at 360, `DEVIATIONS.md` rows for the five FEASIBILITY NOs and the never-drawn wizard step | Gate G2 is presented here, not inferred from a green suite. |

## Decisions fixed before starting

- **Sheet is measured, not assumed.** Radix Dialog is used if it fits; a native `<dialog>` (with a manual
  focus trap) is the fallback, and either way the primitive's props API is the same so screens cannot tell.
- **New primitives ship with all their states** (loading, empty, error, degenerate) because Phase 4's
  definition of done requires them and retrofitting states into a shared primitive re-opens every screen.
- **`BuildCard` never waits for an image.** The fallback is drawn from tokens, so a missing image is not a
  layout shift (the CLS budget is 0, not 0.1 of room to spend).
- **The five FEASIBILITY NOs are answered here**, as `DEVIATIONS.md` rows, before any screen depends on the
  answer: per-part compatibility, images, retailer rows, price verification date, single-build GET.

## Exit criteria for G2

1. Every primitive exists, renders its states on `/kit`, and uses tokens only.
2. `typecheck`, `lint`, `check:tokens`, `check:i18n`, `build`, the full suite and axe are green.
3. The bundle table is measured on both fixtures and within 174 080 B — with the preset route's number
   named explicitly, because it is the binding one.
4. LCP and CLS re-measured; any loss of headroom stated.
5. `DEVIATIONS.md` carries the five NO answers plus the missing wizard step.
