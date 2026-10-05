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
   `scoring_model_id`.

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
