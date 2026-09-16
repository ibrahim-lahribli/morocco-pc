# Recommendation Engine Decisions

Date: 2026-09-14 (updated). Resolves the three items originally listed under
"Needs clarification before coding" in
`docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md` (section 18, Decisions 1-3),
the Engine 2D/Engine 3 boundary contract (Decisions 4-5), AND the Stage 1
offer pre-selection contract (Decision 6) required before Engine 3
implementation. Documentation only: no DB, no migrations, no code, no
fixtures, no commit.

Update 2026-09-16: Decisions 7, 8, and 9 (below) record the Stage 1
freshness policy, the equal-price tie-break, and the product/variant offer
applicability rule explicitly chosen by the product owner on 2026-09-16.
With Decision 9, every Stage 1 offer-selection eligibility policy that
Decision 6 recorded as DECISION REQUIRED is resolved.

Update 2026-09-16 (query-contract decision pass): Decision 10 (below)
binds the data-loading layer's query-side contract -- the required_roles
loader constant, the fail-closed use_case NULL policy, and the exact
gpu_required_use_cases vocabulary -- as explicit product decisions of the
same date, alongside Decisions 7-9.

Update 2026-09-16 (scoring-model loader decision pass): Decision 11 (below)
binds the future scoring-model loader contract -- exact-ID model selection
by `recommendation_query.scoring_model_id`, the DB-to-validated-domain
validation boundary over the complete Decision 3(a) configuration, the
`SCORING_MODEL_UNAVAILABLE` fail-fast error, and the exact configuration
failure mappings -- resolving the scoring-model loading item Decision 10
left as DECISION REQUIRED. Documentation only: no loader module, no
orchestrator, no code change, no migration, no seed, no test change, no
engine-module change.

The original three items (quoted verbatim from the architecture document):

1. **"Confirmation of the section 3.2 asymmetric UNKNOWN policy (especially:
   platform_memory_support absence = REJECT; zero-radiator case + liquid cooler
   = REJECT) - these trade false negatives for safety and should be explicitly
   signed off."** - Needs clarification because absence-of-row semantics are
   policy, not schema, and Engine 1 hard-codes their outcome.
2. **"The dual-memory motherboard gap (section 6): decide whether Engine 1
   additionally treats `ram_spec.memory_type_id !=
   motherboard_spec.memory_type_id` as REJECT (recommended) or waits for the
   schema fix."** - Needs clarification because it changes Engine 1 rejection
   rules and affects correctness for dual-DDR4/DDR5 boards.
3. **"The first `scoring_model` row: its `configuration` JSONB shape (weights,
   caps, neutral baseline, penalty parameters) must be defined and seeded
   before Engine 4 (a seed, subject to the normal seed workflow)."** - Needs
   clarification because the scoring contract must exist before Engine 4 and
   the UNKNOWN-penalty parameters it contains feed back into Engine 1 verdicts.

---

## Decision 1 - Asymmetric UNKNOWN policy (section 3.2)

### Current situation

Three compatibility tables are presence-only (no status column):
`platform_memory_support`, `case_motherboard_form_factor`,
`case_radiator_support`. The architecture currently says: row present = PASS;
row absent = UNKNOWN, except (a) platform-memory absence = REJECT, and
(b) liquid cooler in a case with zero radiator rows = REJECT.

### Problem

Absence of a row is ambiguous between "known unsupported" and "not yet
seeded". Rule (a) is too coarse: a platform with NO support rows at all would
reject every RAM kit, killing the candidate pool during early seeding. Rule
(b) is safe and cheap because alternative air coolers exist. Form-factor
absence = UNKNOWN is safe against false negatives but can let a physically
impossible fit survive (mitigated only by the UNKNOWN demotion).

### Proposed decision (RECOMMENDED)

Refine rule (a) into an evidence test; keep everything else as documented:

* `platform_memory_support` for the CPU platform:
  * Platform HAS at least one support row, and the RAM's memory_type is not
    among them -> **REJECT** (positive evidence of exclusion).
  * Platform has ZERO support rows -> **UNKNOWN** with penalty + data-quality
    flag (no evidence; do not reject the whole pool).
* Liquid cooler + case with zero radiator rows -> keep **REJECT**. Rationale:
  the engine can always substitute an air cooler; a rejected combo is not a
  rejected build, so the false-negative cost is near zero while the safety
  gain is real.
* Motherboard form-factor row absent -> keep **UNKNOWN** (survive with
  penalty; build marked UNKNOWN, never PASS). Do NOT derive form-factor size
  ordering from the enum - that would be invented data. Revisit REJECT only
  after case seeding is demonstrably complete.

### Alternatives

* Absence = REJECT everywhere (safest, but destroys the pool during sparse
  seeding).
* Absence = UNKNOWN everywhere (pool-friendly, but silently allows a DDR4 kit
  on a DDR5-only platform when partial data exists).

### Impact

No schema change. Engine-only implementation (a per-platform row-count check
added to Engine 1). Future optional schema change: explicit status columns on
presence-only tables (already listed as FUTURE).

---

## Decision 2 - Dual-memory motherboard gap (section 6)

### Current situation

`motherboard_spec.memory_type_id` is a single NOT NULL FK to `memory_type`.
The architecture's RAM rule: platform chain (CPU -> socket -> platform ->
`platform_memory_support` -> memory_type) is the family-level truth, and the
RAM's memory type must exactly equal the motherboard's single memory type.

### Problem

A motherboard supporting BOTH DDR4 and DDR5 (several LGA1700 boards) cannot be
represented. Seeded as DDR4, such a board falsely rejects all DDR5 kits, and
vice versa. Redesigning now is out of scope for this task.

### Proposed decision (RECOMMENDED)

Classification: **IMPORTANT but deferrable** (not BLOCKING, not merely FUTURE).

* Engine 1 now: implement the strict rule
  `ram_spec.memory_type_id == motherboard_spec.memory_type_id`, violation =
  **REJECT**, combined with the platform rule from Decision 1. Rationale: a
  strict rule can only produce false negatives for dual boards (never false
  PASS); single-memory boards are modeled correctly today, and dual-memory
  boards are rare relative to the catalog.
* Engine 1 must emit a distinct rejection reason for this rule
  (`MOTHERBOARD_MEMORY_TYPE_MISMATCH`) so dual-board false rejections are
  diagnosable and re-runnable after the schema fix.
* Future schema change (documented, NOT now): a
  `motherboard_memory_support` table mirroring `platform_memory_support`,
  with `motherboard_spec.memory_type_id` eventually relaxed. Until then, the
  platform rule stays authoritative.

### Alternatives

* BLOCKING: stop Engine 1 until the schema fix - rejected: the gap affects a
  small subset of boards and the strict rule is conservative-safe.
* FUTURE-only: defer any handling - rejected: it would silently mis-rank
  dual-board builds with no diagnostic trail.
* Non-strict (allow RAM type if platform allows it, ignore motherboard
  column) - rejected: it can produce physically impossible builds (wrong
  DIMM keying); unacceptable under the safety-first principle.

### Impact

No schema change now. Engine-only implementation with the strict rule +
rejection reason. Requires a future migration (new table + column relaxation)
listed under FUTURE / non-blocking in the architecture document.

---

## Decision 3 - scoring_model.configuration contract (and CONDITIONAL / UNKNOWN resolution)

### Current situation

`scoring_model.configuration` is an unconstrained JSONB column. The
architecture requires Engine 4 to source ALL weights, caps, neutral baselines
and UNKNOWN/penalty parameters from it, but no shape is defined and no row
exists. Separately, `CONDITIONAL` exists only in `cpu_motherboard_support`
(with `min_bios_version`), and the architecture does not yet state what the
resolver does when a condition cannot be verified.

### Problem

(a) Without a frozen configuration shape, Engine 1's UNKNOWN-penalty
bookkeeping, Engine 4's arithmetic, and any test fixtures would drift apart.
(b) An unresolved CONDITIONAL is unsafe: the engine has no BIOS-flashing
behavior and must never silently convert an unverified condition into PASS.

### Proposed decision (RECOMMENDED)

**(a) Configuration contract (frozen at Engine 4 design time, seeded via the
normal seed workflow before Engine 4 runs):**

```
{
  "version_note": "shape spec; every key REQUIRED, engine fails fast otherwise",
  "role_weights":    { "<component_role>": { "<assessment_type>": weight } },
  "type_weights":    { "<assessment_type>": weight },          // build-level
  "neutral_baseline": 50.0,                                     // 0-100
  "no_evidence_penalty": number,                                // subtractive
  "unknown_compat_penalty": number,                             // subtractive
  "confidence_multipliers": { "CONFIRMED": 1.0, ... "UNVERIFIED": 0.0 },
  "staleness":      { "max_age_days": number, "per_day_decay": number },
  "candidate_caps": { "top_k_per_role": int, "max_builds_per_query": int },
  "gpu_required_use_cases": [ "GAMING", "WORKSTATION" ]
}
```

The engine validates the parsed configuration and refuses to run on a missing
key or out-of-range value - no silent defaults. Every behavior change = a NEW
scoring_model version row; used configurations are never mutated.

**(b) CONDITIONAL resolution (binding on Engine 1 now):**

* Resolver output for a CONDITIONAL pair is the verdict CONDITIONAL plus the
  machine-readable condition (e.g. `min_bios_version`).
* If the condition is verifiable from stored data (e.g. motherboard BIOS
  version field were present - it is not today), resolve to PASS/FAIL.
  Today NOTHING in the schema stores current BIOS version, so every
  CONDITIONAL is treated as **NOT VERIFIABLE**.
* NOT-VERIFIABLE CONDITIONAL: the pair is **survivable but demoted** - the
  build-level status becomes UNKNOWN (worst-of aggregation of section 10 of
  the architecture document), the unknown-compat penalty from the scoring
  configuration applies, and the condition text is carried into the
  recommendation_result explanation ("requires BIOS >= X"). It is NEVER
  resolved to PASS by default and never silently dropped.
* A CONDITIONAL row coexisting with an exact-SKU FAIL still resolves REJECT
  per the section 4.1 precedence matrix.
* No BIOS-flashing behavior is invented; surfacing "you may need a BIOS
  update" in the explanation is the maximum extent of engine behavior.

### Alternatives

* Treat not-verifiable CONDITIONAL as REJECT - rejected: it would discard
  every CPU on a new-chipset motherboard (BIOS-update lists are the norm),
  an unacceptable false-negative rate.
* Treat it as PASS - rejected: silently unsafe, violates the core principle.
* Schema change now (add a `motherboard_bios_version` field) - rejected:
  unneeded; UNKNOWN demotion already produces the correct ranking behavior.
* Free-form JSONB without a frozen shape - rejected: makes Engine 4 results
  irreproducible across engine versions.

### Impact

No schema change. Engine-only: Engine 1 implements the CONDITIONAL verdict +
condition propagation; Engine 4 implements the frozen configuration shape;
Engine 5/6 map not-verifiable CONDITIONAL to UNKNOWN status + explanation.
The first scoring_model row remains a required SEED before Engine 4 (not
before Engine 1).

---

## Engine 1 readiness

**READY**

Blocking reasons: none remaining.

Engine 1 (compatibility resolver) can be implemented now as a pure module
using only Layer 1 tables, with the following decisions binding:

* Status policy: section 3.1 of the architecture document, as refined by
  Decision 1 (platform-memory evidence test).
* CPU<->MB precedence: exact SKU > family > UNKNOWN; exact SKU wins conflicts
  (section 4.1); CONDITIONAL resolves per Decision 3(b).
* Derived checks: GPU<->case, GPU<->PSU (wattage + connector subset), cooler
  TDP/height - NULL on either side = UNKNOWN, never "unlimited".
* RAM: platform rule (Decision 1 evidence test) + strict motherboard
  memory-type match with reason `MOTHERBOARD_MEMORY_TYPE_MISMATCH`
  (Decision 2).
* Build-level aggregation: worst-of (section 10); FAIL builds are never
  persisted.
* The scoring_model seed (Decision 3a) is NOT an Engine 1 dependency; only
  the `unknown_compat_penalty` parameter name is reserved by contract.

First coding task remains: Engine 1 with fixture unit tests following the
`scripts/test-compatibility.js` pattern.

---

## Engine 2C decision (2026-09-12)

`selectCandidatePool()` in `src/recommendation/candidates/select.js` is the single canonical pool selector (no second implementation): validated Engine 2A input + Engine 2B records in, deterministic eligible pool out. Variant identity follows Engine 2B (GPU variant-level, non-GPU product-level), enforced without normalization. Exact duplicate `(product_id, product_variant_id, component_role)` identities dedup deterministically (first wins); distinct GPU variants retained. Empty-pool contract is global-only: `EMPTY_CANDIDATE_POOL` when the raw list is empty or the filtered pool is empty; partial pools returned as-is with no fabrication or substitution. Pure in-memory: no DB, no compat, no budget, no scoring.



## Engine 2D / Engine 3 boundary (2026-09-14)

### Current situation

The pipeline in section 2 of the architecture document lists "Budget filtering" as a separate stage 3. Section 17 assigns "budget pruning" to Engine 3. Engine 2D (`src/recommendation/filtering/`) is a hard-compatibility filtering stage that explicitly excludes budget concerns from its scope.

### Problem

Without an explicit decision, there is ambiguity about where budget filtering belongs:
- As a separate stage between Engine 2D and Engine 3 (a hypothetical "Engine 2E")
- As part of Engine 3's staged build assembly
- As part of Engine 2D's compatibility filtering

Putting budget in Engine 2D would violate the HARD/SOFT separation: budget is a soft constraint, while Engine 2D owns hard compatibility only. A separate Engine 2E stage would add latency and complexity for little benefit.

### Proposed decision (RECOMMENDED)

Adopt **Option B**: Engine 3 owns budget pruning during staged build assembly.

1. Engine 2D owns hard component compatibility only.
2. Engine 2D does not perform budget filtering.
3. Engine 2D does not score, rank, assemble builds, or persist results.
4. Engine 2D's existing `{ results }` output contract remains unchanged.
5. Engine 2D continues to distinguish `PASS` / `UNKNOWN` / `REJECT`.
6. Engine 3 is the downstream consumer responsible for interpreting compatibility results during build expansion.
7. Known incompatible (`REJECT`) candidates must not participate in build expansion.
8. `UNKNOWN` must remain distinguishable from `REJECT`; no new Engine 2D policy for UNKNOWN handling is introduced.
9. Budget pruning occurs incrementally during Engine 3 staged build expansion, not as a separate stage.
10. There is no Engine 2E budget-filtering stage.
11. No Engine 2 Root orchestrator is introduced as part of this decision.

The intended flow is:

```text
Engine 2C candidate pool
        ↓
Engine 2D hard compatibility filtering
        ↓
Engine 3 staged build assembly
        ↓
Engine 3 budget pruning (incremental during expansion)
        ↓
assessment / scoring
        ↓
validation
        ↓
persistence / ranking
```

### Alternatives

* **Option A — Engine 2D owns budget filtering**: rejected. It would violate the HARD/SOFT separation by mixing hard compatibility with soft budget constraints, and expand Engine 2D beyond its compatibility contract.
* **Option C — Separate Engine 2E stage**: rejected. It would add a separate stage between Engine 2D and Engine 3, increasing latency and complexity. Budget pruning is more effective when done incrementally during staged build expansion than as a separate pass.
* **Option D — Engine 2 Root orchestrator**: rejected. Unnecessary for this decision; Engine 2D and Engine 3 are already well-defined with clear boundaries.

### Impact

No code changes. Documentation only. Engine 2D's implementation in `src/recommendation/filtering/` is unchanged. Engine 3's existing responsibility for "budget pruning" (section 17) is confirmed and clarified as incremental during staged build assembly. The pipeline in section 2 is updated to remove the separate "Budget filtering" stage 3, with budget pruning merged into build assembly.

---

## Engine 3 contract decisions (2026-09-14)

Date: 2026-09-14. Architecture/contract decision pass only. No Engine 3
implementation, no Engine 3 barrel/orchestrator, no Engine 2E, no Engine 2
root orchestrator, no Engine 2D behavior change, no `{ results }` contract
change, no new compatibility/scoring/ranking/persistence logic.

Resolves the five Engine 3 implementation-critical semantics (input
universe, REJECT handling, UNKNOWN handling, build assembly contract,
budget contract). Supplements (does not replace) the
`Engine 2D / Engine 3 boundary (2026-09-14)` Option B decision.

### Decision 1 -- Engine 3 input universe (adopted)

Engine 3 receives the complete Engine 2D `{ results }` output, including
PASS, UNKNOWN, and REJECT entries.

- Rationale: preserves compatibility traceability; keeps Engine 2D
  responsible only for determining compatibility; keeps downstream
  interpretation in Engine 3; avoids silently creating another filtering
  boundary before Engine 3.
- Engine 3, not Engine 2D, owns interpretation of candidate status for
  build expansion. This is a consumption rule; the 2D contract
  (`src/recommendation/filtering/filter.js` `filterCandidates` -> frozen
  `{ results }`, each result `{ product_id, product_variant_id, category,
  component_role, status: PASS | UNKNOWN | REJECT, reason, relationships }`)
  is unchanged.
- Engine 3 input contract (minimum):

```text
Engine3Input
  results: frozen 2D result array (PASS + UNKNOWN + REJECT, unmutated)
  budget: budget_amount (> 0) + currency (single, per-query)
    -- source: recommendation_query / Engine 2A selection input
    (src/recommendation/candidates/input.js)
  query/build configuration: required_roles + GPU-requirement inputs
    (use_case / resolution / profile mapping) -- shape frozen at Engine 3
    design time; no additional fields invented here
```

- Remaining budget/build-configuration fields are established only by
  Decisions 4/5 below. No other fields invented.

### Decision 2 -- REJECT handling (adopted)

REJECT entries remain present in the Engine 3 input for traceability, but
Engine 3 excludes them from build expansion.

- Semantic rule:

```text
REJECT -> never selectable for a build
PASS   -> eligible
UNKNOWN -> governed by Decision 3
```

- Do not mutate or rewrite the 2D result array. Engine 3 may derive an
  internal eligible-candidate view (REJECT excluded); this is derived data,
  not a mutation of the 2D input.
- This is an Engine 3 consumption rule, not a change to Engine 2D.
  Consistent with architecture section 3.1 (FAIL -> REJECT, hard safety)
  and the Option B boundary (REJECT must not participate in expansion).

### Decision 3 -- UNKNOWN handling (adopted)

UNKNOWN candidates remain eligible for build expansion.

- Do not convert UNKNOWN to REJECT. Do not apply a numeric penalty during
  Engine 3 assembly. Do not invent scoring penalties here.

```text
PASS    -> known compatible, eligible
UNKNOWN -> compatibility unresolved, still eligible
REJECT  -> known incompatible, ineligible
```

- Engine 3 preserves UNKNOWN builds/candidates so later stages can
  distinguish them. Build-level UNKNOWN aggregation (architecture
  section 10, worst-of) and scoring/penalty semantics
  (`unknown_compat_penalty` in `scoring_model.configuration`, Decision 3a/3b
  -- Engine 4 concern) remain downstream and are NOT Engine 3 logic. No
  `unknown_compat_penalty` logic is added to Engine 3.
- Contradiction check: no existing contract contradicts this. Architecture
  section 3.1 ("Allow WITH uncertainty penalty") and section 10
  ("persisted, penalized, ranked below PASS") describe downstream
  scoring/persistence behavior, not Engine 3 assembly; Decision 3 binds the
  penalty parameter to Engine 4 scoring. Engine 3 applying no penalty is
  therefore consistent, not contradictory.

### Decision 4 -- Build assembly contract (from existing contracts)

Minimum immutable in-memory representation needed by Engine 3. No database
persistence in Engine 3. No ranking/scoring fields unless already required
by an existing contract (none are -- scoring lives in Engine 4 per
architecture sections 8–9).

Build state: a partial build is an immutable ordered mapping
role -> selected entry, plus `current_cost` (partial_cost, see Decision 5).
Each selected entry preserves: `component_role`, `product_id`,
`product_variant_id` (nullable), `status` (PASS | UNKNOWN carried from the
2D result; REJECT never present per Decision 2), and the selected component
price carried from offer pre-selection (architecture section 7: cheapest
in-currency in-stock `store_offer.price` per product -- carrier wiring
unresolved, see Decision 5 gap).

Candidate identity (reused, not reinvented): the Engine 2 contract
(`src/recommendation/candidates/candidate.js` `createCandidate`):

```text
product_id
product_variant_id
category
component_role
```

No second identity scheme. Engine 3 keys expansion by
`(product_id, product_variant_id, component_role)`; `category` is carried
for traceability (derivable from role via `ROLE_CATEGORIES`).

Expansion order (existing, architecture section 11 steps 1–8; steps 9–10
validate/score are downstream, not Engine 3 expansion):

```text
CPU
-> MOTHERBOARD
-> RAM
-> GPU
-> PSU
-> CASE
-> CPU_COOLER
-> SSD_BOOT
```

Optional/additional roles per section 12: SSD_SECONDARY (0..n), RAM kits
(1..n within slot limits), GPU (0..1; multi-GPU FUTURE). No new optional
roles. GPU mandatory/optional per section 12 (iGPU presence +
use_case/profile override) is a completeness rule on finished builds, not
an expansion-stage invention.

Determinism (preserved): within-role candidate order is inherited from the
Engine 2C pool order (role enum order, `product_id` ASC, null-variant-first
then `product_variant_id` ASC; `select.js` / `loader.js`
`compareCandidates`), which Engine 2D preserves per role bucket
(`filter.js`: results concatenated in canonical `COMPONENT_ROLES` order,
bucket order preserved). Section 11 tie-breaks (product name ASC, then
product id ASC) apply to shortlist generation; Engine 3 introduces no
randomness, no timestamps, no new tie-break keys.

Duplicates / multiplicity (existing): singular roles -- at most one
selected component per build (migration 011
`uq_build_component_role_singular`; `roles.js` `SINGULAR_ROLES`): CPU,
MOTHERBOARD, PSU, CASE, CPU_COOLER, SSD_BOOT. Multiple-selection roles per
the same contracts: GPU / RAM / SSD_SECONDARY. Engine 3 enforces singular
uniqueness during expansion; multiplicity follows section 12 limits.

Output: Engine 3 produces an in-memory collection of build candidates
(partial + complete builds with the state above). No `build_candidate` /
`build_component` writes, no ranking/scoring fields, no persistence.

### Decision 5 -- Budget contract (adopted for incremental pruning)

Boundary (from architecture section 3 hard-constraint 11 +
section 11 incremental rule):

```text
current_cost <= budget -> eligible (retain branch)
current_cost == budget -> retain branch
current_cost > budget  -> prune branch
```

Incremental pruning -- after each component addition:

```text
new_cost = current_cost + selected_component_price
new_cost > budget -> prune branch immediately (do not wait for complete build)
```

Partial-build cost:

```text
partial_cost = Σ selected component prices (currently present in the branch)
```

Consistent with `build_candidate.total_price = SUM(selected_price)`
(architecture section 7); partial cost is the running prefix of that sum.

Budget scope: the component total represented by the build. No shipping,
tax, accessories, or other costs (none defined by any existing contract;
none added).

Currency: query's single currency only (`recommendation_query.currency`;
`store_offer.currency = query.currency`; architecture section 7). No
currency conversion in Engine 3 (none exists; none invented). A build
mixing currencies is impossible by construction.

Price requirement -- UNRESOLVED (only remaining decision): Engine 3 must
not invent or fetch prices; it consumes the price supplied by the
established candidate/offer contract. If a candidate required for expansion
has no usable price, Engine 3 must not invent a price or silently treat it
as zero. Repository evidence: architecture section 7 REQUIRES upstream
exclusion ("every component in an assembled build requires at least one
store_offer row in the query currency. A product with no offer in the query
currency is simply not a candidate (generation stage), not a rejected
build"; "offer selection happens BEFORE scoring (stage 1 pre-selects the
cheapest in-stock offer per product)"; "budget uses current
store_offer.price ... availability not OUT_OF_STOCK";
`store_offer.price NOT NULL` + `CHECK (price > 0)`, migration 009). But the
implemented contracts do NOT carry that price: Engine 2B loader
(`src/recommendation/candidates/loader.js`) "never reads prices, offers…
never filters on budget"; Engine 2C selector (`select.js`)
"Non-responsibilities: …budget/price…"; candidate record (`candidate.js`)
is exactly `{ product_id, product_variant_id, category, component_role }`
-- no price field; Engine 2D filter output carries no price field. No
implemented contract defines the price-carrier (field, cheapest-per-product
rule execution point, or no-offer exclusion enforcement) between stage 1
and Engine 3. Per the task validation rule this is reported as the ONLY
remaining decision rather than inventing behavior. See Verdict below.

### Consequences / trade-offs

- Complete-input + derived-eligible-view keeps traceability (REJECT reasons
  auditable) at the cost of Engine 3 holding the full result array in
  memory; negligible relative to build-combinatorics cost.
- UNKNOWN-eligible preserves pool depth under sparse seeding (avoids false
  negatives) at the cost of larger expansion fan-out; downstream scoring
  demotion (Engine 4) and build-level UNKNOWN marking (section 10) carry
  the safety signal instead of assembly-time rejection.
- Incremental `cost > budget` pruning cuts combinatorics early but requires
  a usable price on every expandable candidate -- which is exactly why the
  price-carrier gap blocks implementation (Engine 3 cannot prune without it
  and must not invent prices).
- Freezing expansion order/multiplicity/determinism to existing contracts
  avoids a second identity/ordering scheme but defers GPU-optional
  completeness and cap/top-K policy (`candidate_caps.top_k_per_role`,
  `max_builds_per_query`) to Engine 3 design time.

### Validation against task checklist

1. Option B architecture internally consistent -- yes (§2 pipeline + §17
   boundaries + this section agree; no 2E, no root orchestrator).
2. Engine 2D contract unchanged -- yes (frozen `{ results }`,
   PASS/UNKNOWN/REJECT preserved; `src/recommendation/filtering/`
   untouched).
3. Engine 3 is the first consumer of 2D -- yes (Decisions 1/2).
4. REJECT cannot enter expansion -- yes (Decision 2).
5. UNKNOWN distinguishable and eligible -- yes (Decision 3).
6. Budget pruning during staged expansion -- yes (Decision 5).
7. `cost == budget` eligible -- yes.
8. `cost > budget` pruned -- yes.
9. Partial cost = cumulative selected-component cost -- yes.
10. No Engine 2E / root orchestrator as production architecture -- yes
    (both explicitly rejected, consistent with prior Option B decision).

## Decision 6 - Stage 1 offer pre-selection contract

Date: 2026-09-14. Architecture/contract decision pass only. No offer
selection implementation, no price-carrier module, no Engine 3 module,
no Engine 3 barrel/orchestrator, no Engine 2E, no Engine 2 ROOT
orchestrator, no Engine 2D behavior change, no `{ results }` contract
change, no new compatibility/scoring/ranking/persistence logic.

Resolves the sole remaining pricing/offer boundary required before Engine 3:
where and how Engine 2 Stage 1 selects and attaches the authoritative
component offer/price required by Engine 3 budget pruning.

### Current situation

The architecture assigns offer pre-selection to Engine 2 / Stage 1
(candidate generation, upstream of Engine 2D and Engine 3). Architecture
§7 defines the intended behavior: candidate generation uses active offers;
the query currency determines offer currency; unavailable/out-of-stock
offers are excluded; products without an eligible offer are not candidates;
Stage 1 pre-selects the cheapest eligible offer per product.

The implementation does not provide this behavior. The implemented
contracts do NOT carry price: Engine 2B loader (`loader.js`) "never reads
prices, offers… never filters on budget"; Engine 2C selector
(`select.js`) "Non-responsibilities: …budget/price…"; candidate record
(`candidate.js`) is exactly
`{ product_id, product_variant_id, category, component_role }` -- no
price field; Engine 2D filter output carries no price field.

### 1. Ownership (RESOLVED)

```text
Engine 2 Stage 1 owns offer selection and price attachment
```

Confirmed by:
* Architecture §17: "Engine 2 / Stage 1 shortlists + offer pre-selection
  (cheapest in-currency in-stock offer per product)"
* Architecture §7: "Offer selection happens BEFORE scoring (stage 1
  pre-selects the cheapest in-stock offer per product)"
* `doubts.txt` lines 115-117: "2B → no offer selection; 2C → explicitly
  no offers; 2D → no prices"
* `loader.js` line 31: "never reads prices, offers… never filters on
  budget"
* `select.js` line 53: "Non-responsibilities: …budget/price…"

This responsibility must NOT move to: Engine 2C selector, Engine 2D,
Engine 3, Engine 2E, or a new Engine 2 ROOT orchestrator.

### 2. Pipeline position (RESOLVED)

```text
Engine 2C candidate pool
        ↓
Stage 1 offer pre-selection / price attachment
        ↓
Engine 2D compatibility
        ↓
Engine 3 assembly + budget pruning
```

Confirmed by architecture §7 ("BEFORE scoring"), §17 boundary diagram,
and the module-level evidence above. The logical stage responsibility is
between the 2C candidate pool and the 2D compatibility filter.

### 3. Eligible offer contract (RESOLVED -- Decisions 7 and 9)

From architecture §7 and migration 009, the following rules are defined:

| Rule | Source |
|------|--------|
| `offer.product_id` = candidate `product_id`, with exact variant applicability: `offer.product_variant_id = candidate.product_variant_id` for variant-keyed candidates, or `offer.product_variant_id IS NULL` for product-keyed candidates (no fallback, no cross-variant matching) | migration 009 `store_offer` FK + Decision 9 (2026-09-16) |
| `offer.currency == query.currency` | §7 "filters store_offer.currency = query.currency" |
| `availability != OUT_OF_STOCK` | §7 "availability not OUT_OF_STOCK" |
| `price > 0` | migration 009 `CHECK (price > 0)` + `NOT NULL` |

**Freshness predicate -- RESOLVED (2026-09-16, product-owner decision;
Decision 7).** Historical finding (2026-09-14, preserved verbatim; the
former "DECISION REQUIRED" status of the freshness predicate is superseded
by Decision 7): Architecture §7 says
"the freshest snapshot for the product" but defines no explicit threshold
(e.g., `last_checked_at > NOW() - INTERVAL '7 days'`). The
`store_offer.last_checked_at` column exists (migration 009) but no
freshness WHERE clause is specified anywhere in the architecture, schema,
or code. CONTEXT.md describes `store_offer` as "current/latest offer
state" but this is a data-model description, not a selection predicate.
No maximum age, recency window, or staleness rule is defined.

Adopted policy (exact rule -- Decision 7, 2026-09-16):

| Aspect | Adopted rule |
|--------|--------------|
| Window | 30-day maximum age of `store_offer.last_checked_at` |
| Boundary | INCLUSIVE -- an offer exactly at the cutoff is fresh |
| Predicate | `last_checked_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'` |
| Time source | PostgreSQL `CURRENT_TIMESTAMP` / `now()` = transaction-start time (constant for the whole transaction; NOT `statement_timestamp()`, NOT `clock_timestamp()`) |
| Future `last_checked_at` | ACCEPTED as fresh; never rejected solely for being later than the evaluation timestamp |

**Product/variant applicability -- RESOLVED (2026-09-16, product-owner
decision; Decision 9).** Historical finding (2026-09-14, preserved): the
table row "`offer.product_id` (+ `product_variant_id` where applicable)
belongs to the candidate product" left it unresolved whether an offer with
`product_variant_id = NULL` may satisfy a variant-keyed candidate, and
whether a variant-specific offer may satisfy a product-keyed candidate.

Adopted policy (exact rule -- Decision 9, 2026-09-16): STRICT exact matching
in both directions; no fallback and no cross-variant matching.

| Candidate | Required offer match | Product-level offer (`product_variant_id IS NULL`) | Offer for a different variant |
|-----------|----------------------|---------------------------------------------------|-------------------------------|
| variant-keyed (GPU today) | `offer.product_id = candidate.product_id` AND `offer.product_variant_id = candidate.product_variant_id` | NOT eligible | NOT eligible |
| product-keyed (all non-GPU roles) | `offer.product_id = candidate.product_id` AND `offer.product_variant_id IS NULL` | eligible -- the only eligible shape | NOT eligible |

Eligibility is therefore fully determined: this rule, plus the currency
match, `availability != OUT_OF_STOCK`, `price > 0`, and the adopted
freshness predicate (Decision 7). The winner among eligible offers is chosen
by the adopted tie-break (Decision 8).

### 4. Selection cardinality (RESOLVED)

Each expandable product candidate has exactly one selected offer/price
after Stage 1 offer pre-selection. The selected offer is the cheapest
eligible offer for that product in the query currency. This is one
selected price per product, not a list of offers. No multi-offer carriage.

Confirmed by §7: "stage 1 pre-selects the cheapest in-stock offer per
product."

### 5. Cheapest-offer tie-break (RESOLVED -- Decision 8)

**No deterministic tie-break exists** in:
* Architecture documentation (no mention of price-tie resolution)
* Migrations (no `ORDER BY price, store_id` convention)
* Source code (no `price ASC` SQL pattern anywhere)
* Any existing offer/store identity ordering

The only "cheaper wins" reference (architecture line 509) is for final
ranking (`total_price ASC`), not for offer selection.
`doubts.txt` lines 150-152 explicitly lists "ties" and "store priority"
as open questions.

When two offers have identical `price` in the same `currency`, neither
the schema nor the architecture specifies which wins. Engine 3 requires
deterministic input. (Historical finding of 2026-09-14, preserved; the
former "DECISION REQUIRED" status of this item is superseded by Decision 8
below.)

Adopted policy (exact rule -- Decision 8, 2026-09-16):

```text
eligible offers for the candidate
    -> ORDER BY price ASC, store_offer.id ASC
    -> first offer wins
```

`store_offer.id` is the unique primary key (migration 009:
`id UUID PRIMARY KEY DEFAULT gen_random_uuid()`), so this ordering is total:
the all-keys-equal case cannot occur, and no further fallback key is defined
or needed. Both keys are ascending; the second key uses PostgreSQL's `uuid`
comparison. The first key (`price ASC`) restates the already-established
objective "cheapest eligible offer in the query currency" (section 4); this
decision only fixes what happens on equal prices.

### 6. No-offer behavior (RESOLVED)

```text
no eligible offer → candidate excluded before Engine 3
```

Confirmed by §7: "A product with no offer in the query currency is simply
not a candidate (generation stage), not a rejected build." This
exclusion occurs at Stage 1. Engine 3 must never be responsible for
discovering that a candidate has no price. Missing price is NOT
represented as: zero, NULL, UNKNOWN, or REJECT. It is an upstream
candidate-generation exclusion.

### 7. Price carrier (RESOLVED -- Engine 3 priceKey/validatePrices contract)

From architecture §7 persistence snapshot + migration 011
`build_component` schema, the minimum fields are determined:

| Field | Source |
|-------|--------|
| `selected_price` | §7 "copies store_offer.price into selected_price" |
| `currency` | §7 "store_offer.currency into currency" |
| `store_id` | §7 "store_offer.store_id into store_id" |
| `price_checked_at` | §7 "now()-at-selection into price_checked_at" |

`store_offer_id` is explicitly NOT required (§7: "store_offer_id
provenance FK remains FUTURE / explicitly not added").

`createCandidate()` is NOT the price carrier (candidate.js line 9: "Price
and score are deliberately absent: pricing belongs to offer pre-selection
and scores to Engine 4"). No price fields are added to the Engine 2D
result.

Update 2026-09-16: the exact carrier shape is RESOLVED by the EXISTING
Engine 3 price-carrier contract (`src/recommendation/assembly/prices.js`).
Stage 1 reuses `priceKey` / `validatePrices` without reimplementation and
without introducing a new carrier policy. The carrier is a null-prototype
map keyed by `priceKey(product_id, product_variant_id, component_role)`;
every entry holds exactly the four established fields (`selected_price`,
`currency`, `store_id`, `price_checked_at`); the map is validated by
`validatePrices()` and returned as a frozen null-prototype carrier of
frozen entries inside the frozen Stage 1 result `{ input, pool, prices }`.

Historical finding (2026-09-14, preserved verbatim; the former
"DECISION REQUIRED" status of the exact carrier shape is superseded by the
reuse of the existing Engine 3 contract above): The four fields above are
determined, but the in-memory structural representation between Stage 1
output and Engine 3 consumption is not specified. Whether the carrier is
a new wrapper type, a parallel map keyed by candidate identity, or an
extended record is not defined by any existing contract. The
architecture calls this "carrier wiring unresolved."

### 8. Engine 2D relationship (RESOLVED)

Engine 2D compatibility remains price-agnostic:

```text
2D result = compatibility facts
price carrier = Stage 1 offer-selection output
```

They must not be conflated. Engine 2D result is
`{ results: [candidate verdicts] }` with PASS/UNKNOWN/REJECT. `filter.js`
has no price fields. Engine 3 consumes both concepts through the
established pipeline contract, without requiring Engine 3 to query the
database.

### 9. Persistence relationship (RESOLVED)

* Stage 1 selected price is the authoritative input for build assembly.
* Engine 3 uses that price for incremental budget pruning (Decision 5).
* Persistence later (Engine 5) snapshots the selected price into
  `build_component.selected_price`.
* Persistence does not perform the original offer selection.
* Engine 3 does not write persistence records.
* No `store_offer_id` requirement (§7: FUTURE / non-blocking).

### 10. Implementation status (IMPLEMENTED 2026-09-16)

Update 2026-09-16: Engine 2 Stage 1 offer pre-selection is IMPLEMENTED.
The implementation lives under `src/recommendation/offers/`:

* `src/recommendation/offers/select.js` -- `selectOfferPrices` and
  `SELECT_OFFER_PRICES_SQL` (the Stage 1 entry point)
* `src/recommendation/offers/index.js` -- the boundary-only public barrel
  of `src/recommendation/offers/`
* `src/recommendation/offers/select.test.js` -- unit tests for the
  Stage 1 contract

Still true: no Engine 2E and no Engine 2 root orchestrator exist, and no
caller wiring connects Stage 1 to Engine 3.

Historical finding (2026-09-14, preserved verbatim): Nothing implemented.
No offer-selection logic exists in any source file. No Engine 3 module
exists (`src/recommendation/` contains only `candidates/`,
`compatibility/`, `filtering/`). No Engine 2E or root orchestrator exists.

### Consequences / trade-offs

- Incremental `cost > budget` pruning (Decision 5) requires a usable
  price on every expandable candidate -- which is exactly why the
  price-carrier gap blocks implementation (Engine 3 cannot prune without
  it and must not invent prices).
- The three remaining decisions (freshness predicate, deterministic
  tie-break, carrier shape) are implementation-critical: Stage 1 cannot
  be built without them, and Engine 3 cannot safely consume their output.
- All other points (ownership, pipeline position, cardinality, no-offer
  behavior, 2D boundary, persistence) are fully resolved from existing
  architecture and schema without contradiction.

### Verdict for this pass

```text
VERDICT: DECISION REQUIRED
```

Three implementation-critical contracts remain unresolved:

| # | Gap | Impact |
|---|-----|--------|
| 1 | **Exact freshness predicate** — no `last_checked_at` threshold defined anywhere in architecture, schema, or code | Stage 1 cannot exclude stale offers without a rule |
| 2 | **Deterministic price tie-break** — no rule when two offers have identical `price` in the same `currency` | Engine 3 receives non-deterministic input |
| 3 | **Price carrier exact shape** — four fields determined, but in-memory structural representation unspecified | The boundary contract between Stage 1 and Engine 3 is incomplete |

Update 2026-09-16: gap 1 (freshness predicate) is RESOLVED by Decision 7 --
a 30-day window on `store_offer.last_checked_at`, inclusive boundary,
evaluated with PostgreSQL `CURRENT_TIMESTAMP` / `now()` (transaction-start
time), with future `last_checked_at` accepted as fresh. Gap 2
(deterministic price tie-break) is RESOLVED by Decision 8 -- `ORDER BY price
ASC, store_offer.id ASC`, take the first (total order; the all-keys-equal
case cannot occur). The rows above are preserved as the historical
2026-09-14 finding. The product-level vs variant-level offer applicability
question recorded in section 3 is RESOLVED by Decision 9 (strict exact
matching in both directions; no fallback, no cross-variant matching). Gap
3 (exact carrier shape) is likewise RESOLVED without a new policy: Stage
1 reuses the existing Engine 3 price-carrier contract (`priceKey` /
`validatePrices`, `src/recommendation/assembly/prices.js`); see sections
7 and 10 for the corrected carrier and implementation statuses.

No existing contracts contradict the adopted Engine 2 / Engine 3
architecture. All six decisions are otherwise fully documented above
without contradiction or invented dependencies. Engine 3 remains NOT
IMPLEMENTED (no source files created or modified by this pass).

---

## Decision 7 - Stage 1 freshness policy (2026-09-16)

Date: 2026-09-16. Product-owner decision pass. Resolves ONLY gap 1 of
Decision 6, section 3 (the exact freshness predicate). Documentation only:
no offer-selection implementation, no SQL, no migration, no seed, no test
change, no Engine 2D change, no Engine 3 change.

### Authority for this decision

Decision 6, section 3 recorded that no freshness value existed anywhere in
the repository (architecture, schema, migrations, or code). Therefore the
values below are an explicit NEW product decision taken on 2026-09-16 --
not a repository-derived fact, and not an engineering default adopted
silently. They are recorded here exactly as decided.

### Adopted policy (exact rule)

| # | Aspect | Adopted rule |
|---|--------|--------------|
| F1 | Freshness window | Maximum age of `store_offer.last_checked_at` is 30 days. |
| F2 | Boundary | INCLUSIVE: an offer whose `last_checked_at` is exactly 30 days before the evaluation time is fresh. |
| F3 | Time basis | PostgreSQL `CURRENT_TIMESTAMP` / `now()` -- transaction-start time (`transaction_timestamp()`), constant for every statement in the transaction. NOT `statement_timestamp()`, NOT `clock_timestamp()`. |
| F4 | Future timestamps | A `last_checked_at` later than the evaluation timestamp is ACCEPTED as fresh; never rejected solely for being in the future. |

Canonical predicate:

```sql
store_offer.last_checked_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
```

Stated without SQL: an eligible offer's scrape/check time is not older than
30 days relative to the transaction-start time of the evaluating
transaction; the 30-day boundary instant itself is inclusive; a future check
time does not fail the predicate.

### Why the time basis is stated explicitly

PostgreSQL defines `CURRENT_TIMESTAMP` / `now()` /
`transaction_timestamp()` as the time at the START of the current
transaction, so the predicate yields one stable answer for every statement
in that transaction. `statement_timestamp()` (start of the current
statement) and `clock_timestamp()` (actual wall-clock time at evaluation)
were explicitly NOT adopted: they would let the eligible-offer set differ
within a single logical operation depending on statement or evaluation
timing. The adopted transaction-start basis keeps selection deterministic
and reproducible for a fixed database state + query (architecture §14).

### Scope and boundaries (unchanged by this decision)

* Stage 1 ownership, pipeline position (between Engine 2C and Engine 2D),
  cardinality (exactly one selected offer per candidate), no-offer
  exclusion (candidate excluded upstream; never represented as 0, NULL,
  UNKNOWN, or REJECT), the price-agnostic Engine 2D boundary, and the
  persistence relationship are NOT modified (Decision 6, sections 1, 2, 4,
  6, 8, 9, 10).
* The selection objective is unchanged: the cheapest eligible offer in the
  query currency. This decision only narrows eligibility by adding the
  adopted freshness predicate to the already-established rules (product
  match, currency match, availability is not OUT_OF_STOCK, `price > 0`).
* Engine 3 continues to consume the already-selected price carrier and does
  not evaluate freshness; Engine 2D remains price-agnostic.
* Not decided by Decision 7: the deterministic equal-price tie-break and the
  product-level vs variant-level offer applicability question (Decision 6,
  sections 5 and 3). (Both were subsequently resolved on 2026-09-16: the
  tie-break by Decision 8, the applicability question by Decision 9.)

### Consequences / trade-offs

* 30 days tolerates realistic scraper cadence gaps for the seeded catalog
  while still excluding genuinely stale offers; it is permissive enough
  that a sparse role can still be satisfied by an older snapshot.
* Inclusive boundary + transaction-start time means repeated statements in
  one transaction see the same eligible set, while a later transaction may
  legitimately cross the boundary as wall-clock time advances (freshness is
  time-dependent by definition, so architecture §14 reproducibility holds
  for a fixed database state + query + evaluation transaction, not across
  time).
* Accepting future timestamps means clock skew or a pre-dated scrape cannot
  silently drop an otherwise valid offer; no data-quality rejection is
  invented here.

---

## Decision 8 - Stage 1 equal-price tie-break (2026-09-16)

Date: 2026-09-16. Product-owner decision pass. Resolves Decision 6,
section 5 and architecture section 18 item 5 (the deterministic
equal-price tie-break). Documentation only: no offer-selection
implementation, no SQL, no migration, no seed, no test change, no Engine 2D
change, no Engine 3 change.

### Authority for this decision

Decision 6, section 5 recorded that no deterministic tie-break existed
anywhere in the repository: no price-tie resolution in the architecture, no
`ORDER BY price, store_id` convention in the migrations, no `price ASC` SQL
pattern in the code, no store-priority field on `store` (`store` has only
id, name, website_url, country_code, currency_code, is_active, created_at,
updated_at), and multiple offers per store/product/variant are legitimate by
schema design (migration 010 removed the old offer-level unique
constraint). Therefore the rule below is an explicit NEW product decision
taken on 2026-09-16 -- not a repository-derived fact and not an engineering
default adopted silently.

### Adopted policy (exact rule)

```text
given: the eligible offers for one candidate -- all already in the query
       currency, availability not OUT_OF_STOCK, price > 0, and satisfying
       the adopted freshness predicate (Decision 7)
order: price ASC, then store_offer.id ASC
take:  the first offer
```

* Primary key: `price ASC` (cheapest first) -- the unchanged selection
  objective ("cheapest eligible offer in the query currency", Decision 6
  section 4).
* Tie-break key: `store_offer.id ASC` -- a single key, ascending. In
  PostgreSQL, `store_offer.id` is `uuid PRIMARY KEY DEFAULT
  gen_random_uuid()` (migration 009) and is compared by the `uuid` type's
  comparison.
* Direction: both keys ASC, stated explicitly because the decision must fix
  direction, not only the column.
* All-keys-equal case: IMPOSSIBLE BY CONSTRUCTION. Because
  `store_offer.id` is the unique primary key, no two distinct eligible
  offers can share both the price and the id; the ordering is total, so no
  further fallback key is defined, needed, or permitted.
* Determinism: the same database state + query yields the same selected
  offer, independent of insertion order, physical row order, or query plan
  (no reliance on an unordered result set). Engine 3 therefore receives
  deterministic input.

### Scope and boundaries (unchanged)

* This decision fixes ONLY the equal-price case. The eligibility rules
  (product match, currency match, availability is not OUT_OF_STOCK,
  `price > 0`, adopted freshness predicate) and the selection objective are
  unchanged.
* Stage 1 ownership, pipeline position (between Engine 2C and Engine 2D),
  cardinality (exactly one selected offer per candidate), no-offer
  exclusion (candidate excluded upstream; never represented as 0, NULL,
  UNKNOWN, or REJECT), the price-agnostic Engine 2D boundary, and the
  persistence relationship are NOT modified (Decision 6, sections 1, 2, 4,
  6, 8, 9, 10).
* Engine 3 continues to consume the already-selected price carrier and does
  not re-select offers; Engine 2D remains price-agnostic.
* The product-level vs variant-level offer applicability question
  (Decision 6, section 3) is NOT decided here; it was subsequently resolved
  by Decision 9 (2026-09-16).

### Consequences / trade-offs

* `store_offer.id ASC` is fully deterministic and needs no new schema field,
  no store-priority ranking, and no second tie-break level.
* It encodes no commercial preference between stores: for equal prices the
  winner is an implementation-stable identity, not a "preferred retailer".
  A store-priority policy would require a NEW decision (and probably schema
  support); none is invented here.
* Because UUIDs are effectively random, the tie-break is stable but
  arbitrary. That is intentional: determinism is the requirement, not
  fairness.

---

## Decision 9 - Stage 1 product-level vs variant-level offer applicability (2026-09-16)

Date: 2026-09-16. Product-owner decision pass. Resolves Decision 6,
section 3 (the "`(+ product_variant_id where applicable)`" ambiguity) and
architecture section 18 item 7. Documentation only: no offer-selection
implementation, no SQL, no migration, no seed, no test change, no Engine 2D
change, no Engine 3 change.

### Authority for this decision

Decision 6, section 3 recorded the rule only as "`offer.product_id`
(+ `product_variant_id` where applicable) belongs to the candidate
product", and the pre-existing open-questions material listed "product vs
variant offers" as unresolved. Existing repository facts constrain only
candidate identity: the implementation enforces `GPU` candidates
variant-keyed (`product_variant_id` non-null) and all non-GPU roles
product-keyed (`product_variant_id` null), while
`store_offer.product_variant_id` is nullable (migration 009) with no
eligibility rule attached. Therefore the rule below is an explicit NEW
product decision taken on 2026-09-16 -- not a repository-derived fact and
not an engineering default adopted silently.

### Adopted policy (exact rule)

STRICT product/variant applicability: no fallback and no cross-variant
matching, in either direction.

For a VARIANT-KEYED candidate (a candidate carrying a specific
`product_variant_id`; today that is every `GPU` candidate):

```text
store_offer.product_id         = candidate.product_id
store_offer.product_variant_id = candidate.product_variant_id
```

A product-level offer (`product_variant_id IS NULL`) must NOT satisfy a
variant-keyed candidate, and an offer for a different variant of the same
product must NOT satisfy it.

For a PRODUCT-KEYED candidate (all non-GPU roles; `product_variant_id` is
null):

```text
store_offer.product_id         = candidate.product_id
store_offer.product_variant_id IS NULL
```

A variant-specific offer must NOT satisfy a product-keyed candidate.

There is no fallback or cross-variant matching in either direction.

### Complete Stage 1 eligibility rule set (after Decisions 7, 8 and 9)

An offer is eligible for a candidate only when ALL of the following hold:

1. exact product/variant applicability per this decision (Decision 9);
2. `offer.currency = query.currency` (architecture section 7);
3. `offer.availability != 'OUT_OF_STOCK'` (architecture section 7);
4. `offer.price > 0` (schema CHECK, migration 009);
5. `offer.last_checked_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'`
   (Decision 7: 30-day inclusive window, transaction-start time, future
   timestamps accepted as fresh).

Winner selection: among the eligible offers, `ORDER BY price ASC,
store_offer.id ASC`, take the first (Decision 8). Exactly one selected
offer/price per candidate (Decision 6, section 4). A candidate with zero
eligible offers is excluded upstream and must never be represented as 0,
NULL, UNKNOWN, or REJECT (Decision 6, section 6).

### Scope and boundaries (unchanged)

* Stage 1 ownership, pipeline position (between Engine 2C and Engine 2D),
  cardinality, no-offer exclusion, the price-agnostic Engine 2D boundary,
  and the persistence relationship are NOT modified (Decision 6, sections
  1, 2, 4, 6, 8, 9, 10).
* Engine 3 continues to consume the already-selected price carrier; it does
  not query offers and does not resolve applicability. Engine 2D remains
  price-agnostic.
* No schema change is introduced or proposed: `store_offer.product_variant_id`
  stays nullable exactly as migration 009 defines it; this decision only
  rules on which offer rows are eligible.

### Consequences / trade-offs

* Strict matching keeps a GPU candidate's price tied to the exact variant
  whose physical properties (`gpu_board_spec`: length, slot width, height,
  connectors, board TGP) the compatibility checks evaluated; a product-level
  price would not correspond to the variant that was checked.
* Cost: a variant-keyed GPU whose offers exist only at product level has zero
  eligible offers and is excluded upstream, even though a listing exists.
  That false-negative risk is accepted as the trade-off for strict
  correctness; it is a data/ingestion concern (record offers at variant
  level), not an engine fallback.
* The rule adds no field, no store priority, and no multi-key fallback, and
  composes with Decisions 7 and 8 into a single deterministic eligibility +
  selection rule.

---

## Decision 10 - Query-contract derivation: required_roles, use_case NULL policy, GPU-required vocabulary (2026-09-16)

Date: 2026-09-16. Product-owner decision pass binding the future
data-loading layer's query-side contract. Resolves the three items the
2026-09-16 read-only investigation classified as undecided: the
required_roles derivation rule, the NULL/blank use_case policy, and the
exact gpu_required_use_cases value list. Documentation only: no loader
module, no orchestrator, no code change, no migration, no seed, no test
change, no engine-module change.

### Authority for this decision

No repository fact fixes any of the three rules: required_roles has no
schema column (migration 011) and no documented derivation (its only
decision-doc mention, Engine 3 contract Decision 1, freezes the shape, not
the source); recommendation_query.use_case and
recommendation_profile.use_case are nullable free TEXT with no enum, CHECK,
or default (migration 011; no use-case enum exists anywhere in migrations
002-011); the gpu_required_use_cases list exists only as the Decision 3(a)
example list. Therefore the rules below are explicit NEW product decisions
adopted in the 2026-09-16 decision pass -- not repository-derived facts and
not engineering defaults adopted silently. Repository evidence constrains
the option space (recorded per rule); the adopted choice is the product
owner's. No existing contract contradicts the adopted rules; Rule 1 is the
only derivation consistent with architecture sections 11-12 and the
implemented Engine 3 expansion order.

### Rule 1 - required_roles derivation (adopted)

required_roles for every recommendation query is the loader-derived
constant, in canonical component_role enum order:

```text
['CPU', 'MOTHERBOARD', 'RAM', 'GPU', 'PSU', 'CASE', 'CPU_COOLER', 'SSD_BOOT']
```

* Exactly the eight-role set of architecture section 11 staged generation
  (steps 1-8) and of Engine 3 EXPANSION_ORDER (assemble.js).
* GPU is included because section 12 makes GPU requiredness a per-CPU
  decision (Engine 3 Step 3): without GPU candidates loaded, every REQUIRED
  path yields zero builds, silently contradicting section 12.
* SSD_SECONDARY is excluded: it has no section 11 generation step and
  Engine 3 never buckets it.
* NOT query- or profile-variable. Per-query role variation requires a new
  schema column (none exists on recommendation_query or
  recommendation_profile; none proposed) and is out of scope; Engine 3
  contract Decision 1 "no additional fields invented here" stands.
* Carries no multiplicity (Engine 2A: "Order is preserved; it is NOT a
  traversal order"); RAM 1..n kits and GPU 0..1 remain section 12
  build-completeness rules, not role-list entries.
* Rejected alternatives: query/profile-driven roles (no schema support);
  omitting GPU (contradicts section 12 REQUIRED semantics);
  use-case-conditional role lists (no documented rule; arbitrary).

### Rule 2 - use_case NULL/blank policy (adopted)

The loading layer FAILS CLOSED on a recommendation_query row whose use_case
is NULL or blank: the Engine 2A contract rejects it (MISSING_REQUIRED_FIELD
for a NULL value, INVALID_FIELD_VALUE for a blank string) and no selection
input is produced. No profile fallback, no synthetic default, no
normalization, no engine change.

* Consistent with: Engine 2A requires a non-blank use_case
  (candidates/input.js); Engine 3 requires a non-blank use_case
  (assembly/input.js); both contracts never default; the repository-wide
  principle that missing data is never permissive (CONTEXT.md).
* The profile fallback (recommendation_profile.use_case when the query
  value is NULL; section 12: "recommendation_profile /
  recommendation_query.use_case carries this decision") is recorded as the
  explicitly ALLOWED FUTURE EXTENSION. It requires a loader profile read
  (no current contract defines one) and must be adopted as its own
  decision before any loader implements it. It is never a silent default.
* A synthetic default value is REJECTED ("never defaulted"; Decision 3(a)
  "no silent defaults").
* Accepted consequence: rows with NULL/blank use_case are not processable
  until a value is set.

### Rule 3 - GPU-required vocabulary (adopted)

The canonical gpu_required_use_cases value list is exactly:

```text
["GAMING", "WORKSTATION"]
```

* The Decision 3(a) example list, matching section 12 semantics ("gaming or
  workstation profiles ... REQUIRE a discrete GPU").
* Seeds of scoring_model.configuration MUST use this exact list.
* recommendation_query.use_case and recommendation_profile.use_case values
  MUST come from this same vocabulary.
* Strict byte matching is intentional and unchanged (Engine 3 Step 3): no
  trimming, no case folding. A value outside the vocabulary does not match
  the list and falls through to the integrated-GPU rule -- never an error,
  never normalized.
* Recorded hazard: with strict matching and no enum/FK/CHECK on the TEXT
  columns, a configuration/query spelling mismatch silently degrades
  REQUIRED to per-iGPU OPTIONAL with no detection anywhere. Accepted as a
  seeding/query-creation discipline; no schema enforcement is added here.
* Rejected alternatives: free-form vocabulary (accepts the hazard);
  case-insensitive or trimmed matching (would modify frozen Engine 3
  gpu-policy.js).

### Complete query-contract rule set (after this decision)

For one recommendation_query row, the future data-loading layer derives:

```text
budget_amount   = row.budget_amount   (NUMERIC -> JS number; > 0 by CHECK)
currency        = row.currency        (TEXT; format enforced only by Engine 2A)
use_case        = row.use_case        (MUST be non-blank -- Rule 2)
required_roles  = Rule 1 constant     (all eight roles, canonical order)
```

and the Engine 3 GPU/cap inputs are sourced from scoring_model.configuration
(gpu_required_use_cases = the Rule 3 list; candidate_caps =
{ top_k_per_role, max_builds_per_query } per Decision 3(a)) and from per-CPU
integrated-GPU presence. The integrated_gpu_present SOURCING (dedicated
CPU-spec query vs 2D context reuse) and the scoring-model LOADING contract
(which module reads scoring_model.configuration, its validation, and the
missing/inactive-row behavior) remain DECISION REQUIRED and are NOT
resolved by this decision.

Update 2026-09-16: the scoring-model LOADING half of the preceding sentence
is RESOLVED by Decision 11 (below). The integrated_gpu_present SOURCING
half remains DECISION REQUIRED (see Decision 11, unresolved iGPU items).

### Scope and boundaries (unchanged by this decision)

* No engine module changes: Engine 2A/2B/2C/2D, Engine 3 Steps 1-4, Stage 1
  offer pre-selection, and the 2D context loader are untouched.
* top_k_per_role ownership (section 11 Stage-1 shortlisting vs Engine 3
  contract data) is NOT re-decided; the implemented Engine 3 contract
  stands ("Validated ONLY, never applied"; "The per-role cap from the
  input contract is left alone here").
* No DB row is seeded; no migration is created; no tests are added or
  changed; no module path or name is chosen for the data-loading layer.

### Consequences / trade-offs

* The recommendation_query -> Engine 2A mapping is fully specified for the
  first time, removing the last query-side blocker for the future
  data-loading layer (except scoring-model loading and iGPU sourcing,
  which are separate decisions).
* Fail-closed use_case keeps NULL rows unprocessable until updated; the
  profile fallback remains available as a future additive extension
  without contract change.
* The vocabulary binding makes configuration/query agreement a seeding
  discipline; strict matching keeps enforcement out of engine code.

---

## Decision 11 - Scoring-model loader contract (2026-09-16)

Date: 2026-09-16. Product decision pass binding the future scoring-model
loader contract. Resolves the scoring-model loading item Decision 10 left
as DECISION REQUIRED ("which module reads scoring_model.configuration,
its validation, and the missing/inactive-row behavior"). Documentation
only: no loader module, no orchestrator, no code change, no migration, no
seed, no test change, no engine-module change. The loader is NOT
implemented by this decision.

### Authority for this decision (repository evidence)

* Architecture section 8: the engine reads the model by
  `recommendation_query.scoring_model_id` and FAILS FAST if the model is
  missing or inactive. Selection by pinned FK plus fail-fast is therefore
  repository-derived; the exact query shape, validation boundary, and
  error codes below are the new Decision 11 contract.
* Migration 008 (`scoring_model`): `configuration JSONB` nullable;
  `is_active BOOLEAN NOT NULL DEFAULT true`; UNIQUE(name, version). The DB
  enforces no configuration shape, no required keys, no types, no ranges,
  and no single-active-model rule.
* Migration 011: `recommendation_query.scoring_model_id` is NOT NULL (FK
  to `scoring_model.id`).
* Decision 3(a): the complete `scoring_model.configuration` contract
  (`role_weights`, `type_weights`, `neutral_baseline`,
  `no_evidence_penalty`, `unknown_compat_penalty`,
  `confidence_multipliers`, `staleness`, `candidate_caps`,
  `gpu_required_use_cases`) with "every key REQUIRED, engine fails fast
  otherwise" and no silent defaults.
* Decision 10: canonical GPU vocabulary `["GAMING", "WORKSTATION"]`,
  strict byte matching, out-of-vocabulary fall-through to the iGPU rule;
  `candidate_caps` sourcing; `required_roles` and `use_case` NULL policy.
  Decision 10 explicitly left scoring-model loading and iGPU sourcing
  DECISION REQUIRED.
* Engine 3 (implemented): `validateEngine3Input()`
  (`src/recommendation/assembly/input.js`) validates `candidate_caps` as a
  strict closed two-key object and `gpu_required_use_cases` structurally;
  `assembleBuilds()` consumes `max_builds_per_query` as its traversal halt
  cap and leaves the per-role cap alone; `resolveGpuRequirement()`
  (`gpu-policy.js`) is pure and assumes already-validated input.
* Error vocabulary (`src/recommendation/candidates/errors.js`):
  `INVALID_INPUT`, `MISSING_REQUIRED_FIELD`, `INVALID_FIELD_VALUE` (plus
  unrelated `INVALID_CANDIDATE`, `EMPTY_CANDIDATE_POOL`, and others). No
  production scoring-model loader exists anywhere in the codebase.

### Rule 1 - Model selection: pinned FK only (adopted)

The scoring model is selected ONLY by the
`recommendation_query.scoring_model_id` foreign key. The future loader
MUST query that exact model ID. It MUST NOT discover the active model
globally, choose the latest model, choose by name/version, substitute
another model, or fall back to another active model. `is_active` is an
eligibility check, not a model-discovery mechanism.

Required behavior:

```text
scoring_model_id
    ↓
load exact scoring_model row
    ↓
row missing → fail fast
    ↓
row exists but is_active != true → fail fast
    ↓
row active → validate configuration
```

### Rule 2 - Exact loader query contract (adopted)

The future loader MUST perform an exact-ID lookup equivalent to:

```sql
SELECT
    id,
    name,
    version,
    description,
    configuration,
    is_active,
    created_at,
    updated_at
FROM scoring_model
WHERE id = $1;
```

Do NOT add `AND is_active = true` to the SQL: folding eligibility into
the lookup collapses "no row returned" (missing) into "row returned
inactive", and the loader must distinguish all four outcomes:

1. no row returned → missing → `SCORING_MODEL_UNAVAILABLE` (Rule 5);
2. row returned with `is_active` not true → inactive →
   `SCORING_MODEL_UNAVAILABLE` (Rule 5);
3. row returned active but configuration invalid/missing → configuration
   failure mappings (Rule 4);
4. valid active model → validated domain object carrying the COMPLETE
   validated configuration (Rule 3).

### Rule 3 - Configuration validation boundary (adopted)

The future scoring-model loader is the DB to validated domain boundary.
It owns validation of the COMPLETE Decision 3(a) configuration -- not
merely the Engine 3 subset (`candidate_caps`,
`gpu_required_use_cases`) that has a consumer today.

The loader MUST validate: required keys; exact expected
container/object structure; value types; numeric ranges; required nested
structures; strict `candidate_caps` shape (Rule 7);
`gpu_required_use_cases` (Rule 8); and every other configuration field
frozen by Decision 3(a) (`role_weights`, `type_weights`,
`neutral_baseline`, `no_evidence_penalty`, `unknown_compat_penalty`,
`confidence_multipliers`, `staleness`).

There must be no silent defaults, no partial acceptance, no normalization
that changes the documented contract, and no acceptance of
`configuration = NULL`. The returned model must preserve the complete
validated configuration rather than reconstructing only the subset
currently consumed by Engine 3, so future consumers (notably Engine 4
scoring) receive exactly what was validated.

### Rule 4 - Configuration failure semantics (adopted)

Exact mappings (reusing the existing error vocabulary; no new generic
code):

* `configuration IS NULL` → configuration missing →
  `MISSING_REQUIRED_FIELD`, field `configuration`.
* Top-level configuration is not a JSON object (including array/scalar)
  → `INVALID_INPUT`, field `configuration`.
* Required configuration key missing → `MISSING_REQUIRED_FIELD`, exact
  nested field path (e.g. `candidate_caps.top_k_per_role`).
* Unknown configuration key → `INVALID_FIELD_VALUE`, exact field/path
  (e.g. `candidate_caps.extra`).
* Wrong type → `INVALID_FIELD_VALUE`, exact field/path.
* Invalid numeric/range value → `INVALID_FIELD_VALUE`, exact field/path.
* Malformed nested structure → `INVALID_FIELD_VALUE` unless it is
  specifically a missing required field, exact field/path.

Do NOT introduce a generic `MALFORMED_CONFIGURATION` error code. The
nested-path convention mirrors the implemented Engine 3 input contract.

### Rule 5 - Missing/inactive scoring model error (adopted)

A single dedicated error code:

```text
SCORING_MODEL_UNAVAILABLE
```

Use it for BOTH: the pinned `scoring_model.id` does not exist; and the
pinned model exists but `is_active` is not true. The error must identify
the model ID through the structured error field/context mechanism already
used by the repository (the `field`/context slot on
`CandidateSelectionError`), without embedding sensitive database
information. Do NOT use `INVALID_CANDIDATE`, `EMPTY_CANDIDATE_POOL`, or
another unrelated existing error code for this condition. This is a
fail-fast loader error: there is no fallback and no substitution
behavior.

### Rule 6 - Engine 3 boundary remains unchanged (adopted)

Do NOT redefine Engine 3 validation. The separation stands:

```text
scoring-model loader
    ↓
validated scoring-model configuration

Engine 3 input boundary
    ↓
validateEngine3Input()
    ↓
assembly
    ↓
gpu-policy assumes validated input
```

The loader validates the scoring model as a model/configuration.
`validateEngine3Input()` continues validating the Engine 3 input contract.
Do not move GPU policy validation into `gpu-policy.js`: that module stays
pure and continues to assume already-validated input.

### Rule 7 - candidate_caps (adopted)

`candidate_caps` is a strict closed object with exactly:

```json
{
  "top_k_per_role": "positive integer",
  "max_builds_per_query": "positive integer"
}
```

Both keys required; no extra keys; both values must be positive integers.
The loader must validate AND preserve both values.

Explicitly unresolved: `max_builds_per_query` currently has an Engine 3
assembly consumer (`assembleBuilds()` traversal halt cap), while
`top_k_per_role` is currently validated/preserved but its
application/ownership remains a separate downstream design decision
(Decision 10 scope note; Engine 3 "Validated ONLY, never applied").
Decision 11 does NOT silently assign that responsibility to the loader or
to Engine 3.

### Rule 8 - gpu_required_use_cases: Decision 10 preserved exactly (adopted)

Runtime validation is structural only: required array; each entry must be
a nonblank string; empty array is structurally valid; duplicates allowed;
whitespace/case preserved (no trimming, no case folding, no runtime
vocabulary enforcement). The canonical seeded vocabulary remains
`["GAMING", "WORKSTATION"]`; out-of-vocabulary values MUST NOT cause
loader rejection merely for being outside that vocabulary. GPU policy
semantics remain exactly: (1) use case present in `gpu_required_use_cases`
→ REQUIRED; (2) otherwise, if
`integrated_gpu_present[selectedCpuProductId] === true` → OPTIONAL; (3)
otherwise → REQUIRED.

### Explicitly unresolved: iGPU sourcing (NOT decided)

Decision 11 does NOT invent an iGPU database/query contract. The exact
source/query for `integrated_gpu_present`, the exact returned shape
(`{ cpuProductId: true | false | null }`), and the behavior when a CPU
specification is missing remain UNRESOLVED and must be resolved before
Engine 3 receives production iGPU data. Decision 11 is not closed on this
point.

Evidence note (why unresolved, not absent): migration 004 defines
`cpu_spec.integrated_gpu_present BOOLEAN` (nullable) with NULL-is-UNKNOWN
architecture semantics (section 12); the Engine 2D context loader DOES
carry that column into its normalized CPU spec entry today. What is still
missing is the authoritative contract for how that per-CPU value becomes
the Engine 3 `integrated_gpu_present` map: which query the future
data-loading layer runs (dedicated CPU-spec query vs 2D context reuse),
the exact map shape it returns, and the missing-CPU-spec behavior. That
handoff contract does not exist in the architecture, migrations, or
implemented code, so Decision 11 records it as open rather than inventing
it.

### Scope and boundaries (non-goals)

* No loader module is created; no module path or name is chosen.
* No seeding of scoring models; no migration; no schema enforcement added
  (the DB still enforces no configuration shape and no single active
  model).
* No Engine 3 change: validation, assembly, and GPU policy are untouched.
* No new iGPU query or shape invented (see unresolved items above).
* No downstream ownership of `top_k_per_role` assigned (see Rule 7).
* Decisions 1-10 are not rewritten; only the Decision 10 pointer above is
  annotated for consistency.

### Consequences / trade-offs

* Exact-ID selection plus `SCORING_MODEL_UNAVAILABLE` makes a missing or
  deactivated pinned model a loud, diagnosable loader failure instead of a
  silent substitution -- at the cost that queries pinned to a bad model
  are unprocessable until re-pinned.
* Full-configuration validation at the loader keeps Engine 3 (and future
  Engine 4) consumers on an identical contract, but means seeds must carry
  the complete Decision 3(a) shape even when only the Engine 3 subset has
  a consumer today.
* Keeping iGPU sourcing and `top_k_per_role` ownership explicitly open
  avoids inventing contracts the investigation did not establish, but
  leaves two handoffs the data-loading layer still cannot build without
  follow-up decisions.
