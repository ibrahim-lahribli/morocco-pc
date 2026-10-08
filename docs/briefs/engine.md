# Engine brief (authoritative for E0–E8)

You own the recommendation engine only. Read AGENTS.md §§1–9 first, then docs/ENGINE_BEHAVIOR_FINDINGS_2026-10.md. Branch: agent/engine. Neon branch: test-engine (never the shared DB). Decisions 37–42, gaps OG-39–OG-49. Do NOT edit apps/api/, database/migrations/, orchestrator/commit.js, persistence/, filtering/context-loader.js, candidates/loader.js. Need a schema change? Ask the Platform agent via a note in docs/briefs/requests.md.

## Problem (measured, see findings doc)

- use_case/resolution/priority do not change any result (Decision 17.6 ignores them).
- 12k/20k/30k MAD return the same single (CPU,GPU) pair: retention is top-5 by score (+1 cheapest), DFS stops at 25 builds on the first path, build score has no budget term, post-ranking MAX_PER_PAIR then collapses 25 -> 3.
- OFFICE is unreachable: the API derives accepted use cases from gpu_required_use_cases, the same list that makes the GPU mandatory.

## E0 — Golden scenario harness (do this first, before any engine change)

Deliverables

- scripts/eval-scenarios.js  (runs scenarios, evaluates assertions, prints a table, exit 1 on any failure)
- test/golden/scenarios.json (data only: scenarios + thresholds; editable without code changes)
- test/golden/baseline-2026-10.md (output on the UNCHANGED engine, committed)
- unit tests for the assertion evaluators (pure functions, DB-free)

Mechanics

- TEST branch only. For each scenario create a recommendation_query, run the engine through the same seam as scripts/measure-orchestrator.js (runRecommendation, no write) and evaluate the in-memory builds; delete rows in a finally and assert residue 0. Run 4 scenarios (S03, S07, S12, S16) through runRecommendationFullRun as well, to cover ranking/selection/commit.
- Clock drift is real (findings Table F): compare scores with a 1e-3 tolerance and compare signatures, not raw floats.
- Thresholds live in scenarios.json under `thresholds`. Every threshold is a HYPOTHESIS pending human review (H3): mark each with "status":"hypothesis".

Scenario matrix (inputs: use_case / resolution / priority / budget MAD)

| ID | Inputs | Purpose |
|---|---|---|
| S01 | GAMING / 1080p / 3 / 5 000 | below floor |
| S02 | GAMING / 1080p / 3 / 8 000 | near floor |
| S03 | GAMING / 1080p / 3 / 12 000 | core |
| S04 | GAMING / 1080p / 3 / 20 000 | core |
| S05 | GAMING / 1080p / 3 / 30 000 | core |
| S06 | GAMING / 1440p / 3 / 12 000 | resolution |
| S07 | GAMING / 1440p / 3 / 20 000 | resolution |
| S08 | GAMING / 1440p / 3 / 30 000 | resolution |
| S09 | GAMING / 2160p / 3 / 30 000 | resolution |
| S10 | GAMING / 1080p / 1 / 12 000 | priority (price first) |
| S11 | GAMING / 1080p / 5 / 12 000 | priority (performance first) |
| S12 | GAMING / 1080p / 1 / 20 000 | priority |
| S13 | GAMING / 1080p / 5 / 20 000 | priority |
| S14 | WORKSTATION / 1080p / 3 / 12 000 | use case |
| S15 | WORKSTATION / 1080p / 3 / 20 000 | use case |
| S16 | WORKSTATION / 1080p / 3 / 30 000 | use case |
| S17 | OFFICE / null / 3 / 4 000 | iGPU path |
| S18 | OFFICE / null / 3 / 6 000 | iGPU path |
| S19 | OFFICE / null / 3 / 10 000 | iGPU path |
| S20 | GAMING / 1080p / 3 / 7 700 | boundary at the ~7 677 cheapest assembled build |

OFFICE scenarios are expected to be unreachable on today's engine (API rejects OFFICE with 422). The harness calls the engine directly, so they run and fail for the right reason; record that in the baseline.

Assertions (all evaluated per scenario unless a cross-scenario pair is named)

| ID | Assertion | Applies to | Initial threshold |
|---|---|---|---|
| A1 | Distinct (CPU,GPU) pairs in the PERSISTED/selected set | budget >= 10 000 | >= 3 |
| A2 | Budget response: best build total_price is non-decreasing as budget rises for the same other inputs; top build spends >= X of budget | S03-S05, S06-S08 | X = 0.80 for the performance-leaning build at >= 12 000 |
| A3 | Use-case divergence: set of build signatures GAMING vs WORKSTATION at the same budget overlaps < 50%; GAMING top-build GPU share of total in [0.30, 0.50]; WORKSTATION CPU+RAM share > GAMING CPU+RAM share | S03/S14, S04/S15, S05/S16 | as stated |
| A4 | Resolution divergence: top-build GPU price at 2160p >= at 1440p >= at 1080p for the same budget; strictly greater between 1080p and 2160p at >= 20 000; selected GPU VRAM >= floor | S04/S07, S05/S08/S09 | VRAM floor 8/12/16 GB (hypothesis) |
| A5 | Priority divergence: first-ranked build total_price at priority 1 < at priority 5, and signatures differ | S10/S11, S12/S13 | strict < at >= 12 000 |
| A6 | OFFICE: no discrete GPU; chosen CPU has integrated_gpu_present = true; top-build price <= 0.40 x S03 top-build price | S17-S19 | as stated |
| A7 | Below floor: zero builds AND budget_floor present AND within_budget false | S01 | as stated |
| A8 | Determinism: same inputs twice give identical signature lists | all | scores within 1e-3 |
| A9 | Safety: no selected build has compatibility REJECT; PI-1 (npm run verify:pi1) still passes | all | as stated |

## Acceptance for E0

1. Harness is RED on the unchanged engine for A1-A6 (this proves it detects OG-38) and GREEN for A7-A9 where they already hold. Commit the baseline report.
2. Pure evaluator unit tests pass on Node 22 and the default node.
3. npm run test:unit / test:scripts / test:api baselines unchanged.
4. Do not tune any threshold to make a scenario pass. Threshold changes require a note in test/golden/CHANGELOG.md with the reviewer's name.

## Recorded deviations from this brief (2026-10-08)

- **The brief file was absent from the tree** when E0 started; this file is the brief as supplied, captured verbatim except for this section.
- **A7 corrected to the code.** The brief asks for `within_budget = false` at S01 (5 000 MAD), but `computeBudgetFloor` measures `cheapest_total = 4 477`, so `within_budget` is TRUE and the zero-build result is a compatibility limit (cheapest assemblable build 7 677 MAD). S01 now asserts `true`; a new S01b (4 000 MAD, below the floor) asserts `false`. Recorded in `test/golden/CHANGELOG.md`. The brief's "report conflicts instead of silently deviating" rule is how this was handled.
- **Neon branch.** The brief names `test-engine`; the operator chose to reuse the existing `TEST_DATABASE_URL` branch for E0. The harness only ever writes there via `scripts/lib/db-url.js`; the shared `DATABASE_URL` is never contacted.

## E1–E8 (after E0; one PR each)

E1 scoring model "launch-v2" with use_case_profiles (gpu_policy, spend_targets by role, optional role_weights override); export listUseCases(configuration) from the scoring barrel; decouple the vocabulary from gpu_required_use_cases (Decision 37 supersedes 17.6). Keep seed-minimal-v1 for reproducibility; follow docs/RECIPES/add-a-scoring-model-version.md.

E2 target-aware price-band retention (keep Decision 27 reservation + budget_floor).

E3 max_builds_per_pair quota enforced at GPU depth inside the DFS.

E4 selectArchetypes (PERFORMANCE / BALANCED / VALUE; priority sets the order; fewer than 3 distinct builds is returned honestly with a reason code). Needs recommendation_result.strategy_key from Platform migration 019.

E5 resolution: GPU spend-share multiplier + VRAM floor from gpu_chipset.vram_capacity_gb. No per-game FPS claims.

E6 OFFICE: GPU OPTIONAL with an iGPU CPU, low spend targets.

E7 pure deriveReasons() emitting reason codes (no new JSONB column).

E8 enforce OG-11 and OG-12 as HARD rules, OG-09 as a soft/CONDITIONAL rule.

## Working rules

- Every behaviour change: Decision record, gap-register row, PASS/FAIL/BLOCKED report, golden suite result table in the PR description.
- Starting spend shares (GAMING GPU ~0.38, CPU ~0.17, motherboard ~0.10, RAM/SSD/PSU/case ~0.07 each, cooler ~0.04) are hypotheses to be validated by the harness and a human reviewer, not facts.
- Report anything in this brief that conflicts with the code instead of silently deviating.
