# Recommendation runtime - loaders and transaction contract

Status: CURRENT for sections 1, 14 and 15 (moved verbatim); the ownership section below describes the
TARGET boundary (RFC section 11.5) and is not yet extracted. This document owns the **database-facing half** of the engine contract. It was split
out of `docs/engine/ARCHITECTURE.md` on 2026-11-11 (Roadmap Step 2, RFC §16.5). The moved text is
verbatim; section numbers are those of the original document so that existing "section 1/14/15"
citations in decisions and code comments keep resolving.

The engine half stays in [`../../../docs/engine/ARCHITECTURE.md`](../../../docs/engine/ARCHITECTURE.md).
It remains a design baseline: the decisions in `docs/RECOMMENDATION_ENGINE_DECISIONS.md` and the code
are authoritative where they disagree.

## Transaction and loader ownership (TARGET boundary)

The pure stages never touch the database. Everything below is the responsibility of the future `recommendation-runtime` project. Today every module named here lives under `src/recommendation/` (for example `src/recommendation/orchestrator/run.js`):

- **Loaders** read the tables listed in section 1 and hand plain rows/objects to the stages:
  `candidates/loader`, `filtering/context-loader`, `scoring/load-*`, `offers/`, `query/`.
- **The read snapshot** is opened by the caller: `orchestrator/run.js` runs stages 1-10 inside a
  caller-owned `REPEATABLE READ READ ONLY` transaction, so one pass sees one consistent catalog.
- **The write transaction** is single and owned by `orchestrator/commit.js`
  (`orchestrator/full-run.js` composes snapshot -> rank -> diversity -> explanation -> commit).
  Its re-run guard keys on `build_candidate` only (Decision 19.2); every other writer in it must
  therefore be REPLACE-style to stay idempotent.
- **Price snapshots** are written by the commit, never re-read afterwards (section 15).
- **Environment and credentials** are read by the API/CLI bootstrap, not by these modules: the
  runtime receives a connected client and never reads `process.env`.

Write safety (unchanged): write-capable tests run against `TEST_DATABASE_URL` through
`packages/database-guard/src/index.js`; a real-database write needs a recorded restore point. See
`docs/database/recipes/` and the root `AGENTS.md` hard rules.

---

## 1. Ground truth: implemented schema the engine may use

### Identity / hardware (Layer 1, migrations 003-005)

* `product` (canonical identity), `product_variant`, `product_family`
* One-to-one spec tables (PK = FK): `cpu_spec`, `gpu_board_spec` (keyed by
  `product_variant_id`), `motherboard_spec`, `ram_spec`, `ssd_spec`,
  `psu_spec`, `case_spec`, `cooler_spec`
* Lookups: `socket`, `platform` (platform -> socket), `memory_type`,
  `chipset`, `gpu_chipset`
* Architectural rule: NULL in any spec column means UNKNOWN, never permissive.

### Compatibility (migrations 003 and 006)

* `cpu_motherboard_support`: motherboard_product_id, cpu_product_family_id XOR
  cpu_product_id, `support_status compatibility_status`, `min_bios_version`.
  The ONLY compatibility table whose rows can express all four statuses for
  CPU<->motherboard.
* `cooler_socket_support`: cooler_product_id, socket_id,
  `support_status compatibility_status`.
* `case_motherboard_form_factor`: presence-only (no status column). A row
  means "case supports this form factor". Absence of a row means UNKNOWN.
* `case_radiator_support`: presence-only (radiator_size_mm, position).
* `platform_memory_support`: presence-only (platform_id, memory_type_id).
* GPU->case and GPU->PSU have NO tables by design (migration 006 header);
  they are DERIVED from `gpu_board_spec` vs `case_spec` / `psu_spec` numerics.

### Knowledge / assessment (Layer 2, migration 008)

* `benchmark_source`, `benchmark`, `benchmark_result` (observed measurements
  only; deliberately no recommendation weights).
* `component_assessment`: product_id, `assessment_type` enum (PERFORMANCE,
  VALUE, QUALITY, UPGRADEABILITY, THERMALS, EFFICIENCY), nullable `score`
  (CHECK 0-100), `rating`, `confidence confidence_level`, `source_type`,
  `assessed_at`.
* `scoring_model`: UNIQUE(name, version), `configuration JSONB`, `is_active`.

### Market (Layer 3, migration 009)

* `store` (is_active, country_code, currency_code)
* `store_offer` (product_id, product_variant_id nullable, `price > 0`,
  `currency`, `availability`, `last_checked_at`)
* `price_history` (append-only; NOT used for current price by the engine)

### Recommendation / build (Layer 4, migration 011 canonical)

* `recommendation_profile` (name UNIQUE, use_case, priority INTEGER,
  default_resolution)
* `recommendation_query` (profile FK, `scoring_model_id NOT NULL`,
  `budget_amount > 0` CHECK, `currency`, `use_case`, `priority`, `resolution`)
* `build_candidate` (query FK, `total_price` NULL-or->0,
  `compatibility_status NOT NULL DEFAULT 'UNKNOWN'`, `score` NULL-or-0..100)
* `build_component` (candidate FK, product_id NOT NULL, product_variant_id
  nullable, `component_role` enum: CPU, GPU, MOTHERBOARD, RAM, SSD_BOOT,
  SSD_SECONDARY, PSU, CASE, CPU_COOLER; `selected_price > 0`, `currency`,
  `store_id` nullable, `price_checked_at` TIMESTAMPTZ nullable;
  CHECK: store_id IS NULL OR price_checked_at IS NOT NULL; UNIQUE singular
  roles: CPU, MOTHERBOARD, PSU, CASE, CPU_COOLER, SSD_BOOT; GPU / RAM /
  SSD_SECONDARY may be multiple)
* `recommendation_result` (query FK, candidate FK, `rank` NULL-or->0,
  UNIQUE non-NULL rank per query, `explanation TEXT`)
* Enum `compatibility_status` = PASS | FAIL | UNKNOWN | CONDITIONAL.

---

## 14. Reproducibility

A future debugging session must be able to answer: "Why did this build rank #1?"
Inputs that influence a result, and where they live (NO new fields needed):

* Query: `recommendation_query` row (profile, budget, currency, use_case,
  priority, resolution, created_at).
* Scoring model: `recommendation_query.scoring_model_id` ->
  `scoring_model` (name, version, configuration JSONB). Versioned; never
  mutate a used configuration - create a new version row.
* Assessments: `component_assessment` rows (with `assessed_at` and
  `confidence`) for every build_component product.
* Compatibility decisions: `build_candidate.compatibility_status` plus the
  compatibility tables as they were (append + explicit FAIL/UNKNOWN rows are
  auditable via `spec_provenance` for Layer 1 rules).
* Prices: `build_component.selected_price`, `currency`, `store_id`,
  `price_checked_at` - the immutable snapshot.
* Product/spec data: Layer 1 tables (changes are auditable via `spec_provenance`
  and `updated_at` on product/product_variant).
* Selected offers: `build_component.store_offer_id` (migration 018, Decision 35)
  names the exact listing and `offer_class` records its Decision 35 class; the
  snapshot-side locator (product_id, store_id, price_checked_at) still resolves
  the same row for pre-018 components, where the id is NULL.
* Engine version / configuration: the scoring_model version doubles as the
  engine configuration version, and since migration 019 (Decision 46) the pass
  persists `recommendation_result.engine_version`, `.strategy_key` and
  `recommendation_query.budget_floor`, so which binary produced each rank is
  recorded rather than inferred (CLOSED - was the OG-18 gap, C-40).

Re-run rule: executing the engine again against the SAME database state,
query inputs, and scoring_model version must produce identical candidates,
scores, ranks and explanations.

## 15. Price snapshot behavior

The build must not depend on mutable current offer data after creation because:

1. `store_offer.price` and `availability` change constantly (re-scrapes);
   a recommendation would silently "change" its total price.
2. Offers can be deleted or re-keyed; FKs would break or dangle.
3. Reproducibility (section 14) requires the exact prices that were used at
   decision time - that is precisely what `selected_price` + `currency` +
   `price_checked_at` capture per component.
4. `store_offer.last_checked_at` reflects the SCRAPE time, not the decision
   time; only `build_component.price_checked_at` reflects the decision moment.

Therefore: `store_offer` is read while a build is being priced (candidate
selection, offer pre-selection, assembly and the snapshot write). After
persistence the recommendation path never JOINS `store_offer` to price a build
again - the snapshot columns are the price - but `build_component.store_offer_id`
and `.offer_class` (migration 018, Decision 35) do persist WHICH listing that
price came from, so a component stays traceable without making its price
mutable.
