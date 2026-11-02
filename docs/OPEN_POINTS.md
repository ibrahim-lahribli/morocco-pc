# OPEN_POINTS — what is still open

**This is the only answer to "what is still open."** One row per point, with the class, what is true
today, what would close it, and who owns it. Evidence lives in `docs/OPEN_GAPS.md` (the detailed
register, kept as the audit trail) and in the decision log; this file is the entry point and the
summary. It was compiled from the 2026-11-02 status review (R-01 … R-22) plus one carried request
(R-23).

**Reading the status column.** `OPEN` = nothing has closed it. `ACCEPTED` = a decision deliberately
takes the cost (name it when you touch the area). `BLOCKED-OWNER` = an agent cannot move it.
`DEFERRED` = scheduled behind a named trigger. Severity: **blocker** (release cannot be called honest),
**high** (a beta would ship a known defect), **medium** (progress cost or a documented drift),
**low** (housekeeping).

| ID | Point | Area | Sev | Status | What closes it | Owner |
|---|---|---|---|---|---|---|
| R-01 | No real market data: 114 offers for 113 products, all `SEED_UNVERIFIED`, 0 with `product_url`/`ingestion_record_id`/seller, two fictional `example.ma` stores. `check-offer-provenance.js` INCONCLUSIVE everywhere. | data | **blocker** | OPEN | One collector (the manual adapter first), 2-3 offers per role-critical part, then `check-offer-provenance.js` PASS + `check-offer-freshness.js` PASS | data |
| R-02 | `build_score` has no budget or price term, so the top build is the highest-scoring one that fits: OFFICE at 12 000, 20 000 and 30 000 returns the identical 9 076 build (measured 2026-11-02, `launch-v2@2.4.0`). | engine | **blocker for "budget-driven"** | ACCEPTED (Decision 60) | Its own epic: a budget-utilisation term + full rebaseline + `verify:pi1` | engine |
| R-03 | GAMING and WORKSTATION do not diverge at the top rung: byte-identical rank-1 at 20 000 (57.41 / 14 843) and 30 000 (57.66 / 22 444); they differ at 12 000 only in the SSD. `use_case` reaches exactly three places (`gpu_policy`, `spend_targets`, `archetype_objectives`). | engine | high | OPEN | Per-use-case scoring/policy differences, or an explicit acceptance | engine + owner |
| R-04 | Retention is platform-cost-blind: a CPU's real cost includes the board and RAM its socket forces, which `retainTopKPerRole` cannot see. Measured: 8 of 10 retained CPUs cannot produce an in-budget build at 12 000 @1440p. | engine | high | OPEN | A cheapest-PLATFORM reservation (Decision-27 shape), fed by the orchestrator so `retain.js` stays pure | engine |
| R-05 | The deployed API authenticates as `neondb_owner`; the least-privilege `morocco_pc_api` role exists on shared and EU (21/21 self-check) and is unused by any host. `check-deployed-role.js` measured FAIL on 2026-10-29 and again on 2026-10-31. | ops | **blocker (security)** | OPEN · BLOCKED-OWNER | Rotate the host secret per `docs/RECIPES/deploy-eu-colocation.md` §8.5, then `check-deployed-role.js` PASS | owner |
| R-06 | `SCORING_MODEL_PIN` is set in no environment, so the served model is "newest ACTIVE row": shared now holds SIX ACTIVE `launch-v2` versions with v1 INACTIVE and therefore serves `launch-v2@2.4.0`, a depth experiment Decision 57 does not adopt. | ops + engine | high | OPEN · BLOCKED-OWNER | Decide the release model and pin it at deploy (or activate it deliberately) | owner |
| R-07 | 13 of 113 ACTIVE products on shared carry neither `slug` nor `display_name` (EU: all 100), so the API serves `components[].slug: null`. Seed 028 is applied on TEST only; the gate (`check-catalog-identity.js`, exit 1 today) runs nightly, not on push. | data + API | high | OPEN · BLOCKED-OWNER | Apply seed 028 to shared and EU with recorded restore points | owner |
| R-08 | No always-on host has ever been deployed. P1 Sprint 1 Steps 7-9 and everything downstream of them (latency table, `trustProxy` Step 4, Sentry Step 3, staging, web S26) wait on a paid host; the Render demo sleeps after 15 idle minutes. | ops | high | OPEN · BLOCKED-OWNER | Choose and fund a host, then deploy the EU app and re-measure | owner |
| R-09 | A zero-build band exists between the 4 277 MAD budget floor and the ~7 877 MAD cheapest real build, and `budget_floor.within_budget` is `true` inside it: GAMING and WORKSTATION at 6 000 return 0 builds. | engine + product | medium | ACCEPTED as contract (OG-40) | Surface "no compatible build in this budget" copy, or redefine the floor | product |
| R-10 | NULL spec operands leave real verdicts UNKNOWN: 7 GPU variants without `width_slots`/`height_mm`, 2 PSUs without connector counts, 1 cooler without `max_tdp_watts` (5 penalty points per UNKNOWN). | data | medium | DEFERRED (Decision 61) | Re-open only with a citable source; inventing the value is not an option | data |
| R-11 | E2/E4 constants are unvalidated hypotheses: resolution multipliers 1.0/1.25/1.5, `BAND_TOLERANCE` 0.15, `BAND_CEILING_FACTOR` 2.0, `PERFORMANCE_FLOOR` 0.85. The only corpus is the seed catalogue, so an H3 review could not defend them. | engine | medium | OPEN | One calibration study once R-01 supplies real prices | engine |
| R-12 | The golden suite's A1/A3/A4 assertions are still `hypothesis`, and the two A10 re-approvals were made by the author of the change. The mechanism (named reviewer + `CHANGELOG.md` entry) is honest; the independence is not there. | testing | medium | OPEN | An independent review pass over the hypothesis rows | owner |
| R-13 | `docs/DATA_STATE.md` had gone stale (queries 9→12, results 8→16, Layer-4 99→183) and its generated header claimed retention ties fall through to random UUIDs. **Fixed 2026-11-02**: the generator's text is corrected and the snapshot regenerated; the gate is green. Listed so the class stays visible: a generated doc nobody regenerates is a stale claim. | docs | low | CLOSED 2026-11-02 | — (regenerate on every seed/migration) | docs |
| R-14 | 12 unmarked `recommendation_query` rows sit in shared (16 results, 16 candidates), so `eval:scenarios` refuses to run against shared until they are removed. | ops | medium | OPEN | Clean in FK order (`recommendation_swap` first) | owner |
| R-15 | Catalogue breadth: 1.01 offers per product, and at 12 000 @1440p exactly one GPU clears the 12 GB floor, so one price decides that build. | data | medium | OPEN | Expand supply on the binding axes per role | data |
| R-16 | No authentication or accounts anywhere: the API is public with per-IP limits only. | platform | medium | ACCEPTED (by design) | Out of scope for the engine; needed before any private/gated beta | owner |
| R-17 | The served use-case vocabulary is GAMING / OFFICE / WORKSTATION only; no creator, streaming or AI-ML profile exists in any active model. | product | medium | OPEN | Decide whether a creator segment is in scope (new scoring work, not a label) | owner |
| R-18 | `deriveReasons` codes are computed but not persisted: only the explanation string is stored, so a saved pass cannot be re-explained from machine-readable facts. | engine | low | ACCEPTED (Decision 44) | Revisit if a client needs reasons on a permalink | engine |
| R-19 | `component_assessment.rating` bands are contradictory on ~27 of 260 rows (same score, different label at the boundary). Read by nothing in `src/`, so metadata-only. | data | low | OPEN | One corrective seed, or amend the rubric doc to the mapping actually used | data |
| R-20 | Accepted architectural gaps: no iGPU performance tiering, CONDITIONAL semantics only via `cpu_motherboard_support`, single currency per query, no multi-GPU, `recommendation_profile.priority` as an INTEGER. | schema + engine | low | ACCEPTED | Keep deferred; each needs its own decision | engine |
| R-21 | No coverage measurement, and the two DB-backed gates (`test:api:db`, `check-catalog-identity`) run nightly only — which is exactly how R-07 reached shared. | testing | low | OPEN | Add coverage; move the identity gate to push/PR | tooling |
| R-22 | `strategy_key` / `engine_version` are persisted and served but consumed by nothing; `API.md` described them as owed until 2026-11-02. | API | low | OPEN | Decide whether a client needs them; the doc is fixed | API |
| R-23 | The explicit run `as_of` is not persisted: the engine honours `options.asOf` (Decision 38) but `recommendation_query` has no column for it, so a stored pass cannot name its own clock. | schema + engine | low | OPEN · BLOCKED-OWNER | A new migration + API wiring; carries an owner gate because it is a real-database write | owner |

## Checked while compiling this list (2026-11-02)

- Engine, script and API suites: 1261 / 443 / 193 tests, 0 failed, no cancelled (`test:api:db` 17 was
  not re-run: it writes to the TEST branch).
- `run-migrations --check`: no pending file, ledger 23. `gen-decision-index --check`, `verify-docs
  --offline`, `gen-schema-reference --check`: exit 0.
- `check-catalog-identity.js`: exit 1 (R-07). `check-offer-provenance.js` / `check-offer-freshness.js`:
  INCONCLUSIVE (R-01). `check-deployed-role.js`: FAIL (R-05).

## Not re-measured here (and why)

`test:api:db`, `eval:scenarios`, `verify:replay`, `verify:pi1` and the `check-*` data gates all write
to the TEST branch or a scratch database. They were not run in the documentation pass that produced
this file; the figures above come from the 2026-11-02 status review, which ran the read-only half.

## How to add a point

Give it the next R-id, say what is true TODAY with the command or file that shows it, and name what
would close it. Do not copy a `Status:` line from the decision log — a decision records intent, this
register records state. When a point closes, keep the row and set `CLOSED <date>` with one line of
evidence; the history is the point.
