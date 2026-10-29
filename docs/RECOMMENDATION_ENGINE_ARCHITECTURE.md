# Recommendation Engine Architecture

Status: ARCHITECTURE REVIEW ONLY at writing (2026-09-12). No engine code, no schema changes, no seeds then.

**SUPERSESSION NOTICE (added 2026-09-28, audit D4).** All six engines (sections 2 and 17) are now
IMPLEMENTED. This document is the original design baseline - read it for intent, NOT for current
behaviour. Known superseded passages, each marked inline below:

| Where | Superseded claim | By |
|---|---|---|
| S2 stage table rows 7-9, S13 | rank assigned after persistence; scoring before assembly | **Decision 18** (rank runs before the single write txn; scoring stays at stage 5) |
| S11 hard cap example | quoted 500 builds per query | shipped max_builds_per_query = **25** (scoring_model.configuration) |
| S13 third sort key | candidate created order / candidate id ASC | **Decision 18.3**: build_score DESC -> total_price ASC -> signature ASC (code-unit compare) |
| S13 templates | versioned with the scoring model | templates are code constants in explanation/explain.js; NOT model-versioned |
| S5.2 connector rule | high-TGP GPU (>=200W) + NULL connector count -> REJECT | **IMPLEMENTED BY DECISION 26** (2026-09-28): Rule 11 returns FAIL `GPU_PSU_CONNECTOR_NULL_HIGH_TGP` when a required, KNOWN connector's PSU availability is NULL and `gpu_board_spec.board_tgp_watts >= 200`; the escalation is decided BEFORE the unknown-name branch, so FAIL outranks UNKNOWN. Before that Rule 11 returned UNKNOWN unconditionally - its own design, never a decision |
| S5.3/S6 four HARD rules | cooler TDP, cooler height, RAM slots, RAM capacity | **SUPERSEDED 2026-10-14 by Decision 45 (E8):** all four ship. Three are HARD (AIR-cooler height, RAM slots, RAM capacity -> REJECT); cooler TDP is SOFT on purpose (UNKNOWN, never a REJECT). See "Current enforcement status" below |
| S3 definitive hard list (11 items) | omits all four rules above even though S5.3/S6 call them HARD (internal inconsistency; found by the D2 verification) | audit D2: the list is incomplete as written - item 9 is the only connector rule, and no cooler-TDP / cooler-height / RAM-slot / RAM-capacity item exists. SUPERSEDED 2026-10-14: the four rules ARE implemented (Decision 45/E8), so this cell now records the original inconsistency only - the S3 banner below points to the enforcement table |

### Current enforcement status of the once-deferred rules (2026-10-29)

Decision 26 item B deferred four rules on 2026-09-28 and this document recorded
each deferral inline. **Decision 45 (E8, 2026-10-14) implemented all four**, so
this table is now their single home: the historical notes elsewhere in this
document point here instead of restating a status they can no longer get right.

| Rule | Shipped verdict | Module | Class |
|---|---|---|---|
| S5.3 cooler `max_tdp_watts` vs CPU `tdp_watts` | under-spec cooler -> **UNKNOWN** `COOLER_TDP_INSUFFICIENT`; a NULL operand -> UNKNOWN `COOLER_TDP_UNKNOWN` | `compatibility/cooler-tdp.js` | **SOFT on purpose** - a vendor TDP is a marketing figure, so the shortfall is a penalty, never a reject |
| S5.3 AIR-cooler `height_mm` vs `case_spec.max_cpu_cooler_height_mm` | taller than the published clearance -> **FAIL** `COOLER_TOO_TALL` -> candidate REJECT; a NULL operand -> UNKNOWN `COOLER_HEIGHT_UNKNOWN`; LIQUID coolers are out of scope, not UNKNOWN | `compatibility/cooler-height.js` | HARD |
| S6 `ram_spec.module_count` vs `motherboard_spec.dimm_slots` | more modules than slots -> **FAIL** `RAM_SLOTS_EXCEEDED` -> REJECT; a NULL operand -> UNKNOWN `RAM_SLOTS_UNKNOWN` | `compatibility/memory-slots.js` | HARD |
| S6 `module_count * capacity_per_module_gb` vs `max_memory_capacity_gb` | over capacity -> **FAIL** `RAM_CAPACITY_EXCEEDED` -> REJECT; a NULL operand -> UNKNOWN `RAM_CAPACITY_UNKNOWN` | `compatibility/memory-capacity.js` | HARD |

Every boundary is INCLUSIVE (`<=` passes) and a NULL operand is UNKNOWN, never
PASS. The radiator and AIR-height rules ride the same CPU_COOLER <-> CASE node,
so the engine registers **eleven relationship keys and twelve verdicts**, in
BOTH topology sites (`filtering/filter.js` and `assembly/assemble.js`); the
second site re-checks the same pairs during the Engine 3 walk.

Two gates keep this table true. `node scripts/check-deferred-rules.js` measures
all four rules against the live catalog and the compatibility-reachable scope,
and is the binding pre-merge re-check for any CPU/cooler/case/RAM/motherboard
seed. `npm run verify:docs` (check 9, `engine-enforcement-claims`) FAILS when
this document calls one of these rules unenforced while its module is in the
tree.

Authoritative for engine behaviour: RECOMMENDATION_ENGINE_DECISIONS.md
(Decisions 1-57) and the code.

Date: 2026-09-12. Baseline: migrations 001-011 applied and catalog-verified.

This document defines how the future recommendation engine transforms a
`recommendation_query` into ranked `recommendation_result` records, using ONLY
the schema that actually exists after migrations 001-011. It is the contract
that Engines 1-6 (section 17) must implement against.

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

## 2. Complete pipeline

```
recommendation_query
        |  1. candidate generation
        |  2. hard compatibility filtering
        |  3. component assessment lookup
        |  4. scoring
        |  5. build assembly + budget pruning
        |  6. build validation
        |  7. candidate persistence
        |  8. ranking
        v
recommendation_result
```

| # | Stage | Input | Output | Tables used | Eliminates? | Changes score? | Deterministic? |
|---|-------|-------|--------|-------------|-------------|----------------|----------------|
| 1 | Candidate generation | recommendation_query + profile | bounded per-role product shortlists (with active offers) | product, product_variant, *_spec, store_offer, recommendation_profile | No (creates pool) | No | Yes |
| 2 | Hard compatibility filtering | candidate pool | pool with hard-incompatible combos pruned | cpu_motherboard_support, cooler_socket_support, case_motherboard_form_factor, case_radiator_support, platform_memory_support + derived numerics (section 5) | YES | No | Yes |
| 3 | Assessment lookup | surviving pool | per-product assessment vectors | component_assessment | No | No (feeds scoring) | Yes |
| 4 | Scoring | assessed pool | component + build scores | component_assessment + scoring_model.configuration | No (soft stage) | YES | Yes (model pinned by query.scoring_model_id) |
| 5 | Build assembly + budget pruning | top-scoring combos | in-memory builds (budget pruned incrementally during staged expansion) | store_offer, store | YES (budget + hard-incompatible during expansion) | No | Yes (tie-break rules required) |
| 6 | Build validation | assembled builds | validated builds + build-level compatibility_status | all compatibility tables re-checked as a whole (wattage budget, connector subset, cooler TDP (SOFT: UNKNOWN, never a REJECT)) | YES | No | Yes |
| 7 | Candidate persistence | validated builds | build_candidate + build_component rows | build_candidate, build_component, store_offer (price snapshot) | No | No | Yes |
| 8 | Ranking | persisted candidates | ranked candidates | build_candidate (score) | No (presentation) | No | Yes (deterministic tie-break) |

> **SUPERSEDED BY DECISION 18** for stages 5-9: as shipped, build scoring runs at stage 5 and rankBuilds runs BEFORE the single write transaction (snapshot -> rank -> select -> explain -> commit in orchestrator/full-run.js). The stage table above is the original design; see the supersession notice at the top of this file.
| 9 | Result record | ranked candidates | recommendation_result rows | recommendation_result | No | No | Yes |

Rules:

* Stages 1-2 must run in this order; early hard-compatibility pruning is
  what keeps the combinatorics tractable (section 11).
* Budget pruning occurs incrementally during staged build expansion
  (stage 5), not as a separate stage.
* Only stages 2, 5 and 6 eliminate candidates; stage 4 only reorders.
* Every stage is deterministic. No randomness. `price_checked_at` records
  WHEN the price snapshot was taken; it never influences WHICH offer is
  selected (section 14).


## 3. HARD constraints vs SOFT scoring (primary architectural rule)

### HARD constraints

A build candidate must NEVER survive when a hard constraint is definitively
incompatible. Hard constraints are evaluated in stage 2 (per-pair) and stage 7
(build-level). The definitive hard list:

> **HISTORICAL (2026-09-28):** this list omits the four rules S5.3 and S6 prescribe (cooler `max_tdp_watts` vs CPU TDP; AIR-cooler `height_mm` vs case clearance; RAM `module_count` vs `dimm_slots`; total RAM capacity vs `max_memory_capacity_gb`). **SUPERSEDED 2026-10-14 by Decision 45 (E8):** three ship as HARD compatibility rules and cooler TDP ships SOFT. See "Current enforcement status of the once-deferred rules" above - the list below still enumerates the original eleven items.

1. CPU socket vs motherboard socket (`cpu_spec.socket_id` !=
   `motherboard_spec.socket_id` -> structural FAIL; do not even consult rules).
2. `cpu_motherboard_support` explicit row with `support_status = FAIL`
   (exact-SKU or family rule, per resolution order in section 4).
3. Cooler incompatible with CPU socket (`cooler_socket_support` = FAIL, or
   cooler has no row for the CPU socket -> UNKNOWN policy below).
4. Motherboard form factor unsupported by case (`case_motherboard_form_factor`
   has no row for the motherboard's form factor -> UNKNOWN policy, see 3.2).
5. Required radiator unsupported by case (`case_radiator_support` lacks a row
   for the cooler's required radiator size, or is UNKNOWN).
6. GPU length: `gpu_board_spec.length_mm > case_spec.max_gpu_length_mm` -> FAIL.
7. GPU thickness: `gpu_board_spec.width_slots > case_spec.max_gpu_thickness_slots` -> FAIL.
8. GPU power: `gpu_board_spec.recommended_psu_watts > psu_spec.rated_wattage` -> FAIL.
9. Required GPU power connectors unavailable on PSU (`required_power_connectors`
   JSONB not a subset of PSU connector counts) -> FAIL.
   [DECISION 26, 2026-09-28: the section 5.2 HIGH-TGP escalation of this item is
   IMPLEMENTED. A required, KNOWN connector whose PSU availability is NULL on a
   board with `gpu_board_spec.board_tgp_watts >= 200` is a FAIL
   (`GPU_PSU_CONNECTOR_NULL_HIGH_TGP`), decided BEFORE the unknown-name branch.]
10. RAM memory type incompatible with platform (`platform_memory_support`
    lacks the platform/memory_type pair -> FAIL; motherboard RAM path per
    section 6).
11. Budget exceeded: build total_price > `recommendation_query.budget_amount` -> FAIL.

### 3.1 Status semantics for HARD compatibility

| Status | Meaning | Engine action | Rationale |
|--------|---------|---------------|-----------|
| PASS | Explicitly compatible | Allow | Positive evidence exists |
| FAIL | Explicitly incompatible | REJECT | Hard safety: never surface an incompatible build |
| UNKNOWN | No evidence either way | Allow WITH uncertainty penalty and recorded `compatibility_status = UNKNOWN` on the build_candidate | Avoids false negatives from sparse data; principle: UNKNOWN must never be treated as PASS silently |
| CONDITIONAL | Compatible only under a condition (e.g. BIOS) | Allow ONLY if the condition is satisfiable and recorded (e.g. `min_bios_version` can be flashed); otherwise REJECT | A conditional build that cannot satisfy its condition is de facto incompatible |

### 3.2 Presence-only tables and UNKNOWN

`case_motherboard_form_factor`, `case_radiator_support` and
`platform_memory_support` have no status column. Policy (asymmetric, safety-first):

* Row present -> PASS (positive evidence).
* Row absent -> UNKNOWN. The candidate survives with a penalty, EXCEPT where
  absence is physically dangerous:
  * `platform_memory_support` absent for the CPU platform + RAM memory type:
    treat as **REJECT**. A CPU platform cannot run a memory type it was never
    built for; the platform table is expected to be complete for seeded
    platforms. (Data-completeness risk is accepted; false negatives are
    preferable to DDR4-in-AM5-class errors.)
  * Missing form-factor row: treat as UNKNOWN (case vendors commonly document
    incompletely). The candidate survives with a penalty; the surviving
    build_candidate stores `compatibility_status = 'UNKNOWN'` rather than PASS.
  * Missing radiator row: UNKNOWN, but if the cooler is LIQUID-type and the
    case has zero radiator rows at all, treat as **REJECT** (a case with no
    documented radiator support cannot host a liquid cooler safely).

### 3.3 SOFT scoring

Everything not on the hard list is soft: performance, value, quality,
upgradeability, thermals, efficiency, price-efficiency, brand tier, PSU
headroom above minimum wattage, cooler TDP headroom (>= required TDP is soft
adequacy; an under-spec `cooler_spec.max_tdp_watts` vs `cpu_spec.tdp_watts`
resolves SOFT - UNKNOWN, never a reject; see section 5.3).
[UPDATED 2026-10-14 (Decision 45, E8): the rule ships and is deliberately SOFT,
not the HARD-REJECT this paragraph first described. See "Current enforcement
status of the once-deferred rules" at the top.]

Soft factors never remove a candidate; they only
reorder it via the scoring model (section 8).

---

## 4. Compatibility resolution order

### 4.1 CPU <-> motherboard (existing model)

```
exact CPU SKU rule (cpu_product_id = CPU product)
      |
CPU family rule (cpu_product_family_id = CPU product's family)
      |
UNKNOWN (no matching rule)
```

Deterministic precedence matrix:

| exact-SKU row | family row | Resolution |
|---------------|-----------|------------|
| PASS | PASS | PASS |
| PASS | FAIL | **PASS** (exact SKU wins) + provenance note on the conflict |
| FAIL | PASS | **REJECT** (exact SKU wins; FAIL on the specific SKU is decisive) |
| FAIL | FAIL | REJECT |
| PASS | none | PASS |
| FAIL | none | REJECT |
| none | PASS | PASS |
| none | FAIL | REJECT |
| none | none | UNKNOWN (survive with penalty) |
| CONDITIONAL | anything non-FAIL | CONDITIONAL; resolve against `min_bios_version` (section 3.1) |
| any | CONDITIONAL | CONDITIONAL when no exact-SKU FAIL exists |

Rationale: exact-SKU rules exist precisely to override a too-broad family rule.
Never average or OR the two statuses.

### 4.2 Cooler <-> socket

1. `cooler_socket_support` row for (cooler, CPU socket) exists: use its
   `support_status` directly (PASS / FAIL / UNKNOWN / CONDITIONAL semantics of
   section 3.1).
2. No row: UNKNOWN (survive with penalty). Do NOT reject on absence: cooler
   socket lists are notoriously incomplete.

### 4.3 Case <-> motherboard form factor

1. Row present in `case_motherboard_form_factor`: PASS.
2. No row: UNKNOWN (survive with penalty) per section 3.2.
3. Never derive form-factor compatibility from numeric dimensions; the table
   is the source of truth. (No dimension-based fallback in Engine 1.)

### 4.4 Case <-> radiator

1. Row present in `case_radiator_support` with radiator_size_mm == cooler's
   required size (and a supported position): PASS.
2. Air cooler: this check is skipped entirely (radiator N/A).
3. Liquid cooler, no matching size row but case has other radiator rows:
   UNKNOWN, survive with penalty.
4. Liquid cooler, case has zero radiator rows: REJECT (section 3.2).

### 4.5 Platform <-> memory type

Source of truth: `platform_memory_support` keyed by the CPU's platform
(`cpu_spec.socket_id -> platform.socket_id`).

* Pair present -> PASS.
* Pair absent -> REJECT (hard, per section 3.2).
* CPU socket with no platform row at all -> data gap; UNKNOWN, flagged as a
  data-quality incident (spec_provenance / ingestion follow-up).


## 5. Derived compatibility (mathematical, no join tables)

### 5.1 GPU -> case

```
gpu.length_mm           <= case.max_gpu_length_mm          (FAIL if strictly greater)
gpu.width_slots         <= case.max_gpu_thickness_slots    (FAIL if strictly greater)
```

NULL policy: if EITHER side is NULL (UNKNOWN), the check cannot be evaluated.
Result is UNKNOWN (survive with penalty), NOT a rejection. Comparing against a
missing constraint must never be read as "unlimited". Repeated UNKNOWNs on a
build lower its confidence (section 9) and set `build_candidate.compatibility_status = UNKNOWN`.

### 5.2 GPU -> PSU

```
gpu.recommended_psu_watts  <= psu.rated_wattage            (FAIL if greater)
required_power_connectors  SUBSET-OF psu connector counts
```

Connector subset (JSONB `required_power_connectors` vs `psu_spec` columns):
every required connector (e.g. 12VHPWR x1, PCIe 8-pin x2, EPS) must be
available in at least the required count
(`connector_12vhpwr`, `connector_pcie_8pin`, `connector_eps_count`,
`connector_sata`). NULL/UNKNOWN policy:

* `recommended_psu_watts` NULL -> UNKNOWN check (penalty; NOT a free pass).
* PSU `rated_wattage` NULL -> UNKNOWN check (penalty).
* GPU requires a connector but PSU count for it is NULL -> treat as **REJECT**
  for HIGH-TGP GPUs (board_tgp_watts >= 200 W) and UNKNOWN otherwise. Rationale:
  a power connector that physically does not exist cannot power the card;
  for high-TGP GPUs the risk of an unsafe build outweighs the false negative.
  [IMPLEMENTED BY DECISION 26 (2026-09-28). As shipped in `compatibility/gpu.js`
  Rule 11: FAIL `GPU_PSU_CONNECTOR_NULL_HIGH_TGP` when a required, KNOWN
  connector's PSU availability is NULL/absent and `board_tgp_watts >= 200`
  (inclusive, finite); UNKNOWN otherwise. The message above says "physically
  does not exist", but the data only ever expresses *unverified* (NULL) versus
  *verifiably zero* (0) - a verifiable 0 remains FAIL
  `GPU_PSU_CONNECTOR_UNAVAILABLE`, and NULL availability below 200 W remains
  UNKNOWN. The escalation is decided BEFORE the unknown-name branch (FAIL
  outranks UNKNOWN) and prunes the pair in Engine 3's Decision 16 gate.]
* Build-level wattage: sum of component power draw is NOT fully derivable
  today (no idle/load draw on most specs), so Engine 1 validation uses ONLY
  `gpu.recommended_psu_watts` as the PSU-sizing rule; per-component wattage
  budgeting is a FUTURE enhancement, not a schema gap.

### 5.3 Cooler adequacy (derived: height HARD, TDP SOFT)

Two rules ship (Decision 45, E8), and they are not the same kind of claim:

* **AIR-cooler height vs `case_spec.max_cpu_cooler_height_mm`** - HARD:
  `height_mm > max` -> FAIL `COOLER_TOO_TALL` -> REJECT; either value NULL ->
  UNKNOWN `COOLER_HEIGHT_UNKNOWN`; LIQUID coolers are out of scope (their
  `height_mm` is the pump-block height, a different physical constraint), not
  UNKNOWN.
* **Cooler TDP: `max_tdp_watts` vs `cpu_spec.tdp_watts`** - SOFT: an under-spec
  cooler resolves UNKNOWN `COOLER_TDP_INSUFFICIENT` and is NEVER a REJECT,
  because a vendor TDP is a marketing figure and comparing two of them is not
  the same kind of claim as an over-slot RAM kit. Equal-or-greater -> PASS;
  either value NULL -> UNKNOWN `COOLER_TDP_UNKNOWN`.

The 2026-09 design proposed REJECT for both; Decision 45 changed the TDP half
to SOFT deliberately. Every boundary is INCLUSIVE and a NULL operand is
UNKNOWN, never PASS. See "Current enforcement status of the once-deferred
rules" above.

## 6. RAM compatibility: source of truth

Two chains exist in the schema:

```
CPU -> socket -> platform -> platform_memory_support -> memory_type -> RAM
motherboard -> motherboard_spec.memory_type_id (single, NOT NULL)
```

Determination: the PLATFORM chain is the architectural source of truth for
whether a memory technology works with the CPU. The single
`motherboard_spec.memory_type_id` is the motherboard's concrete memory
technology and must ALSO match the RAM exactly (`ram_spec.memory_type_id` =
`motherboard_spec.memory_type_id` -> FAIL otherwise).

**Documented architectural gap (do NOT fix in this task):** a motherboard
supporting BOTH DDR4 and DDR5 (some LGA1700 boards) cannot be represented,
because `motherboard_spec.memory_type_id` is a single NOT NULL FK. There is no
motherboard-level memory-type support table mirroring
`platform_memory_support`. Consequence for the engine: dual-memory boards are
mis-modeled; a DDR5 rule evaluated against a dual-board seeded as DDR4 would
be a false rejection. Until fixed, the engine treats
`ram_spec.memory_type_id != motherboard_spec.memory_type_id` as REJECT and
relies on platform-level data being correct. Classification: IMPORTANT gap
(section 16).

Secondary RAM checks (all soft except capacity):
* `ram_spec.module_count > motherboard_spec.dimm_slots` -> REJECT (physical).
* total capacity > `max_memory_capacity_gb` -> REJECT (when both known).
* rated speed above/below motherboard official range -> SOFT (adjust score;
  modern platforms down-clock, it is not a hard incompatibility).

[SUPERSEDED 2026-10-14 by Decision 45 (E8). Both REJECT bullets ship as HARD
compatibility rules - `compatibility/memory-slots.js` (`RAM_SLOTS_EXCEEDED`)
and `compatibility/memory-capacity.js` (`RAM_CAPACITY_EXCEEDED`) - with every
boundary INCLUSIVE and a NULL operand resolving UNKNOWN. See "Current
enforcement status of the once-deferred rules" above. The rated-speed soft
check is still absent: it is a scoring input, not a compatibility rule.]

## 7. Budget handling

* `recommendation_query.budget_amount` + `recommendation_query.currency` are
  the constraint. `budget_amount > 0` is enforced by CHECK.
* **Currency policy: single currency per query. NO currency conversion exists
  and none is invented.** Multi-currency recommendations are explicitly NOT
  supported. The engine filters `store_offer.currency = query.currency` and
  only sums offers in that currency. A build mixing currencies is impossible
  by construction.
* Prices must be known: every component in an assembled build requires at
  least one store_offer row in the query currency. A product with no offer in
  the query currency is simply not a candidate (generation stage), not a
  rejected build.
* Offer selection happens BEFORE scoring (stage 1 pre-selects the cheapest
  in-stock offer per product; stage 5 uses those prices; stage 6 may swap to a
  better-priced offer for the same product within the same currency without
  changing scores, only total_price).
* Budget uses current `store_offer.price` (the freshest snapshot for the
  product, availability not OUT_OF_STOCK), never `price_history`.
* Point-in-time snapshot: when persisting (stage 8), each `build_component`
  copies `store_offer.price` into `selected_price`, `store_offer.currency`
  into `currency`, `store_offer.store_id` into `store_id`, and `now()`-at-
  selection into `price_checked_at`. CHECK `store_id IS NULL OR
  price_checked_at IS NOT NULL` holds. After persistence the build NEVER
  re-reads `store_offer` for pricing: later offer mutations must not corrupt
  the recorded recommendation. Since migration 018 (Decision 35)
  `build_component.store_offer_id` also persists the exact listing the price
  came from, and `offer_class` records whether that price was VERIFIED; the
  snapshot columns above still govern what the build is priced at.
* `build_candidate.total_price` = SUM(build_component.selected_price) in the
  single build currency; NULL only if the candidate was persisted without
  complete pricing (validation stage 7 forbids this, so normally always set).
* Unknown-price components: a product with offers whose price is somehow
  unavailable cannot exist (`store_offer.price NOT NULL`), so no special case.

## 8. Scoring

```
component_assessment (per product, per assessment_type)
        |
scoring_model.configuration (weights from the model pinned by
                             recommendation_query.scoring_model_id - NOT NULL)
        |
component score (0-100)
        |
build score (0-100, stored on build_candidate.score)
```

* `scoring_model` (UNIQUE(name, version), `configuration JSONB`, `is_active`)
  is the ONLY source of weights. No weights may be hard-coded in engine code.
  The engine reads the model by `recommendation_query.scoring_model_id` and
  FAILS FAST if the model is missing or inactive.
* `configuration` JSONB contract (to be defined when Engine 4 is built):
  weights per `assessment_type` (PERFORMANCE, VALUE, QUALITY, UPGRADEABILITY,
  THERMALS, EFFICIENCY), per component-role weighting of those types (e.g.
  PERFORMANCE weighted high for CPU/GPU in a gaming profile), build-level
  aggregation rule, and UNKNOWN-penalty parameters (section 9). Every change
  to behavior = new scoring_model row (new version), never an update in place.
* Role weighting: the build score is a weighted aggregate of per-role scores;
  the weights live in `configuration`, profile-aware via
  `recommendation_query.use_case` / `resolution` (e.g. gaming at 1440p weights
  GPU PERFORMANCE highest).
* Value assessment may be computed from price/performance but, when computed
  dynamically, must still be recorded as deterministic arithmetic from stored
  inputs, not an ad-hoc engine constant.

## 9. Missing benchmark / assessment behavior

Products fall into three evidence states: complete assessments (all relevant
assessment_types present with scores), partial, or none.

**Recommended policy: confidence-weighted neutral default + penalty.**

* Complete evidence: score = model aggregation of actual assessment scores.
* Partial: missing assessment_types default to a neutral baseline defined in
  `scoring_model.configuration` (e.g. 50) and the component's confidence is
  reduced proportionally to missing coverage.
* No assessments: component receives the neutral baseline for every type AND a
  no-evidence penalty, so an unevidenced product can NEVER tie a well-tested
  one. Its effective contribution is strictly below any complete-evidence
  product with a >= baseline score. Unevidenced products tie *each other* at
  `neutral_baseline - no_evidence_penalty` (40.000 on the current seeds) — the
  Decision 23 score-degeneracy root cause and the UUID-dependent retention
  reach (see Decision 23; audit D11, 2026-09-28).
* Confidence reduction (`component_assessment.confidence`: CONFIRMED..UNVERIFIED)
  multiplies the component's contribution weight; UNVERIFIED data may be
  configured to be ignored entirely (config decision, not engine constant).
* Assessment staleness: `assessed_at` age beyond a configuration threshold is
  a soft confidence reduction.
* Exclusion is REJECTED as the default policy: with sparse seed data it would
  gut the candidate pool; neutral-equal treatment is rejected because it lets
  untested products masquerade as tested ones.

## 10. Compatibility aggregation to build level

`build_candidate.compatibility_status` is the WORST-OF aggregation of every
pairwise and derived check on the build:

```
any FAIL                                          -> FAIL (build rejected, not persisted)
any CONDITIONAL not satisfied                     -> FAIL (rejected)
no FAIL, any UNKNOWN                              -> UNKNOWN (persisted, penalized, ranked below PASS)
no FAIL, all conditions satisfied, no UNKNOWN     -> PASS
```

UNKNOWN thus never blocks persistence but always demotes: the build is
recorded honestly (DEFAULT 'UNKNOWN' exists precisely for this). A build whose
status would be FAIL is NOT persisted as a surviving candidate. The REJECT
verdicts behind those excluded combinations are now persisted per query in
`build_rejection` (migration 014, Decision 29), written in the SAME transaction
as the surviving builds - so a run that assembled nothing still records which
candidates were rejected and why (CLOSED, was gap OG-04 in section 16).


## 11. Candidate generation strategy (staged / pruned)

A naive Cartesian product (CPU x MB x RAM x GPU x PSU x case x cooler x SSD)
is prohibitive: 50 products per role yields ~3.9 million raw combos before any
filtering, and per-role product counts will exceed that. The engine MUST use a
staged seeded-expansion strategy with early elimination:

```
1. CPU candidates        : shortlist by budget band (top-K by expected value;
                           K from scoring_model.configuration, e.g. 10-20)
2. Motherboards          : per CPU, keep only socket-compatible + non-FAIL
                           cpu_motherboard_support boards
3. RAM                   : per (CPU platform, MB memory_type), keep matching
                           memory_type kits within module-count limits
                                                      [UPDATED 2026-10-14: module-count /
                           capacity is a HARD compatibility rule
                           (Decision 45/E8) on the RAM <-> MB pair;
                           this SHORTLIST step itself is unchanged]
4. GPU                   : global shortlist by use_case/resolution band
5. PSU                   : keep only rated_wattage >= max(gpu.recommended_psu_watts)
                           across the shortlisted GPUs + known CPU draw margin
6. Case                  : keep only cases compatible with >= 1 shortlisted MB
                           form factor and max_gpu_length >= min(shortlisted GPU lengths)
7. Cooler                : per CPU socket, compatible coolers with
                           max_tdp_watts >= cpu.tdp_watts
                                                      [UPDATED 2026-10-14: cooler TDP and
                           AIR-cooler height are compatibility rules
                           (Decision 45/E8), not shortlist pruning;
                           this stage still filters on socket only]
8. Storage               : shortlist SSD_BOOT by capacity tier for the use case
9. Validate complete builds (section 5 checks) on assembled top combos only
10. Score                : only validated builds reach scoring
```

Key rules:

* Combos are only materialized as complete builds for the TOP partial combos
  (cheapest per-role bases, then variants). A hard cap (configuration) limits
  assembled builds per query (e.g. 500 - SUPERSEDED: shipped max_builds_per_query is 25); exceeding it prunes by partial price
  before assembly.
* Budget pruning is applied INCREMENTALLY: once a partial combo's minimum
  possible total exceeds budget, that branch is abandoned. Boundary
  (`docs/RECOMMENDATION_ENGINE_DECISIONS.md`, Engine 3 contract decisions
  2026-09-14, Decision 5): `current_cost == budget` is retained; only
  `current_cost > budget` prunes. Partial-build cost is the cumulative
  selected-component sum; Engine 3 consumes (never invents) the selected
  in-currency offer price, in the query's single currency with no
  conversion.
* Elimination ordering matters: CPU->MB filtering removes the largest branch
  factor first (socket is highly selective), then RAM (memory_type), then PSU
  (wattage), then case (form factor), then cooler (socket; cooler TDP is a
  compatibility rule, not a shortlist filter - see the enforcement table above).
* Determinism: ordering within each stage uses fixed tie-breaks (product name
  ASC, then product id ASC) so the same DB state + query + scoring_model
  version always yields the same candidates.

## 12. Build completeness

Minimum required roles for a valid recommendation (singular per build):
CPU, MOTHERBOARD, RAM (>=1 kit), SSD_BOOT, PSU, CASE, CPU_COOLER.

GPU policy - mandatory or optional is decided per candidate CPU, NOT globally:

* `cpu_spec.integrated_gpu_present = true` -> GPU optional. If omitted, the
  build is valid for basic/productivity use cases.
* `integrated_gpu_present = false` -> GPU REQUIRED. A build without GPU is
  invalid and must not be persisted.
* `integrated_gpu_present IS NULL` (UNKNOWN) -> GPU REQUIRED (safety-first:
  never assume the CPU has graphics).
* Use case / recommendation profile overrides: gaming or workstation profiles
  (use_case, resolution) REQUIRE a discrete GPU even if iGPU is present;
  `recommendation_profile` / `recommendation_query.use_case` carries this
  decision. The profile-to-GPU-requirement mapping is engine configuration,
  documented in `scoring_model.configuration` so it is versioned.
* Optional roles: SSD_SECONDARY (0..n), RAM kits (1..n within slot limits),
  GPUs (0..1 in Engine 1; multi-GPU is FUTURE and unsupported).

## 13. recommendation_result semantics

* `build_candidate.score` is computed at stage 5, BEFORE persistence, and
  stored with the candidate. It never changes after persistence.
> **SUPERSEDED BY DECISION 18**: rank is assigned BEFORE persistence (Decision 18 item 7; rankBuilds runs pre-write in full-run.js), and the third sort key is signature ASC, not candidate id. Text below is the superseded original.

* `recommendation_result.rank` is assigned at stage 9, after persistence, by
  ordering candidates: score DESC, then total_price ASC (cheaper wins ties),
  then a deterministic final tie-break (candidate created order / candidate id
  ASC). Ties therefore produce a stable, reproducible order; no equal ranks.
* Rank is unique per query (UNIQUE partial index on
  `recommendation_result(recommendation_query_id, rank)`).
* The winning build is simply rank 1. No additional status field exists and
  none is added. Alternatives (2..N) are ranked normally; candidates that were
  rejected get NO recommendation_result row (they may exist as
  build_candidate rows only if they survived validation - FAIL builds are
  never persisted).
* `explanation` is generated deterministically from stored inputs: the top
  contributing assessment types per role, the compatibility_status, and the
  price/budget relationship (e.g. "Ranked 1: best weighted score 87.5;
  PASS compatibility; 3120 MAD of 3500 MAD budget; GPU PERFORMANCE dominant"). Same inputs -> same explanation text. Generation order and templates are
  part of Engine 6 and are versioned with the scoring model. **SUPERSEDED**: templates are code constants in explanation/explain.js and are NOT versioned with the scoring model.
* `rank` may be NULL in the schema for provisional results; the engine always
  assigns a concrete rank when finalizing, so persisted finalized results have
  non-NULL ranks.

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

## 16. Architecture gaps (classification)

| Gap | Class | Impact |
|-----|-------|--------|
| Single `motherboard_spec.memory_type_id` cannot represent boards supporting DDR4 AND DDR5 | **IMPORTANT** | Possible false rejections for dual-memory boards; documented in section 6; fix = future migration (motherboard memory support table or nullable secondary FK) |
| Presence-only tables (`case_motherboard_form_factor`, `case_radiator_support`, `platform_memory_support`) cannot store FAIL/UNKNOWN/CONDITIONAL explicitly | **IMPORTANT** | Asymmetric UNKNOWN policy (section 3.2) mitigates; explicit status columns would be cleaner but are not required to proceed |
| ~~No rejection-reason persistence (rejected combos invisible)~~ | **IMPORTANT** (resolved) | **CLOSED 2026-10-04 (OG-04, Decision 29):** `build_rejection` (migration 014) records each Engine 2D REJECT verdict - role, product/variant, optional partner, and the decisive `REASON_CODES` value - keyed to `recommendation_query_id` and written by the commit wrapper in the same transaction as the builds. A run that assembles nothing therefore still explains itself; `budget_floor` covers the budget axis, this covers the compatibility axis. A healthy pass writes zero rows. Pairwise rejections detected during assembly are NOT captured (they are combinations, not candidates) |
| No integrated-graphics requirement expression beyond `integrated_gpu_present` BOOLEAN | ACCEPTABLE | The boolean + use_case mapping covers the engine's needs (section 12); iGPU performance tiering would need more data later |
| CONDITIONAL semantics only exist in `cpu_motherboard_support` (via `min_bios_version`); not in other compatibility tables | ACCEPTABLE | Only CPU<->MB genuinely needs it today |
| Multi-currency recommendations | **FUTURE** | No conversion infrastructure; single-currency-per-query policy (section 7) |
| ~~`store_offer_id` provenance FK on build_component~~ CLOSED 2026-10-07 | **FUTURE** (resolved) | **CLOSED by Decision 35 / migration 018:** `build_component.store_offer_id` (FK to `store_offer`, indexed) and `offer_class` are written by the commit for every component, so a persisted price is traceable to its listing while the snapshot columns remain the price. See section 15 |
| `recommendation_profile.priority` INTEGER | FUTURE | Documented redesign target in migration 011 notes |
| Assessment coverage likely sparse at seed time | ACCEPTABLE | Handled by section 9 policy |
| ~~No engine-version column on results~~ CLOSED 2026-10-15 | **ACCEPTABLE** (resolved) | **CLOSED by Decision 46 / migration 019 (C-40):** `recommendation_result.engine_version` and `.strategy_key`, plus `recommendation_query.budget_floor`, are persisted and served on BOTH verbs, so the pass facts no longer live only in the explanation text |
| Fresh 001->011 migration on an empty DB | ACCEPTABLE (environmental) | ~~Standing test limitation~~ **VERIFIED 2026-09-30 (OG-13)**: replayed on a throwaway Neon DB emptied to 0/0 — 39/39 tables, 336/336 columns, 14/14 enums identical; the drift it surfaced is the live-only benchmark hardening row above (OG-25) |
| ~~No applied-migration tracking (`run-migrations.js` replays all files; `002_enums.sql` bare `CREATE TYPE` makes the runner single-use)~~ CLOSED 2026-10-04 | ~~ACCEPTABLE (tool defect)~~ **CLOSED** | ~~Workaround: apply new migration files individually via a throwaway script (see `AGENTS.md` S8 / `DEVELOPMENT_NOTES.md`); fix = future `schema_migrations`-style tracking table and/or idempotent runner guard — audit D10 (2026-09-28). No such table exists live (verified via `information_schema`, 2026-09-28)~~ **Fixed 2026-10-04 (OG-14 / C-19):** `run-migrations.js` is ledger-driven over a runner-created `schema_migrations` table (pending tail only, one transaction per file, re-runnable; modes `--dry-run`/`--check`/`--offline`/`--baseline`/`--test-db`). The table exists live with a 12-row ledger through `012` on shared + TEST (verified 2026-10-04) |
| Cooler TDP / AIR-cooler height / RAM slots / RAM capacity (sections 5.3 and 6) | **IMPORTANT** (closed) | **CLOSED 2026-10-14 by Decision 45 (E8), recorded as C-38:** all four ship as compatibility rules - three HARD, cooler TDP SOFT - and the standing gate `scripts/check-deferred-rules.js` measures each one. Residual data gap: one cooler carries a NULL `max_tdp_watts`, so its verdict is honestly UNKNOWN (`docs/OPEN_GAPS.md` OG-50). See "Current enforcement status of the once-deferred rules" at the top of this document. |
| ~~Live-vs-migrations drift: 3 benchmark CHECKs stricter live (`sample_size`/`resolution_width`/`resolution_height` enforce `> 0` with no `IS NULL OR` escape), `chk_benchmark_result_metric_value_finite` live-only, 5 undocumented live-only performance indexes (`idx_benchmark_source_name` UNIQUE, `idx_benchmark_source_id`, `idx_component_assessment_product_id`, `idx_component_assessment_type`, `idx_scoring_model_active`)~~ RECONCILED 2026-10-04 | ~~**IMPORTANT** (latent)~~ **CLOSED (OG-25 / C-18)** | Found by the OG-13 empty-DB replay (2026-09-30); provenance unknown (pre-migration manual work or a lost migration). Engine-irrelevant today — no engine code reads `benchmark_*` or these index targets. ~~Decision needed: **migration 012** to reconcile the drift into the chain, or record live-only provenance in this table + `SCHEMA_REFERENCE.md`. Until then, do not treat a fresh-replay schema as fully equivalent to live.~~ **Resolved 2026-10-04:** migration `012_reconcile_benchmark_drift.sql` adopts the live stricter CHECKs, adds `chk_benchmark_result_metric_value_finite`, and creates the five indexes verbatim (every statement `IF EXISTS`/`IF NOT EXISTS` guarded); applied to shared + TEST, both ledgered at 012. A fresh `001→012` replay produces this hardening by construction, but the replay itself was not re-run this session (`docs/OPEN_GAPS.md` C-19). Track: `docs/OPEN_GAPS.md` OG-25 (CLOSED 2026-10-04) |

No BLOCKING gaps were found: the engine can be fully implemented on the
current schema with the documented policies.

## 17. Future implementation boundaries

The engine is built in small, independently testable stages:

```
Engine 1 - Compatibility resolver
    Pure functions: all checks of sections 3-6, 10. Inputs: spec/compat rows.
    Output: PASS/FAIL/UNKNOWN/CONDITIONAL + reason per pair. Fully unit-testable
    against fixture data without offers or scoring.
    [UPDATED 2026-10-14 (Decision 45, E8): "all checks of sections 3-6" is now
    accurate. The engine registers ELEVEN pairwise relationships -
    cpu_motherboard, cooler_socket, motherboard_memory, platform_memory,
    case_form_factor, case_radiator (which carries both the radiator rule and the
    AIR-cooler height rule), gpu_case, gpu_psu (including the section 5.2 HIGH-TGP
    connector escalation), cooler_tdp, mb_memory_slots and mb_memory_capacity - in
    both topology sites. See "Current enforcement status of the once-deferred
    rules" at the top.]

Engine 2 - Candidate component selector
    Stage 1 shortlists + offer pre-selection (cheapest in-currency in-stock
    offer per product). Deterministic ordering. [Engine 2C: 2A contracts, 2B loader, 2C selector; no offers.]
    Logical pipeline (Decision 6):
      Engine 2C candidate pool
        → Stage 1 offer pre-selection / price attachment (owns offer
          selection + price attachment; cheapest eligible offer per
          product; no-offer exclusion; price carrier = selected_price,
          currency, store_id, price_checked_at)
        → Engine 2D compatibility (price-agnostic; consumes 2D verdicts
          + price carrier)

Engine 3 - Build assembler
    Staged expansion (section 11) with incremental budget pruning,
    completeness rules (section 12). Output: in-memory builds.

Engine 4 - Scoring engine
    Reads scoring_model.configuration; assessment aggregation, neutral/penalty
    policy (section 9), component + build scores.

Engine 5 - Ranking + result persistence
    Build validation (stage 7), snapshot persistence (stage 8), ranking and
    recommendation_result rows (stage 9). Transactional.

Engine 6 - Explanation generation
    Deterministic explanation text from stored inputs (section 13).
```

Each engine: unit tests with fixtures, integration test against Neon in the
existing `scripts/test-*.js` transaction/rollback style.

## 18. Final architecture decision

### Approved now

* Full pipeline shape (section 2) implementable on the current schema.
* HARD/SOFT separation with the status policy of section 3.1 and the
  asymmetric UNKNOWN policy of section 3.2.
* CPU<->MB resolution order (exact SKU > family > UNKNOWN, exact SKU wins
  conflicts) using the existing `cpu_motherboard_support` model.
* Derived GPU<->case, GPU<->PSU, cooler adequacy checks from numeric specs -
  no new join tables.
  [DECISION 26 (2026-09-28): the GPU<->case and GPU<->PSU halves (including the
  section 5.2 HIGH-TGP escalation) are implemented; the "cooler adequacy" half
  is NOT - it is deferred and unenforced. See section 5.3 and the section 16
  gap rows.]
* Platform chain as RAM source of truth + single motherboard memory_type
  exact-match rule.
* Single-currency budget policy; offer selection before scoring; snapshot
  pricing on build_component; scoring_model as sole weight source; staged
  candidate generation; GPU-optional rules; worst-of compatibility aggregation;
  deterministic ranking and explanation.
* Stage 1 offer pre-selection ownership (Engine 2 Stage 1), pipeline
  position (between 2C and 2D), eligible-offer rules (product match,
  currency match, not OUT_OF_STOCK, price > 0), one-offer cardinality,
  no-offer exclusion, price-agnostic 2D, persistence relationship
  (Decision 6 -- all resolved from existing architecture/schema).
* Stage 1 offer-selection freshness predicate (Decision 7, 2026-09-16):
  `store_offer.last_checked_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'`
  -- 30-day maximum age, INCLUSIVE boundary, evaluated with PostgreSQL
  `CURRENT_TIMESTAMP` / `now()` (transaction-start time); future
  `last_checked_at` values accepted as fresh.
* Stage 1 equal-price tie-break (Decision 8, 2026-09-16): among the eligible
  offers for a candidate, `ORDER BY price ASC, store_offer.id ASC`, take the
  first. `store_offer.id` is the unique primary key, so the ordering is total
  and the all-keys-equal case cannot occur; no further fallback key exists.
* Stage 1 product/variant offer applicability (Decision 9, 2026-09-16):
  STRICT exact matching, no fallback and no cross-variant matching --
  variant-keyed candidates (GPU today) require
  `offer.product_variant_id = candidate.product_variant_id`; product-keyed
  candidates require `offer.product_variant_id IS NULL`.

### Needs clarification before coding

1. Confirmation of the section 3.2 asymmetric UNKNOWN policy (especially:
  platform_memory_support absence = REJECT; zero-radiator case + liquid cooler
  = REJECT) - these trade false negatives for safety and should be explicitly
  signed off. **RESOLVED (Decision 1).**
2. The dual-memory motherboard gap (section 6): decide whether Engine 1
  additionally treats `ram_spec.memory_type_id != motherboard_spec.memory_type_id`
  as REJECT (recommended) or waits for the schema fix. **RESOLVED (Decision 2).**
3. The first `scoring_model` row: its `configuration` JSONB shape (weights,
  caps, neutral baseline, penalty parameters) must be defined and seeded
  before Engine 4 (a seed, subject to the normal seed workflow). **RESOLVED (Decision 3).**
4. **Stage 1 offer pre-selection: exact freshness predicate.** Architecture §7
  says "the freshest snapshot" but defines no explicit `last_checked_at`
  threshold. No maximum age, recency window, or staleness rule existed in
  the architecture, schema, or code. Required before Stage 1 implementation.
  **RESOLVED (Decision 7, 2026-09-16):** 30-day maximum age with INCLUSIVE
  boundary, i.e. `last_checked_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'`,
  evaluated with PostgreSQL `CURRENT_TIMESTAMP` / `now()` (transaction-start
  time, constant within a transaction); future `last_checked_at` values
  accepted as fresh. Supersedes the former "DECISION REQUIRED (Decision 6,
  gap 1)" status; see `docs/RECOMMENDATION_ENGINE_DECISIONS.md`, Decision 7.
5. **Stage 1 offer pre-selection: deterministic price tie-break.** When two
  eligible offers have identical `price` in the same `currency`, no
  deterministic selection rule existed in architecture, schema, migrations,
  or code. Engine 3 requires deterministic input. **RESOLVED (Decision 8,
  2026-09-16):** `ORDER BY price ASC, store_offer.id ASC`, take the first --
  `store_offer.id` is the unique primary key, so the ordering is total and
  the all-keys-equal case cannot occur. Supersedes the former "DECISION
  REQUIRED (Decision 6, gap 2)" status; see
  `docs/RECOMMENDATION_ENGINE_DECISIONS.md`, Decision 8.
6. **Stage 1 offer pre-selection: price-carrier shape.** The four carrier
  fields are determined (`selected_price`, `currency`, `store_id`,
  `price_checked_at` -- architecture §7, migration 011), but the in-memory
  structural representation between Stage 1 output and Engine 3 consumption
  is not specified. **RESOLVED (implementation, Decision 6):** Stage 1
  (`offers/select.js`) emits a `prices` carrier keyed by
  `priceKey(product_id, product_variant_id, component_role)`
  (`assembly/prices.js`), each value
  `{ selected_price, currency, store_id, price_checked_at }`; Engine 3
  consumes it through `validatePrices` / `lookupPrice` with no
  reimplementation. Supersedes the former "DECISION REQUIRED (Decision 6,
  gap 3)" status; see `docs/RECOMMENDATION_ENGINE_DECISIONS.md`, Decision 6.
7. **Stage 1 offer pre-selection: product-level vs variant-level offer
  applicability.** `store_offer.product_variant_id` is nullable, and the
  implemented candidate-identity rules make `GPU` candidates variant-keyed
  (`product_variant_id` non-null) while all non-GPU roles are product-keyed
  (`product_variant_id` null). No contract stated whether a candidate with a
  specific `product_variant_id` may be satisfied by an offer with
  `product_variant_id = NULL`, or whether a product-keyed candidate may be
  satisfied by a variant-specific offer; Decision 6 section 3 records the
  rule only as "`product_id` (+ `product_variant_id` where applicable)".
  **RESOLVED (Decision 9, 2026-09-16):** STRICT exact matching in both
  directions, with no fallback and no cross-variant matching --
  variant-keyed candidates (GPU today) require
  `offer.product_variant_id = candidate.product_variant_id`; product-keyed
  candidates require `offer.product_variant_id IS NULL`. See
  `docs/RECOMMENDATION_ENGINE_DECISIONS.md`, Decision 9.

### Future / non-blocking

* Still future: multi-currency; motherboard dual-memory schema fix; profile
  priority redesign; explicit status columns on presence-only tables; multi-GPU.
  Three items this list used to carry have since landed: `store_offer_id`
  provenance (Decision 35 / migration 018), rejection-reason persistence
  (Decision 29 / migration 014) and the per-result engine version (Decision 46 /
  migration 019).

### First implementation task

**Engine 1 (compatibility resolver)**: a pure module implementing sections
3-6 and 10, with unit tests over fixture data (reuse the
`scripts/test-compatibility.js` fixture pattern). It touches no Layer 3/4
tables, creates no migrations, and is verifiable before any candidate
selection or persistence exists. Do NOT start it in this task.
[UPDATED 2026-10-14 (Decision 45, E8): implemented as the eleven pairwise
relationships (see section 17), covering sections 3-6 in full - the section 5.3
and section 6 rules included. See "Current enforcement status of the
once-deferred rules" at the top for their verdicts and gates.]

---

End of document.
