# Project Status Review — `morocco-pc`

**Date:** 2026-09-28
**Scope:** whole project — goal, architecture as built, the Decisions 22–25 workstream, critique, options, remaining features, and the known / unknown issue registers.
**Method:** read-only. Sources inspected: all five docs, `package.json`, `src/recommendation/**` (54 non-test modules), `scripts/**`, `database/migrations/**`, `database/seeds/**`, git history, and live read-only queries against the shared Neon database. No file outside `docs/` was modified. Test suite run: **817 pass / 0 fail**.

Severity scale used below: **S1** blocks a stated acceptance goal · **S2** degrades or misleads an existing objective · **S3** hygiene, scale, or maintainability.

---

## 1. What the project is

A **PC-build recommendation engine for the Moroccan market**. It recommends complete PC builds from budget, use case, resolution, priorities, component compatibility, assessed performance/value, and availability/pricing.

Today it is a **Node.js library plus a PostgreSQL schema** — no HTTP server, no API layer, no UI, no auth, no job runner. Runtime dependencies are only `pg` and `dotenv`. Tests use Node's built-in runner; there is no TypeScript, no linter, no CI.

The project is driven by an unusually disciplined decision log: 26 numbered decisions, every one marked RESOLVED, each recording alternatives that were rejected and why.

---

## 2. Architecture as built

### 2.1 Four data layers, six engines

| Layer | Tables | Engine | Status |
|---|---|---|---|
| 1 — Catalog / Hardware | 26 tables (identity, specs, explicit compatibility, provenance) | Engine 1 compatibility resolver | implemented |
| 2 — Performance / Assessment | `benchmark_source`, `benchmark`, `benchmark_result`, `component_assessment`, `scoring_model` | Engine 4 scoring arithmetic | implemented; **data nearly absent** |
| 3 — Market | `store`, `store_offer`, `price_history` | Stage 1 offer pre-selection | implemented |
| 4 — Recommendation | `recommendation_profile`, `recommendation_query`, `recommendation_result`, `build_candidate`, `build_component` | Engines 2–6 | implemented; **tables empty** |

Engine 2 is split 2A/2B/2C/2D (contracts, DB loader, pool selector, hard-compatibility filter); Engine 3 is build assembly (DFS over a fixed role order with pairwise branch gating); Engine 4 is scoring; Engine 5a ranking and 5b persistence; Engine 6 explanation generation.

Notably, **GPU↔case and GPU↔PSU fit are derived from numeric specs rather than cached as compatibility rows**, while CPU↔motherboard, cooler↔socket, case↔form-factor and case↔radiator are explicit tables. That split is deliberate and correct: derive what is arithmetic, store what is not.

### 2.2 The runtime pipeline and its four entry points

```
recommendation_query (pinned id)
  → loadQueryInput            query/            Decision 10/17
  → candidate pool            candidates/       2C
  → Stage 1 offer selection   offers/
  → 2D hard-compatibility     filtering/        Decision 16
  → retention top-K per role  retention/        Decision 12/14
  → assembly (DFS)            assembly/         Engine 3, Decisions 16 + 23 O2
  → candidate + build scores  scoring/          Engine 4, Decisions 13/15/23 O2
  → ranking                   ranking/          Engine 5a, Decision 18
  → O4 pair diversity         ranking/          Decision 20 (MAX_PER_PAIR = 3)
  → explanation text          explanation/      Engine 6, Decision 22
  → persist (one txn)         persistence/ + orchestrator/commit.js   Engine 5b, Decision 19
```

Four composition entry points exist, each legitimate but overlapping:

| Entry point | Owns | Transaction |
|---|---|---|
| `filtering/pipeline.js` `filterCandidatesForRecommendation` | context load → 2D filter | none (caller-owned) |
| `assembly/pipeline.js` `assembleBuildsForRecommendation` | Steps 1→2→4 over already-loaded sources | none (DB-free) |
| `orchestrator/run.js` `runRecommendationSnapshot` | the whole read pass | `REPEATABLE READ READ ONLY`, always ends |
| `orchestrator/full-run.js` `runRecommendationFullRun` | snapshot → rank → select → explain → commit | two separate transactions |
| `orchestrator/commit.js` `runRecommendationCommit` | the one write transaction | plain `BEGIN`, two guards |

### 2.3 Where policy lives

| Concern | Single owner? |
|---|---|
| Compatibility evaluation per relationship | `compatibility/` (8 evaluators) — **yes** |
| Which roles pair with which | `filtering/filter.js` (`PAIR_EVALUATORS` + per-role lists) **and** `assembly/assemble.js` (`PAIRWISE_CHECKS`) — **no, declared twice** |
| UNKNOWN-pair counting | `assembly/assemble.js` build-local (live) **and** `filtering/filter.js` candidate-level (inert) — **two definitions** |
| Scoring formula and weights | `scoring/` + versioned `scoring_model` row — yes |
| Retention policy | `retention/retain.js` — yes |
| Diversity policy | `ranking/select-diverse.js` — yes |
| Transaction boundaries | `orchestrator/snapshot.js` and `commit.js` — yes |

### 2.4 Numbers

| | |
|---|---|
| Engine modules | 54 non-test JS files, ~10.3k LOC in `src/`; ~14.0k LOC including scripts |
| Tests | 43 test files, **817 tests, 0 failures** |
| SQL | 11 migrations + 3 seeds, ~3.4k LOC |
| Scripts | 15 (`test:unit`, `test:db`, `seed` are the only npm scripts) |
| Schema | 39 tables, 14 enums |
| Catalog | 100 products, 22 variants, 101 offers, 76 families, **25 assessments**, 1 benchmark source, 1 benchmark, 2 results, 2 stores, 101 price-history rows |
| Empty-but-present | `recommendation_profile`, all five Layer 4 tables, `spec_provenance`, `ingestion_record`, `product_candidate`, `retailer_listing_alias` — **all 0 rows** |
| Active model | `seed-minimal-v1` `1.0.0`; caps `{top_k_per_role: 5, max_builds_per_query: 25}`; `unknown_compat_penalty` 5; `neutral_baseline` 50; `no_evidence_penalty` 10 |

---

## 3. What this workstream applied

| Commit | Change |
|---|---|
| `4e70f9e` | Seed 003 — GPU `required_power_connectors` + dimensions, PSU connector counts (Decision 23 O1) |
| `1693de3` | Decision 23 O1 acceptance measurement in `scripts/measure-orchestrator.js` |
| `752e884` | Decision 20 seed-size reconciliation (15-product → 100-product catalog) |
| `bc2d737` | Decision 24 — re-evaluation of O4 pair diversity on the current catalog |
| `bfdc5b8` | Decision 25 — assembly cap starvation of the O4 objective |
| `9b0f014` | Doc-drift fixes (decision range, Engine 6 status, price-carrier item) |
| `e8d5bc7` | `CONTEXT.md` audit against the live database and code |

The substantive scientific results of this workstream:

1. **Score degeneracy is fixed** (Decision 23 O2, code) and its data half supplied (O1, seed 003). Acceptance criteria 1–2 **measured MET**: GAMING rank-1 `build_score` 58.83 with `unknown_pairwise_count` 0 and 12 distinct scores; OFFICE 57.60 with 10 distinct scores.
2. **The rank-1 build is unchanged by O1** — the same build at the same score with and without seed 003. O1's effect is strictly `UNKNOWN → PASS`, never a rank change. Attribution is now recorded rather than assumed.
3. **The 002 catalog is largely unreachable** — 18 of 20 new GPUs and 6 of 9 new PSUs never reach a build. Root cause chain: no `component_assessment` → flat 40.000 for all of them → `top_k_per_role = 5` cuts the tie → the surviving subset is decided by **random UUID order**.
4. **O4 is structurally starved**, and no `MAX_PER_PAIR` value can help: at `max_builds_per_query = 25` the assembled pool holds exactly one (CPU, GPU) pair, because DFS over `EXPANSION_ORDER` truncates before its two most-significant roles vary. Raising the cap is necessary but not sufficient — OFFICE is pair-space-bounded at 3 pairs (`k ≤ 9`) even at its exhaustive 793 builds.
5. **The case radiator matrix is missing for 6 of 10 cases** — every liquid cooler is a HARD FAIL there.

---

## 4. Critique

### 4.1 What is genuinely strong

- **The UNKNOWN/PASS/FAIL contract is honoured everywhere.** `NULL` means UNKNOWN, `0` means a verified deficit, and a test freezes the difference (`filter.test.js`, "null is never 0"). Missing data is never permissive. This is the single best decision in the codebase.
- **The engine is pure and DB-free below the orchestrator.** Ranking, selection, explanation and assembly are pure functions over frozen inputs; only loaders and the two transaction wrappers touch the database. That is why the unit suite is 817 tests deep without a database.
- **Boundary tests are real.** The persistence writer is forbidden from containing `SELECT` by its own test, so transaction control cannot leak into it.
- **The write path is race-free by construction, not by luck.** `commit.js` locks the immutable `recommendation_query` row with `SELECT … FOR UPDATE` *before* the re-run guard; two concurrent commits for the same query serialize on that lock, and at READ COMMITTED the second one's guard statement observes the first one's committed `build_candidate` rows. This is verified by reading the code, not by testing concurrency (see U4).
- **Data integrity is enforced in the schema, not only in JS** — e.g. the partial unique index `uq_build_component_role_singular` guarantees at most one CPU/MOTHERBOARD/PSU/CASE/CPU_COOLER/SSD_BOOT per candidate, and `uq_recommendation_result_query_rank` prevents duplicate ranks.
- **Seeds are idempotent and guarded** (`COALESCE`-based updates, `TEST_DATABASE_URL` isolation guard, dry-run support), and rollback-validated.
- **Column types are safe for the values the engine produces** — `explanation` is unbounded `text`, and money/score columns are unconstrained `numeric`, so there is no silent truncation or rounding rejection path.

### 4.2 Structural weaknesses (with evidence)

**W1 — Data is the bottleneck, not the engine (S1).** The engine has been feature-complete since Decision 22; what throttles it is data. 85 of 100 products have zero assessments, so by Decision 13 STEP 1 they all collapse to the same score (40.000). Combined with `top_k_per_role = 5`, that means **2 GPUs and 3 PSUs reach a build out of 20 and 9**. Every downstream diversity, spread and cap complaint in Decisions 24–25 traces back to this one hole.

**W2 — Reach is decided by a random UUID (S2).** All tied products fall through `compareCandidates` to `product_id` ascending, and `product.id` is `gen_random_uuid()`. The three surviving 002 PSUs are exactly the three smallest UUIDs. **The reachable catalog is therefore not reproducible across a database reset**, which quietly makes every reach-dependent measurement (including the Decision 23 acceptance figures) valid only for one database instance.

**W3 — Pairwise policy is declared twice and counted two different ways (S2).** `filtering/filter.js` declares `PAIR_EVALUATORS` (8 relationships) plus per-role relationship lists; `assembly/assemble.js` re-declares the same 8 relationships as `PAIRWISE_CHECKS`, adding orientation metadata (`leftIsNew`) that exists only in the second copy. The evaluators themselves are correctly shared — but the *topology* is not, so the two declarations can drift independently.

**W4 — Two incompatible definitions of the same number coexist, and one is inert (S2).** `filterCandidates` still computes a per-candidate `unknown_pairwise_count` (`filter.js:653`) using a "both participating roles' perspectives" rule that double-counts symmetric UNKNOWNs; the live build-local count (Decision 23 O2) counts each pair exactly once. Nothing reads the candidate-level value — `retention/retain.js` documents that it is never read, and no non-test module consumes it. Worse, `computeBuildScores` retains an **optional injection seam** (`unknownPairwiseCounts`) that would revive the doubled semantics and silently over-penalize scores. This is dead code that is also a trap.

**W5 — Four overlapping documents guarantee drift (S3).** `AGENTS.md` (167 lines), `CONTEXT.md` (158), `DEVELOPMENT_NOTES.md` (604), `docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md` (748) and `docs/RECOMMENDATION_ENGINE_DECISIONS.md` (3,359 lines / 200 KB) restate the same status facts with no mechanism keeping them in sync. This session alone found and fixed **five** instances: `AGENTS.md` claimed "Decisions 1–22"; `CONTEXT.md` named benchmark rows that do not exist; `CONTEXT.md` listed Engine 6 as PLANNED after Decision 22 shipped it; `ARCHITECTURE.md` still carried a resolved `DECISION REQUIRED`; and `CONTEXT.md` listed GPU connectors and PSU connector matrices as open gaps after seed 003 closed them.

**W6 — Configured caps starve the objectives they interact with (S2).** Both configured caps are smaller than the granularity of the thing they are supposed to diversify (`max_builds_per_query = 25` vs the first GPU change at ~625 nominal / ~800–1600 measured) and coarser than the tie they must break (`top_k_per_role = 5` vs 20 identically-scored GPUs).

**W7 — The same facts are asserted in prose rather than computed (S3).** The measurement harness hard-pins exact catalog counts in its preflight (`products = 100 / offers = 101 / assessments = 25`). That is good discipline for detecting surprise, but it means any acceptance check becomes a new bespoke script the moment the catalog changes — which is exactly why Decision 23's criterion 3 (PI-1 pool independence) has never been built.

**W8 — The product surface is only half-wired (S2).** `loadQueryInput` deliberately selects only five columns and **ignores `resolution`, `priority` and `recommendation_profile_id`**. `recommendation_profile` has 0 rows. So "requirements captured as recommendation profiles" — a claim in the project's own description — is not reachable end to end.

**W9 — Layer 1's data-quality machinery has no producer (S3).** `ingestion_record`, `product_candidate`, `retailer_listing_alias` and `spec_provenance` are all empty and referenced only by verification/test scripts. There is no ingestion pipeline, no URL fetch, no provenance writer. The tables encode an intent that is not implemented.

**W10 — The schema models more build shapes than the assembler can build (S3).** `component_role` allows `SSD_SECONDARY` and permits multiple GPU/RAM, and `build_component` enforces singular uniqueness only for six roles — but `EXPANSION_ORDER` is eight single-slot roles and `SSD_SECONDARY` never enters a bucket. Multi-GPU, multi-RAM and secondary storage are modelled but unreachable.

**W11 — No CI, no lint, no typecheck (S3).** `npm test` runs unit tests only; the 15 DB-level scripts are manual; nothing runs on push. Combined with W5, drift is inevitable rather than accidental.

**W12 — No offer-freshness policy is enforced (S3).** `store_offer.last_checked_at` spans 2026-09-18 to 2026-09-25 — 3 to 10 days stale today — and `price_history` is append-only with 101 rows and no compaction or retention rule. Assessment staleness has a configured decay; price staleness has nothing.

---

## 5. Options

Ranked by leverage, not by size. Effort is relative (S = a session, M = a few sessions, L = a build-out).

### Option A — Close the assessment gap (seed 004) · S1 · effort M · **do first**
Obtain (never invent) real `component_assessment` rows for the 85 unassessed products, per the per-role matrix that `002_catalog_expansion.sql` D2 already specifies. This is the only change that makes the expanded catalog score-relevant; it fixes W1 directly and defuses W2, W6 and the Decision 24/25 symptoms as a side effect.
*Tradeoff:* requires real research effort and a source-authority rule (D7) — it is data work, not code work.

### Option B — Make retention reach deterministic · S2 · effort S
Add a stable natural-key tie-break (e.g. `product.name`, then `sku`) before falling through to `product_id`. Turns W2 from "an instance-specific lottery" into a reproducible, reviewable ordering.
*Tradeoff:* changes which products win ties — it will move measured reach numbers once, deliberately and recordedly.

### Option C — Collapse the pairwise policy into one owner · S2 · effort M
Move the relationship topology (the 8 pairs **and** their canonical orientation) into `compatibility/` as a single exported registry, and have `filter.js` and `assemble.js` both read it. Replace the two near-identical walks (`firstPairFailure` early-return and `countBuildLocalUnknownPairs` full walk) with one walk returning `{ failed, unknownCount }`.
*Tradeoff:* touches two well-tested modules at once; the 817-test suite is the safety net, and `PAIRWISE_CHECKS`' orientation metadata must move rather than be re-derived.

### Option D — Delete the inert count and its revival seam · S2 · effort S
Remove the candidate-level `unknown_pairwise_count` from `filterCandidates` and drop the optional `unknownPairwiseCounts` injection from `computeBuildScores`, so exactly one definition of the penalty input exists. Eliminates W4's trap.
*Tradeoff:* `filter.test.js` pins the current field; those assertions must be retired with the field, which is a decision to record rather than an accident to absorb.

### Option E — Invert the search so pair diversity is the outer loop · S2 · effort M–L · **the big shake-up**
Replace "DFS over roles with a build cap" with "enumerate (CPU, GPU) pairs first, then fill the remaining roles per pair, respecting the budget". The pair — the thing O4 actually diversifies — becomes the top-level enumeration unit instead of something 625 builds away. This fixes W6 and the Decision 24/25 findings *structurally*: the cap stops being a diversity cliff, and OFFICE's 3-pair ceiling becomes visible as a data fact rather than a ranking artifact.
*Tradeoff:* a real Engine 3 redesign with a new decision entry, new determinism story, and a full re-measurement. It preserves the public build shape, so downstream stages need no change.

### Option F — Make documentation generated, not maintained · S3 · effort S–M
Either (a) add `scripts/verify-docs.js` asserting each factual status claim in `CONTEXT.md` against the live DB and code (counts, decision range, engine list, empty-table claims), runnable in CI; or (b) go further and generate the status tables from a small machine-readable source. Directly attacks W5, which has now cost five corrections in one session.
*Tradeoff:* (a) is cheap and immediately valuable; (b) is better but changes how the docs are authored, so it needs a recorded decision.

### Option G — Add CI · S3 · effort S
Run `npm run test:unit` on push, plus a doc-drift check (F) and the DB verification scripts against the test branch. Nothing else in this list stays fixed without it.
*Tradeoff:* needs a database secret in CI; the unit suite needs none, so a lint+unit gate alone is already worth it.

### Option H — Rework the role model to match the schema · S3 · effort M
Either implement multi-slot roles (`SSD_SECONDARY`, multiple RAM/GPU) or narrow the enum and the singular-uniqueness index to what the assembler can actually build. Ambiguity here is a latent source of wrong assumptions.
*Tradeoff:* implementing multi-slot expands the search space and interacts with E.

### Option I — Materialize a compatibility/score snapshot · S2 · effort L
Precompute a catalog-level matrix (per product pair: verdict + effective score) into an immutable snapshot referenced by `recommendation_query`. This would collapse W3/W4 into one evaluation pass, make reach analyzable offline, make runs reproducible, and make raising the cap cheap. It is also the natural home for the "reproducible artifact" idea.
*Tradeoff:* introduces a materialization/refresh lifecycle that does not exist yet — a real architectural commitment, and premature until A lands.

---

## 6. Remaining features

| # | Feature | Status | Blocked by |
|---|---|---|---|
| F1 | Real `component_assessment` data for the 85 new products | **not started** — the top backlog item | research (seed 004) |
| F2 | Case radiator matrices for the 6 cases with zero rows | not started | research |
| F3 | Resolved GPU dimensions for the 7 variants still NULL | partially done (seed 003) | research (unresolved vendor identities) |
| F4 | PSU connector detail for 3 deliberately-NULL rows | partially done | research (vendor specs unavailable) |
| F5 | Decision 23 criterion 3 — PI-1 pool-independence regression | **not built** | needs its own script (W7) |
| F6 | Recommendation profile / resolution / priority wiring | not built | W8 — loader ignores the columns |
| F7 | Ingestion pipeline (URL fetch → `product_candidate` → verification → `spec_provenance`) | not built | greenfield |
| F8 | Offer refresh / price monitoring and `price_history` retention | not built | greenfield (W12) |
| F9 | Multi-slot build roles (`SSD_SECONDARY`, multi-RAM, multi-GPU) | not built | W10 |
| F10 | Deterministic tie-break in retention | not built | W2 |
| F11 | HTTP/API surface, auth, scheduling, observability | not built | by design — no service yet |
| F12 | CI + lint + typecheck | not built | W11 |
| F13 | Fresh 001→011 migration proven on an empty database | **VERIFIED 2026-09-30** | ran on a throwaway Neon DB — see U1 / OG-13 in `docs/OPEN_GAPS.md` |
| F14 | Doc-drift guard | not built | W5 |

---

## 7. Known issue register

| ID | Issue | Sev | Evidence |
|---|---|---|---|
| K1 | Data starvation: 85/100 products unassessed; flat 40.000; only 2 GPUs and 3 PSUs from seed 002 reach a build (18/20 and 6/9 never leave the candidate pool) | S1 | measured on the test branch; `top_k_per_role = 5` |
| K2 | Retention tie-break falls through to random `product_id`; reach is not reproducible across a database reset | S2 | the 3 surviving PSUs are exactly the 3 smallest UUIDs |
| K3 | Assembly cap starvation: at `max_builds_per_query = 25` the pool holds exactly one (CPU, GPU) pair, so O4 provides zero diversity and truncates persistence 10 → 3 | S2 | Decision 25; measured cap sweep |
| K4 | OFFICE pair space is bounded at 3 pairs regardless of cap (`k ≤ 9 < TOP_N_PERSISTED = 10`), so persistence under-fills | S2 | 793-build exhaustive run |
| K5 | Case radiator matrix absent for 6 of 10 cases → every liquid cooler is a HARD FAIL there | S2 | `case_radiator_support` = 7 rows over 4 cases |
| K6 | Pairwise relationship topology declared twice (`filter.js` and `assemble.js`) | S2 | W3 |
| K7 | Candidate-level `unknown_pairwise_count` is computed but never read, and uses a different (double-counting) definition than the live build-local count; `computeBuildScores` retains an injection seam that would revive it | S2 | W4; `retain.js` documents "never read" |
| K8 | Layer 4 tables empty in the shared database; the write path is proven only on the isolated test branch | S3 | all five tables 0 rows |
| K9 | Four overlapping status documents drift independently; five instances corrected this session | S3 | W5 |
| K10 | No CI, lint or typecheck; DB scripts are manual | S3 | no `.github`, no lint/ts config |
| K11 | `resolution` / `priority` / `recommendation_profile_id` are not selected by the query loader and `recommendation_profile` has 0 rows | S2 | `load-query-input.js` documents the exclusion |
| K12 | Layer 1 data-quality tables have no producer; all 4 are empty | S3 | ingestion/provenance counts = 0 |
| K13 | Multi-slot roles are modelled in the schema but unreachable in the assembler | S3 | `EXPANSION_ORDER` is 8 single-slot roles |
| K14 | Read pass and write pass are separate transactions, so a persisted result can reflect a snapshot that no longer matches live data (the guard prevents double-writes, not staleness) | S3 | `full-run.js`, `snapshot.js`/`commit.js` |
| K15 | Offers are 3–10 days stale with no refresh mechanism; `price_history` grows without retention | S3 | `last_checked_at` 2026-09-18…09-25 |
| K16 | Decision 23 acceptance numbers are instance-specific because reach depends on UUIDs (direct consequence of K2) | S3 | Decision 23 amended record |

---

## 8. Unverified / unknown-risk register

Honest separation: things **not checked**, as opposed to things found wrong.

| ID | Unverified area | Why it matters | How to settle it |
|---|---|---|---|
| U1 | Fresh `001 → 011` migration on an empty database | ~~The live schema may have drifted from the migrations; the project has never proven a from-scratch build~~ settled 2026-09-30: replay is faithful (39/39 tables, 336/336 columns, 14/14 enums); only live-has-more benchmark drift remains | **DONE 2026-09-30** — run on a throwaway Neon DB and diffed vs live; drift tracked as OG-25 in `docs/OPEN_GAPS.md` |
| U2 | Whether `TEST_DATABASE_URL`'s branch is still parent-identical to the shared database | Write tests and acceptance measurements are only meaningful if the branch matches the catalog they claim to describe | Compare row counts and a content digest between the branch and its parent |
| U3 | Behaviour at real catalog scale (only ever 100 products; 35,982 builds at raised cap) | Nothing is known about runtime, memory or ranking quality at thousands of products | Synthesize a large catalog on a branch and measure |
| U4 | Concurrency of the commit guards | Race-freedom is reasoned from `FOR UPDATE` + READ COMMITTED, never demonstrated with two live connections | Two concurrent `runRecommendationCommit` calls for one query on a branch |
| U5 | Rollback and mid-transaction failure paths against real PostgreSQL | The commit/snapshot semantics are unit-tested against fakes | Inject a failure between the guards and `persistRanked` on a branch |
| U6 | Currency handling beyond MAD | No FX, rounding or mixed-currency policy is exercised | Review `currency` propagation and decide whether it is validated |
| U7 | Explanation content quality | Text is persisted and validated non-empty, but never judged for usefulness, length or repetition | Read persisted explanations from a real full run |
| U8 | Automated schema-vs-live drift detection | Verification scripts exist but are manual; nothing gates a schema change | Add a schema digest check to CI |
| U9 | Error-taxonomy consistency across modules | `ERROR_CODES` is shared, but no test asserts the vocabulary is applied uniformly | Audit `fail(...)` call sites per module |
| U10 | Performance budgets | No timing assertions anywhere; the raised-cap run took an unknown amount of wall time | Add a timing harness to `measure-orchestrator.js` |
| U11 | Backup / restore and Neon branch lifecycle | The shared database is described as non-disposable with no documented recovery path | Document and rehearse a restore on a branch |
| U12 | Provenance coverage for seed data | `spec_provenance` is empty even though seed 003 cites source URLs in its header comments | Decide whether seed provenance belongs in the table rather than comments |
| U13 | Whether the decision log's heading count matches its numbering | **VERIFIED 2026-09-28 (audit D5):** 26 decisions = 24 `## Decision` headings + the 2 Engine-3-local contracts that fill global 4/5; Engine-3-local 1–3 are a separate numbering space — reconciled mechanically by `npm run gen:decisions` | ~~Walk the headings and reconcile~~ — closed; see `docs/DECISION_INDEX.md` |

---

## 9. Recommended next three moves

1. **Seed 004 — real assessments for the 85 unassessed products (Option A).** Nothing else changes outcomes until this lands; it is the root of K1 and the reason Decisions 24–25 read as they do.
2. **Option D + Option B together (delete the inert count, make reach deterministic).** Both are small, both are pure cleanup of existing behaviour, and together they remove the two hazards that make every measurement fragile (K7, K2/K16).
3. **Options F + G (doc-drift guard in CI).** The cheapest structural fix with the highest ongoing return: it retires W5 and W11 with one small script, and it is the only thing that keeps this report's own claims from decaying.

Option C (single pairwise owner) is the best pure-architecture refactor and pairs naturally with D. Option E is the transformation to reach for once the data is in: it is the one change that fixes the diversity objective by design rather than by tuning a constant.
