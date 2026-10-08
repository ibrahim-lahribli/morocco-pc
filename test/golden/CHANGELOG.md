# Golden scenario threshold changelog

Every change to a threshold in `test/golden/scenarios.json` while the harness is
RED must be recorded here with the reviewer's name. Tuning a threshold to make a
failing scenario pass is forbidden (docs/briefs/engine.md, E0 acceptance 4).

| Date | Threshold | From -> To | Reviewer | Reason |
|---|---|---|---|---|
| 2026-10-08 | `A7_within_budget` | (brief literal: `false` @ S01/5000) -> corrected to per-case `true` @ S01 and `false` @ S01b | Human reviewer (brief conflict resolution, 2026-10-08) | The brief's A7 asked for `within_budget = false` at S01 (5000 MAD), but the engine's `computeBudgetFloor` measures `cheapest_total = 4477` so `within_budget` is TRUE there: the zero-build result is a compatibility limit (cheapest assemblable build is 7677 MAD), not a budget shortfall. S01 now asserts the real semantics and S01b (4000 MAD, below the 4477 floor) exercises the true sub-floor path. No threshold was relaxed to hide a defect. |
