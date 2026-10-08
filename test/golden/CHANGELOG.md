# Golden scenario threshold changelog

Every change to a threshold in `test/golden/scenarios.json` while the harness is
RED must be recorded here with the reviewer's name. Tuning a threshold to make a
failing scenario pass is forbidden (docs/briefs/engine.md, E0 acceptance 4).

| Date | Threshold | From -> To | Reviewer | Reason |
|---|---|---|---|---|
| 2026-10-08 | `A7_within_budget` | (brief literal: `false` @ S01/5000) -> corrected to per-case `true` @ S01 and `false` @ S01b | Human reviewer (brief conflict resolution, 2026-10-08) | The brief's A7 asked for `within_budget = false` at S01 (5000 MAD), but the engine's `computeBudgetFloor` measures `cheapest_total = 4477` so `within_budget` is TRUE there: the zero-build result is a compatibility limit (cheapest assemblable build is 7677 MAD), not a budget shortfall. S01 now asserts the real semantics and S01b (4000 MAD, below the 4477 floor) exercises the true sub-floor path. No threshold was relaxed to hide a defect. |
| 2026-10-08 | `A7_within_budget` | REMOVED | Operator instruction (docs/briefs/engine.md, E0 fixes item 4) | A7's expectation is now computed at run time as `within_budget === (budget >= cheapest_total)`, so the stored threshold is unnecessary. Removal is not tuning: no expected outcome was relaxed. |
| 2026-10-08 | `S01b.budget` | literal `4000` -> `budget_factor_of_floor` 0.85 (resolves to 3805 against the measured 4477 floor) | Operator instruction (E0 fixes item 4) | Keep S01b strictly BELOW the floor without hard-coding a number that could cross the floor when the catalog changes. |
| 2026-10-08 | `A2b_gpu_price_growth_min` | ADDED (new threshold, value 1.3) | Operator instruction (E0 fixes item 1) | New assertion A2b; this is not a change to an existing threshold. It was expected RED but MEASURES PASS (rank-1 GPU price genuinely grows 3200 -> 11500), so it is kept as measured and never tuned. |
