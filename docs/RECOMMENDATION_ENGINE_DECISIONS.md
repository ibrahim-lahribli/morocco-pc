# Recommendation Engine Decisions

Date: 2026-09-12. Resolves the three items listed under
"Needs clarification before coding" in
`docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md` (section 18). Documentation only:
no DB, no migrations, no code, no fixtures, no commit.

The three items (quoted verbatim from the architecture document):

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


---

End of document.
