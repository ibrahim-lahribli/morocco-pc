# Engine brief (authoritative for E0–E8)

You own the recommendation engine only. Read AGENTS.md §§1–9 first, then docs/ENGINE_BEHAVIOR_FINDINGS_2026-10.md. Branch: agent/engine. Neon branch: test-engine (never the shared DB). Decisions 37–44, gaps OG-39–OG-49. Do NOT edit apps/api/, database/migrations/, orchestrator/commit.js, persistence/, filtering/context-loader.js, candidates/loader.js. Need a schema change? Ask the Platform agent via a note in docs/briefs/requests.md.

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

## E0 fixes — recorded deviations (2026-10-08, Step 1)

- **Exit codes are DISPOSITION-based, not status-based (item 2).** Every assertion now declares an expectation `status`: `hypothesis` (default, unreviewed), `approved` (requires `reviewer` + `reviewed_on`) or `waived` (also a `reason`). A `hypothesis` failure reports EXPECTED-RED and does NOT exit 1; only an `approved` failure — or an escalated UNKNOWN — is a HARD FAIL. This SUPERSEDES E0 acceptance 1's "exit 1 on any failure": the harness is still RED on the unchanged engine, but exits 0 because every failure is an unreviewed hypothesis. Implemented as specified, not deferred.
- **A2b was expected RED but MEASURES PASS (item 1).** The new assertion (rank-1 GPU price at 30000 >= 1.3x at 12000; S03/S05 and S06/S08) does not detect OG-38 as anticipated: the rank-1 GPU price genuinely grows with budget (3200 -> 11500, ratio 3.59), so A2b PASSes. The threshold was NOT tuned to force RED. A2 and A2b are therefore GREEN controls.
- **UNKNOWN escalation field (item 3).** S17/S18 (OFFICE, 0 builds) declare `expect_builds_after: "E6"`; with `current_epic: "E1"` their UNKNOWN stays pending. Once the named epic lands, ANY UNKNOWN on such a scenario becomes a HARD FAIL (E0c item 2a broadened this from "a no-build UNKNOWN").
- **A7 computes its expectation at RUN TIME (item 4).** `within_budget` must equal `(budget >= cheapest_total)`; S01b's budget is 0.85 x the measured floor (3805), not a literal. The `A7_within_budget` threshold is removed.
- **A8 order-sensitive flake (new finding, OG-41).** A8 compares ranked signature lists ORDER-SENSITIVELY while ranking orders by 2-dp-rounded `build_score`, so a raw score on a .005 boundary can reorder two near-equal builds under the ~1e-5 clock drift between two consecutive passes. A8 S09 is therefore intermittently RED on an unchanged engine. Reported, not silenced.
- **Baseline gains observed metrics and a floor note (items 5/7).** Every scenario's observed metrics are now printed, and an informational "engine floor vs cheapest assembled build" section records 4477 vs 7677 (the sub-8000 zero-builds-with-`within_budget`-true mismatch, gap OG-40, closed 2026-10-29 → C-45).

## E0c — golden harness hardening (2026-10-08, Step 2)

- **UNKNOWN escalation is now "any UNKNOWN once the epic lands" (item 2a).** `rowEscalation` previously escalated only when the scenario's artifact had `build_count === 0`; it now escalates ANY UNKNOWN row whose scenario's `expect_builds_after` epic has LANDED, because a landed epic means the harness should be able to judge the row (a row can be UNKNOWN for reasons other than an empty build set, e.g. no selected build carries a GPU). Both cases are unit-tested.
- **Preflight asserts exactly ONE active scoring model by COUNT, not `LIMIT 1` (item 2b).** `LIMIT 1` silently accepted a second active row; the eligibility flag must be unambiguous because the pinned-id loader fails fast on an inactive row.
- **Every THRESHOLD entry is validated (item 2c).** Threshold entries require an explicit status (no missing-status default) and go through the same `validateExpectation` contract as assertions: `status` must be `hypothesis`/`approved`/`waived`, and `approved`/`waived` require `reviewer` + `reviewed_on` (`waived` also a `reason`); otherwise the evaluator THROWS.
- **Volatile observations are separated from the committed baseline (item 2d).** A8's clock-drift `max_score_delta` and the offer-freshness instant move to a non-committed sidecar (`test/golden/*.volatile.json`, gitignored); the freshness instant is reported as ISO, not `Date.toString()`. The sidecar preserves full assertion rows; console/JSON results and exit dispositions still include them. Stable metrics and assertions remain committed; this does not change the engine clock or guarantee ranks never change as data ages.

## E0d — reviewer-readable baseline and read-only findings (2026-10-08)

- **E0d regeneration observation:** the unchanged engine's 30k rank-1 builds (S05/S08/S09/S16) now pick CoreLiquid A13 360 instead of MYSTIQUE 360; total falls 24444 -> 24044 MAD, GPU share rises 47.05% -> 47.83%, GPU stays 11500 MAD, and A2/A2b still PASS. This is actual clock-sensitive rank movement, not caused by adding identity columns. Removing A8 drift from the committed table does NOT make rank-1 metrics immune to ageing. The golden generation did not embed PI-1, so its sidecar A9 row remains UNKNOWN; the separate requested PI-1 rerun PASS is reported independently.
- **Baseline identities:** every observed-metrics row now includes rank-1 CPU, GPU and CPU cooler product names and their exact Stage 1 selected prices, plus total and GPU share. No-build rows show `-`, never an invented component or zero price. GPU names identify the product, not a variant label; canonical signatures still distinguish variants. Thresholds and engine behaviour are unchanged.
- **UNKNOWN rule (accepted E0c, not a new engine Decision):** once a scenario's `expect_builds_after` epic has landed, ANY UNKNOWN assertion involving it is a hard FAIL, including non-empty build sets. Before the epic lands it remains UNKNOWN. The E0c full CLI's UNKNOWN count rose from 2 to 3 only because the suite-level A9 PI-1 check was not run; no scenario changed. S17/S18 remained no-build UNKNOWNs. The separate E0d PI-1 rerun PASSed, exit 0, no drift for GAMING/OFFICE and verified cleanup.
- **OG-41 classification:** differing transaction-clock inputs, not random ranking/DFS nondeterminism. Fixed-clock repeated runs and reversed SQL rows were identical; reversing the build array preserved ranks. A 1 ms change across a half-cent score rounding boundary changed ranks 3/4 and 8/9 in S09 while preserving the DFS signatures. The raw deltas were about -3e-9, but rounded score DESC then price ASC changes which build wins. This can affect the diversity-selected set and is not necessarily presentation-only. No engine fix is implemented.
- **E2 evidence, not E2 implementation:** S03 and S06 retain the same five candidates per role and fill the 25-build cap within one Ryzen 9 5950X/B550M PRO-VDH/8GB DDR4/RTX 4060/RM850e prefix. RTX 5060 and 5060 Ti variants exist and are eligible but lose score-driven slots; UNKNOWN dimensions do not exclude them. One RTX 5070 (GAMING TRIO, 9000 MAD) IS retained; the other 5070s lose on score. Four GPU slots are 9000–16490 MAD and the fifth is the 3200 MAD cheapest reservation, leaving the 4990–7999 MAD middle band absent. Price-band retention is justified for this coverage gap, but cannot by itself prove better builds or solve capped-DFS starvation. This paragraph is the PRE-E2 evidence that motivated the epic; E2 landed 2026-10-09 (Decision 39) and the coverage gap it names is tracked as OG-43. E3 landed 2026-10-10 (Decision 40: the optional `candidate_caps.max_builds_per_pair` quota, enforced inside the DFS), which answers the capped-DFS starvation half; what remains open is the quota VALUES themselves, tracked as OG-44 (closed 2026-10-29 → C-47 as RETIRED: seed 017 deletes the three experiment models and no live model declared a quota then; the canonical line's resulting A1 diversity debt is OG-55, which 2026-10-30 seed 020 measures launch-v2@2.2.0 against at 13 of 15 A1 rows).
- **Activation plan corrected:** `docs/OG-39_ACTIVATION_PLAN.md` now describes two-active and single-active cases. Explicit name/version pins still require an active model. Dropping a preflight predicate does NOT make inactive v1 executable. The TEST schema has no single-active constraint; the shared database was not inspected.

### Clock inventory: actual inputs versus parsing/metadata

| Location | Time source/operation | Effect |
|---|---|---|
| `orchestrator/run.js:147,192` | SQL `CURRENT_TIMESTAMP AS now`; `new Date(value)` parses that value | The ONLY scoring clock in the composed run, threaded as `nowMs` into candidate scores, build scores and contributions. A bare-client run gets a new transaction time per SELECT; the full-run snapshot stabilises it per transaction, not across runs. |
| `scoring/effective-score.js` | injected `nowMs - assessed_at`, real-valued days, linear `staleness.per_day_decay` | Assessment ageing/decay, NOT offer ageing. Both STEP 2 and STEP 3 consume this formula. No `Date.now()` or zero-argument `new Date()` in pure scoring. |
| `scoring/load-assessments.js:80,138,160` | SQL `CURRENT_TIMESTAMP AS loaded_at`; Date parsing for assessed/loaded timestamps | Metadata clock and parsing. `loaded_at` does NOT feed scoring in `runRecommendation`; its separate timestamp wins. The header suggesting otherwise is stale prose. |
| `offers/select.js:80,86,156,174,311` | SQL transaction timestamp as `price_checked_at` and 30-day cutoff; Date parsing | Offer freshness/eligibility and price decision metadata. Not an arithmetic score penalty. The seed waiver bypasses the cutoff only for eligible SEED offers. |
| `assembly/prices.js:70`, `persistence/validate-selected.js:39`, API date parsing | `new Date(suppliedValue)` | Canonicalisation/validation, no new clock read. |
| `scripts/eval-scenarios.js` | SQL `NOW()` preflight; zero-argument Date for report date/sidecar generation | Informational offer freshness and output timestamps, not scoring input. |
| `ingestion/apply.js`, `ingestion/listings.js` | SQL `now()` audit stamps; parsing caller `options.now`/observed times | Ingestion lifecycle, outside recommendation scoring. Stored assessments/offers still affect future DB state. |

### E2-pre — Decision 38 explicit asOf (IMPLEMENTED 2026-10-08)

Interface: `runRecommendation({ db, queryId, options: { asOf: ISO } })` and
`runRecommendationFullRun(client, queryId, { asOf: ISO })`; the snapshot wrapper forwards
the same options. Absent keeps legacy SQL/params/output; explicit time replaces the score
clock and offer cutoff/price decision timestamp. No Platform-owned implementation file edited.

Clock audit (executable SQL locations, ownership):
- `src/recommendation/orchestrator/run.js:147` (before this change): scoring `CURRENT_TIMESTAMP AS now`, **Engine**; bypassed when asOf is present.
- `src/recommendation/offers/select.js:80,86` (before this change): decision timestamp and 30-day cutoff, **Engine**; explicit branch binds the same asOf in both positions.
- `src/recommendation/scoring/load-assessments.js:80`: `CURRENT_TIMESTAMP AS loaded_at`, **Engine** metadata only; not consumed for scoring and no required change.
- `orchestrator/snapshot.js`: transaction control, **Engine**, no clock SQL of its own.
- `filtering/context-loader.js`, `candidates/loader.js`, `orchestrator/commit.js`, `persistence/`: **Platform** restricted; no CURRENT_TIMESTAMP/now() clock input needed changing for this option. DB-generated persistence timestamps remain audit metadata, outside scored/ranked content.
- `ingestion/apply.js:37,68,73,93`: SQL now() audit/lifecycle stamps, outside the recommendation pass; no required change.

Golden manifest `as_of = 2026-10-08T20:00:00.000Z`. Its report date is derived from this
input, so baseline headers do not drift across calendar dates. Normal-vs-pinned TEST
comparison: S03/S06 each 101 post-offer/filter candidates, 40 retained, 25 ranked; retained
identities and ordered signatures match. Raw scores differ by expected fractional assessment
age; offers remain 101/101 eligible. The seed waiver remains explicitly enabled as before.

Verification: two full golden CLI runs at different actual wall-clock times exit 0;
committed baseline `cmp` exit 0. All 21 A8 rows PASS with zero raw-score delta; cooler
identities/totals stable. 22 EXPECTED-RED hypotheses and 3 UNKNOWNs remain (S17/S18 plus
unrun PI-1); no threshold tuned. Four full-run cases succeed and both cleanup vectors are
q/bc/comp/res/rej = 0. OG-41's changing-time harness artifact is resolved for pinned runs;
legacy unpinned runs remain intentionally clock-sensitive. OG-42 is implemented; persisting
as_of is only a Platform request in `docs/briefs/requests.md`. E2 is now IMPLEMENTED 2026-10-09 (Decision 39, below); seed activation landed on the TEST branch 2026-10-09 (E1, below); E3 landed 2026-10-10 (Decision 40 — see the epic section below).

### Historical E0d proposal — query-pinned `as_of` (superseded by Decision 38)

The migration-first proposal below is historical. Explicit Engine run input now ships without
a migration; query-column persistence remains requested from Platform and is NOT implemented.

Goal: repeated execution of the same query against identical data/model/code must use the
same time input. This is a proposal to amend Decisions 7/17, not a numbered/resolved entry.

1. Platform adds an immutable `recommendation_query.as_of TIMESTAMPTZ NOT NULL` in a NEW
   sequential migration (expected 019 only if still free), defaulted ONCE at query creation.
   Backfill historical rows from `created_at` with an explicit historical approximation note;
   that cannot reconstruct the original execution instant. Never rewrite applied migrations.
2. Query loading carries the pinned timestamp to orchestration; convert to epoch milliseconds
   once, fail closed, and pass it to candidate/build/contribution scoring instead of reading
   the wall clock. Thread the SAME instant into offer freshness SQL/normalisation and price
   decision metadata. Assessment `loaded_at` becomes metadata only, not a fallback clock.
3. API-created requests normally pin DB time at insertion. A public caller-selected historical
   timestamp is a separate policy/security decision; do not expose unrestricted time travel.
   A new timestamp means a new query, not mutation of an existing pinned timestamp.
4. Cache keys include canonical UTC ISO `as_of`, explicit model ID/version + configuration
   digest, canonical query inputs, engine/policy version/options (including seed-offer waiver),
   and a catalog/offer/assessment/compatibility revision or snapshot digest. Include resolution
   and priority even while inert so future behavior does not collide. Never key only on budget
   and use case, or on the mutable global active flag. Exact timestamps limit cross-request
   reuse; any bucketing is a separate approved approximation, not silent rounding.
5. A pinned time does NOT freeze mutable catalog data. Reproducibility/cache correctness also
   requires the same data revision; genuine historical offer/assessment reconstruction would
   need versioned snapshots, not merely this column. Serving an old cached result needs current
   availability/freshness revalidation or an explicit stale-result policy. Do not let a pinned
   past timestamp silently turn expired offers into a present-day purchase recommendation.
6. Proposed acceptance gates: repeated same-query runs have identical scores/ranks/selection;
   offer boundary tests use the same as_of; data/model/as_of/options changes invalidate cache;
   missing/bad timestamps fail closed; old results retain traceability. Coordinate Platform
   schema/API ownership and Engine loader/scoring ownership before implementation.

## E0 gate verified end-to-end (2026-10-09)

The 60 pre-marker `recommendation_query` rows that made `assertNoUnmarkedQueries` refuse to run were
operator-approved and DELETED from the TEST branch (one transaction, `deleted queries=60`, dependents 0,
residue 0). The harness then ran to completion for the first time on the unchanged engine: 81 assertion
rows, **PASS 56 / EXPECTED-RED 22 / UNKNOWN 3**, exit 0, cleanup residue `{q:0,bc:0,comp:0,res:0,rej:0}`
(the third UNKNOWN is the suite-level A9 PI-1 row the CLI does not embed). Regenerating the baseline into a
scratch path and diffing it against the committed `test/golden/baseline-2026-10.md` is **byte-identical**,
so the committed baseline is a faithful pre-change snapshot. **Since this verification:** Step-2 item 1 landed (the
pin, below), E1 activation was EXECUTED on the TEST branch 2026-10-09, and E2 landed the same day
(Decision 39) — see the E1/E2 section below. **Updated 2026-10-14:** E3 (Decision 40), E4 (Decision 41), E5 (Decision 42, inert), E6 (Decision 43, acceptance unmet — OG-49) and E7 (Decision 44) are IMPLEMENTED. **E8 (Decision 45, 2026-10-14) is now IMPLEMENTED too, so E0—E8 are COMPLETE** — the last three Decision 26 item B rules are enforced and OG-09 / OG-11 / OG-12 are closed (C-38). `docs/briefs/step2-launch-v2-runbook.md` §1–§2 record the verified preconditions.

### Step-2 item 1 — the scoring-model pin (IMPLEMENTED 2026-10-09)

`scripts/lib/model-pin.js` resolves a model by `name@version` among ACTIVE rows
(default `seed-minimal-v1@1.0.0`; `--model=` beats `SCORING_MODEL_PIN` beats the
default) and replaces both old selectors: the four hard-coded name pins and the
golden preflight's "exactly ONE active model by COUNT" gate. It fails closed on a
malformed, ambiguous, inactive or unmatched pin, and prints the active models when
a pin does not resolve. Verified on a REAL two-active-model branch (temporary
`pin-rehearsal-tmp@9.9.9`, 17/17 assertions, temp row removed; default pin gives a
byte-identical golden baseline; PI-1 PASS pinned to the temp model). This unblocks
runbook §4. **§3 and §4 then RAN on 2026-10-09:** seed 013 was applied on the TEST branch and v1 was re-activated, so
BOTH models are active there and the two pinned golden baselines differ on exactly one line (the model
header) — see the E1/E2 section below. The shared database is untouched. A pin is still a SELECTOR, never
an activation.

## E1/E2 executed (2026-10-09)

**E1 — activation DONE.** `database/seeds/013_scoring_model_launch_v2.sql` was applied on the `test-engine`
branch (guarded, direct host, one transaction); `seed-minimal-v1` was then re-activated per the documented
deviation, so BOTH models are active there (active count 2) and the shared database is untouched. Evidence
that the two models are byte-identical: golden runs pinned to each (`--model=name@version`) both report 81
rows / 56 PASS / 22 EXPECTED-RED / 3 UNKNOWN, exit 0, residue 0, and the two written baselines differ on
exactly ONE line — the model-identity header. The v1 baseline was neither regenerated nor edited
(byte-identical to the committed `test/golden/baseline-2026-10.md`);
`test/golden/baseline-launch-v2-2026-10.md` is the second committed baseline. Runbook §3–§5 of
`docs/briefs/step2-launch-v2-runbook.md`.

**E2 — IMPLEMENTED (Decision 39).** `retainTopKPerRole` takes an optional `roleTargets` map (per-role
`{target, ceiling}` from a profile’s `spend_targets` + budget + resolution, see `retention/targets.js`) and a
targeted role bucket keeps the best scorer in each price band (below / at / above, the above band bounded by
the ceiling) inside the unchanged K cap, with the Decision 27 reservation and the Rule 3/5 order shared by
both modes. A model with no `use_case_profiles` passes `null` and is byte-identical. Measured with
`scripts/measure-retention-bands.js` on the TEST branch: 4 DISTINCT retained sets across 8000/12000/20000/
30000 MAD GAMING under `launch-v2`, against 1 under v1 — the differential that makes the PASS meaningful.
Golden effect under `launch-v2` (81 rows / 55 PASS / 23 EXPECTED-RED / 3 UNKNOWN, exit 0): A1
S03/S10/S11 1 -> 2 distinct pairs, A3 S03 overlap 1 -> 0.36 and S04 1 -> 0, A1 S19 3 -> 2. No threshold was
tuned. Residual registered as **OG-43**.

## E1–E8 (after E0; one PR each)

E1 scoring model "launch-v2" with use_case_profiles (gpu_policy, spend_targets by role, optional role_weights override); export listUseCases(configuration) from the scoring barrel; decouple the vocabulary from gpu_required_use_cases (Decision 37 supersedes 17.6). Keep seed-minimal-v1 for reproducibility; follow docs/RECIPES/add-a-scoring-model-version.md.

~~E2 target-aware price-band retention (keep Decision 27 reservation + budget_floor).~~ **DONE 2026-10-09 (Decision 39) — see the E1/E2 section above.**

E3 max_builds_per_pair quota enforced at GPU depth inside the DFS.

E4 selectArchetypes (PERFORMANCE / BALANCED / VALUE; priority sets the order; fewer than 3 distinct builds is returned honestly with a reason code). ~~Needs recommendation_result.strategy_key from Platform migration 019.~~ **LANDED 2026-10-14 (Decision 46):** `019_recommendation_pass_facts.sql` adds the column (both databases since 2026-10-15) and `persistence/persist-pass-facts.js` writes each key onto the rank it nominated; **the read path landed too (Sprint 4, 2026-10-14):** `apps/api/src/repository.js` reads `r.engine_version` and `r.strategy_key`, the presenter serves both per build on POST and GET from the persisted rows only, and the contract is v1.5 (v1.1 pass facts, v1.2 product identity, v1.3 request dedupe, v1.4 the presets ribbon, v1.5 the read-only catalog), pinned by `apps/api/test/unit/openapi-v1.6.json`. Nothing remains here: 019 and 020 are applied on BOTH databases (shared 2026-10-15 from restore point `br-damp-grass-axyri6yl`).

E5 resolution: GPU spend-share multiplier + VRAM floor from gpu_chipset.vram_capacity_gb. No per-game FPS claims.

~~E6 OFFICE: GPU OPTIONAL with an iGPU CPU, low spend targets.~~ **IMPLEMENTED 2026-10-14 (Decision 43)** - `gpu_policy` is an OPTIONAL Engine 3 input, Rule 0 lives in `assembly/gpu-policy.js` and a declared `IGPU_ALLOWED` hard-skips the discrete branches at GPU depth; seed 013 declares OFFICE `IGPU_ALLOWED` (TEST branch). **The ACCEPTANCE is NOT met:** no GPU-less OFFICE build exists on the catalog (A6 never green; S17/S18 give 0 ranked builds under both pins) because the OFFICE rank-1 CPU has no integrated GPU, so the declared policy resolves to `REQUIRED` and the skip is unreachable - see **OG-49** before advancing `current_epic`.

~~E7 pure deriveReasons() emitting reason codes (no new JSONB column).~~ **DONE 2026-10-14** - `explanation/reasons.js` (`deriveReasons` + `REASON_CODES` / `REASON_ORDER`) plus the extracted `explanation/build-facts.js`, exported through the Engine 6 barrel; additive / pure / DB-free / deterministic / unwired, with the persisted shape and the existing `explanation` string byte-identical (the unmodified 13 `explain.test.js` pins are the proof). Decision record: **Decision 44**, written 2026-10-14 in the same pass as E6's **Decision 43** (both were missing while `src/` cited 43 throughout - that hole was OG-48, now CLOSED as C-37).

~~E8 enforce OG-11 and OG-12 as HARD rules, OG-09 as a soft/CONDITIONAL rule.~~ **DONE 2026-10-14 (Decision 45)** — `compatibility/cooler-tdp.js`, `memory-slots.js` and `memory-capacity.js`. OG-11 (`ram_spec.module_count` > `motherboard_spec.dimm_slots`) FAILs `RAM_SLOTS_EXCEEDED` and OG-12 (`module_count * capacity_per_module_gb` > `max_memory_capacity_gb`) FAILs `RAM_CAPACITY_EXCEEDED`; both map to candidate REJECT. OG-09 (cooler `max_tdp_watts` < CPU `tdp_watts`) is SOFT and resolves UNKNOWN `COOLER_TDP_INSUFFICIENT`, never a reject — UNKNOWN rather than CONDITIONAL, because `compatibility/statuses.js` (Decision 3b) admits only PASS / FAIL / UNKNOWN as final statuses. Six spec columns were added to four existing loader SELECTs and the three pairs are registered in BOTH topology sites (11 relationships, appended so no pre-E8 precedence moved); `check-deferred-rules.js` now guards four ENFORCED rules and calls none latent. Unit 1121/0 on Node 24 and the Node 22 leg (0 cancelled), replay 0 drift, PI-1 PASS, and the 20-scenario golden suite moves NO row at either pin. **Closes OG-09 / OG-11 / OG-12 (C-38)**; residuals registered as **OG-50** (the one NULL cooler TDP, whose pair correctly reads UNKNOWN) and **OG-51** (four `TestCompat*` fixtures persisting on the shared DB, which is why the gate's coverage line read 8 motherboards rather than 7) — **OG-51 was CLOSED 2026-10-18 (C-41)**; OG-50 remains open. **This is the last engine epic in the M2 roadmap.**

## Working rules

- Every behaviour change: Decision record, gap-register row, PASS/FAIL/BLOCKED report, golden suite result table in the PR description.
- Starting spend shares (GAMING GPU ~0.38, CPU ~0.17, motherboard ~0.10, RAM/SSD/PSU/case ~0.07 each, cooler ~0.04) are hypotheses to be validated by the harness and a human reviewer, not facts.
- Report anything in this brief that conflicts with the code instead of silently deviating.
