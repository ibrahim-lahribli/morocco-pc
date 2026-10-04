# Decision Index (generated)

**GENERATED FILE — do not edit by hand.** Regenerate with `node scripts/gen-decision-index.js`
(or `npm run gen:decisions`) after any change to `docs/RECOMMENDATION_ENGINE_DECISIONS.md`.
`node scripts/gen-decision-index.js --check` exits non-zero when this file is stale.
Generated 2026-10-04 from RECOMMENDATION_ENGINE_DECISIONS.md (3846 lines).

Generated for audit finding **D5** (decision-log navigability): one row per decision with number,
title, status, date and line anchor. Every status comes from the normalized `Status:` line at the
top of its entry — nothing here is inferred — so
`grep -n "^Status:" docs/RECOMMENDATION_ENGINE_DECISIONS.md` and this table always agree.

Numbering: there are no `## Decision 4` / `## Decision 5` headings. Global Decisions 4 and 5 exist
only as the nested `### Decision 4` / `### Decision 5` under "Engine 3 contract decisions"
(Engine-3-local 4/5 double as global 4/5; `RECOMMENDATION_ENGINE_ARCHITECTURE.md` §11 cites that
section's Decision 5 for the budget rule). Engine-3-local `### Decision 1–3` are NOT global 1–3.

## Open decisions

None. All 28 global decisions (including the two nested 4/5 aliases) and all 5 Engine-3-local contracts are `RESOLVED` as of 2026-10-04.

## Global decisions (26 `## Decision` headings + 2 nested 4/5 aliases = 28)

| # | Title | Status | Date | DECISIONS.md line |
|---|---|---|---|---|
| 1 | Asymmetric UNKNOWN policy (section 3.2) | RESOLVED 2026-09-14 — asymmetric UNKNOWN policy adopted; binding for Engine 1 (see the Engine 1 readiness section). | 2026-09-14 | 119 |
| 2 | Dual-memory motherboard gap (section 6) | RESOLVED 2026-09-14 — strict motherboard memory-type match REJECT adopted; binding for Engine 1. | 2026-09-14 | 173 |
| 3 | scoring_model.configuration contract (and CONDITIONAL / UNKNOWN resolution) | RESOLVED 2026-09-14 — `scoring_model.configuration` contract and the CONDITIONAL / UNKNOWN resolution adopted. | 2026-09-14 | 226 |
| 6 | Stage 1 offer pre-selection contract | RESOLVED 2026-09-14; IMPLEMENTED 2026-09-16 — Stage 1 offer pre-selection contract. | 2026-09-14 | 672 |
| 7 | Stage 1 freshness policy (2026-09-16) | RESOLVED 2026-09-16 — Stage 1 freshness policy (30-day inclusive maximum age). | 2026-09-16 | 983 |
| 8 | Stage 1 equal-price tie-break (2026-09-16) | RESOLVED 2026-09-16 — Stage 1 equal-price tie-break (product_id ASC). | 2026-09-16 | 1068 |
| 9 | Stage 1 product-level vs variant-level offer applicability (2026-09-16) | RESOLVED 2026-09-16 — product-level vs variant-level offer applicability (STRICT exact matching). | 2026-09-16 | 1151 |
| 10 | Query-contract derivation: required_roles, use_case NULL policy, GPU-required vocabulary (2026-09-16) | RESOLVED 2026-09-16 — query-contract derivation: required_roles, use_case NULL policy, GPU-required vocabulary. | 2026-09-16 | 1252 |
| 11 | Scoring-model loader contract (2026-09-16) | RESOLVED 2026-09-16; iGPU sourcing RESOLVED 2026-09-17 (implemented) — scoring-model loader contract. | 2026-09-16 | 1408 |
| 12 | Ranking / top-K ownership and pipeline position (recorded retroactively 2026-09-19; RESOLVED 2026-09-20) | RESOLVED 2026-09-20 (recorded retroactively 2026-09-19) — ranking / top-K ownership and pipeline position (`retention/` module). | 2026-09-20 | 1713 |
| 13 | Candidate-ranking score formula (2026-09-19) | RESOLVED 2026-09-19 — candidate-ranking score formula (STEP 1-3). | 2026-09-19 | 1856 |
| 14 | `top_k_per_role` retention semantics | RESOLVED 2026-09-20 (recorded 2026-09-18; PROVISIONAL until Decisions 12 and 13 landed) — `top_k_per_role` retention semantics. | 2026-09-20 | 1989 |
| 15 | UNKNOWN pairwise-count producer (Decision 13's B1) | RESOLVED 2026-09-19 — UNKNOWN pairwise-count producer (Decision 13's B1); implemented. | 2026-09-19 | 2076 |
| 16 | Pairwise branch validation inside Engine 3's DFS | RESOLVED 2026-09-21 — pairwise branch validation inside Engine 3's DFS; implemented. | 2026-09-21 | 2165 |
| 17 | Query loader and orchestrator contract | RESOLVED 2026-09-21 — query loader and orchestrator contract; implemented. | 2026-09-21 | 2282 |
| 18 | Ranking (Engine 5a) | RESOLVED 2026-09-21; IMPLEMENTED 2026-09-22 — ranking (Engine 5a). | 2026-09-21 | 2382 |
| 19 | Persistence (Engine 5b) | RESOLVED 2026-09-21; IMPLEMENTED 2026-09-23 — persistence (Engine 5b). | 2026-09-21 | 2501 |
| 20 | Assembly diversity | RESOLVED 2026-09-22 — assembly diversity: post-ranking (CPU, GPU) pair selection (O4, `MAX_PER_PAIR = 3`); implemented. | 2026-09-22 | 2555 |
| 21 | Full-run composition contract | RESOLVED 2026-09-23; IMPLEMENTED — full-run composition contract (`orchestrator/full-run.js`). | 2026-09-23 | 2654 |
| 22 | Explanation generation (Engine 6) contract | RESOLVED 2026-09-24; IMPLEMENTED 2026-09-24 — explanation generation (Engine 6) contract; items 1–5 landed (see the UPDATE block below). | 2026-09-24 | 2762 |
| 23 | Score degeneracy: build-local UNKNOWN pairwise count (O2) + GPU/PSU connector & dimension data (O1) | RESOLVED 2026-09-27 (O1 seed 003 applied 2026-09-28; acceptance criterion 3 / PI-1 NOT built) — score degeneracy: build-local `unknown_pairwise_count` (O2) + GPU/PSU connector & dimension data (O1). | 2026-09-27 | 2951 |
| 24 | Decision 20 O4 re-evaluation on the 100-product catalog | RESOLVED 2026-09-28 — Decision 20's O4 re-evaluated on the 100-product catalog; O4 and `MAX_PER_PAIR = 3` retained unchanged. | 2026-09-28 | 3228 |
| 25 | Assembly cap starvation of the O4 diversity objective | RESOLVED 2026-09-28 — assembly cap starvation of the O4 diversity objective (`max_builds_per_query = 25` is the immediate structural blocker). | 2026-09-28 | 3315 |
| 26 | S5.2 HIGH-TGP connector escalation implemented; the four S5.3/S6 HARD rules explicitly deferred | RESOLVED 2026-09-28 — hybrid (audit D2): item A IMPLEMENTED (`GPU_PSU_CONNECTOR_NULL_HIGH_TGP`); item B (four S5.3/S6 HARD rules) EXPLICITLY DEFERRED and unenforced. | 2026-09-28 | 3417 |
| 27 | Budget-blind retention replaced by a cheapest-per-role reservation, plus a budget_floor diagnostic | RESOLVED 2026-10-02; IMPLEMENTED 2026-10-02 — budget-aware retention, cheapest-per-role reservation of 1 of K slots plus a budget_floor diagnostic on the pass result; closes OG-26 (see docs/OPEN_GAPS.md C-17), unit tests 829 -> 859 with 0 failures. | 2026-10-02 | 3571 |
| 28 | Per-cooler radiator size added to `cooler_spec`, making rule 5 reachable | RESOLVED 2026-10-04; IMPLEMENTED and APPLIED 2026-10-04 — migration `013_cooler_radiator_size.sql` adds a nullable `cooler_spec.radiator_size_mm` and seed `007_cooler_radiator_size.sql` populates the 5 liquid coolers, so rule 5's size match can now succeed instead of comparing a NOT NULL integer against `null`. | 2026-10-04 | 3827 |

## Engine 3 contract decisions (Engine-3-local numbering; local 4–5 ARE global Decisions 4–5)

| Engine-3 # | Title | Status | Date | DECISIONS.md line |
|---|---|---|---|---|
| 1 | Engine 3 input universe | RESOLVED 2026-09-14 — input universe adopted (Engine-3-local #1). | 2026-09-14 | 421 |
| 2 | REJECT handling | RESOLVED 2026-09-14 — REJECT handling adopted (Engine-3-local #2). | 2026-09-14 | 454 |
| 3 | UNKNOWN handling | RESOLVED 2026-09-14 — UNKNOWN handling adopted (Engine-3-local #3). | 2026-09-14 | 476 |
| 4 | Build assembly contract (from existing contracts) | RESOLVED 2026-09-14 — build assembly contract adopted from existing contracts (Engine-3-local #4 = global Decision 4). | 2026-09-14 | 504 |
| 5 | Budget contract | RESOLVED 2026-09-14 — budget contract adopted for incremental pruning (Engine-3-local #5 = global Decision 5). | 2026-09-14 | 576 |

## Reconciliation

- Global decisions: 28 = 26 `## Decision` headings + the 2 Engine-3-local contracts that fill global 4/5.
- Engine-3-local contracts: 5 (`### Decision 1–5` under "Engine 3 contract decisions"; local 1–3 are NOT global 1–3, local 4/5 ARE global 4/5 — AGENTS.md §2).
- Parsed headings: 26 `## Decision` + 5 `### Decision` (Engine 3 section only; `### Decision 18 addendum` is an implementation record, not an entry).
- Status source: each entry’s normalized `Status:` line (first content line). The generator exits
  non-zero if a decision is added without one, so this table cannot go stale silently.
- Open decisions: none.

Precedence when sources conflict: `AGENTS.md` §9. This file is a **lookup aid**, never a source of truth.

