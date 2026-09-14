# Recommendation Engine Decisions

Date: 2026-09-14 (updated). Resolves the three items originally listed under
"Needs clarification before coding" in
`docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md` (section 18, Decisions 1-3),
the Engine 2D/Engine 3 boundary contract (Decisions 4-5), AND the Stage 1
offer pre-selection contract (Decision 6) required before Engine 3
implementation. Documentation only: no DB, no migrations, no code, no
fixtures, no commit.

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

### 3. Eligible offer contract (PARTIALLY RESOLVED)

From architecture §7 and migration 009, the following rules are defined:

| Rule | Source |
|------|--------|
| `offer.product_id` (+ `product_variant_id` where applicable) belongs to the candidate product | migration 009 `store_offer` FK |
| `offer.currency == query.currency` | §7 "filters store_offer.currency = query.currency" |
| `availability != OUT_OF_STOCK` | §7 "availability not OUT_OF_STOCK" |
| `price > 0` | migration 009 `CHECK (price > 0)` + `NOT NULL` |

**DECISION REQUIRED: exact freshness predicate.** Architecture §7 says
"the freshest snapshot for the product" but defines no explicit threshold
(e.g., `last_checked_at > NOW() - INTERVAL '7 days'`). The
`store_offer.last_checked_at` column exists (migration 009) but no
freshness WHERE clause is specified anywhere in the architecture, schema,
or code. CONTEXT.md describes `store_offer` as "current/latest offer
state" but this is a data-model description, not a selection predicate.
No maximum age, recency window, or staleness rule is defined.

### 4. Selection cardinality (RESOLVED)

Each expandable product candidate has exactly one selected offer/price
after Stage 1 offer pre-selection. The selected offer is the cheapest
eligible offer for that product in the query currency. This is one
selected price per product, not a list of offers. No multi-offer carriage.

Confirmed by §7: "stage 1 pre-selects the cheapest in-stock offer per
product."

### 5. Cheapest-offer tie-break (DECISION REQUIRED)

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
deterministic input.

```text
DECISION REQUIRED
```

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

### 7. Price carrier (PARTIALLY RESOLVED)

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

**DECISION REQUIRED: exact carrier shape.** The four fields above are
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

### 10. Implementation status (RESOLVED)

Nothing implemented. No offer-selection logic exists in any source file.
No Engine 3 module exists (`src/recommendation/` contains only
`candidates/`, `compatibility/`, `filtering/`). No Engine 2E or root
orchestrator exists.

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

No existing contracts contradict the adopted Engine 2 / Engine 3
architecture. All six decisions are otherwise fully documented above
without contradiction or invented dependencies. Engine 3 remains NOT
IMPLEMENTED (no source files created or modified by this pass).

---