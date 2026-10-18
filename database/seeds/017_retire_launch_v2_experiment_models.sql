-- ===========================================================================
-- Seed 017: retire the launch-v2 pair-quota EXPERIMENT models
-- ===========================================================================
--
-- WHY THIS FILE EXISTS
--
-- Seeds 014, 015 and 016 each INSERT a NEW `launch-v2` version (1.1.0, 1.2.0,
-- 1.3.0), and each says in its own header: "This version is inserted ACTIVE on
-- the TEST branch only, beside the existing active rows, so the golden harness
-- can pin it by name@version."
--
-- `scripts/run-seeds.js` applies every file in `database/seeds/*.sql` in sorted
-- filename order to whatever `DATABASE_URL` names. It has NO branch awareness,
-- so "TEST branch only" is not something the runner can enforce: a fresh replay
-- anywhere creates FOUR active scoring models. MEASURED 2026-10-18 on the new EU
-- project `lingering-heart-20497074` (the P1 Sprint 1 co-location target), whose
-- 22-migration + full-seed replay produced:
--     launch-v2@1.0.0 ACTIVE   launch-v2@1.1.0 ACTIVE
--     launch-v2@1.2.0 ACTIVE   launch-v2@1.3.0 ACTIVE
-- plus an INACTIVE seed-minimal-v1@1.0.0. The TEST branch carries two rows
-- (launch-v2@1.0.0 active, seed-minimal-v1@1.0.0 inactive) because those three
-- experiment rows were removed there after the E3 work, while the seed files
-- that create them stayed committed.
--
-- WHY THE EXTRA ACTIVE ROW IS NOT COSMETIC
--
-- The API resolves its model with
--     SELECT id, configuration FROM scoring_model
--      WHERE is_active = true ORDER BY created_at DESC, id ASC LIMIT 1
-- so it silently takes the NEWEST active row. Measured on the two targets:
--   TEST branch -> launch-v2@1.0.0  candidate_caps {top_k_per_role 5,
--                                                    max_builds_per_query 25}
--   EU replay   -> launch-v2@1.3.0  candidate_caps {..., max_builds_per_pair 1}
-- `max_builds_per_pair` is the E3 pair-quota EXPERIMENT knob. A deployment on
-- that target would therefore run a DIFFERENT scoring model, with a different
-- assembly-time quota, than every measurement and beta run recorded against the
-- branch - under the same model name. `scripts/check-target-parity.js` reported
-- it as `rows:scoring_model DIFF 2 vs 5` with every other check MATCH.
--
-- THE LATENT HALF, which this file also closes: before it existed, ANY future
-- re-application of the seed set to the TEST branch - the documented cure for
-- the 30-day offer-freshness cliff is re-running seed 006, and `run-seeds.js`
-- applies the whole set - would have re-inserted these three rows there and
-- silently switched the branch's served model to the 1.3.0 experiment.
--
-- SCOPE - the narrowest correction that makes a replay reproduce the branch:
--   * DELETE the three EXPERIMENT versions of `launch-v2` and nothing else. Not
--     `launch-v2@1.0.0` (the version the branch serves), not
--     `seed-minimal-v1@1.0.0` (inactive, and the default harness pin).
--   * NO engine code, NO API code, NO migration. The experiment definitions stay
--     in the tree (seeds 014-016), so a pin test can still reproduce them by
--     applying those three files deliberately.
--   * Deliberately a DELETE and not `is_active = false`: the parity gate compares
--     ROW COUNTS, and the branch physically lacks these rows. Deactivating them
--     would leave `scoring_model` at 5, keep the gate RED and leave a second
--     reader path for the same identity.
--
-- THE GUARD, and why it is not merely defensive
--
-- `scoring_model` has exactly ONE referencing foreign key (measured 2026-10-18):
--     recommendation_query.scoring_model_id -> scoring_model.id
--     ON DELETE NO ACTION  (migration 011)
-- A row that any pass referenced CANNOT be deleted, and this file must not try:
-- a historical pass's `scoring_model_id` is provenance. The `NOT EXISTS`
-- predicate skips any row a `recommendation_query` row points at, which is what
-- makes the file safe on a database that has already served traffic. Proven by
-- FIRE on 2026-10-18 inside a rolled-back transaction: with one synthetic query
-- pointing at 1.3.0, the DELETE removed 2 rows and skipped that one.
--
-- IDEMPOTENCY. Run once: 3 rows deleted. Run twice: 0. The END STATE is stable
-- across repeated `run-seeds.js` invocations, but the mechanism is worth stating:
-- seeds 014-016 are guarded by "this version does not exist", so in a second full
-- run they re-INSERT (the versions are now gone) and THIS file deletes them again
-- in the same run. That is exactly why the fix is a new file rather than an edit
-- to 014-016: editing them would not remove the rows an already-seeded target
-- (the EU project) holds today.
--
-- NOT a Decision 26 trigger: no cooler, RAM, case or motherboard row is touched,
-- so `check-deferred-rules.js` is unaffected by this file.
--
-- CONVENTIONS (identical to seeds 005-012): DML only, single BEGIN/COMMIT, ASCII
-- only, exact name/version matching - never a LIKE that could catch a real model.
-- ===========================================================================

BEGIN;

DELETE FROM scoring_model s
 WHERE s.name = 'launch-v2'
   AND s.version IN ('1.1.0', '1.2.0', '1.3.0')
   AND NOT EXISTS (
         SELECT 1 FROM recommendation_query q
          WHERE q.scoring_model_id = s.id
       );

COMMIT;

-- Verify (read-only): the branch's set is exactly
--   SELECT name, version, is_active FROM scoring_model ORDER BY name, version;
--   seed-minimal-v1@1.0.0 inactive | launch-v2@1.0.0 active
