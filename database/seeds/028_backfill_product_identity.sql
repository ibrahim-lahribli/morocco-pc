-- ============================================================================
-- Seed 028: backfill display_name and slug for rows that predate their seed
--           supplying them
-- ============================================================================
--
-- WHY THIS FILE EXISTS
--
-- Migration 020 introduced `product.display_name` and `product.slug` and
-- backfilled the catalogue that existed then (100 rows). Every catalogue seed
-- written afterwards had to supply them itself, and three did not: 023, 024 and
-- 025 inserted 13 products with BOTH columns NULL, which is why the API served
-- `component.slug: null` and `test:api:db` failed its post-020 identity
-- assertions on the TEST branch AND on the shared database.
--
-- Those three seeds now derive both columns at insert time, so a FRESH replay
-- produces no NULLs and this file writes 0 rows there. It exists for databases
-- that already hold the 13 rows: their seeds' NOT EXISTS guards skip them, so
-- nothing else can repair them.
--
-- DERIVATION - migration 020's own, not a second convention
--
--   display_name  the name without the "Seed " prefix
--   slug          that lowercased, non-alphanumerics hyphenated, runs collapsed
--                 and ends trimmed, i.e. exactly chk_product_slug_format
--
-- Measured before writing on both databases: the 13 rows derive format-valid
-- slugs with 0 duplicates and 0 collisions against the 100 slugs already
-- present. A future collision fails loudly on uq_product_slug instead of being
-- silently suffixed: two products wanting one URL is a data question for a
-- human, not something this seed should paper over.
--
-- SCOPE AND SAFETY
--
--   * DML only, `product` rows only: no deletes, no row creation, no schema.
--   * Idempotent: both statements are guarded on IS NULL, so a second apply
--     writes 0 rows and a CURATED slug is never overwritten (020's own rule).
--   * It touches display_name and slug and nothing else, so no offer,
--     assessment, score, rank or compatibility verdict can move.
-- ============================================================================

-- 1/2 The user-facing name: the product name without the seed prefix.
UPDATE product
   SET display_name = regexp_replace(name, '^Seed ', '')
 WHERE display_name IS NULL;

-- 2/2 The canonical product key (Decision 47). Reads the display_name filled by
-- step 1, so a row that had NEITHER column gets the same pair migration 020
-- would have written, and a row that already had a display_name derives its
-- slug from that.
UPDATE product
   SET slug = trim(both '-' FROM regexp_replace(
                  lower(regexp_replace(display_name, '[^a-zA-Z0-9]+', '-', 'g')),
                  '-+', '-', 'g'))
 WHERE slug IS NULL;
