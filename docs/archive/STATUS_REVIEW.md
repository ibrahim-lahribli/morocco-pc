Superseded by: docs/OPEN_POINTS.md on 2026-11-02

# Engine & Platform Status Review — 2026-11-02

**Scope:** engine + platform (schema, catalogue, compatibility, selection, assembly, scoring, ranking,
explanation, persistence, offers, HTTP API, tests/CI/ops, docs). Frontend/UX/SEO/accounts only where
they block the engine or API.
**Method:** read-only. Every command below was executed; nothing was written except this file
(`git status --porcelain` is clean apart from this report).
**Branch:** `master` @ `4e45a0d`. **Node** 24.21.0 locally, 22 via `npx node@22`.

Confidence tags: **VERIFIED** (checked in code/tests/run today) · **DOCUMENTED-ONLY** (docs assert it,
not re-confirmed) · **UNKNOWN** (could not verify).

---

## 1. Executive summary

The engine is real, unusually well-pinned engineering: 23 migrations ledgered and replayed, **1 261**
engine unit tests, **443** script tests and **193** API tests green on Node 22 and 24, deterministic
assembly→score→rank→explain over a documented decision log. What it is *not* is a product: the entire
catalogue is seed data with fictional `example.ma` stores, so every price is unverifiable and no offer
carries provenance. The three biggest risks are (1) **there is no real market data at all**, (2)
**`build_score` has no budget term**, so budget stops mattering — a 30 000 MAD office query returns the
same 9 076 MAD build as a 12 000 MAD one — and (3) **the deployed demo still runs as the database owner**
with no model pin, plus 13 products that serve `slug: null`. Verdict on "private beta on the API
today?": **yes as an assembled-build demo, no as a recommendation product** — it can serve correct,
compatible builds, but it cannot promise a price, and high budgets go unspent.

---

## 2. Status table

| Area | Status | Conf. | Evidence (one line) | Gap (one line) |
|---|---|---|---|---|
| Schema / migrations 001–023 | ✅ | VERIFIED | `run-migrations.js --check` → "No pending migrations", ledger 23/23, audit target `db:54ff6ea3f6e6` | Replay is a nightly gate only; a fresh-local drift can sit a day |
| Hardware catalogue (Layer 1) | ⚠️ | VERIFIED | 113 products / 24 variants / 84 families; 7 GPU rows with NULL dims, 1 cooler NULL TDP | No real retailer SKUs; several spec columns are still vendor-NULL |
| Component assessments (Layer 2) | ⚠️ | VERIFIED | 319 rows; 112 of 113 products assessed (VALUE 105, QUALITY 103, PERF 73, THERMALS 17) | Rubrics are seed-authored, not independently reviewed (OG-29 band drift) |
| Compatibility engine (rules, UNKNOWN) | ✅ | VERIFIED | `compatibility/` 8+3 pairwise rules, registered in **both** `filtering/filter.js` and `assembly/assemble.js`; 4 previously-deferred rules enforced (Decision 45) | 7 GPU / 2 PSU / 1 cooler NULL operands force UNKNOWN on real products (OG-07/08/50) |
| Candidate selection (Engine 2B/2C) | ✅ | VERIFIED | `candidates/loader.js` parameterized SQL, `select.js` pool; 101-candidate pool reproduced | Pool size is catalogue-bound (18 CPU / 22 GPU / 7 MB …) |
| Hard filtering (Engine 2D) | ✅ | VERIFIED | `filtering/filter.js` + `context-loader.js` (740 lines), verdicts persisted (`build_rejection` 18 rows) | Rejections cover candidates only, not pairwise assembly refusals |
| Build assembly (DFS) | ✅ | VERIFIED | `assembly/assemble.js` 1 161 lines; 25-build cap, per-pair quota incl. the GPU-omitted path (OG-57 fixed) | Score/price of assembly is catalogue-bound; 13 pairs max at 12k+ |
| Scoring (Engine 4) | ⚠️ | VERIFIED | `scoring/build-score.js`: `Σ w·effective / Σ w − penalty×unknown`, clamp [0,100] | **No budget/price term** — the single biggest quality defect (§6) |
| Ranking (Engine 5a) | ✅ | VERIFIED | `ranking/rank.js`: score DESC → price ASC → signature (code-unit), `round2` before compare, no randomness | Ranker is fine; it faithfully ranks a score that ignores budget |
| Diversity / archetypes (E3/E4) | ⚠️ | VERIFIED | `select-archetypes.js` returns 3 pair-distinct builds, `NO_*` codes instead of padding | Capped at 3 by construction; at 8 000 MAD only 1–2 exist |
| Explanations (Engine 6) | ✅ | VERIFIED | `explanation/explain.js` strings + `deriveReasons()` codes from one shared `build-facts.js` | Only the string is persisted; no JSON reason column |
| Persistence / transactions | ✅ | VERIFIED | `orchestrator/commit.js` one write txn, re-run guard, replace-idempotent rejections (Dec 31), pass facts (Dec 46), swap APPEND (Dec 56) | Layer 4 rows in shared are probe residue (12 queries/16 results), not user data |
| Offer / price ingestion | ❌ | VERIFIED | `ingestion/` exists (manual adapter only), **0** `ingestion_record` rows, **0/114** offers with `product_url`/`ingestion_record_id`, 2 stores on `example.ma` | No scraper, no retailer feed, no real price anywhere |
| HTTP API (Fastify) | ✅ | VERIFIED | Live: `/v1/health` 200 `db:ok`, `/v1/meta/options` (3 use cases), `/v1/catalog/products` paginated, contract v1.10 snapshot + `openapi-coverage.test.js` | No auth/ABAC; POST path writes real rows (not exercised read-only) |
| Testing | ✅ | VERIFIED | `test:unit` 1261/0, `test:scripts` 443/0, `test:api` 193/0, all on Node 22 **and** 24, 0 cancelled | No coverage measurement; `test:api:db` is nightly-only |
| CI | ⚠️ | DOCUMENTED-ONLY | `.github/workflows/ci.yml`: push job (unit/scripts/api + 2 doc gates), nightly job (freshness, provenance, identity, replay, DB tests) | Last run status not checkable here (no `gh`, no token) |
| Deployment / ops | ❌ | VERIFIED | `https://morocco-pc.onrender.com/v1/health` → 200, `engine_version:"dev"`; role check measured **FAIL** (owner credential) on 2026-10-29 | EU host never deployed; no model pin; owner credential still in use |
| Documentation | ⚠️ | VERIFIED | 62 decisions, `DECISION_INDEX` + `verify-docs --offline` green | `gen:schema --check` **exits 1** (DATA_STATE stale); register rows contradict measurements |

Legend: ✅ trustworthy · ⚠️ works with a named defect · ❌ not production-ready.

---

## 3. What is solid

- **The pipeline is genuinely composed, not stitched.** `orchestrator/run.js` (569 lines) documents and
  enforces each seam: one transaction timestamp as the only clock, Stage 1's price carrier passed **by
  reference** to retention and to Engine 3, filtering context loaded once and shared, assessments loaded
  once for pool ⊇ builds. Pure/impure boundary holds: `grep` finds no DB access outside the loaders.
- **Determinism is enforced, not hoped for.** `ranking/rank.js` rounds to 2 dp *before* comparing, ties on
  price then on a code-unit signature; `retention/retain.js` breaks `selected_price` ties by Rule 3/5
  position; nothing in `src/recommendation/` uses `localeCompare` or a random tie-break (the
  `DATA_STATE.md` warning claiming otherwise is stale — §8).
- **Every rule is registered twice on purpose.** The same pairwise table is used by the candidate filter
  and by the assembly walk, so a candidate can never pass filtering and be rejected mid-build.
- **Persistence is append-only where it matters.** A committed swap writes a *derived* `build_candidate`
  + `build_component` rows + one `recommendation_swap` link, never an UPDATE, so a pass stays a record.
- **Test depth is real.** 1 261 engine tests for ~7 500 lines of engine source, including negative cases
  ("a model that declares no quota keeps the pre-fix walk byte-identical"). The Node-22 leg actually
  reproduces (1 261/0/0 cancelled), which is the leg CI pins.
- **The API really is thin.** `apps/api/src/engine.js` is the only module allowed to require
  `src/recommendation/**`, and it is gate-tested (`apps/api/test/unit/import-boundary.test.js`).
- **Observability by design:** every gate prints a verdict (`PASS/FAIL/INCONCLUSIVE`) instead of a boolean,
  and `INCONCLUSIVE` is explicitly not a pass. That discipline is why §5 below can be stated bluntly.

---

## 4. What is weak or incomplete (ranked by impact)

1. **No market data (blocker).** 114 offers for 113 products, all written by seeds, all `SEED_UNVERIFIED`,
   all pointing at two fictional stores on the IANA-reserved `example.ma` domain. `ingestion_record` is
   empty, `check-offer-provenance.js` is INCONCLUSIVE everywhere, and `check-offer-freshness.js` reports
   the first seed expiry at **2026-11-03**. Root cause: the only shipped adapter is an operator-supplied
   manual file (`src/recommendation/ingestion/adapters/manual.js`). Nothing to fix in code — the collection
   does not exist. (OG-37, OG-19, OG-30 residual.)
2. **`build_score` has no budget term.** `scoring/build-score.js` `accumulateBuild()` sums
   `role_weight × type_weight × effective` over EXPANSION_ORDER roles and divides by the weight sum;
   price never enters. Consequence measured today (§6): **OFFICE at 12 000, 20 000 and 30 000 MAD returns
   the identical 9 076 MAD build** (score 59.60) — 30.3 % of budget at 30 000. Accepted by Decision 60 as
   a release-evaluation cost; it is the reason the product cannot call itself budget-driven. (OG-38.)
3. **The deployed API runs as the database owner and serves an unpinned model.** `check-deployed-role.js`
   measured **FAIL** (1/1 session as `neondb_owner`) on 2026-10-29; the `morocco_pc_api` role exists and is
   graded 21/21 but its credential was never rotated into the host. `SCORING_MODEL_PIN` is unset, so the
   served model is "newest `is_active` row" — on shared that is `launch-v2@2.4.0`, a *depth-experiment*
   version Decision 57 explicitly does not adopt for release. (OG-54, Decision 62.)
4. **Catalogue identity is unapplied on shared and EU.** `node scripts/check-catalog-identity.js` exits
   **1** here, naming 13 ACTIVE products with `missing=slug,display_name`; migration 020 keeps both
   columns nullable by design, so seeds 023–025 slipped 13 rows past it and the API serves
   `components[].slug: null` for them. The repair seed (028) is applied on TEST only. (OG-60.)
5. **Use case barely differentiates, and never at the top rung.** Measured: GAMING vs WORKSTATION are
   **byte-identical** at 20 000 (57.41 / 14 843) and 30 000 (57.66 / 22 444); they differ at 12 000 only in
   which SSD is picked (KINGSTON NV3 vs WD_BLACK SN770). Root cause in code: `use_case` reaches exactly
   three places — `gpu_policy` (`assembly/gpu-policy.js`), `spend_targets` → `retention/targets.js`, and
   `archetype_objectives` (only when `apply_archetype_objectives` is true). Two profiles that both declare
   `REQUIRED` GPU with similar shares therefore produce the same walk. (OG-38 remainder.)
6. **Retention is platform-cost-blind.** A CPU's real cost is CPU + the board and RAM its socket forces;
   `retainTopKPerRole` only sees the candidate's own `selected_price`, so a 1 699 MAD AM5 part outranks a
   1 399 MAD AM4 part by two VALUE points on a 1 019 MAD platform delta. Measured consequence at 12 000 /
   1440p: 8 of the 10 retained CPUs cannot produce an in-budget build at all. (OG-58.)
7. **Low budgets are silent.** GAMING and WORKSTATION at 6 000 MAD return **0 builds** while
   `budget_floor.within_budget` is `true` (floor 4 277). The contradiction was redefined as a contract
   (OG-40 closed by documenting it), which is honest but leaves a user-facing dead zone between 4 277 and
   the ~7 877 cheapest real build.
8. **Spec data still has holes that show up as UNKNOWN in real builds.** 7 `gpu_board_spec` rows with NULL
   `width_slots`/`height_mm`, 2 PSUs with NULL connector counts, 1 cooler with NULL `max_tdp_watts` (costs
   a build 5 `unknown_compat_penalty` points). All deliberately left NULL rather than invented (Decision
   61) — correct, but it caps compatibility confidence. (OG-07/08/50.)
9. **Environment drift.** TEST/EU/shared no longer match (`check-target-parity` DIFF: 3 vs 2 scoring-model
   pins, offers 103 vs 101, stores 5 vs 2 — last measured 2026-10-29); shared now holds six ACTIVE
   `launch-v2` rows and `seed-minimal-v1@1.0.0` is INACTIVE, because seed 027 replayed the whole seed set
   onto shared. Any measurement is environment-specific today. (OG-54 item 2, OG-52.)
10. **Probe residue in shared Layer 4.** 12 `recommendation_query` rows / 16 results / 16 candidates / 13
    profiles / 0 presets / 0 swaps. Harmless for serving, but the golden harness refuses to run while
    unmarked queries exist, so shared is currently un-harnessable without cleanup.
11. **Evaluation quality is self-approved.** A1/A3/A4 golden assertions are still `hypothesis`
    (`test/golden/scenarios.json`), thresholds were re-approved pin-by-pin, and both `A10` re-approvals
    were made by the same person who wrote the change. The mechanism is honest (a `CHANGELOG.md` entry and
    a named reviewer), but there is no independent reviewer.
12. **No coverage measurement.** 1 261 tests prove a lot of behaviour; nobody knows which branches are
    untouched. `test:api:db` (17 tests) is the only DB-backed API proof and runs nightly, which is exactly
    why the `slug` defect reached shared undiscovered.

---

## 5. Data readiness

Measured on `DATABASE_URL` (shared Neon) on 2026-11-02:

| Item | Count | Read |
|---|---|---|
| Products / variants / families | 113 / 24 / 84 | Seed catalogue, one offer per product |
| Products with NO identity (`slug`+`display_name` NULL) | **13** | `check-catalog-identity.js` exit 1 |
| `component_assessment` rows | 319 | 112 of 113 products assessed; 1 deliberate no-evidence fixture |
| Assessment mix | VALUE 105 · QUALITY 103 · PERFORMANCE 73 · THERMALS 17 · EFFICIENCY 11 · UPGRADEABILITY 10 | Role coverage is per-type, not per-market-data |
| Benchmark rows | 1 source, 1 benchmark, 2 results | Provenance token, not evidence |
| `store_offer` rows | 114 | 1.01 offers per product |
| Offers with ingestion record / product URL / seller | **0 / 0 / 0** | Every price is `SEED_UNVERIFIED` |
| Stores | 2 (`Seed UltraPC`, `Seed NextGamer`) | Both `https://example.ma/...` — RFC 2606 reserved |
| `price_history` | 114 | One observation per offer; no real history |
| Scoring models | 7 rows, **6 ACTIVE** (`launch-v2` 1.0.0–2.4.0), v1 INACTIVE | Served model = newest active = `launch-v2@2.4.0` |
| Layer 4 | 12 queries / 16 results / 16 candidates / 0 presets / 0 swaps | Probe residue |

**What that means.** The catalogue is a *structurally complete, materially empty* seed set: enough parts
to assemble 25 builds at almost any budget above ~8 000 MAD, with real vendor specs for most columns and
deliberate NULLs where the vendor publishes nothing. It is not Moroccan market data. To be
production-grade you need, in order: (a) real stores and retailer-hosted `product_url`s, (b) at least
2–3 offers per role-critical part so price comparison is meaningful, (c) `fetched_at` from an actual
collection rather than a seed `NOW()`, (d) a refresh cadence inside the 30-day Decision-7 window, and
(e) enough SKU breadth that a mid budget has more than one GPU that fits (today a 12 000 MAD 1440p build
has exactly one 16 GB card that fits). Items (a)–(d) are what `check-offer-provenance.js` +
`ingestion/` + `docs/IMPORT_OFFERS.md` were built for; only the manual adapter is implemented.

---

## 6. Recommendation quality findings

### How these were produced
Three passes went through the **real orchestrator** (`orchestrator.runRecommendation`) on existing
`recommendation_query` rows — read-only, no writes. The wider matrix reproduces `run.js` steps 4–13
stage-by-stage (same loaders, same arguments, same `resolve*` readers) because a probe may not insert
query rows in a read-only audit. The reproduction was **calibrated against those three real passes and
agrees exactly**:

| Query | Real orchestrator | Stage replica |
|---|---|---|
| GAMING 21 500 @1440p | 25 builds, 13 pairs, rank-1 60.83 @ 19 976 | identical |
| GAMING 22 000 @2160p | 25 builds, 13 pairs, rank-1 60.83 @ 19 976 | identical |
| OFFICE 22 000 | 20 builds, 10 pairs, rank-1 59.60 @ 9 076 | identical |

Model: `launch-v2@2.4.0` (the model shared serves), priority 3 unless stated.

### Results

| Use case | Budget | Builds | Pairs | Selected | Sel. pairs | Rank-1 score | Rank-1 price | Spend | Notes |
|---|---|---|---|---|---|---|---|---|---|
| GAMING | 6 000 | **0** | 0 | 0 | 0 | — | — | — | `EMPTY_RANKED`; floor 4 277, `within_budget: true` |
| GAMING | 8 000 | 4 | 2 | 2 | 2 | 43.33 | 7 876 | 98.5 % | `NO_VALUE_CANDIDATE` |
| GAMING | 12 000 | 25 | 13 | 3 | 3 | 59.58 | 11 775 | 98.1 % | Arc B580 12 GB |
| GAMING | 20 000 | 25 | 13 | 3 | 3 | 57.41 | 14 843 | 74.2 % | same GPU as 12 000 |
| GAMING | 30 000 | 25 | 13 | 3 | 3 | 57.66 | 22 444 | 74.8 % | RX 9070 16 GB |
| OFFICE | 6 000 | 6 | 3 | 3 | 3 | 50.31 | 5 827 | 97.1 % | GPU-less (5600G iGPU) |
| OFFICE | 8 000 | 18 | 9 | 3 | 3 | 57.30 | 7 826 | 97.8 % | GPU-less |
| OFFICE | 12 000 | 20 | 10 | 3 | 3 | 59.60 | **9 076** | 75.6 % | GPU-less |
| OFFICE | 20 000 | 20 | 10 | 3 | 3 | 59.60 | **9 076** | **45.4 %** | identical rank-1 |
| OFFICE | 30 000 | 20 | 10 | 2 | 2 | 59.60 | **9 076** | **30.3 %** | + `NO_PERFORMANCE_CANDIDATE` |
| WORKSTATION | 6 000 | **0** | 0 | — | — | — | — | — | floor 4 277, `within_budget: true` |
| WORKSTATION | 8 000 | 1 | 1 | 1 | 1 | 40.83 | 7 977 | 99.7 % | `NO_PERFORMANCE_*`, `NO_VALUE_*` |
| WORKSTATION | 12 000 | 25 | 13 | 3 | 3 | 59.90 | 11 875 | 99.0 % | differs from GAMING only in SSD |
| WORKSTATION | 20 000 | 25 | 13 | 3 | 3 | 57.41 | 14 843 | 74.2 % | **identical to GAMING** |
| WORKSTATION | 30 000 | 25 | 13 | 3 | 3 | 57.66 | 22 444 | 74.8 % | **identical to GAMING** |

Input-sensitivity checks at GAMING 12 000: resolution 1080p → 59.58 / 11 775; 1440p → 59.93 / 11 875;
**2160p → 52.25 / 11 926 (only 6 builds)**. At 30 000: 1080p and 1440p are identical (57.66 / 22 444);
2160p differs (60.83 / 19 976). Priority 1 vs 5 at 12 000 changes only the archetype *order*
(`VALUE/PERFORMANCE/BALANCED` vs `PERFORMANCE/BALANCED/VALUE`), not the rank-1 build.

### Diagnosis — which part of the old finding still holds

- **"Ranking/diversity behaves poorly" — partly refuted, and the cause was misattributed.** The ranker
  (`ranking/rank.js`) and the archetype selector (`ranking/select-archetypes.js`) both do exactly what
  they claim: 25 builds over **13 distinct (CPU, GPU) pairs**, and 3 pair-distinct archetypes in almost
  every row above. The 2026-10-07 report that "12 000 / 20 000 / 30 000 MAD all produce one distinct
  pair" was measured on `seed-minimal-v1` *before* Decisions 40/41/54/57/59; on the shipped model the
  diversity machinery works. The selector is capped at 3 by construction (Decision 41), so "only 3
  builds" is a product decision, not a bug.
- **The real defect is the objective, not the search.** Because `build_score` contains no price term, the
  engine maximises "part quality that fits" and then stops. That produces three observable failures:
  (a) the **OFFICE plateau** — every budget ≥ 12 000 returns the same 9 076 MAD build, so the 20 000 and
  30 000 rows spend 45 % and 30 % of budget; (b) **high-budget GAMING leaves money on the table** —
  22 444 of an assemblable 28 784 (74.8 %); (c) **cross-resolution score inversion** — 2160p at 30 000
  scores *higher* (60.83) and costs *less* (19 976) than 1080p, because the 16 GB VRAM floor changes which
  GPU is ever scored. Scores are not comparable across passes; only within one.
- **Use case is a near-no-op at the top rung.** GAMING and WORKSTATION are literally the same build at
  20 000 and 30 000. `use_case` is read in exactly three places (`gpu_policy`, `spend_targets`,
  `archetype_objectives`), and the two profiles differ in none of them enough to change the walk.
- **Low budgets fail loudly-but-wrongly.** 6 000 MAD gives zero builds with `within_budget: true`; the
  user-visible message has to come from the frontend, because the engine only returns the floor.
- **Explanation is honest but thin.** `explainSelection` emits rank / score / status / price-vs-budget /
  dominant role plus mandatory BIOS and UNKNOWN clauses; the machine-readable `deriveReasons` codes
  (`BUDGET_USED_PCT`, `GPU_SHARE`, …) are **not persisted**, so a stored pass cannot be re-explained.

---

## 7. Consolidated open-points register

Deduplicated across `OPEN_GAPS.md` (OG-*), `CONTEXT.md`, `ENGINE_BEHAVIOR_FINDINGS`, `PLAN_PLATFORM_*`,
the decision log and the dated audits. **Status** = what is true today, not what the doc says.

| ID | Point | Area | Sev | Status | Source(s) | Next step / owner |
|---|---|---|---|---|---|---|
| R-01 | No real offers/prices; all 114 offers are seed rows on fictional `example.ma` stores, 0 provenance | data | **blocker** | OPEN | OG-37, OG-19, OG-30 resid., OG-52 | Build one real collector (manual adapter first), run `check-offer-provenance` until PASS — data/owner |
| R-02 | `build_score` has no budget/price term (OFFICE plateau at 9 076 for every budget ≥12k) | engine | **blocker for "budget-driven" claim** | ACCEPTED (Dec 60), OPEN | OG-38, Dec 60 | Own epic: add budget-utilisation term + full rebaseline + `verify:pi1` — engine |
| R-03 | GAMING ≡ WORKSTATION at 20k/30k (measured identical) | engine | high | OPEN | OG-38 | Per-use-case scoring/policy differences, or accept and say so — engine/owner |
| R-04 | Retention is platform-cost-blind (8/10 retained CPUs unusable at 12k/1440p) | engine | high | OPEN | OG-58 | Cheapest-platform reservation, Decision-27 shape — engine |
| R-05 | Deployed API authenticates as `neondb_owner`; `morocco_pc_api` role provisioned but unused | ops | **blocker (security)** | OPEN, measured FAIL | OG-54.1 | Rotate the host secret per `deploy-eu-colocation.md` §8.5 — owner |
| R-06 | `SCORING_MODEL_PIN` unset everywhere; shared/EU serve "newest active" = `launch-v2@2.4.0` (not the release model) | ops/engine | high | OPEN | Dec 57/62, OG-54 | Pin at deploy; decide the release model — owner |
| R-07 | 13 ACTIVE products with `slug`/`display_name` NULL; API serves `slug: null` | data/API | high | OPEN on shared (13) + EU (100); TEST fixed | OG-60 | Apply `028_backfill_product_identity.sql` with a restore point — owner |
| R-08 | EU deployment never happened; TEST/shared/EU parity DIFF | ops | high | OPEN | OG-52, OG-53, OG-54.2 | Deploy EU + re-run `check-target-parity` — owner |
| R-09 | Zero-build band 4 277–~7 877 MAD with `within_budget: true` | engine/product | medium | ACCEPTED as contract | OG-40 (closed) | Surface "no compatible build in this budget" copy, or raise the floor definition — product |
| R-10 | NULL spec operands (7 GPU dims, 2 PSU counts, 1 cooler TDP) → UNKNOWN | data | medium | OPEN by decision | OG-07, OG-08, OG-50, Dec 61 | Leave NULL; re-open on a citable source — data |
| R-11 | E2 constants (1.0/1.25/1.5, 0.15, 2.0) and the 0.85 PERF floor are unvalidated hypotheses | engine | medium | OPEN | OG-43, Dec 39/41 | One calibration study against real prices once R-01 lands — engine |
| R-12 | A1/A3/A4 golden assertions still `hypothesis`; A10 re-approved by the author | testing | medium | OPEN | `test/golden/scenarios.json`, H3 review | Independent reviewer pass — owner |
| R-13 | `DATA_STATE.md` is stale (`gen:schema --check` exit 1) and its header claims random UUID tie-breaks | docs | medium | OPEN (new) | `docs/DATA_STATE.md`, `scripts/gen-schema-reference.js` | Regenerate + fix the generator's warning text — docs |
| R-14 | 12 unmarked `recommendation_query` rows in shared (golden harness would refuse) | ops | medium | OPEN | measured today | Clean in FK order (`recommendation_swap` first) — owner |
| R-15 | Catalogue breadth: 1.01 offers/product, single GPU that fits at 12k/1440p | data | medium | OPEN | OG-55, OG-56, OG-58 | Expand per-role supply — data |
| R-16 | No auth/accounts; API is fully public, per-IP rate limits only | platform | medium | by design | `docs/API.md`, Dec 36/49 | Out of scope here; needed before any paid/private beta gate — owner |
| R-17 | `use_case` vocabulary offers only GAMING/OFFICE/WORKSTATION (no STREAMING/CONTENT_CREATION/AI_ML) | product | medium | OPEN | `GET /v1/meta/options` today | Decide the creator story — owner |
| R-18 | `deriveReasons` codes are not persisted; only the string explanation is | engine | low | by decision | Dec 44 | Accept unless a UI needs reasons on a permalink — engine |
| R-19 | OG-29: `component_assessment.rating` bands overlap in 27 of 260 rows | data | low | OPEN | OG-29 | One corrective seed or amend the rubric doc — data |
| R-20 | Accepted architectural gaps: no iGPU tiering (OG-15), CONDITIONAL only via BIOS (OG-16), single currency (OG-20), no multi-GPU (OG-23), `priority` INTEGER redesign (OG-22) | engine/schema | low | OPEN (accepted) | ARCH §16/§18 | Keep deferred; revisit post-beta |
| R-21 | No coverage tooling; `test:api:db` + identity/provenance gates are nightly-only | testing | low | OPEN | `ci.yml` | Add coverage + move identity gate to push — tooling |
| R-22 | `strategy_key`/`engine_version` are served but consumed by nothing; `API.md` still lists them as "owed" | docs/API | low | OPEN (doc stale) | `docs/API.md` §Known limitations | Fix the doc; decide whether clients need them — API |

---

## 8. Documentation audit

Gate results measured today: `gen:decisions --check` **0**, `verify-docs --offline` **0**,
`run-migrations --check` **0**, **`gen:schema --check` 1**. All dates are last commit dates.

### Root-level

| Doc | Purpose | Fresh | Verdict |
|---|---|---|---|
| `AGENTS.md` (597 L) | agent index + hard rules | 2026-11-02 | **Keep** — accurate (§6 test counts 1261/443/193 matched my run) |
| `CONTEXT.md` (213 L) | canonical status | 2026-11-02 | **Fix** — accurate but corrupted by 5-deep inline self-corrections; same paragraph repeated 3× |
| `DEVELOPMENT_NOTES.md` (2 145 L) | operational lessons | 2026-11-01 | **Keep** (archive halves: pre-Oct sections are history) |
| `SESSION_NOTES.md` (95 L) | session scratch | 2026-10-28 | **Archive** |
| `PLAN_PLATFORM_P0…P3.md` + `PLAN_PLATFORM_STATUS` + `PLAN_PLATFORM_CONSTRAINTS` (1 900 L) | sprint plans | 2026-10-23…11-01 | **Merge** into one "platform roadmap" or archive; their open items are in R-05/06/08 |
| `CLAUDE.md` (1 line) | pointer | 2026-09-29 | Keep |
| `render.yaml`, `fly.toml`, `apps/api/Dockerfile` | deployment truth | — | Keep; `fly.toml` describes a host never deployed |

### `docs/`

| Doc | Purpose | Fresh | Verdict |
|---|---|---|---|
| `RECOMMENDATION_ENGINE_DECISIONS.md` (6 175 L, 62 decisions) | the actual contract | 2026-11-02 | **Keep** — the single most valuable doc; every engine rule traces here |
| `DECISION_INDEX.md` (generated) | lookup table | 2026-11-02 | Keep (generated, gate-green) |
| `RECOMMENDATION_ENGINE_ARCHITECTURE.md` (881 L) | pipeline + §16 gap table | 2026-10-29 | Keep, but §16 is superseded by `OPEN_GAPS.md` → **trim §16** |
| `OPEN_GAPS.md` (238 L) | gap register | 2026-11-02 | **Keep + fix** — OG-43/OG-54/OG-55 rows still assert positions measurement has overtaken |
| `API.md` (1 272 L) | API contract | 2026-11-01 | Keep; **fix** stale "Known limitations" (OG-45/46 are closed) |
| `SCHEMA_REFERENCE.md` (982 L, generated) | column truth | 2026-10-29 | Keep; **regen** (see DATA_STATE) |
| `DATA_STATE.md` (86 L, generated) | row counts | 2026-11-01 | **Fix now** — `--check` fails (queries 9→12, results 8→16, Layer-4 99→183) and its tie-break warning contradicts `AGENTS.md` §5 |
| `TEST_MAP.md` (103 L) | test → contract map | 2026-11-02 | Keep |
| `GLOSSARY.md` (53 L) | vocabulary | 2026-10-31 | Keep |
| `ENGINE_BEHAVIOR_FINDINGS_2026-10.md` (483 L) | 2026-10-07 findings | 2026-10-23 | **Archive** — its headline ("GAMING ≡ WORKSTATION at every budget") is now false at 12 k; keep as history |
| `ENGINE_HYPOTHESIS_REVIEW_2026-10-24.md` (214 L) | H3 review record | 2026-10-24 | Keep (evidence for the approvals) |
| `DOCUMENTATION_AUDIT_2026-09-28.md` (302 L) | prior doc audit | 2026-09-30 | **Archive** |
| `PROJECT_STATUS_REVIEW_2026-09-28.md` (266 L) | prior status review | 2026-09-30 | **Archive** — superseded by this file |
| `HANDOFF_2026-11-01_catalogue_identity.md` (237 L) | handoff | 2026-11-02 | Merge into R-07 / a recipe, then archive |
| `PIPELINE_DESIGN.md` (400 L) | ingestion F8 design | 2026-10-07 | Keep (design for R-01) |
| `IMPORT_OFFERS.md` (130 L) + `RECIPES/import-offers-manually.md` + `RECIPES/refresh-offers.md` | offer ops | 2026-10-23 | **Merge** the three into one recipe |
| `OG-01_*` (2 docs, 368 L) + `OG01_BATCH2_RESEARCH_CHECKLIST.md` (67 L) | closed research | 2026-10-06 | **Archive** (OG-01 is CLOSED) |
| `OG-39_ACTIVATION_PLAN.md` (102 L) | activation plan | 2026-10-09 | Archive (superseded by Decisions 57/62) |
| `briefs/engine.md` (253 L) | original engine brief | 2026-10-30 | Keep; it is the E0–E8 spine |
| `briefs/requests.md` (109 L) + `briefs/step2-launch-v2-runbook.md` (169 L) | platform requests | 2026-10-19 / 10-15 | Merge into the roadmap doc |
| `plans/agent3-web-*` (2 286 L) + `design/*` (5 docs, 1 267 L) + `superpowers/*` (5) | frontend / agent plans | Oct | **Out of scope** — archive under `docs/archive/` |
| `RECIPES/*` (12 files) | operator runbooks | Oct–Nov | Keep as a folder (highest operational value after the decision log) |
| `decisions/TEMPLATE.md` (99 L) | entry template | 2026-09-30 | Keep |
| `RECOMMENDATION_ENGINE_DECISIONS` count claims in `verify-docs.js` | gate constants | — | Keep in sync (currently green) |

### Contradictions found (doc ↔ doc, doc ↔ code)

1. **`DATA_STATE.md` header** says retention ties "fall through to random `product.id` UUIDs".
   `AGENTS.md` §5 and `retention/retain.js` say the opposite (deterministic `compareCandidates`,
   `product_id` ASC). The wrong text lives in the **generator** (`scripts/gen-schema-reference.js`).
2. **`OG-54` item 2** says shared "still serves `seed-minimal-v1@1.0.0` alone". Measured: **six ACTIVE
   `launch-v2` rows**, v1 INACTIVE, so shared serves `launch-v2@2.4.0`. (`OG-43` already carries a
   CORRECTED note for the same fact; `OG-54` does not.)
3. **`docs/API.md` Known limitations** cites OG-45/OG-46 as outstanding; both are CLOSED (C-39/C-42).
4. **`DATA_STATE.md` vs live DB**: `recommendation_query` 9 vs 12, `recommendation_result` 8 vs 16,
   Layer 4 99 vs 183 rows — the gate `gen:schema --check` exits 1.
5. **`ENGINE_BEHAVIOR_FINDINGS_2026-10.md`** headline ("byte-identical GAMING/WORKSTATION at every
   budget") vs measurement: identical at 20 k/30 k, different at 12 k.
6. **`CONTEXT.md`** self-contradicts inside single bullets (the E6 "ACCEPTANCE NOT MET" paragraph appears
   three times, and the same bullet later says it was met on 2026-10-24).

### Proposed minimal doc set (replace the sprawl)

1. **`README.md`** — what this is, how to run it, the four-layer map, the guard rails (≈1 page).
2. **`CONTEXT.md`** — current state only: what is implemented, what the served model is, which
   environment is which. No history: history belongs in git and the decision log. (≤200 lines, rewritten
   from scratch.)
3. **`docs/ARCHITECTURE.md`** — the existing `RECOMMENDATION_ENGINE_ARCHITECTURE.md` with §16 deleted and
   the schema map inlined (migrations remain authoritative).
4. **`docs/DECISIONS.md`** — the existing log, unchanged. This is the crown jewel; do not touch it.
5. **`docs/OPEN_POINTS.md`** — §7 of this report, kept as the only answer to "what is still open?".
6. **`docs/RECIPES/`** — keep the 12 runbooks as a folder.

Everything else (dated audits, handoffs, sprint plans, behaviour findings, OG research plans) moves to
`docs/archive/` with a one-line "superseded by" header. That is a 6-line index instead of 50 files.

---

## 9. Tests and ops

### Measured today

| Command | Result |
|---|---|
| `npm run test:unit` (`node --test "src/**/*.test.js"`) | **1 261 pass / 0 fail / 0 cancelled** (Node 24.21.0) |
| same on Node 22 (`npx -y node@22`) | **1 261 / 0 / 0 cancelled** — the CI leg reproduces |
| `npm run test:scripts` | **443 pass / 0 fail** (25 suites) |
| `npm run test:api` | **193 pass / 0 fail** |
| `npm run test:api:db` | **NOT RUN** — write-capable against the TEST branch; excluded by this audit's read-only rule (documented as 17/0 on 2026-11-02) |
| `node scripts/gen-decision-index.js --check` | exit **0** |
| `node scripts/verify-docs.js --offline` | exit **0** |
| `node scripts/gen-schema-reference.js --check` | exit **1** (DATA_STATE stale) |
| `node scripts/run-migrations.js --check` | exit **0**, "No pending migrations", ledger 23 |
| `node scripts/check-catalog-identity.js` | exit **1** — 13 products `missing=slug,display_name` |
| `node scripts/test-db.js` | connected, PostgreSQL 18.6, 44 tables |
| Live API (`API_ALLOW_SHARED=1 PORT=3055`) | `/v1/health` 200 `{status:ok,db:ok}`; `/v1/meta/options` 3 use cases + `inputs_applied`; `/v1/catalog/products?limit=2` 200 with cursor; `POST /v1/health` 404; `/v1/presets` 422 without `use_case` |
| `https://morocco-pc.onrender.com/v1/health` | 200, `engine_version:"dev"` — the demo origin is live |

### CI state

`.github/workflows/ci.yml` has two disjoint jobs: `unit-and-docs` on push/PR (unit + scripts + api +
decision-index + verify-docs), and `recurring-gates` nightly/dispatch (secrets assertion, offer
freshness, offer provenance, catalogue identity, migration replay, `test:api:db`, DB round-trip band).
The split is deliberate and documented. **Last run status is UNKNOWN here** — no `gh`, no token in this
session — but the local equivalents of every push-gate command pass, and the nightly-only gates are
exactly the two that fail locally (identity) and the class of test that caught the `slug` defect.

### Designed vs applied vs rehearsed

| Thing | Designed | Applied |
|---|---|---|
| Migrations 001–023 | yes | yes, all three databases (shared ledger 23) |
| `morocco_pc_api` role + column grants | yes | applied on shared + EU, self-check 21/21, smoke green — **but not used by the deployed app** |
| Seed 028 identity backfill | yes | TEST only (13→0); **owed on shared (13) and EU (100)** |
| EU colocation | yes (`render.yaml`, `fly.toml`, runbook §12) | **never deployed** — only the shared-DB Render demo exists |
| Sentry capture | yes (`monitoring.js`) | never proven with a real DSN (needs a deployed origin) |
| `TRUST_PROXY` | yes | value is per-host, never set |
| Rate limiting | yes, tested per-IP, spoofing cases | active, default-off proxy trust |
| Golden harness | yes (86 assertions, exit 0 at `launch-v2@2.4.0` per OG-59 closure) | **not re-run here** (writes to TEST); shared is currently un-harnessable (12 unmarked queries) |

---

## 10. Critical path to a credible engine + API beta

Ordered, smallest set that makes "beta" honest. S ≈ ≤1 day, M ≈ 2–5 days, L ≈ 1–3 weeks.

| # | Work | Size | Why it is on the path |
|---|---|---|---|
| 1 | Apply seed 028 (identity backfill) to shared and EU with recorded restore points | **S** | Removes `slug: null` from served components (R-07) |
| 2 | Rotate the deployed DB credential onto `morocco_pc_api`; set `ENGINE_VERSION`, `SCORING_MODEL_PIN`, `ALLOWED_ORIGINS`, then re-run `check-deployed-role` to PASS | **S** | Turns a measured security FAIL into a pass and fixes the served model (R-05/R-06) |
| 3 | One real offer collection: 2–3 Moroccan retailers, ≥2 offers per role-critical part, `product_url` + `fetched_at` from the fetch | **L** | R-01 — nothing else makes it a *price* product |
| 4 | Run `check-offer-provenance` → PASS and `check-offer-freshness --fail-days=14` → PASS; wire the collector as a scheduled job | **M** | Proves the prices are real and stay fresh inside Decision 7 |
| 5 | Budget-utilisation term in `build_score` (own Decision), full rebaseline, `verify:pi1` | **M** | R-02/R-03 — otherwise "budget" is decoration |
| 6 | Regenerate `DATA_STATE.md` + fix the generator's tie-break claim; re-point `API.md` limitations | **S** | Turns the last red doc gate green (R-13) |
| 7 | Clean the shared Layer 4 probe residue; re-run the golden suite once at the release pin | **S** | Makes the environment re-measurable (R-14) |
| 8 | Deploy the EU host; `check-target-parity` MATCH; `test:api:db` green against EU | **M** | R-08 — a beta needs one authoritative environment |
| 9 | Catalogue expansion on the binding axes (GPU supply at 12–16 k, coolers with LGA1700 support) | **M** | R-15 — today one GPU decides a 12 k 1440p build |
| 10 | Retention platform-cost reservation (or explicit acceptance) | **M** | R-04 |
| 11 | Beta copy for the 4 277–7 877 MAD dead zone and for zero-build passes | **S** | R-09 — the engine will not say it for you |
| 12 | Independent review of A1/A3/A4 + the E2 constants against real prices | **M** | R-11/R-12 — closes the "self-approved thresholds" objection |

Items 1–2 are safe to do this week and are pure owner actions. Item 3 is the one that decides whether
this is a platform or a demo.

---

## 11. Questions for the owner

1. **Is "beta" allowed to ship with unverified prices?** The API already labels every price
   `SEED_UNVERIFIED`/`seed_offer` and the Decision 35 waiver is pinned on. If indicative prices are
   acceptable for beta, R-01 drops from blocker to high and items 3–4 can follow the beta.
2. **Which model is the release model?** Shared now serves `launch-v2@2.4.0` (six ACTIVE rows). Decision
   57 says 2.0.0 is what is *evaluated*, and 2.4.0 is explicitly not adopted. Pick one and pin it.
3. **Is a budget-free score acceptable for beta?** Decision 60 accepted it as a measured cost. If the
   beta's promise is "we spend your budget well", R-02 must be fixed before, not after.
4. **Authorisation for the shared/EU applies** (seed 028, and the residue cleanup): both are real-database
   writes needing a recorded restore point.
5. **Which use cases are in scope?** The served vocabulary is GAMING / OFFICE / WORKSTATION; there is no
   creator/streaming/AI-ML profile in any active model. If "creator" is a target segment, that is new
   scoring work, not a label.
6. **Is the 3-build showcase the product?** `selectArchetypes` caps the selection at three pair-distinct
   builds by design. If users expect a ranked list, that cap is a product decision to revisit.
7. **EU host or the Render demo?** The demo serves the shared dev database. A beta on it means beta users
   write into the only dev database.

### Could not verify

- Last GitHub Actions run status (no `gh`, no token); CI conclusions are inferred from the workflow file
  plus local runs of the same commands.
- `npm run test:api:db` (17 tests) and `npm run eval:scenarios` — both write to the TEST branch, which this
  read-only audit did not touch.
- Whether the Render demo and shared are the same database *right now*: it answers `db:ok`, and
  `DATA_STATE.md`/OG-54 say it points at shared, but I did not inspect its environment.
- Lint/format/typecheck: none exists at the repo root (by design); `apps/web`'s own gates are out of scope.
- Any claim about the frontend's consumption of contract v1.10 beyond the presence of the pinned
  OpenAPI snapshot.
