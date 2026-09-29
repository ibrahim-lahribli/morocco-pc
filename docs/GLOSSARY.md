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
| pair / relationship | One of the 8 implemented pairwise relationships: `cpu_motherboard`, `cooler_socket`, `motherboard_memory`, `platform_memory`, `case_form_factor`, `case_radiator`, `gpu_case`, `gpu_psu`. |
| pair evaluator | The pure function in `src/recommendation/compatibility/` that resolves one relationship to a verdict. |
| pairwise branch gating | Engine 3 prunes a DFS branch as soon as any pair involving the just-picked role FAILs (Decision 16). Only FAIL prunes; UNKNOWN continues. |
| topology | Which roles pair with which, and in which orientation. Declared twice today — `filtering/filter.js` `PAIR_EVALUATORS` and `assembly/assemble.js` `PAIRWISE_CHECKS` (status review W3/K6). |

## Pipeline and quantities

| Term | Meaning |
|---|---|
| Engine 1–6 | Compatibility resolver; offer pre-selection; build assembly (DFS); scoring; ranking (5a) + persistence (5b); explanation generation. |
| build candidate | One complete, hard-compatible role assignment surviving assembly, with its own `build_score`. |
| `top_k_per_role` | Retention cap: how many candidates per role survive `retention/retain.js` (configured, currently 5). |
| `max_builds_per_query` | Assembly cap: the DFS halts once this many builds exist (configured, currently 25). Starves the O4 objective — Decision 25. |
| pair value | The (CPU, GPU) pair identity that O4 diversity selection (`ranking/select-diverse.js`) spreads results over. |
| `MAX_PER_PAIR` | Max persisted builds sharing one (CPU, GPU) pair (Decision 20; currently 3). |
| retention reach | Which tied products survive `top_k_per_role`. Currently UUID-random on ties (AGENTS.md §5, K2). |
| `unknown_pairwise_count` | Count of UNKNOWN pairs in a build; penalizes `build_score` (Decision 23 O2). The live definition is build-local, one count per pair. A candidate-level variant in `filter.js` is inert (W4/K7). |
| `priceKey` | Offer pre-selection's equal-price tie-break identity (Decision 8; product-level vs variant-level offer applicability, STRICT exact matching). |
| O1 / O2 | Decision 23's two objectives: O1 = GPU/PSU connector + dimension data (seed 003), O2 = build-local `unknown_pairwise_count`. |
| PI-1 | Decision 23 criterion 3: pool-independence regression — builds must not depend on unrelated catalog rows. Not yet built (F5). |
| no-evidence branch | The §9 scoring policy: an unevidenced product scores `neutral_baseline − no_evidence_penalty` (40.000 on current config). Unevidenced products tie each other; see Decision 23's degeneracy root cause. |

## Identifiers and conventions

| Term | Meaning |
|---|---|
| `Decision N` | An engine decision in `docs/RECOMMENDATION_ENGINE_DECISIONS.md` (Decisions 1–26). |
| `D2` (bare) | A seed-file header decision — e.g. `002_catalog_expansion.sql` D1–D8 or `003_gpu_psu_connector_data.sql` D1–D9. **Collision hazard:** bare `D2` ≠ `Decision 2`. This collision already caused one recorded correction (`DECISIONS.md:2810`). Write "seed 002 Dn" or "Decision n" unambiguously. |
| `OG-nn` | A row in `docs/OPEN_GAPS.md`, the consolidated open-gap register. |
| `K1–K16` / `U1–U13` / `W1–W12` | Registers in `docs/PROJECT_STATUS_REVIEW_2026-09-28.md`: known issues, unverified areas, structural weaknesses. |
| `An` (audit) | A recommendation in `docs/DOCUMENTATION_AUDIT_2026-09-28.md` §4 (A1–A12); `Dn` (audit) = its finding D1–D12. Another `Dn` collision — scope it ("audit D2") when ambiguous. |
| `RESOLVED / OPEN / DEFERRED / UNVERIFIED` | Status vocabulary for audit findings and gap-register rows. DEFERRED means recorded with a binding re-check trigger, not forgotten. |
