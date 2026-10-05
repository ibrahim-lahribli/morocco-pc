-- ===========================================================================
-- Relax the build_rejection partner CHECK so product-keyed partners are
-- storable (migration 015)
--
-- Gap: OG-32 (docs/OPEN_GAPS.md), closed by Decision 32.
--
-- Why 014's CHECK is wrong for the data it was built to hold. Migration 014
-- added chk_build_rejection_partner_pair_complete:
--
--     (partner_product_id IS NULL AND partner_product_variant_id IS NULL)
--   OR
--     (partner_product_id IS NOT NULL AND partner_product_variant_id IS NOT NULL)
--
-- i.e. both ids or neither, with the header comment "a variant-keyed partner
-- (GPU) always carries both ids, a product-keyed one carries neither". That
-- makes partner identity representable ONLY for variant-keyed partners. But
-- the decisive partner of a rejection is most often product-keyed: the
-- partner behind GPU_TOO_THICK is a CASE (no variants exist for cases), and
-- CPU_COOLER/case_form_factor/gpu_psu decisive partners are CASE/MOTHERBOARD/
-- PSU products too. Storing "neither" for those - the only state the old CHECK
-- allowed - is exactly the OG-32 defect (partner_product_id always NULL), so
-- the constraint as written forbids the fix rather than protecting the data.
--
-- New rule (Decision 32), mirrored by persistence/validate-rejections.js:
--
--     partner_product_variant_id IS NULL
--   OR
--     partner_product_id IS NOT NULL
--
-- Truth table: (NULL, NULL)  OK - no partner (a rejection that did not depend
-- on one, e.g. CPU_SOCKET_UNKNOWN); (id, NULL) OK - PRODUCT-KEYED partner,
-- the normal case this migration exists for; (id, variant) OK - VARIANT-KEYED
-- partner (its variant belongs to its product); (NULL, variant) REJECTED - an
-- orphan variant id can never identify a partner on its own. The rejecting
-- candidate's own ids stay NOT NULL exactly as 014 wrote them, and every FK,
-- the blank-reason CHECK and the CASCADE behaviour are untouched.
--
-- NOT a rewrite of 014 (AGENTS.md section 8: committed migrations are never
-- edited): 014 is applied as-is on both databases and this file supersedes its
-- constraint by dropping it. The old constraint name disappears; anything
-- still citing chk_build_rejection_partner_pair_complete (014's own header
-- included - deliberately not edited) is historical.
--
-- Re-runnability: only the DROP half is guarded. Postgres has no
-- "ADD CONSTRAINT IF NOT EXISTS", so the ADD below raises 42710
-- (duplicate_object) if this file is executed a second time on a database
-- that already carries the new constraint - the file is therefore NOT a
-- no-op on re-application, despite the DROP ... IF EXISTS. Single application
-- is guaranteed by the OG-14 ledger (scripts/run-migrations.js applies the
-- pending tail once and records the filename), not by this file. Do not
-- hand-replay it; use the runner.
--
-- Line endings: CRLF (repo convention).
-- ===========================================================================

ALTER TABLE build_rejection
    DROP CONSTRAINT IF EXISTS chk_build_rejection_partner_pair_complete;

ALTER TABLE build_rejection
    ADD CONSTRAINT chk_build_rejection_partner_variant_requires_product
    CHECK (
        partner_product_variant_id IS NULL
        OR partner_product_id IS NOT NULL
    );
