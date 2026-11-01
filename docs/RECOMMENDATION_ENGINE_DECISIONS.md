# Recommendation Engine Decisions

> **Navigation (added 2026-09-28; audit finding D5).**
>
> - Every decision entry below starts with a normalized status line as its first content
>   line: `Status: <STATE> <YYYY-MM-DD>[; <secondary fact>] — <qualifier>`.
>   `grep -n "^Status:" docs/RECOMMENDATION_ENGINE_DECISIONS.md` therefore enumerates every
>   decision entry with its current state; all 26 global decisions are RESOLVED as of
>   2026-09-28. The `### Status:` heading style (12 entries before 2026-09-28) is gone — 0 remain.
> - The generated lookup table — number, title, status, date and line anchor for every
>   decision — is `docs/DECISION_INDEX.md`. Regenerate it after editing this file:
>   `npm run gen:decisions` (`node scripts/gen-decision-index.js --check` fails when the
>   committed index is stale). The index is a lookup aid, never a source of truth (see
>   `AGENTS.md` §9).
> - Numbering quirk: there are no `## Decision 4` / `## Decision 5` headings. Global
>   Decisions 4 and 5 exist only as the nested `### Decision 4` / `### Decision 5` under
>   "Engine 3 contract decisions" (corroborated by `RECOMMENDATION_ENGINE_ARCHITECTURE.md`
>   §11, which cites that section's Decision 5 for the budget rule); that section's
>   `### Decision 1-3` are Engine-3-local numbers, NOT global 1-3.
> - The dated `Update ...` paragraphs below are historical narrative (newest: 2026-09-20)
>   and never announce Decisions 16-26 — use the index instead. `TBD - not yet decided`
>   appears only inside those historical paragraphs; no decision is open on it.

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

Update 2026-09-17 (iGPU sourcing decision pass): Decision 11's explicitly
unresolved iGPU sourcing item (below) is RESOLVED. The authoritative source
of `integrated_gpu_present` is the EXISTING Engine 2D normalized CPU-spec
context (`context.specs['p:<product_id>'].integrated_gpu_present`, already
loaded by `CPU_SPEC_SQL` and normalized to true | false | null by
context-loader.js). No dedicated CPU-spec query is introduced. Engine 3
receives exactly `{ [cpuProductId]: true | false | null }`; a missing
CPU-spec row becomes `null`. Only strict `true` means GPU OPTIONAL;
`false`, `null`, and missing all require GPU. Engine 3's GPU policy
(`resolveGpuRequirement()`) is unchanged. Implemented as the minimal handoff
`src/recommendation/filtering/igpu-map.js` with contract tests; see the
resolution block under Decision 11 below.

Update 2026-09-19 (dangling-reference reconciliation): Decision 14 referenced
"Decision 12" (ranking/top-K ownership) and "Decision 13" (candidate-ranking
score formula), neither of which had ever been recorded -- the document jumped
from Decision 11 straight to Decision 14. Investigation found no
implementation of either contract in `src/recommendation/**` or
`database/migrations/**` (evidence in the two entries below). Decisions 12 and
13 are therefore recorded retroactively as `TBD - not yet decided` stubs,
Decision 14 is marked PROVISIONAL / blocked on them, and Decision 14's
recorded date is corrected from 2026-09-17 to 2026-09-18 to match its
recording commit 0c2225c. Decisions 1-11 are unchanged. Documentation only:
no code change, no migration, no commit.

Update 2026-09-19 (scoring decision pass): Decision 13 (below) is RESOLVED --
the candidate-ranking score formula is adopted (candidate/build score split,
STEP 1-3). Decision 14's score blocker is gone; it remains PROVISIONAL,
blocked only on Decision 12 (since RESOLVED 2026-09-20, see Final Status). Decisions 1-11 and Decision 14's
rules are unchanged. Documentation only: no code change, no migration, no
commit.

Update 2026-09-19 (UNKNOWN pairwise-count producer decision pass): Decision
15 (below) resolves BLOCKING QUESTION B1 raised by the Engine 4 build-score
plan -- Decision 13's `unknown_compat_penalty * count` term had no producer,
so the count was injected. Engine 2D now emits `unknown_pairwise_count` per
verdict (the count of pair records whose aggregated status resolved UNKNOWN),
Engine 3 sums it per assembled build, and Engine 4's batch scorer falls back
to the build-carried count when no explicit `unknownPairwiseCounts` array is
injected. Decision 13's formula is unchanged; the change is additive
data-plumbing (Engine 2D/3/4 + contract tests), recorded here as the product
decision.

Update 2026-09-20 (retention ownership decision pass): Decision 12 (below) is RESOLVED -- the ranking/top-K stage is owned by a new dedicated `src/recommendation/retention/` module (neither `candidates/` nor `scoring/` owns it; both disclaim it in their own boundary docs), named "retention" to avoid collision with Engine 5's future post-assembly build ranking, positioned Engine 2C (pool) -> Engine 2D (filter) -> retention/ (this decision) -> Engine 3 (assembly), and shaped as pure composition over already-loaded data (2D verdicts, Decision 13 STEP 2 scores, Decision 11-validated `top_k_per_role`) reusing the existing `compareCandidates()` tie-break. Decision 14 Rule 6 is confirmed exactly as written; Decision 14's remaining blocker is resolved. Documentation only: no code, no migration, no commit -- implementation is a separate task.

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

Status: RESOLVED 2026-09-14 — asymmetric UNKNOWN policy adopted; binding for Engine 1 (see the Engine 1 readiness section).

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

Status: RESOLVED 2026-09-14 — strict motherboard memory-type match REJECT adopted; binding for Engine 1.

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

Status: RESOLVED 2026-09-14 — `scoring_model.configuration` contract and the CONDITIONAL / UNKNOWN resolution adopted.

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
  (UPDATE 2026-09-28, Decision 26: the GPU<->PSU half is implemented, including
  the architecture section 5.2 HIGH-TGP NULL-connector escalation; the cooler
  TDP/height half was never implemented and is now explicitly deferred and
  unenforced - see Decision 26 item B.)
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

Status: RESOLVED 2026-09-14 — input universe adopted (Engine-3-local #1).

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

Status: RESOLVED 2026-09-14 — REJECT handling adopted (Engine-3-local #2).

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

Status: RESOLVED 2026-09-14 — UNKNOWN handling adopted (Engine-3-local #3).

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

Status: RESOLVED 2026-09-14 — build assembly contract adopted from existing contracts (Engine-3-local #4 = global Decision 4).

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

Status: RESOLVED 2026-09-14 — budget contract adopted for incremental pruning (Engine-3-local #5 = global Decision 5).

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

Status: RESOLVED 2026-09-14; IMPLEMENTED 2026-09-16 — Stage 1 offer pre-selection contract.

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

Status: RESOLVED 2026-09-16 — Stage 1 freshness policy (30-day inclusive maximum age).

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

Status: RESOLVED 2026-09-16 — Stage 1 equal-price tie-break (product_id ASC).

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

Status: RESOLVED 2026-09-16 — product-level vs variant-level offer applicability (STRICT exact matching).

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

Status: RESOLVED 2026-09-16 — query-contract derivation: required_roles, use_case NULL policy, GPU-required vocabulary.

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

Update 2026-09-17: the integrated_gpu_present SOURCING half is now also
RESOLVED -- see the resolution block under Decision 11 below.

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

Status: RESOLVED 2026-09-16; iGPU sourcing RESOLVED 2026-09-17 (implemented) — scoring-model loader contract.

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

### Resolution 2026-09-17: iGPU sourcing RESOLVED (additive)

Update 2026-09-17: the iGPU sourcing item explicitly left unresolved above
is now resolved by product decision. The contract, recorded additively so
the original decision text above stays intact:

* **Authoritative source**: the EXISTING Engine 2D normalized CPU-spec
  context. `context.specs['p:<product_id>'].integrated_gpu_present` -- a
  column already selected by `CPU_SPEC_SQL` and already normalized by
  context-loader.js to strictly `true | false | null` (DB NULL preserved).
* **No dedicated CPU-spec query**: the data-loading layer must NOT add a
  second cpu_spec lookup; the Engine 2D context is the single source.
* **Handoff shape**: Engine 3 receives exactly
  `{ [cpuProductId]: true | false | null }`.
* **Missing CPU-spec row**: a candidate CPU with no `cpu_spec` row (no
  `p:<id>` spec entry) becomes the explicit value `null` -- never
  `undefined` (the Engine 3 input contract rejects undefined).
* **GPU-requirement semantics** (unchanged policy, only `=== true` makes a
  GPU optional):
  ```text
  true    -> GPU OPTIONAL
  false   -> GPU REQUIRED
  null    -> GPU REQUIRED
  missing -> null -> GPU REQUIRED
  ```
* **Engine 3 GPU policy unchanged**: `resolveGpuRequirement()` keeps the
  existing rule order (GPU-required use case first, then `=== true` ->
  OPTIONAL, otherwise REQUIRED). Only the DATA supplied to it is new.
* **Implementation status (IMPLEMENTED 2026-09-17)**: the minimal handoff
  lives in `src/recommendation/filtering/igpu-map.js`
  (`buildIntegratedGpuPresentMap(context)`, pure, DB-free, deterministic,
  frozen output) with contract tests in
  `src/recommendation/filtering/igpu-map.test.js`, re-exported through
  `src/recommendation/filtering/index.js`. No orchestrator, no
  `top_k_per_role` application, no scoring-model loader change, no
  migration, no seed, no database operation.

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
---

## Decision 12 - Ranking / top-K ownership and pipeline position (recorded retroactively 2026-09-19; RESOLVED 2026-09-20)

Status: RESOLVED 2026-09-20 (recorded retroactively 2026-09-19) — ranking / top-K ownership and pipeline position (`retention/` module).

### Current situation

No Decision 12 existed when Decision 14 was written: this document numbered
Decisions 1-11 and then jumped to Decision 14, whose intro text ("the
retention question left open by Decision 12 (ranking/top-K ownership)") and
Rule 6 ("passed to Engine 3 ... as established by Decision 12") both
referenced a decision that was never recorded -- a repository-wide search of
every markdown file found Decision 12 mentioned ONLY inside Decision 14.
Decision 14 assumed Decision 12 establishes:

1. **Ownership of the ranking / top-K stage** as a distinct pipeline stage,
   and that Decision 12 explicitly left the RETENTION semantics (hard cap vs
   expansion vs threshold) open for Decision 14 to resolve.
2. **Pipeline position**: scoring -> ranking -> top-K processing happens
   BEFORE the candidate set reaches Engine 3, and the resulting per-role
   top-K sets are what Engine 3 receives as input.

Decision 14's intro depends on (1); Decision 14 Rule 6 depends on (2). The
entry was therefore recorded retroactively 2026-09-19 as `TBD - not yet
decided`, with evidence that no matching implementation existed. That
evidence is preserved below; it remains an accurate description of the
repository until the separate implementation task lands:

* `src/recommendation/scoring/configuration.js:241-242` -- `candidate_caps` is
  "Validated and preserved only -- never applied here (Decision 11 Rule 7)."
* `src/recommendation/scoring/load-scoring-model.js:35` and `:138` -- the
  loader performs "no `top_k_per_role` application (validated and preserved
  only), no scoring, no ranking".
* `src/recommendation/scoring/index.js:17-18` -- "NOT owned here: ... the
  `top_k_per_role` application, Engine 3 assembly, Engine 4 scoring, ranking".
* `src/recommendation/assembly/input.js:44-45` and `:237` -- the Engine 3
  input contract documents `candidate_caps` as "Validated ONLY, never
  applied."
* Repository search for any per-role retention/top-K stage (`applyTopK`,
  `retainTopK`, `rankCandidates`, `topKPerRole`) returns no results in `src/`
  or `scripts/`.
* Decision 10's scope note (this document) confirms `top_k_per_role` ownership
  "is NOT re-decided; the implemented Engine 3 contract stands ('Validated
  ONLY, never applied')."

Update 2026-09-20: the TBD stub is superseded by the RESOLVED decision below.

### Decision

OWNERSHIP: neither `candidates/` nor `scoring/` owns this stage -- both
modules explicitly disclaim it in their own boundary docs
(`candidates/index.js`: "scoring is NOT implemented (Engine 4)";
`scoring/index.js`: "NOT owned here: ... ranking", cited as evidence in this
document's own Decision 12 stub above). A new dedicated module owns it:
`src/recommendation/retention/`.

NAMING: called "retention," not "ranking" -- Decision 14 Rule 4 already uses
"Retention" in its own name, and this avoids collision with Engine 5's future
post-assembly build ranking (`build_score`, Decision 13 STEP 3), which is a
distinct operation on different data (whole builds, not per-role candidates).

SHAPE: pure composition, no SQL, no new validation logic, no new policy --
follows the `assembly/pipeline.js` composition convention exactly: wires
together already-built pieces over already-loaded data.

Inputs:

* Engine 2D `filterResult` (PASS/UNKNOWN/REJECT verdicts);
* Engine 4's `computeCandidateScores` output (Decision 13 STEP 2);
* `candidate_caps.top_k_per_role` (Decision 11 loader, already validated).

Applies, per role bucket, in order:

1. Rule 2 eligibility (PASS/UNKNOWN only);
2. Rule 3/5 ranking (candidate score DESC, then `candidates/select.js`'s
   existing `compareCandidates()` tie-break, reused not reimplemented);
3. Rule 4 hard-cap retention (`retained_count = min(K, eligible_count)`).

Output: frozen per-role top-K candidate sets, in the shape Engine 3's
existing candidate-pool input already expects -- no change to Engine 3's
input contract.

PIPELINE POSITION:

```text
Engine 2C (pool) -> Engine 2D (filter) -> retention/ (this decision) -> Engine 3 (assembly)
```

Confirms Decision 14 Rule 6 exactly as written -- no change to that rule's
text.

OUT OF SCOPE (confirm, don't re-decide): `max_builds_per_query` stays Engine
3's traversal-halt cap (Decision 14 Rule 7, unchanged). Engine 3's existing
"`candidate_caps` validated only, never applied" stance is superseded going
forward by this decision's implementation, not by a rule change here --
implementation is a separate task.

### Rationale

* The stage must be owned somewhere, and both existing candidate-side modules
  disclaim it; a dedicated `retention/` module adds the stage without
  violating any recorded boundary.
* "Retention" is the name Decision 14 Rule 4 already gives the operation;
  "ranking" would collide with Engine 5's future post-assembly build ranking
  (Decision 13 STEP 3 `build_score`), which operates on whole builds, not
  per-role candidates.
* Pure composition over already-loaded, already-validated inputs (2D verdicts,
  Engine 4 scores, Decision 11-validated caps) introduces no new SQL,
  validation surface, or policy, and reusing `compareCandidates()` keeps
  Decision 14 Rule 5's authorized tie-break the single ordering
  implementation.
* Emitting the frozen per-role top-K sets in Engine 3's existing input shape
  keeps Rule 6 true verbatim: Engine 3 changes nothing.

### Impact

* Decision 14's remaining blocker is resolved by this pass; its Rule 6 is
  confirmed exactly as written and its rules are unchanged. Decision 14's own
  status block and the remaining Final Status lines are staged for the next
  step and are not touched here.
* `top_k_per_role` stays validated-only in code until the separate
  implementation task lands the `retention/` module; until then, the evidence
  above (nothing in `src/` applies the cap) remains true.
* Addendum 2026-09-20: Decision 12's implementation has since landed
  (`src/recommendation/retention/`, `retainTopKPerRole`), so the "nothing in
  `src/` applies the cap" evidence above is stale as a present-tense claim.
  The stage is not yet wired into the pipeline -- Engine 3 still receives the
  unfiltered `filterResult` until a separate wiring task lands.

* Engine 3's "candidate_caps validated only, never applied" stance
  (`assembly/input.js`) is superseded going forward by this decision's
  implementation, not by a rule change here.
* No code in this pass: no `retention/` module, no tests, no orchestrator, no
  migration, no database change. Final Status (below) updated: Decision 12 ->
  RESOLVED; Decisions 13, 14, 15 and the semantic summary lines unchanged.

### Verdict for this pass

```text
VERDICT: RESOLVED - ranking/top-K ownership adopted (new dedicated src/recommendation/retention/ module; Engine 2C (pool) -> Engine 2D (filter) -> retention/ -> Engine 3 (assembly); pure composition; Decision 14 Rule 6 confirmed as written)
```

---

## Decision 13 - Candidate-ranking score formula (2026-09-19)

Status: RESOLVED 2026-09-19 — candidate-ranking score formula (STEP 1-3).

Date: 2026-09-19. Product decision pass resolving the candidate-ranking score
formula Decision 14 references (intro, Rule 3, Rule 5's first key, Rule 6) and
that the 2026-09-19 reconciliation entry recorded as a `TBD - not yet decided`
stub. Documentation only: no scoring module, no Engine 4 implementation, no
code change, no migration, no seed, no test change, no commit.

### Current situation

No candidate score exists anywhere in the repository. Decision 14 references
Decision 13 four times: "the candidate score defined by Decision 13" (intro),
"the candidate-ranking score defined by Decision 13 ... The score formula
itself is owned by Decision 13" (Rule 3), "candidate score DESC (Decision 13
score)" (Rule 5, first key), and "after scoring/ranking/top-K processing"
(Rule 6). The prior stub recorded the dangling reference; the findings below
are preserved because they remain true:

* `src/recommendation/scoring/` contains only the Decision 11 loader and its
  configuration validator (`load-scoring-model.js`, `configuration.js`). They
  validate the presence/shape/ranges of the Decision 3(a) configuration but
  perform no aggregation, no weighting arithmetic and no penalty application.
* The schema carries the score VALUE without defining its formula:
  `database/migrations/011_reconcile_layer4.sql:162,165`
  (`build_candidate.score NUMERIC` with a 0..100 CHECK) and `:189,192`
  (`recommendation_result.rank INTEGER` with a `> 0` CHECK).

### Decision

SPLIT: two related scores, same underlying computation, different aggregation
level.

* **Candidate score** (per product, per role): ranks single products within
  one role for Decision 14's `top_k_per_role` retention (Decision 14 Rules
  3-5). Runs pre-assembly.
* **Build score** (per assembled build): feeds `build_candidate.score`. Runs
  post-assembly, in Engine 4.

STEP 1 - effective score per (product, assessment_type), using
`component_assessment` (product_id, assessment_type, score, confidence,
assessed_at; migration 008) and the Decision 3(a) configuration fields
(`neutral_baseline`, `no_evidence_penalty`, `confidence_multipliers`,
`staleness`):

```text
if no component_assessment row exists for (product_id, type)
   OR the row's score column is NULL:
    effective = max(0, neutral_baseline - no_evidence_penalty)
else:
    age_days  = now - assessed_at
    decay     = max(0, 1 - staleness.per_day_decay
                        * min(age_days, staleness.max_age_days))
    decayed   = assessment.score * decay
    mult      = confidence_multipliers[assessment.confidence]
    effective = neutral_baseline + mult * (decayed - neutral_baseline)
```

STEP 2 - candidate_score(product, role) using role_weights[role]:

```text
candidate_score(product, role)
    = sum_type[ role_weights[role][type] * effective(product, type) ]
      / sum_type[ role_weights[role][type] ]
```

STEP 3 - build_score using role_weights AND type_weights, plus
unknown_compat_penalty:

```text
build_score_raw
    = sum_(role,type)[ role_weights[role][type] * type_weights[type]
                       * effective(component_in_role, type) ]
      / sum_(role,type)[ role_weights[role][type] * type_weights[type] ]

build_score = clamp(build_score_raw
                    - (unknown_compat_penalty
                       * count of UNKNOWN pairwise compatibility checks
                         in the build),
                    0, 100)
```

### Rationale

The four open points the formula had to fix, each with its one-line rationale:

* **Staleness decay: LINEAR (not exponential)** -- matches
  `staleness.per_day_decay`'s [0,1] contract
  (`src/recommendation/scoring/configuration.js:31`) as a literal daily-loss
  rate; `max_age_days` becomes a hard floor.
* **Confidence handling: BLEND TOWARD `neutral_baseline` (not
  multiply-toward-zero)** -- low confidence means "uncertain," not "bad";
  straight multiplication would over-punish a real high measured score.
* **`unknown_compat_penalty`: applied PER-OCCURRENCE (not once per build)** --
  compounds with multiple UNKNOWN pairs; consistent with the Engine 2D
  best-of-partner finding (`src/recommendation/filtering/filter.js:43-48`:
  any pair UNKNOWN -> UNKNOWN keeps the board eligible), so multiple silent
  UNKNOWNs must not be under-penalized.
* **Missing/optional role in a build: EXCLUDED from the weighted average
  (renormalize denominator), not penalized** -- absence of an optional role is
  "not applicable," not "bad," consistent with Engine 3's `required_roles`
  distinction (Decision 10, Rule 1).

component_assessment.score is nullable (migration 008) — a row with a qualitative assessment (rating/summary) but no numeric score is treated identically to no-row-exists, since STEP 1 has no number to decay or blend without one. Consistent with the config contract's no-silent-defaults pattern.

### Impact

* Decision 14: Rule 3 ("Ranking") and the first key of Rule 5's ordering chain
  now have a defined input -- the score blocker is gone. Decision 14 remains
  PROVISIONAL blocked only on Decision 12 (ranking/top-K ownership + pipeline
  position). Rule 3's "the score formula itself is owned by Decision 13 and is
  not changed or redefined here" stands.
* No code change: no scoring module is added and Engine 4 does not exist;
  Decision 11's loader contract is unaffected -- the validated configuration
  it returns becomes the arithmetic input of the formulas above when Engine 4
  is implemented.
* No schema change: `component_assessment` (migration 008) already carries
  (product_id, assessment_type, score 0..100, confidence, assessed_at), and
  `build_candidate.score NUMERIC` (0..100 CHECK) plus
  `recommendation_result.rank INTEGER` already carry the values these formulas
  produce.
* Final Status (below) updated: Decision 13 -> RESOLVED; Decision 12 (TBD at the time,
  since RESOLVED 2026-09-20, see Final Status); Decision 14 unchanged (PROVISIONAL).

### Verdict for this pass

```text
VERDICT: RESOLVED - candidate-ranking score formula adopted (STEP 1-3 above)
```

---

## Decision 14 — `top_k_per_role` retention semantics

Status: RESOLVED 2026-09-20 (recorded 2026-09-18; PROVISIONAL until Decisions 12 and 13 landed) — `top_k_per_role` retention semantics.

Date: 2026-09-18 (corrected from the recorded 2026-09-17 to match its recording commit `0c2225c`, dated 2026-09-18). Contract-freezing product decision pass. Resolves the retention question left open by Decision 12 (ranking/top-K ownership) using the candidate score defined by Decision 13. Documentation/decision only: no implementation of ranking, no top-K application, no `roleCaps`, no Engine 3 change, no scoring change, no migration, no database operation.

Decision 14 references two decisions that were never recorded; both are now
entered above as `TBD - not yet decided` (Decision 12: ranking/top-K ownership
and pipeline position; Decision 13: candidate-ranking score formula).
Consequently this decision is PROVISIONAL and cannot be implemented as
written:

* Rule 3 ("Ranking") and the first key of Rule 5's ordering chain depend on the
  candidate-ranking score formula owned by Decision 13 — which does not exist.
* Rule 6 ("Pipeline position") depends on the ranking/top-K ownership and
  position established by Decision 12 — which does not exist.
* Rule 4 ("Retention") is internally coherent but has no input: it cannot be
  applied without the ranking stage and score it consumes.

Nothing in `src/recommendation/**` implements ranking, top-K application, or
scoring arithmetic (see the evidence blocks under Decisions 12 and 13), so no
code contradicts these rules; the block is procedural, not a conflict. Rules
1, 2, 4, 5 (tie-break chain), 7 and 8 remain valid as recorded. The rules
below are preserved verbatim; this status block is additive, and Decision 14
becomes RESOLVED only once Decisions 12 and 13 are decided.

Update 2026-09-19: Decision 13 is now RESOLVED (candidate-ranking score formula, above); this decision remains blocked only on Decision 12 (ranking/top-K ownership + pipeline position).
Update 2026-09-20: Decision 12 is now RESOLVED (ranking/top-K ownership + pipeline position, above); with Decision 13 (2026-09-19), both blockers are decided -- this decision is fully RESOLVED, and Rules 3, 5 (key 1), and 6, previously blocked, are now unblocked and implementable.

### Rule 1 — Per-role scope

`candidate_caps.top_k_per_role = K` applies independently to each `component_role`. The ranking/top-K stage is executed per role bucket; the K value is identical for every role and comes from a single configuration key.

### Rule 2 — Eligible candidates

Only `PASS` and `UNKNOWN` candidates entering the ranking stage are eligible for retention. `REJECT` candidates are excluded before ranking/top-K and are never eligible.

### Rule 3 — Ranking

Eligible candidates in each role bucket are ordered by the candidate-ranking score defined by Decision 13, with higher score ranked first. The score formula itself is owned by Decision 13 and is not changed or redefined here.

### Rule 4 — Retention

**Selected semantics: A — Hard upper bound.**

For each `component_role`:

1. Rank eligible candidates by candidate score descending (Rule 3), using the deterministic candidate ordering of Rule 5 to resolve equal scores.
2. Retain the candidates occupying the first K positions of that ordering.
3. Discard every candidate after position K.

Formal semantics:

```text
retained_count <= K
retained_count = min(K, eligible_count)
```

Consequently: if fewer than K eligible candidates exist, all of them are retained; if K or more exist, exactly K are retained. If the Kth and (K+1)th candidates have equal scores, the deterministic tie-break of Rule 5 still selects exactly K — equal scores never expand retention beyond K.

### Rule 5 — Equal-score handling

**Authorized: YES.** The existing `compareCandidates()` ordering (`src/recommendation/candidates/select.js` / `loader.js`) is the authorized deterministic tie-break for equal candidate scores. The full retention-ordering key chain is:

```text
1. candidate score                    DESC   (Decision 13 score)
2. component_role enum order          (ROLE_ORDER; constant within a role bucket)
3. product_id                         ASC
4. product_variant_id                 NULL first, then ASC
```

Because this chain ends in unique identity keys, it is a total order over the candidates of a role bucket; the candidate at position K is therefore always uniquely and reproducibly determined. Under Rule 4's hard-upper-bound semantics, this ordering does determine whether an equal-score candidate at the K boundary survives. No new comparator, ordering scheme, or additional tie-break level is introduced.

### Rule 6 — Pipeline position

The resulting per-role top-K candidate sets are passed to Engine 3 after scoring/ranking/top-K processing, as established by Decision 12. This decision changes nothing in Engine 3: its validation, assembly, and "per-role cap validated only, never applied" stance remain untouched.

### Rule 7 — `max_builds_per_query`

`candidate_caps.max_builds_per_query` remains independent of this decision and continues to limit completed builds during Engine 3 assembly (traversal halt cap). It is not a retention, ranking, or per-role parameter.

### Rule 8 — Configuration source

`candidate_caps.top_k_per_role` remains the sole source of the K value. No separate `roleCaps` configuration, no per-role override structure, and no additional configuration key is introduced. Its existing validation contract (positive integer, strict two-key `candidate_caps` object) is unchanged.

### UPDATE 2026-10-30 — Rule 8's "no per-role override structure" is superseded by Decision 59

Decision 59 amends this Rule. `candidate_caps.top_k_by_role` is now an OPTIONAL, closed,
canonical-role-keyed override of `top_k_per_role`, so a model may deepen ONE role (it ships as
`launch-v2@2.4.0` with `{"CPU": 10}`). What still holds: the uniform K remains REQUIRED, remains
the source for every role without an entry, and every model that declares no override is
byte-identical. What no longer holds is this Rule's last sentence - "No separate `roleCaps`
configuration, no per-role override structure, and no additional configuration key is
introduced" - because exactly that key now exists. The edit is recorded here, in place, so this
entry and Decision 59 cannot disagree; Rules 1-7 and the K semantics they define are untouched.

---

---

## Decision 15 — UNKNOWN pairwise-count producer (Decision 13's B1)

Status: RESOLVED 2026-09-19 — UNKNOWN pairwise-count producer (Decision 13's B1); implemented.

Date: 2026-09-19 (product decision + implementation pass). Resolves BLOCKING
QUESTION B1 raised by the 2026-09-19 Engine 4 build-score plan
(`scoring/build-score.js`, item 2/7): nothing in the pipeline retained which
pairwise compatibility checks resolved UNKNOWN, so Decision 13's
`unknown_compat_penalty * count of UNKNOWN pairwise compatibility checks` term
had no producer and the count was an injected input.

### Decision

The count is carried forward as a plain integer through the existing engine
outputs. One field name, `unknown_pairwise_count` (non-negative integer), on
two existing frozen objects:

* **Engine 2D verdict** (`filterCandidates`, `src/recommendation/filtering/
  filter.js`): the number of pair records — one per (candidate, partner)
  evaluation across the role's applicable relationships — whose aggregated
  status resolved UNKNOWN (worst-of FAIL > UNKNOWN > PASS).
* **Engine 3 build** (`assembleBuilds`, `src/recommendation/assembly/
  assemble.js`): the integer sum of the picked verdicts'
  `unknown_pairwise_count`, folded in the same EXPANSION_ORDER pass as the
  running total. The GPU-omit path picks no GPU verdict and contributes 0;
  the DFS traversal itself is unchanged.

**Counting semantics:**

* Only actual pair evaluations count. An empty partner bucket contributes 0 —
  its vacuous relationship-level UNKNOWN (zero partners) is not a pairwise
  check because no pair exists.
* Every relationship is evaluated from both participating roles, so a
  symmetric UNKNOWN product pair is counted once per direction. This
  compounds under Decision 13's per-occurrence penalty, which is the
  documented intent ("multiple silent UNKNOWNs must not be under-penalized").
* REJECT verdicts carry the count too (uniform verdict contract) but never
  enter assembly.

**Consumption (Engine 4):** `computeBuildScore` is unchanged — its
`unknownPairwiseCount` validation already accepts any non-negative integer.
`computeBuildScores` makes `unknownPairwiseCounts` OPTIONAL: an explicit
array still wins (injection kept for callers that derive the count
differently); when absent, the count is read per build from
`build.unknown_pairwise_count`, and a missing/invalid build count fails fast
with the existing error codes.

**Rejected alternatives:**

* Pair-identity lists carried through builds — rejected: Engine 2D pairs are
  candidate-vs-pool evaluations, so a carried list would name partners that
  are not in the build, making "in the build" data misleading, and Decision
  13 consumes only a count.
* Per-build pair recomputation among the chosen components only — rejected
  for now: it would put Engine 1 evaluation inside Engine 3, a boundary
  change beyond this data-plumbing gap; it remains available as a future
  producer decision if the counting unit is ever redefined. **(Superseded in
  part by Decision 16, 2026-09-21: the re-evaluation is adopted for
  VALIDATION only — the FAIL gate inside Engine 3's DFS — while the count
  producer chain of this decision stays untouched.)**

### Rationale

* Minimal additive plumbing: one integer field per frozen output object, no
  restructuring, no renamed exports, no new error codes (the existing
  MISSING_REQUIRED_FIELD / INVALID_FIELD_VALUE vocabulary is reused).
* The integer maps 1:1 onto the existing `unknownPairwiseCounts` batch
  contract, so Engine 4's Decision 13 STEP 3 arithmetic is untouched.
* The list and recomputation variants change what the count MEANS; this
  decision only fills the producer gap while preserving Decision 13's
  formula verbatim.

### Impact

* Decision 13's formula text is unchanged; its previously injected input now
  has a producer. Decision 12/14 remain unchanged (Decision 12 since RESOLVED 2026-09-20, see Final Status).
* Implemented in the same pass: `filtering/filter.js` (per-verdict count),
  `assembly/assemble.js` (per-build sum + verdict gate), `scoring/
  build-score.js` (batch fallback + B1 note resolution), with contract tests
  in the three suites. No database change, no migration.

### Verdict for this pass

```text
VERDICT: RESOLVED - UNKNOWN pairwise-count producer adopted (integer carry-forward: Engine 2D verdict -> Engine 3 build -> Engine 4 batch fallback)
```

---

## Decision 16 — Pairwise branch validation inside Engine 3's DFS

Status: RESOLVED 2026-09-21 — pairwise branch validation inside Engine 3's DFS; implemented.

Date: 2026-09-21. Resolves the recurring engine-behavior flag recorded in
`DEVELOPMENT_NOTES.md` (2026-09-19): Engine 2D's best-of-partner aggregation
masks pair-level FAILs at the relationship/verdict level — observed twice
(CPU↔MB exact-SKU override, GPU length) — so two candidates that each carry a
PASS/UNKNOWN verdict can still form a definite FAIL pair. Engine 2D's verdict
is per candidate (does this candidate have at least one compatible partner?),
not per combination; only Engine 3's DFS sees concrete combinations.

### Decision

Engine 3's DFS (`assembly/assemble.js`, Step 4) re-checks every tentatively
picked candidate against every already-picked partner it has a relationship
with, reusing Engine 2D's own pair evaluators verbatim:

* **Exports:** `filtering/filter.js` additionally exports its eight pair
  evaluators plus `aggregateCompatibilityResults` and `FINAL_STATUSES`
  (both re-exports of `../compatibility`). No second implementation and no
  second vocabulary exist anywhere in the handoff.
* **Traversal-time checks:** for each role, the relationships whose partner
  role comes EARLIER in `EXPANSION_ORDER` are checked when the role's
  candidate is tentatively picked (MOTHERBOARD→cpu_motherboard; RAM→
  motherboard_memory + platform_memory; PSU→gpu_psu; CASE→case_form_factor +
  gpu_case; CPU_COOLER→cooler_socket + case_radiator). Canonical resolver
  argument order is preserved (the newly picked candidate is the canonical
  left role only for `case_radiator`).
* **Gate semantics:** a pair aggregates with
  `aggregateCompatibilityResults` (worst-of FAIL > UNKNOWN > PASS). Any
  FAIL abandons the branch immediately — the branch is never walked further,
  exactly like the budget cutoff or an empty role bucket. PASS and UNKNOWN
  pairs stay eligible (no demotion, no weighting) — the existing eligibility
  contract is unchanged. The GPU-omit path picks no GPU, so no GPU pair
  exists and none is evaluated (zero partners is never a FAIL).
* **Input threading:** the frozen Engine 2D context travels as the TENTH
  field of the Engine 3 input contract, `filtering_context` — validated for
  top-level shape only and preserved by reference (the B2-B loader already
  delivers it deep-frozen; same ownership rule as `prices`).
  `assembleBuildsForRecommendation` already received the context
  (`sources.filteringContext`) and passes it through; direct
  `assembleBuilds` callers must now supply it (fail-closed: a missing or
  malformed context is INVALID, never silently skipped).
* **Silent pruning:** there is no new output field, no counter and no log.
  A pruned branch is indistinguishable from any other exhausted branch;
  the frozen output contract stays `{ builds }`.

**Explicitly NOT changed:** `unknown_pairwise_count` keeps its Decision 15
semantics — the per-verdict, per-pool counts summed per build. The DFS's
re-evaluated pairs are used for the FAIL gate only and are never counted.
This decision does NOT redefine the counting unit that Decision 15 declined
to redefine; it only revives the rejected alternative's *validation* use.

**Performance shape:** at most 2 extra pair evaluations per DFS node
(worst case 8 per complete GPU-present path, 6 per omit path), each a pure
map-lookup + small resolver call. Pruning only shrinks the explored tree, so
total work is bounded by the ungated walk plus a small constant; no
memoization is added.

### Rationale

* The verdict/combination gap is a correctness hole, not a data-plumbing
  gap: today's DFS assembles combinations (e.g. the seeded
  `Seed Ryzen 5 8600G` × `Seed MSI PRO B650M-P` exact-SKU FAIL pair) that
  Engine 2D's own resolvers rate FAIL.
* Reuse, never reimplement: the DFS consumes the exact functions
  `evaluateCandidate` wires; the resolvers, aggregation and vocabulary are
  Engine 1's.
* Fail-closed: the context is required, so a caller cannot accidentally
  bypass the gate.
* Direct module consumption (`assembly/assemble.js` →
  `../filtering/filter`) follows the established igpu-map precedent; the
  B2-H public barrel surface is deliberately unchanged.

### Rejected alternatives

* An observable rejected-pair count or log — rejected: would extend the
  frozen `{ builds }` output contract with no consumer today, and logging
  violates the module's no-I/O purity.
* Redefining `unknown_pairwise_count` over the DFS's pairs — rejected:
  silently revives Decision 15's rejected counting-unit change and breaks
  the Engine 4 batch contract's meaning.
* Reordering `EXPANSION_ORDER` topologically so every relationship is
  checkable at the earliest possible depth — rejected: the traversal order
  is a frozen, documented contract.
* An optional context (absent → skip checks) — rejected: fail-open, against
  the codebase's fail-closed ethos.
* Memoizing pair results across nodes — rejected: unnecessary at current
  pool/path sizes; would add state to a pure function.
* Placing the evaluators on the B2-H public barrel — rejected: no external
  consumer; the barrel's six-export surface stays frozen.

### Impact

* Engine 3's input contract grows from nine to ten fields
  (`assembly/input.js`, `pipeline.js`, `assemble.js` headers updated);
  previously-valid pair-FAIL combinations (like the seeded CPU2+MB1 shape)
  correctly disappear from `assembleBuilds` output.
* Test-surface changes: `assemble.test.js`'s source-boundary list drops the
  `'filtering/'` needle and pins the now-five allowed requires; new Decision
  16 unit tests (FAIL prune, UNKNOWN eligibility, GPU-pair pruning on both
  omit/REQUIRED paths, malformed-context fail-fast) and one end-to-end
  pipeline test cover the behavior. No existing fixture changed: fixtures
  without spec data read all pairs UNKNOWN, and the pipeline fixture's only
  pair-FAIL board is already REJECT for every CPU.
* Resolves the 2026-09-19 recurring best-of-masking flag for the assembly
  stage (the verdict-level question remains open for Engine 5 separately).

### Verdict for this pass

```text
VERDICT: RESOLVED - pairwise branch validation adopted (Engine 2D pair evaluators reused inside Engine 3's DFS; FAIL abandons the branch; UNKNOWN/PASS eligible; silent pruning; filtering_context as tenth Engine 3 input field)
```

---

## Decision 17 — Query loader and orchestrator contract

Status: RESOLVED 2026-09-21 — query loader and orchestrator contract; implemented.

Date: 2026-09-21. Product decision pass recording the query data-loading layer's
module split, the no-writes orchestrator contract, and the snapshot-transaction
policy required before any wiring task lands. Documentation only: no query/
module, no orchestrator/ module, no code change, no migration, no seed, no test
change, no commit.

### Decision

1. **Two modules.** `query/` turns the `recommendation_query` row into the
   Engine 2A input per Decision 10 (fail-closed use_case, required_roles
   constant). `orchestrator/` owns the loaders plus pure composition — NO
   writes. Persistence is a separate module (Decision 19).
2. **Signature.** `runRecommendation({ db, queryId })` -> frozen
   `{ query_id, scoring_model_id, builds }`. `db` is injected, never created
   or closed. `nowMs` is the transaction timestamp: `runRecommendation`
   issues `SELECT CURRENT_TIMESTAMP AS now` through the injected db as its
   FIRST statement inside the D17.5 snapshot transaction (Decision 7 F3:
   transaction-start time, constant for the transaction), converted with
   `new Date(value).getTime()` — the same instant Stage 1 and the assessment
   loader see. Still one DB-side time source; no injected clock, no JS clock.
   REASON loaded_at was rejected as the source (G4): when the assessment
   query returns zero rows, `loaded_at` is null and Engine 4 would fail
   fast, but a pool with no assessment rows is a legitimate no-evidence case
   (Decision 13's no-evidence penalty path), so the orchestrator must not
   depend on assessment rows for its clock.
3. **Wiring order.** query loader -> read transaction timestamp -> nowMs ->
   2C `selectCandidatePool` -> Stage 1 `selectOfferPrices` ->
   `loadFilteringContext` ONCE -> `filterCandidates` ->
   `loadComponentAssessments` ONCE (reused by both scoring steps) ->
   `computeCandidateScores` -> `retainTopKPerRole` ->
   `assembleBuildsForRecommendation` (same filtering-context object) ->
   `computeBuildScores`. `filterCandidatesForRecommendation` is NOT used (it
   returns only results and hides the context Engine 3 also needs).
   `retainTopKPerRole` only ever receives `filterCandidates` output from the
   same run (closes the retention trust-boundary flag in
   `DEVELOPMENT_NOTES.md`).
4. **Failures.** `CandidateSelectionError` (existing vocabulary): blank/NULL
   use_case (per Decision 10), missing query row (INVALID_INPUT), missing
   scoring model (SCORING_MODEL_UNAVAILABLE). Zero builds is NOT an error:
   `builds: []`.
5. **Snapshot transaction.** All loaders run inside ONE transaction opened as
   `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, because Stage 1 and the
   assessment loader use CURRENT_TIMESTAMP (stable only per transaction,
   Decision 7 F3) and no loader opens a transaction. A wrapper
   `runRecommendationSnapshot(client, queryId)` in `orchestrator/` owns the
   BEGIN and the end of the transaction; `runRecommendation` itself issues no
   BEGIN. The Decision 19 write is a SEPARATE, later transaction.
6. **Ignored v1 fields.** `recommendation_query.resolution`, `.priority` and
   `.recommendation_profile_id` are accepted and IGNORED in v1 (no engine
   consumer). Recorded so the gap versus the product pitch is explicit, not
   silent. Priority variation is expected to come later via a different
   `scoring_model_id`. **AMENDED 2026-10-23:** the "no engine consumer" half is
   no longer true, and has not been since 2026-10-09/10. `loadQueryInput`
   SELECTs `resolution` and `priority` and returns both as SIBLINGS of the
   Engine 2A input (never inside it); E2 (Decision 39) made `resolution` a
   retention input through `retention/targets.js`'s GPU spend multiplier, E4
   (Decision 41) made `priority` the archetype ORDER in
   `ranking/select-archetypes.js` `strategyOrder`, and E5 (Decision 42) gave
   `resolution` a second consumer, the optional per-resolution VRAM floor.
   What still holds is the consequence this item was actually about: on the
   current catalog neither field moves the observed result, because no active
   model declares `resolution_profiles` and the catalog exposes only one or two
   distinct (CPU, GPU) pairs, so the three strategies cannot diverge.
   `.recommendation_profile_id` is still read by nothing.

### Gate G4 record

* PASS on the arithmetic: `nowMs` must be a finite epoch-millisecond number
  (`effective-score.js:125-136`, `validateNowMs`) and its only arithmetic use
  is `ageDays = Math.max(0, (nowMs - assessment.assessed_at) / MS_PER_DAY)`
  (`effective-score.js:213`). A `CURRENT_TIMESTAMP` value converted with
  `new Date(value).getTime()` satisfies both.
* `loadComponentAssessments` returns `loaded_at` as a strict UTC ISO string
  from `CURRENT_TIMESTAMP AS loaded_at` (`load-assessments.js:80`, returned
  at `:303`). Edge recorded as the rejection reason: when the request
  returns ZERO assessment rows, `loaded_at` is `null` and `validateNowMs`
  would fail fast before the no-evidence branch — a legitimate no-evidence
  pool must not fail the clock, so `loaded_at` was rejected as the `nowMs`
  source.

### Rejected alternatives

* One combined module.
* Using `filterCandidatesForRecommendation`.
* An orchestrator that persists.
* Separate autocommit reads without a snapshot transaction.
* Deriving `nowMs` from the assessment `loaded_at`.
* An injected or JS-clock `nowMs`.

### Impact

* This decision is the wiring contract for the first orchestrator
  implementation task; `filtering/pipeline.js` (B2-G) stays the public Engine
  2D entry point but is bypassed by the orchestrator in favor of the two-stage
  composition, because Engine 3 needs the context object.
* Closes (by construction) the retention trust-boundary flag recorded in
  `DEVELOPMENT_NOTES.md` (2026-09-20): the orchestrator is the only caller and
  feeds `filterCandidates` output of the same run.

### Verdict for this pass

```text
VERDICT: RESOLVED - query loader + no-writes orchestrator contract adopted (query/ + orchestrator/ module split; runRecommendation({ db, queryId }); nowMs = the snapshot-transaction CURRENT_TIMESTAMP, loaded_at rejected per G4 zero-row edge; one REPEATABLE READ READ ONLY snapshot transaction owned by runRecommendationSnapshot)
```

---


## Decision 18 — Ranking (Engine 5a)

Status: RESOLVED 2026-09-21; IMPLEMENTED 2026-09-22 — ranking (Engine 5a).

Date: 2026-09-21. Product decision pass recording Engine 5a's pure ranking
contract ahead of the wiring task. Documentation only: no ranking/ module, no
code change, no migration, no commit.

### Decision

1. Pure module `ranking/`, in memory, before persistence.
2. **Sort.** `build_score` DESC, then `total_price` ASC, then content
   signature ASC (signature = component `product_id` + `product_variant_id`
   in `EXPANSION_ORDER`). Rank is 1..n, no equal ranks. Build id / DFS order
   never affect rank.
3. Score and `total_price` are rounded to 2 decimals BEFORE comparing; the
   rounded values are what is persisted.
4. All builds Engine 3 emits are ranked; only the top 10 are persisted.
   `TOP_N_PERSISTED = 10` is a code constant in `ranking/` (NOT a new
   `scoring_model` config key; Decision 11 keeps `candidate_caps` a closed
   two-key object). `max_builds_per_query` stays the assembly cap in
   `scoring_model.configuration`.
5. **Build compatibility_status [gated G1].** UNKNOWN if
   `unknown_pairwise_count > 0` or any component status is UNKNOWN, else
   PASS. Computed by ranking (assemble.js emits no build-level status). No
   extra sort key (the score already carries the unknown penalty).
6. The verdict-level masking flag (`DEVELOPMENT_NOTES.md` 2026-09-19) is
   CLOSED for ranking: ranking consumes only assembled, pair-validated builds
   (Decision 16). The residual effect — masked pairs can still affect which
   candidates take retention slots — is accepted.
7. **Supersedes** the architecture doc's stage-9 wording ("rank assigned
   after persistence", `RECOMMENDATION_ENGINE_ARCHITECTURE.md:508-510`) and
   its stage table placing build scoring before assembly (`:625-627`). The
   architecture doc is NOT edited here (refresh deferred); the supersession
   is recorded here only.

### Derived finding (recorded, NOT executed)

With retention wired, the first `max_builds_per_query` builds fix CPU,
MOTHERBOARD, RAM, GPU, PSU and CASE at each role's top candidate and vary
only CPU_COOLER and SSD_BOOT; raising `max_builds_per_query` does not fix
this (each additional varying role needs roughly K times the cap).

Evidence (file:line, derived, not executed): `assemble.js:71-81`
(`EXPANSION_ORDER`), `:523` and `:547` (per-role option loops in incoming
order — no sort in assemble.js), `:500-502` (traversal halt at
`max_builds_per_query`), `retain.js:272` (retention sorts each role bucket
by candidate score DESC before the K-cap).

### Verdict for this pass

```text
VERDICT: RESOLVED - Engine 5a ranking contract adopted (pure ranking/; build_score DESC, total_price ASC, signature ASC; 2-decimal rounding before compare; TOP_N_PERSISTED = 10 code constant; G1-gated build compatibility_status; architecture stage-9 wording superseded)
```

### Decision 18 addendum (2026-09-21) - Engine 5a implementation record

Status: RESOLVED 2026-09-22 — implementation record for Decision 18 (not a new decision).

Recorded when Engine 5a was implemented as the pure module
`src/recommendation/ranking/` (`rank.js` + public barrel `index.js`, unit
tested with node:test; no DB access, no persistence, no orchestrator wiring).
Additive only: no earlier decision text is edited.

- **D1 - Signature encoding + comparison.** For each role in
  `EXPANSION_ORDER` the segment is `ROLE:product_id:variant_or_empty`
  (null/absent variant -> empty string), segments joined with `|`; an omitted
  GPU still contributes its empty slot (`GPU::`). Signatures are compared
  strictly by UTF-16 code unit (`<` / `>`), NEVER `localeCompare`.
- **D2 - Rounding rule.** `round2` rounds half-up on the shortest decimal
  representation (string-exponent technique: shift the decimal point of
  `String(x)` two places right, round the integer, scale back; guard: if
  `String(x)` contains `e`, fall back to `Math.round(x * 100) / 100`).
  `build_score` and `total_price` are rounded BEFORE comparing; the rounded
  values are what the ranked entry carries (Decision 18.3) and what 5b
  persists.
- **D3 - Contiguous ranks.** Ranks are 1..k with no equal ranks and no gaps;
  discovery order and build ids never influence rank.
- **D4 - Status value set.** `compatibility_status` emits ONLY `PASS` or
  `UNKNOWN` (Decision 18.5, G1): `UNKNOWN` iff `unknown_pairwise_count > 0`
  or any component status is `UNKNOWN`, else `PASS`. No other value exists.
- **D5 - Duplicate-signature fail-fast.** Two input builds carrying the same
  signature fail fast (`INVALID_FIELD_VALUE` on field `builds`), because rank
  would otherwise depend on input order.
- **D6 - Explanation placeholder.** Every ranked entry carries
  `explanation: null` until Engine 6 (Decision 19.5); the ranked in-memory
  result leaves the field in place for Engine 6's pre-write generation.
- **D7 - 5b rule: fail-fast on existing rows.** The persistence writer
  (Decision 19.2) locks the query row and refuses (fail-fast) when
  `build_candidate` rows already exist for it; no overwrite, no delete, no
  upsert.
- **D8 - 5b rule: zero builds write nothing.** A zero-build pass persists
  nothing (Decision 19.3); zero builds is a valid outcome, not an error.
- **D9 - 5b rule: default isolation, no retry.** The write transaction runs
  at the default isolation level (no explicit escalation) and never retries
  on failure; commit stays wrapper-owned (Decision 19.1).
- **total_price rule for 5b.** `build_candidate.total_price` is the `round2`
  of the Engine 3 build total (the rounded value carried by the ranked
  entry); 5b asserts its equality with the sum of the persisted component
  `selected_price` values before writing (all-or-nothing guard).
- **No migration 012.** No new migration is added for ranking/persistence v1:
  the lossy v1 mapping (Decision 19.6, unpersisted fields) is accepted, and
  Engine 6 generates explanation text in memory BEFORE the write (Decision
  19.7) instead of persisting generation inputs.
- **Engine 4 contributions API.** The per-component score-contribution API
  needed for explanation text will be built together with Engine 6 (Decision
  19.7) as an additive Engine 4 change; Engine 5a touches no scoring code.

Implementation notes (verified 2026-09-22, `npm run test:unit` = 724 pass /
0 fail, +55 new): `EXPANSION_ORDER` is imported from the assembly public
barrel (never duplicated); error vocabulary is the existing
`CandidateSelectionError` / `ERROR_CODES` contract (absent build-level fields
-> `MISSING_REQUIRED_FIELD`, present-but-invalid -> `INVALID_FIELD_VALUE`);
outputs are deeply frozen and inputs are never mutated; ranked entries
reference the original build objects by identity.

---


## Decision 19 — Persistence (Engine 5b)

Status: RESOLVED 2026-09-21; IMPLEMENTED 2026-09-23 — persistence (Engine 5b).

Date: 2026-09-21. Product decision pass recording the Engine 5b persistence
contract ahead of implementation. Documentation only: no persistence module,
no code change, no migration, no commit.

### Decision

1. One transaction per recommendation query, all-or-nothing. The writer
   NEVER issues BEGIN/COMMIT itself; a thin wrapper owns commit, so tests
   can wrap the writer in BEGIN ... ROLLBACK (`scripts/test-layer4.js`
   pattern).
2. A `recommendation_query` is an immutable request; a re-run means a NEW
   query row. The writer locks the query row (`SELECT ... FOR UPDATE`) and
   refuses (fail-fast) if `build_candidate` rows already exist for it. No
   overwrite, no delete, no upsert.
3. Zero builds: write nothing. Adding `status`/`completed_at` to
   `recommendation_query` is recorded as FUTURE / non-blocking (no consumer
   exists; Layer 4 is empty so this is the cheapest moment if a consumer
   appears). No migration now.
4. UUIDs for `build_candidate` / `build_component` / `recommendation_result`
   rows are generated in JS and inserted explicitly (no reliance on
   RETURNING order).
5. **Mapping.** `build_candidate` <- total_price, score (build_score),
   compatibility_status (Decision 18.5); `build_component` <- product_id,
   product_variant_id, component_role, selected_price, currency, store_id,
   price_checked_at; `recommendation_result` <- query id, build_candidate id,
   rank; `explanation` NULL until Engine 6.
6. NOT persisted in v1 (no destination column): `unknown_pairwise_count`,
   component category and status, verdict reasons/relationships,
   `candidate_score`, build currency. `store_offer_id` stays FUTURE (011:33).
7. Engine 6 must generate explanation text in memory BEFORE the write; the
   ranked in-memory result must therefore leave room for it. Engine 4 will
   later need to expose score contributions (additive change).
8. Write tests must use `scripts/lib/db-url.js` (TEST_DATABASE_URL) and a
   rollback pattern; SQL shape is also covered by fake-client unit tests.

### Rejected alternatives

* Overwrite/upsert on re-run.
* Writer-owned commit.
* DB-generated ids with RETURNING mapping.
* Persisting all builds.

### Verdict for this pass

```text
VERDICT: RESOLVED - Engine 5b persistence contract adopted (one all-or-nothing transaction per query; wrapper-owned commit; immutable query rows with FOR UPDATE re-run guard; JS-generated UUIDs; v1 column mapping recorded)
```

---

## Decision 20 — Assembly diversity

Status: RESOLVED 2026-09-22 — assembly diversity: post-ranking (CPU, GPU) pair selection (O4, `MAX_PER_PAIR = 3`); implemented.

Date: opened 2026-09-21; resolved 2026-09-22 after measurement on the
15-product minimal seed (assembly-only at cap 25 / 100 / 100000, then
assembly + scoring + ranking at cap 100). Documentation only: no code
change, no commit.

SEED-SIZE NOTE (added 2026-09-28). "The 15-product minimal seed" is the
catalog as it stood at this decision's measurement time: `001_minimal_builds.sql`
only. The catalog is now **100 products** after `002_catalog_expansion.sql`
(85 products) and `003_gpu_psu_connector_data.sql` (data-only, no new
products), and `scripts/measure-orchestrator.js` now preflights that full
catalog (products = 100 / offers = 101 / assessments = 25). Every
"15-product minimal seed" figure below - the 113 valid GAMING builds at the
raised cap, the 27.13 / 20.46-point score ranges, the OFFICE 9-of-10 pair -
is therefore scoped to seed 001 and is NOT what the harness reports today.
Its Decision 20 claim comparisons are re-measured on the larger catalog every
run; recorded on the first such run (2026-09-28, TEST_DATABASE_URL branch):
GAMING 2 distinct CPU product_ids (claim 1) and 2 distinct GPU pair values
(claim 2, exact), OFFICE largest single pair 10 of 10 (claim 7). This note
records a measurement difference only - it does not re-open Decision 20's
adopted O4 / `MAX_PER_PAIR = 3`.

CONFIRMED BY MEASUREMENT (2026-09-23) — reconciled against both dated DEVELOPMENT_NOTES.md entries: "2026-09-23 — Decision 20 real measurement (measure-orchestrator.js first execution)" and "2026-09-23 (run 2) — Decision 20 top-10 (CPU, GPU) pair concentration (measure-orchestrator.js)".

### Decision

1. **Finding.** Raising `max_builds_per_query` alone (O1) does not fix
   diversity. Confirmed by measurement on the 15-product minimal seed:
   GAMING at raised cap enumerated full diversity (2 CPU / 2 MB / 2 GPU /
   4 CPU-GPU pairs across 113 valid builds) but GAMING's own ranked top-10
   holds 1 distinct CPU product_id and 2 distinct GPU pair values (largest
   single pair 6 of 10); OFFICE's ranked top-10 holds 9 of 10 slots on one
   (CPU, GPU) pair (Seed Ryzen 5 8600G / GPU omitted — a stronger case for
   the cap than the 7 of 10 originally stated). Cause: `build_score` spreads
   widely across builds (GAMING 27.13-point range, OFFICE 20.46-point range), so one CPU/config
   dominates nearly every combination of trailing roles — ranking sorts
   correctly by score, but score-correctness and diversity are different
   objectives. Decision 18's Derived finding (recorded, NOT executed)
   remains valid as an enumeration-shape observation; measurement showed
   enumeration can be diverse while the persistable top-10 is not.
   (Known minor artifact, untouched: the two verification runs drift ~0.01 on
   means/extremes with gaps unchanged; unexplained, not a correctness issue.)

2. **Adopted approach: O4**, applied AFTER ranking, not by changing
   assembly's cap. Pipeline:

   ```text
   Engine 3 assembly (cap unchanged)
     -> Engine 4 scoring
     -> rankBuilds (Decision 18, unchanged full ranked list)
     -> NEW: post-ranking pair-diversity selection
     -> Engine 5b persists the selected set (ranks 1..k contiguous)
   ```

   `rankBuilds` continues producing the full deterministic ranked list
   unchanged (Decision 18 text is not edited). A new post-ranking
   selection step walks the ranked list top-down and skips any build that
   would exceed a diversity cap on the pair
   `(CPU product_id, GPU product_variant_id-or-omitted)`, until 10 survive
   or the ranked list is exhausted. An omitted GPU counts as its own pair
   value. Skipped builds keep their original rank number gap-free in
   internal tracking but do not receive a persisted rank; persisted ranks
   are renumbered 1..k contiguous per the already-adopted Decision 18
   addendum rule. `k` may be less than 10 if fewer than 10 builds survive.

3. **Diversity cap value.** A code constant (same pattern as
   `TOP_N_PERSISTED`, per Decision 11's closed `candidate_caps` and the
   O2/O4 mechanics discussion) — `MAX_PER_PAIR = 3` (at most 3 persisted
   builds may share the same `(CPU, GPU)` pair, where an omitted GPU
   counts as its own pair value). This is NOT a new `scoring_model`
   configuration key. The value is a starting point chosen from the two
   measured use cases, not derived from a formal target, and may need
   revisiting once real-market catalog data exists.

4. **What this does NOT change.** Assembly's `max_builds_per_query` stays
   whatever it is today (do not bundle a cap change into this decision).
   Decision 16 pairwise validation is unaffected. Decision 18 ranking
   algorithm and rank formula are unaffected (the new step consumes ranked
   output, does not alter it). `rankBuilds.top_n` remains "first 10 of
   ranked"; Engine 5b must persist the post-selection set, not that slice.

5. **Residual open question (future work, not blocking Engine 5b).** This
   was measured only on the 15-product minimal seed (seed 001 only; see the
   SEED-SIZE NOTE above - the catalog is now 100 products); a real-market
   catalog with more per-role options may produce different score spread and
   pairing behavior, and `MAX_PER_PAIR` may need to become use-case- or
   catalog-size-aware later.

### Verdict for this pass

```text
VERDICT: RESOLVED - post-ranking (CPU, GPU) pair diversity selection adopted (O4; MAX_PER_PAIR = 3 code constant; rankBuilds unchanged; assembly cap unchanged)
```

---

## Decision 21 — Full-run composition contract

Status: RESOLVED 2026-09-23; IMPLEMENTED — full-run composition contract (`orchestrator/full-run.js`).

Date: 2026-09-23. Product decision pass recording the composition contract for
wiring runRecommendation → rankBuilds → selectDiverseTop →
runRecommendationCommit. Documentation only: no code, no migration, no test
change, no commit.

### Decision

1. **Composition location.** A NEW top-level entry point,
   `runRecommendationFullRun(client, queryId)` in `orchestrator/full-run.js`
   (file/function naming mirrors `snapshot.js` / `commit.js` ->
   `runRecommendationSnapshot` / `runRecommendationCommit`), composes the full
   chain in order:
   ```text
   runRecommendationSnapshot(client, queryId)   - read tx, always ROLLBACKs
     -> rankBuilds({ builds })                  - Engine 5a, pure, full ranked list
     -> selectDiverseTop({ ranked })            - Decision 20, full ranked list, NOT top_n
     -> runRecommendationCommit(client, queryId, selected) - write tx
     -> frozen combined result (item 3)
   ```
   The commit cannot be appended inside `runRecommendation`: it executes
   inside `runRecommendationSnapshot`'s `READ ONLY` transaction and writes
   are rejected there. It is not put inside `run.js` either: the `run.js`
   header and Decision 17.3 explicitly forbid ranking, diversity selection
   and persistence inside `run.js`, and that boundary is pinned by tests
   (`requiresOf('run.js')`, the banned-token scan, the no-BEGIN assertion).
   A new module leaves every existing pin intact; only the barrel pins change
   (item 4).
2. **Connection ownership for the write transaction.** The SAME single
   dedicated connection is reused sequentially: the caller checks out ONE
   connection and hands it first to the snapshot transaction (which ends with
   ROLLBACK, leaving the session idle) and then to the commit transaction
   (BEGIN ... COMMIT). One checkout/release, no second pool slot, consistent
   with both wrappers' contract (caller owns one connection; neither wrapper
   creates or closes it). The two-transaction separation of Decisions
   17.5/19.1 is preserved — sequential reuse on one session, never nested,
   never concurrent.
3. **Return shape of the new composed entry.** The full traceable chain,
   frozen: `query_id`, `scoring_model_id`, `builds` (from the snapshot/run
   result), `ranked` / `top_n` (from `rankBuilds`, entries by reference per
   its contract), `selected` / `dropped_count` (from `selectDiverseTop`), and
   the commit result's `persisted_ranks`, `build_candidate_ids`,
   `recommendation_result_ids`. Intermediate stages (`builds`, `ranked`) ARE
   carried in the return, not dropped once consumed: Engine 6 must generate
   explanation text in memory BEFORE the write (Decision 19.7), so the
   selection-to-commit seam must stay observable — a shape that drops the
   intermediates now would force a reshape when Engine 6 lands.
4. **Barrel export change.** `Object.keys` deepEqual gains the new entry:
   `['runRecommendation', 'runRecommendationSnapshot',
   'runRecommendationFullRun']`; `requiresOf('index.js')` gains the new
   module (`'./full-run'`, sorted position). `commit.js` stays INTERNAL-only:
   no `requiresOf('commit.js')` barrel entry and no direct barrel export of
   `runRecommendationCommit` — the commit path is reachable only through the
   new composed entry. The new module itself issues no SQL and no transaction
   control (it delegates to the two wrappers), so the banned-token scan
   (COMMIT/INSERT/UPDATE/DELETE/...) extends to `full-run.js` exactly as it
   covers `run.js` / `snapshot.js`; `commit.js` stays deliberately outside
   that scan, as today. The wiring task pins `requiresOf('full-run.js')`
   (expected: the snapshot wrapper, the commit wrapper, and the ranking
   barrel).
5. **Zero-build / zero-selected propagation.** No short-circuit: a zero-build
   run (`builds: []`) flows through `rankBuilds` (frozen empties, valid per
   Decision 18) and `selectDiverseTop` (`selected: []`, `dropped_count: 0`),
   and `runRecommendationCommit(client, queryId, [])` is STILL called — the
   full write transaction (BEGIN, both guards, an empty `persistRanked` call,
   COMMIT), exactly per `commit.js`'s existing zero-write-but-full-transaction
   behavior. Same for a zero-selected outcome (full ranked list, cap drops
   everything). The guards are query-level rules, so an unknown or
   already-persisted query id still fails fast instead of silently
   `succeeding`.
6. **What this does NOT change.** Data shapes between consecutive functions
   already match field-for-field (verified against `validate-selected.js`) —
   this decision is composition only. Decision 20 item 4 stands (selection
   walks the full `ranked` list so capping can refill below rank 10;
   `rankBuilds.top_n` stays `first 10 of ranked` and is NOT what gets
   persisted). No Engine 6 work here — only the seam it will need. `run.js`,
   `snapshot.js`, `commit.js` and their tests are untouched by this pass.

### Rejected alternatives

* Ranking / selection / commit logic inside `run.js` (violates its documented
  non-responsibilities and Decision 17.3; breaks the existing boundary pins).
* Appending the commit inside the snapshot transaction (writes are rejected
  in a READ ONLY transaction; collapses the Decisions 17.5/19.1
  two-transaction separation).
* Two checked-out connections, one per transaction (unnecessary complexity;
  no contract requires it; doubles pool pressure for no gain).
* Dropping `builds` / `ranked` from the composed return (closes the
  pre-commit seam Engine 6 needs per Decision 19.7).
* Persisting `rankBuilds.top_n` instead of the post-selection set (already
  rejected by Decision 20 item 4; restated, not reopened).
* Exporting `runRecommendationCommit` directly from the barrel (kept
  internal-only; exactly one composed write path).
* Short-circuiting (skipping the commit call) on zero builds or zero
  selected (breaks guard consistency: unknown/already-persisted ids must
  still fail fast).

### Verdict for this pass

```text
VERDICT: RESOLVED - full-run composition contract adopted (new orchestrator/full-run.js runRecommendationFullRun: snapshot -> rankBuilds(ranked) -> selectDiverseTop -> commit on one sequentially reused connection; full traceable frozen return; commit stays internal-only; zero runs the full chain per commit.js)
```

---

## Decision 22 — Explanation generation (Engine 6) contract (RESOLVED 2026-09-24)

Status: RESOLVED 2026-09-24; IMPLEMENTED 2026-09-24 — explanation generation (Engine 6) contract; items 1–5 landed (see the UPDATE block below).

Grounding (investigation-confirmed, not re-derived): Engine 4 (`scoring/build-score.js`) returns only the final clamped `build_score` per build — no per-component, per-role, or per-type contribution breakdown is exposed anywhere, Decision 19.7 ("Engine 4 will later need to expose score contributions") was resolved by Decision 22 item 1 (implemented). The pre-write seam is deliberately kept open in `full-run.js` (Decision 21): `builds` / `ranked` / `selected` are all carried in the composed return, not dropped. `recommendation_result.explanation TEXT` already exists (migration 011) — no migration needed; what is missing is code-contract only (this clause recorded the pre-implementation state and is superseded — since the item-5 landing, `persist-ranked.js` binds `entry.explanation` as $5 and `validate-selected.js` requires it non-empty). Data available at generation time per build / component (confirmed exact shape): `rank` / `persisted_rank`, `build_score`, `total_price`, `compatibility_status` (PASS | UNKNOWN only), `signature`, and `components[]` each with `component_role`, `product_id`, `product_variant_id`, `category`, `status`, `price`. NOT available without re-derivation: per-(role, type) weights / effective scores, assessment rows, verdict reasons, `budget_amount`, `use_case` (budget / use_case exist only in the DB row, not on ranked / selected entries). The only content guidance is architecture §13 (deterministic from stored inputs: top contributing assessment types per role, `compatibility_status`, price / budget relationship; example "Ranked 1: best weighted score 87.5; PASS compatibility; 3120 MAD of 3500 MAD budget; GPU PERFORMANCE dominant."; same inputs -> same text; no template / fixture / format test beyond this). Decision 2(b): a not-verifiable CONDITIONAL pair maps to UNKNOWN and its condition text (e.g. "requires BIOS >= X") must be carried into the explanation.

### 1. Engine 4 additive contributions exposure

#### Decision: expose contributions via a sibling function; keep `computeBuildScores` output unchanged.

`computeBuildScores` (and `computeBuildScore`) keep their existing return shape byte-for-byte: frozen `{ scores: [{ build_index, build_score }] }` with the final clamped score only. The "top contributing assessment types per role" input is exposed by a NEW additive sibling pure function (e.g. `computeBuildScoreContributions({ builds, assessments, configuration, nowMs })`) returning an index-aligned frozen `{ contributions: [...] }`: one entry per build, each a per-role list of `{ role, type, effective_score, weight }` where `weight = role_weights[role][type] * type_weights[type]` and `effective_score = effective(component_in_role, type)` — the exact STEP 1 / STEP 3 inputs that produced `build_score`, iterated in `EXPANSION_ORDER` then configuration type-key order. Dominance is then derivable by sorting `weight * effective_score` (tie order in item 4) with no re-derivation of scoring. Explicitly ADDITIVE-ONLY: no change to `computeBuildScore` / `computeBuildScores` outputs; `rankBuilds` and everything downstream keep working unmodified against the existing fields.

Rationale: the minimal additive shape from which §13 "top contributing assessment types per role" is computable; reuses already-validated weight / effective-score inputs instead of a second scoring path.

Evidence: `src/recommendation/scoring/build-score.js` `computeBuildScores` returns only `{ build_index, build_score }`; no contribution field exists on any Engine 4 return.

Rejected alternatives (for this item): changing the `computeBuildScores` return shape in place; persisting assessment / weight inputs to new columns for Engine 6 to re-read; re-deriving weights / effective scores inside Engine 6 from config + assessments (duplicates Engine 4 ownership).

### 2. Where Engine 6 lives

#### Decision: new pure module (e.g. `src/recommendation/explanation/`), no DB, no SQL.

Engine 6 is a new engine module consistent with every other engine module in this project: pure functions only (no DB client, no SQL, no I/O, no clock, no randomness, no mutation of inputs). It consumes frozen in-memory inputs (`selected` entries + item 1 contributions + item 4 budget / notes) and returns new entry objects (or a new array) carrying real `explanation` strings.

Rationale: keeps engine ownership boundaries clean and the pre-write step unit-testable with fixtures, like Engines 3-5.

Evidence: every engine module (`filtering/`, `assembly/`, `scoring/`, `ranking/`, `persistence/validate-selected.js`) is pure except the DML-only writer; `full-run.js` / `index.js` are boundary-only composition.

Rejected alternatives (for this item): embedding explanation string-building directly in `full-run.js` (violates the boundary-only composition pattern of `index.js` / `full-run.js`); embedding it in `ranking/` (disturbs `rankBuilds`, which hard-codes `explanation: null` by contract per Decision 18 D6 — not to be disturbed).

### 3. Slot-in point in full-run.js

#### Decision: after `selectDiverseTop`, before `runRecommendationCommit`.

`runRecommendationFullRun` calls Engine 6 on each entry of `selection.selected`, producing a new explained array (same shape, `explanation` filled with real strings; copies, never mutating the frozen selection in place), then passes THAT array to `runRecommendationCommit` instead of the raw `selectDiverseTop` output. `commit.js` and `persist-ranked.js` interfaces are untouched at the call-shape level: they already accept a `selected`-shaped array; only the field content changes from `null` to string. The Decision 21 composed return keeps carrying `builds` / `ranked` / `selected`; once Engine 6 lands, the returned `selected` is the explained array.

Rationale: uses the deliberately-kept-open pre-write seam (Decision 21) for exactly the purpose Decision 19.7 named (generate text in memory BEFORE the write); no orchestrator reshape needed.

Evidence: `src/recommendation/orchestrator/full-run.js` (`selectDiverseTop` -> `runRecommendationCommit(client, queryId, selection.selected)`; return carries `builds`, `ranked`, `top_n`, `selected`).

Rejected alternatives (for this item): generating inside `runRecommendationCommit` / `persist-ranked.js` (mixes pure text generation into the transactional DML owner); generating inside `rankBuilds` (breaks Decision 18 D6); dropping `builds` / `ranked` from the composed return (closes the seam Engine 6 needs).

### 4. Format / content contract

#### Decision: fixed template-string composition by a pure function (not free-text / LLM).

Per-build `explanation` is a FIXED template-string composition, consistent with the one architecture-doc example — a deterministic pure function per the architecture doc's explicit requirement, not free-text or LLM generation:

```text
Ranked {rank}: best weighted score {build_score}; {PASS|UNKNOWN} compatibility; {total_price} {currency} of {budget_amount} {currency} budget; {ROLE} {TYPE} dominant[{; requires BIOS >= X}][{; UNKNOWN: {role-list}}]
```

Concrete rules: (a) `rank` / `build_score` / `total_price` / `compatibility_status` are the already-rounded entry values, never re-rounded or re-derived; `currency` is the build / price currency already on the entry. (b) `budget_amount` does NOT come from the selected entries (confirmed absent — only in the DB row); it is threaded explicitly from the already-loaded snapshot query input (`runRecommendationSnapshot` loads the query row) as an extra Engine 6 argument (e.g. `budget: { amount, currency }`) — Engine 6 never queries the DB itself and no new field is stuffed onto ranked entries; `use_case` is likewise NOT an explanation input. (c) Dominant `{ROLE} {TYPE}` is the top entry of the item-1 contribution list for that build, ordered by `weight * effective_score` descending; ties broken deterministically by `EXPANSION_ORDER`, then configuration type-key order, then code-unit comparison (never `localeCompare`, never input-order dependent). (d) Decision 2(b): a not-verifiable CONDITIONAL pair maps to UNKNOWN and its condition text MUST appear as a `requires BIOS >= X` clause (verbatim `min_bios_version` text); verdict reasons are confirmed absent from ranked / selected entries, so the text is threaded as an explicit per-entry `compatibilityNotes` input carried forward from the Engine 2D / 3 verdict layer (additive carry, same mechanism as item 1) — Engine 6 never re-derives support-table rows; when notes are absent / empty no BIOS clause is emitted. (e) UNKNOWN is NEVER silent: `compatibility_status === 'UNKNOWN'` always emits the `UNKNOWN compatibility` token, and any component with `status === 'UNKNOWN'` appends `; UNKNOWN: {comma-separated roles in EXPANSION_ORDER}` (roles only; no invented reasons).

Rationale: satisfies arch §13 (deterministic from stored inputs; same inputs -> same text) and Decision 2(b) with the smallest template covering the example plus the two mandatory uncertainty signals.

Evidence: arch §13 example quoted in Grounding; Decision 2(b) condition-carry rule; ranked / selected entries carry only PASS | UNKNOWN status with no reason text.

Rejected alternatives (for this item): free-text / LLM generation (violates §13 determinism + §14 re-run rule); locale-aware number formatting; silent UNKNOWN (violates UNKNOWN-never-silent); resolving CONDITIONAL to PASS by default or dropping the BIOS condition (violates Decision 2(b)); re-querying budget / assessments / compat tables inside Engine 6.

### 5. validate-selected.js and persist-ranked.js changes

#### Decision: require non-empty explanation at validation; bind it at persistence (intentional breaking change to "always null").

Once Engine 6 exists: `validate-selected.js` gains one rule — `entry.explanation` is REQUIRED non-empty string (`typeof === 'string' && explanation.trim().length > 0`; validation only, no trim-and-store), failing fast otherwise so silent-null passthrough is rejected at the commit boundary. `persist-ranked.js` binds `entry.explanation` as `$5` of `INSERT_RECOMMENDATION_RESULT` instead of the current hard-coded `null`. This is an INTENTIONAL BREAKING CHANGE to the current "explanation always null" contract: the existing tests asserting `null` (`rank.test.js` "explanation is null", `persist-ranked.test.js` "explanation hardcoded null", `validate-selected.test.js` null fixtures) MUST BE UPDATED to the new required-string rule, not merely added to. `rankBuilds` itself is untouched — it keeps emitting `explanation: null` per Decision 18 D6; the string is filled only at the item-3 pre-write seam.

Rationale: the validator is the last pure gate before the write; enforcing non-empty string there makes a missing Engine 6 call fail fast instead of persisting silent nulls into the non-nullable-meaning column.

Evidence: `persist-ranked.js` line 87 binds `null`; `validate-selected.js` never reads `explanation`; `recommendation_result.explanation TEXT` exists (migration 011) so no migration is needed.

Rejected alternatives (for this item): keeping `null` acceptance alongside strings (preserves silent-null passthrough); validating inside `persist-ranked.js` DML instead of the pure validator; changing `rankBuilds` to generate text (breaks Decision 18 D6).

### 6. Determinism / versioning

#### Decision: confirm arch §13 — same inputs -> same text; implicitly versioned with the scoring model, no separate version field.

Same inputs -> same explanation text, byte-for-byte (fixed template, fixed ordering rules in item 4, no clock / random / DB / locale-dependent formatting). Explanation text is IMPLICITLY VERSIONED with the scoring model by virtue of being deterministically derived from `scoring_model_id`-scoped data (weights, assessments via STEP 1, `unknown_compat_penalty`) plus the pinned query / budget snapshot — NO separate explanation version field or column. Any behavior change = new `scoring_model` row (arch §8 / §14 rule: never mutate a used configuration) and/or a versioned template change in the Engine 6 module, never an in-place reinterpretation of stored text.

Rationale: restates the architecture doc's explicit requirement; avoids schema churn for a derived-text field.

Evidence: arch §13 ("Same inputs -> same explanation text. Generation order and templates are part of Engine 6 and are versioned with the scoring model."); arch §14 re-run rule; arch §8 (every behavior change = new scoring_model row).

Rejected alternatives (for this item): separate `explanation_version` column / field; recording engine binary version per row (arch §14 ACCEPTABLE gap — release notes suffice); allowing in-place template reinterpretation of stored rows.

### UPDATE 2026-09-28 — implementation record (D3)

Items 1–5 of this decision are implemented and wired; the grounding sentences above that said
otherwise have been struck. Shipped state, verified 2026-09-28:

* **Item 1 (contributions):** `scoring/build-score.js` exposes `computeBuildScoreContributions`
  (additive sibling; `computeBuildScores` output unchanged, per the additive-only rule).
* **Item 2 (module):** `src/recommendation/explanation/` exists as a pure engine module.
* **Item 3 (slot-in):** `orchestrator/full-run.js` calls `explainSelection` between
  `selectDiverseTop` and `runRecommendationCommit`; the composed return carries the explained
  array as `selected`.
* **Items 4–5 (format / validation / write):** `explain.js` composes the fixed template string;
  `validate-selected.js` REQUIRES `entry.explanation` non-empty (fail-fast at the commit
  boundary); `persist-ranked.js` binds `entry.explanation` as $5 of
  `INSERT_RECOMMENDATION_RESULT`. The old `explanation: null` tests were updated, not merely
  extended, exactly as this decision required.

Items 6–8 above are decision text and are unaffected by this update; item 7 shipped as a
budget/currency field addition on the `runRecommendation` return. Any follow-ups they name
remain open as written.

### 7. Budget exposure on the `runRecommendation` / snapshot return (item 4(b) reachability)

#### Decision: add `budget_amount` + `currency` as two additive fields on `runRecommendation`'s existing frozen return, sourced from the query input already in scope at step 1; no second loader call.

Item 4(b) threads the budget into Engine 6 "from the already-loaded snapshot query input". That is not reachable through today's return shapes: `runRecommendation` returns exactly `{ query_id, scoring_model_id, builds }` (`orchestrator/run.js` lines 338-342), `runRecommendationSnapshot` hands that object back verbatim (`orchestrator/snapshot.js` line 91), and the Decision 21 composed return is the pinned ten-field object with no budget field (`orchestrator/full-run.js` lines 62-73). The data is nonetheless ALREADY in scope inside `run.js`: step 1 holds `const queryInput = await query.loadQueryInput(queryId, db)` (`run.js` line 252), whose frozen `input` is the Engine 2A selection input built by `createCandidateSelectionInput` — `Object.freeze({ budget_amount, currency, use_case, required_roles })` (`query/load-query-input.js` lines 213-226 → `candidates/input.js` lines 113-118). `queryInput.input.budget_amount` is the strictly converted NUMBER (plain-decimal NUMERIC strings only; `convertBudgetAmount`, `load-query-input.js` lines 156-176 — the same value Engine 3's budget cutoff consumes) and `queryInput.input.currency` is the query row's verbatim `[A-Z]{3}` string.

#### Decision (exact shape): at the EXISTING frozen-return statement (`run.js` lines 338-342) the object literal gains exactly two fields, appended after `builds` in this order — `budget_amount: queryInput.input.budget_amount`, `currency: queryInput.input.currency` — producing frozen `{ query_id, scoring_model_id, builds, budget_amount, currency }`.

This is a field ADDITION on an existing object, not a second loader call: `loadQueryInput` is still called exactly ONCE (line 252), no extra SELECT is issued, no ENGINE module changes, and no build gains a field (`build` keeps its exact five keys: `components`, `total_price`, `currency`, `unknown_pairwise_count`, `build_score`). `snapshot.js` needs no change (verbatim pass-through, line 91). `full-run.js` needs no change for reachability: item 3 calls Engine 6 inside `runRecommendationFullRun`, where `snap.budget_amount` / `snap.currency` are in scope; the Decision 21 ten-field composed return is deliberately left at ten fields — exposing the budget there would be a separate Decision 21 amendment, out of scope for this item. `use_case` is deliberately NOT added (item 4(b): not an explanation input). The new top-level `currency` is the same value already carried on every build (`assembly/pipeline.js` line 170 sources build `currency` from the same Engine 2A input; single-currency-per-query, arch §7), so it is a top-level convenience for the Engine 6 budget argument, never a second source of truth.

Additive discipline / the one pin that must be UPDATED: the existing three keys keep their names, order and values byte-for-byte and `builds` stays the same array (same elements, by reference); `orchestrator/run.test.js` line 362 pins the return keys exactly — `assert.deepEqual(Object.keys(result), ['query_id', 'scoring_model_id', 'builds'])` — and MUST be updated to `['query_id', 'scoring_model_id', 'builds', 'budget_amount', 'currency']` (item-5 discipline: update, not merely add). Stubs of the pass result (`snapshot.test.js` line 81; `full-run.test.js` lines 89 and 166) need no change until Engine 6's slot-in (item 3) actually reads the two fields.

Rationale: item 4(b)'s budget argument has to exist somewhere; exposing it once at the boundary that already loaded it keeps one loader call per pass (Decision 17.2), one caller-owned snapshot transaction (Decision 17.5) and zero query-level fields on build / ranked / selected records.

Evidence: `orchestrator/run.js` line 252 (the single loader call) and lines 338-342 (frozen three-key return); `query/load-query-input.js` lines 213-226 and `candidates/input.js` lines 113-118 (frozen input carrying `budget_amount` / `currency`); `orchestrator/snapshot.js` line 91 (verbatim pass-through); `orchestrator/full-run.js` lines 62-73 (pinned ten-field composed return); `assembly/pipeline.js` line 170; `orchestrator/run.test.js` line 362 (exact-keys pin); `orchestrator/full-run.test.js` lines 117-128 (composed-return keys pin).

Rejected alternatives (for this item): a second `loadQueryInput` call or any extra SELECT inside `full-run.js` / Engine 6 (duplicates a read the same pass already made; breaks the one-loader-per-pass rule); adding `budget_amount` to each build or to ranked / selected entries (contradicts item 4(b) and puts one query-level value on 1..N records); extending the Decision 21 composed return inside this item; re-deriving the budget from `total_price` / the price carrier; exposing `use_case`.

### 8. CONDITIONAL / BIOS condition-text carry — source, additive shape, exact drop point (item 4(d) specification)

#### Decision: project the CONDITIONAL evidence Engine 2D already computes into an additive per-verdict `compatibility_notes` field, and carry it onto the emitted build components in Engine 3; a change to `filtering/` + `assembly/`, never `scoring/`; no ranked / selected shape change, no validation change, no migration.

Item 4(d) asserts a per-entry `compatibilityNotes` "carried forward from the Engine 2D / 3 verdict layer (additive carry, same mechanism as item 1)" and cites "Decision 2(b)". Two things are pinned here.

(a) Citation: the CONDITIONAL rule is Decision 3(b), not Decision 2(b) — "Resolver output for a CONDITIONAL pair is the verdict CONDITIONAL plus the machine-readable condition (e.g. `min_bios_version`) ... the condition text is carried into the `recommendation_result` explanation ("requires BIOS >= X")" (this document, lines 243-260). Decision 2 is the dual-memory motherboard gap (line 150) and the Engine 3-input "Decision 2 — REJECT handling" (line 421); neither contains the rule. Every "Decision 2(b)" cite inside Decision 22 should therefore be read as Decision 3(b) at implementation time; the existing item texts are left untouched here.

(b) Mechanism: "the same mechanism as item 1" is not self-executing, because the text is not exposed where the original investigation looked for it.

Where the text exists today (confirmed): Engine 1 creates it — `supportRecordToResult`'s CONDITIONAL branch (`compatibility/cpu-motherboard.js` lines 55-60) resolves to UNKNOWN + `REASON_CODES.CPU_MOTHERBOARD_CONDITIONAL_UNVERIFIABLE`, and its evidence item is built by `buildEvidence(rule, record, extraFields)` (lines 12-25) with the extra fields `['cpu_product_id', 'min_bios_version']` / `['cpu_product_family_id', 'min_bios_version']` (lines 143-155), i.e. `evidence[0] = { rule: 'cpu_motherboard_support_exact' | 'cpu_motherboard_support_family', source_table: 'cpu_motherboard_support', source_id, source_status: 'CONDITIONAL', min_bios_version }`. The raw column is already loaded into the Engine 2D context: `CPU_MOTHERBOARD_SUPPORT_SQL` selects `support_status, min_bios_version` (`filtering/context-loader.js` line 261) and `groupCompatRows(..., ['cpu_product_id', 'min_bios_version'])` / `['cpu_product_family_id', 'min_bios_version']` inject it into the compat buckets (lines 585-594).

Where it is lost today (confirmed): inside Engine 2D the text survives only to the PAIR level — `evaluateCandidate` does `pairs.push(aggregateCompatibilityResults(checks))` (`filtering/filter.js` line 571) and `aggregateCompatibilityResults` flattens the evidence (`compatibility/aggregate.js` lines 37-42), so `pairs[i].evidence` still holds the `min_bios_version` item — but the relationship projection discards it one statement later: `evaluatedRelationships.push({ key, status, reason: firstReasonWithStatus(pairs, status) })` (lines 581-585) keeps only the reason CODE, and the frozen candidate verdict (lines 609-618) carries `{ product_id, product_variant_id, category, component_role, status, reason, relationships, unknown_pairwise_count }` with no evidence. Engine 3 then emits components with exactly `{ component_role, product_id, product_variant_id, category, status, price }` (`assembly/assemble.js` `finishPath`, lines 480-489), and ranking / selection carry that build object by reference (`ranking/rank.js` lines 410-418; `ranking/select-diverse.js` lines 121-129). `filtering/filter.test.js` lines 546-560 pin today's behavior exactly (UNKNOWN + reason code, nothing else). So the grounding claim "verdict reasons are confirmed absent from ranked / selected entries" is correct but incomplete: the text exists one projection earlier than the investigation looked. Item 4(d) was right that a carry is needed; only its mechanism was unspecified.

#### Decision (exact additive shape), in implementation order:

(a) `filtering/` — Engine 2D (`filtering/filter.js`, `evaluateCandidate`): derive per verdict an additive frozen `compatibility_notes` array from the pair results already computed at line 571, selecting exactly the pair-evidence items whose `source_status === 'CONDITIONAL'` (Engine 1's own `SOURCE_STATUSES.CONDITIONAL` vocabulary, not a reason-code special case, so a future CONDITIONAL row in `cooler_socket_support` / `case_motherboard_form_factor` flows without new code; today only `cpu_motherboard_support` can be CONDITIONAL in reachable data — docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md line 584: "CONDITIONAL semantics only exist in `cpu_motherboard_support`"). Verbatim note shape:

```text
compatibility_notes: [
  {
    relationship: 'cpu_motherboard',            // ROLE_RELATIONSHIPS[role] key, verbatim
    rule: 'cpu_motherboard_support_exact',      // evidence rule, verbatim
    source_table: 'cpu_motherboard_support',    // evidence field, verbatim
    source_id: '<uuid> | null',
    source_status: 'CONDITIONAL',               // SOURCE_STATUSES.CONDITIONAL, verbatim
    min_bios_version: '1.2.3' | null,           // verbatim text; never parsed, never formatted
    partner_role: 'MOTHERBOARD',                // RELATIONSHIP_PARTNER_ROLE[relationship][role] (line 565)
    partner_product_id: '<uuid>',
    partner_product_variant_id: '<uuid> | null'
  }
]
```

Ordering is deterministic: canonical relationship order (`ROLE_RELATIONSHIPS[role]`), then partner bucket order (the Engine 2C pool order already used), then the pair's evidence-array order; the array is frozen and is `[]` for a verdict with no CONDITIONAL pair. `status` / `reason` / `relationships` / `unknown_pairwise_count` keep their exact current values; this field is the ONLY Engine 2D result-shape change.

(b) `assembly/` — Engine 3 (`assembly/assemble.js`, `finishPath` lines 468-503): each emitted component gains the same field, narrowed to the partners actually picked — the verdict's notes whose `(partner_role, partner_product_id, partner_product_variant_id)` equal the picked component's identity in that role (the `picked` map is already in hand; only Engine 2D-computed notes are selected by identity, no resolver is re-called and no support-table row is re-derived). `[]` when nothing applies, so the key is present on every component and `status`-only consumers are unaffected; the array travels by reference, never mutated.

Chain completion (verified — no other module changes): `retention/retain.js` hands verdicts over intact by reference (header lines 27-31, output lines 294-297) → Engine 3 components → `rankBuilds` keeps `build` by reference (`ranking/rank.js` lines 410-418) → `selectDiverseTop` keeps `build` by reference (`ranking/select-diverse.js` lines 121-129), so Engine 6 reads `entry.build.components[i].compatibility_notes` as its `compatibilityNotes` argument (item 4(d)'s name is the Engine 6 PARAMETER; the record field stays snake_case like `unknown_pairwise_count` / `compatibility_status`). Explicitly NOT `scoring/`: `scoring/build-score.js` never enumerates component keys (it reads `component_role` / `product_id` plus role / type weights, lines 185-267) and `deriveStatus` reads only `status` / `unknown_pairwise_count` (`ranking/rank.js` lines 160-163), so the added field is inert for scoring and ranking. `persistence/validate-selected.js` needs no change for this field (`validateComponent`, lines 82-105, checks named fields only and tolerates extra keys) and `persistence/persist-ranked.js` persists no such column (lines 56-79) — the notes are explanation-only inputs, so no migration (item 6's no-schema-churn stance).

Test touch-points that MUST be UPDATED (item-5 discipline: update, not merely add): `filtering/filter.test.js` lines 840-843 — the exact sorted verdict-keys assertion gains `compatibility_notes`; `assembly/assemble.test.js` lines 870-885 — BOTH exact component-key assertions (the sorted one and the insertion-order one) gain `compatibility_notes`; plus new fixtures covering the CONDITIONAL carry end-to-end (Engine 2D verdict → component) and its per-partner narrowing. The current CONDITIONAL test (`filtering/filter.test.js` lines 546-560) stays valid and is extended with the note assertions.

Does this need its own investigation pass before Decision 22 is fully specified? No. The source (`compatibility/cpu-motherboard.js` lines 55-60, 143-155), the last point where the text is still live (`filtering/filter.js` line 571 + `compatibility/aggregate.js` lines 37-42), the exact drop point (`filtering/filter.js` lines 581-585 → 609-618) and the Engine 3 component literal (`assembly/assemble.js` lines 480-489) are all code-confirmed here, and both remaining design forks are settled in this item (verbatim single-string `min_bios_version`, per item 4(d); the ordering tie-breaks above). The implementation task must do item 7 first (budget reachability) and 8(a) before 8(b).

Rationale: the BIOS condition text must be reachable at the Engine 6 slot-in for item 4(d) to be implementable at all; the pair-level evidence Engine 2D already computes is the cheapest faithful source, and projecting it additively (verdict → component) neither re-derives support-table rows nor perturbs scoring, ranking, selection, validation or persistence.

Evidence: this document lines 243-260 (Decision 3(b) condition-carry rule); `compatibility/cpu-motherboard.js` lines 12-25, 55-60, 143-155; `compatibility/aggregate.js` lines 37-42; `filtering/context-loader.js` lines 261, 585-594; `filtering/filter.js` lines 565, 571, 581-585, 609-618; `assembly/assemble.js` lines 468-503; `ranking/rank.js` lines 160-163, 410-418; `ranking/select-diverse.js` lines 121-129; `scoring/build-score.js` lines 185-267; `filtering/filter.test.js` lines 546-560, 840-843; `assembly/assemble.test.js` lines 851-889; docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md line 584 (CONDITIONAL exists only in `cpu_motherboard_support`).

Rejected alternatives (for this item): re-deriving support-table rows or re-calling a resolver inside Engine 3 / Engine 6 (duplicates Engine 1's ownership; the pair aggregation is already in hand); carrying the notes on the ranked / selected ENTRY instead of the component (changes the shape the persistence validator governs, and leaves the pair scope ambiguous); a separate build-level `bios_notes` field (duplicates the component-level truth and needs its own aggregation rule); changing `filterCandidates`' existing fields or its evidence handling non-additively; persisting the notes to a new column (migration out of scope; item 6's rule); rendering human-readable prose in Engine 2D (item 4's template owns all prose).

### Rejected alternatives (global, restated not reopened)

* Persisting generation inputs via new columns / migration instead of in-memory pre-write generation (already rejected by Decision 19.7; migration 011 `explanation TEXT` suffices).
* Re-deriving scores / assessments / verdicts / budget inside Engine 6 (breaks pure-module discipline; duplicates Engine 4 / 2D ownership).
* Free-text / LLM / locale-dependent generation (violates §13 + §14 re-run rule).
* Silently dropping UNKNOWN or CONDITIONAL / BIOS conditions (violates Decision 2(b) and UNKNOWN-never-silent).
* Breaking `computeBuildScores` / `rankBuilds` / selection call-shapes instead of the additive sibling + explicit Engine 6 arguments + pre-commit slot-in adopted above.

### Verdict for this pass

```text
VERDICT: RESOLVED - Engine 6 is a new pure explanation/ module slotted between selectDiverseTop and runRecommendationCommit, fed by an additive Engine 4 contributions sibling plus explicitly threaded budget/condition inputs, emitting a fixed deterministic template (rank/score/status/price-vs-budget/dominant role-type + mandatory BIOS/UNKNOWN clauses), enforced by a required-non-empty explanation rule in validate-selected.js and bound (not nulled) by persist-ranked.js, implicitly versioned with the scoring model
```

---

## Decision 23 — Score degeneracy: build-local UNKNOWN pairwise count (O2) + GPU/PSU connector & dimension data (O1)

Status: RESOLVED 2026-09-27 (O1 seed 003 applied 2026-09-28; acceptance criterion 3 / PI-1 NOT built) — score degeneracy: build-local `unknown_pairwise_count` (O2) + GPU/PSU connector & dimension data (O1).

Date: 2026-09-27. Product decision pass resolving the score-degeneracy finding
recorded in `DEVELOPMENT_NOTES.md` (2026-09-25 entry, "score degeneracy
finding"): under the 100-product catalog, `measure-orchestrator.js` reports
`build_score min 0.00 | max 0.00 | mean 0.00 | distinct 1` for all configured
and raised-cap builds in both measured use cases — every score clamps to 0,
rankings become purely tie-break-driven, and persisted explanations read
"best weighted score 0". Root cause (as recorded): `unknown_compat_penalty`
(5.0/occurrence) is applied to a count that Decision 15 defined as
pool-wide (per candidate, across ALL pool partners, both evaluation
directions), so 20 GPU variants with NULL `required_power_connectors` and 9
PSUs with NULL connector matrices accumulate ~145+ UNKNOWN pairs per picked
component against a raw score of ~40. Documentation only at this stage: no
code, no migration, no seed applied by this entry.

### Decision

1. **O2 adopted — `unknown_pairwise_count` becomes build-local.** The count
   Decision 13's STEP 3 penalty consumes is redefined from "pool-wide
   per-verdict counts summed over the build" to **the number of pairwise
   compatibility checks whose aggregated status resolves UNKNOWN among the
   components actually co-occurring in the finished build** — each co-occurring
   pair counted once (not once per evaluation direction), zero-partner
   relationships contributing no pair (unchanged), FAIL pairs never counted
   (unchanged; in practice unreachable in a finished build, see point 3).

2. **Precise scope of supersession — what is superseded, what is preserved.**

   *Superseded (only these):*
   - Decision 15's **Decision** bullet describing the Engine 3 build count as
     "the integer sum of the picked verdicts' `unknown_pairwise_count`"
     (this file, Decision 15, first bullet pair) — that sum is replaced by the
     build-local recomputation (point 3).
   - Decision 15's **Counting semantics** bullets "Every relationship is
     evaluated from both participating roles, so a symmetric UNKNOWN product
     pair is counted once per direction. This compounds under Decision 13's
     per-occurrence penalty…" — the both-directions counting unit is withdrawn.
     The other two Counting-semantics bullets (empty partner bucket contributes
     0; REJECT verdicts carry the verdict-level count but never enter assembly)
     remain in force at their own level.
   - Decision 16's **"Explicitly NOT changed"** paragraph ("`unknown_pairwise_count`
     keeps its Decision 15 semantics — the per-verdict, per-pool counts summed
     per build. The DFS's re-evaluated pairs are used for the FAIL gate only
     and are never counted") — the DFS's re-evaluated pairs now *are* counted;
     the FAIL gate itself is untouched.
   - The remaining force of Decision 15's **Rejected alternatives** bullet
     rejecting "per-build pair recomputation among the chosen components" —
     its inline note already recorded Decision 16's partial supersession
     (validation-only); this decision completes the supersession by adopting
     the same recomputation for the count producer. The pair-identity-list
     rejection stands (Decision 13 consumes only a count).

   *Explicitly preserved (byte-identical or untouched):*
   - **Decision 13's STEP 1–3 formula text is not edited.** Its STEP 3 already
     reads "count of UNKNOWN pairwise compatibility checks **in the build**" —
     O2 makes the producer match that wording; the formula, clamp, penalty key
     and per-occurrence rationale are unchanged.
   - **The field name `unknown_pairwise_count` stays** on both frozen objects
     (Engine 2D verdict and Engine 3 build). Only the build-level computation
     changes. No rename, no new field, no new error codes.
   - **Decision 16's FAIL-gating mechanism is unchanged**: same
     `PAIRWISE_CHECKS`, same evaluators, same worst-of aggregation, same
     abandon-the-branch semantics, same `filtering_context` tenth input field,
     same silent pruning. This decision reuses that machinery for counting
     UNKNOWN outcomes; it does not duplicate or weaken the gate.
   - Engine 2D verdict-level semantics (pool-wide, per-direction counting on
     the verdict object) are unchanged at the verdict layer — see point 4.

3. **Adopted approach — where the recomputation happens.**
   `assembly/assemble.js`, `finishPath` (the closure that emits a build once
   `descend` reaches `depth >= EXPANSION_ORDER.length`): the current
   EXPANSION_ORDER sum `unknownPairwiseCount += verdict.unknown_pairwise_count`
   is replaced by a build-local recomputation over the `picked` map — for every
   picked role, walk its `PAIRWISE_CHECKS` entries whose partner role is also
   picked, run the same canonical left/right construction as
   `firstPairFailure`, aggregate with `aggregateCompatibilityResults`, and
   increment the count for each pair whose status is UNKNOWN.

   Properties, all inherited from Decision 16's boundary:
   - **Every co-occurring pair is covered exactly once.** `PAIRWISE_CHECKS`
     keys each relationship by the later-picked role; roles with no entry
     (CPU, GPU, SSD_BOOT) are covered via their partner's entry. Absent
     partner (GPU-omit, empty bucket) → no pair → 0, preserving Decision 15's
     zero-partners rule.
   - **No FAIL pair can exist in a finished build** — the Decision 16 gate
     pruned such branches during descent — so the count sees only PASS/UNKNOWN.
   - **No Engine 1 evaluation logic moves.** The evaluators and aggregation
     already live in `compatibility/`, are re-exported by
     `filtering/filter.js`, and are already imported into `assemble.js`
     (`:67–78`) for the FAIL gate; `finishPath` reaches
     `traversal.filteringContext` in the same scope it already reads
     `traversal.prices`. This is the exact boundary Decision 16 established —
     one module, one import set, pure (no DB, no clock, no randomness),
     deterministic under identical DB state + query + scoring-model version.
   - Cost: at most 8 relationship-pairs per emitted build, once per build —
     negligible against the existing gate (which runs per pick).

4. **Fate of `filtering/filter.js`'s pool-wide verdict-level
   `unknown_pairwise_count`: KEPT, but no longer consumed by scoring.**
   The verdict field stays on the frozen Engine 2D verdict exactly as
   Decision 15 defined it (pool-wide, per-direction). Rationale and audit of
   dependents:
   - The only production reader was the build-sum now being replaced
     (`assemble.js:521`); verified by codebase search — no other module reads
     `verdict.unknown_pairwise_count`. `retention/retain.js` passes verdicts
     by reference (header comment only); `rank.js` / `build-score.js` read the
     **build-level** field; `persistence/` and `explanation/` do not read it at
     all.
   - It is still required structurally: `VERDICT_FIELDS` validation
     (`assemble.js:102–111, 317–321`) requires the key's presence and
     non-negative-integer shape on every verdict. Removing the field would
     break that frozen contract, Decision 15's verdict bullet, and
     `filter.test.js:305–392` — for no consumer benefit.
   - It is NOT repurposed: Engine 2D's own status derivation uses
     `relationships`, never the count, so the field has no Engine 2D semantic
     need; inventing a new meaning for it is rejected (silent-contract-drift).
   - Explicit flag: `filter.test.js:313` ("counts the UNKNOWN pairs, per
     direction") continues to pin the pool-wide *verdict-level* behavior and
     must keep passing — it tests `filterCandidates` alone, which is unchanged.
     Its test name/comment should gain a note that this count is no longer
     what Engine 4 consumes, to prevent the next reader re-linking the two.
   - Header comments that state the old producer chain must be corrected in
     the same implementation pass: `assemble.js:25–29, 40–42`,
     `build-score.js:37–44` (the B1 note claiming per-build recomputation was
     "rejected (Decision 15)"), `rank.js:27`, `run.js:54–57`, plus the
     `DEVELOPMENT_NOTES.md` 2026-09-19 Decision-15 bullet and `CONTEXT.md`
     status pointers (AGENTS.md: update status in the same session).

5. **O1 — GPU/PSU connector & dimension data population (separate, sequenced
   item; seed `003`, never touching `001`/`002`).** After O2's code change
   lands, a new idempotent DML-only seed file
   `database/seeds/003_gpu_psu_connector_data.sql` supplies:
   - `gpu_board_spec.required_power_connectors`, `width_slots`, `height_mm`
     for the 20 GPU variants added by `002_catalog_expansion.sql` (recorded
     NULL there under its header decision **D6**);
   - `psu_spec.connector_eps_count`, `connector_pcie_8pin`,
     `connector_12vhpwr`, `connector_sata` for the 9 PSUs added by `002`
     (`connector_24pin_atx` is already `true` for all 9; the four NULL columns
     are the "connector MATRICES never captured" comment at
     `002_catalog_expansion.sql:624–627`).

   Scope and source-authority rules (same treatment as the 002 header
   decisions, recorded as numbered decisions in 003's header so they stay
   auditable):
   - **Source**: the original research artifacts already gathered (the
     catalog report + companion file named in 002's header).
   - **D6 applies directly**: D6 recorded these GPU fields as "never
     captured". The O1 premise is that the research (or a documented
     re-capture) now supplies them. Where a value is genuinely absent, it
     **stays NULL** — never guessed, never backfilled with a plausible value
     (002 header rule: "NULL means UNKNOWN"). Each such absence is documented
     in 003's header, as-is, exactly like D1 documented its unverified prices.
   - **D7 applies to conflicts**: where catalog and research disagree,
     catalog wins with the conflict flagged inline, mirroring D7's
     ZOTAC/Nautilus/240R treatment.
   - **D6's vocabulary mapping applies verbatim**: engine vocabulary is the
     fixed set `{24pin_atx, eps, pcie_8pin, 12vhpwr, sata}`
     (`compatibility/gpu.js` header); research `8-pin` → `pcie_8pin`,
     `12V-2x6` → `12vhpwr`. Any research connector outside that vocabulary
     is documented, not mapped by guess.
   - Sequencing: O2 code first (the correctness property must hold
     independent of data), then 003, then acceptance verification (point 6).
     `001`/`002` are never edited; 003 is a standalone `npm run seed` file.

6. **Acceptance verification (threshold fixed in advance; measured only on a
   `TEST_DATABASE_URL` branch, never the shared `DATABASE_URL`).** After O2 +
   O1, re-running the GAMING (15,000 MAD) / OFFICE (10,000 MAD) measurement
   (`scripts/measure-orchestrator.js`) must show all three:
   1. **Positive rank-1 net score, both use cases.** Rank 1's
      raw-minus-penalty score (`build_score_raw − unknown_compat_penalty ×
      count`) is > 0 for GAMING and for OFFICE. Measurable directly as
      rank-1 `build_score > 0` (strictly equivalent after the 0..100 clamp,
      and slightly stricter after 2-dp rounding); printing raw and penalty
      alongside is recommended so the margin is visible, not just the sign.
   2. **Score spread restored.** More than 1 distinct `build_score` value in
      the ranked set (currently exactly 1 — all zeros).
   3. **Pool independence — PI-1 (named, repeatable procedure).** Adding an
      unrelated new product carrying a NULL data field to the catalog must not
      change any existing build's score. Procedure, re-runnable after ANY
      future catalog addition:
      a. On a `TEST_DATABASE_URL` branch, run the GAMING and OFFICE queries
         and capture the score vector keyed by build signature.
      b. Insert one unrelated product outside every finished build's
         component set (e.g. a deliberately over-budget PSU with NULL
         connector columns) so it enters the candidate pool but no build.
      c. Re-run the identical queries; assert every pre-existing signature's
         `build_score` is unchanged. (New builds may appear; existing builds'
         scores may not move — with build-local counting, a pool-only change
         cannot reach the penalty.)
      d. Delete the added product, verify cleanup; branch only.
      Implementation note to resolve when PI-1 is built: the measurement
      scripts' preflight asserts exact catalog counts (100 products / 101
      offers) and will abort while the added product exists — PI-1 needs a
      dedicated script or parameterized expectations, not a hand-edit of the
      shared preflight.

   Conditions 1–2 are one measurement pass; condition 3 is a standing
   regression, not a one-off check.

### Rationale

* The penalty's correctness property is build-local by definition: Decision
  13's own STEP 3 says "in the build". O2 fixes the producer to match the
  formula the codebase already ships; O1 removes the largest *legitimate*
  UNKNOWN source at the data layer. Together they restore score spread
  without touching the formula, the penalty key, or the clamp.
* Reuse over duplication: the recomputation runs on Decision 16's existing
  `PAIRWISE_CHECKS` / evaluator / aggregation handoff — the exact boundary the
  decision log already blessed — so no new import, no second compatibility
  implementation, no purity regression.
* Keeping the verdict-level field avoids breaking three frozen contracts
  (verdict shape, `VERDICT_FIELDS` validation, Decision 15's verdict bullet)
  while removing its only consumer from the scoring path; the field's meaning
  at its own layer stays true.
* Data-first honesty: NULL stays UNKNOWN; O1 documents absences and conflicts
  as-is (D1/D6/D7 treatment) instead of guessing, preserving the seed files'
  auditable "deliberate decisions" pattern.

### Rejected alternatives

* **O3** (enumerated in the 2026-09-27 degeneracy recon) — rejected per the
  confirmed direction; recorded here as rejected, not re-argued.
* **Keeping pool-wide scope** (fix data only, retain Decision 15's
  pool-wide/both-directions counting) — rejected: pool-independence would
  remain violated by any future NULL field, so the correctness property in
  point 6(3) could never hold; a catalog addition would again be able to
  zero an unrelated build's score.
* **Removing the verdict-level field outright** — rejected: breaks
  `VERDICT_FIELDS` validation, Decision 15's frozen verdict contract, and
  passing `filter.test.js` pins, with no consumer requiring removal.
* **Repurposing the verdict-level field for a new meaning** — rejected:
  silent contract drift; nothing in Engine 2D needs it.
* **Gating instead of counting in `finishPath`** (extending
  `firstPairFailure`'s early-return loop to count) — rejected as written:
  its first-FAIL return makes it structurally unable to observe all pairs; a
  dedicated non-short-circuiting counting pass over the same table is the
  correct shape (reported as a feasibility caveat before this decision was
  drafted).

### Impact

* Code (future implementation pass, not this entry): `assembly/assemble.js`
  (`finishPath` count + header lines 25–29/40–42), comment corrections in
  `build-score.js` / `rank.js` / `run.js`, a scoping note on
  `filter.test.js:313`, and unit-test expectation changes wherever
  `build.unknown_pairwise_count` was pinned as "sum of verdict counts".
  `filtering/filter.js` itself is unchanged. No migration, no enum change,
  no schema change.
* Behavior: build counts drop to build-local magnitudes; `build_score`
  spreads (target: conditions 6(1)–(2)); Decision 16 FAIL gating, Decision 18
  ranking/G1, Decision 20 diversity and Decision 19/20 persistence are
  untouched. **What O2 does NOT change:** verdict/component statuses keep
  their pool-wide best-of-partner semantics (Decision 1 untouched), so G1 may
  still report UNKNOWN for builds whose *components* carry UNKNOWN verdicts
  until O1's data makes those relationships PASS — accepted and expected;
  scoring is affected only by the count, not by component status.
* Data: seed `003` (new file) changes GPU↔PSU connector and GPU↔case
  thickness checks from UNKNOWN to live PASS/FAIL for the 002 additions;
  `height_mm` is forward-looking only (no engine consumer today, same as D5's
  cooler dims).
* Doc sync in the implementation session: `DEVELOPMENT_NOTES.md` 2026-09-25
  entry (finding) gains its resolution note; `CONTEXT.md` status sections;
  Decision 15/16 supersession pointers read against this entry.
* Verification: `npm run test:unit`; acceptance via points 6(1)–(3) on
  `TEST_DATABASE_URL` only.

### Verdict for this pass

```text
VERDICT: RESOLVED - score-degeneracy resolution: O2 build-local unknown_pairwise_count (recomputed in assemble.js finishPath by reusing Decision 16's PAIRWISE_CHECKS/evaluators; Decision 13 formula, field name, and FAIL gate byte-identical; Decision 15 pool-wide/both-directions counting rationale and Decision 16's "Explicitly NOT changed" paragraph superseded; verdict-level field kept but dropped from the scoring chain) ADOPTED TOGETHER WITH O1 (seed 003: GPU required_power_connectors/width_slots/height_mm for 20 GPUs + PSU connector matrices for 9 PSUs, D1/D6/D7 source-authority rules applied as-is) - acceptance gated on GAMING/OFFICE re-measurement: rank-1 raw-minus-penalty > 0, >1 distinct build_score, and PI-1 pool-independence (repeatable)
```

---

## Decision 24 — Decision 20 O4 re-evaluation on the 100-product catalog

Status: RESOLVED 2026-09-28 — Decision 20's O4 re-evaluated on the 100-product catalog; O4 and `MAX_PER_PAIR = 3` retained unchanged.

Date: 2026-09-28. Measurement pass re-checking Decision 20's post-ranking
(CPU, GPU) pair-diversity selection (O4, `MAX_PER_PAIR = 3`,
`ranking/select-diverse.js`) against the current catalog (001 + 002 + 003,
100 products). Decision 20 could not do this: its figures were taken on the
15-product minimal seed (see its SEED-SIZE NOTE). Documentation only: no
code change, no seed change.

### Decision

1. **Finding. O4 delivers diversity only where the ranked list holds more
   than `ceil(limit / maxPerPair)` distinct (CPU, GPU) pairs; at the SHIPPED
   configured cap it delivers none and under-fills.** Measured read-only on a
   `TEST_DATABASE_URL` branch through the real pipeline
   (`loadCandidates -> selectCandidatePool -> selectOfferPrices ->
   filterCandidates -> computeCandidateScores -> retainTopKPerRole ->
   assembleBuildsForRecommendation -> computeBuildScores -> rankBuilds ->
   selectDiverseTop`), `limit = TOP_N_PERSISTED (10)`, `maxPerPair = 3`:

   | use case | cap variant | ranked | naive top-10 (no O4) | O4 selected |
   |---|---|---|---|---|
   | GAMING | configured (25) | 25 | 1 distinct pair, largest 10 of 10 | **k = 3**, 1 pair, largest 3 of 3, dropped 22 |
   | OFFICE | configured (25) | 25 | 1 distinct pair, largest 10 of 10 | **k = 3**, 1 pair, largest 3 of 3, dropped 22 |
   | GAMING | raised (100000) | 35982 | 3 distinct pairs, largest 7 of 10 | k = 10, 4 pairs, largest 3 of 10, dropped 113 |
   | OFFICE | raised (100000) | 793 | 1 distinct pair, largest 10 of 10 | **k = 9**, 3 pairs, largest 3 of 9, dropped 784 |

2. **At the shipped configured cap O4 cannot produce diversity at all.** With
   `max_builds_per_query = 25` CPU and GPU are fixed across every build in the
   pool — only the trailing roles vary (GAMING: CPU_COOLER, SSD_BOOT; OFFICE:
   PSU, CASE, CPU_COOLER, SSD_BOOT) — so the whole 25-build ranked list is ONE
   (CPU, GPU) pair. O4 takes the first 3 builds, skips the other 22, and the
   selected set still holds a single pair. No `MAX_PER_PAIR` value can extract
   diversity from a one-pair list; any value `> 1` only reduces the persisted
   count (10 -> 3). Decision 20's rationale assumed the ranked list offered
   several pairs to choose between.

3. **OFFICE under-fills even at the raised cap.** Its 793-build ranked list
   holds only 3 distinct pairs (3 CPUs x {the single GPU variant, GPU
   omitted}), so `MAX_PER_PAIR = 3` caps the persisted set at `3 x 3 = 9 < 10`.
   Decision 20 allowed "k may be less than 10 if fewer than 10 builds survive";
   here the shortfall is caused by the pair cap, not by builds dying. The
   OFFICE top-10 is also `10 of 10` on one pair — the diversity objective is
   not met on the current catalog, in either cap variant.

4. **Decision taken.** Keep O4 and `MAX_PER_PAIR = 3` exactly as adopted in
   Decision 20 — the constant is not the defect and the mechanism is correct.
   Record explicitly that O4 is a POST-ranking filter: it can only re-select
   from pairs the ranking already produced, so it cannot manufacture diversity
   the ranked list lacks. Its objective is therefore unmet at the shipped
   configured cap, where the top of the ranking is a single (CPU, GPU) pair.

5. **Recommended follow-up (not done here).** The upstream cause is that at
   `max_builds_per_query = 25` the assembled/ranked pool is dominated by one
   (CPU, GPU) pair; retuning `MAX_PER_PAIR` in isolation cannot fix that.
   Re-evaluate O4 after the Decision 23 O1/O2 score-degeneracy work is
   measured end-to-end on the same catalog, or alongside any change to the
   configured cap. If a full `TOP_N_PERSISTED`-row persisted set is a hard
   requirement, the candidate mechanism is a documented fill-back pass (after
   the diversity walk, backfill skipped builds toward `limit`), which trades
   pair concentration for fill — a Decision 19/20 question, not a change made
   by this entry.

### Rejected alternatives

* **Raising `MAX_PER_PAIR` to fill 10 rows** (e.g. 10 at the configured cap):
  restores the fill only by disabling the very cap Decision 20 exists to
  impose — it makes O4 a no-op rather than fixing its input.
* **Lowering `MAX_PER_PAIR`** (e.g. 1): still yields k <= 1 at the configured
  cap (one pair) and worsens the under-fill; it does not add pairs.
* **Making `MAX_PER_PAIR` catalog- or use-case-aware now:** premature — the
  dominant term is the one-pair ranked list, which no per-pair constant
  changes, and Decision 20 already flags revisiting the constant once
  real-market catalog data exists.
* **Re-opening Decision 20's verdict:** unnecessary — the mechanism behaves as
  specified; what changed is the catalog the assumption was made against.

### Verdict for this pass

```text
VERDICT: RESOLVED - O4 / MAX_PER_PAIR = 3 retained unchanged; measured on the 100-product catalog O4 delivers diversity only at the raised cap (GAMING k=10 / 4 pairs) and is a no-op-plus-under-fill at the shipped configured cap (k=3, one pair) and OFFICE raised cap (k=9, three pairs); the gap is upstream (a one-pair ranked top-10), not the constant
```

---

## Decision 25 — Assembly cap starvation of the O4 diversity objective

Status: RESOLVED 2026-09-28 — assembly cap starvation of the O4 diversity objective (`max_builds_per_query = 25` is the immediate structural blocker).

Date: 2026-09-28. Measurement pass tracing WHY the ranked set at the shipped
`max_builds_per_query = 25` holds a single (CPU, GPU) pair (Decision 24,
item 2). Documentation only: no code change, no seed change.

### Decision

1. **Finding. The cap truncates a depth-first walk whose LAST roles vary
   first, so the two roles O4 keys on never move.** `assembleBuilds` walks
   `EXPANSION_ORDER = [CPU, MOTHERBOARD, RAM, GPU, PSU, CASE, CPU_COOLER,
   SSD_BOOT]` depth-first and halts the WHOLE walk the moment
   `builds.length >= candidate_caps.max_builds_per_query` (assemble.js
   `descend`/`finishPath`, `halted`). Depth-first makes SSD_BOOT the
   least-significant digit, so a role's first change lands after the product
   of every later role's option count - with 5 options per trailing role,
   `5^k`: SSD_BOOT 1, CPU_COOLER 5, CASE 25, PSU 125, GPU 625, RAM 3125,
   MOTHERBOARD 15625, CPU 78125. The cap of 25 stops the counter before the
   GPU change, and GPU and CPU are the TWO MOST-significant roles, so the
   pool's (CPU, GPU) pair is fixed by construction.

2. **Measured cap sweep** (read-only, `TEST_DATABASE_URL`, real pipeline;
   `O4 k` = `selectDiverseTop({ ranked, limit: 10, maxPerPair: 3 })`.
   `selected.length`):

   GAMING (budget 15000):

   | cap | builds | distinct CPU | distinct GPU | distinct pairs | O4 k |
   |---|---|---|---|---|---|
   | 25 | 25 | 1 | 1 | **1** | **3** |
   | 50-400 | 50-400 | 1 | 1 | **1** | **3** |
   | 800 | 800 | 1 | 2 | 2 | 6 |
   | 1600 | 1600 | 1 | 4 | 4 | **10** |
   | 3200 | 3200 | 1 | 4 | 4 | 10 |

   OFFICE (budget 10000):

   | cap | builds | distinct CPU | distinct GPU | distinct pairs | O4 k |
   |---|---|---|---|---|---|
   | 25-50 | 25-50 | 1 | 0 (GPU omitted) | **1** | **3** |
   | 100-400 | 100-400 | 2 | 1 | 2 | 6 |
   | 800+ | 793 (exhaustive) | 3 | 1 | 3 | **9** |

   Budget pruning moves the real thresholds below the naive `5^k` positions -
   GAMING's first GPU change is measured at build 525 (predicted 625) - but
   nowhere near 25.

3. **Decision taken. Yes, the shipped cap starves the objective, and no
   MAX_PER_PAIR value compensates.** At cap 25 the pool holds exactly one
   (CPU, GPU) pair for both use cases, so O4's per-pair cap has nothing to
   distribute: NO value of MAX_PER_PAIR can yield more than one distinct pair,
   and any value `> 1` only reduces the persisted count (10 -> 3). Diversity
   is unachievable at the shipped cap BY CONSTRUCTION, not by constant choice.
   This is the upstream cause Decision 24 item 2 recorded; the constant stays
   as adopted (Decisions 20 and 24 are not re-opened).

4. **Raising the cap is necessary but NOT sufficient, and the deeper ceiling
   is the retention-starved pool.** GAMING needs >= ~1600 builds before 4
   distinct pairs exist and O4 can fill 10 (`ceil(10 / 3)` pairs). OFFICE
   never reaches 10 at ANY cap: its exhaustive 793-build ranked list holds
   only 3 distinct pairs, so `MAX_PER_PAIR = 3` ceilings the persisted set at
   `3 x 3 = 9`. The pair space is bounded by (distinct CPUs x distinct GPU
   values), and both are starved upstream by Decision 23's D2
   (`top_k_per_role = 5` plus flat-40 scores cut 17 of 20 new GPUs at
   retention; 18 never reach a build). The three findings compose: assessments
   (a future seed 004) -> more GPUs survive retention -> more pairs; the cap
   must ALSO rise above the first GPU change (~600-1600) before either use
   case can fill 10.

5. **Recommended follow-up (not done here).** Treat these as one item, not
   three: (a) supply the seed-002 assessments; (b) choose a
   `max_builds_per_query` above the first GPU change (measured: GAMING >=
   ~1600 for k = 10; OFFICE's bound is pair-space, not cap); (c) decide
   whether the persisted set must always hold `TOP_N_PERSISTED` rows (the
   fill-back question raised in Decision 24 item 5) or whether `k < 10` is
   acceptable. Re-measure with the same sweep after (a).

### Rejected alternatives

* **Keeping cap 25 and tuning `MAX_PER_PAIR`:** the cap is the blocker, the
  constant is not (already recorded in Decision 24).
* **Reordering `EXPANSION_ORDER` to put CPU/GPU last:** would vary them inside
  a small cap, but it reorders the authoritative traversal (assemble.js) and
  changes every build's discovery order and every index-aligned downstream
  output - a far larger decision than this finding warrants.
* **Shipping the exhaustive cap (100000):** ~1439x the assembly work of cap 25
  for GAMING (35982 builds) and still only 3 pairs for OFFICE; it is a
  measurement setting, not a shippable default.
* **Treating this as a Decision 20 / 24 defect:** no - both entries' mechanisms
  behave exactly as specified; this entry supplies the missing input-side
  cause.

### Verdict for this pass

```text
VERDICT: RESOLVED - the shipped max_builds_per_query = 25 truncates the depth-first EXPANSION_ORDER walk before its two most-significant roles (CPU, GPU) can vary, so the pool always holds one (CPU, GPU) pair, O4 is structurally starved at every MAX_PER_PAIR value (persisted set 10 -> 3), and diversity is unachievable at the shipped cap by construction; raising the cap is necessary (GAMING ~1600 for 4 pairs / k=10) but insufficient (OFFICE is pair-space-bounded at k=9 by the retention-starved catalog)
```

---

## Decision 26 — S5.2 HIGH-TGP connector escalation implemented; the four S5.3/S6 HARD rules explicitly deferred

Status: RESOLVED 2026-09-28 — hybrid (audit D2): item A IMPLEMENTED (`GPU_PSU_CONNECTOR_NULL_HIGH_TGP`); item B (four S5.3/S6 HARD rules) EXPLICITLY DEFERRED and unenforced.

Date: 2026-09-28. Closes audit finding D2 in the hybrid form its own Fix line
allowed ("implement ..., or record a decision that explicitly defers them"):
item A ships code, item B records a deferral. Documentation plus one rule change;
no migration, no seed, no schema change.

### Decision

**A. Architecture section 5.2's HIGH-TGP connector escalation is ADOPTED as the
shipped contract and implemented 2026-09-28.**

1. **Shipped semantics (exact).** `compatibility/gpu.js` Rule 11
   (`resolveGpuPsuConnectors`) returns FAIL with the new reason code
   `GPU_PSU_CONNECTOR_NULL_HIGH_TGP` when ALL of these hold:
   * the GPU's `required_power_connectors` normalized successfully;
   * a required connector whose NAME is in the known vocabulary
     (`24pin_atx`, `eps`, `pcie_8pin`, `12vhpwr`, `sata`) has NULL / absent PSU
     availability (normalized `psu_spec` connector counts);
   * `gpu_board_spec.board_tgp_watts >= 200`, boundary INCLUSIVE (exactly 200 W
     escalates, 199 W does not) and required to be a finite number.
   The threshold is the code constant `HIGH_TGP_WATTS = 200` in `gpu.js`.

2. **Precedence, stated because it is observable.** The escalation is decided
   BEFORE the unknown-connector-NAME branch, so a pair holding both a
   NULL-availability known connector and an unverifiable name returns FAIL.
   Rationale: `aggregateCompatibilityResults` is worst-of (FAIL > UNKNOWN) and
   Engine 3's Decision 16 gate abandons a branch only on FAIL — an UNKNOWN would
   let the unsafe (GPU, PSU) combination reach a build. Only NULL / absent
   availability escalates; an availability value that is neither NULL nor a
   finite number (unreachable through the shipped B2-C loader, which normalizes
   `psu_spec` to number-or-NULL) keeps today's UNKNOWN.

3. **Explicitly UNCHANGED by this entry** (each pinned by a Rule 11 unit test):
   GPU `required_power_connectors` NULL -> UNKNOWN; unknown connector NAME ->
   UNKNOWN; `board_tgp_watts` NULL / absent / non-finite -> UNKNOWN (NULL TGP is
   never read as FAIL and never as "low TGP"); a verifiable deficit, including an
   INTEGER 0 count -> FAIL `GPU_PSU_CONNECTOR_UNAVAILABLE`; empty requirements ->
   PASS.

4. **Data path.** `board_tgp_watts` is loaded by `filtering/context-loader.js`
   (`GPU_VARIANT_SPEC_SQL` + `normalizeGpuSpec`, NULL preserved) and handed to the
   rule by `filtering/filter.js` `evaluateGpuPsuPair`. Engine 3 inherits the
   behaviour with NO assembly change: `assembly/assemble.js` declares the
   `gpu_psu` pair with the same `evaluateGpuPsuPair` evaluator, so the FAIL
   prunes the branch in the Decision 16 gate and the pair stops counting as
   UNKNOWN in the Decision 23 O2 build-local count.

5. **Attribution correction.** The audit's D2 table cell and the
   `ARCHITECTURE.md` supersession notice previously credited "Decision 23:
   returns UNKNOWN by design". Decision 23 never addressed the >= 200 W
   escalation: Rule 11's unconditional UNKNOWN for ANY null connector
   availability was `gpu.js`'s own design, and no decision had ruled on section
   5.2's REJECT policy before this entry. The attribution was corrected the same
   day (commits `676973b`/`6c69baa`); this entry supplies the missing policy.

6. **Measured impact on the live catalog (read-only `DATABASE_URL` queries,
   2026-09-28).** 13 of 22 `gpu_board_spec` rows have `board_tgp_watts >= 200`
   (max 575 W) and all 13 require exactly `{"12vhpwr": 1}`; 3 of 11 `psu_spec`
   rows have `connector_12vhpwr IS NULL` (`Seed Antec G850`, `Seed Connect PSU
   850`, `Seed HYBROK PSU 650`). Exactly **39 (GPU, PSU) pairs** therefore flip
   UNKNOWN -> FAIL. Engine 2D aggregates a relationship best-of across partners,
   so such a GPU stays eligible while any other PSU partner PASSes; the concrete
   effects are that the unsafe pair can no longer be assembled (Decision 16 gate)
   and no longer contributes an UNKNOWN penalty. Because branch abandonment
   changes which builds reach `max_builds_per_query`, the Decisions 23/24/25
   measurement figures predate this change and may shift — re-measurement on an
   isolated `TEST_DATABASE_URL` branch is a follow-up, not part of this entry.

**B. The four HARD rules of architecture sections 5.3 and 6 are EXPLICITLY
DEFERRED and recorded as UNENFORCED.**

7. **The four rules.** (i) `cooler_spec.max_tdp_watts < cpu_spec.tdp_watts` ->
   REJECT; (ii) air-cooler `cooler_spec.height_mm >
   case_spec.max_cpu_cooler_height_mm` -> REJECT;
   (iii) `ram_spec.module_count > motherboard_spec.dimm_slots` -> REJECT;
   (iv) `ram_spec.module_count * ram_spec.capacity_per_module_gb >
   motherboard_spec.max_memory_capacity_gb` -> REJECT. None is implemented in
   `src/`: no non-test module reads `max_tdp_watts`, `height_mm`,
   `max_cpu_cooler_height_mm`, `module_count` or `max_memory_capacity_gb`. They
   remain desirable but are NOT part of the contract this engine enforces
   today. Section 5.3's NULL-fallback clause ("either NULL -> UNKNOWN
   (penalty)") is unimplemented for the same reason.

8. **Architecture document downgrade.** `ARCHITECTURE.md` carries inline markers
   in section 3 (list item 9 and the section 3 definitive list), 3.3, 5.2, 5.3,
   6, 11 step 7, 16, 17 and 18; section 16 gains four IMPORTANT (latent) rows;
   the supersession notice rows for section 5.2 and for the four rules record
   this decision. The section 3 "definitive hard list" (11 items) contains none
   of the four rules — an internal inconsistency found by the D2 verification —
   and stays incomplete BY DESIGN until item B is implemented.

9. **This deferral is a known contract violation, not a free choice.**
   * The Engine 1 readiness contract (this file, "Engine 1 readiness") requires
     "Derived checks: GPU<->case, GPU<->PSU (wattage + connector subset), cooler
     TDP/height — NULL on either side = UNKNOWN, never 'unlimited'". The cooler
     half of that sentence was never implemented.
   * `database/seeds/002_catalog_expansion.sql` D5 documents the cooler half as
     intentional forward-looking data ("seeded but NOT consumed by any engine
     code today ... forward-looking data, not enforcement").
   * The RAM half was silent drift: no decision, no seed note and no code
     comment recorded it as deferred until this entry.

10. **Live-data evidence (read-only, 2026-09-28).** Coverage among the 100
    seeded products: coolers 9 (TDP known 9, height known 5), CPUs 18 (TDP known
    18), cases 10 (height known 10), motherboards 7 (both columns known 7), RAM
    kits 7 (both columns known 7). Violations today: **0** for all four rules,
    measured both over every catalog combination and over the
    compatibility-reachable subsets (cooler<->CPU via non-FAIL
    `cooler_socket_support`; RAM<->motherboard with matching `memory_type_id`).
    The four rules are therefore LATENT, not currently harmful — which is why
    they can be deferred, and why the deferral is time-bounded.

11. **Revisit trigger (binding).** Any future seed that adds or edits a CPU,
    cooler, case, motherboard or RAM row MUST re-run the four violation queries
    before merge. Any implementation of the four rules must land with a new
    sequential decision (or an UPDATE block on this one) plus Engine 1 fixture
    tests. A cooler or RAM seed that introduces the first violation while these
    rules are unenforced would persist an unsafe build.

### Rejected alternatives

* **Implement all four rules in this pass:** each is a small pure function plus a
  `PAIRWISE_CHECKS` entry, but the two cooler rules need pair inputs Engine 2D
  does not carry (CPU TDP, case cooler height) and the RAM rules need new
  motherboard-slot / kit-capacity inputs — context-loader, filter, assembly and
  Engine 1 surface changes larger than this docs-and-Rule-11 pass can validate.
* **Leave sections 5.3 and 6 as written:** rejected by the audit's own Fix line —
  a document must not assert safety the engine does not provide.
* **Narrow reading of section 5.2 (escalate only when the whole PSU connector map
  is NULL):** rejected. Section 5.2 says "PSU count for it is NULL", i.e.
  per-connector, and the seed-003 rows leave exactly such per-column NULLs. The
  narrow reading would have flipped 0 of the 39 live pairs and left the policy
  unimplemented in practice.
* **UNKNOWN precedence (escalate only when every unverifiable connector is a NULL
  availability):** rejected — it preserves seed 003's historical sentence but
  lets a mixed unverifiable pair reach an assembly on a 200 W+ board, the exact
  outcome section 5.2 exists to prevent.
* **Treat a non-finite availability value as NULL for escalation:** rejected as
  an invention beyond section 5.2's wording, and unreachable through the shipped
  loader contract.
* **Defer item A too (document-only entry):** rejected — the change is four small
  edits in modules that already carry the pair, and leaving the policy
  unimplemented while the catalog holds 13 high-TGP boards is the latent risk the
  audit called CRITICAL.

### Verdict for this pass

```text
VERDICT: RESOLVED - hybrid (audit D2). ITEM A IMPLEMENTED as shipped contract: Rule 11 resolveGpuPsuConnectors escalates a required, KNOWN connector's NULL PSU availability to FAIL GPU_PSU_CONNECTOR_NULL_HIGH_TGP at gpu_board_spec.board_tgp_watts >= 200 (inclusive, finite), decided BEFORE the unknown-name branch so FAIL outranks UNKNOWN; a NULL GPU requirement / unknown connector NAME / NULL TGP stay UNKNOWN and a verifiable deficit (incl. 0) keeps GPU_PSU_CONNECTOR_UNAVAILABLE; board_tgp_watts is loaded by context-loader and handed over by filter.js, and Engine 3 inherits the FAIL with no assembly change; 39 live (GPU, PSU) pairs flip UNKNOWN -> FAIL; the Decision 23 attribution is corrected on the record. ITEM B DEFERRED: cooler max_tdp_watts vs CPU TDP, cooler height_mm vs case max_cpu_cooler_height_mm, RAM module_count vs dimm_slots and RAM capacity vs max_memory_capacity_gb are UNENFORCED, marked inline in ARCHITECTURE.md sections 3/3.3/5.2/5.3/6/11/16/17/18, recorded as a known Engine 1 readiness contract violation with 0 live violations as of 2026-09-28 and a binding seed-time re-check trigger. Unit tests 817 -> 829, 0 failures.
```

## Decision 27 — Budget-blind retention replaced by a cheapest-per-role reservation, plus a budget_floor diagnostic

Status: RESOLVED 2026-10-02; IMPLEMENTED 2026-10-02 — budget-aware retention, cheapest-per-role reservation of 1 of K slots plus a budget_floor diagnostic on the pass result; closes OG-26 (see docs/OPEN_GAPS.md C-17), unit tests 829 -> 859 with 0 failures.

Date: 2026-10-02. Closes the engine-code half of `docs/OPEN_GAPS.md` row OG-26, the
one gap the register itself names as "the next BLOCKING-shaped work" after OG-01 closed.
It amends Decision 12 (retention ownership) and Decision 14 Rule 4 (top_k_per_role
retention semantics) rather than replacing them: eligibility (Rule 2), ordering (Rule 3),
the `compareCandidates()` tie-break (Rule 5) and the hard cap (Rule 4) all stay; only the
SELECTION inside the cap changes. Engine 3 is untouched. Documentation plus one pure
module and one changed pure function; no migration, no seed, no schema change, no new
loader, no new error code.

### Current situation

`retainTopKPerRole` (`src/recommendation/retention/retain.js`) buckets Engine 2D verdicts
by `component_role`, drops `REJECT` (Decision 14 Rule 2), sorts each bucket by
`candidate_score` DESC with `compareCandidates()` as the tie-break (Rules 3/5), and keeps
`bucket.slice(0, topKPerRole)`. It receives exactly three inputs — `filterResult`,
`candidateScores`, `topKPerRole` — and **no price information at all**. The price carrier
produced by Stage 1 (`offers.selectOfferPrices`, `src/recommendation/orchestrator/run.js`)
is first read inside Engine 3, where `assemble.js:616` and `assemble.js:640` prune a path
whose running total exceeds `budget_amount`.

So the retained set is whatever scores highest, and the build is whatever survives budget
pruning. The two are unrelated, and the gap between them is invisible. Measured twice on
2026-10-02 after seed `004b`, in opposite directions:

* `004b_cpu_motherboard.sql` moved the retained CPU set from including an 899 MAD part to
  2699 MAD and up, so GAMING at 15000 MAD went from 25 builds to **0** (20000 -> 25).
* `004b_case_cooler.sql` scored the 8 cases on QUALITY (a 0.5 role weight), evicting the
  two cheapest cases (Fractal Pop XL and the MAG FORGE 320R AIRFLOW, both 849 MAD) from
  the retained top-5, so the cheapest serviceable OFFICE build moved to 10445 MAD and
  OFFICE at 10000 MAD assembled **0**.

The catalog itself is not the constraint: the cheapest-per-role combination totals
7677 MAD. A build-free budget is a legitimate outcome (Decision 17.2 — "zero builds is a
valid outcome"), but a SILENT one is a product defect, and the two harness measurement
budgets in `scripts/measure-orchestrator.js` had to be raised (GAMING 15000 -> 20000,
OFFICE 10000 -> 12000) purely to keep the measurement harnesses green.

### Problem

Two independent defects, both invisible from the result surface.

1. **Selection ignores price entirely.** Any scoring change can move the cheapest
   serviceable build in either direction, with no relationship between a candidate's score
   and its reachability. The register's own rule — "expect a seed that changes scores to
   move the cheapest serviceable budget" — is a description of a design that gives the
   engine no say.
2. **A zero-build result carries no reason.** `builds: []` is returned for at least three
   materially different causes: nothing retained fits the budget; pairwise incompatibility
   (the OG-05 -> OG-28 class); a required role with no surviving candidate. The caller
   cannot distinguish them, and `full-run.js` deliberately has no short-circuit, so an
   empty recommendation flows all the way through ranking, diversity selection, Engine 6
   explanation and the write pass with nothing to say. `OG-04` (no rejection-reason
   persistence) is the structural version of this and stays open; this entry closes only
   the part a single pass can answer for itself.

### Decision

**1. Rule 4 selection is replaced by a cheapest-per-role reservation.** Per role bucket,
ordered by the unchanged Rule 3/5 comparator, `retainTopKPerRole` retains the first `K-1`
entries **plus the single cheapest eligible candidate by `selected_price`**, where ties on
`selected_price` are broken by position in that same Rule 3/5 order. The selected set is
then re-emitted in Rule 3/5 order, so the output ORDERING contract is unchanged — only
membership changes. `retained_count` is still `min(K, eligible_count)`. Lives in
`retention/retain.js`; pinned by `retention/retain.test.js`.

Consequences that are intended, not incidental:

* A bucket of `n <= K` eligible candidates is unaffected (nothing is being cut).
* `top_k_per_role = 1` is a total handoff to price: `slice(0, 0)` is empty and the
  reservation alone fills the slot. Score contributes nothing at K=1. This is correct —
  at K=1 there is no score competition to arbitrate — and it is pinned rather than left
  to be discovered.
* The reservation is a FLOOR guarantee, not a completeness guarantee. It makes the
  cheapest-per-role combination reachable; it cannot guarantee that combination survives
  assembly's pairwise FAIL gate. `within_budget: true` alongside `builds: []` is therefore
  a legitimate, expected state and must stay representable.
* The equal-price tie-break is not hypothetical: `004b_ssd_ram.sql` ships two RAM kits at
  the identical 1349 MAD, and the register records them as mutually contradictory.

**2. `prices` becomes a REQUIRED input to `retainTopKPerRole`** — the Stage 1 carrier from
`offers.selectOfferPrices`, the same frozen null-prototype object already handed to Engine 3
at the assembly call. It is already in memory at the retention call site, so this adds no
query and no loader. An eligible verdict with no carrier entry fails fast with
`MISSING_REQUIRED_FIELD` on field `prices`, matching the existing missing-score gate, and a
present-but-non-finite `selected_price` fails the same way. **A missing price is never read
as `0` and never read as free** — a `0` would let an unpriced part win the reservation and
then fail every budget check downstream, converting a data gap into a silent quality loss.
`validatePrices` is deliberately NOT re-run: the carrier is already validated by Stage 1,
and re-validating would duplicate Engine 3's contract inside retention.

**3. The boundary is amended, not widened.** `retention/retain.js` may import exactly one
Engine 3 symbol: `priceKey` from `../assembly/prices` — a pure key constructor with no
logic, imported so the carrier key format keeps exactly one owner (`offers/select.js`
already imports it for the same reason). It may NOT import `../assembly/assemble`,
`../assembly/pipeline`, `../assembly/gpu-policy`, `../assembly/input`, or the assembly
barrel, nor anything from `../orchestrator` or `../persistence`. `retention/index.test.js`'s
banned-token list changes from the single token `'../assembly'` to those five specific
specifiers, so the ban is still total and is merely aimed at the one permitted edge.
Retention stays pure: no DB, no clock, no randomness, no I/O.

**4. `budget_floor` is a new field on the pass result.** `runRecommendation` returns a
seventh field `budget_floor`, appended after `build_contributions`;
`runRecommendationFullRun` returns an eleventh, appended last. It is produced by the new
pure `retention/budget-floor.js` `computeBudgetFloor({ retained, prices, budgetAmount,
currency })` and is ALWAYS present, on every query, whether or not builds exist — a
diagnostic that appears only on failure is a diagnostic nobody reads. Fields:
`cheapest_total`, `currency`, `budget_amount`, `within_budget`, `cheapest_by_role`,
`missing_roles`.

Two semantics are load-bearing and pinned by `retention/budget-floor.test.js`:

* `cheapest_total` sums `cheapest_by_role` over `BUDGET_FLOOR_ROLES` = `EXPANSION_ORDER`
  minus `GPU`. GPU is excluded because the Step 3 GPU policy makes it omissible under
  OPTIONAL, so including it would overstate the floor and report "unaffordable" for a
  build that is in fact serviceable without a discrete GPU. `cheapest_by_role` still
  REPORTS the GPU price when one is retained, so a caller can total it back in.
* `cheapest_total` and `within_budget` are `null` — never `0` — when a required role has
  no retained candidate, and `missing_roles` names it. This is the project's standing
  `NULL != 0` rule applied to a new field: a `0` total would read as "everything is free",
  and `within_budget: 0 <= budget` would read as "comfortably affordable".

### Rejected alternatives

* **Budget prefilter (drop candidates whose own price exceeds `budget_amount`) before
  retention.** Correct on its own and nearly free, but it does not touch the defect: every
  part in both measured failures was individually affordable — 2699 MAD CPUs and 949 MAD
  cases under a 15000 MAD / 10000 MAD budget. The failures are sums, not individual prices.
  It is also strictly weaker than the reservation, which handles the same candidates.
* **Adaptive K widening in the orchestrator** (on 0 builds, re-run retention with K, 2K, 4K
  and reassemble). Leaves `retention/` untouched, but discards and re-does the entire
  assembly pass, makes cost depend on the data, and still leaves the cheap end broken —
  widening K adds expensive candidates, so it moves the retained set UP in price at exactly
  the moment the budget is already too small. It fixes the symptom that the reservation
  fixes at the cause.
* **Second-pass cheapest-first fallback** (primary pass byte-identical, re-retain only on
  0 builds). Preserves today's output exactly, at the cost of a second divergent code path
  that is exercised only by the failure case — i.e. the least-tested branch carries the
  most product weight.
* **Lower `top_k_per_role`.** The cheapest parts are already below the cut, so a larger K
  would admit them; this inverts the diagnosis and costs assembly time.
* **Persist rejection reasons** (the OG-04 route). Correct as a long-term answer and out of
  scope here: it needs a migration, a write path, and a retention-lifecycle decision that
  has not been taken. `budget_floor` answers the budget question only, and is additive to
  OG-04 rather than a substitute for it.

### Consequences

* The retained floor becomes the catalog's cheapest-per-role combination whenever a bucket
  exceeds K, so the two harness measurement budgets in `scripts/measure-orchestrator.js`
  (GAMING 20000, OFFICE 12000) are EXPECTED TO FALL and must be re-measured, not assumed.
  Lowering them on prediction is exactly the error this decision is correcting.
* `measure-og01-reach.js` becomes the cheapest standing witness: it prints the floor on
  every run, so a future scoring seed that moves the floor is visible without a harness.
* `retention/`'s documented boundary and its boundary test both change. The module's
  header comment, `retention/index.js`'s header, and `docs/TEST_MAP.md` are updated in the
  same session; stale status has caused re-implementation attempts here before.
* Every call site of `retainTopKPerRole` must now pass `prices`. That is an intentional
  break, not an oversight: a budget-blind retention that can still be constructed silently
  is the defect.

### Verdict for this pass

IMPLEMENTED 2026-10-02 — all five tasks of
`docs/superpowers/plans/2026-10-02-og26-budget-aware-retention.md`, measured on the
TEST branch (preflight {products:100, models:1, offers:101, assessments:280,
queries:0}).

* **Item 1** (the reservation): `retention/retain.js`, pinned by
  `retention/retain.test.js` — including the K=1, single-candidate,
  REJECTed-cheap and equal-price-tie cases, and the case where the reserved set
  must be topped back up to K so `retained_count` stays
  `min(K, eligible_count)`. Unit tests 829 -> 859, 0 failures.
* **Item 2** (required `prices`): every call site supplies it; the
  missing-entry and non-finite-`selected_price` paths are pinned as
  `MISSING_REQUIRED_FIELD` on field `prices`, never as 0.
* **Item 3** (the boundary): `retention/index.test.js` bans each forbidden
  specifier BY NAME and pins the exact require list. The scan strips comments
  first, because this entry's own comment has to name what it forbids; a
  companion assertion keeps that prose honest, so the relaxation cannot hide a
  real import.
* **Item 4** (`budget_floor`): `retention/budget-floor.js`, wired at
  `run.js` step 11b and passed through by `full-run.js`; the result-key
  order and the always-present contract are pinned in
  `orchestrator/run.test.js` and `full-run.test.js`.

Gates, all run: `npm run test:unit` 859/0 · `scripts/lib/gap-register.test.js`
9/0 · `scripts/lib/db-url.test.js` 7/0 · `gen-decision-index --check` clean ·
`verify:docs` OK · `check-og01-coverage.js --strict` PASS ·
`check-deferred-rules.js` 0 violations in every scope ·
`test-orchestrator-full-run.js` 28 pass / 0 fail · `measure-orchestrator.js`
Decision-23-O1 criteria 1+2 MET for both use cases.

Measured: the cheapest-per-role sum fell **7426 -> 4477 MAD**, with the retained
per-role minima moving CPU 2699 -> 899, GPU 9000 -> 3200, SSD_BOOT 899 -> 599,
PSU 999 -> 599, CASE 949 -> 849, CPU_COOLER 699 -> 350. Builds appear at 8000
MAD (cheapest build 7677) and fill the cap at 10000 MAD (cheapest 8847 GAMING /
9396 OFFICE), so both harness budgets were **lowered** — 20000 -> 10000 and
12000 -> 10000 — and re-verified at the lower value.

**The one thing this entry does not claim:** the floor is a LOWER BOUND, not a
guarantee that a build exists. The cheapest build that actually assembles is
7677 MAD, so 4500-7000 MAD still returns zero builds *while `within_budget` is
true* — the cheapest-per-role combination is not the cheapest pairwise-compatible
one, and Engine 3's Decision 16 gate abandons the branch that would reach 4477.
That is the correct and intended reading of the field ("the emptiness is
compatibility, not budget"), it is pinned by a test, and it is precisely why
item 1 alone does not close **OG-04** (rejection-reason persistence), which
stays open.

### Supersedes / superseded by

Amends **Decision 14 Rule 4** (the selection performed inside the `top_k_per_role` cap) and
**Decision 12** (retention's input contract), both recorded 2026-09-20. Rule 2 eligibility,
Rule 3 ordering, the Rule 5 `compareCandidates()` tie-break and the Rule 4 hard cap are
UNCHANGED. The `## Final Status` footer one-sentence summary below still describes the
ordering and the cap accurately and is updated only to note the reservation; the Decision
22 / 26 pattern of an `UPDATE` block in place rather than a silent rewrite is the
precedent. The superseded wording was NOT edited in place — the reservation is recorded
here and in the code, and the gap-register row OG-26 is bannered with the same pointer.
---

## Final Status

```text
Decision 12: RESOLVED (ranking / top-K ownership -> src/recommendation/retention/, pipeline position Engine 2C -> 2D -> retention/ -> Engine 3, adopted 2026-09-20)
Decision 13: RESOLVED (candidate-ranking score formula, adopted 2026-09-19)
Decision 14: RESOLVED (top_k_per_role retention semantics, resolved 2026-09-20)
Selected semantics: A — Hard upper bound
Tie-break: existing compareCandidates() authorized — YES
Decision 15: RESOLVED (UNKNOWN pairwise-count producer, adopted 2026-09-19)
Decision 16: RESOLVED (pairwise branch validation inside Engine 3's DFS, adopted 2026-09-21)
Decision 17: RESOLVED (query loader and orchestrator contract, adopted 2026-09-21)
Decision 18: RESOLVED (ranking / Engine 5a, adopted 2026-09-21)
Decision 19: RESOLVED (persistence / Engine 5b, adopted 2026-09-21)
Decision 20: RESOLVED (post-ranking (CPU, GPU) pair diversity selection / O4, MAX_PER_PAIR = 3 code constant, adopted 2026-09-22)
Decision 21: RESOLVED (full-run composition contract -> orchestrator/full-run.js runRecommendationFullRun, adopted 2026-09-23)
Decision 22: RESOLVED (explanation generation / Engine 6 contract, adopted 2026-09-24)
Decision 23: RESOLVED (score-degeneracy: build-local unknown_pairwise_count (O2) + GPU/PSU connector & dimension data seed 003 (O1), adopted 2026-09-27)
Decision 24: RESOLVED (Decision 20 O4 / MAX_PER_PAIR = 3 re-evaluated on the 100-product catalog; retained unchanged, scope limitation recorded - diversity only at the raised cap, no-op-plus-under-fill at the shipped configured cap, adopted 2026-09-28)
Decision 25: RESOLVED (assembly cap starvation: max_builds_per_query = 25 truncates the depth-first EXPANSION_ORDER walk before CPU/GPU can vary, so O4 is structurally starved at every MAX_PER_PAIR value and OFFICE is pair-space-bounded at k=9; raising the cap is necessary but insufficient, adopted 2026-09-28)
Decision 26: RESOLVED (hybrid, audit D2: architecture S5.2 HIGH-TGP connector escalation IMPLEMENTED - Rule 11 returns FAIL GPU_PSU_CONNECTOR_NULL_HIGH_TGP when a required KNOWN connector's PSU availability is NULL and gpu_board_spec.board_tgp_watts >= 200, with the TGP loaded via context-loader/filter.js; the four S5.3/S6 HARD rules - cooler TDP, cooler height, RAM slots, RAM capacity - EXPLICITLY DEFERRED and recorded as UNENFORCED, adopted 2026-09-28)
Decision 27: RESOLVED (budget-blind retention replaced by a cheapest-per-role reservation of 1 of K slots, ties by Rule 3/5 order, plus a budget_floor diagnostic that is always present; Rule 2/3/5 and the hard cap unchanged, adopted 2026-10-02)
```

Unambiguous one-sentence semantics for the implementation task:

> For each `component_role`, after excluding `REJECT` candidates, eligible (`PASS`/`UNKNOWN`) candidates are ordered by candidate score descending with the existing `compareCandidates()` chain (role enum order, `product_id` ASC, `product_variant_id` NULL-first then ASC) as the deterministic tie-break, and exactly the first `candidate_caps.top_k_per_role` (K) candidates are retained — `retained_count <= K` always, exactly K whenever at least K eligible candidates exist — and that set is then passed to Engine 3, with `max_builds_per_query` remaining an independent Engine 3 build-count cap.

Decision 27 amendment (2026-10-02): the first K are the first K-1 by that order PLUS the single cheapest eligible candidate by `selected_price` (ties by the same order), re-emitted in that order — so the cap and the ordering are unchanged and only membership differs.

---

## Decision 28 — Per-cooler radiator size added to `cooler_spec`, making rule 5 reachable (RESOLVED 2026-10-04)

Status: RESOLVED 2026-10-04; IMPLEMENTED and APPLIED 2026-10-04 — migration `013_cooler_radiator_size.sql` adds a nullable `cooler_spec.radiator_size_mm` and seed `007_cooler_radiator_size.sql` populates the 5 liquid coolers, so rule 5's size match can now succeed instead of comparing a NOT NULL integer against `null`.

Date: 2026-10-04. Scope: this closes OG-28, found by an adversarial review of the OG-30 work. It is **not** documentation only, **not** a new compatibility rule, and **not** a change to any verdict logic.

The defect. `resolveCaseRadiator` (rule 5) was already implemented, exported and wired through `filtering/filter.js`, and it matches `row.radiator_size_mm === radiator_size_mm`. But `filtering/context-loader.js` hardcoded `radiator_size_mm: null` for every cooler, because `cooler_spec` had no radiator-size column. A NOT NULL integer never equals `null`, so every liquid cooler in a case that *had* a matrix fell to the no-match branch and returned `UNKNOWN RADIATOR_SUPPORT_UNKNOWN` — permanently, and independently of how much case data was added. OG-05 had already closed the CASE side (all 10 of 10 cases carry a `case_radiator_support` matrix), so the rule was fully implemented and simply unable to reach PASS.

Why adding the column was safe — measured before authoring, not assumed. Over all 10 cases x 5 liquid coolers = 50 pairs: **43 UNKNOWN -> PASS, 7 stay UNKNOWN, 0 -> FAIL**. The direction is monotone *by construction*: rule 5 FAILs only on `liquid + ZERO radiator rows`, and OG-05's closure guarantees a non-empty matrix for every case, so that branch is unreachable and this change **cannot reject a build that is currently accepted**. UNKNOWN was already eligible, so the change is strictly a lift from a held UNKNOWN to a genuine PASS.

Data provenance. Radiator size is RESEARCH, not a derivation. `cooler_spec.length_mm` is not a proxy — close for some units (ML280 length_mm 317 vs a 318mm radiator) and badly wrong for others (CORELIQUID 240R 274, MYSTIQUE 360 402). Each value is transcribed from the manufacturer's own specification page: ML280 = 280 (318x140mm radiator), Nautilus 240 RS ARGB = 240 (Corsair, 276x120mm), MYSTIQUE 360 = 360 (DeepCool, 402x120mm), CORELIQUID 240R = 240 (MSI, 274x120mm), A13 360 = 360 (MSI states "Radiator Size 360 mm"). No value is estimated and none is NULL.

Preserved invariants. The column is NULLABLE and every AIR cooler is left NULL — an air cooler requires no radiator and rule 5 returns PASS for it without reading a size. That is enforced in the seed's DML (`AND cs.cooling_type = 'LIQUID'`), not merely asserted in its header, so a mis-typed VALUES entry cannot give an AIR cooler a radiator size; this was confirmed adversarially by pointing an entry at the AIR DeepCool AG400 and observing no write. NULL is preserved exactly as PostgreSQL returned it and is never coerced to 0, so the `NULL = UNKNOWN` rule holds and an un-researched liquid cooler still resolves UNKNOWN rather than falsely matching. The new `> 0` CHECK matches the sibling `cooler_spec` guards; a CHECK against a NULL evaluates to NULL and is not violated. A size the case matrix does not carry stays UNKNOWN (support is never invented) and is *not* a FAIL — turning absence of evidence into rejection is precisely what the UNKNOWN policy exists to prevent.

Ranking consequence (why this is not cosmetic). `unknown_compat_penalty` is 5 per build-local UNKNOWN pairwise count, and 3 of the 5 retained CPU_COOLERs in the live GAMING@10000 measurement are liquid. After the change `measure-orchestrator.js` reports GAMING `unknown_pairwise_count 0` and `test-orchestrator-full-run.js` reports builds at `PASS compatibility` where they were previously UNKNOWN.

Verification. Branch-first: migration 013 + seed 007 applied to `TEST_DATABASE_URL` via the ledger-driven runner, then the three guarded harnesses re-run green (`test-orchestrator-full-run.js` 28 pass / 0 fail; `test-orchestrator-commit.js` 29/0; `measure-orchestrator.js` Decision-23-O1 criteria 1+2 MET). Seed 007 verified idempotent (a second run changed zero rows). The 50-pair tally was then reproduced through the real `filterCandidatesForRecommendation` path on BOTH the branch and the shared DB, identical at 43/7/0. Unit tests 861 pass / 0 fail, including a new test that FAILS if a supplied size ever produces a FAIL, and a loader test that was confirmed to fail when the fix is reverted.

Out of scope, deliberately. This does not close OG-27 (4 of the 5 liquid coolers still have NULL `height_mm`, and 3 `max_tdp_watts` values still disagree with the vendor); that is a separate spec-data pass and becomes load-bearing only when a pump-height rule is proposed. It does not touch the four deferred rules OG-09...OG-12, which remain latent with 0 violations, nor the 30-day offer-freshness window (Decision 7), nor OG-30, nor OG-06.
---

## Decision 29 — REJECT verdicts are persisted per recommendation query (RESOLVED 2026-10-04)

Status: RESOLVED 2026-10-04; IMPLEMENTED and APPLIED 2026-10-04 — migration `014_build_rejection.sql` adds the `build_rejection` table and the commit wrapper now writes each Engine 2D REJECT verdict into it in the same transaction as the surviving builds.

Date: 2026-10-04. Scope: this closes OG-04, the gap ARCH section 16 has listed as IMPORTANT since the original audit. It is **not** a change to any verdict, scoring, ranking, retention or assembly logic, and **not** a new compatibility rule.

The defect, in the architecture's own words (section 10): a build whose status would be FAIL "is NOT persisted as a surviving candidate; rejected combinations are logged only in engine diagnostics (no rejection-rejection table exists - gap, section 16)". Engine 2D computes every candidate verdict — `filter.js` sets `status = REJECT` and carries the decisive `REASON_CODES` value in `reason` — and all of it was discarded when the pass ended.

Why this and not a cheaper shape. Decision 27's `budget_floor` already explains the *budget* axis of a zero-build outcome, and it was explicitly recorded as a lower bound that ignores partners entirely — so it can say "the emptiness is compatibility, not budget" but never which pair was incompatible. OG-04 was the remaining half of that debugging story. Two alternatives were considered and rejected: a diagnostics summary on the in-memory pass result (lost the moment the process exits, so it cannot answer "why was *that run* empty"), and no change at all (leaves the axis unexplained). Persistence keyed to the query is the only shape that answers the question after the fact.

Shape decisions, and why each was made:
- **One row per REJECTED CANDIDATE, not per rejected combination.** Engine 2D rejects at the candidate level; a pairwise row would require re-deriving pairs the filter never materialized. Pairwise rejections detected during assembly are a separate concern and are explicitly NOT captured (see Out of scope).
- **REJECT only.** PASS and UNKNOWN are survivals, not rejections; recording them here would conflate the two and bury the REJECTs that matter. A healthy pass therefore writes ZERO rows, and that emptiness is itself the signal that nothing was rejected.
- **`reason_code` is TEXT, not a new enum.** `REASON_CODES` has 23 members and is persisted nowhere; an enum would need a migration every time a resolver gains a reason and would reject an unknown-but-real code. A `btrim(reason_code) <> ''` CHECK keeps "no reason" impossible without that coupling.
- **Both partner ids are NULL together or neither**, enforced by `chk_build_rejection_partner_pair_complete`, because a candidate's decisive reason may not depend on a partner at all.
- **All five FKs are `ON DELETE CASCADE`.** Rejection rows are diagnostic detail belonging to a query; if the query goes, its diagnostics go with it rather than being orphaned or blocking the delete.

Transaction discipline. `persistRejections` runs inside the commit wrapper's existing transaction, immediately after `persistRanked` and on the same client, so a pass can never commit builds without their diagnostics or diagnostics without their builds. It issues no BEGIN/COMMIT/ROLLBACK and contains no SELECT — same DML-only boundary as `persistRanked`, pinned by a source-boundary test.

Deliberate non-change: the wrapper's return value is still the writer's OWN frozen result **by reference** (the Decision 19 seam). An earlier draft re-wrapped it to add `rejection_count`; that broke two existing identity assertions and silently dropped the writer's `query_id` field, so it was reverted rather than accommodated. No existing caller sees a new or reshaped field; read the committed rows back with a SELECT on `build_rejection`.

One bug worth recording, because the unit tests could not have caught it. The writer originally read the reason from a field named `reason_code`, matching the DB column. Every fake fixture passed, because the fixtures were invented rather than taken from a real verdict. The live end-to-end run failed immediately with `rejections[21] requires "reason_code"` — an Engine 2D verdict carries the decisive reason in **`reason`** (`filter.js` sets `reason = firstFailed.reason`), never `reason_code`. All 101 real verdicts use `reason`. The mapping from `reason` to the `reason_code` column now happens in the validator, and a regression test pins the exact frozen key set `filter.js` produces.

Verification. Branch-first: migration 014 applied to `TEST_DATABASE_URL` via the ledger, then the three guarded harnesses re-run green (`test-orchestrator-full-run.js` 28 pass / 0 fail; `test-orchestrator-commit.js` 29/0; `measure-orchestrator.js` exit 0). All seven schema constraints were probed against the live branch rather than assumed — a half-populated partner pair, a blank reason, a NULL reason, a NULL role and an out-of-enum role are all rejected, and deleting a query cascades its rows away. **Measured end-to-end on the branch and then the shared DB through the real `runRecommendationFullRun`:** a GAMING@10000 MAD pass surfaces 101 Engine 2D verdicts, 2 of them REJECT, and persists exactly 2 rows — `Seed ASUS GeForce RTX 5090 32 GB TUF GAMING` and `Seed GIGABYTE GeForce RTX 5080 16GB GAMING OC`, both `GPU_TOO_THICK` — committed alongside 6 `build_candidate` rows, identical on both databases. 15 new unit tests; the full suite is 876 pass / 0 fail, and each new test was mutation-checked by reverting the fix and confirming the test fails.

Out of scope, deliberately. Pairwise rejections detected during assembly (`assemble.js` abandons a branch when an aggregated pair FAILs) are combinations rather than candidates and are NOT captured; closing that is a separate change. UNKNOWN verdicts are not persisted. No UI or API surface reads `build_rejection` yet — there is no such layer in this repository yet, so the payoff is queryable diagnostics rather than rendered output. `run.js` gained one additive `filter_verdicts` field to carry the verdicts to the writer; no existing consumer reads it, and the run-result shape pin was updated rather than worked around.

### UPDATE 2026-10-05 — idempotency residual closed by Decision 31 (OG-33)

The adversarial review of this decision's commit (2026-10-04) found that relying on the re-run guard for idempotency does not hold: guard 2 keys on `build_candidate` ONLY, so a zero-build pass that wrote `build_rejection` rows could be committed again and duplicated (measured 1→2 rows). The "a re-run cannot duplicate diagnostics" sentence that was originally in `persist-rejections.js`'s header was wrong and was corrected in place when OG-33 was registered. **Decision 31 (2026-10-05) fixes it** with replace semantics in the writer — a scoped `DELETE ... WHERE recommendation_query_id = $1` before the INSERTs, same transaction — leaving guard 2 and this decision's schema, shape and transaction discipline otherwise unchanged. See OG-33 / C-27 in `docs/OPEN_GAPS.md`.

---

## Decision 30 — OG-10 un-deferred: the AIR-cooler height rule is now IMPLEMENTED (RESOLVED 2026-10-05)

Status: RESOLVED 2026-10-05; IMPLEMENTED 2026-10-05 — Decision 26 item B deferred four HARD rules (OG-09 cooler TDP vs CPU TDP, OG-10 AIR cooler height vs case clearance, OG-11 RAM module_count vs dimm_slots, OG-12 RAM capacity vs board max). This decision lifts the deferral for OG-10 ONLY. The other three remain EXPLICITLY DEFERRED and unenforced.

Date: 2026-10-05. Closes OG-10 (docs/OPEN_GAPS.md, see C-26). One rule added; no migration, no seed, no schema change.

### Why now, and why this one first

Decision 26 deferred these rules because their inputs were not trustworthy, not because the rules were wrong. That condition has now changed for exactly one of them, and the change is measurable rather than asserted:

* **The input data was wrong until seed 010.** All four AIR coolers carried an identical placeholder `height_mm` of 155 (OG-34), one of them understated by 3 mm. Enforcing the rule against a placeholder is worse than not enforcing it: a 158 mm tower recorded as 155 mm PASSes a 156 mm case. Seed `010_air_cooler_heights.sql` replaced the placeholder with vendor-published heights (AG400 150, COREFROZR AA13 BLACK/WHITE 152, NH-U12S SE-AM5 158), each re-verified against the vendor for the seed itself.
* **The loader never fetched either column.** `COOLER_SPEC_SQL` omitted `cooler_spec.height_mm` and `CASE_SPEC_SQL` omitted `case_spec.max_cpu_cooler_height_mm`, so the rule was not merely unenforced, it was unreachable. Both columns are now selected and normalized.
* **Measured before implementing:** 4 AIR coolers x 10 cases = 40 pairs, **0 would-FAIL**. The smallest case clearance is 160 mm against a tallest cooler of 158 mm. Enforcing the rule is therefore behaviour-neutral on today's catalog: the full Engine 2C-2D pass returns 101 verdicts (87 PASS / 12 UNKNOWN / 2 REJECT) before and after, byte-identical.

### Decision

**The OG-10 height rule is ADOPTED as the shipped contract and implemented, scoped to AIR coolers only.**

1. **Shipped semantics (exact).** `compatibility/cooler-height.js` `resolveCoolerCaseHeight`, evaluated on the existing CPU_COOLER <-> CASE pair alongside the radiator rule:

   | condition | result |
   |---|---|
   | `height_mm <= max_cpu_cooler_height_mm` | PASS (evidence carries `headroom_mm`) |
   | `height_mm > max_cpu_cooler_height_mm` | FAIL `COOLER_TOO_TALL` (evidence carries `over_by_mm`) |
   | either value NULL / non-finite | UNKNOWN `COOLER_HEIGHT_UNKNOWN` |
   | `cooling_type` positively non-AIR | PASS, `scope: not_applicable`, no reason |

   The boundary is INCLUSIVE: a cooler exactly as tall as the published clearance fits, because the clearance is a maximum, not a recommendation with margin.

2. **A NULL is UNKNOWN, never a PASS.** An unmeasured cooler is not an unlimited one. This is the property OG-34 was hiding, and it is pinned by unit test rather than by convention.

3. **AIR ONLY, and the second reason is the binding one.** `cooler_spec.height_mm` means different physical things by `cooling_type`: for AIR it is the tower height that decides side-panel clearance, for LIQUID it is the pump-block height written by seed 009. Those are different constraints under one column name. A positively non-AIR cooler is out of scope — a no-reason PASS, so it can contribute neither a FAIL nor UNKNOWN noise to the aggregate — rather than being judged on a dimension the rule does not mean. A NULL `cooling_type` is NOT treated as out of scope: an unclassifiable cooler is not provably "not AIR", so it falls through to the numeric check and reports UNKNOWN unless a height is genuinely present. 50 liquid pairs therefore remain deliberately unmeasured.

4. **Two new reason codes**, `COOLER_TOO_TALL` and `COOLER_HEIGHT_UNKNOWN`, added to `compatibility/reason-codes.js`. Reason codes are part of the resolver contract and may be persisted, so they are named once and never reused.

### Rejected alternatives

* **Cover all coolers in one rule (90 pairs):** rejected — it would judge a liquid pump-block height with a tower-height reason code, conflating two constraints that happen to share a column name.
* **Two separate rules, AIR height and liquid pump height:** correct long-term and the eventual shape, but it is a larger change than the deferral warrants and needs its own decision. Recorded as the natural follow-up.
* **Implement all four deferred rules together:** rejected — OG-11/OG-12 inputs were never wrong in the way OG-10's were, and bundling three unmeasured rules with one measured one would make the trigger meaningless.
* **Treat the current 2 mm headroom as a safety guarantee:** rejected. It is a property of the present ten cases; a 158 mm-class case erases it. The rule is worth shipping because the DATA is now right, not because the catalog is forgiving.

### Verification

15 new unit tests in `compatibility/cooler-height.test.js` pin the tri-state contract, the inclusive boundary, the one-millimetre FAIL, the LIQUID exclusion (including that a 200 mm pump block against a 170 mm case does NOT reject), the NULL-`cooling_type` handling, and that NaN/Infinity/numeric-strings are UNKNOWN rather than coerced. Suite 876 -> 891 tests, 0 failures. Five existing fixtures that pinned the exact spec/verdict shape were given real cooler heights and case clearances, because with them absent the new pair is correctly UNKNOWN and an "all-PASS" fixture would stop being one; no assertion was weakened.

End-to-end on the branch DB: the full pipeline returns 101 verdicts (87/12/2) unchanged on the real catalog, and forcing the AG400 to 200 mm — taller than every case in the catalog — produces a CPU_COOLER REJECT carrying `COOLER_TOO_TALL`, which is what proves the rule is live rather than merely present. Restoring the height returns the verdict set to byte-identical.

### Standing obligation

`scripts/check-deferred-rules.js` still reports all four rules. It must be updated or narrowed so it does not describe OG-10 as LATENT, and its "re-check before merging any cooler/RAM/case/motherboard seed" trigger now covers an ENFORCED rule as well as three deferred ones — a seed that adds a cooler taller than a case will start producing real REJECTs, and that is the intended behaviour, not a regression to be silenced.

```text
VERDICT: RESOLVED - OG-10 IMPLEMENTED (AIR-only, tri-state, NULL=UNKNOWN). OG-09/OG-11/OG-12 remain EXPLICITLY DEFERRED per Decision 26 item B. Live catalog behaviour-neutral: 40/40 AIR pairs PASS, full pass 101 verdicts unchanged (87 PASS / 12 UNKNOWN / 2 REJECT). Suite 891 tests, 0 failures.
```

---

## Decision 31 — build_rejection writes are replace-idempotent per query (OG-33)

Status: RESOLVED 2026-10-05; IMPLEMENTED 2026-10-05 — the rejection writer now clears the query's `build_rejection` rows and re-inserts the current pass's set inside the commit transaction, so a re-commit converges instead of duplicating; guard 2 (Decision 19.2) is unchanged. Closes OG-33.

Date: 2026-10-05. Scope: closes OG-33 (docs/OPEN_GAPS.md, see C-27), the duplication defect found 2026-10-04 by the adversarial review of the OG-04 / Decision 29 commit. It is NOT a schema change (no migration, no seed), NOT a change to guard 2 / Decision 19.2, NOT a change to any verdict, scoring, ranking, retention or assembly behaviour, and NOT a fix for OG-32 (partner identity stays NULL — that needs an Engine 2D verdict-shape change and keeps its own row).

### Current situation

* `commit.js` guard 2 is `SELECT 1 FROM build_candidate WHERE recommendation_query_id = $1 LIMIT 1` (Decision 19.2): it never mentions `build_rejection`. A ZERO-BUILD pass that still rejected candidates therefore leaves its diagnostics unguarded, and a second commit for the same query_id is reachable.
* Measured on the live branch 2026-10-04: two consecutive zero-build commits with identical rejections took `build_rejection` from 1 row to 2; a later NON-empty commit duplicated them alongside the builds. `persist-rejections.js`'s own header had claimed the opposite ("a re-run cannot duplicate diagnostics"); that claim was wrong and was corrected in place when OG-33 was registered.
* The consequence is bounded but real: `rejection_count` and any per-query diagnostic aggregation double-count — exactly the query an operator runs to explain an empty result. `build_rejection` is read by nothing in `src/` (grep-verified), so ranking, scoring, assembly and explanation are unaffected.

### Problem

The OG-04 closure (C-22) says the table answers "why was nothing recommended?" for a specific past run — but a table that silently doubles its rows under a legitimate re-commit gives the wrong answer to precisely that question, and the re-commit path is legitimate: Decisions 19.3 / 18-D8 keep the zero-build → later non-empty sequence open by design (harness section 5 pins it). Something had to make the writer safe under the guard the architecture actually has, without narrowing that path.

### Decision

1. **Replace semantics, owned by the writer.** `persistRejections` (`src/recommendation/persistence/persist-rejections.js`) issues `DELETE FROM build_rejection WHERE recommendation_query_id = $1` (new exported constant `DELETE_BUILD_REJECTION_SQL`) as its FIRST statement, then one INSERT per REJECT verdict — all on the wrapper's client, inside the wrapper's transaction, serialized by guard 1's row lock. The stored rows for a query always equal the last committed pass's REJECT set.
2. **Validation still precedes the DELETE** — a malformed input issues zero statements (the fail-fast contract is unchanged), and a writer error rolls the DELETE back with everything else via the wrapper's ROLLBACK.
3. **The wrapper invokes the writer only when the caller supplied the 4th argument.** `rejections === undefined` → the writer is not called at all (zero statements; legacy three-argument call sites stay byte-identical in behaviour). An explicit array — including `[]` — means "this pass's set", so `[]` clears stale rows rather than silently leaving them.
4. **Guard 2 is UNCHANGED.** It still keys on `build_candidate` only and still refuses only when builds exist; Decision 19.2's "no overwrite, no delete, no upsert" continues to describe `build_candidate` / `persistRanked`, which this decision does not touch.
5. **No schema change.** Idempotency is the statement shape, not a uniqueness key — no migration; `database/migrations/014_build_rejection.sql` stays as committed.
6. **OG-33 closes** (docs/OPEN_GAPS.md → C-27), and the `AGENTS.md` §8 lesson is rewritten from "confirm guard 2's SQL mentions X's table" to the Decision-31 shape: an unguarded table is made safe by writing it replace-style, not by growing the guard.

### Rejected alternatives

* **Widen guard 2 to also refuse when `build_rejection` rows exist.** Rejected: it would refuse the legitimate zero-build → later non-empty sequence for the same query — the exact sequence Decisions 19.3 / 18-D8 keep open and harness section 5 pins — permanently stranding a query that later assembles builds behind diagnostics it wrote itself. It would also make diagnostics STRICTER than builds, the wrong precedence for a diagnostic table.
* **UNIQUE index on (query, role, product, variant, partner, reason) + `INSERT ... ON CONFLICT DO NOTHING`.** Rejected on two counts: it needs a migration (015), and it would not fire on today's rows at all — `partner_product_id` is always NULL (OG-32, **now CLOSED by Decision 32 — corrected inline below**), and Postgres treats NULLs as DISTINCT in a unique index, so the key would never collide on the exact rows that duplicate.
* **Existence-check-then-insert in the wrapper (SELECT + set diff).** Rejected: it would push set-difference logic into the wrapper, whose source-boundary test bans DML there, and it still solves only duplication — a changed pass would leave stale rows that an unconditional DELETE removes for free.

### Verdict for this pass

* **Unit — PASS.** Suite 891 → **896, 0 failures**. Three new writer pins (`DELETE_BUILD_REJECTION_SQL`'s exact string and scope, the clear-before-insert sequence across two identical calls, DELETE-even-when-the-new-set-is-empty) and two new wrapper pins (a three-argument call issues no `build_rejection` statement at all; a supplied array runs DELETE + INSERT between guard 2 and COMMIT). Existing assertions were updated where the statement sequence legitimately changed; none was relaxed.
* **Real round-trip — PASS** (temporary probe against the test branch, removed after recording; baseline `{queries: 0, build_rejection: 0}`): three consecutive zero-build commits with the same 2 verdicts held the count at **2 → 2 → 2** (pre-fix: 2 → 4 → 6); a changed pass replaced the set (**2 → 1**, reason `GPU_TOO_THICK`); an explicit empty pass cleared it (**→ 0**); a later NON-empty commit persisted 1 build alongside exactly **2** rejections; guard 2 then refused a further commit (`INVALID_INPUT` / `query_id`) and left the rows untouched; cleanup restored both tables to baseline (residue 0). **16/16 PASS.**
* **Durable pin — PASS.** `scripts/test-orchestrator-commit.js` gained section 6 running the same sequence with counts read from the SECOND connection; its `countsForQuery` / `countsForQueries` now count `build_rejection` and its `cleanup` deletes it explicitly (dependents before parent). Re-run on the branch: **37 pass / 0 fail** (was 29/0), cleanup residue `{rejections: 0, …}`.
* **Gates — PASS.** `npm run test:unit` 896/0; `verify-docs` decision counts bumped (29 global / 35 `Status:` lines); `npm run gen:decisions` re-run; `AGENTS.md` range → Decisions 1–31; gap register OG-33 → CLOSED with C-27.

### Supersedes / superseded by

* **Amends Decision 29's writer contract** — specifically the idempotency Decision 29 implicitly leaned on the re-run guard for. An UPDATE block was added INSIDE Decision 29's entry (edited in place, per `docs/decisions/TEMPLATE.md`), and its Status line was left unchanged.
* **`database/migrations/014_build_rejection.sql`'s header comment is NOT edited** (migrations are never rewritten): its sentence "a re-run guard already refuses to persist a second time" was already false when OG-33 was registered and is superseded by this decision. Its other clause — "the same reason can legitimately be recorded on repeated runs of the same query id" — remains true; only the guard-based idempotency claim it was paired with is replaced.
* The `AGENTS.md` §8 bullet about the guard keying on `build_candidate` only was rewritten in place to record the Decision-31 replace shape.

```text
VERDICT: RESOLVED - build_rejection writes are replace-idempotent per query (scoped DELETE first, then one INSERT per REJECT, same transaction). Guard 2 / Decision 19.2 unchanged; no migration; OG-32 untouched. Measured on the branch: 3 identical zero-build commits hold 2 rows (pre-fix 2->4->6), a changed pass replaces, an empty pass clears, guard 2 still refuses once builds exist, residue 0. Harness 37/0 (was 29/0), unit suite 896/0 (was 891).
```


## Decision 32 — a persisted rejection names its decisive partner (OG-32)

Status: RESOLVED 2026-10-05; IMPLEMENTED and APPLIED 2026-10-05 — the Engine 2D candidate verdict gains two additive fields carrying the product identity of the partner the candidate decisively failed against, so a `build_rejection` row can now answer "against which partner" and not only "which candidate, and why". Migration `015_relax_rejection_partner.sql` relaxes the partner CHECK to permit a product-keyed partner. Closes OG-32.

Date: 2026-10-05. Scope: closes OG-32 (docs/OPEN_GAPS.md, see C-28), the residual recorded against the OG-04 closure (C-22) and re-confirmed against Decision 30's `COOLER_TOO_TALL`. It IS an Engine 2D verdict-shape change (two additive fields), a schema migration (015), and a relaxation of one persistence validation rule. It is NOT a change to any verdict status, reason, relationship aggregation, `unknown_pairwise_count`, compatibility note, scoring, ranking, retention or assembly behaviour, and NOT a change to guard 2 / Decision 19.2 or to the Decision 31 replace semantics.
### Current situation

* `build_rejection` (migration 014, Decision 29) has carried `partner_product_id` / `partner_product_variant_id` since it was created, and `validate-rejections.js` has always read them — but they were **always NULL**, because an Engine 2D verdict carried partner identity only inside `compatibility_notes`, and only for CONDITIONAL evidence. The columns were storable and unreachable.
* Two independent reasons the values could not simply have been filled in. First, the producer had no such field: `filter.js` froze verdicts with exactly `product_id, product_variant_id, category, component_role, status, reason, relationships, unknown_pairwise_count, compatibility_notes`. Second, and more seriously, migration 014's `chk_build_rejection_partner_pair_complete` demanded **both ids or neither**, with the header comment "a variant-keyed partner (GPU) always carries both ids, a product-keyed one carries neither". Since the decisive partner of most rules is **product-keyed** — the CASE behind `GPU_TOO_LONG` / `GPU_TOO_THICK`, the CASE behind `COOLER_TOO_TALL`, the MOTHERBOARD or PSU behind the socket / wattage rules — the constraint made the fix **forbidden rather than merely unimplemented**. Filling the producer alone would have converted a NULL column into a `23514` on every real rejection.
* Measured on the live branch before this decision: a GAMING@10000 MAD pass persisted 2 rows, both `GPU_TOO_THICK`, both `partner_product_id = null`; forcing an AIR cooler to 300 mm produced a `CPU_COOLER` / `COOLER_TOO_TALL` rejection that was likewise NULL. The gap was therefore not rule-specific — it widened with every newly enforced reason code, which is why it had to be closed at the verdict-shape level rather than per rule.

### Decision

1. **The verdict names its decisive partner.** `filter.js` `evaluateCandidate` records, per relationship, the partner of the relationship's **first FAIL pair in partner bucket order** — the same pair `firstReasonWithStatus` reads the decisive `reason` from — and the candidate verdict inherits it from the **first FAIL relationship** in canonical relationship order. The partner and the reason therefore always come from the same pair; a reader can trust the pair.
2. **PASS and UNKNOWN verdicts carry nulls.** A survival has no decisive rejection to name, and `build_rejection` persists REJECT verdicts only. The fields are present on every verdict (the shape is fixed, not conditional) so no consumer must branch on their existence.
3. **The pairing rule is relaxed, not inverted.** Migration `015_relax_rejection_partner.sql` drops `chk_build_rejection_partner_pair_complete` and adds `chk_build_rejection_partner_variant_requires_product`: `partner_product_variant_id IS NULL OR partner_product_id IS NOT NULL`. The truth table is (NULL, NULL) OK — no partner, e.g. `CPU_SOCKET_UNKNOWN`; **(id, NULL) OK — product-keyed partner, the normal case this migration exists for**; (id, variant) OK — variant-keyed partner; (NULL, variant) **REFUSED** — an orphan variant can never identify a partner on its own.
4. **`validate-rejections.js` mirrors the new CHECK**, so the failure names `partner_product_id` instead of surfacing as an opaque `23514`. A product-keyed partner is **valid**; refusing it is precisely what made OG-32 unfixable.
5. **`015` supersedes `014`'s constraint by dropping it; `014` itself is NOT edited** (AGENTS.md section 8: committed migrations are never rewritten). The old constraint name disappears; anything still citing `chk_build_rejection_partner_pair_complete` — `014`'s own header included, deliberately — is historical.
6. **Assembly is unaffected.** `assemble.js` `VERDICT_FIELDS` gates on *presence* of its eight required fields and does not reject extras, so the wider verdict passes Engine 3 validation unchanged, and emitted components keep their existing exact shape (the two new verdict fields are not copied onto components).
7. **OG-32 closes** (docs/OPEN_GAPS.md → C-28). Decision 31's rejected-alternative note is corrected: the UNIQUE-index option it declined is now sound, but replace-at-the-writer remains the chosen mechanism (it also handles a *changed* pass, which a unique key cannot).
### Rejected alternatives

* **Fill the columns from `compatibility_notes`.** Rejected: those notes exist only for CONDITIONAL evidence, so the decisive partner of a plain FAIL is absent from them by construction. Deriving the partner from notes would cover a minority of rejections and silently leave the majority NULL — the defect again, quieter.
* **Record the partner only at the relationship level and widen `relationships`.** Rejected: `relationships` is a `{key: status}` map consumed by assembly validation and asserted by exact shape in several tests; changing its value shape would ripple through Engine 3 for no diagnostic gain.
* **Name every failing partner (an array).** Rejected as over-engineering for the diagnostic purpose: a `GPU_TOO_LONG` against a bucket of 8 short cases would store 8 ids to answer a question one decisive partner already answers. The honest limitation — *which* partner is named depends on bucket order — is recorded below rather than designed away.
* **Keep 014's CHECK and store the product-keyed partner by inventing a placeholder variant.** Rejected: fabricating an identity to satisfy a constraint is exactly the class of wrong-data-instead-of-right-schema this repo's lessons file warns against (`NULL` is never coerced to an empty string or `0`).

### Verdict for this pass

* **Unit — PASS.** Suite 896 → **898, 0 failures**. New pins: a REJECT names its product-keyed partner, and a product-keyed partner is accepted by the writer with a NULL variant. The existing "both-present-or-both-absent is malformed" case was **replaced** by the orphan-variant case it actually still forbids, and the exact-verdict-key assertion gained the two fields. No assertion was weakened — the removed case is now a positive test.
* **Behaviour, driven headlessly through the real `filterCandidates`** (not only the unit fixtures): two cases of differing length make `gpu_case` PASS, so no partner is named; a CASE whose only GPU is 400 mm against a 360 mm case yields `REJECT / GPU_TOO_LONG` naming the GPU's **product + variant**; a GPU failing **two** relationships (`gpu_case` and `gpu_psu`) names the `gpu_case` partner, the same relationship its `reason` is read from; swapping bucket order moves the named partner, confirming it is bucket-order-derived and deterministic. The validator truth table was exercised directly and matches migration 015 row for row, including (NULL, variant) refused and a blank id refused.
* **Real round-trip — PASS.** Migration 015 is **applied on both databases**: `DATABASE_URL` and `TEST_DATABASE_URL` each report `schema_migrations = 15`, carry `chk_build_rejection_partner_variant_requires_product`, and no longer carry the 014 constraint. `docs/SCHEMA_REFERENCE.md` was regenerated and its schema-digest matches the live schema.
* **Durable pin — PASS.** `scripts/test-orchestrator-commit.js` gained section 7, asserting against a real second connection that a `GPU_TOO_THICK` row stores a **non-null** `partner_product_id` with a **NULL** (never empty-string) variant, that a variant-keyed partner stores **both** ids and survives the real FK against a real `product_variant` row, that an orphan variant is refused **before any statement runs**, and that the refused attempt changed no rows. Re-run on the branch: **43 pass / 0 fail** (was 37/0), cleanup residue all zero.
* **Gates — PASS.** `npm run test:unit` 898/0; `verify-docs` decision counts bumped (30 global / 36 `Status:` lines); `npm run gen:decisions` re-run; `AGENTS.md` range → Decisions 1–32 and migration range → `001`–`015`; gap register OG-32 → CLOSED with C-28.
### Honest limitations and supersessions

* **One decisive partner, chosen by bucket order.** The named partner is the first FAIL pair in Engine 2C pool order, not "the worst" or "all" of them. It is deterministic and reproducible (pool order is canonical), and it is always a genuine failing partner — but a rejection against several failing partners records one of them, so a reader must not infer "this was the only incompatibility".
* **Assembly-level pairwise rejections remain out of scope**, exactly as in Decision 29: `assemble.js` abandons a branch on an aggregated pair FAIL without materialising a candidate verdict, so those never become `build_rejection` rows.
* **Supersedes `014`'s CHECK semantics**, not the file. `database/migrations/014_build_rejection.sql` keeps its original comment describing both-or-neither; that description is historical from 2026-10-05. `015`'s own header was corrected in the same session to state accurately that only the `DROP ... IF EXISTS` half is re-runnable — Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, so a hand re-application would raise `42710`; single application is guaranteed by the OG-14 ledger, not by the file.
* **Corrects Decision 31's rejected-alternative note** (corrected inline above, in place, per the template): it recorded that a UNIQUE-index alternative "only becomes sound after OG-32 lands". OG-32 is now closed, so that condition is met — and the option is still declined. Replace-at-the-writer remains correct because it also handles a *changed* pass, which a uniqueness key cannot: a unique key prevents a duplicate row but leaves the stale one behind, whereas the scoped DELETE converges on the current pass either way. Decision 31 itself is otherwise unchanged.

```text
VERDICT: RESOLVED - the Engine 2D verdict carries its decisive partner (product id, plus variant id for a variant-keyed partner), populated only for REJECT; migration 015 relaxes the partner CHECK to chk_build_rejection_partner_variant_requires_product so a product-keyed partner (id, NULL) is storable, which 014 CHECKed against. The validator mirrors it and still refuses an orphan variant. Migration applied on both DBs (schema_migrations 15, old constraint gone). Headless runs of the real filter confirm partner and reason come from the same pair and track bucket order. Harness 43/0 (was 37/0) with a durable partner-column pin and residue 0; unit suite 898/0 (was 896). Assembly, scoring, ranking, retention and guard 2 untouched.
```
## Decision 33 - motherboard memory support becomes an explicit table; presence-only tables gain an explicit status (OG-02 + OG-03)

Status: RESOLVED 2026-10-05; IMPLEMENTED 2026-10-05 - motherboard_memory_support (migration 016) is the source of truth for a board that has rows, the legacy single memory_type_id is the fallback for a board that has none, and the three presence-only compatibility tables gain a nullable support_status whose NULL preserves the presence-only meaning byte-for-byte.

Date: 2026-10-05. Scope: closes OG-02 and OG-03 (docs/OPEN_GAPS.md, see C-32/C-33). It IS a schema migration (016), a data seed (012 backfill), an Engine 2D context-bucket addition (motherboard_memory) and a Rule 7 resolver change (new-table-wins / legacy-fallback). It is NOT a change to any other rule, to Engine 3/4/5/6, or to the Decision 1 asymmetric absence policy for the presence-only tables.

### Current situation

* motherboard_spec.memory_type_id is a single NOT NULL FK to memory_type (004_hardware_tables.sql:133). Rule 7 (compatibility/memory.js, Decision 2) FAILs any RAM whose memory_type_id differs from that one column, so a dual-DDR4/DDR5 LGA1700 board is unrepresentable and a matching RAM kit is falsely REJECTed (OG-02).
* case_motherboard_form_factor, case_radiator_support and platform_memory_support have no status column; absence of a row is the only negative signal, softened by the Decision 1 asymmetric policy (OG-03). The resolvers already read an OPTIONAL support_status and treat a missing/null status exactly like a presence-only row (case-radiator.js, memory.js). The context loader already carries support_status for every compat row it loads (normalizeCompatRow).

### Problem

OG-02 makes the engine factually wrong on real hardware: boards that accept both memory technologies exist, and the schema forces a false rejection of half of the RAM pool for them. OG-03 leaves researched negative evidence (a vendor documenting that a form factor or memory type is NOT supported) unstorable, so it can only be expressed by omitting a row - which then reads as UNKNOWN, not FAIL.

### Decision

1. New table motherboard_memory_support (migration 016): motherboard_product_id x memory_type_id with support_status compatibility_status NOT NULL DEFAULT PASS, source_note, UNIQUE(board, type), an owner index, and chk_mms_status_not_unknown forbidding the UNKNOWN status on an explicit row (an explicit row IS evidence; an absence of rows is the only UNKNOWN this table expresses).
2. Resolution precedence for Rule 7 (Decision 33): rows in motherboard_memory_support are the SOURCE OF TRUTH for a board that has any - a RAM type matching a row is judged on that row's support_status; a RAM type matching no row is FAIL MOTHERBOARD_MEMORY_TYPE_UNSUPPORTED (positive exclusion evidence). A board with ZERO rows falls back to the legacy motherboard_spec.memory_type_id with the Decision 2 rule byte-identical (equal PASS, different FAIL MISMATCH, either-null UNKNOWN).
3. Seed 012 backfills one PASS row per existing board from the legacy column, so every seeded board is represented in the new table and the dual-memory case is from now on expressed ONLY by adding a second row. The legacy column is deliberately NOT dropped: 001-015 are replay-verified as a fixed set (C-30) and loaders/seeds still write it; it becomes denormalized legacy data for single-memory boards.
4. The three presence-only tables gain a nullable support_status compatibility_status column. NULL preserves the presence-only semantics exactly (row present = PASS, row absent = Decision 1 policy); a non-NULL value is honoured as explicit evidence by the existing resolvers without code change. No status is invented: the columns ship all-NULL and gain values only with research.
5. Engine 2D wiring: a new candidate-scoped motherboard_memory compat bucket in context-loader.js (MOTHERBOARD_MEMORY_SUPPORT_SQL, $1::uuid[] parameterized, deterministic ordering, appended LAST in CONTEXT_COMPAT_KEYS so pre-existing keys keep their canonical positions), and evaluateMotherboardMemoryPair passes the rows into resolveMotherboardRamMemoryType.

### Rejected alternatives

* Drop the legacy motherboard_spec.memory_type_id in the same migration. Rejected: it would break the 001-015 replay-verification contract (C-30 measured 015 as the last verified state), require touching every loader/seed that writes the column, and couple a data-model improvement to a destructive schema change. The denormalized-legacy approach keeps every existing verdict byte-identical (proven: 898/0 before the new tests, and PI-1 below).
* Nullable secondary memory_type_id column on motherboard_spec. Rejected: it cannot express per-type support status (FAIL/CONDITIONAL), cannot represent a board supporting three technologies, and duplicates the concept platform_memory_support already models at platform level.
* Table without a status column (pure presence like platform_memory_support). Rejected for the motherboard level: OG-03 is precisely the finding that presence-only storage cannot hold researched negative evidence, so the new table must not repeat the defect it sits beside.
* Forbidding UNKNOWN on the presence-only columns too. Rejected: an explicit row on the NEW table is research, so UNKNOWN there is meaningless and the CHECK is right; on the three legacy tables the column is nullable precisely because a row whose status was never researched must remain honest-NULL rather than a default PASS.

### Verdict for this pass

* Unit - PASS. Suite 898 -> 907, 0 failures. New pins: dual-memory board (DDR4+DDR5 rows) PASSes both types; rows-present/type-absent FAILs MOTHERBOARD_MEMORY_TYPE_UNSUPPORTED with the supported id list in evidence; an explicit FAIL row FAILs MISMATCH; CONDITIONAL row UNKNOWN (preserved); zero rows reproduce the Decision 2 tri-state exactly (PASS / MISMATCH / UNKNOWN); RAM type NULL with rows UNKNOWN; the legacy-only call shape (no rows argument) stays valid; a non-array rows argument throws; the loader test pins candidate-scoped loading of the new bucket with the unrelated board never queried.
* Behaviour-neutrality on the live catalog - by construction plus measurement: seed 012 gives every board one row equal to its legacy value, so table-wins and legacy-fallback agree on every seeded pair; the 898 pre-existing tests pass unchanged before the new pins were added; PI-1 (verify:pi1) reported 0 moved scores after the change.
* Schema - migration 016 applied first to the TEST branch then to the shared DB via the OG-14 ledger runner; seed 012 applied idempotently (re-run 0 rows). verify-migrations-replay replays 001-016 into a scratch database with zero drift.
* Gates - verify-docs decision counts bumped (31 global headings / 37 Status lines), gen:decisions re-run, AGENTS.md range updated, gap register OG-02/OG-03 closed with C-32/C-33, SCHEMA_REFERENCE regenerated (schema-digest moved with the new table/columns).

### Honest limitations

* The legacy column and the new table CAN now disagree (a board re-typed on one side only). The resolution rule makes the table win, and seed 012 synced them at apply time; there is no standing consistency gate between the two - the natural follow-up is a check script if spec-data edits ever touch motherboard memory again.
* Dual-memory boards do not exist in the seed catalog yet, so the new-tables-win branch is exercised by tests and fixtures only until the first real LGA1700 dual-DDR board is ingested. The engine change is live but currently unreachable through live data - the same shape as OG-10 between Decision 30 and OG-36, which is why the fallback branch was pinned byte-identical rather than assumed.
* Presence-only support_status columns ship all-NULL; no existing verdict can change until researched statuses are written.

```text
VERDICT: RESOLVED - motherboard_memory_support (016) is the source of truth where present, legacy memory_type_id is the fallback otherwise, seed 012 syncs both, and the three presence-only tables gained nullable support_status columns honoured by the existing resolvers. Unit 907/0 (was 898), behaviour-neutral on the seeded catalog (PI-1: 0 scores moved), migration applied on both databases and replay-verified through 016.
```
## Decision 34 — offer identity (natural key), offer provenance and the manual-import ingestion path (OG-06)

Status: RESOLVED 2026-10-06; IMPLEMENTED 2026-10-06 — `store_offer` gains a natural key and provenance columns (migration 017), ingestion is a reusable impure edge under `src/recommendation/ingestion/`, and the only shipped adapter is the operator-supplied manual file. No scraping. Migration 017 is now applied on BOTH the TEST branch and the shared DB (ledger = 17 on each; verified 2026-10-06), so OG-06 is CLOSED — see the `### UPDATE 2026-10-06` block at the end of this entry.

Date: 2026-10-06. Prompted by the F8 real-offer ingestion work (`docs/PIPELINE_DESIGN.md`). It closes the DESIGN of OG-06 (offer identity) and records that the F8 pipeline exists in code, while explicitly NOT closing OG-06 (the shared DB still has no unique key) or OG-19/OG-21 (untouched). Documentation + schema + code, no seed and no data change on the shared DB.

### Current situation

`store_offer` has had NO unique key since `010_reconcile_layer3.sql` dropped `uq_store_offer_store_product_variant`; a re-observed price therefore could only INSERT a second offer (seed 002's header documents this). Measured on the shared DB 2026-10-06: 101 offers, 101 with NULL `product_url`, 79 with NULL `product_variant_id`, 2 stores, 100 products, and ZERO duplicates by `(store_id, product_id, product_variant_id)`. Migration `007_provenance_tables.sql` already defines `ingestion_record`, `product_candidate`, `retailer_listing_alias` and `spec_provenance` (all 0 rows) — the whole staging/provenance flow exists and was unused. `product.lifecycle_status` already exists and the candidate loader already filters `ACTIVE`.

### Problem

Without a key, ingestion cannot distinguish "the same offer re-observed" from "a new offer", so prices cannot be updated safely and `price_history` cannot be appended on change only. Manual imports also need a documented, repeatable, idempotent path that never lets an unverified listing silently become a canonical product. Secondary: the beta launch runs on seed data only, so the pipeline must not create any incentive to re-stamp seed offers, and the freshness gate must be able to tell seed offers from verified ones.

### Decision

1. **Offer identity.** `store_offer.listing_identifier TEXT` carries the retailer-side stable id (site SKU, or the canonicalised listing URL). Uniqueness is `UNIQUE (store_id, listing_identifier) WHERE listing_identifier IS NOT NULL`, scoped per store.
2. **Legacy/seed identity.** Legacy rows (NULL `listing_identifier`) keep a one-offer-per-variant-per-store cap via `UNIQUE (store_id, product_id, product_variant_id) NULLS NOT DISTINCT WHERE listing_identifier IS NULL`. The partial predicate is deliberate: ingested offers are NOT covered, so a real store may hold more than one listing for the same variant without a constraint error. PostgreSQL >= 15 is required; the shared server and the TEST branch both report 18.6.
3. **Promotion conflict policy.** Promotion looks up `(store_id, listing_identifier)`, then INSERTs or UPDATEs. A second listing for the same variant is allowed (distinct `listing_identifier`); the engine's Stage 1 already selects the cheapest eligible offer per candidate. A constraint error is never the mechanism.
4. **Provenance.** `product_url` is reused as the source URL (no second URL column). `store_offer.fetched_at` is the real fetch time and is deliberately NOT merged with `last_checked_at` (seed 006 re-stamps `last_checked_at` without a fetch). `ingestion_record_id` is nullable on BOTH `store_offer` and `price_history`. NULL provenance means seed/unverified, never an error; `fetched_at` alone is never evidence of verification. Provenance confidence for manual imports is `UNVERIFIED`; the operator's `source_note` records where/when the row was collected.
5. **`price_history` append rule.** A row is appended if and only if the stored `price` or `availability` actually changes. An unchanged re-run appends nothing.
6. **Staging reuse.** Ingestion reuses migration 007's tables. Unmatched or ambiguous listings go to `product_candidate` with status `REVIEW`; they NEVER auto-create a `product` or a `store_offer`.
7. **Adapters.** The adapter interface is `parse(text, {format}) -> {rows, errors}` (the `fetchListings()` seam with the network replaced by a file). The ONLY shipped adapter is `manual` (operator CSV/JSON). No scraper is built, and retailer sites are not contacted. Dry-run is the CLI default; `--commit` is required to write, and a commit against the shared `DATABASE_URL` additionally requires `--confirm-shared`.
8. **Seed handling unchanged.** No seed product, price or assessment is changed; no retirement or identity correction yet. The hybrid retirement strategy in `docs/PIPELINE_DESIGN.md` section 7 remains a later, gated change.

### Rejected alternatives

- **A single key on `(store_id, product_variant_id)` for everything** — rejected: it would forbid a legitimate second listing and would force seed rows through a key they cannot supply.
- **Reusing `product_url` as the key** — rejected: all 101 seed rows have NULL `product_url`, and NULLs are not a usable key.
- **A `listing_identifier` unique without `store_id`** — rejected: two stores may legitimately carry the same retailer SKU.
- **ON CONFLICT for provenance** — rejected: `spec_provenance.target_column` may be NULL and NULLs are not a conflict target in Postgres, so a scoped DELETE-then-INSERT (Decision 31's replace pattern) is used instead.
- **Scraping a retailer now** — rejected on terms grounds: `iris.ma`'s CGV Article 11 prohibits reproduction, `ultrapc.ma`'s terms could not be located, `pcbuilder.ma` is a direct competitor, and `nextlevelpc.ma` returns 403 on `/robots.txt`.

### Verdict for this pass

Migration `017_offer_identity_and_provenance.sql` authored and applied to the TEST branch with the OG-14 ledger (`run-migrations --check --test-db` clean). On TEST: the two indexes exist, 101 offers carry a backfilled `fetched_at`, and a functional probe produced `23505` for a duplicate legacy row and for a duplicate `(store_id, listing_identifier)`, while a second listing for the same variant INSERTed — residue 0. End-to-end on TEST (fixtures only): commit inserted 2, a re-run inserted 0 (2 UNCHANGED), a price change updated 1 + appended exactly 1 `price_history` row, and a rejection file reported 4 rows with line numbers (`PRICE_NOT_POSITIVE`, `DUPLICATE_LISTING_IDENTIFIER`, `UNKNOWN_STORE`, `UNKNOWN_CURRENCY`); residue 0, `store_offer` back to 101. Engine still green on TEST (`test-orchestrator-full-run.js` 28 pass / 0 fail; `measure-orchestrator.js` criteria 1-2 MET). Unit suite 937 / 0 and `test:scripts` 89 / 0 on Node 24 and Node 22, 0 cancelled. **NOT done:** migration 017 is not applied to the shared DB (gated), so OG-06 is NOT closed.

### Supersedes / superseded by

None. This decision does not supersede Decision 7 (the 30-day Stage 1 window), which remains in force; changing that predicate is a separate decision.

### UPDATE 2026-10-06 — migration 017 applied to the SHARED database; OG-06 CLOSED

This entry's Status line gated the shared apply on "the keys are live on the shared DB and verified there". That apply was performed and independently re-measured, read-only, on BOTH databases:

- SHARED and TEST each report `schema_migrations` = **17**, with `017_offer_identity_and_provenance.sql` as the last applied filename, and `node scripts/run-migrations.js --check` reports "No pending migrations".
- `store_offer` carries all three new columns (`listing_identifier`, `fetched_at`, `ingestion_record_id`) and BOTH unique indexes (`uq_store_offer_listing`, `uq_store_offer_legacy_identity`) on each database, and still holds **101** rows — so the two index creations lost no data.
- Regenerating the generated docs for 017 (`docs/SCHEMA_REFERENCE.md` schema-digest + `docs/DATA_STATE.md` `schema_migrations`) is committed separately.

**OG-06 is therefore CLOSED** (`docs/OPEN_GAPS.md` → C-34). **The residual this entry always carried is NOT closed and is restated here rather than quietly dropped:** the *price-value* half — that the assessment-era prices are unverified against live retailers — remains a data-research obligation of the F8 ingestion pipeline, and this apply re-stamped or price-corrected **nothing**. Closing OG-06 closes the *key*, not the prices.

Per `docs/decisions/TEMPLATE.md`, the `Status:` line above was edited in place to drop its now-false "TEST branch ONLY / shared database has NOT had migration 017 applied" wording; the rest of the entry is unchanged. This block records the update rather than rewriting the entry.

## Decision 35 — a beta freshness exemption for seed offers, with the offer class snapshotted onto the build (OG-30 residual, OG-21)

Status: RESOLVED 2026-10-06; IMPLEMENTED 2026-10-06 on the TEST branch and 2026-10-07 on the shared DB (migration 018 applied to both; ledger = 18 on each) — Stage 1 gains an explicit, default-OFF `allow_unverified_seed_offers` option that waives Decision 7's 30-day window for SEED offers only, every eligible offer now carries its provenance class (`SEED_UNVERIFIED` | `VERIFIED`) plus its offer id on the Engine 3 price carrier, and `build_component` SNAPSHOTS that class and the offer id so a permalink stays labelled after the offer changes.

Date: 2026-10-06. Prompted by the beta-launch risk recorded in `docs/PIPELINE_DESIGN.md` section 13: the 101 seed offers expire out of the Decision 7 window on **2026-11-03** and nothing re-stamps them, so a beta running on seed data fails loud after that date. This decision implements that section's proposal. It is NOT a change to Decision 7's window for VERIFIED offers, NOT a source/retailer project (no scraper, no ToS work, no CLI or CI wiring), and NOT a re-stamp of any seed offer.

### Current situation

* Stage 1 hard-filters `o.last_checked_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'` (`src/recommendation/offers/select.js`, Decision 7), re-enforced in JS, and throws `EMPTY_CANDIDATE_POOL` when no candidate has an eligible offer. `budget_floor` is computed after Stage 1, so it never runs on that path.
* `node scripts/check-offer-freshness.js --fail-days=14` measured on the shared DB: **101 offers, 101 fresh, 0 expired, first expiry 2026-11-03 (28.1 days)**.
* Migration 017 (Decision 34) already supplies the provenance signal: `store_offer.ingestion_record_id` is NULL for every seed offer and non-NULL for an ingested one. `docs/PIPELINE_DESIGN.md` section 13 named this as the classifier and then explicitly stopped: "DESIGN ONLY — not implemented".
* `build_component` (migration 011) carries `selected_price` / `currency` / `store_id` / `price_checked_at` but no offer identity and no provenance; `build_component` was EMPTY (0 rows, measured 2026-10-06).

### Problem

A beta on seed data dies on 2026-11-03 unless something changes, and every obvious fix is worse than the disease: re-stamping seed offers to keep the gate green **hides that the prices are unverified** (and `docs/PIPELINE_DESIGN.md` section 13 rejects it outright), while extending the 30-day window for everything silently loosens the rule for REAL offers too. The third defect is quieter: even if a decision existed, nothing carried the offer's provenance out of Stage 1, so a persisted build could not say whether its price came from a verified listing or a seed fixture.

### Decision

1. **The class is DERIVED from provenance, not stored as a new offer column.** `ingestion_record_id IS NULL` is `SEED_UNVERIFIED`; non-NULL is `VERIFIED`. Migration 017 already carries the signal, so no `store_offer` column is added.
2. **The exemption is an explicit engine OPTION, default OFF.** `options.allow_unverified_seed_offers`, threaded unchanged through `runRecommendationFullRun(client, queryId, options)` → `runRecommendationSnapshot(client, queryId, options)` → `runRecommendation({ db, queryId, options })` → `selectOfferPrices(poolResult, db, options)`. An omitted or non-`true` options object leaves eligibility byte-identical to before.
3. **The SQL predicate gains `$3` and stays inert when false.** `AND (o.last_checked_at >= CURRENT_TIMESTAMP - INTERVAL '30 days' OR ($3 AND o.ingestion_record_id IS NULL))`; the parameter is always bound, so there is no second SQL text and no interpolation.
4. **The exemption waives the 30-day window ONLY, and only for SEED offers.** A missing or unparseable `last_checked_at` stays ineligible even with the option ON: `NULL` is UNKNOWN and must never be read as PASS (`AGENTS.md` section 8).
5. **VERIFIED offers keep Decision 7 exactly.** The option ON never rescues a stale verified offer, and never changes a fresh one's verdict.
6. **Every eligible offer carries `offer_id` and `offer_class` on the Engine 3 price carrier.** `assembly/prices.js` `PRICE_FIELDS` gains the pair, `validatePrices` validates it, and `select.js` fills it from the Stage 1 row — so the class reaches persistence without a second read of `store_offer`.
7. **`build_component` snapshots the class and the offer id (migration 018).** `offer_class TEXT NOT NULL DEFAULT 'SEED_UNVERIFIED'` with `chk_build_component_offer_class CHECK (offer_class IN ('SEED_UNVERIFIED','VERIFIED'))` — **TEXT + CHECK, deliberately not an enum**. Plus `store_offer_id UUID REFERENCES store_offer(id)`. Both are written inside the commit's single transaction, so a later `store_offer` UPDATE cannot relabel an already-persisted build. The build-level label is DERIVED from its components, never stored.
8. **The freshness gate reports the two classes separately and fails on the VERIFIED class only.** Seed offers never count toward "verified fresh"; a stale seed class is a loud WARN that names the option, never a PASS and never a gate failure.
9. **`store_offer_id` lands OG-21's column early** (`docs/OPEN_GAPS.md` OG-21 was class FUTURE, "snapshot columns suffice today"). The class is only auditable if it can be traced to the offer that produced it.
10. **Provenance confidence for manual imports stays `UNVERIFIED`** (Decision 34 item 4, unchanged). The ingest CLI and the manual-import e2e are still NOT wired into CI; `npm run test:unit` covers the pure logic.

### Rejected alternatives

* **Re-stamp the seed offers (re-apply seed 006) to keep the cliff away.** Rejected: it hides that the prices are unverified, and `docs/PIPELINE_DESIGN.md` section 13 already forbids it. Re-stamping remains the correct answer only for the *verified* class once real ingestion exists.
* **Raise the 30-day window for everything.** Rejected: it silently loosens Decision 7 for real offers, which is the one change this decision exists to avoid.
* **A new `store_offer.offer_class` column.** Rejected: the class is 100% derivable from `ingestion_record_id` (migration 017), so a stored copy is a second source of truth that can drift.
* **An `offer_class` enum type.** Rejected on the repo's own rule: `AGENTS.md` section 8 forbids destructively altering an enum, so a vocabulary expected to grow needs TEXT + CHECK.
* **Derive the label on read instead of persisting it.** Rejected: a later `store_offer` UPDATE (a seed row finally ingested) would silently relabel every historical permalink.
* **A boolean `unverified` on the carrier instead of a class string.** Rejected: a two-value boolean cannot grow a third provenance tier (e.g. a REVIEWED state) without another migration, and the class name is what a permalink prints.
* **Call the option from the CLI/CI.** Rejected for now: wiring the ingest path into CI is explicitly out of scope, and unit tests already cover the exemption with no DB.

### Verdict for this pass

* **Unit — PASS.** Suite 937 → **950, 0 failures**. New pins: option OFF leaves a stale seed offer expired and the SQL parameter `$3` false; option ON keeps it and labels the carrier `SEED_UNVERIFIED` with the offer id; option ON does NOT rescue a stale `VERIFIED` offer; a fresh offer is labelled `VERIFIED`; option ON never excuses a null/unparseable `last_checked_at`; a non-object/falsy options argument means OFF; the carrier rejects a missing/non-UUID `offer_id` and an unknown `offer_class`; `validate-selected` mirrors all of it. Existing exact-shape fixtures were updated to the wider carrier (never relaxed): `assemble.test.js`, `prices.test.js`, `persist-ranked.test.js`, `validate-selected.test.js`, `select.test.js`, plus the two orchestrator arity/source pins that legitimately changed.
* **Behaviour, driven headlessly through the REAL 2B→2D path on the TEST branch** (temp probe, removed after the run; seed offers temporarily aged 40 days, every `last_checked_at` restored): **A** fresh + option OFF → pool 101, verdicts 87 PASS / 12 UNKNOWN / 2 REJECT, all 101 carrier entries `SEED_UNVERIFIED`, retained 40, `budget_floor.cheapest_total` 4477, `within_budget` true; **B** STALE + option OFF → throws `EMPTY_CANDIDATE_POOL` (Decision 7 unchanged); **C** STALE + option ON → identical to A, including `budget_floor`. Restore verified: 0 stale offers, 0 flipped `ingestion_record_id`.
* **Durable pin — PASS.** `scripts/test-orchestrator-commit.js` gained section 8 on the branch: a deliberately MIXED build persists `SEED_UNVERIFIED` and `VERIFIED` per component, `store_offer_id` stores the exact offer, flipping THAT source offer to verified does not relabel the persisted row, the offer is restored (non-null `ingestion_record_id` back to baseline 0), and cleanup residue is 0. Re-run: **51 pass / 0 fail** (was 43/0).
* **Gate — PASS.** `node scripts/check-offer-freshness.js --fail-days=14` now prints both classes (VERIFIED 0/0, SEED 101/0) and still exits 0; the `--fail-days 14` space form still exits 2; unit suite and `test:scripts` 89/0 are green on Node 22 and Node 24.
* **Schema — TEST ONLY.** Migration `018_build_component_offer_provenance.sql` applied to the TEST branch via the OG-14 ledger (`schema_migrations` = **18**, both columns + CHECK + FK index present, `build_component` still 0 rows). The **shared DB is deliberately still at 017**, so `verify:replay` reports fresh-18 vs live-17 drift **by design** until the shared apply — exactly the state 017 itself was in while it waited for shared.

### Honest limitations

* **The option is not persisted per query.** A permalink shows the label that was STORED at commit time, which is the point; a fresh re-run of the same query at a later date can label differently if the data changed, and no run-level record says which option was in force.
* **`SEED_UNVERIFIED` is a provenance label, not a verification.** The seed prices remain unverified against real retailers — that is OG-06's price-VALUE residual, unchanged by this decision.
* **The exemption is measured with artificially aged data.** On the live catalogs every seed offer is currently fresh, so the stale branch is exercised by the probe and by unit fixtures rather than by live data — the same "live but currently unreachable" shape Decision 33 recorded for dual-memory boards.
* **`store_offer_id` makes offer deletion FK-restricted.** No workflow deletes offers today (seed 006 only re-stamps), but a future cleanup that tries will be refused while a persisted build references the row — which is the intended provenance behaviour, recorded here so it is not discovered as a bug.

```text
VERDICT: RESOLVED - a default-OFF allow_unverified_seed_offers option waives Decision 7's 30-day window for SEED offers (ingestion_record_id IS NULL) only, every eligible offer carries offer_id + offer_class onto the price carrier, and migration 018 snapshots offer_class + store_offer_id onto build_component inside the commit transaction (TEXT + CHECK, no enum; OG-21's column landed early). VERIFIED offers keep Decision 7 unchanged; a null last_checked_at is never excused; the freshness gate reports both classes and fails on VERIFIED only. Measured: unit 937 -> 950/0; commit harness 43 -> 51/0 with a mixed-build + no-relabel pin and residue 0; real-path probe option OFF (stale) throws EMPTY_CANDIDATE_POOL while option ON returns the full 101-pool / 87-12-2 pass with budget_floor 4477; migration 018 is on TEST only (shared stays 017, so verify:replay is red by design until the gated apply).
```

### UPDATE 2026-10-07 — migration 018 applied to the shared database

The shared `DATABASE_URL` received `018_build_component_offer_provenance.sql`
from restore point `br-empty-poetry-axw9a07t` (ledger 17 -> 18; one `MIGRATED`
line, one audit line in `database/migration-applies.jsonl`). `offer_class`,
`store_offer_id`, `chk_build_component_offer_class` and
`idx_build_component_store_offer_id` are present on both databases and
`build_component` is still 0 rows. `npm run verify:replay` replayed 18 files
into an empty database with **0 drift** (columns 362/362, checks 78/78, fks
60/60, indexes 99/99), so the "fresh-18 vs live-17 by design" state recorded
above is resolved. OG-21 / C-35 now read shared-applied. The restore branch was
not deleted.

## Decision 36 — the HTTP API is a thin, engine-free surface over the existing barrels: TEST-DB-first, one read path for POST and GET, beta option pinned on

Status: RESOLVED 2026-10-07; IMPLEMENTED 2026-10-07 — a Fastify API under `apps/api/` serves four `/v1` routes over the UNCHANGED engine (no file in `src/recommendation/` was modified); it refuses the shared database unless `API_ALLOW_SHARED=1`, and it always runs with `allow_unverified_seed_offers: true` (not a request field). Binary: the API is a CLIENT of the engine, not part of it.

Date: 2026-10-07. Scope: the first process around the engine. This closes nothing in the gap register and changes no engine behavior, no schema and no seed — it is an additive surface whose contract is `docs/API.md`. It amends nothing in Decisions 17–22 (which own the pass) and nothing in Decision 27 (which owns `budget_floor`); it consumes both. It records the one thing a future contributor is most likely to get wrong: this API must never grow engine logic, and its two verbs must never become two implementations of one answer.

### Current situation

- `morocco-pc` had no process. The only entry points were the engine's public barrels (`src/recommendation/*/index.js`) and the `scripts/` CLIs; `package.json` carried `pg` and `dotenv` and nothing else, and there was no HTTP layer, no frontend and no authentication.
- `orchestrator/full-run.js` `runRecommendationFullRun(client, queryId, options)` is the whole pass: read snapshot → rank → diversity-select → explain → write commit. `options` reaches Stage 1 as the Decision 35 beta option `allow_unverified_seed_offers`, whose default is OFF.
- Every one of the 101 `store_offer` rows is a seed offer (`ingestion_record_id IS NULL`). With the option OFF, Stage 1 throws `EMPTY_CANDIDATE_POOL` once the 30-day window (Decision 7) lapses — the OG-30 cliff, re-armed every 30 days.
- Layer 4 carries `recommendation_profile`, `recommendation_query`, `build_candidate`, `build_component` and `recommendation_result` (migration 011). `build_component` carries `offer_class` and `store_offer_id` since migration 018 (Decision 35). **No seed inserts a `recommendation_profile`, and both databases hold zero profile rows.**
- Two facts the API has no column for: `budget_floor` is computed in memory (Decision 27, `retention/budget-floor.js`) and `recommendation_result` has no engine-version column (OG-18, ACCEPTABLE / OPEN).
- `recommendation_query.resolution` and `.priority` ARE read: `loadQueryInput` SELECTs both and returns them as Engine 2A siblings, retention consumes `resolution` (Decision 39's GPU spend multiplier, Decision 42's VRAM floor) and ranking consumes `priority` (`selectArchetypes`' strategy order, Decision 41). Only `recommendation_profile.default_resolution` is still read by nothing. **CORRECTED 2026-10-23:** this line originally read "…are read by NO non-test code — `query/load-query-input.js` does not even SELECT the first two (Decision 17.6)", which had been false since 2026-10-09. What survives is the measured consequence: neither field changes the result on the current catalog.
- `scoring_model` has one active row (`seed-minimal-v1/1.0.0`) whose `configuration.gpu_required_use_cases` is `["GAMING","WORKSTATION"]`.
- `AGENTS.md` section 1 said, until this decision, that the project is "NOT a running service: there is no HTTP server, no API layer".

### Problem

The engine could not be consumed by anything. That is a product gap, but the naive fix introduces four regressions that are each invisible until they bite:

1. **Engine logic leaking into the HTTP layer.** Once a route "just" re-orders components or recomputes a price, the pure engine tree loses its single owner and its unit tests stop protecting the contract.
2. **GET that re-runs the engine.** A read endpoint that recomputes would be expensive, nondeterministic across deployments, and would report a result the user never got — while looking correct.
3. **A response assembled from memory instead of from storage.** POST returning the engine's in-memory result would make POST and GET two implementations of the same answer, free to drift on every field.
4. **A first `npm run start:api` writing to the shared dev database.** The API is write-capable by construction (every POST persists Layer 4 rows) and the shared Neon database is NOT disposable.

A fifth, subtler problem: with the Decision 35 option defaulting to OFF, a beta API on an all-seed catalog would eventually return nothing at all, and the obvious "fix" — exposing the flag on the request — would let a client turn a safety rule off.

### Decision

1. **The API owns no engine logic.** `apps/api/src/engine.js` is the only module permitted to require `src/recommendation/**`, and only through stage barrels; `persistence/` (which has no barrel) is the one documented exception and is not currently used. `pg` is required only by `apps/api/src/db.js`. Both are enforced by `apps/api/test/unit/import-boundary.test.js`, which resolves every `require` under `apps/api/src`. **No engine file was changed by this work.**
2. **The API owns the pool and its own transactions.** One `pg` Pool (`db.js`, `statement_timeout` 10 s, `application_name` set). POST checks out ONE dedicated client: the API's own `BEGIN`/`COMMIT` for the profile+query pair, then the pass. The engine's read snapshot and write commit stay owned by their wrappers and are never nested inside an API transaction — an inner `COMMIT` would end the outer one.
3. **The write target is guarded.** The API resolves `TEST_DATABASE_URL` through `scripts/lib/db-url.js` `resolveTestDbUrl` (reused, not re-implemented, so the host comparison has one owner) and **refuses to start** otherwise; reaching `DATABASE_URL` requires the explicit `API_ALLOW_SHARED=1`. Guard messages never contain a URL, a host, or a credential.
4. **One read path.** POST re-reads the rows it just committed through the SAME statement GET uses, in the same request. POST and GET therefore cannot disagree about a persisted field. `budget_floor` and `engine_version` are pass-only facts with no column: POST carries them, **GET serves `null`**, and `served_by.engine_version` always names the deploy that answered. GET never re-runs the engine and never recomputes a floor — pinned with a spy, not by inspection. `404` means the query row itself is unknown; a known query with zero builds is `200` with `"builds": []`. **SUPERSEDED IN PART 2026-10-15 (Decision 46, migration 019):** the "no column" half is false now that `recommendation_query.budget_floor` and `recommendation_result.engine_version` exist, so "POST carries them, GET serves `null`" is no longer the contract — the two verbs differ on NO persisted field, and a NOT-RECORDED fact is `null` on BOTH. This item is left as the record of 2026-10-07; read the Decision 46 entry for current status. `served_by.engine_version` is unchanged: the deploy that ANSWERED, which is a different question from the deploy that RAN the pass.
5. **The beta option is pinned ON and is not a request field.** `engine.js` passes `{ allow_unverified_seed_offers: true }` always. A client must not be able to turn the freshness rule back on and get different results for the same body.
6. **`price_status` is derived, never stored.** `"verified"` only when EVERY persisted component of that build is `VERIFIED`; anything else, including an unrecognised class, is `"indicative"`. Fail-safe by direction: an unknown provenance is never advertised as confirmed. The French `disclaimer` restates it.
7. **One option vocabulary, derived where it can be.** `apps/api/src/meta.js` owns the lists AND the validator, so they cannot drift. `use_case` comes ONLY from the active scoring model's `configuration.gpu_required_use_cases` — no `DISTINCT` over submitted values and no second hardcoded list. `currency` is a fixed allow-list (`MAD`): Stage 1 matches currency by exact equality, so advertising an unpriceable currency would be a lie. An unreadable model is a **503**, never an empty array. Labels are French (the product is the Moroccan market).
8. **`resolution` and `priority` are accepted, persisted, and read — but neither changes a SCORE.** They are stored on the profile and the query row; `priority` sets the ORDER of the returned archetypes (`ranking/select-archetypes.js` `strategyOrder`, E4 / Decision 41) and `resolution` scales the GPU retention target (E2 / Decision 39) and gates the optional per-resolution VRAM floor (E5 / Decision 42), while Engine 4's arithmetic never sees either field. **CORRECTED 2026-10-23:** the original wording — "NOT used in scoring … because the engine does not read them (Decision 17.6)" — is false about the reads, and was never true after 2026-10-10. A frontend must not PROMISE a resolution- or priority-dependent result: on the current catalog both leave the observed top build unchanged (golden A4/A5 stay EXPECTED-RED with equal totals).
9. **The active scoring model is resolved by the API and pinned onto the query row** (eligible = `is_active`, ordered newest-first with an `id` tie-break so row order can never decide it). The engine still resolves the model by the pinned FK (Decision 11) — the API chooses the id, the engine does not discover one.
10. **Error contract:** 201 only when at least one build was produced; 200 for a valid zero-build pass and for `EMPTY_CANDIDATE_POOL` (which additionally carries `reason`); 422 validation and vocabulary (with per-field `details`); 413 oversized body; 404 unknown or malformed id; 429 rate limit; 503 no active model; 500 generic plus `request_id` with the detail log-only. Unknown body fields are REJECTED, not dropped (`additionalProperties: false` with ajv `removeAdditional: false`), and a numeric-string budget is rejected (`coerceTypes: false`) because the engine's loader takes a number.
11. **Operational limits:** 30/min/IP on POST (it runs a whole pass) and 120/min on GET; a 10 KB body limit; CORS from `ALLOWED_ORIGINS` where empty means CORS is DISABLED entirely rather than reflecting any origin; structured pino logs with a request id that never contain a request body or a database URL; the OpenAPI 3.0 document at `/v1/docs/json`.
12. **Dependency layout: root `package.json` + root lockfile, no nested `apps/api/package.json`.** Node resolves each `require` upward from the requiring file, so the engine's own `require('pg')` must land in one `node_modules`; a nested package.json would install a second copy and leave the engine pointed at the root anyway. The `Dockerfile` builds from the REPOSITORY ROOT context and copies `src`, `apps/api` and the one reused `scripts/lib/db-url.js`. Moving to npm workspaces is deferred until `apps/web` exists.
13. **Test placement follows what each suite needs.** `test:api` is DB-free (`fastify.inject` + stubs) and joins the push/PR job; `test:api:db` drives the real engine against the test branch and joins the recurring job. `test:api:db` runs through `apps/api/test/run-db-tests.js`, which **fails fast rather than skipping** when `TEST_DATABASE_URL` is missing or targets the shared database, and treats **zero executed tests as failure** — a skipped suite must never read as coverage.
14. **Migration 019 is proposed, not written.** It would persist `engine_version` on `recommendation_result` and `budget_floor` at query level, which is the only way GET could serve either. Until then both stay null on GET and this decision explicitly forbids recomputing them. The proposal is recorded here and in `docs/API.md`; OG-18 stays ACCEPTABLE / OPEN.

### Rejected alternatives

- **Recompute `budget_floor` (and derive `engine_version`) inside GET.** Rejected: GET would serve a number the pass never produced, from a catalog that has since changed, while looking authoritative. A `null` that means "not recorded" is honest; a recomputed value is not.
- **Return the engine's in-memory result from POST.** Rejected: it makes POST and GET two implementations of one answer, and it lets the API expose a value that was never persisted — the exact class of defect this repo has already paid for (OG-32's correct rows persisted while their ids stayed NULL).
- **Put the API inside `src/recommendation/api/`.** Rejected: `verify-docs` check 6 asserts a 12-stage engine layout of PURE modules; an HTTP edge there would make the purity rule unenforceable and the stage list wrong.
- **A nested `apps/api/package.json`.** Rejected: two copies of `pg`, with the engine's `require('pg')` still resolving to the root. The dependency layout is a consequence of CommonJS resolution, not a style choice.
- **Advertise currencies with `SELECT DISTINCT currency FROM store_offer`.** Rejected: Stage 1 matches currency by exact equality, so a currency the catalog is not priced in cannot produce a build; advertising it invites a guaranteed-empty request.
- **Derive `use_case` from previously submitted `recommendation_query` rows.** Rejected: it is self-referential (empty until the first POST succeeds) and it would let a bad request widen the accepted vocabulary.
- **Expose `allow_unverified_seed_offers` as a request field.** Rejected: it lets a client turn Decision 7's freshness rule back on, so identical bodies would return different results depending on an unadvertised flag.
- **Persist `price_status`.** Rejected: it is fully derivable from the persisted `offer_class` snapshot, so a stored copy is a second source of truth that can drift. Same reasoning migration 018 used to refuse a stored `offer_class` on a read path.
- **404 for a known query with zero builds.** Rejected: Decision 17.2 makes zero builds a VALID outcome, and conflating "unknown query" with "no builds" makes an explained empty result indistinguishable from a typo.
- **Add `@fastify/swagger-ui` to serve the document.** Rejected: not an approved dependency. `@fastify/swagger` v9 removed `exposeRoute`, so the document is served by a two-line route of our own at `/v1/docs/json`.
- **Make POST asynchronous now (202 + polling).** Rejected as premature: it is a real problem (item 3 of the verdict below) but it needs a job store and a status resource, and a synchronous contract is the smaller thing to get right first. Recorded as the next decision, not implemented.

### Verdict for this pass

- **Unit — PASS.** `npm run test:api` **38 pass / 0 fail / 0 cancelled**, exit 0, on the default Node 24.21.0 AND on `npx -y node@22` (the version CI pins). `test:unit` **950 / 0 / 0** and `test:scripts` **140 / 0 / 0** unchanged on both, which is the proof that no engine file moved.
- **End-to-end — PASS.** `npm run test:api:db` **1 pass / 0 fail**, exit 0, against the `TEST_DATABASE_URL` branch: a 20000 MAD GAMING POST returns 201 with real builds whose components are labelled from the persisted join (every one `SEED_UNVERIFIED`, so `price_status` is `indicative`); GET is byte-identical on every persisted build field and asserts `budget_floor` and `engine_version` are null while `served_by.engine_version` is the deploy; an engine spy proves **zero** engine calls on GET; a 1000 MAD pass is a 200 with `builds: []` and a `budget_floor` whose `within_budget` is false; `OFFICE` is a 422 against the real model; an unknown id is a 404; **residue is asserted 0** in the same run's `finally`.
- **Fail-fast guards — PASS.** `TEST_DATABASE_URL=` and `TEST_DATABASE_URL=DATABASE_URL` both exit 1 with a named message and no host or credential in it.
- **Production install — PASS.** `npm ci --omit=dev` in a clean temp tree (the image layout: `package*.json`, `src/`, `apps/api/` minus tests, `scripts/lib/db-url.js`): 75 packages, `pino-pretty` **absent** as intended, server started, `GET /v1/health` → `{status:"ok",db:"ok"}` against the real database, `GET /v1/meta/options` → 200 with the real model's vocabulary, `GET /v1/docs/json` → 200 (`openapi 3.0.3`, all four paths), unknown id → 404, and JSON (not pretty) logs.
- **CI — PASS (static).** `.github/workflows/ci.yml` parses (`npx -y js-yaml`), CRLF preserved, +11 lines: `test:api` in `unit-and-docs` (which now also needs the `npm ci` it never had, because the engine suites and the docs scripts have no dependencies and this step does), `test:api:db` in `recurring-gates` with both secrets.
- **Docs — PASS.** `npm run verify:docs --offline` and `--live` green (the counts in `scripts/verify-docs.js` moved 33→34 headings and 39→40 `Status:` lines for this entry, and `AGENTS.md` now cites "Decisions 1–36"); `npm run gen:decisions` regenerated `docs/DECISION_INDEX.md`; `docs/API.md` added; `docs/TEST_MAP.md`, `CONTEXT.md`, `AGENTS.md` (§1, §3 deps, §4 map, §6 commands, §9 sources) and the OG-18 register row updated in the same session.
- **Load — MEASURED, AND IT IS SLOW.** 50 sequential POSTs over real HTTP against the TEST branch: all 201, 150 builds persisted, **min 9 988.6 ms, p50 11 898.8 ms, p95 13 313.0 ms, max 14 425.5 ms (mean 11 905.3 ms)**, residue 0. **p95 is ~8.9× the 1.5 s threshold.**
- **Cause — MEASURED, not hypothesised.** One instrumented POST issues **74 SQL statements** and takes 10 893 ms ⇒ **~147 ms per round trip**. The cost is per-statement latency to the remote Neon instance multiplied by a sequential pipeline, not the HTTP layer (a stub-backed test takes milliseconds). Two consequences worth recording: (a) the honest next step for latency is a **202 + status-resource** design so the client is not held for 12 s, and the cheaper alternative — batching or parallelising the engine's reads — is ENGINE work (Decision 17's stage order is pinned by tests) and must not be smuggled into the API; (b) any future budget/memory claim about this API must quote these figures.
- **BLOCKED (environment).** No Docker on this box (`docker: command not found`), so **`apps/api/Dockerfile` was never built**. Its production install was proved by the clean `npm ci --omit=dev` run above instead — same dependency resolution, same `CMD` target — but image build, layer caching and the `node:alpine` runtime are UNVERIFIED.

### Honest limitations

- **`test:api:db` is wired but UNVERIFIED IN CI.** *(SUPERSEDED 2026-10-19, kept as the 2026-10-07 record: the claim is now false. `workflow_dispatch` run 39120485573 answered `9 passed / 0 failed` on a GitHub runner, and dispatch run 39207745723 on `master` completed with every `recurring-gates` step PASS - Platform P3 Sprint 1. The limitation that still holds is deployment, not CI: no CI run has ever exercised the API against a deployed origin.)* Everything checkable locally is green, but no `workflow_dispatch` run has executed it on GitHub; the scheduled job has never run at all (documented before this decision). Treat the CI result as unproven until a dispatch run passes.
- **CI pins Node 22 with no matrix.** Both API suites were verified locally on 22 and 24; only 22 runs in CI, so a Node-24-only regression would be invisible there.
- **GET loses two facts.** *(SUPERSEDED 2026-10-15, kept as the 2026-10-07 record: 019 and 020 are applied on BOTH databases, so this clause is false — GET re-reads and serves `budget_floor`, `engine_version` and `strategy_key`, and the two verbs differ on no persisted field. Decision 46, Sprint 5 UPDATE.)* `budget_floor` and `engine_version` are null on GET until migration 019 exists; a permalink therefore cannot show why a pass produced nothing, and cannot name the engine that produced it. `served_by.engine_version` names the deploy ANSWERING, which is not necessarily the deploy that RAN the pass.
- **No authentication, and rate limiting is the only abuse control.** There is no API key, no per-user quota and no Turnstile; the limits are per IP and in-process (they do not survive a multi-instance deploy).
- **The API adds rows the shared database must never receive.** A profile+query pair is written per POST and is NOT deleted on a failed pass (a zero-build outcome is legitimate and must remain readable), so a long-running beta against the TEST branch accumulates profile rows until something cleans them.
- **`test:api:db` asserts residue only for the rows the run records.** A row created by a crash between the query insert and the tracked response would not be caught by that assertion.

### Addendum (2026-10-07): production-mode requirements — database role, region facts, per-phase measurement

Recorded the same day, additive to items 3 and 11; changes no decision above and no code.

**1. Production database role (DESIGNED, not applied).** Before `API_ALLOW_SHARED=1` is ever used, the API must connect as a dedicated non-superuser role, not the project owner. The commit path's full write surface was verified from `orchestrator/commit.js`, `persistence/persist-ranked.js` and `persistence/persist-rejections.js`: INSERTs into `build_candidate`, `build_component`, `recommendation_result` and `build_rejection` (plus the API's own INSERTs into `recommendation_profile` and `recommendation_query`), two SELECT guards, and exactly ONE DELETE — Decision 31's replace-idempotence clearing `build_rejection` for the query before re-inserting. The role therefore gets SELECT on ALL tables (the whole catalog, `store_offer` included), INSERT on the six Layer 4 tables, DELETE on `build_rejection` ONLY, and nothing else — no UPDATE (none exists in the path), no CREATE on the schema, no sequence grants (ids are app-generated UUIDs). `ALTER DEFAULT PRIVILEGES` keeps future migrations' tables readable. A `check_function_bodies` restriction was considered and DROPPED: the API issues no functions, so it guards nothing. The full grant script, the `has_schema_privilege` / `has_table_privilege` / `pg_roles.rolsuper` / `pg_tables.tableowner` / `current_database()` self-check, and the TEST-branch rehearsal plan (apply the role on the branch, drive the whole POST path as the role, require zero `42501` and residue 0, then assert the self-check values) live in `docs/API.md` § Production mode.

**2. Region (facts only).** The Neon project hosting the shared `DATABASE_URL` is in us-east-2 (verified from the endpoint hostname, 2026-10-07). A Neon project's region cannot be changed in place; moving regions means creating a new project in the target region and loading the data into it — never a restore over the shared dev database. No other region/DR claim is made here because none is documented.

**3. Per-phase measurement (no engine edits).** New `scripts/measure-api-pass-phases.js` wraps `client.query` and patches ONLY the documented namespace seams (Decision 17/21's stub convention) to attribute every statement to a phase; all patches are restored in `finally`. Measured one API-shaped pass on the TEST branch (GAMING / 20000 MAD): 75 statements, 10 670 ms statement time in a 12 114 ms wall (≈142 ms/statement) — consistent with this decision's load verdict (74 statements / 10 893 ms, same cost model). Largest phases: `engine.commit` 37 stmts / 4 906 ms; `engine.load_filtering_context` 14 / 1 886; `engine.load_candidates` 9 / 1 235; the pure stages (filter, retention, budget floor, assembly, scoring, ranking, explanation) total ≈19 ms with zero statements. Reported overlaps are exclusively parent→child nesting (`engine.snapshot` → `engine.pass` → loaders); no sibling phase overlaps, confirming the pipeline is strictly sequential and the cost is per-statement round-trip latency, not compute. The script deletes its own Layer 4 rows (dependency order) and exits non-zero on cleanup failure.

**4. `test:api:db` hardened.** The DB-backed suite now (a) captures per-table row counts BEFORE the run and asserts residue against those counts AFTER cleanup (profile, query, result, build_candidate, build_component, build_rejection — before/after equality, not just zero at the end), (b) asserts the 422 zero-row case writes nothing (row counts unchanged for the tables the pass would touch), and (c) pins POST==GET with `assert.deepEqual` over the full response bodies rather than a field-by-field comparison. Additive assertions only; no existing assertion weakened.

### UPDATE 2026-10-15 — the use-case vocabulary reaches the API through `engine.js` (P2 Sprint 1, OG-38)

Item 7's "`apps/api/src/meta.js` owns the lists AND the validator" is now half
true, and the half that moved is the SOURCE:

- `apps/api/src/engine.js` (still the only module permitted to require
  `src/recommendation/**`) gained `useCaseVocabulary(configuration)`, which
  wraps the scoring barrel's `listUseCases` and returns NULL when the
  configuration declares neither `use_case_profiles` nor
  `gpu_required_use_cases`. NULL is UNKNOWN, never an empty list.
- `apps/api/src/meta.js` now receives the VALUES (a `string[]`) and owns only
  the French labels plus the validator, so `useCaseOptions`, `useCaseValues`,
  `buildOptions` and `isAllowedUseCase` all take an array.
- Both routes (`GET /v1/meta/options`, `POST /v1/recommendations`) derive once
  and answer 503 when the derivation is NULL. That also closes a latent gap:
  a model with an unusable configuration used to be served as 200 with an
  EMPTY `use_cases` array - the "form nobody can submit" case.
- `import-boundary.test.js`'s exact-barrel pin went from two barrels to three;
  it exists to force exactly this kind of deliberate change.

Measured on the TEST branch after re-applying seed 013 (`launch-v2@1.0.0`
active): the served vocabulary is GAMING / OFFICE / WORKSTATION and OFFICE is
accepted (201). With `seed-minimal-v1` active the vocabulary is unchanged.

### UPDATE 2026-10-17 — the per-IP half is conditional on `TRUST_PROXY` (Decision 49)

Item 11's "30/min/IP on POST and 120/min on GET" is only literally true when the proxy
is named in `TRUST_PROXY`; with the default (off) every caller behind a platform proxy
shares one bucket. Decision 49 records the variable's contract and why a hop count is
refused. No route, limit or response changed.

## Decision 37 — a scoring model owns its use-case policy and its use-case vocabulary (`use_case_profiles`)

Status: RESOLVED + IMPLEMENTED (2026-10-08) — `use_case_profiles` is an OPTIONAL scoring-model configuration key validated in `src/recommendation/scoring/configuration.js` / `scoring/use-cases.js`; `listUseCases(configuration)` is exported from the scoring barrel; the `launch-v2` seed is authored and rehearsed branch-first; activation on a live database is a coordinated step (OG-39).

Context
  OG-38 (2026-10-07) measured that the API derives its accepted use-case vocabulary from `configuration.gpu_required_use_cases` — the same list that makes the GPU mandatory — so OFFICE was rejected 422 and only GAMING / WORKSTATION were reachable. Vocabulary and GPU mandate were one field, so no policy could separate them, and `use_case` had no effect on any result below a single `Array.includes` test.

Decision
  1. A scoring model MAY declare `use_case_profiles`, keyed by use-case name. Per profile:
       `gpu_policy`            REQUIRED | IGPU_ALLOWED                 (required)
       `spend_targets`         { <component_role>: share of budget }   (required, each share in [0, 1])
       `role_weights`          per-role weight override                (optional)
       `archetype_objectives`  { <ARCHETYPE>: <number> }              (optional)
     Unknown profile fields, a missing required field, an out-of-vocabulary `gpu_policy`, or an out-of-range share fail fast with the exact nested path, in the existing Engine 2 error vocabulary.
  2. `use_case_profiles` is OPTIONAL. A model that omits it validates and loads byte-for-byte unchanged, so `seed-minimal-v1` remains reproducible — the key is added to `OPTIONAL_CONFIGURATION_KEYS`, never to the required vocabulary.
  3. The use-case VOCABULARY is `listUseCases(configuration)`: the `use_case_profiles` keys when declared, falling back to `gpu_required_use_cases` only for a legacy model that declares no profiles. The API's meta vocabulary consumes this accessor instead of `gpu_required_use_cases`; this is the acceptance that the vocabulary is decoupled.
  4. `gpu_required_use_cases` is retained unchanged (Decision 10 / Decision 11 Rule 8) as the Engine 3 GPU-mandate input and as the legacy vocabulary fallback. It is no longer the vocabulary SOURCE for a model that declares profiles.
  5. `gpu_policy`, `spend_targets` and `archetype_objectives` are HYPOTHESES pending human review (H3). They are validated structurally now and consumed by later epics (E2 retention, E3 pair quota, E4 archetypes, E5 resolution, E6 OFFICE); no scoring, retention, assembly or ranking behaviour changes in this decision.
  6. `spend_targets` values are NORMALISED RELATIVE WEIGHTS, not a partition (added 2026-10-08, E1b): they need NOT sum to 1 (the authored launch-v2 profiles sum to 0.97 GAMING / 0.98 WORKSTATION / 0.89 OFFICE, and that headroom is intentional) and a profile MAY declare only the roles its policy cares about. A consumer that needs a distribution normalises by the declared sum. The enforced invariants are therefore: each declared share is a finite number in [0, 1] (unchanged), and the declared sum is STRICTLY POSITIVE so normalisation is well-defined - an empty or all-zero `spend_targets` fails fast with `INVALID_FIELD_VALUE` at `<profile>.spend_targets`.

Data
  `database/seeds/013_scoring_model_launch_v2.sql` inserts `launch-v2` `1.0.0` as v1's exact configuration with `use_case_profiles` appended (`||`, so nothing else differs), then makes it the single active model with the v1 row retained but inactive. Rehearsed on the TEST branch inside a transaction that is rolled back: after the first apply exactly 1 active model (`launch-v2`), vocabulary `{GAMING, OFFICE, WORKSTATION}`; a second apply changed nothing (no duplicate row); `ROLLBACK` restored v1 active with no `launch-v2` row.

Out of scope (deliberately not done here)
  * Applying seed 013 to the shared or TEST database. Four harnesses pin `seed-minimal-v1 ... is_active = true` BY NAME (`scripts/measure-orchestrator.js`, `scripts/test-orchestrator-full-run.js`, `scripts/verify-pool-independence.js`, `scripts/measure-og01-reach.js`), so flipping the active model breaks their preflight until they are updated. Tracked as OG-39. **UPDATED 2026-10-09:** every comparison harness and the golden preflight now select the model by `name@version` (`scripts/lib/model-pin.js`, default `seed-minimal-v1@1.0.0`), so a two-active-model branch is measurable while an inactive model is still never executed - OG-39 CLOSED (C-36).
  * Consuming the new policy in assembly / retention / scoring — E2–E6.
  * `apps/api/src/meta.js` rewiring — Platform owns `apps/api/`; the scoring-barrel export is the interface.

Verification
  `npm run test:unit` = 964 pass / 0 fail (950 before; +12 in E1 from `use-cases.test.js`, +2 more in E1b for the `spend_targets` relative-weight invariants). `src/recommendation/scoring/use-cases.test.js` pins the profile contract, the vocabulary decoupling (OFFICE declared by the profiles while absent from `gpu_required_use_cases`), the optional-key integration (a model without profiles gains no key), and the legacy fallback. `scoring/index.test.js` and `configuration.test.js` were updated for the new export surface and the new require (no assertion was weakened). No engine pass, score, rank or persisted row changed: only new configuration is accepted, and nothing consumes it yet. Item 6 (2026-10-08, E1b) pins `spend_targets` as relative weights: `use-cases.test.js` asserts a sum != 1 and a partial profile are valid, and that an empty or all-zero map fails fast.
## Decision 38 — explicit asOf pins scoring and offer freshness without a migration

Status: RESOLVED 2026-10-08; IMPLEMENTED 2026-10-08 — optional options.asOf is an explicit run input; absent preserves the transaction-clock path, present pins scoring and offer freshness.

Date: 2026-10-08. E2-pre only, OG-42. No migration, seed activation, API change, retention change or E2/E3 implementation.

### Current situation

The orchestration scoring clock is `orchestrator/run.js`'s SQL `CURRENT_TIMESTAMP AS now`.
The offer loader independently uses SQL `CURRENT_TIMESTAMP` for `price_checked_at` and
its inclusive 30-day cutoff. `scoring/load-assessments.js` also emits `loaded_at`, but the
orchestrator does not use it as a scoring clock. Different runs therefore age assessments
at different instants; rounding can change ranks even with unchanged catalog data (OG-41).
The restricted Platform-owned candidate/filtering loaders and persistence need no changes
for explicit run-time pinning.

### Decision

1. `runRecommendation({ db, queryId, options: { asOf } })`,
   `runRecommendationSnapshot(client, queryId, options)` and
   `runRecommendationFullRun(client, queryId, options)` accept optional `options.asOf`.
   This extends the existing options interface, not a new positional argument or query column.
2. Absent/undefined asOf preserves the existing transaction-clock read and exact offer SQL
   and parameter list. Explicit asOf must be an ISO timestamp with an explicit timezone
   and at most millisecond precision; null, malformed, impossible-calendar or ambiguous
   local timestamps fail `INVALID_FIELD_VALUE` on `asOf`, without a wall-clock fallback.
   Offset timestamps normalize to UTC. No implicit truncation of greater precision.
3. Explicit asOf replaces the scoring clock for candidate/build/contribution decay and
   both offer SQL timestamp uses via a bound `$4::timestamptz`. The same returned timestamp
   drives JS freshness normalisation and price decision metadata. Seed-offer waiver policy,
   inclusivity of the 30-day boundary, deterministic tie-breaks and compatibility are unchanged.
4. Snapshot ownership is unchanged. Full-run and the golden harness use the existing
   REPEATABLE READ READ ONLY wrapper. Direct runRecommendation callers still own their
   snapshot; asOf does not create or change a transaction.
5. The golden manifest declares fixed `as_of = 2026-10-08T20:00:00.000Z`, passed as options.asOf
   to both read passes and full runs. The baseline header prints it; its date derives from
   this explicit input rather than report-generation wall time. Volatile freshness metadata
   stays outside the committed baseline. Assertions remain unchanged.
6. Persisting as_of on recommendation_query is a separate Platform-owned migration/request,
   not implemented here. Cache keys must include as_of, explicit model identity/configuration,
   engine/policy version/options and a catalog-data revision. Pinning time does not freeze
   mutable offers/assessments/compatibility/catalog data or provide historical snapshots.
7. Replaying an old asOf is a reproducibility input, not permission to advertise stale offers
   as currently purchasable. Current availability/freshness revalidation is a separate serving
   policy; do not mutate an existing query's time to refresh it.

### Rejected alternatives

- Updating only score time: offer eligibility and price decision metadata would still depend
  on the run clock and the result would not be reproducible at a freshness boundary.
- Patching Platform-owned loaders/persistence or adding a migration here: neither is needed
  for the explicit input; schema persistence belongs to Platform.
- Freezing JS Date globally, rewriting SQL through a client proxy, or mutating model staleness:
  those obscure the input contract or change scoring policy rather than expose its time input.
- Tolerance-only A8: a rounded ranking boundary can change selection despite tiny raw deltas.

### Verdict for this pass

Unit pins cover absent-option deep equality and identical SQL/params, malformed timestamps,
full-run forwarding, pinned scoring time and inclusive/exclusive freshness boundaries.
Read-only TEST comparison for S03/S06 at the manifest instant versus normal transaction time:
101 post-offer/filter candidates, 40 retained, 25 ranked; retained identities and ranked
signatures equal. Assessment ages differ slightly by elapsed wall time; this is expected
arithmetic, not an eligibility/signature deviation. Two full golden runs and mechanical
baseline comparison are reported in the E2-pre brief verification record.

### Supersedes / superseded by

Amends Decision 17's transaction-clock-only rule and Decision 7's run-current offer timestamp
ONLY when asOf is explicit. The no-option path remains unchanged. The E0d migration-first
proposal in the engine brief is superseded by this engine-only input plus Platform persistence
request; no historical migration or earlier dated verification is rewritten.

## Decision 39 — retention is target-aware: a profile's `spend_targets` choose which candidates survive each role (E2)

Status: RESOLVED 2026-10-09; IMPLEMENTED 2026-10-09 — the query loader carries `resolution` as a sibling of the Engine 2A input, a new pure `retention/targets.js` turns a profile's `spend_targets` + budget + resolution into per-role `{target, ceiling}`, and `retainTopKPerRole` accepts an optional `roleTargets` that switches a targeted role bucket from top-K to price-band retention while keeping the Decision 27 reservation, the K cap and the Rule 3/5 order. A model that declares no `use_case_profiles` passes `null` and stays byte-identical. The band constants are HYPOTHESES pending the H3 human review.

Date: 2026-10-09. E2 of `docs/briefs/engine.md`. It closes nothing in the gap register and registers **OG-43** for its own residual (unvalidated band constants; E2 is unexercised on the shared DB and by the API). It IS an engine behaviour change (retention, the query loader, the orchestrator wiring) plus a second committed golden baseline. It is NOT a migration, NOT a seed change (seed 013 is E1's, and it is applied to the TEST branch only), NOT a scoring/assembly/ranking/persistence change, NOT an API change, and NOT E3 (assembly-side pair quota) or E4–E6.

### Current situation

Retention (`src/recommendation/retention/retain.js`, Decision 12) kept the top
`candidate_caps.top_k_per_role` verdicts per role by Engine 4 candidate score, plus the
Decision 27 reservation of one cheapest eligible candidate per role. Nothing in the stage
read the query's budget or the model's spend policy, so retention was budget-BLIND above the
reservation. Measured on the TEST branch against the 100-product seed catalog,
`seed-minimal-v1` retains the IDENTICAL per-role set at 8000 / 12000 / 20000 / 30000 MAD
(`scripts/measure-retention-bands.js`, GAMING 1080p: 1 distinct set), so a 30000 MAD pass can
retain the same 3200 MAD GPU as an 8000 MAD pass while every GPU inside the target band loses
on score. Engine 2A's input contract (`candidates/input.js`) carries no resolution field, and
`loadQueryInput` did not select `resolution` at all (Decision 17.6).

### Decision

1. `loadQueryInput` selects `recommendation_query.resolution` and returns it VERBATIM as a
   SIBLING of `input` (`{ query_id, scoring_model_id, input, resolution }`), never inside the
   Engine 2A input: resolution is a retention input, not part of the Decision 10
   candidate-selection contract. `priority` and the profile FK stay unselected (E4).
2. A new pure module `src/recommendation/retention/targets.js` owns the arithmetic:
   `computeRoleTargets({ spendTargets, budgetAmount, resolution })` returns a deep-frozen
   `{ <role>: { target, ceiling } }` where `target = share x budget` and
   `ceiling = target x BAND_CEILING_FACTOR`. Only GPU is scaled by resolution
   (`RESOLUTION_MULTIPLIERS`: 1080p 1.0, 1440p 1.25, 2160p 1.5); null/absent resolution is
   neutral (1.0), while an unmapped non-null string fails `INVALID_FIELD_VALUE` on `resolution`
   rather than silently defaulting. Roles absent from `spendTargets` are absent from the map.
   No DB access, no clock, no randomness, caller objects never mutated.
3. `retainTopKPerRole({ ..., roleTargets })` gains an OPTIONAL argument. null/absent keeps the
   pre-E2 rule byte-for-byte. When present, a role that has a target partitions its eligible
   candidates into three price bands — below the target, at target
   (`|price - target| <= BAND_TOLERANCE x target`), above target (strictly over the tolerance,
   bounded by `ceiling`; a candidate priced above `ceiling` belongs to no band) — and retains
   the highest-scoring candidate in each band it can fill, then tops back up to K.
4. Both modes share ONE selection pipeline: the Decision 27 cheapest-per-role reservation, the
   Rule 2 eligibility (PASS | UNKNOWN), the Rule 3/5 ordering (score DESC then
   `compareCandidates`), the `min(K, eligible)` hard cap, and the Rule 3/5 output order. The
   band pass fills the `K - 1` slots the reservation does not own; the reservation then adds the
   cheapest eligible candidate and the top-up draws the remainder in Rule 3/5 order, so K can
   never be exceeded nor under-filled. A bucket no larger than K is returned whole and consults
   no price at all, in either mode.
5. `RESOLUTION_MULTIPLIERS`, `BAND_TOLERANCE` (0.15) and `BAND_CEILING_FACTOR` (2.0) are frozen
   code constants in `targets.js`, by the `MAX_PER_PAIR` / `TOP_N_PERSISTED` precedent: a
   per-model override would be a new optional configuration key plus a new seed. They are
   HYPOTHESES pending H3 (Decision 37 item 5), not measured facts.
6. `orchestrator/run.js` resolves the ACTIVE model's
   `use_case_profiles[input.use_case].spend_targets` and passes the map as `roleTargets`. A
   model that declares no `use_case_profiles`, a profile without `spend_targets`, and a use case
   the model does not declare all yield `null`, so that pass keeps the pre-E2 rule. A malformed
   share, a non-positive budget or a bad resolution fails fast rather than defaulting.

### Rejected alternatives

- Putting `resolution` inside the Engine 2A input: that contract is the Decision 10
  candidate-selection input owned by `candidates/input.js`, and no candidate-selection stage
  reads resolution — an inside-the-input field would change a contract with no consumer.
- A per-model `band_tolerance` / `ceiling_factor` / per-resolution multiplier configuration key:
  the values are unvalidated hypotheses, so shipping them as a configuration surface would
  invite a seed to encode a guess as policy before the H3 review. A code constant is the honest
  place for a hypothesis.
- Making the band pass REPLACE the Decision 27 reservation instead of sharing the pipeline: the
  reservation is the cheapest-per-role guarantee that stopped a rich catalog starving cheap
  builds (OG-26), and dropping it would regress that fix.
- Filling K by rank inside the target band only (no below/above bands): a single band turns
  retention into a budget filter that returns fewer candidates than K at small budgets, making
  the retained pool depend on how the shares were chosen rather than on which candidates exist.
- Normalising `spend_targets` to a partition before multiplying by the budget: Decision 37 item 6
  declares them relative weights, and a partition would move every target as soon as a profile
  declared only a subset of roles.

### Verdict for this pass

Unit: `npm run test:unit` = 994 pass / 0 fail / 0 cancelled (994 before the E2 test files were
counted as 970 + 24 new) on both Node 24.21.0 and Node 22.23.3, the version CI pins;
`npm run test:scripts` = 212 pass / 0 fail / 0 cancelled on both. The new pins are
`retention/targets.test.js` (10), 10 `retention/retain.test.js` cases, and 4 across
`orchestrator/run.test.js`, `retention/index.test.js` and `query/load-query-input.test.js`. They
cover the multiplier table and the null-neutral rule, GPU-only scaling, ceiling derivation, role
omission, freezing and purity, fail-fast inputs, the band partition, the shared pipeline (K cap,
reservation kept, Rule 3/5 order preserved, K=1 and K=2 smaller than the band count), a
profile-less model passing null, and `resolution` carried as a sibling.

Acceptance (TEST branch, `launch-v2@1.0.0`, GAMING 1080p, `scripts/measure-retention-bands.js`):
the retained sets at 8000 / 12000 / 20000 / 30000 MAD are 4 DISTINCT (RESULT: PASS), against
`seed-minimal-v1@1.0.0`, where the same script reports 1 distinct set and `roleTargets: null`
(RESULT: FAIL) — so the PASS is differential, not vacuous.

Primary regression guard: the v1 golden baseline regenerated after E2 is BYTE-IDENTICAL to the
committed `test/golden/baseline-2026-10.md` (`cmp` clean), 81 rows / 56 PASS / 22 EXPECTED-RED /
3 UNKNOWN, exit 0. The `launch-v2` baseline moved on exactly the rows E2 changes and is committed
as `test/golden/baseline-launch-v2-2026-10.md` (81 rows / 55 PASS / 23 EXPECTED-RED / 3 UNKNOWN,
exit 0, no approved assertion failed): A1 S03/S10/S11 rise 1 -> 2 distinct (CPU, GPU) pairs, A3
signature overlap S03 1 -> 0.36 and S04 1 -> 0, A2/A4/A5 totals move with the newly retained
cooler and GPU, and A1 S19 (OFFICE, no resolution) falls 3 -> 2 pairs. No threshold was tuned and
`test/golden/CHANGELOG.md` gains no row because no threshold changed.

### Supersedes / superseded by

Extends Decision 12 (retention) with a second mode; amends Decision 17.6's 'resolution is not
selected' for the retention input ONLY (resolution is still not part of the Engine 2A input);
consumes Decision 37's `use_case_profiles.spend_targets` while leaving its item 5 hypothesis list
and the pending H3 review untouched; leaves Decision 27's reservation, the K cap and the Rule 3/5
order intact. Registers OG-43. No historical document is rewritten.

## Decision 40 — the Engine 3 walk enforces the optional per-pair quota candidate_caps.max_builds_per_pair (E3)

Status: RESOLVED 2026-10-10; IMPLEMENTED 2026-10-10 — `validateScoringModelConfiguration` accepts the OPTIONAL
`candidate_caps.max_builds_per_pair` (valid iff a positive integer or absent; a DECLARED malformed value fails the
nested path in both validators, never silently defaults), `validateEngine3Input` accepts and carries it, and
`assembleBuilds` skips a GPU branch once its (CPU, GPU) pair already holds the quota and never emits a path whose
pair is full, so the `max_builds_per_query` halt is no longer spent on one pair. A model that declares no
`max_builds_per_pair` keeps the pre-E3 walk byte-identical.

Date: 2026-10-10. E3 of `docs/briefs/engine.md`. It answers Decision 25's cap-starvation diagnosis inside Engine 3
and consumes OG-43's "remaining work is E3" re-check trigger. It IS an engine behaviour change (the assembly walk
and both validators) plus golden runs against both model pins. It is NOT a migration, and NOT a shared-DB change:
seeds 014 / 015 / 016 (launch-v2 1.1.0 / 1.2.0 / 1.3.0) are TEST-branch only. It is NOT a scoring / retention /
ranking / persistence change, NOT an API change, and NOT E4.

### Current situation

Engine 3's DFS halted once `candidate_caps.max_builds_per_query` builds were held, with no pair dimension, so the
global cap bought pair diversity nothing: Decision 25 measured the walk spending its halt on one (CPU, GPU) pair
and concluded no MAX_PER_PAIR value could help while the halt stayed pair-blind. `candidate_caps` was a closed
two-key contract (`top_k_per_role`, `max_builds_per_query`), so a model configuration could not even state a
per-pair cap. After E1/E2, golden A1 (at least 3 distinct (CPU, GPU) pairs in the selected set) still had red rows
on `launch-v2` 1.0.0: the committed `baseline-launch-v2-2026-10.md` measures 23 EXPECTED-RED (55 PASS / 3 UNKNOWN)
and reports one distinct pair at S03/S05/S07 (OG-43).

### Problem

The diversity objective that E0 pins (A1) cannot be met by retention or scoring: it is the `assembleBuilds` walk
itself that stops after few pairs. Any fix at a later stage sees a smaller input pool, and lifting
`max_builds_per_query` alone trades the OG-26 starvation history for a latency regression the Platform has not
budgeted.

### Decision

1. `candidate_caps` stays a CLOSED contract but is declared with an OPTIONAL third key `max_builds_per_pair`:
   valid iff a positive integer, or absent. A DECLARED non-positive / non-integer value (including `null`) fails
   `INVALID_FIELD_VALUE` at the nested path in BOTH validators (`scoring/configuration.js`, `assembly/input.js`);
   absence is the default and adds no key to the validated output (the declared-absent contract).
2. Quota identity is the (CPU, GPU) product/variant pair, exactly the key the diverse-top selection pairs by, so
   the two stages cannot disagree about what "one pair" means.
3. `assembleBuilds` enforces the quota at GPU DEPTH: a GPU branch whose pair already holds the quota is skipped,
   and a path whose pair is full is never emitted, so the pair counts and the global `max_builds_per_query` halt
   both count EMITTED builds only. GPU branches are consumed in eligible-set order with no re-sort; the fixed
   code-unit tie-breaks are untouched, so determinism and reproducibility are unchanged in kind.
4. Below the quota, and when the key is absent, the walk is byte-identical to the pre-E3 rule (pinned
   fixture-level, and re-proven on the real 20-scenario harness: see the verdict).
5. The quota VALUE is a model decision, not an engine decision: seeds 014 / 015 / 016 add `launch-v2` 1.1.0 /
   1.2.0 / 1.3.0 (quota 2 / 3 / 1) ACTIVE on the TEST branch beside 1.0.0 (`seed-minimal-v1` and 1.0.0 untouched,
   shared DB untouched), each diverging from 1.0.0 only in the quota, so the name@version model pin (OG-39)
   selects which version a run measures. The measured hypotheses: quota 2 reaches 4-6 pairs at S03..S09; quota 1
   reaches 6+ at the halt of 25; quota 3 sits between. All three pins are HYPOTHESES pending the H3 review,
   recorded as the same class of unvalidated constant as OG-43.

### Rejected alternatives

- Raising `max_builds_per_query` instead of adding a pair dimension: changes a global budget the Platform sized
  from real measurements, buys diversity only where the DFS happens to wander, and re-exposes OG-26 starvation
  dynamics under a bigger cap. Rejected on the Decision 25 diagnosis itself.
- Making `max_builds_per_pair` REQUIRED: a required third key breaks every stored configuration that predates
  this decision (`seed-minimal-v1`, launch-v2 1.0.0) the moment a validator re-reads them; an OPTIONAL key keeps
  the reproducibility guarantee that pinned models replay unchanged.
- Enforcing the quota in ranking or selection instead of the walk: those stages see the assembled builds whose
  composition was already fixed; the pair spread must be decided while the DFS still has GPU branches to visit,
  which is Decision 25's original point.
- Freezing one quota value in code (the MAX_PER_PAIR enum precedent) rather than in a model key: the whole
  objective is that different use cases/models may want different diversity-vs-latency trades, so the value
  has to live next to the other candidate caps the model already declares.

### Verdict for this pass

Unit: `npm run test:unit` = 1002 pass / 0 fail / 0 cancelled on Node 24.21.0; the changed files re-run green on
Node 22.23.3 (CI parity, 149/149 with 0 cancelled). `npm run test:scripts` = 212/212; `npm run test:api` = 38/38;
`gen-decision-index --check` and `verify-docs --offline` clean. New pins: 5 assembly cases (absent = pre-E3 walk
under the same halt; quota 1 reaches 6 distinct pairs under the same halt; quota 2 caps every pair at 2 with 5
distinct pairs; deterministic Rule order per pair preserved; nested-path validation for 0 / -1 / 1.5 / "2" /
null), one input-contract pin, two configuration pins.

Golden (TEST branch, 20 scenarios): pinned `launch-v2@1.0.0`, the E3 engine reproduces the committed
`test/golden/baseline-launch-v2-2026-10.md` BYTE-IDENTICALLY (`cmp` clean after the two normalized timestamp
lines), proving the declared-absent contract on the real harness. Pinned `@1.1.0` (quota 2): 68 PASS / 10
EXPECTED-RED / 3 UNKNOWN, exit 0 — A1 green across S03..S09 (S03 5, S04 6, S05 6, S06 4, S07 6, S08 6, S09 6
pairs), so E3's A1 acceptance ("at least 3 distinct pairs at >= 12k MAD") is MET differentially, not vacuously.
The remaining 10 EXPECTED-RED rows are exactly E4-E7 epics (A3 workstation signature, A4 VRAM floor, A5
price-vs-performance archetypes, A6-S19 OFFICE/iGPU) and are not tuned. The measured scratch runs are committed
as `test/golden/_scratch-v1..v6.md` (v1 seed-minimal-v1 RED -> v2 launch-v2 1.0.0 RED -> v3/v4/v5 quota 2/3/1
GREEN -> v6 deterministic repro).

Migrations: `verify:replay --reference=test` = 0 drift (18 files, 362/362 columns, 78/78 checks, 60/60 FKs,
99/99 indexes). Pool independence: `verify:pi1` = PASS (GAMING 0/25 and OFFICE 0/25 pre-existing `build_score`
moved; one earlier same-session run reported a single 54.79 -> 54.78 false drift, the gate's known intermittent
mode; the paired re-run is the verdict). Seed idempotency: a real re-run of 014 / 015 / 016 through
`scripts/apply-seed.js` is a no-op with byte-identical stored configurations.

### Supersedes / superseded by

Answers Decision 25 (the pair-blind halt) without rewriting it; amends Decision 37's `candidate_caps` closed
shape with an OPTIONAL key and consumes OG-39's model pin; leaves Decision 27's reservation, Decision 39's
retention bands, and every scoring weight untouched. Registers **OG-44** (the quota values 1 / 2 / 3 are
unvalidated hypotheses, pending the same H3 review as OG-43's band constants; E3 is unexercised on the shared
DB and by the API). No historical document is rewritten.

## Decision 41 — archetype selection (selectArchetypes) replaces selectDiverseTop as the pre-persistence showcase (E4)

Status: RESOLVED 2026-10-10; IMPLEMENTED 2026-10-10 — pure, DB-free `selectArchetypes({ ranked, budget, priority })` returns up to THREE pair-distinct showcase builds (PERFORMANCE / BALANCED / VALUE, output order set by the query `priority`, `persisted_rank` contiguous 1..N in output order) and degrades honestly with `NO_*` reason codes instead of padding; `strategy_key` is RETURNED but not persisted (Platform migration 019 absent) and `archetype_objectives` remain unconsumed hypotheses. **UPDATED 2026-10-29 (Decision 58):** no longer true — the weights ARE consumed by a model that opts in with `apply_archetype_objectives: true` at a neutral priority (`launch-v2@2.1.0`); the priority cascade this line describes is unchanged.

Date: 2026-10-10. Scope: implements E4 of `docs/briefs/engine.md` and settles what the Decision 21 showcase selection is. Amends Decision 21's stage wiring without rewriting Decision 20 (pair identity) or Decision 25 (the halt diagnosis); Decision 40's per-pair quota is the assembly-side answer to Decision 25, this is the selection-side answer. NOT included: no migration (019 does not exist — `database/migrations/` ends at 018 — **SUPERSEDED 2026-10-15: 019 landed; see item 7's note**), no seed, no scoring change, no API change, no persistence change.

### Current situation

- The showcase set between `rankBuilds` and `explainSelection` was `selectDiverseTop` (Decision 20): a pair-capped walk (`MAX_PER_PAIR = 3`) over the FULL ranked list, whose spread is a function of the `max_builds_per_query` halt (Decision 25), not of any product notion of which builds to show. The API persists `priority` and no stage consumed it (OG-38's behavioral side).
- Engine 6 runs BEFORE Engine 5b in the full run, and both require final entry values: `explanation/explain.js` `validateEntry` requires `persisted_rank` to be a positive integer, and `persistence/validate-selected.js` requires it contiguous 1..N (the Decision 19/21 selected shape). `selectDiverseTop` assigned the ranks at selection time; Engine 5b only validates and reads them.
- Decision 37 authored the optional `archetype_objectives` profile key for later epics (E4 named explicitly); nothing consumed it at the start of this epic.
- The golden harness projects the selection into its A-assertions as `selected`; E0's A1 reads the (CPU, GPU) pair count of that set.

### Problem

A showcase set driven by a latency halt cannot express product intent (show the performance option, the balanced option, the value option), its diversity depends on how fast the walk filled its quota, and `priority` — one of the three fields the API accepts and persists — has no voice anywhere in the pipeline. Without a decided selection contract, each caller invents its own "which builds to show" heuristic and the persisted showcase stays an artifact of caps.

### Decision

1. `selectArchetypes({ ranked, budget, priority })` (`src/recommendation/ranking/select-archetypes.js`, exported from the ranking barrel beside `selectDiverseTop`) is THE showcase selection of the full run. `selectDiverseTop` is RETAINED unchanged (reproducibility, `measure-api-pass-phases.js`); no production code calls it anymore.
2. Strategies (frozen `STRATEGIES`): PERFORMANCE — highest `build_score` among entries with `total_price / budget.amount >= PERFORMANCE_FLOOR` (0.85, frozen code constant); BALANCED — highest `build_score` overall; VALUE — best `build_score / total_price`, ties to the CHEAPER build, then `signature` ASC. Within one strategy the scan is ranked order and ties keep the first match — deterministic, no clock, no randomness.
3. Output order by `priority`: 1–2 -> [VALUE, PERFORMANCE, BALANCED]; 3, `null`, `undefined` -> [BALANCED, PERFORMANCE, VALUE]; 4–5 -> [PERFORMANCE, BALANCED, VALUE]. A priority outside 1..5 is `INVALID_FIELD_VALUE` — never silently defaulted.
4. Pair-distinct across archetypes using the Decision 20 pair key (`cpu product_id | gpu variant-or-OMITTED`, the `select-diverse.js` identity): a claimed pair is never re-used, and fewer than three distinct pairs returns FEWER archetypes — never padding.
5. `reason_codes` is a frozen array of strings from `REASON_CODES` in output order — `EMPTY_RANKED` (the single code for an empty ranked list, not three) or `NO_PERFORMANCE_CANDIDATE` / `NO_BALANCED_CANDIDATE` / `NO_VALUE_CANDIDATE` for each degraded strategy — empty when all three archetypes are found. Every strategy has a listed member: a first draft omitted `NO_BALANCED_CANDIDATE` and pushed `undefined` (fixed in the review pass, see Verdict).
6. `persisted_rank` is contiguous 1..N in OUTPUT order (the Decision 20 contract), assigned BY THE SELECTION: Engine 6 validates it before the seam and Engine 5b re-validates it at the write, so it cannot be "assigned later" past either. A degraded strategy leaves no gap in the sequence.
7. `strategy_key` is RETURNED on every archetype and deliberately NOT persisted: `recommendation_result.strategy_key` requires Platform migration 019, which is not in the tree. Deferred with a binding re-check trigger — registered as **OG-45**. **SUPERSEDED IN PART 2026-10-15 (Decision 46, Sprints 3-4):** both halves are false as of today — `database/migrations/019_recommendation_pass_facts.sql` IS in the tree (the directory then ended at 019; it now ends at 020, applied on the TEST branch) and the column exists on the TEST branch, so the key IS persisted: `orchestrator/full-run.js` threads `passFacts.strategyKeys` to the commit and `persistence/persist-pass-facts.js` writes each key onto the rank it nominated, and the API read path serves `strategy_key` and `engine_version` per build on BOTH verbs. The item is left as the record of 2026-10-10; **OG-45** remains OPEN on ONE condition only — the column does not exist on the SHARED database, which is the shared-apply decision. This note also supersedes the `019 does not exist` clause in this entry's Date line above. **AMENDED AGAIN 2026-10-15 (Platform P0 Sprint 5):** the ONE condition that note left open is answered - 019 was applied to the SHARED database from restore point `br-damp-grass-axyri6yl`, so the column exists there and **OG-45 is CLOSED → C-39**; no condition remains. (It is not retro-edited; the sentence stands as the 2026-10-15 pre-apply record.)
8. The three strategy definitions, `PERFORMANCE_FLOOR = 0.85`, and Decision 37's `archetype_objectives` (which remains UNCONSUMED — the strategies are code constants, not profile-weighted) **UPDATED 2026-10-29 (Decision 58):** partially superseded — the weights are now consumed behind an opt-in flag at a neutral priority, and A10 is declared and approved (OG-46 → C-42); the VALUES themselves remain unreviewed. are HYPOTHESES pending the same H3 human review as OG-43 / OG-44; the golden manifest declares no A10 `archetype_strategies` assertion yet, so the harness never judges archetype output end-to-end. Registered as **OG-46**.
9. Full-run composition (Decision 21 amended at the stage level only): `runRecommendationFullRun` wires rankBuilds -> selectArchetypes -> explainSelection -> runRecommendationCommit; the returned `selected` is the explained E4 array, and the result also carries `archetypes` + `archetype_reason_codes` for pre-persistence observation. The golden harness consumes the same shape (`scripts/lib/scenario-eval.js` projects `selection.archetypes`, falling back to the legacy `selected` key), so A1's pair count is now measured over the archetypes (<= 3 by construction).

### Rejected alternatives

- Keeping `selectDiverseTop` as the showcase: its pair spread is halt-dependent (Decision 25's diagnosis), it has no strategy semantics, and `priority` has no voice; different caps cannot express "performance vs value".
- Leaving `persisted_rank: null` in the selection output "for Engine 5b to assign" (the E4 first draft): impossible as written — Engine 6 runs BEFORE Engine 5b and refuses a null rank, so every non-empty full run threw (proved in the review pass), and Engine 5b's contract is validate-and-read, never assign.
- Assigning the ranks by seam-mapping in `full-run.js` instead: leaves every other consumer of the selection holding unusable ranks and re-creates the defect at the next caller; the selection owns its output order (the Decision 20 precedent assigns at selection).
- Profile-weighted PERFORMANCE (`archetype_objectives`) now: no measured basis exists (Decision 37 validated the key structurally only); inventing weights would turn a hypothesis into shipped behavior. Deferred with the H3 review (OG-46).

### Verdict for this pass

Three seam defects were found and fixed while recording this decision (2026-10-10 adversarial review of the E4 wiring; each fix is pinned):
1. `REASON_CODES` lacked `NO_BALANCED_CANDIDATE`, so a degraded BALANCED pushed `undefined` into the documented "frozen array of strings" (probe: a two-entry priority-2 run returned `reason_codes: [null]` in JSON). Fixed at the vocabulary; barrel key-set pin extended; a degradation pin added.
2. The golden projection (`scripts/lib/scenario-eval.js`) fell back to a non-existent `selection.project` key for legacy `selectDiverseTop` results (`{ selected, dropped_count }` is the real shape) and silently projected an EMPTY selection, degrading A-assertions to UNKNOWN instead of measuring. Fixed to `selection.selected`; pinned.
3. `persisted_rank: null` on the archetypes broke `runRecommendationFullRun` on EVERY non-empty selection (probe: `explainSelection` throws `INVALID_FIELD_VALUE "selected[0].persisted_rank" must be a positive integer`; `full-run.test.js` hid it by stubbing Engine 6 with rank-carrying fixtures). This was LIVE IN THE API WRITE PATH (`apps/api/src/engine.js` calls the function). Fixed at the producer (item 6); pinned.

Tests: `npm run test:unit` = 1015 pass / 0 fail on Node 24.21.0 and on Node 22 (CI parity leg, 0 cancelled); `npm run test:scripts` = 212 pass / 0 fail. `scripts/test-orchestrator-full-run.js` on the TEST branch = 24 pass / 0 fail — the real snapshot -> rank -> selectArchetypes -> explain -> commit path: persisted rows land, the stored explanation matches Engine 6 text, the re-run guard refuses a second pass, cleanup residue 0. Golden harness (`--filter=S03`, TEST branch) exit 0 with cleanup residue 0. NOT run this pass (earlier recorded evidence stands, unrefreshed): the full 20-scenario golden sweep, `verify:pi1`, `verify:replay`, `test:api`.

### Supersedes / superseded by

Amends Decision 21's stage list (the showcase stage is `selectArchetypes`; the returned `selected` is the explained E4 array) without rewriting it; keeps Decision 20's pair identity and the `selectDiverseTop` module untouched; answers Decision 25 on the selection side (Decision 40 answers it on the assembly side). Registers **OG-45** (strategy_key persistence deferred pending Platform migration 019) and **OG-46** (no golden A10 coverage; archetype hypotheses pending H3). No historical document is rewritten.

## Decision 42 — the engine enforces the OPTIONAL per-resolution VRAM floor resolution_profiles.<resolution>.vram_floor_gb at Engine 3 GPU depth (E5)

Status: RESOLVED 2026-10-10; IMPLEMENTED 2026-10-10 (recorded 2026-10-13, after the docs-repair pass restored this log and the gap register) — a GPU candidate whose KNOWN chipset VRAM is below the active model's declared floor for the query's resolution is skipped at GPU depth; UNKNOWN VRAM or an undeclared resolution keeps the floor off entirely. **ACTIVE 2026-10-24:** `launch-v2@2.0.0` declares the reviewed floors (Decision 53), so the rule now skips below-floor GPUs on the served model and the A4 floor rows are green.

Date: 2026-10-10 implementation (the E5 session), recorded 2026-10-13. E5 Phase A of `docs/briefs/engine.md`: the roadmap clause "resolution ... enforces a configurable VRAM floor from `gpu_chipset.vram_capacity_gb`" (hypothesis values 1080p 8 / 1440p 12 / 2160p 16 GB, H3 review pending). Prompted by OG-38 — use_case / resolution / priority had no runtime effect — and it gives Decision 39's `resolution` sibling (carried by the query loader, never part of the Engine 2A input) its first engine effect. It extends Decision 40's OPTIONAL contract family to a second Engine 3 input field. NOT a migration, no seed, no compatibility-verdict change: the floor is a RECOMMENDATION-policy walk constraint, never a hardware compatibility verdict.

### Current situation

- `gpu_chipset.vram_capacity_gb` is INTEGER and nullable (`database/migrations/004_hardware_tables.sql` and the column re-declared with `CHECK (vram_capacity_gb > 0)` in `005_hardware_schema_corrections.sql`), reached via `gpu_board_spec.gpu_chipset_id` (NOT NULL). The Engine 3 input therefore never sees 0 for an unknown: `filtering/context-loader.js` `GPU_VARIANT_SPEC_SQL` LEFT JOINs `gpu_chipset` and `normalizeGpuSpec` carries `vram_capacity_gb ?? null`.
- No ACTIVE model declares `resolution_profiles` today (`seed-minimal-v1@1.0.0` and `launch-v2@1.0.0` on the TEST branch), so the shipped state is provably inert: every pass takes the pre-E5 walk.

### Problem

OG-38 stands: the API-persisted fields `use_case`, `resolution`, `priority` were inert (Decision 17.6, Decision 36 item 8), and the resolution dimension had no engine consumer at all. Implementing the E5 floor without a recorded contract would leave the boundary semantics — inclusive or strict, UNKNOWN handling, single owner — invented per caller; the same contract family Decision 40 had to pin for the pair quota.

### Decision

1. `resolution_profiles` is an OPTIONAL top-level scoring-model configuration key: a JSON object whose keys are non-blank resolution strings and whose values are CLOSED one-field profiles `{ vram_floor_gb: integer >= 1 }`. Validated in `scoring/configuration.js` (`validateResolutionProfiles`); a model without the key keeps its exact old shape; blank keys, unknown profile fields, a missing field or a non-integer / < 1 field fail fast. A DECLARED null profile is malformed, never a synonym for absent (Decision 40's quota semantics: declared means valid).
2. `vram_floor_gb` is an OPTIONAL Engine 3 top-level input field, present iff declared; a declared value must be an integer >= 1 and a DECLARED null is malformed. Validated in `assembly/input.js` and re-defended in `assembly/assemble.js` `readTraversalInputs` (the traversal entry can be reached directly).
3. `assembly/pipeline.js` receives the orchestrator-resolved floor and passes it as that OPTIONAL field; null or absent resolves to the field ABSENT, never to an explicit null.
4. Enforcement lives ONLY at Engine 3 GPU depth (`assembly/assemble.js` `belowVramFloor`, inside the DFS between the budget continue and Decision 40's pair-quota continue): a candidate is below-floor iff the filtering-context spec keyed `v:<product_variant_id>` exists AND `vram_capacity_gb` is a finite number strictly below the floor. A missing spec row or a NULL VRAM is UNKNOWN and NEVER excluded (Decision 12 Rule 2: PASS / UNKNOWN eligible, only a verified deficit excludes). A DECLARED floor additionally makes `filtering_context.specs` load-bearing, so a malformed (non-object) `specs` is refused at the boundary (`readTraversalInputs`) rather than silently disabling the floor - added 2026-10-14 after review, and scoped to a declared floor so the no-floor walk is unchanged; an individual absent spec row stays the UNKNOWN above. The boundary is inclusive: a GPU exactly at the floor is eligible.
5. The floor is RECOMMENDATION policy, not a compatibility verdict: no candidate REJECT, no `build_rejection` row, no reason code; below-floor GPU branches are skipped in the walk.
6. `orchestrator/run.js` `resolveVramFloorGb(configuration, queryInput)` routes `configuration.resolution_profiles[queryInput.resolution]`; an absent profiles object, an undeclared resolution, a non-conforming profile or a NULL query resolution yields null, which is the pre-E5 walk byte-identically. The shape checks here re-load-defend what `validateScoringModelConfiguration` already guarantees.
7. Determinism: no clock read, no randomness, no input mutation; identical DB state + query + model version yield identical walk sets. A model that declares nothing reproduces the pinned pre-E5 baseline byte-for-byte.

### Rejected alternatives

- Enforce it as a Layer-2 compatibility rule (an Engine 2 REJECT): a below-floor GPU is not incompatible — it assembles; this is query policy. It would also change the pinned verdict baseline (87 PASS / 12 UNKNOWN / 2 REJECT) without vendor-side evidence, contradicting Decision 12's verified-deficit-only exclusion.
- Hardcode per-resolution floors in engine code when the profile is absent: policy belongs to the model's declared vocabulary (Decision 37 family — the model owns its use-case and resolution vocabularies); a code default would silently bind every future model.
- Filter the GPU role in retention before assembly: it would give one constraint two owners and would re-excite the Decision 27 cheapest-per-role reservation against a filtered pool. The walk already disposes of partial paths cheaply.

### Verdict for this pass

Unit: 11 new pins — the assembly FIRE case, the inclusive boundary, UNKNOWN-is-never-below (NULL and missing spec), the absent-floor parity, the declared-null malformed input, the present-iff-declared round trip, and the `resolution_profiles` shape matrix (valid copy, absent-key preservation, 9 violations). `npm run test:unit` = 1026 pass / 0 fail on Node 24.21.0 and re-verified on Node 22 (CI parity, 0 cancelled) 2026-10-13. End-to-end (implementing session): the pinned `seed-minimal-v1@1.0.0` golden run reproduced the committed baseline byte-for-byte except the `as_of:` line (56 PASS / 22 EXPECTED-RED / 3 UNKNOWN, exit 0), plus `--filter=S06,S07,S09 --model=launch-v2@1.0.0` and a 24/24 real-DB full-run for the loader SQL. Re-verified this session: a fresh TEST-branch filtered golden run (S06/S09) exit 0, EXPECTED-RED only, cleanup residue 0. NOT run this pass (earlier recorded evidence stands, unrefreshed): `verify:pi1`, `verify:replay`, `test:api`, the full 20-scenario sweep. Registers **OG-47** (the rule is inert until a model declares `resolution_profiles`; the A4 floor values are hypotheses pending H3).

### Supersedes / superseded by

Amends Decision 39 (which records `resolution` as a query-loader sibling with no engine effect — E5 Phase A is that effect) and extends Decision 40's OPTIONAL-input pattern; Decision 37's `use_case_profiles` OPTIONAL-key validation is the shape precedent and is NOT modified. No historical document is rewritten.

## Decision 43 — the Engine 3 walk honours a DECLARED per-use-case GPU policy (`gpu_policy`) at GPU depth (E6)

Status: RESOLVED 2026-10-14; IMPLEMENTED 2026-10-14 (recorded 2026-10-14, after the code landed — it cited this number before the record existed, OG-48) — a scoring model whose `use_case_profiles[use_case].gpu_policy` is `IGPU_ALLOWED` makes the iGPU the GPU for that use case, so an iGPU CPU takes the omit path exclusively; `REQUIRED` forces the discrete GPU; a model that declares no profile keeps the legacy `gpu_required_use_cases` rule byte-identically. **The rule is UNREACHABLE on today's catalog**: its acceptance (A6) is not met and the OFFICE rank-1 CPU has no integrated GPU, so the declared policy correctly resolves to `REQUIRED`. **ACCEPTANCE MET 2026-10-24:** retention now narrows its CPU pool under a declared `IGPU_ALLOWED` (Decision 54), so GPU-less OFFICE builds exist and A6 is green at S17/S18/S19; OG-49 is closed.

Date: 2026-10-14. E6 of `docs/briefs/engine.md` ("OFFICE: GPU OPTIONAL with an iGPU CPU, low spend targets"). It consumes Decision 37's `use_case_profiles.gpu_policy` vocabulary and extends Decision 40 / Decision 42's OPTIONAL-input pattern to a third Engine 3 field. NOT a migration, no seed, no compatibility-verdict change, no retention change: the policy constrains the RECOMMENDATION walk only.

### Current situation

- Decision 37 gave a scoring model a declared `use_case_profiles` vocabulary, validated at load time by `scoring/use-cases.js` `validateUseCaseProfiles`, whose `gpu_policy` is a REQUIRED two-value field: `GPU_POLICIES = Object.freeze(['REQUIRED', 'IGPU_ALLOWED'])` (`scoring/use-cases.js:54`). Seed `013_scoring_model_launch_v2.sql` is the only declaring model — GAMING `REQUIRED` (line 53), WORKSTATION `REQUIRED` (line 62), OFFICE `IGPU_ALLOWED` (line 71) — and it is ACTIVE on the TEST branch only.
- Before this decision the field was inert: nothing read `gpu_policy`, so the GPU decision came only from the model's `gpu_required_use_cases` list plus the selected CPU's iGPU flag (`assembly/gpu-policy.js` legacy Rules 1–3), and an OFFICE pass therefore always picked a discrete GPU — the same class of inertness Decision 42 closed for `resolution` (OG-38's behavioural side).
- `assembly/gpu-policy.js` owns the decision, `assembly/assemble.js` owns the walk, `orchestrator/run.js` owns the configuration read, and `cpu_spec.integrated_gpu_present` (BOOLEAN, nullable) is the iGPU evidence: the TEST branch carries 18 CPUs, of which **6** are `true` (Ryzen 5 3400G, Ryzen 5 PRO 5655G, Ryzen 7 5700G, Ryzen 7 7700X, Ryzen 7 7800X3D, Ryzen 5 8600G), 12 are `false` and none is NULL (measured 2026-10-14).

### Problem

The API persists `use_case` and the model declares a per-use-case GPU policy, but no engine stage read it, so a model could not express "this use case does not need a discrete GPU" and an OFFICE recommendation always carried one. Without a recorded contract the boundary semantics would be invented per caller: whether a declared policy outranks the legacy list, what `IGPU_ALLOWED` means on a CPU with no iGPU, whether the omit path may be the ONLY path, and whether an undeclared policy must stay byte-identical to pre-E6.

### Decision

1. `gpu_policy` is an OPTIONAL Engine 3 top-level input field, present iff the active model declares a profile for the query's use case. Declared means valid: `assembly/input.js` (`ENGINE3_INPUT_FIELDS`, `OPTIONAL_ENGINE3_INPUT_FIELDS`, `GPU_POLICY_VALUES`) accepts only an exact `'REQUIRED' | 'IGPU_ALLOWED'` string and fails fast on anything else, including a declared null; `assembly/assemble.js` `validateEngine3Input` re-defends the same contract because the traversal entry can be reached directly.
2. Rule 0 in `assembly/gpu-policy.js` `resolveGpuRequirement` runs BEFORE the legacy rules: a declared `IGPU_ALLOWED` yields OPTIONAL exactly when the selected CPU's `integrated_gpu_present` is strictly `true` (`=== true`; `false`, `null` and absent all fall to REQUIRED), and a declared `REQUIRED` yields REQUIRED regardless of the iGPU flag. An absent policy falls through to the unchanged legacy Rules 1–3.
3. Enforcement lives ONLY at Engine 3 GPU depth (`assembly/assemble.js`): on a declared `IGPU_ALLOWED` with an iGPU CPU the discrete-GPU branches are skipped entirely and the omit path is the ONLY path (`skipDiscreteGpu`). There is deliberately NO "fall back to the discrete walk if the omit path builds nothing": omitting the GPU can only RELAX the walk (every picked role has a strictly positive `selected_price`, an absent partner contributes no pairwise FAIL, and `finishPath` has no required-role gate), so such a fallback could never fire and would only add a second owner to the constraint. The legacy Rule-2 OPTIONAL (no declared policy) keeps walking every eligible GPU verdict first and then the omit path — pre-E6, byte-identical.
4. The policy is RECOMMENDATION policy, not a compatibility verdict: no candidate REJECT, no `build_rejection` row, no reason code, no verdict-baseline change and no retention change.
5. `orchestrator/run.js` `resolveGpuPolicy(configuration, queryInput)` routes `configuration.use_case_profiles[input.use_case].gpu_policy` and returns null for a missing profiles object, a use case the model does not declare, a non-conforming profile, or a value outside the vocabulary; `assembly/pipeline.js` forwards it as an OPTIONAL field (omitted, never an explicit null).
6. Determinism: no clock read, no randomness, no input mutation; a model that declares nothing reproduces the pre-E6 walk, and the pinned v1 golden outputs are unchanged.

### Rejected alternatives

- Make `IGPU_ALLOWED` resolve to OPTIONAL even on a CPU with no integrated GPU: it would emit a GPU-less build with no graphics at all, and it would make the policy a function of the model alone rather than of the hardware actually in the build.
- Authorize the omit path ALONGSIDE the discrete walk (i.e. treat the declared policy like legacy Rule 2): the discrete branches would win the walk order and crowd the iGPU build out via the `max_builds_per_query` halt, which is precisely what makes a declared policy unobservable.
- Read the policy in retention and reserve a slot for an iGPU CPU: it would give one constraint two owners and re-excite the Decision 27 cheapest-per-role reservation against a filtered pool; the walk already disposes of partial paths cheaply. (Note this is also what the measured defect now needs — see the verdict — but it belongs to the retention/archetype epics, not here.)
- Treat a DECLARED null as "no policy": it would make a REQUIRED profile field silently optional at the boundary, the drift Decision 40's present-iff-declared rule exists to prevent.
- Copy the vocabulary from `scoring/use-cases.js` into `assembly/` without pinning it: the assembly stage carries a boundary pin against `../scoring`, so the two-string copy is deliberate and its parity is pinned by tests on both sides rather than left to drift.

### Verdict for this pass

Unit: the field contract (present-iff-declared round trip, declared-null malformed, non-vocabulary value malformed, unknown-field rejection at the nested path), the Rule 0 matrix (declared `IGPU_ALLOWED` beats the legacy REQUIRED list; `IGPU_ALLOWED` on a non-iGPU CPU stays REQUIRED for `false` / `null` / absent; declared `REQUIRED` beats an iGPU; no declared policy keeps the legacy rules), the boundary-local vocabulary-parity pins, the pipeline pass-through, and the assembly FIRE case with its iGPU hard-skip. `Decision 43` is cited in **22 places across 9 files** in `src/` (measured 2026-10-14). `npm run test:unit` = 1083 pass / 0 fail on Node 24.21.0 as measured here (1089 once Decision 44's six further pins land), re-verified 2026-10-14 on Node 22 with 0 cancelled. The implementing session recorded the full 20-scenario acceptance run in commit `e29ef72` (launch-v2@1.1.0, 81 rows: PASS 67 / EXPECTED-RED 11 / FAIL 0 / UNKNOWN 3, exit 0, residue 0).
End-to-end on the TEST branch, re-measured 2026-10-14 against `seed-minimal-v1@1.0.0` (declares nothing) and `launch-v2@1.0.0` (declares OFFICE `IGPU_ALLOWED`), filtered golden runs, both exit 0: S17 (OFFICE@4000) and S18 (OFFICE@6000) report `ranked_count 0` under BOTH pins — identical, so the declared policy changes nothing there (and those budgets sit below the cheapest assemblable build, 7677 MAD, i.e. the compatibility floor tracked as OG-40); S19 (OFFICE@10000) selects 3 builds under v1 (A1 3 pairs) and 2 under launch-v2 (A1 2, the retention effect), with A6 — the assertion that IS this epic's acceptance — never green.
**So E6's objective is NOT met, and this is the honest status: no GPU-less OFFICE build exists on the 100-product catalog.** The cause is upstream of E6 and was diagnosed by the implementing session: the OFFICE rank-1 CPU is `Seed AMD Ryzen 5 5500` (899 MAD), which has `integrated_gpu_present = false`, so the declared `IGPU_ALLOWED` correctly resolves to REQUIRED and the hard-skip never becomes reachable; the price bound fails independently too (S19 top 9946 MAD vs the 0.40 × S03 bound of 4738, ratio 0.8397). E6 therefore needs the OFFICE profile to retain or prefer an iGPU CPU (E2 `spend_targets` / E4 archetypes) before its own skip can fire. Registered as **OG-49**, which also records the escalation landmine: `test/golden/scenarios.json` still declares `current_epic: "E1"`, so S17/S18 stay UNKNOWN — but their `expect_builds_after` is `E6`, so ADVANCING `current_epic` to E6 or beyond turns those two rows into HARD FAIL and makes the golden gate exit 1 until an iGPU OFFICE build exists.
Recorded correction (not a re-litigation of an old banner): the repeated claim in Decisions 36/42 and in CONTEXT.md that a pinned v1 golden run "reproduces the committed baseline byte-for-byte" is imprecise for `test/golden/baseline-2026-10.md`. Measured 2026-10-14, that file's `selected` column reads 3 for every scenario where today's engine yields 1 — a consequence of Decision 41 replacing `selectDiverseTop`, i.e. drift that began after the file was generated on 2026-10-08. The live v1 reference is `test/golden/_scratch-v7-e6-v1-parity.md`, which the post-E7 run matches byte-for-byte except the `as_of:` line. Rebaselining a committed reference is a review-gated act and is deliberately NOT done here.
NOT run this pass: `verify:pi1`, `verify:replay`, `test:api`, and a fresh full-suite run at the launch-v2 pin (the implementing session's `e29ef72` evidence stands; the v1 pinned full suite WAS run this session — see Decision 44).

## Decision 44 — Engine 6 exposes STRUCTURED reason codes (`deriveReasons`) alongside the explanation string (E7)

Status: RESOLVED 2026-10-14; IMPLEMENTED 2026-10-14 — Engine 6 gains a second, ADDITIVE, machine-readable output: a pure `deriveReasons(...)` returning frozen `{ code, value }` records in a fixed `REASON_ORDER`, sharing ONE owner (`explanation/build-facts.js`) with the string formatter; the committed `explanation` string, the persisted shape and the orchestrator seam are unchanged, and there is NO new column and NO JSONB.

Date: 2026-10-14. E7 of `docs/briefs/engine.md` ("pure deriveReasons() emitting reason codes (no new JSONB column)"). It closes the numbering hole **OG-48** left: the engine cited Decision 43 for E6 before either record existed. NOT a migration, no seed, no API change, no persistence change, no engine-behaviour change.

### Current situation

- Engine 6 (`explanation/explain.js`, Decision 22) composes ONE deterministic prose string per selected build, and `persistence/persist-ranked.js` writes it into `recommendation_result.explanation`; `persistence/validate-selected.js` requires it non-empty. That string is the only machine-visible trace of WHY a build was selected, and it is prose.
- Three of the facts the string encodes were derived privately inside `explain.js`: `dominantContribution`, `biosRequirements` and `unknownRoles`.
- The API read path (`apps/api/src/repository.js`) rebuilds a response from `recommendation_result` + `build_candidate` + `build_component` + the `recommendation_query` row + the active model's configuration. `build_component` carries no per-component status, `compatibility_notes` and the Engine 4 `contributions` are never persisted at all, and `recommendation_result.strategy_key` does not exist (OG-45).

### Problem

A consumer that needs to sort, filter or render the reason for a recommendation must parse prose, and E7 as briefed ("no new JSONB column") is not implementable as a read-path derivation: only 3 of the 8 briefed codes are reconstructable from persisted rows. Without a recorded decision the boundary would be invented per caller — which codes, in what order, from which inputs, what an absent input means, where the function lives, and what it may not do.

### Decision

1. `src/recommendation/explanation/reasons.js` exports `deriveReasons(args)`, `REASON_CODES` and `REASON_ORDER`, re-exported by the Engine 6 barrel (`explanation/index.js`) by identity. `explanation/build-facts.js` is the SINGLE owner of the dominant / BIOS / UNKNOWN derivations and is consumed by BOTH `explain.js` and `reasons.js`; a second implementation of any of them is forbidden and pinned by test.
2. Eight codes in this frozen order: `STRATEGY` (the E4 archetype strategy key, verbatim), `BUDGET_USED_PCT` (`total_price / budget.amount * 100`, unrounded), `GPU_SHARE` (the GPU component's price over the build total — its share of the spend; `null` when the build carries no GPU role, because the iGPU path is an ANSWER, not a missing value), `DOMINANT_ROLE` (the role of the dominant Engine 4 contribution, first maximum on a tie — the same one the string names), `BIOS_UPDATE_REQUIRED` (the verbatim `min_bios_version` texts of the CONDITIONAL pair notes, de-duplicated, in EXPANSION_ORDER-then-note order), `UNKNOWN_SPEC` (the roles whose component status is UNKNOWN, in EXPANSION_ORDER), `INPUT_APPLIED` (`{ use_case, resolution, priority, gpu_policy }`) and `LIMITED_CATALOG` (the E4 selection reason codes, de-duplicated).
3. `deriveReasons` takes ONE argument object and requires only `build` and `budget`. Omitting any of `contributions` / `profile` / `inputs` / `strategy` / `catalogReasonCodes` OMITS its code rather than throwing or inventing a value: a value is never fabricated and an absent input is never an error. That is what lets one function serve both the engine seam (which holds every fact) and a read path (which holds three).
4. Every SUPPLIED input is validated fail-fast with the repo's error contract (`CandidateSelectionError` + `ERROR_CODES`, fielded paths): `build.components` non-empty, `build.total_price` a finite number > 0 (or a plain-decimal NUMERIC string), `budget` validated as `explain.js` validates it EXCEPT that a plain-decimal NUMERIC STRING is coerced with `Number()` — `recommendation_query.budget_amount`, `build_candidate.total_price` and `build_component.selected_price` are all NUMERIC and node-postgres returns NUMERIC as a STRING (verified on the TEST branch 2026-10-14: `1000.00::numeric` -> `"1000.00"`, while `3::integer` -> `3`), which is exactly why the repo's own loaders coerce the same way (`offers/select.js` `Number(row.price)`); every other string form (`'1e3'`, `' 1000'`, `'1,000.00'`, `''`, `'abc'`) and every non-number stay malformed; each contribution a finite `weight` and `effective_score` with a non-empty `role`, `strategy` inside E4's `STRATEGIES`, `catalogReasonCodes` inside E4's `REASON_CODES`, `inputs.use_case` required with `resolution` a string-or-null and `priority` an integer in [1, 5] or null, and a DECLARED `profile.gpu_policy` an exact `GPU_POLICIES` string (a declared null is malformed). An out-of-vocabulary value never passes through.
5. READ-PATH AVAILABILITY is a contract, not an accident: only `BUDGET_USED_PCT`, `GPU_SHARE` and `INPUT_APPLIED` are reconstructable from persisted rows; the other five need `contributions`, `compatibility_notes`, per-component status, `strategy_key` and E4's reason codes, none of which are persisted. The three were then exercised against the API's OWN read path on the TEST branch 2026-10-14 (`apps/api/src/repository.js` `readRecommendationResult`): the values it returns are NUMERIC STRINGS (`"4000.00"` / `"3000.00"` / `"1000.00"`) and all three codes derive from them, so the table is not a claim about a friendlier shape. One precision: the query row STORES `use_case`, `resolution` and `priority`, but the API's current `SELECT_QUERY_SQL` fetches only `use_case` and `budget_amount` - a caller wanting the other two adds them to its own SELECT. Therefore E7 adds NO column, NO JSONB and NO writer change, and the codes are deliberately NOT attached to the persisted `selected` entries. The table is pinned as executable assertions in `reasons.test.js`: a read-path-shaped build (flat `selected_price` as the NUMERIC string the driver actually returns, no status, no notes) yields exactly those three, frozen and deterministic, and never throws.
6. Both price shapes are accepted — the engine build's nested `price.selected_price` and the read path's flat `selected_price`. `componentsByRole` takes `{ requireStatus: false }`, so a missing per-component status degrades to "that code is omitted rather than malformed" — and `false` / `null` / absent is still NOT UNKNOWN (only the literal `'UNKNOWN'` is).
7. ROLE scope is `EXPANSION_ORDER`, the authoritative Engine 3 traversal order: a component carrying any other role contributes no BIOS version and no UNKNOWN entry. That is the string's long-standing boundary, now documented and pinned rather than left accidental.
8. Determinism and purity: no DB access, no SQL, no clock, no randomness, no `localeCompare`, no input mutation; the return value is a deeply frozen array of frozen records, and identical inputs yield deeply equal output.
9. Back-compat is total: the `explanation` string, the persisted rows, the persistence validators and `orchestrator/full-run.js` are unchanged, and the 13 pre-existing `explain.test.js` pins were not edited.

### Rejected alternatives

- Recompute all eight codes on the API read path from persisted rows: impossible for five of them (item 5) — `build_component` persists no status, `compatibility_notes` and `contributions` are never written at all, and `strategy_key` does not exist (OG-45).
- Add a `reasons` JSONB column to `recommendation_result` (or a reasons array to `build_candidate`): CONTEXT.md discourages new JSONB without justification; it would persist facts the engine already holds at the seam, duplicate the string's content in a second representation that can drift, and require a migration plus a writer change for a surface no caller reads yet.
- Re-derive dominance / BIOS / UNKNOWN privately inside `reasons.js`: a second implementation of a decided rule (Decision 22 items 4(c)–(e)) that could silently disagree with the committed prose. The derivations were EXTRACTED to `build-facts.js` instead, and `explain.js`'s own unmodified pins prove the refactor is behaviour-preserving.
- Follow the brief's positional signature `deriveReasons(build, contributions, profile, budget)`: it cannot express the four further inputs E4/E7 need and it invites argument-order mistakes; the sibling `explainSelection({ ... })` convention is followed instead.
- Emit string-formatted reasons ("BIOS >= 1.2.3 required"): it would make the codes unparseable for consumers and duplicate the prose surface the string already provides.
- Throw on a missing per-component status: the read path can never supply one, so that would make the function unusable exactly where E7 needs it.

### Verdict for this pass

Unit: **50 new pins** in `explanation/reasons.test.js` (per-code firing AND omission with exact values, tie order, the frozen/deep-frozen contract, determinism, no argument mutation, DB-freedom of both modules by source assertion, the read-path availability table, the out-of-order-role boundary, and every guard) plus the updated barrel identity test (3 pins); `explain.test.js` (13 pins) was NOT edited and still passes, which is the evidence that the `build-facts.js` extraction is byte-identical for the string. `npm run test:unit` = **1089 pass / 0 fail** on Node 24.21.0 and `npx -y node@22 --test "src/**/*.test.js"` = **1089 pass / 0 fail / 0 cancelled** (the Node-22 nested-test trap this repo records).
End-to-end, 2026-10-14 on the TEST branch: the full 20-scenario suite at the default pin `seed-minimal-v1@1.0.0` gives **81 rows / 56 PASS / 22 EXPECTED-RED / 3 UNKNOWN, `RESULT: EXPECTED-RED`, exit 0, cleanup residue 0**, and the generated `test/golden/_scratch-v8-e7-parity.md` is **byte-identical to `test/golden/_scratch-v7-e6-v1-parity.md` except the `as_of:` line** — the differential that proves E7 changes no engine output. Public-surface smoke test through the barrel: a read-path-shaped build yields exactly `BUDGET_USED_PCT 75`, `GPU_SHARE 0.4333...`, `INPUT_APPLIED`, deeply frozen, deterministic. `verify-docs --offline`, `gen-decision-index --check` and the gap-register shape tests are green, with the verify-docs counts (40/5/46 -> 42/5/48) and AGENTS.md's decision range bumped in the same pass. NOT run (no file they exercise changed): `test:scripts`, `test:api`, `test:api:db`, `verify:replay`, `verify:pi1`.
**Closes OG-48** — both E6's and E7's records now exist, so nothing in `src/` cites an unwritten decision.

### Supersedes / superseded by

Amends Decision 22 at the surface level only: items 2–4 (the fixed template, the dominance rule, the BIOS and UNKNOWN clauses) are UNCHANGED and their prose remains authoritative; E7 adds a parallel machine-readable output and makes the shared derivations a single owner. Decision 37's `GPU_POLICIES`, Decision 41's `STRATEGIES` / `REASON_CODES` and Decision 35's provenance vocabulary are consumed, not modified. Decision 43's recorded correction about the stale committed v1 baseline stands and is not re-litigated here. No historical document is rewritten.

## Decision 45 — the last three Decision 26 item B rules are ENFORCED: OG-11 and OG-12 REJECT, OG-09 flags UNKNOWN (E8)

Status: RESOLVED 2026-10-14; IMPLEMENTED 2026-10-14 — the three remaining DEFERRED Decision 26 item B rules leave DEFERRED: RAM `module_count` vs motherboard `dimm_slots` (OG-11) and RAM total capacity vs `max_memory_capacity_gb` (OG-12) resolve FAIL and REJECT the candidate, while cooler `max_tdp_watts` vs CPU `tdp_watts` (OG-09) resolves UNKNOWN and NEVER REJECTs; all five operands are now carried by the Engine 2D filtering context and BOTH topology sites register the new pairs, so the candidate filter and the assembly walk cannot diverge.

Date: 2026-10-14. E8 of `docs/briefs/engine.md` ("enforce OG-11 and OG-12 as HARD rules, OG-09 as a soft/CONDITIONAL rule"). It closes the three register rows Decision 26 item B (2026-09-28) explicitly deferred after OG-10 was lifted by Decision 30 (2026-10-05), and it flips `scripts/check-deferred-rules.js` from "latent" to enforced. NOT a migration, no seed, no API change, no new column, no new table: the five spec columns already exist in the schema and are read for the first time here.

### Current situation

- Six Layer-1 columns existed and were read by NOTHING in `src/` before this pass: `cpu_spec.tdp_watts`, `cooler_spec.max_tdp_watts`, `motherboard_spec.dimm_slots`, `motherboard_spec.max_memory_capacity_gb`, `ram_spec.module_count`, `ram_spec.capacity_per_module_gb`. `filtering/context-loader.js` did not even SELECT them, so no resolver could have used them.
- The structure to extend already existed: eight pair relationships in `filtering/filter.js` (`PAIR_EVALUATORS`, `ROLE_RELATIONSHIPS`), mirrored in `assembly/assemble.js` `PAIRWISE_CHECKS` for the Decision 16 DFS re-check; `compatibility/` resolvers returning PASS / FAIL / UNKNOWN; the candidate layer mapping FAIL -> REJECT; `compatibility/statuses.js` making CONDITIONAL a SOURCE status only (Decision 3b).
- `scripts/check-deferred-rules.js` measured all four rules in catalog and compatibility-reachable scope, and described OG-09/OG-11/OG-12 as "EXPLICITLY DEFERRED and UNENFORCED".
- Live measurements (2026-10-14, unchanged catalog): 0 violations in every scope; coverage `coolers TDP 9/10 | CPUs TDP 19/19 | RAM kits module data 7/7 | boards memory limits 7/8`. The one NULL cooler TDP is the Corsair Nautilus 240 RS ARGB (seed 009 wrote NULL because no vendor figure is published), and the one board with a NULL limit is "not measured" rather than a violation.
- Decision 30 and Decision 42 had each already widened this same loader for exactly this class of change (cooler `height_mm` + case clearance; `gpu_chipset.vram_capacity_gb`), which is the precedent for widening it again here.

### Problem

Three HARD safety rules the architecture has prescribed since it was written (`RECOMMENDATION_ENGINE_ARCHITECTURE.md` sections 5.3 and 6) were unenforced while the catalog happened to violate none of them. That is safe only by luck: the standing gate is the only thing standing between the engine and an unsafe persisted build, and it reported "0 violations" for rules no code ran, so an over-slot or over-capacity kit introduced by any future seed would have been assembled and persisted as compatible. `check-deferred-rules.js` described exactly this as "latent risk one seed away".

### Decision

1. Three new pure resolvers in `src/recommendation/compatibility/`, exported by the `compatibility/index.js` barrel:
   - `cooler-tdp.js` `resolveCoolerCpuTdp({ cooler_product_id, cpu_product_id, cooler_max_tdp_watts, cpu_tdp_watts })`;
   - `memory-slots.js` `resolveRamMotherboardSlots({ ram_product_id, motherboard_product_id, ram_module_count, motherboard_dimm_slots })`;
   - `memory-capacity.js` `resolveRamMotherboardCapacity({ ram_product_id, motherboard_product_id, ram_module_count, ram_capacity_per_module_gb, motherboard_max_memory_capacity_gb })`.
2. OG-11 and OG-12 are HARD. `module_count > dimm_slots` -> FAIL `RAM_SLOTS_EXCEEDED`; `module_count * capacity_per_module_gb > max_memory_capacity_gb` -> FAIL `RAM_CAPACITY_EXCEEDED`. The candidate layer maps each FAIL to REJECT, so the pair can never reach a persisted build. The capacity is DERIVED arithmetically (the schema carries no total column), following the GPU-dimension precedent rather than adding a stored column.
3. OG-09 is SOFT: `cooler_max_tdp_watts < cpu_tdp_watts` -> UNKNOWN `COOLER_TDP_INSUFFICIENT`, never FAIL. Vendor TDP ratings are marketing figures produced by different vendors under different assumptions, so an apparent shortfall is not the hardware incompatibility an over-slot kit is. The build survives and the shortfall stays visible.
4. UNKNOWN, not CONDITIONAL: `compatibility/statuses.js` (Decision 3b) admits only PASS / FAIL / UNKNOWN as FINAL statuses and resolves a CONDITIONAL source row to UNKNOWN with the condition preserved in evidence. This decision follows that contract instead of widening the final-status vocabulary for one rule, so `aggregateCompatibilityResults`, the candidate verdict vocabulary and `ranking/rank.js`'s `deriveStatus` are untouched.
5. A NULL operand is UNKNOWN in every one of the three rules, with its own reason code (`COOLER_TDP_UNKNOWN`, `RAM_SLOTS_UNKNOWN`, `RAM_CAPACITY_UNKNOWN`). NULL is never a PASS and never "unlimited": the unmeasured cooler is not an unlimited one, which is the exact failure class OG-34 hid. Every boundary is INCLUSIVE (`>=` / `<=`), so a cooler exactly at the CPU's TDP and a module count exactly equal to the slot count are both within spec.
6. Both topology sites register the three relationships. `filtering/filter.js` gains `cooler_tdp` (CPU <-> CPU_COOLER), `mb_memory_slots` and `mb_memory_capacity` (MOTHERBOARD <-> RAM); `assembly/assemble.js` gains the same three in `PAIRWISE_CHECKS` with the correct `partnerRole` (`CPU`, `MOTHERBOARD`, `MOTHERBOARD`) and `leftIsNew: false`, so the walk re-checks the identical predicates. They are APPENDED, so every pre-E8 relationship keeps its canonical precedence for reason and decisive-partner selection.
7. `filtering/context-loader.js` carries the six columns: `CPU_SPEC_SQL` + `cs.tdp_watts`; `COOLER_SPEC_SQL` + `cs.max_tdp_watts`; `MOTHERBOARD_SPEC_SQL` + `ms.dimm_slots, ms.max_memory_capacity_gb`; `RAM_SPEC_SQL` + `rs.module_count, rs.capacity_per_module_gb`, each projected through the existing `normalizeSpecForRole` shape with `?? null` (never a coerced 0). The change is additive; no existing key moved.
8. `scripts/check-deferred-rules.js` stops calling any of the four rules latent: its header, its runtime banner and its RESULT line now say all four are ENFORCED, so a non-zero violation count is a LIVE DATA DEFECT — a pair the engine rejects (OG-10/OG-11/OG-12) or surfaces as UNKNOWN (OG-09). The four SQL definitions and both scopes are unchanged; the gate is still the binding pre-merge re-check of Decision 26 item 11.
9. Enforcement is proven by FIRE tests, not by a zero count: `compatibility/cooler-tdp.test.js`, `memory-slots.test.js` and `memory-capacity.test.js` pin each resolver's tri-state and inclusive boundary; `filtering/filter.test.js` forces each violation through Engine 2D and asserts the REJECT plus its reason code, and asserts the SOFT rule yields UNKNOWN without rejecting; `assembly/assemble.test.js` forces the HARD pairs inside the walk and asserts the violating kit is never emitted, and proves the SOFT pair adds exactly one build-local UNKNOWN without pruning a branch.
10. The register rows OG-09, OG-11 and OG-12 close, and no "DEFERRED"/"latent" wording for these three rules is retained anywhere in the tree.

### Rejected alternatives

- Leave OG-09 as a HARD REJECT like its two siblings: it would reject builds on a comparison between two marketing figures produced under different assumptions, which is a false-negative machine. The brief's "soft/CONDITIONAL" instruction is what this decision implements.
- Introduce CONDITIONAL as a real final status so OG-09 can return it: it re-opens Decision 3b and propagates through `aggregateCompatibilityResults`, the candidate verdict vocabulary, `ranking/rank.js` `deriveStatus`, the persistence validator and the explanation text — a wide blast radius for one rule's benefit. UNKNOWN already means "this pair is not verified".
- Resolve under-spec as PASS with a note: it would hide the shortfall from the "N checked rules" surface the product copy needs, and a PASS cannot carry a reason code.
- File a Platform request and land the three rules inert: the engine has widened this exact loader for the same kind of spec-column addition twice already (Decision 30, Decision 42), and an inert rule has no acceptance — this would leave the last three HARD safety rules unenforced for a coordination reason.
- Add a stored `ram_spec.total_capacity_gb` column: the shape is arithmetic, and `docs/RECIPES/add-a-pair-evaluator.md` step 5 says derive what is arithmetic; a stored total would need a migration, a seed and a drift guard for a value two integers already determine.
- Register the new pairs in `filter.js` only: the recipe is explicit that a relationship registered in one site silently diverges between the candidate filter and the DFS, and `assembly/assemble.js` has an existing test asserting the walk's pairwise table stays in step.

### Verdict for this pass

Unit: `npm run test:unit` = **1121 pass / 0 fail** (1089 -> 1121, **32 new pins**) on Node 24.21.0, and `npx -y node@22 --test "src/**/*.test.js"` = **1121 pass / 0 fail / 0 cancelled**. The 19 pre-existing failures the change caused were ALL exact-shape fixture breakages in the files the repo's own lesson names (`filtering/context-loader.test.js`, `filter.test.js`, `integration.test.js`, `pipeline.test.js`, `assembly/assemble.test.js`) and every one was fixed by giving the fixture REAL data for the new columns — or, for the two genuinely empty-context fixtures, by updating the relationship-slot count the new pairs change from 6/8 to 9/11. No assertion was relaxed and no expectation was deleted. `npm run test:scripts` = 212 pass / 0 fail; `npm run test:api` = 38 pass / 0 fail.
Live gates on the TEST branch, 2026-10-14: `verify:replay -- --test-db` = 18 migrations replayed, **0 drift** (columns 362/362, checks 78/78, FKs 60/60, indexes 99/99); `verify:pi1` = **PASS** on the immediate re-run (0/25 drifted for GAMING and for OFFICE; the first run reported 2 OFFICE builds at 55.03 -> 55.02, the known intermittent mode the repo documents — both runs recorded, neither alone); `check-deferred-rules.js` = **PASS, 0 violations in every scope** under the new enforced wording.
Golden, TEST branch, `--no-volatile`: the 20-scenario suite at the default pin `seed-minimal-v1@1.0.0` gives **81 rows / 56 PASS / 22 EXPECTED-RED / 3 UNKNOWN, `RESULT: EXPECTED-RED`, exit 0, residue 0**, and `test/golden/_scratch-v9-e8-v1.md` is **byte-identical to `test/golden/_scratch-v7-e6-v1-parity.md` except the `as_of:` line** (`diff` exit 0 after normalising that one line). At the E3 pin `launch-v2@1.1.0`: **81 rows / 67 PASS / 11 EXPECTED-RED / 3 UNKNOWN, exit 0, residue 0** (`test/golden/_scratch-v9-e8-launch-v2-1.1.0.md`). E8 therefore moves NO golden row at either pin. `current_epic` was deliberately NOT advanced (OG-49's landmine: S17/S18 escalate to HARD FAIL once it reaches E6, and no GPU-less OFFICE build exists).
Catalog-level differential, read-only on the TEST branch: the Engine 2C-2D verdict set is **101 verdicts, 86 PASS / 13 UNKNOWN / 2 REJECT**, against the pre-E8 87/12/2. **Exactly ONE candidate flipped, and it is the correct one:** `Seed Corsair Nautilus 240 RS ARGB Black AIO` has `cooler_spec.max_tdp_watts = NULL`, so its `cooler_tdp` relationship is UNKNOWN and its verdict is now UNKNOWN `COOLER_TDP_UNKNOWN` instead of PASS. It remains ELIGIBLE (UNKNOWN is eligible in `assembleBuilds`), the other 100 verdicts are unchanged, and the v1 golden byte-identity proves the flip reaches no ranked or selected build on this catalog. Correction to this epic's own plan: its expectation that the 101-verdict baseline stays byte-identical is FALSE as stated — the candidate verdict set changes by exactly one, because the catalog genuinely lacks that one TDP, and that is the rule working rather than a regression.
**Closes OG-09, OG-11 and OG-12.** E8 is the last engine epic in the M2 roadmap; `docs/briefs/engine.md` records it as DONE, and the E1/E4/E5/E6/E7 cross-team residuals (OG-38, OG-45, OG-47, OG-49) are untouched by this decision.

### Supersedes / superseded by

Amends Decision 26 item B: its four-rule deferral is now fully lifted (OG-10 by Decision 30, the other three here), and item 11's binding re-check keeps pointing at `scripts/check-deferred-rules.js`, which now guards four ENFORCED rules rather than three latent ones. Decision 30's and Decision 42's loader-widening precedent is followed, not modified. The current-status prose is updated in place where it is a status section: the three register rows (plus the new C-38 closed row and the register's §5 / §7 summaries), `AGENTS.md` §10 (its "three HARD rules are still DEFERRED and UNENFORCED" block) and §6 (the `check-deferred-rules.js` command entry), and `CONTEXT.md`'s status sections and decision pointers. **`docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md` is deliberately NOT rewritten** — its dated `[DECISION 26, 2026-09-28 ...]` blocks are historical records of what the contract was before it landed, and Decision 30 left the same file's cooler-height block untouched for the same reason; `AGENTS.md` §10 is the current-status authority for these four rules. No dated banner anywhere is retro-edited.

## Decision 46 — a pass's own facts are persisted by an UPDATE-only writer fed by a caller-supplied `options.engineVersion` (Platform P0)

Status: RESOLVED 2026-10-14; PARTIALLY IMPLEMENTED 2026-10-14 (Engine 5b seam, migration 019, the API read path) — a pass persists the Decision 27 `budget_floor` on its `recommendation_query` row and `engine_version` / `strategy_key` on each `recommendation_result` row inside the ONE write transaction, through an UPDATE-only writer and an additive 5th argument on the commit wrapper; `019_recommendation_pass_facts.sql` IS in the tree and IS applied on BOTH databases (TEST on 2026-10-14, SHARED on 2026-10-15 from restore point `br-damp-grass-axyri6yl`; no pending migrations on either), the API wiring and the `docs/API.md` deltas ARE in the tree (Sprints 3-4: contract v1.1 for the pass facts, then v1.2 for product identity; both minors since superseded — v1.3 added request dedupe, v1.4 the presets ribbon — and the live snapshot is `apps/api/test/unit/openapi-v1.5.json` (v1.5 since P2 Sprint 3)), and migrations 019 AND 020 are both applied on BOTH databases (both ledgers at 20; `verify:replay` replays 20 files into an empty database at 0 drift), and the operator-run column-scoped GRANT for the `morocco_pc_api` role is no longer outstanding - it is APPLIED on the shared database (2026-10-19, restore point `br-ancient-cake-axh57vpj`, self-check 20/20, and the API's own smoke test ran green as the role); the engine version is an explicit caller OPTION — never an engine constant, never a `process.env` read.

Date: 2026-10-14. The Platform P0 plan (`PLAN_PLATFORM_P0.md`, decision id `manual/019/020`), Sprints 1-2. NOT a migration: no schema file is authored or applied here, so nothing this entry describes can persist until 019 adds the columns. No seed, no API change, no new table. It closes nothing by itself — OG-45 (`strategy_key` unpersisted) stays OPEN with its trigger intact, because that trigger is 019 landing, and it is deliberately not claimed closed on the strength of an engine-side seam that has nowhere to write yet.

**Ownership (2026-10-15).** This entry is the SINGLE AUTHORITATIVE STATEMENT of the pass-facts contract. `PLAN_PLATFORM_P0.md` owns the work breakdown and its execution records, and `src/recommendation/persistence/persist-pass-facts.js` header owns that module's own interface (its two statement constants, the `rank = index + 1` addressing, the length cross-check, the frozen statement-count return); both CITE this entry and no longer restate it. The operator-facing GRANT script is maintained in `docs/API.md` Production mode.

### Current situation

- The pass already COMPUTED the three facts and then discarded them. `orchestrator/run.js` returns `budget_floor` (Decision 27) and `ranking/select-archetypes.js` returns a `strategy_key` per archetype while its own header records that persisting it "needs Platform migration 019 ... which does NOT exist yet" (OG-45). `recommendation_query` had no `budget_floor` column and `recommendation_result` had neither `engine_version` nor `strategy_key` — the Layer 4 shapes are `recommendation_query` 9 columns and `recommendation_result` 6 (migration 011), and `database/migrations/` ended at 018 when this Sprint 1-2 record was written (019 landed in Sprint 3 — see the UPDATE block below).
- The write side already had the shape to extend. `orchestrator/commit.js` owns the one write transaction (Decision 19.1) and invokes `persistence/persist-ranked.js` and, since OG-04, `persistence/persist-rejections.js` on the SAME client inside it, returning the writer's own frozen result by reference (the Decision 19 seam). Two siblings established the pattern to follow: DML-only, parameterized-only, no transaction control, idempotent.
- The data already travels far enough. `explanation/explain.js`'s `composeExplanation` returns `{ ...entry, explanation }`, so the explained array handed to the commit as `selected` carries BOTH `strategy_key` and `persisted_rank` verbatim. Engine 6 needed no change, which resolved the plan's open question ("decide whether `strategy_key` survives `explainSelection`") to YES.
- The documented production role (`docs/API.md` §Production mode) holds `SELECT` + `INSERT` on the six Layer 4 tables plus `DELETE` on `build_rejection`, and **no `UPDATE` anywhere** — "none exists in the path" was true when it was written.
- `apps/api/src/engine.js` already threads one frozen options object into `orchestrator.runRecommendationFullRun`, and `full-run.js` already forwards `options` unchanged to the read wrapper (Decision 35) and read nothing out of it for itself. `options.asOf` (Decision 38) is the precedent for a run input travelling this way.

### Problem

Two defects, one silent.

1. **The facts are not durable, so GET cannot reproduce POST.** `budget_floor` is the entire point of Decision 27's "the emptiness is compatibility, not budget" story, and it lived only in the HTTP reply: a later GET of the same query could not return it, and no permalink could show which E4 strategy nominated a ranked row. OG-45 recorded the second half of this as `strategy_key` "returned but never persisted".
2. **The production role cannot write any of it.** An API deploy running as `morocco_pc_api` would fail the first `UPDATE` with `42501`, and that failure would surface only in production mode (P3) — the release step where a surprise is most expensive. The role's "no UPDATE" invariant is a safety property worth keeping, so the remedy has to be narrower than the problem.

`engine_version` then raised a third question the plan could not answer from the tree: WHO owns the version? `grep -rn "ENGINE_VERSION" src/` returns nothing. The only engine version in the repository is the API's `env.ENGINE_VERSION` (`apps/api/src/app.js`), which the plan explicitly ruled out using from the engine.

### Decision

1. **New writer `src/recommendation/persistence/persist-pass-facts.js`.** One parameterized `UPDATE recommendation_query SET budget_floor = $2 WHERE id = $1`, then one parameterized `UPDATE recommendation_result SET engine_version = $1, strategy_key = $2 WHERE recommendation_query_id = $3 AND rank = $4` per persisted rank, addressed by `rank = index + 1`. Migration 011's `uq_recommendation_result_query_rank (recommendation_query_id, rank)` makes the rank match hit at most one row.
2. **It is UPDATE-only, and that is the decision rather than an implementation detail.** Like its siblings it is DML-only (no `SELECT`, no `BEGIN`/`COMMIT`/`ROLLBACK`, no pool, no clock, parameterized only); unlike them it mints no id, generates no UUID and issues no `DELETE`, because the rows exist — `persistRanked` inserted them moments earlier in the same transaction. Idempotency is inherited from `UPDATE` itself rather than from Decision 31's replace step, which also sidesteps the NULL-distinct unique-index problem OG-32 documents for the (id, NULL) product-keyed rows.
3. **The seam is additive: `runRecommendationCommit(client, queryId, selected, rejections, passFacts)`.** `undefined` issues zero statements, so every pre-046 3/4-argument call site is byte-identical in behaviour. `null` (or any non-object) is refused with `INVALID_FIELD_VALUE`, field `passFacts`, BEFORE `BEGIN`, so a malformed call cannot even open a transaction. `null` is deliberately NOT a synonym for `undefined`: omitting the argument is what means "persist no facts".
4. **`passFacts` is fully specified, and "absent" is an error rather than a value.** Shaped `{ budgetFloor, engineVersion, strategyKeys }` with all three keys REQUIRED, `null` being how a caller says "this pass did not know". `budgetFloor` is a plain object or `null`, passed THROUGH to the driver unchanged, because node-postgres JSON-encodes a plain object parameter for `jsonb` and stringifying it would store a JSON string rather than an object. `engineVersion` is a non-blank string or `null`; `strategyKeys` is an array of non-blank strings or `null`. Validation precedes every statement, so a malformed diagnostic never reaches the database.
5. **Rank alignment is enforced where it can be and pinned where it cannot.** `persistPassFacts({ client, queryId, selected, passFacts })` refuses `strategyKeys.length !== selected.length`, naming both counts, before any statement: a short array would silently leave rows NULL and a long one would fire UPDATEs matching nothing, and neither is visible to a fake-client test. WHICH key belongs to WHICH rank cannot be checked without a `SELECT` (forbidden here), so it is pinned by `orchestrator/full-run.test.js` against the REAL writers and a recording fake client.
6. **The engine version is a caller-supplied OPTION: `options.engineVersion`.** `full-run.js` reads that one key and converts absence to `null`. There is NO engine-owned version constant and NO `process.env` read, asserted by a source check in `full-run.test.js`. The column answers "which deploy produced this row", a fact about the CALLER; absent persists SQL NULL, the honest encoding of "this caller did not say". The API's half — passing `app.engineVersion` down at the `app.engine.runFullRun` call site, which already passes `API_ENGINE_OPTIONS` — is Sprint 4 and is NOT in this revision.
7. **The production role gets COLUMN-scoped UPDATE grants, one per written column:** `GRANT UPDATE (budget_floor) ON recommendation_query TO morocco_pc_api` and `GRANT UPDATE (engine_version, strategy_key) ON recommendation_result TO morocco_pc_api`. Never a row-wide `UPDATE`, so `has_table_privilege(..., 'UPDATE')` stays `f` on both tables while `has_column_privilege(...)` is `t` for each of the three columns. Grants are an operator step, never a migration.
8. **Migration 019 adds three NULLABLE columns with no default and no backfill:** `recommendation_query.budget_floor jsonb`, `recommendation_result.engine_version text`, `recommendation_result.strategy_key text`. `NULL` means UNKNOWN — pre-019 rows are genuinely unknowable, so nothing is invented for them.
9. **The persisted floor is the SAME object the pass returns** (`snap.budget_floor`, by reference), so the row and the 200 reply cannot disagree about what the diagnostic said.
10. **A zero-build pass persists its floor.** That is the A1/A3 defect the plan names: the diagnostic exists precisely for the empty outcome. `persistRanked` writes nothing, the floor `UPDATE` still runs, and the result-row loop issues zero statements.
11. **If the writer fails, the whole pass rolls back.** It runs inside the commit wrapper's transaction, after `persistRanked`, so a pass can never commit builds whose provenance failed to write — the same reasoning OG-04 used for rejection reasons.

### Rejected alternatives

- **An engine-owned version constant** (`src/recommendation/version.js`, or a literal in `full-run.js`) — the option the plan initially leaned toward, rejected after reading the tree. It would be a second, hand-maintained version that drifts from the deploy; it needs a bump ritual this repository has no release process for (`package.json` is `0.1.0`, there are no tags); and it answers "which source revision" where the column asks "which deploy produced this row" — a different question. It would also make NULL unavailable to a caller that cannot know its version, converting an honest UNKNOWN into a confident lie.
- **Reading `process.env.ENGINE_VERSION` inside `full-run.js`** would put an impure edge in a module whose own boundary test forbids SQL, transaction control and the driver, against the repository's purity rule; and it would make the persisted value depend on whichever process ran the pass rather than on what the caller declared.
- **Defaulting an absent version to `'dev'`** (the API's own fallback for `served_by.engine_version`). `served_by` is what THIS process claims about itself and may be a placeholder; `engine_version` is written once into an immutable row and read back later, where a placeholder is permanent misinformation.
- **A new insert-only `recommendation_diagnostic` table** would split the floor from the query row it describes and create a fresh PK/UPSERT problem for re-commit handling; a column-scoped `GRANT` keeps the "no row-wide UPDATE" invariant provable instead of abandoning it.
- **A row-wide `GRANT UPDATE`.** The role's whole safety story is that it can only `INSERT` and `SELECT`; the writer needs exactly three columns, so granting one or two tables' worth of columns to reach them pays for a convenience the writer does not use.
- **Writing the facts in a SEPARATE transaction after the commit** would let a pass commit builds whose floor/engine/strategy provenance failed to write — the exact split Decision 19.1's single-transaction rule exists to prevent, and the one OG-04 already rejected for rejection reasons.
- **Deriving `strategy_key` inside the writer from `selected`** instead of passing a `strategyKeys` array would remove one desynchronisation class (the length check now catches it) but entrenches a second source of truth for the same data. Revisit if a third caller appears.
- **Adding the columns by editing a committed migration.** AGENTS.md §8: migrations are append-only, so 019 is a new file.
- **An `ON CONFLICT` key for idempotency** cannot fire while partner ids are NULL (OG-32), and `persistPassFacts` has no such problem to solve because `UPDATE` is already idempotent.
- **Hiding the fact writer behind `persistRanked`.** It has a different lifetime (INSERT once per row vs UPDATE an existing row) and validating `passFacts` is not validating `selected`; one writer per concern matches the existing convention (`persist-ranked`, `persist-rejections`, `persist-pass-facts`).

### Verdict for this pass

Unit (Sprints 1-2 only; migrations, grants and API wiring are NOT in this revision): `npm run test:unit` = **1149 pass / 0 fail / 0 cancelled** (1144 -> 1149, **5 new pins**) on Node 24.21.0, and `npx -y node@22 --test "src/**/*.test.js"` = **1149 pass / 0 fail / 0 cancelled** on the CI's pinned leg. Per-suite, each captured on its own exit status: `persistence/persist-pass-facts.test.js` **13/13** (new), `orchestrator/commit.test.js` **23/23**, `orchestrator/full-run.test.js` **14/14** (9 pre-existing + 5 new). `npm run test:api` = 38 pass / 0 fail; `npm run test:scripts` = 212 pass / 0 fail; `npm run verify:docs --offline` OK, including `decisions-parse` at 44 headings / 50 `Status:` lines.

The seam is proven at TWO levels on purpose, and the second is the one that matters: the forwarding tests stub the commit and show WHAT is threaded, while the acceptance tests stub ONLY the four read-side stages and leave `./commit`, `persist-ranked.js` and `persist-pass-facts.js` REAL against a recording fake client. That is what shows the floor `UPDATE` plus one result `UPDATE` per rank — with `rank = index + 1` and the archetype's own key — actually reach the statement stream, ordered after the `INSERT INTO recommendation_result` rows they describe and before `COMMIT`, and that a zero-build pass still records its floor while issuing zero result-row statements. A rule that merely "returns 0 violations" is indistinguishable from dead code, so each behaviour was forced rather than asserted.

**The DB assumption is measured, not assumed:** `SELECT $1::jsonb` with `{a:1}` round-trips to an object and a JS `null` becomes SQL NULL on the shared database (read-only probe, 2026-10-14), which is why the floor object is passed through rather than stringified.

**Corrected in the same session, in `PLAN_PLATFORM_P0.md`:** its Sprint 1 tests named an error code that does not exist (`CANDIDATE_SELECTION_ERROR` is not an `ERROR_CODES` member), asserted "returned ids" for a writer that mints none, omitted the `commit.test.js` exact-import pin its own gate requires, granted only one of the three columns, and treated the migration-020 slug suffix as collision-free across bases when it is not. That file's addendum records what was corrected and the findings still owed.

**NOT verified, and not claimed:** no migration exists, so `verify:replay`, `gen:schema` and any DB round-trip of these three columns were not run — there is nothing in the schema to write. `verify:pi1`, `check-deferred-rules.js` and the golden harness were not re-run: no compatibility rule, scoring input, ranking input or persisted-read path they cover changed, and the unit suite is the binding gate for a pure-seam addition.

**KNOWN TRANSITION HAZARD, measured rather than inferred: until migration 019 lands, EVERY DB-backed write pass fails.** `full-run.js` now supplies `passFacts` unconditionally, so `persistPassFacts` always runs and writes three columns that do not exist. Measured 2026-10-14 against `information_schema.columns` on BOTH databases: 0 of the 3 columns (`budget_floor`, `engine_version`, `strategy_key`) are present on the shared database and 0 on the TEST branch, so the first statement raises `42703` (undefined column) and the commit wrapper rolls the whole pass back. Concretely, on this revision: `scripts/test-orchestrator-full-run.js`, `scripts/measure-orchestrator.js`, `npm run eval:scenarios`, `npm run verify:pi1` and `npm run test:api:db` cannot pass, and the nightly `recurring-gates` job would fail at `test:api:db`. This is accepted ONLY as a pre-merge branch state, and ONLY because migration 019 is Sprint 3 of the same plan and is the immediate next step — the code and the schema must land together, and this branch is not the default branch, so the scheduled job does not run it. It is recorded here rather than left to be discovered: a write path that fails on every database is not a detail to find out from a red nightly. Landing 019 out of order would have closed the window at the cost of splitting the plan own Sprint 3 gate ("`--dry-run` lists 019 then 020 in order"); that trade was considered and rejected.

### UPDATE 2026-10-14 — Sprint 3: migration 019 IS in the tree and applied on the TEST branch

The three columns exist now. `database/migrations/019_recommendation_pass_facts.sql` is authored in the shape this entry planned (three `ADD COLUMN IF NOT EXISTS`, all nullable, no default, no backfill, no enum change, no `schema_migrations` mutation), it is applied on the TEST branch through the OG-14 ledger (ledger 18 → 19), and `verify:replay --test-db --reference=test` replays 19 files with **0 drift** (columns 365/365, checks 78/78, fks 60/60, indexes 99/99 — the +3 columns are the only delta from the 362 the Sprint 1-2 measurement recorded). The file carries no `ADD CONSTRAINT`, so unlike 018 a hand re-application is a genuine no-op; that was verified by re-executing the raw file and asserting the column shape came back identical.

Every gate the hazard block above listed as impossible was re-run and is green on the branch: `test-orchestrator-full-run.js` **36 pass / 0 fail**, `test-orchestrator-commit.js` 51/0, `measure-orchestrator.js` exit 0 with Decision 23 criteria 1-2 MET, `eval:scenarios` exit 0 at 56 PASS / 22 EXPECTED-RED / 3 UNKNOWN (the unchanged-engine baseline), `verify:pi1` PASS with 0 of 25 drifted in both use cases, `test:api:db` 1 passed / 0 failed with no residue. `test:unit` 1149/0/0 on Node 24 and on the Node 22 CI leg, `test:scripts` 212/0, `test:api` 38/0.

The gate was also BLIND, and is not any more. `test-orchestrator-full-run.js` asserted nothing about the three columns, so its earlier failure proved only that the writer raised `42703` — a writer that matched no row would have exited 0 just as readily, because `persistPassFacts` is UPDATE-only. It now reads the rows back in two passes: the default pass (no options) must show the floor present on the query row and `engine_version` **NULL**, and a second pass given `{ engineVersion }` must show that value on every result row. That pair is what makes "wrote nothing" unpassable. One comparator caveat worth carrying forward: the floor must be compared as content, not with `util.isDeepStrictEqual` — `jsonb` does not preserve key order, and `cheapest_by_role` is a deliberately null-prototype object (`retention/budget-floor.js` uses `Object.create(null)`), which `isDeepStrictEqual` rejects against the driver-parsed plain object.

**PARTLY SUPERSEDED ON 2026-10-15 - read the note at the END of this paragraph before trusting the three false clauses below.** What this UPDATE deliberately does NOT claim, so no later reader has to check: 019 is applied on the **TEST branch only**, so the SHARED database still lacks all three columns and a write against shared still fails `42703` — the shared apply remains the plan’s Sprint 5 decision. The column-scoped GRANTs, the API wiring and the `docs/API.md` v1.1 deltas are still not in the tree. And **OG-45 stays OPEN** for two reasons the branch state does not answer: the column does not exist on shared, and nothing reads `strategy_key` back — the read path that would surface it is Sprint 4. `database/migrations/` now ends at **019**; migration 020 is not started.

**SUPERSEDED IN PART 2026-10-15 (Decision 46 Sprint 4, product-identity half).** Three clauses above are false as of today and are left standing as the record of 2026-10-14. (1) The API wiring IS in the tree, for BOTH halves: `budget_floor` / `engine_version` / `strategy_key` (v1.1) and `components[].slug` plus `COALESCE(product.display_name, product.name)` for `components[].name` (v1.2). (2) The read path DOES surface `strategy_key` - `apps/api/src/repository.js` reads it and the presenter serves it per build on both verbs. (3) `database/migrations/` now ends at **020**, which IS in the tree AND applied on the TEST branch (ledger 20). What genuinely remains is unchanged: the SHARED apply of 019 plus 020, and the operator-run column-scoped GRANTs. The contract is v1.2, pinned by `apps/api/test/unit/openapi-v1.2.json` - the superseded v1.1 snapshot was DELETED by the same change rather than left as a second plausible-looking contract.

**SPRINT 5 UPDATE 2026-10-15 - THE SHARED APPLY LANDED.** The clause at the end of the note above ("the SHARED apply of 019 plus 020 ... remains") is answered: both migrations were applied to the shared database on 2026-10-15 from restore point `br-damp-grass-axyri6yl` (a `pre-019-020` branch off `production` at LSN `0/4C9C840`), one transaction per file, through the OG-14 ledger. Measured after the apply: shared ledger 20 with no pending migrations; all eight new columns present and nullable (`product.display_name`, `.slug`, `.image_url`, `.image_source`, `.image_licence_note`; `recommendation_query.budget_floor`; `recommendation_result.engine_version`, `.strategy_key`); 104 shared products all with `display_name`, 104 distinct CHECKed slugs, 0 NULL slugs, 0 format violations; `chk_product_slug_format` and `uq_product_slug` present; `verify:replay` replays 20 files into an empty database at **0 drift** (370/370 columns, 79/79 checks, 60/60 fks, 100/100 indexes); `gen:schema` regenerated both generated docs and the `verify-docs --live` digest matches the new shared schema; `check-deferred-rules` 0 violations, `check-offer-freshness --fail-days=14` PASS, `verify:pi1` PASS (0 of 25 drifted in both use cases), the golden harness still 56 PASS / 22 EXPECTED-RED / 3 UNKNOWN (exit 0); 2 audit lines appended to `database/migration-applies.jsonl` with the restore point and git sha. **The one thing NOT done is an operator step, and it cannot be done yet:** the column-scoped GRANTs for the `morocco_pc_api` role are still unapplied because that role does not exist on the shared database (`pg_roles` has no such row) - the script is ready in `docs/API.md` Production mode and runs when the role is provisioned. Also noted: the API read path was proven to resolve on shared by executing `SELECT_QUERY_SQL` and `SELECT_BUILDS_SQL` there read-only (they previously raised `42703`), and the golden harness has no E3-pin leg on this instance because the only active scoring model is `seed-minimal-v1@1.0.0` - a `launch-v2@1.1.0` pin fails closed by design.

**UPDATE 2026-10-19 - THE LAST OPERATOR STEP IS DONE.** The sentence above saying the role "does not exist on the shared database" was true on 2026-10-15 and is false now: `morocco_pc_api` was applied to shared from restore point `br-ancient-cake-axh57vpj` (self-check 20/20, then `smoke-api-role.js --confirm-shared` green with residue 0), and the same session applied 021/022 to shared (ledger 22, `verify:replay` 0 drift over 22 files). The 2026-10-15 prose above is left standing as the record of that date.

### Supersedes / superseded by

Supersedes nothing. It lands the persistence half of Decision 41 item 7's deferral (which recorded `strategy_key` as returned-but-unpersisted) and is the counterpart of `ranking/select-archetypes.js`'s header note that persisting it needs Platform migration 019. **OG-45 stays OPEN** — its re-check trigger is 019 landing, that migration is not in the tree, and nothing here can persist yet, so closing it now would be exactly the unmarked-supersession failure Decision 18 item 7 warns about. Current-status prose is updated in place: `CONTEXT.md`'s decision pointers and `AGENTS.md` §2's decision range. No dated banner anywhere is retro-edited. **Superseded in part 2026-10-14 (Sprint 3):** the claims in this paragraph that 019 "is not in the tree" and that nothing can persist yet are both false as of the UPDATE block above; leave the Sprint 1-2 prose as the record of what was true then.

## Decision 47 — `catalog_version` is a CONTENT DIGEST over the loaders' catalog tables, and `product.slug` is the canonical product key

Status: RESOLVED 2026-10-16; DESIGN ONLY + IMPLEMENTED 2026-10-16 (Platform P1 Sprint 4 designed it, Sprint 5 built it) — a catalog's state is identified by a content digest of the catalog tables the pipeline loaders read, computed on demand by ONE `SELECT` and compared as a 32-hex string (never a clock watermark, which is provably stale on this schema), and `product.slug` (migration 020) is the canonical product key, with `(manufacturer_id, manufacturer_part_number)` recorded as the strengthening path that is unusable today (0/104 populated on both databases). SHIPPED 2026-10-16: `catalogVersion(db)` in `src/recommendation/query/catalog-version.js` plus migration `021_recommendation_query_catalog_version.sql` (TEST branch; the canonical key is a definition and needs no code) — see the UPDATE block at the end of this entry.

Date: 2026-10-16. Platform P1 Sprint 4 (`PLAN_PLATFORM_P1.md`), design only, roughly 45 min as scoped. It closes the one gate three later sprints stand behind — P1 Sprint 5 (request dedupe), P1 Sprint 6 (the in-process cache and the presets) and P2 Sprint 3 (catalog endpoints) — each of which keys on a catalog state and a product identity that were UNDEFINED. `PLAN_PLATFORM_P1.md` section 7 records this as its own top risk: "the whole cache design turns on `catalog_version`; a cache without it returns stale builds after a seed or a price update." Verified 2026-10-15 and re-verified in this pass: `grep -rn catalog_version` finds the token only in `PLAN_PLATFORM_P0.md` / `PLAN_PLATFORM_P1.md` / `PLAN_PLATFORM_STATUS.md` / `docs/OPEN_GAPS.md`, never in code, and `product.slug` had never been named as an identity anywhere in the tree.

**What this is NOT.** It is not an implementation. Sprint 4's Definition of Done is "no code changed", and no module, column, migration or seed is added by this pass: after it, `catalogVersion` still does not exist in the tree. What it does do is commit its dependents to a contract, and name the ONE schema change they will need (item 10) so Sprint 5 does not have to re-decide it.

### Current situation

**There is no catalog version.** The token appears in no source file. There is no counter, no serial and no stored digest anywhere in `database/migrations/*.sql`.

**There is no trigger that maintains `updated_at` — measured, both databases.** `SELECT count(*) FROM information_schema.triggers` returns **0** on the shared database and **0** on the TEST branch. Every catalog table's `updated_at` is `TIMESTAMP NOT NULL DEFAULT now()` (`003_core_tables.sql:6,57,67`; `008_benchmark_tables.sql:41,67,97,132,164`; `009_market_tables.sql:16,32`; `011_reconcile_layer4.sql:141,179`), so it advances at INSERT and only at INSERT unless a writer names the column explicitly.

**Consequence, measured (shared database, read-only, this pass).** Rows, and rows where `updated_at > created_at`:

| table | rows | bumped | table | rows | bumped |
|---|---|---|---|---|---|
| product | 104 | 0 | cpu_spec | 19 | 0 |
| product_variant | 22 | 0 | gpu_board_spec | 22 | 0 |
| store_offer | 101 | **101** | motherboard_spec | 8 | 0 |
| component_assessment | 280 | 0 | ram_spec | 7 | 0 |
| psu_spec | 11 | **1** | ssd_spec | 17 | 0 |
| cooler_spec | 10 | **9** | case_spec | 11 | **4** |

So a max-`updated_at` watermark has moved on 9 coolers, 4 cases, 1 PSU and every offer — and on **nothing else**, including 0 of 104 products and 0 of 19 CPUs. The rows that DID move are exactly the ones a corrective seed wrote with an explicit `updated_at = now()` (seed 010's cooler heights, seed 011's case and PSU corrections); a seed that does not name the column leaves the watermark exactly where it was, which is seed 008's and seed 009's own pattern.

**Product identity as it stands.** `product` carries: `id`, `product_family_id`, `manufacturer_id`, `name`, `manufacturer_part_number`, `ean_gtin`, `lifecycle_status`, `created_at`, `updated_at`, `display_name`, `slug`, `image_url`, `image_source`, `image_licence_note`. Its identity constraints are `PRIMARY KEY (id)`, the unique index `uq_product_slug ON product(slug)`, and `chk_product_slug_format` (`slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`). Measured this pass:

| | shared (`DATABASE_URL`) | TEST branch |
|---|---|---|
| `product` rows | 104 | 100 |
| `slug` non-NULL / distinct | 104 / 104 | 100 / 100 |
| `manufacturer_part_number` non-NULL | **0** | **0** |
| `ean_gtin` non-NULL | **0** | **0** |
| distinct `manufacturer_id` | 31 | not measured |

Both `manufacturer_part_number` and `ean_gtin` are nullable and carry no unique index. `product.name` carries no unique constraint either (`003_core_tables.sql`; recorded in `DEVELOPMENT_NOTES.md`).

**What the engine actually reads.** A `FROM`/`JOIN` sweep over all of `src/recommendation/` yields these non-output tables (occurrence counts in parens): the eight spec tables — `cpu_spec` (13), `gpu_board_spec` (13), `motherboard_spec` (13), `psu_spec` (13), `ram_spec` (12), `cooler_spec` (12), `case_spec` (12), `ssd_spec` (3); the six presence/compatibility tables — `platform_memory_support` (12), `motherboard_memory_support` (9), `cpu_motherboard_support` (9), `cooler_socket_support` (9), `case_radiator_support` (9), `case_motherboard_form_factor` (9); plus `platform` (12), `store_offer` (9), `scoring_model` (8), `product` (6), `component_assessment` (6), `product_variant` (3) and `gpu_chipset` (1) — **21 tables**. The remaining hits are pipeline OUTPUTS (`recommendation_query`, `build_candidate`, `build_rejection`) or the write-side ingestion path (`store`, read by `ingestion/plan.js` `STORES_SQL`; `spec_provenance`, written by `ingestion/apply.js`), and no read-path loader touches either.

**Which column types can even be hashed deterministically — measured.** `public` holds exactly these column types: USER-DEFINED (the enums), `boolean`, `integer`, `jsonb`, `numeric`, `text`, `timestamp`, `timestamp with time zone`, and `uuid`. There are **0 `real` and 0 `double precision` columns**, and **75 timestamp columns, of which 0 are named anything other than `*_at`**. So the only type whose text rendering depends on a session GUC (`TimeZone`) is the timestamp family, and every one of those columns is an audit stamp. `numeric` renders exactly (which is also why `node-postgres` returns it as a string) and `jsonb` is stored normalized, so neither depends on `DateStyle` or `extra_float_digits`.

### Problem

A cache, a dedupe key or a preset row is only as good as the catalog identity it is keyed on. With no version at all, the weakest plausible substitute is a max-`updated_at` watermark — and on this schema that watermark is **provably stale**: with 0 triggers, a corrective seed that edits a spec value without naming `updated_at` (seed 008's and seed 009's own style) leaves the watermark exactly where it was. A cache keyed on it would therefore serve an answer computed against the OLD value, which is precisely the failure mode `PLAN_PLATFORM_P1.md` section 7 names first. Worse, the staleness is silent and selective: it hides exactly the in-place corrections (the seed 010 `155 -> 158` cooler-height class of change) while a price re-write, which does name the column, invalidates correctly — so the mechanism would look like it works.

The missing canonical key fails differently. Without one, a preset row or a dedupe key can only reference `product.id`, a `gen_random_uuid()` value that a re-import re-mints for the same physical product; the stored reference then addresses a row that no longer exists, or a different product after a re-seed that reuses a name — and `product.name` has no unique constraint to stop that. The two obvious substitutes are not merely unattractive but unavailable: `manufacturer_part_number` and `ean_gtin`, the industry's own identity for a product, are **populated on zero rows**, and because both are nullable, a UNIQUE index over them would not constrain anything at all (Postgres does not collide NULLs).

The choice of digest mechanism is a correctness matter here, not a tuning one, because the engine requires that identical DB state yield identical values (AGENTS.md section 5). A digest whose value depended on the connection's `TimeZone` would make one catalog state produce two different versions, silently splitting a dedupe and missing a cache — a determinism defect of exactly the kind Decision 18 item 7 and the `localeCompare` ban exist to prevent.

### Decision

**A. `catalog_version`**

1. `catalogVersion(db)` returns a **32-character lowercase hex string** — a content digest of the catalog tables the pipeline loaders read, and of nothing else. It is not a timestamp, not a serial and not a per-instance counter, and it is not derived from any clock.
2. It is **computed on demand and never cached as a value of its own**. The only place a `catalog_version` is ever written down is as a FACT on a row that was produced under it (item 10).
3. **Scope is the 21 tables measured above, in a DECLARED order, owned by the module that reads them** (`query/`, item 9). A table is in scope if and only if a read-path loader — `candidates/`, `offers/`, `filtering/`, `scoring/` — or `query/` SELECTs it. Pipeline outputs (`recommendation_query`, `build_candidate`, `build_rejection`) are OUT of scope: the request is the dedupe key's own business, and folding outputs in would make the version change on every POST, i.e. version every request differently by construction. The ingestion-only `store` and `spec_provenance` are out of scope because no read-path loader touches them; adding a loader that does makes its table in-scope in the same change.
4. **Audit stamps are excluded** — every timestamp column, all 75 of which are `*_at`. This is what makes the digest GUC-invariant without a `SET LOCAL TimeZone`: with 0 float columns and no non-`*_at` timestamp, every remaining type renders identically in any session. Excluding them also removes pure churn, since a write that changes no semantic value must not invalidate a cache.
5. **Sensitivity is the binding property, not precision.** The digest MUST change when any non-timestamp value in a covered table changes, including an in-place correction that alters neither a row count nor any timestamp. A false invalidation costs a recomputation; a missed one serves a wrong answer, so the mechanism is tuned toward sensitivity and the excluded set (item 4) is kept as small as the determinism requirement allows.
6. **Coverage is by construction, not by a hand-kept column list.** The digest hashes the whole row minus item 4's exclusions, so a spec column added by a later migration is covered the moment it exists. A per-column projection is rejected (see alternatives) because a newly added column would fall out of the digest silently — a fresh silent-failure mode, in a repo whose worst recorded defects are silent ones.
7. **`scoring_model` IS in scope**, although the dedupe key also carries a model pin. A pin names `name@version` (`scripts/lib/model-pin.js`), so flipping `is_active` or editing `configuration` under an unchanged name and version would change every recommendation while leaving the pin — and a version built only from spec tables — untouched.
8. **Cost, and the re-check trigger that retires it.** The digest is ONE round trip (`catalogVersion(db)` takes a client, not a transaction) that reads every covered table. At this catalog — roughly 700 rows across the 21 tables: 104 products, 101 offers, 280 assessments, about 116 spec rows — that is far cheaper than the pass it makes skippable, which the plan measures at 74 statements at about 147 ms round-trip each (`PLAN_PLATFORM_P1.md` section 0). It is O(catalog rows) per call, so the trigger to revisit the mechanism is a catalog one or more orders of magnitude larger, or a call site that needs it on a path which would otherwise never touch the database. The replacement then is a persisted counter or a trigger-maintained watermark, and that decision must be made on a measurement, not on a hunch.
9. **Determinism and purity.** `catalogVersion` performs no write, reads no clock and uses no randomness: two calls against identical catalog content return the identical string, in any session, on any host, whatever order tables are evaluated in (the arms are folded in the fixed declared order of item 3, and within an arm rows are ordered by their own hashed text). No `localeCompare`, no `Math.random`, no `Date`. Its home is `src/recommendation/query/` beside the query loader, exported from that barrel: it is a read-only DB access feeding a pass, which is the shape `query/` already owns, and a new stage directory (`catalog/`) would break the one-directory-per-pipeline-stage convention of AGENTS.md section 4 without adding a stage. It must not be placed in any pure stage.
10. **Persistence — two answers, both explicit.** (a) As a cache: NEVER. (b) As a pass fact: YES, because request dedupe has to match an incoming request against a stored pass, and it can only do that if the stored pass records which catalog state it ran under. Concretely, one nullable `TEXT` column with a format CHECK `^[0-9a-f]{32}$` (the `chk_product_slug_format` precedent), on `recommendation_query` — the row a dedupe match is made against — plus the `recommendation_preset` column Sprint 6 already plans. **Both columns are Sprint 5/6 schema and are NOT created by this pass.** `NULL` means UNKNOWN (a pass predating the column), and a dedupe must treat an unknown version as a MISS, never as a match.
11. Pruning old preset rows and backfilling historical passes are OUT of scope here; they belong to the sprint that adds the columns, and item 10's contract is the only thing this decision fixes about them.

**B. The canonical product key**

12. **`product.slug` IS the canonical product key** — the portable, human-facing identity for anything persisted beyond a single pass: preset rows, dedupe keys, share links, API payloads, and cross-references in docs. It is adopted because it is the only product attribute that is at once database-enforced unique (`uq_product_slug`), format-constrained (`chk_product_slug_format`), fully populated on BOTH databases (104/104 shared, 100/100 branch, every one distinct) and stable by policy — `020_product_identity_and_media.sql` never overwrites a non-NULL slug, it fills NULLs only.
13. **`product.id` is the internal row identity and never the portable key.** Its `gen_random_uuid()` default means a re-import mints a new value for the same physical product, and a key that changes under a re-import cannot key a persisted row. Internal joins keep using it.
14. **NULL is UNKNOWN, inherited from the schema.** `slug` is deliberately nullable (020: `SET NOT NULL` would break every product writer and would claim a completeness the schema does not have), so the canonical key's value is UNKNOWN for a slug-less row. A consumer must refuse to persist an unknown key — never mint one, never fall back silently to something that merely looks unique. Measured today: 0 NULL slugs on either database, so UNKNOWN is a reachable state, not a current one.
15. **The semantic natural key is declared but UNUSABLE today, and is NOT adopted.** `(manufacturer_id, manufacturer_part_number)` is the industry's canonical identity for a part, with `ean_gtin` as its barcode counterpart; both are **0/104 populated on shared and 0/100 on the branch**, and both are nullable, so a UNIQUE constraint over them would constrain nothing (Postgres does not collide NULLs). Binding re-check trigger: when the first non-NULL `manufacturer_part_number` is seeded, add the unique index and settle its precedence against `slug` in that same pass. Until then, no code may assume an MPN exists.
16. **Slug's own limit, stated rather than papered over.** 020 derives each slug from `COALESCE(display_name, name)`, so a slug is stable WITHIN a catalog instance (a later rename does not re-slug it) but a full re-import into a fresh catalog can mint a different slug for the same product. Therefore `slug` is the canonical key for everything persisted within one instance, and a reference that must survive a re-import needs item 15's MPN — which does not exist yet. Cross-instance identity is UNKNOWN today, not guessed; a caller that needs it must say so rather than pick a substitute.
17. Wherever a durable reference to a product or a pass is stored, the product's `slug` and the pass's `catalog_version` are stored TOGETHER, so a reader can always tell which catalog a reference was made against. A stored reference without its `catalog_version` is incomplete by this contract.

### Rejected alternatives

- **A max-`updated_at` watermark (the cheapest candidate).** Rejected on measurement, not taste: 0 triggers exist, and `updated_at` has advanced past `created_at` on 0 of 104 products, 0 of 19 CPUs, 0 of 280 assessments and 0 of 8 motherboards. A corrective seed that edits a value without naming the column leaves the watermark unchanged, so the mechanism is stale exactly when the catalog was repaired by hand — and it is stale silently, while a price re-write invalidates correctly, so it would pass a casual test.
- **Adding triggers (a migration) to MAKE `updated_at` truthful.** Rejected as strictly more machinery for a weaker guarantee: it needs a migration plus trigger coverage over 21 tables, it is blind to everything written before it exists (the version computed either side of a pre-trigger seed is identical), and even then it answers "when did someone write" rather than "what does the catalog say" — a write that changes nothing would invalidate a cache, and a value restored to a previous state would invalidate one too. The digest gets the content question right for free.
- **A persisted counter (`catalog_state.version`, bumped by catalog writers).** Rejected: it needs a migration AND per-writer discipline, and the failure mode it introduces is the one it was meant to remove — a writer that forgets to bump leaves it stale, identically to the watermark, but with schema and a new piece of state that can be wrong. It also cannot be verified: nothing distinguishes "the counter is right" from "the counter was not bumped".
- **A TTL or time-boxed cache with no version at all.** Rejected outright: a TTL is a clock read, and the engine's determinism requirement does not permit an output that depends on when it was asked. Two identical requests either side of a TTL boundary would return two different answers.
- **Digesting only counts, or only counts plus `max(updated_at)`.** Rejected: insensitive to in-place value corrections — the seed 010 `155 -> 158` cooler height and seed 011's case and PSU fixes — which are exactly the changes that must invalidate, and which leave both a count and a timestamp untouched.
- **A hand-written per-column projection (the `schema-digest` shape from `gen-schema-reference.js` / `verify-docs.js`).** Rejected for THIS use, although it is the right shape for the schema digest: that digest is gated by a check that fails when it drifts, whereas a catalog read is hashed on the request path, where nothing would notice a newly added spec column falling out of the projection. Whole-row hashing (item 6) covers a new column the moment it exists.
- **`product.id` as the canonical key.** Rejected: it is instance-generated and re-minted on re-import, so a persisted reference breaks silently — the one property a canonical key must not have.
- **`(manufacturer_id, manufacturer_part_number)` as the key, today.** Rejected on the measurement in item 15: 0/104 populated, and nullable, so it identifies nothing and cannot be constrained. Note this rejects the TIMING, not the key: the decision names the exact trigger that reverses it.
- **`product.name` (possibly with `manufacturer_id`).** Rejected: no unique constraint, so it is not even enforced-unique once; and `name` is the `Seed `-prefixed raw field that 020 deliberately left untouched so the existing seeds keep matching.

### Verdict for this pass

Design only, so there is no implementation to report a status for. What can be reported is the evidence the design rests on, and the gates it leaves green.

- Measurements taken (read-only, 2026-10-16, both databases). **PASS.** `information_schema.triggers` = 0 rows on the shared database and 0 on the TEST branch; `product` = 104 rows / 104 slugs / 104 distinct / 0 NULL slugs / 0 MPNs / 0 EANs on shared and 100 / 100 / 100 / 0 / 0 on the branch; the per-table `updated_at > created_at` counts in the table above; 21 table names from the FROM/JOIN sweep over `src/recommendation/`; 0 `real`/`double precision` columns and 75 timestamp columns, 0 of them non-`*_at`.
- `catalog_version` contract (items 1–11). **RECORDED, not implemented** — no `catalogVersion` exists in the tree after this pass, by design, so there is nothing for a unit test to cover yet.
- Canonical-key contract (items 12–17). **RECORDED.** Both terms are defined in `docs/GLOSSARY.md` under this decision's id, so Sprint 4's scenario 4.3 ("a second reader can find the key definition from `docs/GLOSSARY.md` alone") holds.
- Gates. `node scripts/gen-decision-index.js --check` -> exit 0 (after regeneration); `npm run verify:docs` (offline) -> **OK**, including `decisions-parse` (45 `## Decision` headings + 5 nested = 47 global, 51 `Status:` lines) and `agents-decision-range` ("Decisions 1-47" cited); `npm run test:unit` -> **1149 pass / 0 fail / 0 cancelled**; `node --test scripts/lib/gap-register.test.js` -> **24 pass / 0 fail** after the `OG-52` wording correction. No DB-mutating gate is affected: this pass writes nothing, so `verify:replay` and the `SCHEMA_REFERENCE.md` schema digest are untouched by a docs-only change.

### Supersedes / superseded by

Supersedes nothing. It answers the question `docs/OPEN_GAPS.md` `OG-52` records ("a canonical product key and a `catalog_version` concept that does not exist") by DECIDING both: the concept now exists as a contract while still being unimplemented, and `OG-52`'s P1 clause is corrected in place to say exactly that, so the register no longer claims the concept is absent. It amends no earlier decision. Where it touches ground Decision 46 broke, it extends the same pattern: that decision had a pass persist facts about itself, and item 10 adds one more fact — the catalog version — to the same family of columns, under the same `NULL` = UNKNOWN rule. It must not be read as the Decision 26 item B "defers a HARD rule" pattern: items 8, 10 and 15 each carry an explicit, named re-check trigger instead of a vague deferral. No dated banner anywhere is retro-edited.

### UPDATE 2026-10-16 — the digest and the column LANDED (Platform P1 Sprint 5)

The Status line above says the design shipped with "no code, no migration, no seed". That was true of Sprint 4 and is no longer true of the tree; this block records what landed. **The Sprint 4 prose above is left exactly as written** — it is the record of what that pass decided and deliberately did not build, and editing it would erase the only evidence that the design preceded the implementation.

What landed, and where:

1. **`catalogVersion(db)`** — `src/recommendation/query/catalog-version.js`, exported from the `query/` stage barrel (items 1, 3, 4, 5, 6, 8, 9). One `SELECT`, 21 declared arms in a fixed order, folded by `md5(string_agg(arm, '|' ORDER BY arm))`, and within an arm rows are ordered by their own text. Item 4's audit-stamp exclusion is implemented **by TYPE**: every column whose `data_type LIKE 'timestamp%'` is subtracted from the row's jsonb via `information_schema`, never a hand-kept column list, so a future timestamp column under any name stays excluded and item 6's coverage-by-construction holds on the exclusion side too.
2. **`recommendation_query.catalog_version`** — `database/migrations/021_recommendation_query_catalog_version.sql` (item 10): nullable `TEXT` with `chk_recommendation_query_catalog_version_format` (`^[0-9a-f]{32}$`), written once at INSERT by the API, no default, no backfill. Applied to the TEST BRANCH ONLY on 2026-10-16; the shared apply remains an owner-gated step that needs its own recorded restore point, exactly as this entry's item 10 said it would be.
3. **The dedupe that consumes it** — `apps/api/src/repository.js` (`SELECT_REUSABLE_QUERY_SQL` + `findReusableQuery`) and `apps/api/src/routes/recommendations.js`, under contract **v1.3** (`reused: true` plus the ORIGINAL id on a hit; every reply carries `catalog_version`).

Two things the implementation settled that this entry had left open. Both were found by writing the NEGATIVE cases as tests, not by review, and both are pinned:

- **Item 10's "an unknown version is a MISS, never a match" needed a SQL shape, and the obvious one is WRONG.** `q.catalog_version IS NOT DISTINCT FROM $7` is TRUE when the row and the request have *both* recorded nothing, so a digest-degraded request would reuse an earlier digest-degraded pass — serving an answer whose catalog state is unknown on both sides. The shipped condition is `q.catalog_version IS NOT NULL AND q.catalog_version = $7`: the row must have recorded a version, and a request with none matches nothing. `IS NOT DISTINCT FROM` is kept for `resolution` and `priority`, where an omission is a property of the REQUEST rather than an unknown — the asymmetry is deliberate and documented in the statement's comment.
- **A reuse requires a COMMITTED pass** (`q.budget_floor IS NOT NULL`). An `EMPTY_CANDIDATE_POOL` pass never reaches its write transaction, so its row has no floor and no result rows — and its `reason` is not persisted anywhere, so serving that row would mean FABRICATING one. A repeat of such a request runs its own pass instead, which is honest and rare. The re-check trigger for this is `EMPTY_CANDIDATE_POOL` becoming common, at which point the correct fix is to persist the reason as a pass fact the way Decision 46 persists its three, and reuse becomes exact.

Evidence measured against the TEST branch on 2026-10-16 (inside one transaction that was ROLLED BACK, so nothing was written):

- **item 1 / item 9:** the digest is identical across two consecutive calls and identical again under `TimeZone = 'Asia/Tokyo'` (GUC-invariance, on a branch whose `store_offer` carries four `timestamptz` columns).
- **item 5 — sensitivity, demonstrated against the mechanism it rejected:** a single-row in-place `product.display_name` correction MOVED the digest while `max(updated_at)` did not move AT ALL. That is the rejection of the watermark in item 1 and the sensitivity requirement of item 5 shown side by side on real data, rather than argued.
- **residue 0** after the rollback.

Still open from this decision, unchanged and re-stated so they are not mistaken for closed: **item 8's** re-check trigger (a catalog orders of magnitude larger, or a call site that needs the digest on a hot path), **item 15's MPN trigger** (the first non-NULL `manufacturer_part_number` seeds the unique index and settles its precedence against `slug`), and **the shared apply of 021**, without which `verify:replay`'s default shared reference reports that one column as drift by design.
## Decision 48 — a generated preset is a POINTER at an ordinary pass, keyed by (use_case, currency, catalog_version, budget_amount), and only the CURRENT catalog version is ever served (Platform P1 Sprint 6)

Status: RESOLVED 2026-10-16; IMPLEMENTED 2026-10-16 — the preset ribbon is a keyed pointer table (`recommendation_preset`, migration 022) served by `GET /v1/presets` at the current catalog version only, generated idempotently through the API's own write path, one catalog version per family with superseded rows pruned together with their passes.

Date: 2026-10-16. Platform P1 Sprint 6 of `PLAN_PLATFORM_P1.md` (the landing-page ribbon: a generated preset per budget x use case, served read-only). This entry makes TRUE a citation that was already in the tree — migration `022_recommendation_preset.sql`'s header, `scripts/generate-presets.js` and `apps/api/src/routes/presets.js` all name "Decision 48", which did not exist until now — and records the contract those three already implement. It is NOT an engine change: no module under `src/recommendation/` is touched, no score, rank or persisted build changes, and no existing response field changes (contract v1.4 adds exactly one path).

### Current situation

- `recommendation_preset` exists (migration `022_recommendation_preset.sql`, TEST branch only): the four-part natural key is the PRIMARY KEY in read-path order, `query_id` is `UNIQUE` and `ON DELETE CASCADE`, `catalog_version` is NOT NULL with the Decision 47 digest-format CHECK, `budget_amount` is `NOT NULL` and `> 0`.
- `scripts/generate-presets.js` generates the ribbon (6k–40k MAD in 2k steps x the model's use cases by default) through `createRecommendationQuery` + `runFullRun` — the API's own write path — and records each resulting pass id.
- `GET /v1/presets?use_case=&currency=` serves the current-version ribbon cheapest budget first, and every id it serves is an ordinary recommendation id that `GET /v1/recommendations/:id` answers through the same read path.
- `catalogVersion(db)` (Decision 47) supplies the version component the key needs; without it the key could not distinguish a ribbon generated before and after a price update.

### Problem

Three questions decide the shape of this feature, and left undecided each becomes a silent default that is wrong in a way a test would not catch. Is a preset a COPY of the build rows or a POINTER at the pass? What happens to the rows of a superseded catalog version after a price update — are they served, or gone? And when the catalog digest cannot be computed, does the endpoint serve a list it cannot attribute to any catalog state, or say so? A copy drifts from its pass the moment either is edited; superseded rows served as "least preferred" answer a price update with the builds it invalidated; and an unattributable list is indistinguishable from "nothing generated yet", which invites a client to regenerate a page that already exists.

### Decision

1. **A preset is a POINTER, never a copy.** `recommendation_preset.query_id` references `recommendation_query(id)` `ON DELETE CASCADE` and is `UNIQUE` (a pass answers exactly one key; migration 022). A landing page owns no facts of its own — `build_score` and `price_status` are DERIVED from the persisted pass at read time, so the ribbon can never disagree with the recommendation it links to.
2. **The identity of a preset IS its four-part key** — `(use_case, currency, catalog_version, budget_amount)` — the PRIMARY KEY, declared in exactly the read-path order so the serving query is one index range scan with no sort step and no extra index (migration 022; the Decision 34 offer-key precedent). A surrogate id is rejected: there is no fifth fact about a preset to address.
3. **Only the CURRENT catalog version is ever served.** The version is computed by the ROUTE and passed to the statement as an argument — never a `max()` inside the SQL — so rows of a superseded version are INVISIBLE rather than least-preferred, and a price update can never be answered with the builds it invalidated (`apps/api/src/repository.js` `SELECT_PRESETS_SQL`).
4. **An unknown version is a MISS, never a match** (Decision 47 item 10, applied to the ribbon). When the digest cannot be computed the endpoint answers `503 CATALOG_VERSION_UNAVAILABLE` rather than an empty list — the standing NULL/UNKNOWN rule applied to an HTTP status. `200` with an empty list means something else entirely: "nothing generated for THIS catalog yet", which is a valid answer and not an error.
5. **Idempotency is two-layered** (Decision 31's replace-idempotent convention at family scope). `findPresetQueryId` is the SKIP — a key that already has a preset at this version runs NO pass — and underneath it the table's PRIMARY KEY plus `upsertPreset`'s `ON CONFLICT ... DO UPDATE` make a duplicate row unrepresentable; a re-run CONVERGES on one row and MOVES the pointer instead of raising `23505`.
6. **A family holds ONE catalog version** (retention). A generation run for a new version inserts the new rows and PRUNES the family's superseded rows together with their passes in FK order (`deleteSupersededPresets` + `generate-presets.js` `deletePasses`), so the table does not grow with every price update and no request can reach a dead row.
7. **The generator writes through the API's own write path** (`createRecommendationQuery` + `runFullRun`), so a generated pass is indistinguishable from a POSTed one: same profile/query pair, same commit transaction, same Decision 46 pass facts. A second write path for `recommendation_query` would be a second way to be wrong.
8. **Per-preset derivation rules** (`apps/api/src/routes/presets.js`): `price_status` is `'verified'` only when the shown build HAS components and every one is `VERIFIED`; `'indicative'` when any is not — a NULL `offer_class` included, because UNKNOWN provenance is never advertised as verified (Decision 36 item 4); and NULL when there is no build to make a claim about, which is a legitimate outcome (Decision 17.2). `build_score` is the rank-1 build's persisted score or NULL — never `0`, a score nobody computed. An empty component set contradicts nothing, so `'verified'` over an empty set is the one reading the derivation must never produce (hence the two counts in the statement, not one `NOT EXISTS`).
9. **The ribbon's inputs are checked against the ACTIVE model's vocabulary** (Decision 37 / Decision 36 item 3): a use case the model does not declare is a `422` carrying the vocabulary — never an empty ribbon, which would look like "no presets exist" and invite a generation run for a page the model cannot score.
10. **Generated passes are ordinary UNMARKED `recommendation_query` rows**, so they block the golden harness preflight until removed; the generator owns `--cleanup` / `--cleanup=<sha>` and prints that consequence at the end of a commit run (the AGENTS §6 operational rule applied to this writer).

### Rejected alternatives

- **A COPY per preset (materialized build rows).** Rejected: it is a second write path for facts the pass already owns, the copy drifts the moment either side changes, and every consumer of a permalink would need to know which copy is true. The pointer costs one row and cannot disagree.
- **Serving every catalog version, newest preferred (`max()` in SQL).** Rejected: the superseded rows remain reachable, so a stale row can be served the moment the preference logic is wrong — and "least preferred" and "invisible" differ exactly when a price update made the old builds wrong.
- **A surrogate `id` column on the preset.** Rejected: the four-part key is the identity (the Decision 34 offer-key precedent); a surrogate adds a fifth fact to remember in every lookup and turns the PK from a database property back into a convention.
- **A TTL or "regenerate periodically" schedule.** Rejected for the Decision 47 family of reasons: a TTL is a clock read, and the ribbon must be a function of catalog content — a price update triggers regeneration, not elapsed time.
- **Keying the ribbon on the POST dedupe key** (`SELECT_REUSABLE_QUERY_SQL`'s eight components). Rejected: that key is about REQUEST identity including the engine version; a preset is about CATALOG state. Reusing it would silently change the ribbon on every deploy while the catalog stood still.
- **Pruning superseded preset rows but keeping their passes.** Rejected: the passes become unreachable, unmarked rows — the exact shape that blocks the golden harness — and they keep growing the Layer 4 tables with every price update.

### Verdict for this pass

- **Migration 022 — PASS (branch).** Applied to the TEST branch on 2026-10-16 through the ledger (`run-migrations.js --test-db`, no pending afterwards). The SHARED apply is deliberately owner-gated and NOT done; until it lands, `verify:replay`'s default shared reference reports 022's table as fresh-only drift by design and `gen:schema` (which reads `DATABASE_URL`) does not list it — the documented TEST-first state (`docs/RECIPES/add-a-migration.md`).
- **Implementation — PASS after repair.** The Sprint 6 commit (`942cb93`) landed with its seams unconnected — the contracts module was never committed nor re-exported, the route was never registered in `app.js`, the repository had none of the five preset statements, and the test stub lacked the state the tests record into — so `test:api` was red at 56/9 and the generator called functions that did not exist. The repair commit (`36620ec`, 2026-10-16) wired exactly those seams and implemented the statement layer to the contract the shipped tests already pinned. Nothing about the decided design changed.
- **Suites — PASS, measured 2026-10-16:** `npm run test:unit` 1165 pass / 0 fail; `npm run test:api` 65 / 0; `npm run test:scripts` 249 / 0; `npm run test:api:db` 4 / 0 on the TEST branch with residue 0 — the DB suite proves items 3, 4, 5, 6 and 8 against REAL rows (the derived status from persisted `offer_class`es, superseded-version invisibility, generator idempotency as row-count and pass-count immutability, and the pointer round trip through `GET /v1/recommendations/:id`).
- **Contract v1.4 — PASS.** Exactly one new path (`/v1/presets`), no existing field changed; pinned byte-for-byte by `apps/api/test/unit/openapi-v1.4.json`, and the superseded v1.3 snapshot was DELETED so exactly one plausible contract remains in the tree.
- **Gates — PASS.** `npm run gen:decisions` + `gen-decision-index --check` (0); `npm run verify:docs` (offline) OK with `decisions-parse` at 46 headings / 52 `Status:` lines and `agents-decision-range` citing "Decisions 1-48"; `npm run test:unit` 0 fail per the template checklist.

### Supersedes / superseded by

Supersedes nothing and amends no earlier decision; it consumes Decision 47's `catalog_version` (the key's version component), Decision 31's replace-idempotent convention (item 5), Decision 37's vocabulary ownership (item 9) and Decision 46's pass facts (item 7). It corrects `docs/OPEN_GAPS.md` OG-52's P1 clause in place — "dedupe + presets" is no longer open — and that correction is made in the same pass as this entry. No dated banner anywhere is retro-edited.

## Decision 49 — `TRUST_PROXY` names the trusted PROXY ADDRESS, never a hop count, and both unsafe shapes fail at startup (Platform P2 Sprint 2)

Status: RESOLVED 2026-10-17; IMPLEMENTED 2026-10-17 — the rate limiter keys on the client IP only when `TRUST_PROXY` names the proxy that forwarded the request; the default ignores `X-Forwarded-For`, and a hop count or `true` is refused before the process listens.

Date: 2026-10-17. Platform P2 Sprint 2 Steps 1-3 of `PLAN_PLATFORM_P2.md` (the "truthful per-IP limits" sprint). It records the contract the plan described as a HOP COUNT, which the installed `fastify@5.12.5` makes impossible in that shape. It closes no gap: Step 4 (measure on the deployed origin) still needs P1's host. It is NOT an engine change - no module under `src/recommendation/` is touched, no score, rank, route or response field changes, and the OpenAPI document stays v1.4.

### Current situation

- `@fastify/rate-limit` is registered `global: false` with a per-route budget: 30/min on `POST /v1/recommendations`, 120/min on the GETs. Its `defaultKeyGenerator` is `normalizeIP(req.ip, ipv6Subnet)` - the bucket key IS `request.ip`.
- `fastify@^5.12.5` `lib/request.js` `getTrustProxyFn` maps a NUMERIC `trustProxy` to `function () { return false }`, with the comment "Hop-count-only trust cannot validate the immediate peer. Fail closed so direct clients cannot spoof X-Forwarded-* values by supplying enough hops." `true` maps to `() => true`; a string or array goes to `proxyAddr.compile`.
- Measured 2026-10-17 through `fastify.inject` (socket `127.0.0.1`), one header `203.0.113.9` and a two-entry chain `192.0.2.55, 203.0.113.9`: `false` -> `127.0.0.1` / `127.0.0.1`; `1` -> `127.0.0.1` / `127.0.0.1`; `'127.0.0.1'` -> `203.0.113.9` / `203.0.113.9`; `true` -> `203.0.113.9` / **`192.0.2.55`**, the client-written prefix.
- Before this entry `buildApp` passed no `trustProxy` at all, so `request.ip` was always the socket address.

### Problem

Behind a platform proxy every caller shares the proxy's address, so the 30/min POST budget is 30/min for the entire internet - the per-IP claim in `docs/API.md` and in Decision 36 item 11 was true of the code but false of the deployment.

The plan's remedy - a numeric hop count - is a SILENT NO-OP on this library version: the process starts, the setting looks configured, and every forwarded header is ignored. `true` is worse, not better: the measurement above shows a caller choosing its own bucket by writing its own `X-Forwarded-For` prefix, which voids every per-IP limit and any load-test measurement built on it (the risk `PLAN_PLATFORM_P1.md` names for exactly this sprint).

### Decision

1. **`TRUST_PROXY` is the trusted proxy ADDRESS list** - a comma-separated list in `proxy-addr` syntax: an IPv4/IPv6 address, a CIDR, or one of its named ranges (`loopback`, `linklocal`, `uniquelocal`). `apps/api/src/app.js` `parseTrustProxy` is the single owner and returns either `false` or the entry list.
2. **The default is OFF.** Unset, blank, `false`, `0`, `off` and `no` all yield `false`, and Fastify then ignores `X-Forwarded-For` entirely. That is the only safe default for a directly reachable process, and it is proven inert rather than assumed.
3. **A trusted peer makes `request.ip` the address the proxy appended.** Fastify stops at the first untrusted hop, so a client-written prefix can neither move the caller to another bucket nor mint a new one.
4. **A hop count is REFUSED, and so are `true` and a `/0` prefix.** All three raise a `TypeError` during `buildApp`, i.e. before the process listens, with a message naming the supported form. `yes`/`on` are refused with `true`, and `0.0.0.0/0` / `::/0` are refused because they are `true` in CIDR spelling - trusting every peer makes `request.ip` the leftmost `X-Forwarded-For` entry. A malformed entry (a hostname, an out-of-range prefix) is refused rather than dropped. A rate-limit key must never fail open silently.
5. **One reader, one precedence.** `buildApp` reads `env.TRUST_PROXY` exactly as it reads `ALLOWED_ORIGINS`, so `server.js` is unchanged; an explicit `buildApp({ trustProxy })` overrides the environment, which is what the tests use.
6. **The concrete value is a PER-HOST fact.** `TRUST_PROXY=127.0.0.1` is the shape for a same-host reverse proxy (and the value the tests pin); a proxy on a private network is its CIDR. No value is recorded for the eventual host, because no host exists yet - it is pinned from the deployed origin's own `request.ip` evidence at Step 4, never copied from memory.
7. **The guarantee is per process.** The counters live in memory: N instances allow N x the stated limit and a restart resets every bucket. A shared store is future work and is not claimed by `docs/API.md`.
8. **The contract is documented where an operator looks.** The `TRUST_PROXY` row in `docs/API.md` has the environment table and a *Per-IP limits behind a proxy* section states the default, the accepted forms, both refusals and the in-process caveat; `apps/api/.env.example` carries the same rule. No route, limit, response or OpenAPI document change is involved.
9. **The behaviour is pinned by DB-free tests**, not by the config value: `apps/api/test/unit/rate-limit.test.js` proves the default shares one bucket, a trusted peer separates two forwarded addresses, and a spoofed prefix cannot mint one; `apps/api/test/unit/trust-proxy.test.js` proves the parse contract, both refusals (including at app construction), the env wiring and the option precedence.

### Rejected alternatives

- **A numeric hop count, as the plan specified.** Rejected by measurement, not taste: `fastify@5.12.5` returns a trust function that trusts nothing for a number, so the setting would be a no-op and a test asserting separate buckets could only pass against a value the server ignores.
- **`trustProxy: true`.** Rejected: measured to resolve `X-Forwarded-For: 192.0.2.55, 203.0.113.9` to `192.0.2.55`, so any caller picks its own bucket. It is the failure mode this sprint exists to prevent.
- **A hop count translated into a custom trust function (`(address, hop) => hop < N`).** Rejected: it reproduces the intended semantics, but Fastify's own documentation calls hop-count-only checks unsafe when the origin can be reached directly - which it is today, because nothing is deployed behind a proxy yet - so the anti-spoofing half of the sprint's definition of done could not be demonstrated. Naming the peer is the same one-hop configuration with the peer check kept.
- **A heuristic peer check (trust only RFC1918 / loopback addresses).** Rejected: it invents a fact about the host. A proxy may legitimately present a public address, and a private peer is not proof that the request came through the proxy.
- **Leave `trustProxy` unset until the host is chosen.** Rejected: it leaves the false per-IP claim in place, leaves no testable contract, and delays the only part that the host choice does not decide - the accepted forms and the refusals.
- **Accept `true` "for hosts that publish no proxy range".** Rejected for now: it trades the anti-spoofing guarantee for convenience without measuring need. If a host proves to need it, that is a new decision with its own evidence, not a parser allowance.
- **Accept a `/0` CIDR as "all proxies".** Rejected: it is `true` in CIDR spelling and reopens the same bypass, so the parser refuses it instead of documenting a footgun. A narrower prefix (even `/1`) parses, which keeps the refusal a bright line rather than a judgement about "too broad".

### Verdict for this pass

- **Unit - PASS.** `npm run test:api` **89 pass / 0 fail** (75 before this sprint; 3 bucket tests in `rate-limit.test.js`, 11 config tests in `trust-proxy.test.js`), on Node 24.21.0 AND on `npx -y node@22 --test "apps/api/test/unit/*.test.js"` (the version CI pins) with 0 cancelled.
- **Default inert - PASS.** Two different `X-Forwarded-For` values alternating over 31 POSTs hit the limit at exactly the 31st request, which is the same bucket.
- **Trusted peer - PASS.** With `TRUST_PROXY=127.0.0.1`, 30 requests per address all pass and each address's 31st is a 429; a chain `192.0.2.55, 203.0.113.9` is attributed to `203.0.113.9`, and changing the prefix does not mint a bucket.
- **Refusals - PASS.** A hop count (`1`, `'1'`), `true`/`yes`/`on` and `0.0.0.0/0` / `::/0` throw during `buildApp`; a malformed entry throws; none is coerced. The `/0` case was found in review: without it the `true` refusal could be bypassed by CIDR spelling.
- **Docs gates - PASS.** `npm run verify:docs` OK with `decisions-parse` at 47 headings / 53 `Status:` lines and `agents-decision-range` citing "Decisions 1-49"; `gen-decision-index --check` clean; `npm run test:unit` 0 fail.
- **OpenAPI - unchanged by this sprint.** No route or schema changed, so the v1.4 snapshot was untouched (P2 Sprint 3 superseded it with v1.5 on 2026-10-17) and the completeness gate still passes.
- **Step 4 - BLOCKED.** The deployed-origin measurement needs P1's host; nothing here claims it was run. No database was read or written.

### Supersedes / superseded by

It does not supersede a decision, but it QUALIFIES Decision 36 item 11: "30/min/IP on POST ... 120/min on GET" is literally true only when the proxy is named, and that item now carries a dated UPDATE block pointing here. It corrects `PLAN_PLATFORM_P2.md` Sprint 2 in place (the hop-count interface and scenarios 2.2/2.3 reworded, with the measurement recorded), and `DEVELOPMENT_NOTES.md` (2026-10-17) carries the operational finding. No dated banner anywhere is retro-edited.

## Decision 50 — the catalog is a keyset page over `slug`, and every catalog price carries its Decision 35 provenance (Platform P2 Sprint 3)

Status: RESOLVED 2026-10-17; IMPLEMENTED 2026-10-17 — the catalog is served read-only: `GET /v1/catalog/products` pages ACTIVE products with a keyset on the unique `slug`, and `GET /v1/catalog/products/:slug` serves the spec row, every eligible offer and a derived `price_status`; every price travels with its provenance class, and an unpriced product is listed rather than hidden.

Date: 2026-10-17. Platform P2 Sprint 3 of `PLAN_PLATFORM_P2.md` (the read-only catalog sprint). It records the contract that sprint sketched but could not state: the sketch named a `use_case` parameter no model can honour and a `specs` object with no shape. It is NOT an engine change - not one module under `src/recommendation/` is touched, no score, rank or persisted row changes - and it needs NO migration: `product.slug` / `display_name` (020) are applied on both databases and the offer class is derivable. It closes no gap; Sprint 3's Step 7 (may catalog pages be public?) remains the owner's decision.

### Current situation

- The TEST branch holds **100 ACTIVE products, 100/100 with a non-null `slug`**, 101 `store_offer` rows - all `MAD`, all `IN_STOCK`, and all with a NULL `ingestion_record_id` (Decision 35 beta data) - and **21 GPU products over 22 `product_variant` rows**, one of them with two variants (measured read-only 2026-10-17).
- `product` has NO category column. Category is DERIVED from spec-table presence (`candidates/loader.js`, and `scripts/lib/og01-catalog.js` script-side). Each spec table is one-to-one with `product_id`, except `gpu_board_spec`, which is keyed by `product_variant_id` (migration 004).
- `store_offer` has NO `offer_class` column either. The class is derived per row from `ingestion_record_id` in `offers/select.js` (NULL = `SEED_UNVERIFIED`, non-NULL = `VERIFIED`), and only `build_component` SNAPSHOTS it (migration 018).
- The engine prices an offer only when the currency matches exactly, `price > 0`, `availability <> 'OUT_OF_STOCK'`, and `last_checked_at` is inside 30 days UNLESS the offer is a seed offer (Decision 35; the API always runs with that exemption ON, `apps/api/src/engine.js`).
- `product.name` has no unique constraint; `product.slug` does (`uq_product_slug`, migration 020). Nothing in `apps/api/` served either column except as a component name inside a recommendation.

### Problem

A storefront has no read surface at all: a client can obtain a product only by first running a whole recommendation pass and hoping the product was selected. Two failure modes follow directly from building that surface carelessly.

Paging with `OFFSET` over `product.name` can repeat or skip a row, because the name is not unique - and the returned set is the catalog's public face, so a silently skipped GPU or PSU is invisible forever. Separately, the entire catalog is seed pricing under a beta freshness waiver: publishing `from_price` without its class would present an unverified price as a confirmed one, which is exactly the risk `PLAN_PLATFORM_P2.md` names for this sprint.

### Decision

1. **The list is a KEYSET page on `slug`.** `SELECT_CATALOG_PRODUCTS_SQL` (`apps/api/src/repository.js`) orders by `slug ASC`, filters the next page with `slug > $cursor`, and asks for `limit + 1` rows; `next_cursor` is the last SERVED slug (never the probe row) and `null` on the last page. There is no `OFFSET` anywhere and no COUNT. `limit` defaults to 20 and is bounded to 1..100; `limit=0`, `limit=1000` and a non-numeric value are 422s whose message names the range (`routes/catalog.js` `parseLimit`), because Fastify runs with `coerceTypes: false` and a querystring value is therefore a string the handler has to range itself.
2. **Category is DERIVED, never stored, and a product without a spec row is not a catalog product.** `CATALOG_CATEGORY_EXPRESSION` tests spec-table presence in `product_category` declaration order, with GPU reached through `product_variant` -> `gpu_board_spec`. The same expression drives the list and the detail, so a slug the list can never return is a 404 on the detail - and a product that exists but has no spec row is excluded from BOTH rather than served with a null category.
3. **`role` is the engine's vocabulary, translated through the API's one engine boundary.** `role=GPU` becomes `category = 'GPU'` via `engine.categoryForRole` (the candidates barrel's `expectedCategoryForRole`), so `RAM` maps to `MEMORY` and both SSD roles map to `STORAGE`; an unknown role is a 422 naming the accepted `component_role` values. The HTTP layer never restates the role list.
4. **`from_price` is the CHEAPEST ELIGIBLE offer, under the engine's own eligibility.** `CATALOG_OFFER_ELIGIBILITY_SQL` is shared verbatim by the list and the detail: `price > 0`, `availability <> 'OUT_OF_STOCK'`, and `last_checked_at >= now() - 30 days OR ingestion_record_id IS NULL`. The currency is exact and comes from `meta.CURRENCIES[0]` (MAD), never a literal in SQL. Ties break on `store_offer.id ASC`, the same total order `offers/select.js` uses, so the catalog and a build cannot disagree about which offer is cheapest. `last_checked_at` is `NOT NULL` (migration 009), so the expression cannot admit a NULL one; if it ever could, NULL would stay UNKNOWN rather than become a Decision 35 waiver.
5. **A price ALWAYS travels with its Decision 35 provenance.** The list derives `offer_class` in SQL from `ingestion_record_id`; the detail derives it in the presenter from the same column and serves each offer's class beside its price. There is no path that returns a price without a class.
6. **An unpriced product is LISTED, not dropped.** `has_offer: false` and `from_price: null` / `offer_class: null` say "no eligible offer yet". Silently omitting it would make a partial catalog look complete, and a `0` would assert a price the database never said.
7. **The detail's `price_status` is derived exactly as the recommendation response derives it**, with one extra outcome: `verified` only when the product HAS offers and every one is `VERIFIED`; `indicative` when any is not (an unrecognized class included - fail-safe by direction); `null` when there is no offer, because an empty offer list contradicts nothing and `verified` over it would be the one reading the field must never produce. The French `DISCLAIMER` is part of the detail contract, not a decoration a presenter may drop.
8. **A GPU's `specs` belongs to the VARIANT that was priced.** GPU board specs are variant-keyed, and one live GPU product has two variants, so the detail serves the spec of the variant the cheapest offer names (falling back to the lowest-id variant when there is no offer). Identity and audit columns (`product_id`, `product_variant_id`, `created_at`, `updated_at`, `id`) are stripped. `specs` is an OPEN object in the contract: its keys are the spec table's columns, and enumerating them would make every spec migration a breaking API change.
9. **There is NO `use_case` parameter, and that is a recorded deviation from the sprint sketch.** The active model exposes no per-use-case PRODUCT filter - `role_weights` are global and only `gpu_policy` varies - so the parameter could only be inert. This API refuses unknown query parameters; accepting one it would ignore would tell a client its results were narrowed when they were not. `docs/API.md` and the sprint's status block state the deviation with its reason.
10. **The crate is read-only and contract-pinned.** Both routes are 120/min, issue SELECTs over Layer 1 and Layer 3 only, and read/write no Layer 4 table. Contract **v1.5** was pinned byte-for-byte by `apps/api/test/unit/openapi-v1.5.json` (v1.4 was deleted in the same change) — **SUPERSEDED 2026-10-23:** Decision 51 added the price history, so the pin is now `openapi-v1.6.json` and v1.5 was deleted in that change; every route still declares `429`/`500` and the completeness gate still fails an undocumented one.

### Rejected alternatives

- **`OFFSET` pagination, or a cursor over `display_name`.** Rejected: names are not unique, so the page boundary can repeat or skip a row; `slug` is the only column with a uniqueness guarantee, and the cursor's comparison must be the same total order as the ORDER BY or a row can fall between pages.
- **A `(display_name, slug)` composite cursor.** Rejected: it adds a second key to buy nothing. Ordering by `slug` alone is already total and already the URL identity a client holds.
- **Filtering unpriced products out of the list.** Rejected: the catalog then silently reports a smaller world than the database holds, and a frontend cannot distinguish "not in the catalog" from "no price yet".
- **A migration adding `store_offer.offer_class`.** Rejected: the class is a pure function of `ingestion_record_id`, so a column would be a second source of truth that can drift; migration 018 already snapshots the class where immutability matters (`build_component`).
- **Hardcoding `MAD` in the statements.** Rejected: `meta.CURRENCIES` is the API's single currency owner, and the engine matches currency by exact equality. If a second currency is ever advertised, the catalog must gain a currency parameter in that same change, not a literal.
- **Serving `specs` per VARIANT as an array (or every variant).** Rejected for now: the sprint's shape is one object, and one object is coherent when it is the priced variant's. An array is a larger contract that no client asked for; the priced variant's spec makes the page internally consistent today.
- **A `use_case` parameter, as the sketch listed.** Rejected: see item 9. An inert filter on a public browse surface is worse than a refusal, because a client cannot tell it was ignored.

### Verdict for this pass

- **Unit - PASS.** `npm run test:api` **98 pass / 0 fail** (89 before: 8 route tests in `apps/api/test/unit/catalog.test.js` plus one v1.5 snapshot assertion), on Node 24.21.0 and on `npx -y node@22 --test "apps/api/test/unit/*.test.js"` (the version CI pins) with 0 cancelled.
- **Live read against the TEST branch - PASS.** `npm run test:api:db` **9 pass / 0 fail** (5 read-only catalog tests in `apps/api/test/db/catalog.db.test.js`, beside the 4 pre-existing write tests). The page walk with `limit=7` covered **100 products**, strictly ascending by slug, with no duplicate and none missing; `role=GPU` returned **21**; `from_price` equalled the detail's cheapest offer; and every seed page reported `price_status: "indicative"` with the disclaimer, which is correct and is not special-cased.
- **GPU variant coherence - PASS.** The live two-variant GPU product serves the spec of the variant its cheapest offer priced (the test rebuilds the expected spec from the database, with the same stripped columns).
- **Docs gates - PASS.** `npm run verify:docs` OK with `decisions-parse` at 48 headings / 54 `Status:` lines and `agents-decision-range` citing "Decisions 1-50"; `gen-decision-index --check` clean after regeneration.
- **No database writes.** No migration, no seed, no Layer 4 read or write. The DB suite is SELECT-only, so it has no residue to assert; the write suites own that check and were unaffected (9/0).

### Supersedes / superseded by

It supersedes no decision. It extends the API surface Decision 36 defines with two read-only paths, consuming Decision 35's provenance classes, Decision 37's "vocabulary belongs to the model" principle (hence no `use_case`), and migration 020's `slug`. It corrects `PLAN_PLATFORM_P2.md` Sprint 3's interface line in place (step 1-6 ticked, the `use_case` removal and the read-only DB suite recorded in its status block) and `docs/OPEN_GAPS.md` OG-52's P2 catalog clause. No dated banner anywhere is retro-edited.
## Decision 51 — a price history is one point per observation MOMENT, and its summary reports thin data instead of inventing a trend (S25 unblock)

Status: RESOLVED 2026-10-23; IMPLEMENTED 2026-10-23 — `GET /v1/catalog/products/:slug/price-history` serves a product's recorded observations oldest-first, with each point's Decision 35 provenance class and a summary whose change fields stay null until there are two observation moments; contract **v1.6**.

**UPDATE 2026-10-23 — S25's UI half SHIPPED, so three sentences below describe that pass only.**
`apps/web/components/price-history.tsx` now reads this route's `points` server-side and renders the three
data states — no reading, one reading, and a 2+ series with the chart, the min / max / latest rows and the
up / down / unchanged sentence — mirrored GEOMETRICALLY on `/ar` (direction is a prop, the axis grows toward
the inline end, and a spec reads the plotted points back off the rendered SVG), with the product page placing
it between the offers and the build appearances. Evidence: `apps/web/e2e/price-history.spec.ts` **13** specs
in both locales, the merged web suite **359 passed / 1 skipped** (up from 346), `check:api-types` at contract
**1.6.0 / 8 paths** with `schema.d.ts` byte-identical to the generator, and a live run against the shared
catalogue rendering « Un seul relevé : 3 200 DH, le 18 septembre 2026. » in French and the Arabic equivalent,
with no chart and no 360 px overflow.

The CONTRACT is unchanged by the UI half: no field, type, status, cap or ordering moved, so items 1-10 stand
exactly as written. Read the *Date* sentence "It does NOT build the chart", the *Verdict* bullet **NOT done
here**, and the "chart pending" phrasing in *Supersedes / superseded by* as the record of the API pass; this
paragraph supersedes all three. The data limit stated below still governs the UI, and it is DATA, not code:
every product's history is a single observation MOMENT today (99 of the 100 products carry exactly one row,
and the two-row product's rows share one instant), so the 2+ branches stay fixture-exercised until a second
ingestion sweep exists.

Date: 2026-10-23. S25 of `docs/plans/agent3-web-sprints.md` shipped its saved-builds half and left the price-history half blocked: `price_history` has existed since migration 009, but NO route read it, so a chart could only have plotted fixtures. This entry records the read contract the sprint needed. It is NOT an engine change — not one module under `src/recommendation/` is touched, no score, rank or persisted row changes — and it needs NO migration or seed: the table, its index and its 101 rows are already there. It does NOT build the chart; the UI half of S25 remains open, and the shape below is what it codes against.

### Current situation

- `price_history` (migration 009) is `id`, `store_offer_id` (NOT NULL, FK to `store_offer`), `price` (NUMERIC, `CHECK (price > 0)`), `currency`, `availability`, `observed_at` (TIMESTAMPTZ NOT NULL) and `created_at`. It has NO `product_id`; the product is reached through `store_offer.product_id`. `idx_price_history_store_offer_observed (store_offer_id, observed_at DESC)` is the only read index.
- Measured read-only on the shared database 2026-10-23: **101 rows over 101 distinct offers**, one currency (MAD), observed between **2026-09-18T22:33:23.358Z and 2026-09-27T00:25:51.593Z** — a nine-day window, i.e. ONE ingestion sweep, not a series.
- **100 products carry at least one row; 99 of them exactly one.** The single product with two rows (`rtx-4060-8gb`) has them at the SAME instant (3200 and 4800, from two stores and two variants) — a spread across variants, not a price move. Every other product's "history" is a single point.
- All 101 rows join an offer whose `ingestion_record_id` is NULL, so every historical price is `SEED_UNVERIFIED` under Decision 35 — derived, never assumed.
- Nothing in `apps/api/` read the table. The catalog routes (Decision 50) serve CURRENT prices only; `store_offer.last_checked_at` is one timestamp per offer and cannot reconstruct a series.

### Problem

A chart needs a read path, and the obvious one is wrong in two ways at once. Serving one point per `price_history` ROW makes the only multi-row product on this catalog draw a +50 % jump between two variants observed in the same second — a trend the catalog never observed. Computing the change over a single point as `0` asserts the price held, when the catalog simply has one observation. Both are the same defect this repository keeps closing: a number presented as knowledge the database never had.

There is also a scope temptation: `price_history` stores `availability`, so a route could recreate an "eligible offers" history. That would apply TODAY's 30-day freshness rule (and the Decision 35 seed waiver) retroactively and silently DELETE observations that were real when recorded — rewriting the past to describe the present.

### Decision

1. **The history is per PRODUCT, reached through `store_offer`, and that needs no migration.** `SELECT_PRICE_HISTORY_SQL` joins `price_history -> store_offer` on `store_offer_id` and filters `store_offer.product_id = $1`. A `price_history.product_id` column was rejected: it is derivable in one join, and a denormalized copy would need a backfill plus drift protection for no read win.
2. **ONE POINT PER OBSERVATION MOMENT, carrying that moment's CHEAPEST price.** Rows are grouped by `observed_at`, keeping the lowest `price` (and ITS `offer_class`); equal prices keep the repository's total order, so the pick is deterministic. This is an aggregation of OBSERVED rows: no point is invented, no gap is filled, no day is synthesized. The served `observation_count` is therefore the number of moments, not the number of rows.
3. **The series is ASCENDING by `observed_at`.** The statement orders `observed_at DESC, id DESC` with a `LIMIT`, so the cap truncates the OLDEST observations and keeps the most recent history; the presenter then sorts ascending (ISO-8601 strings compare lexicographically, and the sort is stable). "First -> last" is therefore before -> after, and a client can plot the array in order without sorting.
4. **EVERY POINT CARRIES ITS Decision 35 PROVENANCE.** `offer_class` is derived from the offer's `ingestion_record_id` by the same `offerClassFor` the list and detail use — never copied into `price_history`, never inferred from the row's age.
5. **THE SUMMARY IS NULLABLE WHERE THE DATA IS THIN.** `latest_price`, `min_price` and `max_price` need at least ONE moment; `change_amount` and `change_pct` need TWO DISTINCT moments and are `null` otherwise. `change_pct` is additionally `null` when the first price is not positive (the table's CHECK makes that unreachable today, and the contract does not rely on it). Both change fields are rounded through `toFixed(2)` so a delta of 0.1 is not served as 0.09999999999999998. `observation_count` is an integer and is never null: "none" is countable.
6. **NO HISTORY IS A 200 WITH AN EMPTY LIST; AN UNKNOWN PRODUCT IS A 404.** `points: []` plus an all-null summary says "this product exists and nothing has been observed yet", which the chart renders as a sentence. An unknown slug answers the SAME `{ error: "NOT_FOUND", message: "No product with that slug" }` envelope as the detail route, because an empty 200 would be indistinguishable from a product nobody has priced.
7. **Currency is exact and comes from `meta.CURRENCIES[0]` (MAD), never a SQL literal**, exactly as Decision 50 item 4 requires: the engine matches currency by exact equality, so a second advertised currency must arrive with a parameter, not a hardcoded string.
8. **Offer eligibility is deliberately NOT applied to historical rows.** The 30-day window and the Decision 35 seed waiver answer "may this offer be RECOMMENDED now", which is the detail route's question. Pruning history by them would delete observations that were real when recorded. The only filter is the table's own `CHECK (price > 0)`; a row whose NUMERIC will not parse is DROPPED rather than served as 0.
9. **One page, capped at 366 moments, with no window or paging parameter.** The route takes the slug and nothing else. A public chart needs the recent series, not an archive; an unbounded history would be a denial-of-service shape on a 120/min route, and a `since` parameter is a new contract to design when a real ingestion cadence exists — not a knob to guess now.
10. **Contract v1.6, pinned.** `apps/api/test/unit/openapi-v1.6.json` replaces `openapi-v1.5.json` (deleted in the same change). The route is 120/min like the rest of the catalog, declares its `429`/`500`, and is listed in the web client's `EXPECTED_PATHS` — so the completeness gate and `check:api-types` both fail if it disappears.

### Rejected alternatives

- **One point per `price_history` row.** Rejected on measured data: the only product with two rows has them at the same instant from two variants, so the series would open with a +50 % rise that never happened. A chart is read as a time series whether or not the data supports one.
- **A per-OFFER history (`/:slug/offers/:id/history`).** Rejected: the page is a product page, and a per-offer shape forces a client to join and then decide how to merge offers — the exact decision this contract makes once, in the open.
- **`change_amount: 0` for a single observation.** Rejected: it asserts the price held when the catalog observed it once. `null` is this repo's word for "not known", and the web chart has a first-class sentence for it.
- **Interpolating or forward-filling missing days.** Rejected: it invents observations. The summary and the chart both say "two points" when there are two.
- **Applying today's eligibility window to history.** Rejected: it rewrites the past to agree with the present, and would empty the series for a catalog that has not been re-ingested inside 30 days.
- **A `price_history.product_id` migration.** Rejected: derivable through `store_offer.product_id` in one join; a copy would need a backfill and a drift guard for no read-path benefit.
- **Paging or a `since`/`until` window now.** Rejected: no client needs it, and both would be contract surface guessed before an ingestion cadence exists. The 366-moment cap is the documented limit.
- **Deriving the series from `store_offer.last_checked_at` / `price`.** Rejected: one row per offer is a snapshot, not a series, and it would ignore the table that exists precisely to hold observations.

### Verdict for this pass

- **Unit - PASS.** `npm run test:api` **120 pass / 0 fail** (7 route tests in `apps/api/test/unit/price-history.test.js`: ascending points with numbers and summary, the one-observation null change, the empty 200, the 404, the cap, the dropped unparsable row, and the same-moment collapse), with the snapshot and coverage gates updated for v1.6. On Node 22.23.3 (the version CI pins) the same suite is also **120 pass / 0 fail, 0 cancelled**.
- **Live read against the TEST branch - PASS.** `npm run test:api:db` **10 pass / 0 fail** (the new read-only test rebuilds the expected series from the database - cheapest price per instant, ascending - and asserts the served points match it, every class is `SEED_UNVERIFIED`, and the unknown-slug 404). The suite is SELECT-only and writes nothing, so it has no residue to assert.
- **Web contract gate - PASS.** `npm run check:api-types` reports contract **1.6.0, 8 paths**, `schema.d.ts` byte-identical to the generator output after `npm run gen:api-types`.
- **Docs gates - PASS**: `npm run verify:docs` and `npm run gen:decisions` clean; this entry is the 49th heading and the 55th `Status:` line.
- **No database writes.** No migration, no seed, no Layer 4 read or write.
- **NOT done here:** the chart itself. S25's UI half is handed to a separate worker against this frozen shape; this decision unblocks it and does not claim it.

### Supersedes / superseded by

It supersedes no decision. It extends the catalog surface Decision 50 defines with one read-only path, reuses Decision 50's currency rule and its open-eligibility split, and consumes Decision 35's provenance classes. It corrects S25's status block in `docs/plans/agent3-web-sprints.md` in place (the price-history half moves from BLOCKED to "API unblocked, chart pending") and the board's state paragraph. No dated banner anywhere is retro-edited.
## Decision 52 — each accepted input has ONE reader, and every reply states what it changed (input effects, contract v1.7)

Status: RESOLVED 2026-10-24; IMPLEMENTED 2026-10-24 — `use_case`, `resolution` and `priority` are documented by the ONE reader each has, `GET /v1/meta/options` serves `inputs_applied` (the deployment fact), and both recommendation verbs serve `input_effects` (the per-pass fact) in the closed vocabulary `APPLIED | NO_EFFECT | UNKNOWN`; contract **v1.7**, no migration.

Date: 2026-10-24. The API has accepted and persisted all three inputs since Decision 36, and for most of that time the docs called `resolution` and `priority` "accepted but inert". The engine stopped deserving that word in October 2026; the API kept saying nothing, and the only client-facing statement left was the wizard's caveat that the answer is "recorded, not used". This entry makes the statement true and per-pass instead of removing it.

### Current situation

- **Every input has a reader.** `priority` has ordered the archetypes since Decision 41 (2026-10-10, `ranking/select-archetypes.js`); `resolution` has multiplied the GPU spend target since Decision 39 (`retention/targets.js`) and gated a declared VRAM floor since Decision 42 (`assembly/assemble.js`); `use_case` has selected the declared `gpu_policy` since Decision 43 (`assembly/gpu-policy.js`) and the per-role spend targets since Decision 37.
- **The prose lagged.** OG-38 and `docs/ENGINE_BEHAVIOR_FINDINGS_2026-10.md` were corrected on 2026-10-23, but `docs/API.md` still said "accepted but inert" in two places and its POST field table still described the effect as unmeasurable.
- **The read path could not answer the question.** `SELECT_QUERY_SQL` fetched `id, budget_amount, currency, use_case, created_at` plus 019's and 021's facts - it did NOT select `resolution`, `priority`, `scoring_model_id` or the pinned model's configuration, although all four columns exist. Nothing in a response distinguished "this model never reads resolution" from "this resolution did nothing" from "this pass did not record enough to tell".
- **The web app was built for the missing field.** `apps/web/lib/wizard/applied.ts` reads an absent `inputs_applied` off `meta/options` and distinguishes silence (`null`) from an empty list; `docs/plans/agent3-web-plan.md` records that as CD-1. `lib/result/reasons.ts` reads an absent `reasons[]` (CD-2), whose `INPUT_APPLIED` code is the closest existing statement - and it says the inputs were "applied" without saying what any of them changed.

### Problem

Two different questions were being answered with one word. "Does this deployment read `resolution` at all?" is a property of the ACTIVE scoring model's configuration: a model declaring no `use_case_profiles` and no `resolution_profiles` has no reader, so the honest product behaviour is to stop asking. "Did MY resolution change THIS answer?" is a property of one pass, and for `resolution` it is provable only in the negative - the multiplier is exactly 1.0 (the GPU target is byte-identical to the one an omitted resolution produces) or the model declares no reader. `priority` is neither inert nor a re-order of a fixed set: it decides which strategy is tried FIRST, and because each pick claims a (CPU, GPU) pair (Decision 41) it also decides which archetype claims a contested pair. One boolean, or one field served on both surfaces, would have collapsed these into a claim the data cannot support.

### Decision

1. **Each input has exactly one documented reader, and that table IS the contract.** `use_case` -> `use_case_profiles[use_case]`: `gpu_policy` (Decision 43) and `spend_targets` -> per-role targets (Decision 39); with no profile, the legacy `gpu_required_use_cases` list still decides the GPU requirement. `resolution` -> the **GPU** multiplier only (1080p 1.0 / 1440p 1.25 / 2160p 1.5 in `retention/targets.js`) plus a declared `resolution_profiles[resolution].vram_floor_gb` (Decision 42). `priority` -> `strategyOrder`, which fixes which strategy is tried first and which archetype claims a contested pair (Decision 41). NONE of them reaches Engine 4's arithmetic, and none is a scoring weight.
2. **TWO fields, because there are two questions.** `inputs_applied` (a frozen string list) is served on `GET /v1/meta/options` and names the inputs the ACTIVE model reads at all. `input_effects` (three `{ input, effect, reason }` records, always in the order `use_case`, `resolution`, `priority`) is served on both recommendation verbs and answers for one pass. Different shapes on purpose: a form needs a list to stop asking a question, a result page needs a sentence per input.
3. **The effect vocabulary is closed and three-valued: `APPLIED | NO_EFFECT | UNKNOWN`.** `APPLIED` = the input was read AND shaped this pass (a declared profile selected, the GPU target scaled away from neutral, a declared VRAM floor selected, a NON-DEFAULT archetype order selected - `priority` 3 is `NO_EFFECT`, because `strategyOrder(3)` is byte-identical to the omitted case). It does NOT claim the top build would have differed: no counterfactual is persisted, so the API does not assert one. `NO_EFFECT` = provably could not change this pass, with the proof named by `reason`. `UNKNOWN` = the facts were not recorded. NULL means UNKNOWN, and UNKNOWN is never reported as either of the others.
4. **The reason list is closed to the writers and open on the wire.** Thirteen codes: `USE_CASE_PROFILE`, `GPU_POLICY_ONLY`, `VRAM_FLOOR`, `GPU_TARGET_SCALED`, `NEUTRAL_MULTIPLIER`, `NO_GPU_TARGET`, `NO_RESOLUTION_POLICY`, `STRATEGY_ORDER`, `DEFAULT_ORDER`, `NO_BUILDS`, `NOT_PROVIDED`, `NOT_RECORDED`, `UNRECOGNISED_VALUE`. `input` and `effect` are literal unions in the OpenAPI document; `reason` is a string, so a new explanation does not force a client-side contract bump - a client maps it and falls back to the effect's generic sentence, never printing the code (the rule `lib/result/reasons.ts` already states for `reasons[]`).
5. **Derived on the READ path, from the pass's OWN rows.** `SELECT_QUERY_SQL` now also reads `resolution`, `priority`, `scoring_model_id` and `scoring_model.configuration` (LEFT JOIN on the PINNED id). POST and GET therefore report the same three records by construction, and a pass whose model row is gone reads UNKNOWN rather than borrowing the currently active model's configuration - the failure mode `scoring_model_id` exists to prevent. No migration: every column already exists.
6. **The arithmetic has ONE owner.** `apps/api/src/inputs.js` is pure and takes the multiplier as an argument; `apps/api/src/engine.js` forwards `retention.resolutionMultiplier` from that stage barrel (a fifth permitted barrel, pinned exactly by `import-boundary.test.js`). A second copy of the table would let the served claim and the retention arithmetic disagree.
7. **An omitted optional input is reported, not dropped:** an absent `resolution`/`priority` is `NO_EFFECT` / `NOT_PROVIDED`, so the array is always three records and a client never has to infer which question its user skipped.
8. **`inputs_applied` is ADVISORY.** It never rejects a value: an input the list omits is still accepted by POST and still recorded on the query row. `resolution` is omitted only when nothing can read it (no GPU spend target AND no `resolution_profiles`), which is what turns the wizard's "recorded, not used" caveat off and hides that step.
9. **Web halves.** `apps/web/lib/wizard/applied.ts` already implemented the gate; serving the field flips it with no new wizard code. `apps/web/lib/result/inputs.ts` + `components/result/inputs-applied.tsx` render the per-pass records on the results page in French and Arabic, where silence (a 1.6 server) renders nothing, an unknown reason falls back to the effect's sentence, and the block appears on a zero-build pass too - "resolution was not used" is exactly the fact a user staring at an empty result needs.
10. **Contract v1.7, ADDITIVE.** `apps/api/test/unit/openapi-v1.7.json` replaces `openapi-v1.6.json` (deleted in the same change); no path and no existing field changed. `check:api-types` pins 1.7.0 / 8 paths and regenerated `lib/api/schema.d.ts`.

### Rejected alternatives

- **One field named `inputs_applied` on both surfaces.** Rejected: the list answers a deployment question and the record answers a pass question, and one name invites a client to read "this model reads resolution" as "your resolution did something".
- **A boolean per input (`applied: true | false`).** Rejected: it cannot express "it had no effect, and here is why" versus "we cannot tell", and those are different facts.
- **Persisting the effects in a new column (a migration 023).** Rejected for this pass: everything needed is already persisted (the query's inputs, its pinned model, the builds' strategy keys), so a column would duplicate derivable data and need a backfill. It becomes the right answer only when a fact is needed that the rows do not carry - e.g. the retained candidate set, which is what a counterfactual would require.
- **Calling `APPLIED` "changed the result".** Rejected: unprovable without a second engine pass, and a stronger claim than the persisted rows can support.
- **Borrowing the ACTIVE model for a pass whose model row is gone.** Rejected: it retro-fits today's policy onto an older pass.
- **Serving the effects only on POST.** Rejected: a result id is a durable reference, and GET is the revisiting path (Decision 36 item 4).
- **Duplicating `RESOLUTION_MULTIPLIERS` in the API.** Rejected: two tables can disagree, and this claim IS about arithmetic.

### Verdict for this pass

- **API unit suite - PASS.** `npm run test:api` **138 pass / 0 fail**, including `apps/api/test/unit/inputs.test.js` (every reason in the table, the silence-vs-empty rule, and the cross-check that a deployment never advertises an input it then calls unread), `contract.test.js` (POST/GET agreement and the LEFT-JOIN-miss UNKNOWN case), `meta-consistency.test.js` (an omitted input is still ACCEPTED) and the OpenAPI snapshot at 1.7.0.
- **Web - PASS.** `npm run typecheck`, `lint`, `check:api-types` (contract 1.7.0 / 8 paths), `check:i18n` (identical keys and placeholders in fr/ar), `build`, and the merged Playwright suite **364 passed / 2 skipped (366 specs)**, including the new `e2e/inputs-applied.spec.ts` (3 parser specs + 2 rendered-block specs in both locales). Three zero-build specs were scoped by heading NAME in the same change, because the page now carries a second level-2 section.
- **Docs - PASS.** `npm run verify:docs` (this entry is the 50th heading and the 56th `Status:` line) and `npm run gen:decisions` clean after regeneration; `docs/API.md`'s two "inert" claims are replaced by *What each input changes*.
- **No database writes.** No migration, no seed, no Layer 4 row; the API's read path adds columns that already exist.

### Supersedes / superseded by

It supersedes the "accepted but inert" reading of `resolution` and `priority` in `docs/API.md`, and completes OG-38's DOCUMENTATION half - the row stays OPEN for its behavioural observation (the catalog still exposes too few distinct (CPU, GPU) pairs for the inputs to move the top build). It consumes Decision 36 (the API contract), Decision 37 (per-use-case profiles), Decision 39 (the GPU multiplier), Decision 41 (archetype order), Decision 42 (the VRAM floor), Decision 43 (`gpu_policy`) and Decision 44 (`INPUT_APPLIED`, whose read-path-servable idea it generalises into a per-input contract). It supersedes nothing else, and no dated banner is retro-edited.


## Decision 53 — E5 is ACTIVE: a served scoring model declares the reviewed per-resolution VRAM floors, so the Decision 42 rule stops being inert

Status: RESOLVED 2026-10-24; IMPLEMENTED 2026-10-24 — `launch-v2@2.0.0` is `launch-v2@1.0.0`'s configuration plus `resolution_profiles` (1080p 8 / 1440p 12 / 2160p 16 GB), with BOTH versions active on the TEST branch, so the Decision 42 floor now skips below-floor GPUs on the served model and the A4 floor rows are green; the floors are hypotheses no longer.

Date: 2026-10-24. Closes OG-47 (E5's rule was inert because no model declared the key) and completes E5 in `docs/briefs/engine.md`. NOT a migration, no engine code change, no compatibility-verdict change: it is a SCORING-MODEL seed (`database/seeds/018_scoring_model_launch_v2_resolution_profiles.sql`) plus the review that fixes the values. The shared database is deliberately untouched and stays on `seed-minimal-v1`.

### Current situation

- Decision 42 shipped `assembly/assemble.js` `belowVramFloor`, `scoring/configuration.js` `validateResolutionProfiles` and `orchestrator/run.js` `resolveVramFloorGb`, all OPTIONAL-by-construction. Before this decision no row in `scoring_model` declared `resolution_profiles`, so every pass took the pre-E5 walk and the floor changed no served output — OG-47.
- The three values had never been reviewed: 1080p 8 GB / 1440p 12 GB / 2160p 16 GB were the brief's hypothesis, asserted by `A4_vram_floor_gb` while the served models declared nothing, so the golden assertion judged a policy nothing used.
- `launch-v2@1.0.0` (seed 013) already carries `use_case_profiles`, `candidate_caps`, weights and staleness on the TEST branch; `scripts/lib/model-pin.js` resolves a model by `name@version` among ACTIVE rows, which is what makes an A/B against an unchanged engine possible.

### Problem

A rule that only fires when a model opts in cannot be called implemented while no served model opts in: E5's acceptance would rest on a unit test rather than on an observable recommendation change, and A4's floor rows would stay EXPECTED-RED for a reason that looks like an engine defect. Mutating `launch-v2@1.0.0` in place is not available either — every golden artifact, gap row and decision records its pin, so changing 1.0.0's configuration would make one identity mean two policies and silently invalidate that evidence.

### Decision

1. `database/seeds/018_scoring_model_launch_v2_resolution_profiles.sql` INSERTs `launch-v2` `2.0.0` as `1.0.0`'s configuration copied with the JSONB `||` operator plus exactly ONE new key, `resolution_profiles` = `{ "1080p": { "vram_floor_gb": 8 }, "1440p": { "vram_floor_gb": 12 }, "2160p": { "vram_floor_gb": 16 } }`. Nothing else differs, so a pinned A/B isolates the floor.
2. Both `1.0.0` and `2.0.0` stay `is_active = true` on the TEST branch. A pin is a SELECTOR, never an activation (`scripts/lib/model-pin.js`), so every existing `--model=launch-v2@1.0.0` command keeps resolving, and the API serves `2.0.0` as the newest active row (`ORDER BY created_at DESC, id ASC`).
3. The values are the H3-REVIEWED floors, not new guesses: they are the `A4_vram_floor_gb` values, approved 2026-10-24 (`docs/ENGINE_HYPOTHESIS_REVIEW_2026-10-24.md`, `test/golden/CHANGELOG.md`). A future value change belongs in a NEW version, never an edit to this row.
4. The seed is DML-only and idempotent (`NOT EXISTS` guard on `name = 'launch-v2' AND version = '2.0.0'`); it opens no transaction of its own so it can be rehearsal-wrapped. It does not touch any `cooler_spec` / `ram_spec` / `case_spec` / `motherboard_spec` row, so the Decision 26 `check-deferred-rules.js` trigger does not apply.
5. TEST-branch-first, and only there. A shared apply would change the model the shared database serves and needs its own owner-gated decision; the shared database stays on `seed-minimal-v1`.

### Rejected alternatives

- **Updating `launch-v2@1.0.0` in place.** Every recorded result names its pin (`launch-v2@1.0.0` appears in the golden artifacts, gap rows and Decisions 39-43); mutating the row would make the same identity mean two policies and invalidate that evidence retroactively. The recipe (`docs/RECIPES/add-a-scoring-model-version.md`) requires a new version.
- **A second model that declares `resolution_profiles` but drops `use_case_profiles`.** It would change two dimensions at once, so the A/B could no longer attribute a moved row to the floor.
- **Deactivating 1.0.0 so only 2.0.0 serves.** The pin fails closed on an INACTIVE row, so deactivating 1.0.0 would break every pinned command and the committed evidence those commands reproduce — for no behavioural gain, because the API already prefers the newest active row.
- **Hardcoding the floors in engine code.** Decision 42 already rejected this: policy belongs to the model's declared vocabulary, and a code default would silently bind every future model.
- **Declaring only the resolutions the golden suite exercises.** A profile set that omits `2160p` would silently disable the floor for any 4K query while looking implemented; all three reviewed resolutions are declared.

### Verdict for this pass

- **Seed applied to the TEST branch - PASS.** `launch-v2@2.0.0` resolves through `scripts/lib/model-pin.js`; `1.0.0` still resolves; both are active.
- **Observable engine change - PASS, differentially.** A filtered golden run at `launch-v2@2.0.0` moves A4 S06 from FAIL to PASS: before the seed the 1440p walk still reached an 8 GB card against a 12 GB floor, after it the walk skips that branch and selects a 16 GB card. S04/S05/S07-S09 are unchanged, which is the control that the edit is the floor and nothing else.
- **Every A4 floor row green - PASS.** S04 12 GB / floor 8, S05 16/8, S06 16/12, S07 12/12, S08 16/12, S09 16/16. A4's SEPARATE strict-pair clause (S05/S09 both 11500 MAD) still fails and stays an unreviewed hypothesis; the floors themselves are approved.
- **Unit - PASS.** `npm run test:unit` 1185 pass / 0 fail on Node 24, re-run on Node 22 with 0 cancelled. No engine code changed, so this is regression evidence only.
- **NOT done here:** the committed golden baselines are not regenerated (they predate Decision 41 as well as this change; rebaselining is a review-gated act), and no shared-DB apply.

### Supersedes / superseded by

Amends Decision 42: its Status line said "no ACTIVE model declares `resolution_profiles` today, so the shipped state is provably inert" — that is now historical, and Decision 42's rules 1-7 stand unchanged. It supersedes nothing else; the `use_case_profiles` half of E1/E6 (Decision 37/43) is untouched.

## Decision 54 — a DECLARED `IGPU_ALLOWED` policy narrows retention's CPU pool, so the E6 omit path becomes reachable

Status: RESOLVED 2026-10-24; IMPLEMENTED 2026-10-24 — under a declared `IGPU_ALLOWED` the CPU candidates without a verified integrated GPU are dropped before ordering, the Decision 27 reservation and the K cap; every other policy and role keeps its pool byte-identically. A6 is now green at S17/S18/S19 and OG-49 is closed.

Date: 2026-10-24. Closes OG-49 (E6's acceptance was unreachable because retention never handed the walk an iGPU CPU) and completes E6 in `docs/briefs/engine.md`. NOT a migration, no seed, no compatibility-verdict change: it is an OPTIONAL retention input plus the orchestrator wiring that resolves the policy ONCE.

### Current situation

- Decision 43 made the DECLARED per-use-case `gpu_policy` real at Engine 3 GPU depth: `IGPU_ALLOWED` + `cpu_spec.integrated_gpu_present === true` takes the omit path exclusively. Per CPU the rule was correct and unit-tested.
- Retention chose which CPUs reached that walk: `retention/retain.js` kept the top-K by Rule 3/5 order plus Decision 27's cheapest reservation, i.e. by score and price. On the TEST branch 12 of 18 CPUs carry `integrated_gpu_present = false`, and the score leaders are among them; the OFFICE rank-1 CPU was `Seed AMD Ryzen 5 5500` (899 MAD, no iGPU).
- So the declared policy resolved to `REQUIRED` for the build that mattered, OFFICE kept recommending discrete-GPU builds (S19: 2 selected builds, `cpu_integrated_gpu_present false`), and A6 could never be green — OG-49. The catalog was never the blocker: 6 CPUs carry `integrated_gpu_present = true`.

### Problem

E6's acceptance is about the RECOMMENDATION, not about one CPU's walk: "OFFICE: no discrete GPU; the chosen CPU has an integrated GPU". A rule that can only fire for CPUs retention never selects changes no observed output, so E6 would stay an implemented-but-unreachable contract — the same class of defect OG-47 recorded for E5. Ordering the walk per CPU cannot fix which CPUs reach it.

### Decision

1. `retention/igpu-pool.js` adds the pure `excludedCpuProductIds({ gpuPolicy, filteringContext })`: `null` for any policy other than a declared `IGPU_ALLOWED`, else a FROZEN array of unique product-id strings, code-unit sorted (never `localeCompare`), naming every CPU candidate whose `p:<id>` spec is missing or whose `integrated_gpu_present` is not strictly `true`. The set is derived from the FILTERING CONTEXT's CPU candidate list, not from the spec map's keys, so a spec-less CPU candidate is excluded rather than silently kept.
2. Under a policy that says the CPU supplies the graphics, a NULL/absent flag is UNKNOWN and therefore EXCLUDED: absence of evidence is not evidence of an iGPU. (Today no catalog row is NULL — 6 true / 12 false — but the semantics must not depend on that.)
3. `retention/retain.js` `retainTopKPerRole` takes an OPTIONAL `roleExclusions` map (role -> array or Set of product-id strings) and drops an excluded candidate BEFORE Rule 2 ordering, the Decision 27 cheapest-per-role reservation and the Rule 4 K cap, so it can never win a slot, a price band or a top-up. A malformed map fails fast through the existing `CandidateSelectionError` vocabulary; absent/null is byte-identical to the pre-E6 behaviour for every model and role.
4. `orchestrator/run.js` resolves the policy ONCE (`resolveGpuPolicy`) and passes the SAME value to retention (`roleExclusions.CPU`) and to Engine 3 (`gpuPolicy`). One reader of the configuration, two consumers of one decision — the constraint is not re-derived, and a second `resolveGpuPolicy` call was removed rather than kept.
5. The exclusion is RECOMMENDATION policy, not a compatibility verdict: no candidate REJECT, no `build_rejection` row, no reason code, no verdict-baseline change. Engine 3 still owns the per-CPU GPU decision (Decision 43 rules 1-6 unchanged); retention only decides WHICH CPUs can reach it.
6. Determinism: no clock read, no randomness, no input mutation; identical DB state + query + model version yield identical retained sets. A model that declares no profile, and every non-CPU role, is byte-identical to pre-E6.
7. The `retention` barrel exports `excludedCpuProductIds` as the module's public boundary (`src/recommendation/retention/index.js`), pinned by the barrel-contract test like every other export.

### Rejected alternatives

- **Prefer an iGPU CPU inside `assembly/gpu-policy.js`.** The decision is per selected CPU and the walk visits CPU candidates in retained order; a policy-aware preference there would still leave the iGPU CPU outside the capped K, so the omit path would remain unreachable. It also gives the policy a second semantic (preference vs eligibility) in the stage that must stay a pure per-CPU decision.
- **Reject non-iGPU CPU candidates in Engine 2 (`filtering/`).** It would turn a recommendation policy into a compatibility verdict and move the pinned verdict baseline (87 PASS / 12 UNKNOWN / 2 REJECT) on model policy alone, contradicting Decision 12's verified-deficit-only exclusion.
- **Tune `use_case_profiles.OFFICE.spend_targets` or the archetype weights until an iGPU CPU wins by score.** It is score-dependent, brittle to any assessment change, and does not state the contract — the same data would still let a non-iGPU CPU back in. "Never tune a threshold to make a scenario pass" applies to weights as much as to thresholds.
- **Lower the OFFICE scenario budgets instead.** S17 at 4000 MAD assembles nothing at all (the cheapest iGPU build is 5277 MAD), so it could never exercise the path; that correction was made for what it is (see the H3 review), not as a substitute for the engine fix.
- **A fallback that re-walks discrete GPUs when the omit path builds nothing.** Decision 43 rule 3 already establishes that omitting the GPU can only relax the walk, so such a fallback could never fire; adding it here would only add a second owner to the constraint.

### Verdict for this pass

- **E6 acceptance - MET.** Measured on the TEST branch at `launch-v2@2.0.0`, filtered and then full golden runs: 12 non-iGPU CPUs excluded; all 5 retained CPU slots are iGPU parts at 6000 / 8000 / 10000 MAD; 25 GPU-less builds at each rung; A6 PASS at S17 (ratio 0.515), S18 (0.675) and S19 (0.853), with 0 selected builds carrying a discrete GPU and `cpu_integrated_gpu_present true` on the rank-1 build at all three. The same three rows are ALSO green at `launch-v2@1.0.0` (filtered re-run, exit 0): the exclusion is engine code, not configuration, so this is a fix to how CPUs reach the walk rather than a policy a model opts into.
- **Unit - PASS.** `npm run test:unit` **1185 pass / 0 fail** on Node 24, re-run on Node 22 with **0 cancelled**; `npm run test:scripts` 363/0. New pins: the `igpu-pool` matrix (null for REQUIRED/absent, exclusions for a declared `IGPU_ALLOWED`, NULL/missing spec excluded, deterministic code-unit order, malformed inputs fail fast), `retain` `roleExclusions` (excluded before ordering/reservation/cap, array and Set accepted, malformed map refused, null byte-identical), the barrel export, and the orchestrator passing ONE resolved policy to both consumers.
- **Golden - PASS.** Full 20-scenario suite: 86 rows, 66 PASS / 19 EXPECTED-RED / 1 UNKNOWN, exit 0, residue `{q:0, bc:0, comp:0, res:0, rej:0}` at `launch-v2@2.0.0`; the 19 EXPECTED-RED rows are exactly the unreviewed A1/A3/A4 hypotheses and no approved assertion failed.
- **Price bound recorded, not hidden.** A6's third clause was corrected 0.40 -> 0.90 in the same pass with its arithmetic (`docs/ENGINE_HYPOTHESIS_REVIEW_2026-10-24.md` §5.3): 0.4 x 11596 = 4638 MAD is below the 5277 MAD iGPU build floor, so the brief's number was unsatisfiable once the path existed. The bound now asserts that an OFFICE recommendation never costs as much as the GAMING reference; that OFFICE builds still spend up to their own budget is the OG-38 residual, recorded rather than papered over.
- **Gate safety.** `test/golden/scenarios.json` moved `current_epic` E1 -> E8 in the same change, so the S17/S18 UNKNOWN escalation is armed — safe only because both scenarios now build and A6 is green. S17's budget moved 4000 -> 6000 (below 5277 nothing assembles at all) and S18's 6000 -> 8000 to keep three distinct rungs.
- **NOT done here:** no shared-DB apply, no API change, and no rebaseline of the committed golden files.

### Supersedes / superseded by

Partly supersedes Decision 43's REJECTED alternative #3 ("Read the policy in retention and reserve a slot for an iGPU CPU: it would give one constraint two owners"). That rejection was right about ownership and wrong about reachability: retention now answers a NARROWER question (which CPUs may reach Engine 3) from the SAME single resolved policy, while Engine 3 keeps the per-CPU GPU decision — one reader, two consumers, no second derivation. Decision 43's Status line ("The rule is UNREACHABLE on today's catalog") is historical and was updated in place; rules 1-6 stand unchanged.

## Decision 55 — a swap PREVIEW is a read-only evaluation: the engine owns the verdict and the persisted pass stays a record

Status: RESOLVED 2026-10-25 — CD-8 is ONE read-only evaluation route backed by ONE new pure Engine 3 export over the SAME pairwise-check table assembly uses; nothing is persisted, no build row is rewritten, and a mutating "commit swap" is explicitly left to its own future decision (answered 2026-10-26 by Decision 56, which APPENDS a derived build instead of editing the pass). IMPLEMENTED 2026-10-25 in three parts: the ENGINE HALF (`assembly` `evaluateBuildReplacement` + agreement tests), the ROUTE (contract v1.8.0, `orchestrator/swap-preview.js` + `GET /v1/recommendations/:id/builds/:rank/swap-preview`), and S24's UI (`apps/web/components/result/swap-panel.tsx`, contract v1.9 for the catalogue variant identity it needs).

Date: 2026-10-25. Defines CD-8 (`docs/plans/agent3-web-plan.md` §2.1), the contract S24 was waiting on, BEFORE any code exists, so the engine, the API and the web UI cannot invent three versions of "swappable". It closes no gap row: it is the missing contract, not a defect fix. NOT a migration, no seed, no engine behaviour change until the export lands, and NOT the mutation that would persist a swapped build (item 9).

### Current situation

- A pass is a RECORD with a stable address: `recommendation_result` is unique on `(recommendation_query_id, rank)` (`uq_recommendation_result_query_rank`), the build's total is `build_candidate.total_price`, and each part is one `build_component` row per role (`uq_build_component_role_singular`) carrying `product_id`, `product_variant_id`, `selected_price`, `offer_class` and `store_offer_id` (Decision 35's provenance snapshot). Decision 46 adds `engine_version` / `strategy_key` per rank; Decision 47 adds `catalog_version` per query.
- The API serves those builds on POST and GET through ONE read path (`apps/api/src/repository.js` `readRecommendationResult`), addressing a build by `rank`: the contract has no build id (Decision 36, contract v1.7).
- Compatibility: `src/recommendation/compatibility/index.js` exports the per-relationship resolvers, but the RELATIONSHIP GRAPH — which role is checked against which, its canonical left/right, and which role's entry owns the check — is private to `src/recommendation/assembly/assemble.js` (`PAIRWISE_CHECKS`, line 479). The table is keyed by the LATER-picked role, so a role can be a key (MOTHERBOARD, RAM, PSU, CASE, CPU_COOLER) or only ever a partner: CPU keys no check at all, and its `cpu_motherboard`, `platform_memory`, `cooler_socket` and `cooler_tdp` verdicts live in other roles' entries.
- Assembly rejects only FAIL; UNKNOWN stays eligible and is COUNTED, not judged (`firstPairFailure`, `countBuildLocalUnknownPairs`, `aggregateCompatibilityResults`; Decision 16). A candidate's own eligibility (offer window, seed waiver, availability) is produced upstream by filtering and offer selection (Decisions 7, 35), never by assembly.
- No route evaluates a hypothetical build. `build_component` is mutable at the schema level (Layer 4 reconciliation item 28) but no API path writes it after the pass, and the production role holds no row-wide UPDATE on the Layer 4 write tables by design (Decision 46).

### Problem

S24 asks a UI to offer a replacement and to surface the API's compatibility warnings and price delta. Three implementations are available today and two of them are wrong:

1. **Re-derive compatibility in the web layer.** The pairing graph and the E8 support-table reads live in the engine; restating them in `apps/web` creates a second vocabulary that WILL drift, and the import boundary (`apps/api/test/unit/import-boundary.test.js`) exists to forbid exactly that.
2. **Mutate `build_component` in place.** A persisted pass would stop being the record it claims to be: `rank`, `strategy_key`, `engine_version`, the dedupe key (Decision 47/48), the presets that point at it and the golden harness's fingerprints all describe the ORIGINAL assembly. A later reader could not tell an engine-produced build from an edited one, and the role has no row-wide UPDATE precisely so this cannot happen quietly.
3. **"Just re-run the pass with a role pinned."** Assembly walks `EXPANSION_ORDER` and has no pin mechanism; adding one changes every caller's semantics, and a re-run produces a NEW pass with new scores and a new rank, not a preview of this one.

Nothing decided what the endpoint answers, which layer owns the verdict, or whether the pass may change. Without that, S24's control stays disabled forever or someone invents (1).

### Decision

1. **One pure engine export owns the verdict.** `assembly` gains `evaluateBuildReplacement({ picked, filteringContext, role, candidate })` returning a frozen `{ status, pairs, unknown_pairwise_count }`, where `status` is PASS | UNKNOWN | FAIL by `aggregateCompatibilityResults` over `pairs` and each pair is `{ check, role, partner_role, status, reason, evidence }`. It MUST read the SAME `PAIRWISE_CHECKS` table as `assembleBuilds` — extracted to one module-level owner in `assemble.js`, never copied — and MUST evaluate EVERY check whose pair includes the replaced role in EITHER position. The CPU is the proof case: replacing it re-runs no CPU-keyed check, because CPU keys none; its whole verdict comes from the MOTHERBOARD, RAM and CPU_COOLER entries that name it as partner.
2. **The endpoint is a GET and is READ-ONLY.** `GET /v1/recommendations/:id/builds/:rank/swap-preview?role=<ROLE>&product_id=<uuid>[&product_variant_id=<uuid>]`. GET because the operation is a pure function of (persisted build, live catalog) with no body and no side effect, and it keeps the catalog routes' CORS/429 semantics with no preflight. `role` is validated against the assembly barrel's `EXPANSION_ORDER`, never a list restated in `apps/api`.
3. **Three facts in the response, and nothing else.** `compatibility` (item 1), `price` (`previous`, `next`, `delta`, `offer_class`, `price_status`) and `budget` (`budget_amount`, `total`, `delta`, `within_budget`). `previous` is the served component's `price_used`; when it is null, `previous` and `delta` are null, NEVER 0 (the standing NULL != 0 rule). No re-ranked list, no new `strategy_key`, no "updated build".
4. **Eligibility and price are the engine's.** The candidate is resolved through the same filtering and offer-selection path a pass uses (the 30-day window, the Decision 35 seed waiver, `lookupPrice`); an ineligible candidate is a `FAIL` carrying the filtering reason and a null price, never a silently priced component. `offer_class` and `price_status` travel with the price so a client can say what kind of number it is showing (V6).
5. **UNKNOWN is reported, never collapsed.** A FAIL verdict is a 200 RESULT, not an error; each pair keeps its reason code; `unknown_pairwise_count` is reported; and a client MUST NOT render UNKNOWN as compatible (the standing UNKNOWN != PASS rule, applied to a response field).
6. **Nothing is persisted.** No INSERT/UPDATE/DELETE, no `recommendation_query` row (the golden harness refuses unmarked rows), and no dedupe or preset interaction. No migration and no new grant: `morocco_pc_api`'s SELECTs plus its three column-scoped UPDATEs are exactly enough.
7. **Reproducibility is on the wire.** The response carries `catalog_version` (Decision 47) and the answering `engine_version`, and it is served `Cache-Control: no-store`: the verdict is a function of the live catalog AND the persisted build, so a cached copy could outlive either.
8. **Contract v1.8.0** adds exactly one path and no field on any existing response; `apps/api/test/unit/openapi-v1.8.json` replaces v1.7 (one snapshot in the tree, per the standing rule), the coverage gate declares 200/404/422/429/500, and `apps/web`'s `check:api-types` follows.
9. **A mutating swap is OUT of scope, deliberately.** Persisting a swapped build needs its own decision covering pass immutability, the dedupe key, presets and rank / `strategy_key` invalidation. The preview MUST NOT be used to fake it, and S24's DoD forbids simulating a swap.

### Rejected alternatives

- **Mutating `build_component` / `recommendation_result` in place.** Loses "a pass is a record" (rank, `strategy_key`, `engine_version`, the dedupe key, preset pointers, golden fingerprints), and the role's grants forbid it by design. Re-opening that needs the separate decision in item 9, not a convenient endpoint.
- **Client-side compatibility.** Two vocabularies for one rule set, including E8 support-table reads the web cannot see; the import boundary forbids it.
- **A POST that runs the engine again with a pinned role.** No pin exists, and a re-run is a new pass (new scores, new rank, a new query row) — not a preview, and it would pollute dedupe and the harness.
- **A "list alternatives" endpoint with no verdict.** The UI would then judge compatibility itself: the same duplication, with a friendlier name.

### Verdict for this pass

**Design-only — BLOCKED on nothing, and NOT implemented at the time; superseded by the UPDATE at the end of this entry (2026-10-25).** No code, no migration, no seed; the decision is the contract the rest of CD-8 is built against. What remains, in order: (a) the engine export plus agreement tests proving it reproduces assembly's verdict on existing builds, including the CPU-as-partner case; (b) the route, contract v1.8.0 and the coverage / `check:api-types` gates; (c) S24's UI reading `compatibility` / `price` / `budget` and rendering UNKNOWN as its own state; (d) flipping this Status to `; IMPLEMENTED <date>` in the same change as (a)-(c). Until (d), the shipped control stays disabled (`e2e/swap.spec.ts`, 2026-10-25) and no swap is simulated.

One implementation detail is deliberately left open: whether `:rank` is resolved through `recommendation_result` alone or also requires `build_candidate_id IS NOT NULL`. Both name the same build today; the implementer must pick one and pin it with a test rather than leaving the choice to the SQL.

### UPDATE 2026-10-25 — the engine half landed (a); the route did not

`assembly` now exports `evaluateBuildReplacement({ picked, filteringContext, role, candidate })` (`src/recommendation/assembly/assemble.js`, re-exported by identity from `assembly/index.js`), answering a frozen `{ status, pairs, unknown_pairwise_count }` with `pairs[i] = { check, role, partner_role, status, reason, evidence }`. It reads the SAME `PAIRWISE_CHECKS` table through TWO new shared internals — `evaluatePairCheck` (the ONE construction of a check's canonical left/right arguments, now used by `firstPairFailure` and `countBuildLocalUnknownPairs` too) and `forEachPickedCheck` (the ONE full-build traversal) — so a preview cannot drift from the walk that produced the build. `firstPairFailure` deliberately stays ROLE-SCOPED: the DFS calls it once per tentative pick, and scanning the whole map there would multiply assembly's cost.

Agreement is pinned, not asserted, by six tests in `assembly/assemble.test.js`:

- every co-occurring pair is returned by exactly the TWO previews of the roles it names; the union is the 9 slots of the O2+E8 fixture, no pair of an existing build comes back FAIL, and the union's UNKNOWN count equals that build's `unknown_pairwise_count`;
- replacing the CPU returns `cpu_motherboard`, `platform_memory`, `cooler_socket` and `cooler_tdp` and NO CPU-keyed pair (PASS and UNKNOWN reported side by side, `status: UNKNOWN`, count 2) — the CPU-as-partner proof of item 1;
- an am4 board under the am5 CPU FAILs the preview (`cpu_motherboard`, with a reason code) AND makes `assembleBuilds` emit zero builds on the same fixture;
- a supplied GPU on the omit path is previewed through `gpu_psu` and `gpu_case`, with the picked map untouched afterwards;
- the result, its pairs and their evidence arrays are frozen; `SSD_BOOT` (no relationship at all) answers `pairs: []` with `status: 'PASS'`, the walk's own zero-partners answer — which is why a caller reads `pairs.length` to tell "nothing checked" from "checked and compatible";
- every malformed input fails fast with the shared codes (`role`, `picked.<ROLE>.*`, `candidate.*`, `filteringContext`), including `MEMORY` used as a role name and the non-expanding `SSD_SECONDARY`.

A REJECT candidate is REFUSED (`INVALID_FIELD_VALUE`) rather than previewed: rejection is the filtering stage's verdict, and answering PASS/UNKNOWN for it would hide the one fact the route must report.

Measured: `npm run test:unit` 1191 pass / 0 fail / 0 cancelled on Node 24.21.0 AND on the Node 22 CI leg (`npx -y node@22 --test "src/**/*.test.js"`), up from 1185; `assembly/assemble.test.js` alone 90/90. No migration, no seed, no API change, no web change.

Still open at the time of that update, in the order of items (b)-(d): the route + contract v1.8.0 + the coverage / `check:api-types` gates; S24's UI reading `compatibility` / `price` / `budget`; then the `; IMPLEMENTED <date>` flip. (b) landed the same day - see the next UPDATE.

### UPDATE 2026-10-25 (later) — the route landed (b); the UI and the flip did not

`GET /v1/recommendations/:id/builds/:rank/swap-preview` is served as **contract v1.8.0**: one new path,
no field on any existing response, `openapi-v1.8.json` replacing v1.7 (one snapshot in the tree), the
coverage gate declaring 200/404/422/429/500, and `apps/web`'s `check:api-types` moved to 1.8.0 / nine
paths with `schema.d.ts` regenerated in the same change.

The composition lives in `src/recommendation/orchestrator/swap-preview.js`, not in `apps/api`, because
`import-boundary.test.js` pins the API to stage barrels and forbids a route from importing the engine at
all: composing loaders plus pure stages is orchestrator work. `engine.js` therefore forwards
`evaluateSwapPreviewSnapshot` by identity (like `catalogVersion`) and exposes `swapPreviewRoles()` from the
ASSEMBLY barrel, which is the sixth barrel it requires — a deliberate edit to that test, with a comment.

**The full pool, not a narrowed one.** The preview runs `loadQueryInput -> loadCandidates ->
selectCandidatePool -> selectOfferPrices -> loadFilteringContext -> filterCandidates`, exactly as a pass
does, because item 4 says "the same filtering and offer-selection path". A narrowed pool would be a second
path free to diverge while looking correct on a fixture. The cost is a pass's read half, which is why the
route takes POST's 30/min rather than GET's 120/min.

**The scoring model is NOT loaded.** A pass loads it for retention, scoring and Engine 3; a preview runs
none of those, and every stage it does run takes no configuration. Loading it would add a statement and a
failure mode (`SCORING_MODEL_UNAVAILABLE` over a perfectly reconstructable build) for a value nothing
downstream reads.

**`picked` is rebuilt from the live verdicts, never from the rows.** `build_component` supplies IDENTITY
(which product is in which role); Engine 2D supplies the verdict. Fabricating one from a row would invent a
status, and would judge the hypothetical swap against relationships nobody evaluated. A persisted pick with
no live verdict — or whose live verdict is REJECT — makes the build NOT EVALUABLE, and `blocked_role` names
the first such role in `EXPANSION_ORDER`; the route turns that into `404 BUILD_NOT_EVALUABLE`. The rank is
resolved through `recommendation_result` in ONE statement (`SELECT_BUILD_FOR_SWAP_SQL`), requiring a
`build_candidate` (an INNER JOIN, so `build_candidate_id IS NOT NULL` holds) and at least one component
row, which the repository enforces because a LEFT-JOIN null row cannot express it — an empty `picked` would
otherwise answer a confident PASS over nothing.

**An ineligible candidate is REFUSED, not previewed.** It answers one synthetic pair
`{ check: "eligibility", role, partner_role: null, status: "FAIL", reason, evidence: [] }` with
`status: "FAIL"` and a null price — one vocabulary, no new top-level field — and `evaluateBuildReplacement`
is never called. The three reasons stay distinguishable: the REJECT verdict's own code,
`NO_ELIGIBLE_OFFER` (in the 2C pool, dropped by Stage 1) and `PRODUCT_NOT_CANDIDATE` (never in the pool),
with `INCOMPATIBLE` as the honest fallback for a rejection that recorded no code.

**`catalog_version` is the LIVE digest**, not the build's recorded one, because the verdict is a function
of the catalog as it is now; the route reuses `resolveCatalogVersion`, so a broken digest degrades to `null`
rather than a 500 over a label. The 200 is served `Cache-Control: no-store`.

**Measured:** `npm run test:unit` **1213 pass / 0 fail / 0 cancelled** on Node 24.21.0 AND on the Node 22 CI leg
(`npx -y node@22 --test "src/**/*.test.js"`), including the new `orchestrator/swap-preview.test.js` (22) and
the re-pinned `orchestrator/index.test.js`; `npm run test:api` **163 pass / 0 fail**, including
`swap-preview.test.js` (23) and the snapshot/coverage/contract gates; `npm run test:api:db` **11 passed /
0 failed** on the TEST branch, including the new end-to-end preview (a real 20000 MAD GAMING pass, a
self-swap that reproduces the persisted total, a real socket-mismatch FAIL, residue 0);
`apps/web` `gen:api-types` + `check:api-types` report "contract 1.8.0, 9 paths, schema.d.ts byte-identical".
No migration, no seed and no new grant: `morocco_pc_api`'s existing SELECTs are enough, so `verify:replay`
is untouched.

**Still open after that update:** items (c) and (d) - S24's UI and the `; IMPLEMENTED` flip. Both landed
the same day; see the UPDATE below, which supersedes this paragraph.

**UPDATE 2026-10-25 (c)+(d) - S24's control is LIVE, and this decision is IMPLEMENTED.**

`apps/web/components/result/swap-panel.tsx` is a client island on EVERY build card (V13: swapping belongs to a
build, not to rank 1), replacing the disabled placeholder the sprint shipped as its honest fallback. The rules
live in `lib/result/swap.ts` so they are stated once: the roles offered are the INTERSECTION of the build's own
components with the engine's `EXPANSION_ORDER` (a slot the build does not have is not a swap, and
`SSD_SECONDARY` is never offered because the API refuses it), the component already installed is not offered
back, and a GPU choice is one option per SKU - the variant is what the endpoint requires for role GPU, so the
picker cannot be product-keyed without producing a 422.

**What the control asks, and when.** Opening the panel is local state. The catalogue read
(`GET /v1/catalog/products?role=<role>`) happens when a ROLE is chosen, and the preview only when the button is
pressed - the endpoint is priced like a POST (30/min) because a preview pays a pass's read half, so an eager
fetch per card would spend that budget on curiosity. `e2e/swap.spec.ts` pins it: opening the panel and listing
roles fires NO `/swap-preview` request, and no catalogue read either. The client asks with
`cache: "no-store"`, honouring the route's own policy, and sends `product_variant_id` only where the catalogue
gave it one.

**What it renders, and what it refuses to invent.** The verdict is the API's aggregate, word for word:
`PASS` / `UNKNOWN` / `FAIL` each get their own word and their own sentence, and UNKNOWN is never folded into
"compatible" - the three-state vocabulary is load-bearing. Pairs are named by their ROLES and their status in
words (`Processeur et Carte mère : incompatible.`), never by a check key or a reason code; the synthetic
`eligibility` pair is separated from the relations and its three reason codes get three sentences, because "not a
candidate", "no eligible offer" and "incompatible" ask the reader to do different things. The price line, the
delta, the offer's provenance word and the budget bar all come from the response (`price.*`, `budget.*`): the
browser computes no total and no delta, and a null operand renders a sentence instead of a 0. The result region
is `aria-live="polite"` from the first render, so the verdict is announced rather than silently painted.

**Contract v1.9 was required, and it is additive.** A GPU candidate is a `(product, variant)` pair (Engine 2B)
while `GET /v1/catalog/products` served SLUGS only and the detail page strips `product_variant_id` as identity -
so no client could construct a GPU swap at all. Each list row now carries `id` (the `product.id`) and
`variants: [{ id, sku }]` in the engine's own variant order (`[]` when the product has none); no path and no
existing field changed. The snapshot is `apps/api/test/unit/openapi-v1.9.json` (v1.8 deleted, one in the tree)
and `apps/web`'s `check:api-types` moved to 1.9.0 / nine paths in the same change, as item 8 requires.

**Measured:** `npm run test:api` **164 pass / 0 fail** (the catalogue gains a variants test and the snapshot
assertions for `id` + `variants`); `npm run test:api:db` **12 passed / 0 failed** on the TEST branch, including
a new catalogue test that compares a variant-keyed product's served SKUs against `product_variant` itself;
`apps/web` `typecheck`, `lint`, `check:tokens`, `check:i18n` (both catalogues, identical keys and placeholders),
`check:api-types` and `build` green; the Playwright suite **373 passed / 2 skipped**, with `e2e/swap.spec.ts`
now 7 specs (live control and its role list, PASS with the API's numbers and the variant-carrying request, FAIL
as a 200 result said in words with no enum on screen, UNKNOWN as its own state with its price intact,
`NO_ELIGIBLE_OFFER` with no price and no bar, the Arabic/RTL panel, and 360 px with no sideways scroll). The
fixture mock answers the swap route by the CHOSEN `product_id`, and validates the role and the GPU variant
exactly as the API does.

**Still open, and deliberately not faked (as written on 2026-10-25):** a MUTATING swap - persisting a
replacement - is not this decision and would need its own (item 9); S24's control has no "apply" affordance, by
design. **Answered 2026-10-26 by Decision 56**, which appends a derived build rather than editing the pass, and
with it S24 gained its apply control. The engine half, the route
and the UI are all measured against the TEST branch or the fixture mock; nothing here has been exercised
against a deployed origin, which S26 owns.

## Decision 56 — a committed swap is an APPENDED derived build: the pass stays a record

Status: RESOLVED 2026-10-25 — Decision 55 item 9's mutation, implemented as an APPEND: one `recommendation_swap` row (migration 023) plus its OWN `build_candidate` and `build_component` rows, written in one transaction. No UPDATE and no DELETE anywhere, so the pass's rank, dedupe key, preset pointer, `strategy_key` and explanation stay the record they claim to be, and the API serves the user's swapped build for that rank. IMPLEMENTED 2026-10-26 in four parts: migration `023_recommendation_swap.sql` (applied to the TEST branch; the shared apply is the owner's restore-point-guarded step), the ENGINE HALF (`assembly.evaluateBuild`, `orchestrator/swap-commit.js`, the `composeSwap` reuse and `readCommittedSwap`), the ROUTE (contract v1.10.0 `POST /v1/recommendations/:id/builds/:rank/swap`, the effective-build read path, `swapped` and the nullable `explanation`) and S24's apply control; `recommendation_swap` joined the production role's INSERT grant, so its self-check is 21/21 (rehearsed green on the TEST branch).

Date: 2026-10-25. Answers the one question Decision 55 refused to answer (`; item 9: "A mutating swap is OUT of scope, deliberately"`) and closes no gap row: it is the missing mutation contract, not a defect fix. It does NOT change the preview, does not re-run a pass, and does not make a pass editable.

### Current situation

- The pass is a record with a stable address: `recommendation_result` is unique on `(recommendation_query_id, rank)`, `build_candidate` carries `total_price` / `score` / `compatibility_status`, and each part is one `build_component` row per role (`uq_build_component_role_singular`) holding `product_id`, `product_variant_id`, `selected_price`, `currency`, `store_id`, `price_checked_at`, `offer_class` and `store_offer_id` (the Decision 35 provenance snapshot).
- The wire addresses a build by `(query id, rank)` only; there is no build id on the contract.
- The production role `morocco_pc_api` holds SELECT on `public`, INSERT on the six Layer 4 tables, DELETE on `build_rejection` only, and THREE column-scoped UPDATEs — never a row-wide one (Decision 46 item 7). A mutation expressed as an UPDATE is therefore not merely undesirable: it is ungranted.
- Decision 55 shipped the read-only preview (`evaluateBuildReplacement`, `orchestrator/swap-preview.js`, `GET .../swap-preview`, S24's UI) and named the four things a mutation would have to settle: pass immutability, the dedupe key, the presets, and rank / `strategy_key` invalidation.

### Problem

A reader who previews a replacement and accepts it needs the build they own to BE the swapped one — after a reload, on another device, next to a saved build. Three cheap implementations each break something the pass guarantees:

1. **Edit `build_component` in place.** The pass stops being a record: `rank`, `strategy_key`, `engine_version`, the Decision 47 dedupe key, `recommendation_preset` pointers and the golden harness's fingerprints all describe the ORIGINAL assembly, and a later reader could not tell an engine-produced build from an edited one. The role's grants also forbid it by design.
2. **Re-run the pass with a role pinned.** Assembly has no pin, and a re-run is a NEW pass — new scores, a new rank, a new `recommendation_query` row that would enter dedupe, the presets and the golden harness's preflight (an unmarked row blocks `eval:scenarios`).
3. **Keep the swap in the browser.** It dies on reload, which is exactly what the reader asked to keep.

### Decision

1. **Append, never edit.** A commit INSERTs one `build_candidate`, its `build_component` rows and one `recommendation_swap` row, in ONE transaction. It issues no UPDATE and no DELETE, touches no `recommendation_result` row, and needs no new grant beyond INSERT on the new table.
2. **What the derived build IS.** Its components are the source build's own rows, copied verbatim, with the swapped role's row replaced by the candidate and its Stage 1 carrier price (`selected_price`, `currency`, `store_id`, `price_checked_at`, `offer_class`, `store_offer_id` — the same snapshot Decision 35 writes). `total_price` is `persisted total - previous + next`: the SAME arithmetic `presentSwapPreview` performs, so the commit and the preview the reader just saw cannot disagree about the number.
3. **The verdict and the score are the engine's, over the WHOLE build.** `compatibility_status` comes from a NEW export, `assembly.evaluateBuild({ picked, filteringContext })`, which evaluates every pair of the substituted build over the SAME `PAIRWISE_CHECKS` table `assembleBuilds` uses — not from the role-scoped preview aggregate, which is a proper subset by construction and would report a build status computed from a fraction of its relations. `score` is Engine 4's `computeBuildScore` under the pass's OWN pinned model (`recommendation_query.scoring_model_id`), because a stored score that did not move with the parts would be a lie.
4. **The refusal rule is assembly's, not a new one.** PASS and UNKNOWN commit and the verdict is STORED, never laundered — a pass persists UNKNOWN builds and counts them (Decision 15/23), so refusing UNKNOWN here would make the API stricter than the engine. FAIL and an ineligible candidate are refused with `409 SWAP_NOT_COMMITTABLE`, and the message carries the verdict.
5. **A swap replaces a part that is THERE.** `previous === null` (the GPU-less build being given a GPU) is refused `409 SWAP_ROLE_ABSENT`. The preview deliberately reports an unknown total for that case (Decision 55 item 3's NULL-never-0 rule), while a commit must persist a KNOWN `total_price`; adding a part is a different operation from replacing one, and it needs its own arithmetic and its own decision.
6. **ONE committed swap per build.** `UNIQUE (source_result_id)`. A second attempt — identical or not — answers `409 SWAP_ALREADY_COMMITTED`, because the alternatives are an UPDATE (forbidden by item 1) or a chain the wire has no address for (a derived build has no rank). Stacking swaps is a future decision, and the read path labels the one that exists.
7. **The read path serves the user's build, labelled.** `SELECT_BUILDS_SQL` LEFT JOINs `recommendation_swap` on the source result and joins the EFFECTIVE candidate (`COALESCE(sw.build_candidate_id, r.build_candidate_id)`), so POST and GET both show the swapped parts, the recomputed total and the recomputed score, plus `swapped: { role, committed_at, engine_version } | null`. `SELECT_BUILD_FOR_SWAP_SQL` (the PREVIEW's read) joins the same effective candidate, so after a commit a preview prices the part that is installed now and judges the pick set on screen instead of the assembly the pass originally produced - the commit still cannot run twice (item 6). What stays the PASS's: `rank`, `strategy_key`, the dedupe key and the presets. A swapped build has NO engine explanation — the stored one explains parts that are no longer there — so `explanation` becomes NULLABLE on the wire. The column always was (`recommendation_result.explanation` is `text NULL`), which means the old `Type.String()` was also a latent unserializable row, not only a swap question.
8. **The judge is the preview's own composition.** `orchestrator/swap-preview.js` exposes the ONE pipeline it already runs (`composeSwap`: query loader -> 2B -> 2C -> Stage 1 -> 2D, then the pick rebuild), and `orchestrator/swap-commit.js` consumes it. A commit cannot re-derive eligibility, re-run the pass, or judge a different pool — it asks the same questions the preview asked and writes the answer.
9. **Contract v1.10.0**: ONE new path `POST /v1/recommendations/:id/builds/:rank/swap` (body `{ role, product_id, product_variant_id? }`, the same validation the preview applies), `swapped` added to the build object, `explanation` widened to nullable. `201` commits, `200` never appears; `404` unknown build / `BUILD_NOT_EVALUABLE`, `409` the three refusals, `422` schema, `429` (30/min — a commit pays a preview's read half), `500`. The snapshot is `apps/api/test/unit/openapi-v1.10.json` (v1.9 deleted, one in the tree) and `apps/web`'s `check:api-types` follows in the same change.
10. **Grants: one new INSERT target.** `recommendation_swap` joins `WRITE_TARGET_TABLES` (seven tables), so the role's self-check grows from 20 answers to 21 and the rehearsal/apply scripts assert it. No new UPDATE and no DELETE — the append-only shape is what keeps the privilege set honest.
11. **Migration 023 is BRANCH-FIRST** (the 021/022 pattern). It is applied to the TEST branch in this change; the shared apply is the owner's separate restore-point-guarded step, so `verify:replay --reference=shared` reports exactly 023's objects until then. That drift is the documented signal of a migration waiting for its shared apply (AGENTS.md section 6), never a broken replay.

### Rejected alternatives

- **Edit `build_component` / `build_candidate` in place.** Loses "a pass is a record" and is ungranted by design (Decision 46 item 7). Re-opening the grants to make it possible would be the tail wagging the dog.
- **A second pass with the role pinned.** No pin exists; a re-run is a new pass with new scores, a new rank and a new query row that enters dedupe, the presets and the golden harness.
- **A client-side overlay (or a saved-build-only edit).** Dies on reload and leaves the API's build describing neither what the user chose nor what they will be charged.
- **Storing the swap as PASS when the engine said UNKNOWN.** Launders the three-state vocabulary into a two-state one and puts an unverified relationship into a durable recommendation.
- **Committing on FAIL with a warning.** The pass never persists a FAIL build (assembly excludes it); a mutation that did would create a build no engine pass could ever produce.
- **Chained swaps (swapping a derived build).** Needs an address for a derived build and a decision about which link a `previous` price comes from; one level, labelled, is enough for S24 and is reversible by a later decision.

### Verdict for this pass

Design and implementation in the same change, measured 2026-10-26:

- `npm run test:unit` 1229 pass, including the 16 new `orchestrator/swap-commit.test.js` cases; `npm run test:api` 179 pass, including the 14 new route cases and the regenerated v1.10 snapshot.
- `apps/api/test/db/swap-commit.db.test.js` against the TEST branch: a real 20000 MAD GAMING pass, a FAILING swap refused `409` with the seven Layer 4 table counts unchanged, then a boot-SSD swap to a DIFFERENT, differently priced product `201` whose derived total is exactly `persisted - previous + next`, whose derived candidate/components/link read back, whose pass rows are byte-identical afterwards, whose GET serves the derived candidate with the replacement's components, the recomputed score and `explanation: null`, and whose follow-up preview prices the installed part (the reverse swap lands back on the pass's total) - the assertion that fails when the preview reads the original assembly instead; the second commit is `409 SWAP_ALREADY_COMMITTED` and residue is 0 in `recommendation_swap`, `recommendation_query`, `recommendation_result`, `build_candidate`, `build_component` and `build_rejection`.
- `node scripts/rehearse-api-role.js` on the TEST branch: `ok: true` with `recommendation_swap_insert` expected `true`, actual `true` - the grant item is proved against a real role, not asserted.
- `apps/web`: `typecheck`, `lint`, `check:tokens`, `check:i18n`, `check:api-types` (10 paths, contract 1.10.0, byte-identical types) and `build` all pass; `e2e/swap.spec.ts` is 10/10 in a browser against the fixture mock (apply posts the preview's triple and shows the 201's total, FAIL offers no apply, and a build served as swapped shows the badge and the no-explanation sentence), and `result`/`rtl`/`a11y` stay green (84/84).
- Still open by design at the time: migration 023 had not been applied to the shared database (branch-first, owner-gated) and the deployed role had not been re-granted there; `verify:replay --reference=shared` reported exactly 023's objects until then. **Both landed 2026-10-29** — 023 on shared (`br-royal-block-axu8i4a9`) and EU (`br-cool-star-b9whdnt1`), then the re-grant on both (`br-silent-cake-ax5q21at` / `br-bitter-sky-b96jh91p`, self-check 21/21), so the replay now reports 0 drift over 23 files.

## Decision 57 — production keeps the model it serves, and `launch-v2@2.0.0` is the version evaluated for release

Status: PROVISIONAL 2026-10-26 — production keeps `seed-minimal-v1@1.0.0`, `launch-v2@1.0.0` is not the release model and is never activated, and `launch-v2@2.0.0` is the version evaluated for release, where that evaluation is a GATE (A1/A3/A4 are still unreviewed) rather than an activation. **AMENDED 2026-11-01:** the served model is the NEWEST `is_active` row (`apps/api/src/repository.js` `SELECT_ACTIVE_SCORING_MODEL_SQL`), so what an environment serves is a property of its SEED-SET rather than of any config, and the measured fact is that `seed-minimal-v1@1.0.0` is INACTIVE on ALL THREE databases while shared and TEST both serve `launch-v2@2.4.0`. Item 1 is therefore superseded rather than satisfied: keeping a release on a named model is now an explicit deploy-time ACT (or a pin), never a statement about the rows. `launch-v2@2.4.0` is NOT thereby adopted for release (item 3 still gates that), and the release target is EU, not the shared dev database.

Date: 2026-10-26. Scope: which scoring model a release may serve, and what the words "release candidate" are allowed to mean here. The H3 review (`docs/ENGINE_HYPOTHESIS_REVIEW_2026-10-24.md`) made this necessary without stating it: three assertions the engine still misses are `hypothesis`, two `launch-v2` versions are ACTIVE on the TEST branch, and nothing is deployed — so the next deploy had no recorded answer to "which model ships". Documentation only: **no migration, no seed, no row, no grant, no deploy**, and no change to any environment's data.

### Current situation

Measured read-only 2026-10-26: `scoring_model` rows and `schema_migrations` on each database, not a copy of an earlier report. **RE-MEASURED 2026-11-01:** the table below carries the 2026-11-01 reading, taken the same way (read-only, per database), because the 2026-10-26 one describes no environment any more; the amendment at the end of this entry records what moved, why, and which remedies were rejected.

| Database | Active scoring model(s) | Ledger |
|---|---|---|
| SHARED (`DATABASE_URL`) - dev/demo, NOT a production stand-in | `launch-v2` `1.0.0`, `2.0.0`, `2.1.0`, `2.2.0`, `2.3.0`, `2.4.0` - six ACTIVE; `seed-minimal-v1@1.0.0` INACTIVE | 23 |
| TEST branch (`TEST_DATABASE_URL`) | the same six `launch-v2` versions ACTIVE; `seed-minimal-v1@1.0.0` INACTIVE | 23 |
| EU (`morocco-pc-eu`) - the release target | `launch-v2@1.0.0` alone ACTIVE; `seed-minimal-v1@1.0.0` INACTIVE | 23 |

`test/golden/scenarios.json` records the review's verdict as data: `A1`, `A3` and `A4` are `hypothesis`; `A2`, `A2b` and `A5`-`A10` are `approved`, so a failure in one of those eight is a HARD FAIL (exit 1). At `launch-v2@2.0.0` the suite is 86 rows — 66 PASS / 19 EXPECTED-RED / 1 UNKNOWN — and the 19 EXPECTED-RED rows are exactly A1 (15) + A3 (3) + A4's strict pair (1). `current_epic` is `E8`.

### Problem

Activation has been an emergent fact rather than a decision: whichever `scoring_model` row is `is_active` is what an environment serves. That is correct for a harness — a pin is a SELECTOR, never an activation (Decision 39 / C-36) — and wrong for a release, because it makes "what ships" a function of the last seed somebody applied.

Two hazards follow. First, TEST deliberately holds TWO active `launch-v2` versions so the pinned A/B evidence resolves: `launch-v2@1.0.0` for the figures quoted before 2026-10-24 and `2.0.0` for the E5/E6 review. A deploy that copies TEST's model state, or a script that resolves "the active model" without a pin, would ship `1.0.0` — the version that declares no `resolution_profiles`, so Decision 42's reviewed VRAM floors would be silently inert again, which is precisely the state Decision 53 ended. Second, treating `1.0.0` as a candidate would ship the version the review superseded: the two differ by that one configuration key, and the review approved the key.

### Decision

1. **Production keeps the model it serves today.** The shared database stays on `seed-minimal-v1@1.0.0`, and the first deployed environment inherits that pin rather than TEST's state. This decision writes nothing: the pin is already true where it applies.
2. **`launch-v2@1.0.0` is not activated.** It is not the release model and must not be turned on in production. Its row stays on TEST as the pinned A/B reference the pre-E5 figures resolve against — deactivating it there would destroy evidence — so it stays ACTIVE on TEST only.
3. **`launch-v2@2.0.0` is the version evaluated for release.** "Evaluated" is a gate, not a status: the release evaluation is complete only when `A1`, `A3` and `A4` leave `hypothesis` in `test/golden/scenarios.json`, and when OG-38's remaining half (the missing budget term in `build_score` and GAMING/WORKSTATION non-divergence at high budgets) plus OG-43 and OG-44 (unvalidated band multipliers and pair-quota values) are resolved or explicitly accepted. **UPDATED 2026-10-29:** the pair-quota half is now discharged by RETIREMENT rather than validation - OG-44 CLOSED → C-47, because seeds 014/015/016 are deleted by seed 017 and no live model declares `candidate_caps.max_builds_per_pair`; the A1 diversity debt that retirement leaves on the canonical line is registered as **OG-55**. OG-38's remaining half and OG-43 stay open. **UPDATED 2026-10-31:** OG-38's remaining half is now DISCHARGED by **Decision 60** as an explicit ACCEPTANCE (no budget term in `build_score`, measured cost recorded, the term scheduled as its own epic with a binding re-check trigger); OG-43 stays OPEN. Until then a 2.0.0 deploy is an evaluation and must be described as one.
4. **The EU database's pre-existing `launch-v2@1.0.0` row is reconciled at deploy time, by the owner.** `check-target-parity` names the difference until then. This decision does not flip it: activation is a data act (a seed apply, or a `scoring_model` write) with its own restore point, and deciding a model is not writing one.
5. **A pin is still a selector.** Every comparison harness keeps selecting by `name@version` through `scripts/lib/model-pin.js`, so a two-active branch stays measurable and this decision changes no harness default. The default pin is `seed-minimal-v1@1.0.0`, which is INACTIVE on TEST, which is why a run there must pass `--model=launch-v2@2.0.0`.

### Rejected alternatives

- **Activate `launch-v2@2.0.0` now.** Rejected: `A1`, `A3` and `A4` are unreviewed and currently red, so activating would turn an open hypothesis into a released claim, and there is no deployed environment to activate it on.
- **Ship `launch-v2@1.0.0` as the release model.** Rejected on content rather than taste: without `resolution_profiles` the reviewed floors are inert and every A4 floor row stops being differential — the exact regression Decision 53 fixed.
- **Deactivate `launch-v2@1.0.0` on TEST to remove the ambiguity.** Rejected: the E5/E6 evidence chain (`test/golden/_scratch-v10`, `-v11`, `-v12`) and the pre-2026-10-24 figures resolve against that pin, so removing the row would make the comparison unreproducible in order to solve a labelling problem.
- **Leave this as a note in the review instead of a decision.** Rejected: the review is a dated measurement, not a contract, and the next deploy needs something citable.

### Verdict for this pass

- Decision recorded: PASS (this entry). The environment table is a fresh read-only measurement taken 2026-10-26.
- No data changed: PASS by construction — no migration, no seed, no grant, no `scoring_model` write, no deploy.
- Gate bookkeeping: `verify-docs` decision counts moved 54 headings / 60 `Status:` lines -> 55 / 61, `docs/DECISION_INDEX.md` regenerated, `AGENTS.md` cites "Decisions 1–57".
- Release evaluation of `launch-v2@2.0.0`: **OPEN**, and item 3 above is where its gate lives. A1/A3/A4 remain `hypothesis`; OG-38 and OG-43 remain OPEN, and OG-44 left this gate on 2026-10-29 (CLOSED → C-47 by retirement, its behavioural residue now OG-55).
- Migration 023 and its re-grant: **out of scope here**. The shared database was measured at ledger 22 on 2026-10-26, with `recommendation_swap` absent, so the 21-answer self-check in `docs/RECIPES/provision-the-api-role.md` described the rehearsal contract rather than shared's state until an owner-gated apply landed. **UPDATED 2026-10-29 — the apply landed:** 023 is on shared (restore point `br-royal-block-axu8i4a9`, audit target `db:54ff6ea3f6e6`) and on EU (`br-cool-star-b9whdnt1`, `db:2d66f26d7ddc`), all three ledgers read 23, and `verify:replay` reports 0 drift over 23 files. **UPDATED AGAIN 2026-10-29 — the re-grant landed too:** `GRANT INSERT ON recommendation_swap` was applied to shared (`br-silent-cake-ax5q21at`) and to EU (`br-bitter-sky-b96jh91p`), each self-check **21/21**, and `smoke-api-role.js` ran the API as the role on both (POST 201 with 1 build, 52 statements, residue 0), so a least-privilege deploy can now commit a swap. What remains is the SECRET rotation (`docs/RECIPES/deploy-eu-colocation.md` §8.5, OG-54 item 1), not a privilege.

**AMENDMENT 2026-11-01 - the failure mode this entry predicted arrived.**

This entry's Problem paragraph named the hazard exactly: "whichever `scoring_model` row is `is_active` is
what an environment serves ... wrong for a release, because it makes 'what ships' a function of the last
seed somebody applied." That is what happened. `npm run seed` has no per-file mode, so applying seed
`027_ag400_lga1700_support.sql` - a one-row cooler mounting claim - replayed EVERY seed file onto shared,
and seeds 013 and 018-022 activate `launch-v2`. Shared went from "v1 alone" to six ACTIVE `launch-v2`
versions, matching TEST; EU is now the outlier on `launch-v2@1.0.0`.

Re-measured read-only 2026-11-01 (`scoring_model` rows and `is_active`, not a copy of the table above):

| Database | Rows | Active | Row the API selects (newest `created_at`) |
|---|---|---|---|
| SHARED | 7 | 6 | `launch-v2@2.4.0` (created `2026-11-01T00:52:13Z`) |
| TEST | 7 | 6 | `launch-v2@2.4.0` |
| EU | 2 | 1 | `launch-v2@1.0.0` |

What this settles, item by item:

- **Item 1 is superseded, not satisfied.** The shared database does not keep v1; it serves
  `launch-v2@2.4.0` because that is the newest ACTIVE row. Nothing errored: the demo origin at
  `https://morocco-pc.onrender.com` silently began serving a different model. Keeping a release on a
  named model is therefore an ACT with its own restore point (as item 4 already says of activation),
  or a deploy-time setting - never a description of the rows.
- **The mechanism is recorded as contract, not folklore.** The served model is
  `SELECT_ACTIVE_SCORING_MODEL_SQL`: `WHERE is_active = true ORDER BY created_at DESC, id ASC LIMIT 1`.
  The tie-break is deterministic and the CHOICE is implicit, which is exactly what makes an
  environment's served model follow its seed-set rather than its intent.
- **The release TARGET is EU, and the "production stand-in" framing is withdrawn.** A public origin
  writes `api-*` passes into shared (9 `recommendation_query` rows measured 2026-11-01, 8 with
  results), so shared is a dev/demo database that a public host mutates and cannot represent
  production. Item 4's EU reconciliation is unchanged and still gates the EU deploy.
- **Nothing is adopted by this amendment.** `launch-v2@2.4.0` is what the demo now serves; it is NOT
  the release model. Decision 59 states that adopting 2.4.0 as a release line is not claimed, and
  OG-56 records the cost (assembly breadth 10 -> 24 of the 25-build cap, the A10 re-approvals). Item
  3's gate still decides what ships.

Remedies considered and REJECTED, recorded so they are not re-litigated:

- **Restore shared from the pre-apply restore point** (`br-restless-art-ax6fineh`, created
  `2026-11-01T00:51:43Z`). Rejected twice over: AGENTS section 8 forbids restoring the shared database
  at all, and it is a whole-database rollback that would also undo seed 027's own row, seeds 023-026
  (products 113 -> 100, assessments 319 -> 280) and the shared<->TEST parity that the same apply
  closed.
- **Re-stamp `is_active` by hand** (deactivate the five `launch-v2` rows, reactivate v1). Rejected as
  the OG-30 pattern this project has already paid for: `run-seeds.js` rewrites `is_active` on every
  run, so the cure lasts until the next seed apply - a re-stamp, not a cure - and it re-opens the
  shared<->TEST divergence for a labelling problem.
- **Promote `launch-v2@2.4.0` to release model because it is what is deployed.** Rejected: adopting a
  version because a seed replay landed it is the same class of error as raising a budget to make a
  harness pass. Adoption is item 3's gate and needs its own reviewed act.

Still OPEN after this amendment, so the register keeps answering the question: EU serves
`launch-v2@1.0.0`, which item 2 forbids in production, so the EU service must be pinned or activated
deliberately before it takes traffic (OG-54 item 2). The durable fix - an explicit deploy-time model
pin, so a seed apply can never change what a production origin serves - is registered as its own
follow-up and is NOT claimed here.

## Decision 58 — A model may order the archetype strategies by its use-case `archetype_objectives`, at neutral priority only

Status: RESOLVED 2026-10-29; IMPLEMENTED 2026-10-29 — `launch-v2@2.1.0` (seed 019, TEST branch) opts a model INTO ordering the Engine 4 strategies by the use-case `archetype_objectives` weights, and ONLY where the query's `priority` is neutral (null or 3); 2.0.0 and every older model keep the priority-only order byte-identically, and the golden A10 expectation is now approved PER MODEL PIN (2.0.0's order unchanged, 2.1.0's added 2026-10-29), so each pin passes its own reviewed order.

Date: 2026-10-29. Closes the wiring half of **OG-38** (the register's "GAMING and WORKSTATION do not diverge" clause) as a new scoring-model version. It is an Engine 4 behaviour change plus one seed: no migration, no catalog row, no API contract change, no shared-database write.

### Current situation

`launch-v2@1.0.0` (seed 013) declares `use_case_profiles.<use case>.archetype_objectives` — GAMING `{PERFORMANCE 0.50, BALANCED 0.30, VALUE 0.20}`, WORKSTATION `{PERFORMANCE 0.40, BALANCED 0.40, VALUE 0.20}`, OFFICE `{VALUE 0.40, BALANCED 0.40, PERFORMANCE 0.20}` — and `scoring/use-cases.js` has validated that key since Decision 37 (`validateArchetypeObjectives`, now with its own unit coverage). Nothing read it: `ranking/select-archetypes.js` `strategyOrder(priority)` took the query's `priority` and nothing else, so at one priority GAMING and WORKSTATION nominated the same first strategy, and the three strategies' relative weight could only ever be the five fixed rows of that function.

### Problem

A validated configuration key with no consumer is worse than an absent one: it advertises a per-use-case character the engine cannot express, and it is exactly the shape OG-38 records — the inputs the API accepts "have no effect". Two use cases that the product presents as different (`use_case` is a first-class wizard step and an API enum member) produce the same strategy order at the same priority, so their difference lives only in E2's `spend_targets` and can never reach the showcase order the user sees first.

### Decision

1. **The weights order the strategies, descending, with ties broken by the base order.** `ranking/select-archetypes.js` `objectiveOrder(objectives, baseOrder)` sorts by weight DESC and, on an exact tie, by the strategy's position in `baseOrder` — so a tie can never introduce an order priority did not already allow, and the sort is a stable, code-unit comparison (no `localeCompare`, no insertion accident).
2. **Only a NEUTRAL priority yields to the objectives.** `priority` 1/2/4/5 is the user's explicit lean and stays authoritative; `null`, `undefined` and `3` are neutral (3 is `strategyOrder`'s own default row). Expressed once, as `neutralPriority` in `selectArchetypes`.
3. **A model must OPT IN with `apply_archetype_objectives: true`.** `scoring/configuration.js` validates it as an OPTIONAL boolean (the Decision 37/42 optional-key family: present iff declared, strict `typeof` check, so `"true"` is refused at load time), and `orchestrator/run.js` `resolveArchetypeObjectives` routes the per-use-case weights only when the ACTIVE model sets it. A model that declares the weights but not the flag keeps the pre-Decision-58 order, which is what makes a version bump MEAN something rather than silently re-reading an old pin.
4. **The weights travel with the snapshot, not with a private re-read.** `run.js` returns `archetype_objectives` as a sibling of `priority` (same additive pattern as E2's `resolution`), and `orchestrator/full-run.js` passes it to `selectArchetypes`. `selectArchetypes` validates the OBJECT SHAPE even when a non-neutral priority will discard the order, so a malformed input is a caller bug rather than something a priority value happens to hide.
5. **A malformed object is refused, never coerced.** Unknown strategy names, non-finite or negative weights, and a non-positive sum each raise `INVALID_FIELD_VALUE` on the offending path; the function adds no defaulting. The load-time validator (`scoring/use-cases.js` `validateArchetypeObjectives`) enforces the same closed vocabulary and non-negative rule, so a model cannot validate at load and then abort every pass.
6. **The behaviour ships as a NEW version: `launch-v2@2.1.0`** (`database/seeds/019_scoring_model_launch_v2_apply_objectives.sql`). Its configuration is 2.0.0's JSONB with exactly one key appended (`||`), so a pinned A/B isolates the ordering and nothing else. 2.0.0 is never mutated: a `name@version` identifies evidence (Decision 57), and mutating it would make one identity mean two rank orders.
7. **The measurement harness must replicate the wiring it claims to measure.** `scripts/eval-scenarios.js` builds the A1/A10/A8 artifacts by calling `selectArchetypes` directly, and it now passes `archetypeObjectives` from the snapshot beside `ranked`/`budget`/`priority`. Before this, the harness measured an order the engine no longer produced — the instrument, not the engine, decided A10.
8. **An approved golden expectation may be scoped to ONE model pin.** `test/golden/scenarios.json` carries a second `A10` assertion with `model_pin: "launch-v2@2.1.0"` and its own `reviewer`/`reviewed_on`; `scripts/lib/scenario-eval.js` `assertionApplies` runs it INSTEAD of the unscoped entry on that pin, so exactly one A10 row exists per run: 2.0.0 keeps its 2026-10-24 order as a HARD gate, and 2.1.0 is judged by its own 2026-10-29 order. The change is recorded in `test/golden/CHANGELOG.md`, as that manifest requires for an approved value.

### Rejected alternatives

- **Mutate `launch-v2@2.0.0` in place.** Rejected: every golden artifact, gap row and decision records its pin, so the same identity would produce two different rank orders and Decision 57's release evaluation of 2.0.0 would stop being reproducible.
- **Apply the objectives at `priority === null` only.** Rejected on reachability: the web wizard always asks the priority step and the API accepts 1..5, so a null-only gate is a second dead configuration key — the exact defect this decision exists to remove.
- **Let the objectives override an explicit priority.** Rejected: `priority` 1 and 5 are a user's stated lean (`VALUE`-first, `PERFORMANCE`-first) and A5's judged rows pin that output order; overriding it would make the wizard's most specific answer decorative.
- **Apply the objectives in weighing/ranking (`build_score`) instead of the showcase order.** Rejected as a different decision with a far larger blast radius: a score term moves every `build_score`, every rank and every approved row (the missing budget term OG-38 also records), and it would not express per-use-case strategy character at all.
- **Edit the two approved A10 expectations to the 2.1.0 order.** Rejected: `test/golden/scenarios.json` carries one approved expectation per scenario, so re-pointing A10 at 2.1.0 turns the 2.0.0 pin red instead. Item 8's pin-scoped assertion is the adopted alternative — each pin keeps its own reviewed order, and re-approval stays a review-gated act recorded in the manifest and its changelog.

### Verdict for this pass

- Items 1–5: **PASS**. `npm run test:unit` green (1229 tests before the new cases and 1245 after; the added coverage is `select-archetypes.test.js`, `configuration.test.js`, `run.test.js` and `full-run.test.js` — neutral order, explicit-priority authority, tie-break by base order, the opt-in flag, the absent-profile and malformed-object paths, the load-time unknown-name and negative-weight refusals, and one pin that the load-time and runtime archetype vocabularies agree).
- Item 6: **PASS on the TEST branch** (`INSERT rowCount 1`, idempotent guard verified by re-read). The SHARED database deliberately stays on `seed-minimal-v1@1.0.0` (Decision 57) and was not a target.
- Item 7: **PASS**, and it is what made the measurement meaningful — before the fix both pins printed an identical 86-row table, which is a vacuously green result.
- **Measured delta, before and after the pin-scoped approval (TEST branch, `--no-baseline --no-volatile`, 2026-10-29):** before item 8, `launch-v2@2.0.0` measured 66 PASS / 19 EXPECTED-RED / 1 UNKNOWN (exit 0) and `launch-v2@2.1.0` 64 / 19 / **2 HARD FAIL** / 1, exit 1, because exactly two A10 rows moved: **S03 (GAMING, priority 3)** `["BALANCED","PERFORMANCE"]` -> `["PERFORMANCE","BALANCED"]`, matching GAMING's 0.50 PERFORMANCE weight, and **S19 (OFFICE, priority 3)** `["BALANCED","PERFORMANCE"]` -> `["BALANCED","VALUE"]`, because OFFICE's VALUE 0.40 now outranks its PERFORMANCE 0.20. With the pin-scoped expectation in place, BOTH pins re-measure **66 PASS / 19 EXPECTED-RED / 1 UNKNOWN, exit 0**, each against its own order, residue 0; 2.1.0's A10 rows PASS with `[PERFORMANCE,BALANCED]` and `[BALANCED,VALUE]`, 2.0.0's with the unscoped `[BALANCED,PERFORMANCE]`. A1 (pair diversity), A3 (price shares), A4 (VRAM floors) and A8 (determinism) are unchanged, so the delta is strategy ORDER only — the assembled builds themselves did not move. WORKSTATION is the divergence witness: BALANCED 0.40 = PERFORMANCE 0.40 ties, and the base order keeps BALANCED first, so GAMING now leads PERFORMANCE where WORKSTATION still leads BALANCED.
- **Item 8: PASS.** The evaluator's new cases (`scripts/lib/scenario-eval.test.js`: pin-scoped replacement with exactly one row per run, the unpinned fallback, a malformed `model_pin`, and a pin-scoped entry still requiring its own approval) bring `test:scripts` from 429 to **432**, green. Both golden pins were re-run on the branch with the pinned manifest and are green as recorded above, so the A10 half of the promotion gate is CLOSED; promoting 2.1.0 itself remains a separate release act (Decision 57), not a red gate. `test:api:db` against the branch passes **13/13** with 2.1.0 active, so nothing else in the served path depends on the old order.
- **Bookkeeping:** `verify-docs` decision counts moved 55 headings / 61 `Status:` lines -> 56 / 62, `docs/DECISION_INDEX.md` regenerated, `AGENTS.md` cites "Decisions 1–58". The pin-scoped approval also adds a `test/golden/CHANGELOG.md` row and updates `docs/TEST_MAP.md`; `test:scripts` 429 -> 432.

## Decision 59 — One role's candidate depth may be overridden, and `launch-v2@2.4.0` uses it on CPU only

Status: RESOLVED 2026-10-30; IMPLEMENTED 2026-10-30 — `candidate_caps.top_k_by_role` is an OPTIONAL, closed, canonical-role-keyed override of `top_k_per_role` (validated in BOTH the scoring-configuration and Engine 3 input contracts, applied in retention), and seed 022 pins `launch-v2@2.4.0` = 2.2.0 with `{"CPU": 10}`, which measures A1 15 of 15 AND A5 2 of 2 where a UNIFORM depth of 10 broke A5; its pin-scoped A10 order was APPROVED 2026-10-31 (Verdict, item 7), while adopting 2.4.0 as a release line is NOT claimed - Decision 57's release gate still decides what ships.

Date: 2026-10-30. Closes the implementation half of **OG-56** (A1's last red row, S06) and retires
the "untested per-role alternative" that row recorded. Amends **Decision 14 Rule 8** (edited in
place, see its UPDATE block). No schema change, no migration, and NOT a production model change:
the shared database stays on `seed-minimal-v1` (Decision 57).

### Current situation

`candidate_caps` is a strict closed contract in TWO places that must agree: `scoring/configuration.js`
(`CANDIDATE_CAPS_FIELDS` + `CANDIDATE_CAPS_OPTIONAL_FIELDS`, `validateCandidateCaps`) and Engine 3's
`assembly/input.js`, which validates and freezes the same object and imports nothing from `../scoring`
(boundary pin). Required keys are `top_k_per_role` and `max_builds_per_query`; `max_builds_per_pair`
has been optional since Decision 40, and before this entry no per-role structure existed — Decision 14
Rule 8 said so explicitly.

`retention/retain.js` takes `topKPerRole` as a SCALAR and uses it in three places inside
`retainBucket`: the `n <= K` whole-bucket return, the E2 band-slot cap (`K - 1`) and the Decision 27
top-up. `retainBucket` reads only its own bucket — no cross-role state — which is why a per-role depth
is expressible without touching the walk.

Measured 2026-10-30 on the TEST branch, engine at `fc71061`, through a replica of orchestrator stages
1-13 calibrated against the real engine at both depths (recorded in OG-56): `launch-v2@2.2.0` (uniform
5, quota 2) is A1 14 of 15 with S06 at one pair; `launch-v2@2.3.0` (uniform 10) is A1 15 of 15 but A5
1 of 2, because at that depth S10 and S11 become the SAME 11986 MAD build; CPU-only 10 is A1 15 of 15
and A5 2 of 2 (11246 vs 11845 and 13946 vs 19246, signatures differ in both).

### Problem

At 1440p the E5 floor leaves exactly one GPU a 12000 MAD GAMING pass can afford, so A1's three pairs
have to come from the CPU axis, and uniform 5 retains too few affordable CPUs (OG-56). The only lever
that adds them without widening the seven roles that buy no pair is a per-role depth — and Decision 14
Rule 8 forbids one. A uniform depth closes A1 by opening every role at once, which measurably
converges the priority-1/priority-5 picks (A5) and pays assembly on roles that cannot contribute a
pair.

### Decision

1. **`candidate_caps.top_k_by_role` is OPTIONAL and CLOSED**: a map from a canonical
   `COMPONENT_ROLES` value to a positive integer. A role WITH an entry is capped at that depth; every
   role without one keeps `top_k_per_role`. Absent and `{}` both mean "uniform", so every model that
   does not declare it is byte-identical. A non-object value is `INVALID_INPUT`; an unknown role or a
   non-positive/non-integer value is `INVALID_FIELD_VALUE` at its own nested path.
2. **An unknown role key is REFUSED, never ignored** (the Decision 54 `roleExclusions` precedent).
   The map's job is to change a cap, so a silently dropped key is a cap that reports success while
   capping nothing.
3. **Both validators mirror the contract.** `scoring/configuration.js` adds the optional key and
   validates/preserves it, importing `../candidates/roles` for the ONE canonical role vocabulary (the
   same pure constant module the scoring score builders already import). `assembly/input.js` keeps a
   local key literal because it imports nothing from `../scoring`, validates the same shape, and
   freezes its own copy; the name parity is pinned by its tests.
4. **Retention owns the arithmetic.** `retainTopKPerRole({ ..., topKByRole })` validates the map
   EAGERLY — so a malformed map fails even when no bucket exceeds its cap — then `kFor(role)` feeds the
   `n <= K` gate, the E2 band-slot cap and the Decision 27 top-up, so the reservation and the price
   bands read the role's own K rather than the uniform one.
5. **The orchestrator passes the map and nothing else reads it**:
   `configuration.candidate_caps.top_k_by_role ?? null` (`?? null`, not `?? undefined`, so the absence
   is explicit and a validated map can never BE null).
6. **The behaviour ships as a NEW version**: `database/seeds/022_scoring_model_launch_v2_cpu_depth_10.sql`
   adds `launch-v2@2.4.0` = 2.2.0's configuration with exactly ONE nested value set, `{"CPU": 10}`.
   2.2.0 is the base, not 2.3.0, so the uniform depth of 10 is not silently carried along and a pinned
   A/B isolates the axis. 2.2.0 and 2.3.0 stay active: a pin is a selector, not an activation.
7. **The pin is MEASURED, not approved.** `test/golden/scenarios.json` gains a pin-scoped `A10` for
   `launch-v2@2.4.0` with `status: "hypothesis"` carrying the measured order. Approving an order is a
   reviewer act (Decision 58 item 8's mechanism and its changelog rule); this decision
   recorded the measurement, and the 2026-10-31 approval is recorded in the Verdict below.
8. **Uniform depth stays a measurement version** (2.3.0), never the adoption path: its A5 cost is
   measured, not hypothetical.

### Rejected alternatives

- **Ship uniform depth 10 (2.3.0) as the answer.** Rejected on measurement: A5 1 of 2, with S10/S11
  returning the identical 11986 MAD rank-1 build, and the assembly cost paid on roles that cannot add
  a pair.
- **Structural-only role keys (the `role_weights` policy, no enum check).** Rejected: a mistyped role
  would cap nothing while its author believed that role was deeper — the exact defect Decision 54
  refused for `roleExclusions`.
- **A resolution-scoped depth (`resolution_profiles.<res>.top_k_by_role`).** Rejected for now: it adds
  a second policy surface and makes one role's depth resolution-dependent, while no other cap behaves
  that way; the global key measured A5's rank-1 prices UNCHANGED at 1080p (11246 and 13946), so the
  extra surface buys nothing demonstrated. Recorded as the refinement to revisit if the build-count
  cost is later judged too high.
- **Default absent roles to the largest declared depth.** Rejected: it widens roles nobody asked for
  and reintroduces the A5 convergence this key exists to avoid.
- **Mutate 2.2.0 or 2.3.0 in place.** Rejected: `name@version` identifies evidence (Decision 57); the
  same identity would then produce two different assemblies.

### Verdict for this pass

- **Items 1-5: PASS.** `npm run test:unit` is 1261 pass / 0 fail / 0 cancelled on Node 24, and the same
  1261 / 0 / 0 on Node 22 (the CI pin; `# cancelled` 0). New coverage: `scoring/configuration.test.js`
  (accept + preserve, absent shape unchanged, closed-map refusals at
  `candidate_caps.top_k_by_role.<role>`), `assembly/input.test.js` (the same three plus the frozen
  copy), `retention/retain.test.js` (an override applies to its own bucket only, absent/null/`{}`
  identical, the per-role K drives the Decision 27 reservation, eager closed-map refusals) and
  `orchestrator/run.test.js` (a declared map is passed beside the uniform K; an undeclared one passes
  `null`). The configuration boundary test's pinned import list now includes `../candidates/roles`.
- **Item 6: PASS on the TEST branch.** Apply 1 row; a second apply 0 rows (idempotent); the flattened
  configuration diff against 2.2.0 is exactly `candidate_caps.top_k_by_role.CPU: absent -> 10`. The
  SHARED database was not a target.
- **Item 7: PASS as a MEASUREMENT.** `node scripts/eval-scenarios.js --model=launch-v2@2.4.0
  --no-baseline --no-volatile`: 86 rows, **81 PASS / 4 EXPECTED-RED / 0 HARD FAIL / 1 UNKNOWN, exit
  0**, cleanup residue 0. Before the pin-scoped hypothesis the same run read 76 PASS / 4 EXPECTED-RED /
  5 HARD FAIL, all five A10 and order-only — which is why the scope exists. A1 is 15 of 15 at 3
  distinct pairs each (S06 included); A5 is 2 of 2 (11246 < 11845 and 13946 < 19246, signatures
  differ); S18's `NO_PERFORMANCE_CANDIDATE` is inside A10's allowed shortfall vocabulary. The 4
  EXPECTED-RED rows (A3 x3, A4 x1) are pre-existing unreviewed hypotheses and did not move.
- **Item 7 review: APPROVED 2026-10-31, on evidence** (this supersedes the `hypothesis` status of the bullet above for `launch-v2@2.4.0` only). The pin-scoped A10 moved from `hypothesis` to
  `approved` (reviewer recorded) with its five measured orders UNCHANGED. Before signing I checked
  derivation, not just pass/fail: GAMING's objectives (PERFORMANCE 0.50 / BALANCED 0.30 / VALUE 0.20)
  produce `[PERFORMANCE,BALANCED,VALUE]` at neutral priority (S03, S11), S10's priority-1 lean keeps
  `[VALUE,PERFORMANCE,BALANCED]`, and OFFICE's BALANCED 0.40 = VALUE 0.40 tie falls to base order,
  giving `[BALANCED,VALUE]` at S18 and `[BALANCED,VALUE,PERFORMANCE]` at S19. A `--filter=S03,S10,S11,S18,S19`
  run then showed the added archetypes are real recommendations: A6 PASS at S18/S19 with
  `selected_builds_with_gpu: 0` (GPU-less iGPU builds, price inside the approved ratio) and A9 PASS
  (zero REJECT among the selected builds); S18's `NO_PERFORMANCE_CANDIDATE` is A10's allowed
  shortfall vocabulary. The 2.2.0 approval is untouched, and this is an ORDER approval — release
  adoption is still Decision 57's gate.
- **Operational note.** The 2.4.0 row was found `is_active = false` on the shared TEST branch roughly
  nine minutes after the seed apply, and no code in the tree writes that column; it was restored with
  a guarded `UPDATE ... WHERE is_active = false` (1 row) before the approval run. A shared branch is
  not exclusively ours, so re-read the row's `is_active` before relying on this pin. The same
  sweep found 21 `recommendation_query` rows written by another actor (none carrying this probe's
  `engine_version` marker); they block the golden harness preflight until swept with
  `eval-scenarios.js --cleanup-orphans`, never a manual DELETE.
### Measured assembly cost (2026-10-31, TEST branch, both pins over the same 20 golden inputs)

Method: the API's own pass path (`repository.createRecommendationQuery` -> `engine.runFullRun`)
once per golden scenario per pin, two full sweeps; each run's rows are deleted in FK order and the
probe's own residue is asserted 0. "CPU" is `process.cpuUsage()` around the run, which excludes
network wait; "wall" includes it.

| Pass | retained (2.2.0 -> 2.4.0) | assembled builds | persisted `build_candidate` / `build_component` |
|---|---|---|---|
| S03 1080p GAMING 12000 | 40 (CPU 5) -> 45 (CPU 10) | 10 -> 24 | 3 / 24 -> 3 / 24 |
| S06 1440p GAMING 12000 | 40 (CPU 5) -> 45 (CPU 10) | 2 -> 6 | 1 / 8 -> 3 / 24 |
| S07 1440p GAMING 20000 | 40 (CPU 5) -> 45 (CPU 10) | 24 -> 25 | 3 / 24 -> 3 / 24 |
| S10 1080p GAMING 12000 p1 | 40 (CPU 5) -> 45 (CPU 10) | 10 -> 24 | 3 / 24 -> 3 / 24 |
| S11 1080p GAMING 12000 p5 | 40 (CPU 5) -> 45 (CPU 10) | 10 -> 24 | 3 / 24 -> 3 / 24 |
| S14 WORKSTATION 12000 | 40 (CPU 5) -> 45 (CPU 10) | 8 -> 20 | 3 / 24 -> 3 / 24 |
| S18 OFFICE 8000 | 40 (CPU 5) -> 41 (CPU 6) | 2 -> 4 | 1 / 7 -> 2 / 14 |
| S19 OFFICE 10000 | 40 (CPU 5) -> 41 (CPU 6) | 10 -> 12 | 3 / 21 -> 3 / 21 |
| the other 12 passes | 40 (CPU 5) -> 45 (CPU 10), OFFICE S17 41 (CPU 6) | unchanged (most already at the 25 cap) | unchanged |

- **Retention:** 40 -> 45 candidates on 17 of 20 passes, all of it the CPU bucket (5 -> 10). The three
  OFFICE passes gain ONE CPU (41 in total) because the model's `IGPU_ALLOWED` policy excludes CPUs
  with no verified integrated GPU: on OFFICE the policy, not the depth, is the binding constraint. Audited 2026-10-31: all 18 CPUs carrying a `cpu_spec` row have a NON-NULL flag (6 true / 12 false / 0 unknown), every `false` matches its SKU (AMD `F` parts 8700F/7500F, Intel `F`/`KF` parts 12400F/12700KF, and the APU-less 3500X/5500/5600/5600X/5700X/5800X/5900X/5950X), every `true` names its iGPU, and no CPU-named product lacks a spec row - so the six-CPU ceiling is catalog COMPOSITION, not a data gap, and widening OFFICE needs more iGPU parts in the catalog rather than a flag fix.
- **Assembly:** 281 -> 344 builds across one 20-pass sweep (+22%), with 8 passes moving
  (S03/S10/S11 +14, S14 +12, S06 +4, S18 +2, S19 +2, S07 +1) and 12 unchanged. The real ceiling is
  `max_builds_per_query` 25, which most GAMING passes already reach at 2.2.0.
- **Persistence:** 47/371 -> 50/394 `build_candidate`/`build_component` rows (+3/+23, +6%), because
  persistence writes only the SELECTED top-3 set (Decision 41) - so assembled-build count is NOT a
  proxy for write amplification, and the extra assembly is in memory.
- **Time:** median engine CPU 32 ms (2.2.0) vs 16 ms (2.4.0) over 40 passes each, ranges 0-79 and
  0-94, i.e. overlapping and under the noise floor at this catalog size: NO speedup is claimed in
  either direction. Wall medians are 5.90 s vs 5.77 s (ranges 5.2-8.3 and 4.9-9.0 s) and CPU is
  under 1% of wall, so the sweep says nothing about deployed latency - V1's input stays
  `measure-db-roundtrip.js` x statement count, which this change does not move.

**Post-seed catalogue check (2026-10-31, seed 023, TEST branch only).** The OFFICE
ceiling this section attributes to catalogue composition was TESTED rather than assumed:
seed 023 adds four integrated-GPU CPUs (Ryzen 5 5600G, Ryzen 5 8500G, Ryzen 7 8700G,
Core i5-14400), taking the iGPU population from 6 to 10. OFFICE retention then reaches the
full depth of 10 and buys pairs - S17 1 -> 2, S18 2 -> 3, S19 3 -> 3 - with A6 PASS on all
three. The same change moves two things the other way, and both are recorded rather than
smoothed: `A10 | S18` becomes a HARD FAIL, because three pair-distinct OFFICE builds let the
selector nominate `[BALANCED, VALUE, PERFORMANCE]` where the approved order for this pin
allows two (re-approval is a reviewer act and the suite stays RED until it happens), and
`A1 | S06` falls from 3 pairs back to 1, because the new high-scoring parts take score-ranked
retention slots from the cheap AM4 CPUs while their AM5/LGA1700 platforms exceed a 12000 MAD
1440p budget - retention is score-driven and blind to PLATFORM COST, the same blind spot
OG-26 recorded for budget one layer down. The six-CPU ceiling was real and liftable, but
depth alone does not buy OFFICE pairs at every budget, and this entry does not claim the
wider catalogue as an improvement.
- **NOT claimed:** adoption of 2.4.0 as a release line, or any latency figure. What the 2026-10-31
  review approved is the pin's own archetype ORDER; which model SHIPS remains Decision 57's gate.
  Assembly breadth rises on 1440p GAMING passes (measured above: 281 -> 344 builds per 20-pass
  sweep, +23 persisted component rows, no measurable engine-CPU change); what stays unmeasured is
  latency at a DEPLOYED origin.
- **Bookkeeping:** `verify-docs` decision counts move 56 headings / 62 `Status:` lines -> 57 / 63,
  `docs/DECISION_INDEX.md` is regenerated, and `AGENTS.md` cites "Decisions 1–59".

### Supersedes / superseded by

Amends **Decision 14 Rule 8**, whose sentence "No separate `roleCaps` configuration, no per-role
override structure, and no additional configuration key is introduced" no longer holds: the override
exists as `candidate_caps.top_k_by_role`. Decision 14 was ALSO edited in place (its `### UPDATE
2026-10-30` block), so the two entries cannot disagree; Rules 1-7 and the uniform-K default are
unchanged.

## Decision 60 — OG-38's remaining half is ACCEPTED for the current release evaluation, and the budget term gets its own epic

Status: PROVISIONAL 2026-10-31 — `build_score` keeps NO budget term and GAMING/WORKSTATION may share price shares at the top rung for the `launch-v2@2.4.0` evaluation, discharged by explicit ACCEPTANCE with a measured cost instead of a score change; the budget-utilisation term is scheduled as its own epic and re-opens this the moment it lands.

Date: 2026-10-31. Closes the last open clause of **Decision 57 item 3** — "OG-38's remaining half (the missing budget term in `build_score` and GAMING/WORKSTATION non-divergence at high budgets) ... resolved or explicitly accepted" — as an ACCEPTANCE. Documentation only: no migration, no seed, no engine source, no threshold value, no deploy.

### Current situation

`src/recommendation/scoring/build-score.js` computes a build's score from its candidate scores and a compatibility penalty; no budget amount reaches it, so "the highest-scoring build" is not "the best use of the budget". That is the fact OG-38 has recorded since 2026-10-24 and it has not changed: the 2026-10-31 A2 restatement (C-49) moved the ASSERTION's denominator to what the catalogue can assemble, which makes the number honest without giving scoring an opinion about spending.

Measured at `launch-v2@2.4.0` on the TEST branch, committed in `test/golden/_scratch-v14-og59-clear-launch-v2-2.4.0.md` (86 rows, 82 PASS / 3 EXPECTED-RED / 0 FAIL / 1 UNKNOWN, exit 0, residue 0):

- **Spend against the assemble-able ceiling (A2):** rank-1 totals 11 995 / 19 546 / 23 794 MAD against ceilings 11 997 / 19 994 / 28 784 — ratios 0.99983 / 0.97759 / 0.82664 on the S03/S04/S05 series and 1.0 / 0.97759 / 0.82664 on S06/S07/S08. Nothing enforces utilisation of the REQUEST; the gate only asks that the top build be close to the dearest one the catalogue can build.
- **The two shapes the row names, still true:** OFFICE at 10 000 MAD returns a **9 446 MAD** build (S19), and GAMING at 30 000 MAD returns **23 794** (S05/S08/S09) where the catalogue assembles 28 784.
- **Use-case divergence has NARROWED to one rung.** A3 (still `hypothesis`, so EXPECTED-RED either way) measures S04/S15 CPU+RAM shares 0.19943 vs 0.22119 (overlap 0.28) and S03/S14 0.32497 vs 0.32770 (overlap 0.48) — they differ. Only the top rung still converges: S05/S16 share CPU+RAM **0.14495 exactly**, signature overlap 0.64. The 2026-10-24 note in OG-38 recorded three converging rungs (`overlap 1.0`, equal shares at S04/S15 too), so E2/E4 and the 023-025 catalogue moved that half; it is not gone.

### Problem

Decision 57's release gate needs a disposition for this clause, and without one two things stay unowned. First, a deploy could be called a release while the engine silently prefers a cheaper build — and the A2 restatement makes that invisible to every approved assertion by construction, because a build at 82.66 percent of the ceiling passes it. Second, someone will eventually "fix" the budget behaviour inside a gate-clearing session: a term in `build_score` moves every score, every rank and every approved row, so doing it beside other changes makes both unattributable — the same failure mode Decision 56 avoided for swaps and Decision 59 avoided for depth.

### Decision

1. **No budget term is added in this pass, and that is a recorded acceptance for `launch-v2@2.4.0`'s release evaluation.** The measured cost is the three numbers above: rank-1 spends 99.98 / 97.76 / 82.66 percent of what the catalogue can assemble, and an OFFICE query at 10 000 MAD may return 9 446.
2. **GAMING/WORKSTATION convergence at 30 000 MAD is accepted, not resolved.** The other two rungs now differ, which is measured progress; the top rung does not, and A3 remains `hypothesis` until a reviewer rules on it (Decision 57 item 3's review clause, unchanged by this entry).
3. **A2 is not the budget gate and must never be cited as one.** It now divides by the priciest RANKED build (C-49), so it cannot fail for under-spending the request. Any future claim that budget utilisation is "gated" must name a term in `build_score`, not an assertion.
4. **The term is scheduled as its own epic, with its own Decision.** It must specify the term's shape (share of budget, diminishing returns, or a target band), which scoring-model version carries it, and its own re-measurement. Landing it requires a full rebaseline of the 20-scenario suite, a `verify:pi1` re-run, and re-measurement of every `approved` row, and it must NOT ride on a gate-clearing or catalogue session.
5. **Re-check trigger (binding).** This acceptance re-opens on any of: the budget-term epic landing; a deploy of `launch-v2@2.x` being described as a release (Decision 57); any change to `build_score` weights, to A2 or A3, or to a scoring-model version that a release would serve; or a reviewer ruling on A3.
6. **Nothing here adopts `launch-v2@2.4.0`.** Decision 57 still decides what ships, the shared database stays on `seed-minimal-v1@1.0.0`, and A1/A3/A4 keep their review status.

### Rejected alternatives

- **Add the term now.** Rejected on attribution, not on difficulty: every `build_score` moves, so the engine change, the rebaseline and the A-row re-measurements would all land in one session whose diff cannot separate "budget term" from "whatever else was open". Decision 57's gate is a record, not a deadline.
- **Let A2 stand as the budget gate.** Rejected as measuring the wrong quantity: a ceiling-relative ratio passes a build that spends 82.66 percent of what the catalogue allows, which is exactly the behaviour the row complains about. It also invites a threshold edit the next time a catalogue change moves the ratio.
- **Declare the divergence half closed because two of three rungs now differ.** Rejected: the top rung still reports identical CPU+RAM shares, and A3 is an unreviewed hypothesis — closing it on a partial improvement would be the same "measurement drifted, claim did not" failure this register exists to catch.
- **Fold the acceptance into Decision 57's own entry.** Rejected: Decision 57 decides WHICH model is evaluated; this decides that a known scoring limitation is accepted for that evaluation and owns its re-check trigger. One entry per contract, so the gate can cite a sentence instead of a paragraph.

### Verdict for this pass

- **Measured, then accepted:** the figures above are from the committed `_scratch-v14` artifact, not re-derived here; no engine source, threshold, seed or schema changed in this pass.
- **Items 1-3: PASS** as a recorded acceptance — nothing was fixed, and nothing is claimed to be.
- **Item 4: OPEN by design** — the epic is scheduled, with the constraints that make it attributable.
- **Bookkeeping:** `verify-docs` decision counts move 57 headings / 63 `Status:` lines -> 58 / 64, `docs/DECISION_INDEX.md` is regenerated, and `AGENTS.md` cites "Decisions 1-60". OG-38's register row moves from `OPEN` to `DEFERRED 2026-10-31 → Decision 60` (no C- row: a deferred row is still visible in section 1 by policy).

## Decision 61 — Two catalog defects stay deliberately unverified instead of being filled in

Status: DEFERRED 2026-10-31 — `Seed Connect PSU 850` and `Seed HYBROK PSU 650` keep NULL connector counts and `Seed Corsair Nautilus 240 RS ARGB Black AIO` keeps a NULL `max_tdp_watts`, because no citable vendor or retailer publishes those figures; both defects resolve conservatively (PSU: FAIL at high TGP; cooler: UNKNOWN) and both re-open on any published source.

Date: 2026-10-31. Closes **OG-08** and **OG-50** as recorded DEFERRALS rather than fixes. Documentation only: no seed, no migration, no engine source, no data change — the NULLs already exist and this decides that they STAY.

### Current situation

Measured on the TEST branch 2026-10-31 (read-only probe, no writes): `cooler_spec` holds 9 rows and exactly ONE has NULL `max_tdp_watts` — the Nautilus 240; the four AIR coolers and the four other AIOs each carry a figure, so the shared database's extra NULL is the `TestCompatCooler` fixture OG-51 removed. The two PSUs are unchanged since seed 005: five or more retailers were checked per row across four connector fields (EPS, PCIe 8-pin, 12VHPWR, SATA) and none publishes any of them, so the catalog keeps NULL — never a zero.

### Problem

Both defects are load-bearing in one direction only, and both invite the same wrong fix. Inventing a connector count or a TDP would make a compatibility rule answer a question no source can answer — the failure seed 003 D4 and seed 005 D2 were written to prevent, and one this repository has already paid for: OG-08 records a pass that wrote 6 PCIe connectors from a 404 vendor page and an EPS count that three sources contradicted, caught only by an independent re-check. Leaving them as ad-hoc prose instead means the next agent re-researches both from scratch, which OG-08 records happening twice already.

### Decision

1. **The NULLs stay.** No value is authored for either PSU's connector counts or for the Nautilus TDP. A NULL is the honest state of an absent source; a zero would be a false deficit.
2. **The conservative direction is the contract.** A NULL required connector on a pair at or above 200 W board TGP FAILs (`GPU_PSU_CONNECTOR_NULL_HIGH_TGP`, Decision 26), so the catalog can under-recommend but cannot over-recommend. The cooler's NULL yields UNKNOWN `COOLER_TDP_UNKNOWN` (E8 SOFT), which never passes and never rejects.
3. **The cooler's measured cost stays bounded.** One UNKNOWN is one build-local pair, costing `unknown_compat_penalty` = 5 points on any build containing this cooler (all five active models carry 5). The cooler appears in no committed golden artifact, so no approved row moves.
4. **Re-check trigger (binding).** Any single published source re-opens the corresponding row — a vendor or retailer page listing all four connector counts for either PSU, or a Corsair-published TDP/cooling capacity for the Nautilus 240 RS — plus any cooler seed, any PSU seed, or a change to Decision 26 or E8.
5. **Not claimed:** that either PSU is inadequate, nor that the Nautilus cannot cool a given load. What is recorded is that the catalog may not say, which is different from saying it does not.

### Rejected alternatives

- **Invent a plausible figure** (a common 850 W layout is 2x EPS, 4x PCIe): rejected — it converts an UNKNOWN into an unsourced PASS, and OG-08 records exactly this being done and being wrong on both rows.
- **Drop the two PSUs from the catalog:** rejected — both are real, priced parts that assemble builds; absence would hide them rather than mark them.
- **Borrow a sibling SKU's spec** (another Nautilus variant, another 850 W unit): rejected — a different product's figure is not evidence about this one, and the G850 pass failed precisely by matching the HCG GOLD 850W's 6-connector layout.
- **Treat the cooler's NULL as PASS:** rejected by the status vocabulary — UNKNOWN is never PASS, and a build's UNKNOWN pair is priced by design.

### Verdict for this pass

- **PASS as RECORDED DEFERRALS:** nothing was authored, no data changed, and both rows now carry the reason they stay instead of a stale "open" label.
- **Bookkeeping:** `verify-docs` decision counts move 58 headings / 64 `Status:` lines -> 59 / 65, `docs/DECISION_INDEX.md` is regenerated, and `AGENTS.md` cites "Decisions 1-61". OG-08 and OG-50 move `OPEN` -> `DEFERRED 2026-10-31 -> Decision 61`.

## Decision 62 — the API serves the scoring model a deployment NAMES, and unset keeps the newest-ACTIVE-row rule

Status: RESOLVED 2026-11-01; IMPLEMENTED 2026-11-01 (apps/api) — the served scoring model is the explicit `name@version` deploy setting `SCORING_MODEL_PIN`, selecting among ACTIVE rows only, failing the deploy on a malformed value and answering 503 on an unmatched or ambiguous one, while an unset variable preserves the pre-existing newest-ACTIVE-row rule.

Date: 2026-11-01. Prompted by OG-54's 2026-11-01 re-measurement. Applying seed 027 replayed every seed file onto the shared database and moved the only deployed origin (`https://morocco-pc.onrender.com`) from `seed-minimal-v1@1.0.0` to `launch-v2@2.4.0` with no code change, no deploy and no error — the failure mode Decision 57's own amendment predicted, fired. Scope: which scoring model the API executes, and the setting that decides it. It is NOT an activation of any model, NOT a `scoring_model` row, NOT a seed and NOT a migration.

### Current situation

`apps/api/src/repository.js` `SELECT_ACTIVE_SCORING_MODEL_SQL` answered the question with one implicit rule: the ACTIVE rows newest-first, `LIMIT 1`. That rule is what every route used until this decision, so what an environment SERVES was a property of its seed-set rather than of anything a deploy declared. Measured 2026-11-01 on the shared database: 7 `scoring_model` rows, SIX `launch-v2` versions ACTIVE, `seed-minimal-v1@1.0.0` INACTIVE (OG-54).

The comparison harnesses have had the other half of this vocabulary since Decision 39: `scripts/lib/model-pin.js` resolves a model by `name@version` among ACTIVE rows and refuses a malformed, ambiguous, inactive or unmatched pin. Nothing in `apps/api/` did.

### Problem

"A seed apply changed what production serves" is not an acceptable contract for a served recommendation: two identical POSTs before and after an apply return different builds with no deploy, no version bump and no error. Decision 57 had already named the mechanism and the release gate; what it did not have was a lever an operator could pull at deploy time.

### Decision

1. **One setting decides it.** `SCORING_MODEL_PIN=name@version` is read ONCE, where the app is BUILT (`apps/api/src/app.js`), and exposed as `app.scoringModelPin`; every route passes it to the ONE selection point, `repository.selectActiveScoringModel(db, pin)`. No route re-derives the model, and the environment is read through a single function (`readModelPin`).
2. **The grammar is Decision 39's**, deliberately: exactly one `@`, both halves non-empty, no whitespace anywhere, and a second `@` refused rather than interpreted. Implemented in `apps/api/src/scoring-model-pin.js` (`parseModelPin` / `normalizeModelPin`) and pinned by `apps/api/test/unit/scoring-model-pin.test.js`.
3. **A malformed value fails the DEPLOY**, not a request: parsing throws while the app is constructed, so a typo never answers plausible 200s.
4. **A pin selects among ACTIVE rows only.** `is_active = true` is part of the pinned identity, not a filter of convenience, so an inactive pin is a refusal rather than a silent activation (Decision 11).
5. **A pin matching NO row, or MORE THAN ONE, is `SCORING_MODEL_UNAVAILABLE` (503)** — never a fallback to the newest active row. The pinned statement carries `ORDER BY id ASC` with no `LIMIT` specifically so an ambiguous identity is DETECTED; a miss issues exactly one statement and is not repaired by a second query.
6. **Unset means the pre-existing rule** (absent and blank both normalise to `null`), so no existing test, local run or deployment changes without opting in.
7. **The pin is an operator detail.** It never appears in a response body; the code a client already understands for "no usable model" carries the refusal. Startup logs which model the process serves — including the implicit case — so a deploy cannot serve an unintended model invisibly.

### Rejected alternatives

- **Deactivate the extra rows and rely on `is_active`:** rejected as the CONTRACT — it makes the served model a property of the seed-set, and an apply restores it. It remains a legitimate operational action, not a guarantee.
- **Answer a generic `500`:** rejected — `503` already means "no usable model" to a client, and the distinction is what lets an operator find a bad pin in the log without leaking it in the body.
- **Let the request choose the model (`?model=` or a body field):** rejected — any caller could then pick the scoring line, and Decision 36 keeps options on the server.
- **Require `scripts/lib/model-pin.js` from the API:** rejected — `scripts/` is not a runtime dependency of the served process, and importing harness tooling into a deploy would drag the harness surface with it. The grammar is duplicated on purpose and both copies are pinned by their own suite.
- **A `served` flag on `scoring_model` instead:** rejected for now — it needs a migration and still asks an operator to declare the choice; it can supersede item 1 later without changing the refusal semantics.

### Verdict for this pass

- **PASS — implemented and pinned:** `test:api` 191/191, 9 of them new in `scoring-model-pin.test.js` (the grammar and its refusals, blank/absent normalising to null, an app that refuses to BUILD on a typo, the pin reaching the one selection point, unset staying the newest-active row, a 503 that keeps the pin out of the body, one statement and the parsed halves on a hit, and no second query on a miss).
- **PASS — docs:** `docs/API.md`'s environment table and `apps/api/.env.example` carry the setting, `docs/TEST_MAP.md` registers the contract, and `verify:docs --offline` is green.
- **NOT done, and not claimed:** no environment SETS the variable yet, so the deployed origin still serves whichever row is newest. Pinning it is an owner act at deploy time, recorded as OG-54 item 2 — this decision supplies the lever, not the setting.

### Supersedes / superseded by

Does not supersede Decision 57: that decision's 2026-11-01 amendment records the mechanism, and this entry supplies the lever. `scripts/lib/model-pin.js` (Decision 39) is unchanged and remains the harness's selector.
