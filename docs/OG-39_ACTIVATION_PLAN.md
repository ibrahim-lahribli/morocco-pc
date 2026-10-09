# OG-39 — scoring-model activation plan

**Status: PARTIALLY IMPLEMENTED (Step-2 item 1, 2026-10-09).** The HARNESS
SELECTOR is implemented: `scripts/lib/model-pin.js` resolves a model by
`name@version` among active rows (default `seed-minimal-v1@1.0.0`; override
`--model=<pin>` or `SCORING_MODEL_PIN`) and every comparison harness plus the
golden preflight uses it, so a TWO-ACTIVE-model branch is measurable. **No seed,
model activation or engine eligibility change has been made by this document:**
seed 013 is still unapplied, `launch-v2` exists on no database, and
`seed-minimal-v1@1.0.0` remains the only active model. Audience: Engine and
Platform maintainers coordinating a TEST-first activation.
Scope: model selection and reproducible comparison, not E2/E3 or shared-DB changes.

## Verified constraints and selection

Migration 008 declares `UNIQUE(name, version)`, not single-active uniqueness.
Migration 012 creates **non-unique** `idx_scoring_model_active ON scoring_model(is_active)`.
Read-only inspection of the TEST branch on 2026-10-08 confirmed those indexes, the primary
key, and no single-active constraint/partial unique index. Two active models are allowed
by the committed schema and inspected TEST database. The shared database was not contacted.

The API (`apps/api/src/repository.js`, `SELECT_ACTIVE_SCORING_MODEL_SQL`) chooses
`WHERE is_active = true ORDER BY created_at DESC, id ASC LIMIT 1`, then pins that ID on
the query. Multiple active rows are therefore deterministic, but the newest active row
becomes the API default; `id ASC` breaks equal-created-at ties.

Both engine entry points resolve ONLY `recommendation_query.scoring_model_id`.
`loadScoringModel` looks up `WHERE id = $1` and rejects an inactive row with
`SCORING_MODEL_UNAVAILABLE`. **An explicit pin does not bypass eligibility.**
The E1b plan's instruction to drop the discovery predicate and run an inactive v1 was
incorrect and is superseded here. Removing that predicate alone cannot keep v1 runnable.

**IMPLEMENTED 2026-10-09** - the golden preflight no longer asserts a global active
count; it resolves the PIN (Step-2 item 1, Case (a) step 3) and prints the global
count for visibility. The fail-fast checks are preserved and extended.

## Case (a): two active models allowed (matches current schema)

1. Obtain confirmation of the dedicated TEST engine branch. Use the existing
   `getWriteTestDbUrl()` guard and verify reachability/catalog/ledger read-only.
2. **DONE 2026-10-09.** Add explicit `--model=<name>@<version>` selection to all comparison harnesses.
   Require exactly one matching row and `is_active === true`; pin its ID on every
   query. No latest-model substitution, no inactive override, no silent fallback.
3. **DONE 2026-10-09.** Change golden preflight from global active-count equality to **pinned model exists
   and is active**; print the global active count for visibility. Preserve fail-fast
   checks and add tests for missing, inactive and ambiguous name/version selectors.
4. Do NOT apply the existing seed 013 as-is for this strategy: it deactivates v1.
   Prepare a separately reviewed, transactional activation that keeps v1 active and
   activates launch-v2 on TEST only. Do not rewrite a committed seed. Read back both
   flags and require active count 2 before measuring.
5. Run all four guarded harnesses and the golden suite explicitly against
   `seed-minimal-v1@1.0.0`, then `launch-v2@1.0.0`; require cleanup residue zero.
   Keep separate model-labelled baselines/columns, identities and assertion results.
   Do not tune thresholds to force agreement. Compare configurations as well as rows.
6. Verify API default selection separately. A newly created launch-v2 normally wins,
   but use the actual `created_at DESC, id ASC` query rather than assuming it does.
   Coordinate the API use-case vocabulary with Platform before a launch claim.
7. Roll back the TEST default by deactivating launch-v2 while leaving v1 active, in
   one explicit transaction, then verify the default and rerun v1 checks. Retain
   model rows and historical query references; do not delete referenced models.

Checkpoint: both pinned models run while active, their baselines remain distinguishable,
and API default selection is known. This is the simplest current-schema comparison path.

## Case (b): only one active model allowed (future Platform policy/constraint)

A single-active partial unique index would be a new Platform-owned sequential migration,
not a property of today's schema. Inspect the actual target constraint before activation.

1. Capture the v1 baseline while v1 is active. Teach harnesses explicit name/version
   pins and fail-fast inactive diagnostics before the swap.
2. On the confirmed TEST branch, use one caller-owned transaction to provision the
   target row/configuration as inactive if absent, **deactivate v1 first**, activate
   launch-v2 second, assert exactly one active row, then commit. The deactivate-first
   sequence avoids a partial-unique violation; other sessions see the old or new
   committed state, not a publicly visible intermediate zero-active state.
   Review the seed's statement ordering before use; do not assume seed 013 is compatible
   with an added single-active constraint. Never split its SQL by semicolons.
3. Run launch-v2-pinned harnesses and API checks after the swap; require residue zero.
   A v1-pinned harness now fails `SCORING_MODEL_UNAVAILABLE` by design. Removing
   `is_active` from its preflight cannot change that outcome, and it must not silently
   retarget v1 queries to launch-v2.
4. Compare the saved v1 baseline with the new launch-v2 baseline. For live reruns of
   both models, use separate isolated TEST branches or separate sequential, explicitly
   authorized swaps; one database cannot execute both concurrently under this policy.
5. Roll back transactionally: deactivate launch-v2, reactivate v1, assert one active
   row, commit, and verify API default plus v1 harnesses. Preserve both model rows.

An existing query pinned to a newly inactive model also becomes unrunnable under Decision
11. Persisted results are not rewritten by the flag change; replay eligibility and readback
are different contracts. Supporting replay of inactive historical models would require a
separate approved Decision, not a harness workaround.

## Safety boundaries

- Nothing here authorizes applying seed 013 or touching the shared database.
- Never use `run-seeds.js --test-db`: that flag does not route its writes to TEST.
- A future apply must use the guarded target and a transaction-local public search path.
- Shared activation, if ever requested, is a separate authorization with restore-point policy.
- No model deletion, engine eligibility bypass, E2/E3 work or cache implementation in this batch.
