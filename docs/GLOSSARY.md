# Glossary

The repository's load-bearing vocabulary. Terms are defined by the decision log
(`docs/RECOMMENDATION_ENGINE_DECISIONS.md`) and the architecture contract
(`docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md`); this file is a lookup, not a
source of truth. When a term here and a decision entry disagree, the decision wins.

## Compatibility vocabulary

| Term | Meaning |
|---|---|
| `PASS \| FAIL \| UNKNOWN \| CONDITIONAL` | The four-status compatibility vocabulary (enum `compatibility_status`). CONDITIONAL exists only for CPU↔motherboard BIOS (see `min_bios_version`). |
| `NULL = UNKNOWN` | A missing spec value means UNKNOWN — never "unlimited", never PASS, never 0. Frozen by a test (`filter.test.js`, "null is never 0"). |
| `0 = verified deficit` | An explicit count of 0 (e.g. PSU has zero 12VHPWR connectors) is a verifiable FAIL, the opposite of NULL. |
| verdict | The final `PASS/FAIL/UNKNOWN/CONDITIONAL` of one pairwise evaluation. |
| pair / relationship | One of the 11 implemented pairwise relationships. The original eight: `cpu_motherboard`, `cooler_socket`, `motherboard_memory`, `platform_memory`, `case_form_factor`, `case_radiator`, `gpu_case`, `gpu_psu`. E8 (Decision 45) appended three: `cooler_tdp`, `mb_memory_slots`, `mb_memory_capacity` — appended, so every pre-E8 relationship keeps its precedence for reason and decisive-partner selection. |
| pair evaluator | The pure function in `src/recommendation/compatibility/` that resolves one relationship to a verdict. |
| pairwise branch gating | Engine 3 prunes a DFS branch as soon as any pair involving the just-picked role FAILs (Decision 16). Only FAIL prunes; UNKNOWN continues. |
| topology | Which roles pair with which, and in which orientation. Declared twice today — `filtering/filter.js` `PAIR_EVALUATORS` and `assembly/assemble.js` `PAIRWISE_CHECKS` (status review W3/K6). |

## Pipeline and quantities

| Term | Meaning |
|---|---|
| Engine 1–6 | Compatibility resolver; offer pre-selection; build assembly (DFS); scoring; ranking (5a) + persistence (5b); explanation generation. |
| build candidate | One complete, hard-compatible role assignment surviving assembly, with its own `build_score`. |
| `top_k_per_role` | Retention cap: how many candidates per role survive `retention/retain.js` (a configured UNIFORM default, 5 on the launch-v2 pins). Since Decision 59 a model may override it per role with `candidate_caps.top_k_by_role`; `launch-v2@2.4.0` declares CPU 10, so there the CPU bucket is 10 and the other seven roles stay at 5. |
| `max_builds_per_query` | Assembly cap: the DFS halts once this many builds exist (configured, currently 25). Starves the O4 objective — Decision 25. |
| pair value | The (CPU, GPU) pair identity that O4 diversity selection (`ranking/select-diverse.js`) spreads results over. |
| `MAX_PER_PAIR` | Max persisted builds sharing one (CPU, GPU) pair (Decision 20; 3). **No longer the pre-persistence showcase:** Decision 41 replaced `selectDiverseTop` with `selectArchetypes` (three pair-distinct builds, one per strategy), so the cap now governs only the retained `select-diverse.js` walk that reproducibility and `measure-api-pass-phases.js` still use. |
| retention reach | Which tied products survive `top_k_per_role`. NOT random: `compareCandidates` breaks ties on `product_id` ASC (then `product_variant_id`, NULL-first then ASC), so a given database state is reproducible — but the ids are `gen_random_uuid()`, so WHICH tied rows exist is an instance-specific draw and a reach figure is never a property of the catalog (AGENTS.md §5; `docs/DATA_STATE.md`). |
| `unknown_pairwise_count` | Count of UNKNOWN pairs in a build; penalizes `build_score` (Decision 23 O2). The live definition is build-local, one count per pair. A candidate-level variant in `filter.js` is inert (W4/K7). |
| `priceKey` | Offer pre-selection's equal-price tie-break identity (Decision 8; product-level vs variant-level offer applicability, STRICT exact matching). |
| O1 / O2 | Decision 23's two objectives: O1 = GPU/PSU connector + dimension data (seed 003), O2 = build-local `unknown_pairwise_count`. |
| PI-1 | Decision 23 criterion 3: pool-independence regression — builds must not depend on unrelated catalog rows. **BUILT and PASS since 2026-10-05:** `npm run verify:pi1` inserts an inert probe PSU in its own family, re-runs GAMING and OFFICE, asserts no pre-existing `build_score` moved, and removes the probe; TEST branch only, own cleanup asserted. |
| no-evidence branch | The §9 scoring policy: an unevidenced product scores `neutral_baseline − no_evidence_penalty` (40.000 on current config). Unevidenced products tie each other; see Decision 23's degeneracy root cause. |
| `budget_floor` | Decision 27's per-pass diagnostic: the cheapest retained `selected_price` per `BUDGET_FLOOR_ROLES` (EXPANSION_ORDER minus GPU), plus `cheapest_total` / `within_budget` / `missing_roles`. Persisted on `recommendation_query.budget_floor` (jsonb) since Decision 46 / migration 019. `cheapest_total` and `within_budget` are `null` — never `0` — when a required role is missing. |
| `strategy_key` | The E4 archetype (Decision 41) that nominated a rank: `PERFORMANCE` / `BALANCED` / `VALUE`. Persisted per result row on `recommendation_result.strategy_key` since Decision 46 / migration 019. An identifier for provenance, not user-facing prose. |
| pass facts | The three facts a pass persists ABOUT ITSELF inside its own write transaction: `budget_floor` (query row) and `engine_version` + `strategy_key` (result rows). Threaded as the commit wrapper's OPTIONAL 5th argument (Decision 46): an `undefined` argument persists none, a `null` VALUE means "this pass did not know". |

## Identifiers and conventions

| Term | Meaning |
|---|---|
| `Decision N` | An engine decision in `docs/RECOMMENDATION_ENGINE_DECISIONS.md`; the generated `docs/DECISION_INDEX.md` carries the current set and `verify:docs` pins its count, so no range is cited here (a hand-kept range drifts). |
| `D2` (bare) | A seed-file header decision — e.g. `002_catalog_expansion.sql` D1–D8 or `003_gpu_psu_connector_data.sql` D1–D9. **Collision hazard:** bare `D2` ≠ `Decision 2`. This collision already caused one recorded correction (`DECISIONS.md:2810`). Write "seed 002 Dn" or "Decision n" unambiguously. |
| `OG-nn` | A row in `docs/OPEN_GAPS.md`, the consolidated open-gap register. |
| `K1–K16` / `U1–U13` / `W1–W12` | Registers in `docs/PROJECT_STATUS_REVIEW_2026-09-28.md`: known issues, unverified areas, structural weaknesses. |
| `An` (audit) | A recommendation in `docs/DOCUMENTATION_AUDIT_2026-09-28.md` §4 (A1–A12); `Dn` (audit) = its finding D1–D12. Another `Dn` collision — scope it ("audit D2") when ambiguous. |
| `RESOLVED / OPEN / DEFERRED / UNVERIFIED` | Status vocabulary for audit findings and gap-register rows. DEFERRED means recorded with a binding re-check trigger, not forgotten. |
| `engine_version` vs `served_by.engine_version` | A same-name collision worth scoping, like the seed 002 `D2` above. `engine_version` is the deploy that RAN the pass, persisted on each `recommendation_result` row (Decision 46) and `null` for a zero-build pass (which writes no result row). `served_by.engine_version` is the deploy that ANSWERED the HTTP request — the process's `ENGINE_VERSION`, always populated. Two different questions; the API contract carries both. |
| `catalog_version` | The catalog state a pass ran against (Decision 47, Platform P1 Sprint 4): a **CONTENT DIGEST** — 32 lowercase hex characters — of the catalog tables the read-path loaders touch, computed on demand by `catalogVersion(db)` (one `SELECT`) and never cached as a value of its own. Content-derived, not a clock watermark: this schema has **0 triggers**, and `updated_at` has advanced on 0 of 104 products and 0 of 19 CPUs, so a max-`updated_at` watermark is stale after exactly the in-place corrections (seed 010's cooler heights) that must invalidate a cache. Audit stamps (`*_at`) are excluded so the value cannot depend on the session `TimeZone`. Persisted only as a FACT on a row produced under it — a nullable `catalog_version` column on `recommendation_query`, plus the preset table's own — where `NULL` = UNKNOWN and a dedupe must treat it as a MISS, never a match. |
| canonical product key | `product.slug` (Decision 47, migration 020): the portable, human-facing identity for anything persisted beyond one pass — preset rows, dedupe keys, share links, API payloads. Unique-enforced (`uq_product_slug`), format-constrained (`chk_product_slug_format`), populated on every row on both databases, and stable by policy (020 fills NULLs only, never overwrites). **`product.id` is the internal row identity, never the portable key** (`gen_random_uuid()`; a re-import re-mints it). `slug` is nullable, so a slug-less row's identifier is UNKNOWN — refuse, never mint. `(manufacturer_id, manufacturer_part_number)` is the semantic natural key the catalog does NOT yet carry (0/104 and 0/100 populated, and nullable, so unconstrainable); its re-check trigger is the first non-NULL MPN. Stability holds WITHIN one catalog instance — a full re-import can re-slug — so cross-instance identity is UNKNOWN today. |
