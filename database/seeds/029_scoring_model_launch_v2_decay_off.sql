-- ============================================================================
-- Seed 029: scoring model "launch-v2" 2.5.0 - assessment decay OFF ("launch-v2" 2.5.0)
-- ============================================================================
--
-- WHY THIS FILE EXISTS
--
-- Decision 66 (draft, owner-selected option B of the 2026-11-08 assessment-age
-- study): the beta model stops decaying assessment scores with age.
--
-- Decision 13 STEP 1 (`src/recommendation/scoring/effective-score.js`) computes
--
--     ageDays = max(0, (nowMs - assessed_at) / 86_400_000)
--     decay   = max(0, 1 - per_day_decay * min(ageDays, max_age_days))
--
-- so `launch-v2@2.4.0`'s `{ max_age_days: 180, per_day_decay: 0.005 }` multiplies
-- every assessment score by 1.0 at age 0 and by 0.1 from age 180 days onward.
-- Measured on the stored corpus (319 rows, 22 type/cohort pairs, 7 cohort dates)
-- that lowered the median effective score from 55.23 (2026-11-07) to 24.38
-- (2027-05-07) WITHOUT any data or code change, and by 2027-02-05 it had already
-- re-ordered the top of the served answer: the rank-1 CPU changed in 2 of 6
-- measured series and the rank-1 price in all 6 (docs/OPEN_POINTS.md R-28).
--
-- WHAT IT CHANGES
--
-- `launch-v2` 2.5.0 = `launch-v2` 2.4.0's configuration with EXACTLY ONE nested
-- block replaced: `staleness` becomes `{ "max_age_days": 180, "per_day_decay": 0 }`.
-- With a zero rate the decay term is 1 at every age, so an assessment's effective
-- score no longer depends on WHEN it was assessed - only on its score and its
-- confidence multiplier (Decision 13 STEP 1's other two inputs).
--
-- `max_age_days` is KEPT, not removed. It is not optional: the Decision 3(a)
-- validator (`src/recommendation/scoring/configuration.js` `validateStaleness`)
-- refuses a `staleness` object that does not carry BOTH `max_age_days` and
-- `per_day_decay` as finite numbers (MISSING_REQUIRED_FIELD
-- `staleness.max_age_days`), and `effective-score.js` re-checks the same two
-- fields. With `per_day_decay: 0` the value 180 is inert
-- (`min(ageDays, 180) * 0 == 0`), so the smallest valid "no decay" setting is
-- exactly this block: keep 180, zero the rate.
--
-- The nested `||` REPLACES the `staleness` object wholesale; the outer `||`
-- preserves every other top-level key byte-for-byte (`role_weights`,
-- `type_weights`, `neutral_baseline`, `no_evidence_penalty`,
-- `unknown_compat_penalty`, `confidence_multipliers`, `candidate_caps`,
-- `gpu_required_use_cases`, `use_case_profiles`, `resolution_profiles`,
-- `apply_archetype_objectives`, `version_note`). A pinned A/B against 2.4.0
-- therefore isolates the decay axis.
--
-- WHY A NEW VERSION AND NOT AN UPDATE OF 2.4.0
--
-- A scoring model is identified by `name@version` (`scripts/lib/model-pin.js`),
-- and 2.4.0's committed evidence (A10's per-pin block, the golden scratch runs,
-- the EU preset shelf) resolves against ITS configuration. Mutating it would
-- make that evidence describe a different model under the same name. The repo
-- recipe is INSERT a new version (`docs/RECIPES/add-a-scoring-model-version.md`).
--
-- ACTIVATION
--
-- The row is inserted `is_active = true`, beside the six rows already active on
-- every seeded database, because a pin is a SELECTOR, not an activation
-- (Decision 39): `--model=launch-v2@2.4.0` keeps resolving its evidence.
--
-- What activation DOES change, stated rather than left implicit: the API's
-- unprefixed fallback is `repository.js` SELECT_ACTIVE_SCORING_MODEL_SQL
-- (`WHERE is_active ORDER BY created_at DESC, id ASC LIMIT 1`), so on a database
-- that holds this row, the NEWEST ACTIVE model becomes 2.5.0 - the same
-- mechanism that moved an origin from seed-minimal-v1 to launch-v2@2.4.0 in
-- OG-54. A deployment whose `SCORING_MODEL_PIN` is set is unaffected: the pin
-- wins, and a pin that matches no ACTIVE row answers 503
-- `SCORING_MODEL_UNAVAILABLE` rather than falling back.
--
-- SCOPE AND SAFETY
--
-- * DML only; no schema change, no migration.
-- * Idempotent: the `NOT EXISTS` guard makes a second apply a no-op. The file
--   does NOT open its own transaction, so it can be rehearsal-wrapped.
-- * TEST-branch-first. The SHARED and EU databases are NOT targets of this file
--   in this session; each takes it only as a separate owner-gated apply with its
--   own restore point.
-- * No catalog row is touched, so the Decision 26 `check-deferred-rules.js`
--   trigger does not apply.
--
-- PREREQUISITE
--
-- `launch-v2` 2.4.0 must exist, else the INSERT selects no row and writes
-- nothing (fail-quiet). The SELECT below is the check.
-- ============================================================================

INSERT INTO scoring_model (name, version, description, configuration, is_active)
SELECT
    'launch-v2',
    '2.5.0',
    'Decision 66 (draft): launch-v2@2.4.0 with staleness.per_day_decay 0.005 -> 0, so an assessment score no longer decays with age. max_age_days stays 180 because the Decision 3(a) validator requires it; with a zero rate it is inert.',
    base.configuration || jsonb_build_object(
        'staleness',
        jsonb_build_object('max_age_days', 180, 'per_day_decay', 0)
    ),
    true
FROM scoring_model AS base
WHERE base.name = 'launch-v2'
  AND base.version = '2.4.0'
  AND NOT EXISTS (
      SELECT 1 FROM scoring_model WHERE name = 'launch-v2' AND version = '2.5.0'
  );

-- ---------------------------------------------------------------------------
-- Post-apply verification (read-only)
-- ---------------------------------------------------------------------------
-- SELECT name, version, is_active,
--        configuration->'staleness' AS staleness
--   FROM scoring_model
--  WHERE name = 'launch-v2' AND version IN ('2.4.0', '2.5.0')
--  ORDER BY version;
--
-- Expected: 2.4.0 { "max_age_days": 180, "per_day_decay": 0.005 }
--           2.5.0 { "max_age_days": 180, "per_day_decay": 0 }
--           both is_active = true.
--
-- Every other key must be byte-identical between the two rows; prove it with a
-- jsonb diff rather than by eye:
--
-- SELECT (a.configuration - 'staleness') = (b.configuration - 'staleness') AS same_but_staleness
--   FROM scoring_model a, scoring_model b
--  WHERE a.name = 'launch-v2' AND a.version = '2.4.0'
--    AND b.name = 'launch-v2' AND b.version = '2.5.0';
--
-- Rollback (single statement, and only while nothing references the row):
-- DELETE FROM scoring_model s
--  WHERE s.name = 'launch-v2' AND s.version = '2.5.0'
--    AND NOT EXISTS (SELECT 1 FROM recommendation_query q WHERE q.scoring_model_id = s.id);
