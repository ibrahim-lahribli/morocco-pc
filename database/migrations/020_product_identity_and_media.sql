-- ===========================================================================
-- Decision 46 / Platform P0 Sprint 3: product identity + media (migration 020)
--
-- What it adds, all on `product`, all NULLABLE, no default, no invented value:
--   display_name        the user-facing name - `name` minus its "Seed " prefix
--   slug                a stable URL-safe identifier, unique per product
--   image_url           nullable, documentation-only for now
--   image_source        nullable, documentation-only for now
--   image_licence_note  the source/licence note the roadmap asks for
--
-- Why `name` is NOT touched: the seeds join on `p.name = v.name`
-- (database/seeds/00*.sql) and PIPELINE_DESIGN section 7 retires seed rows via
-- `name LIKE 'Seed %'`. Rewriting `name` would break both. display_name is the
-- user-facing field, while `name` stays the ingestion key.
--
-- Why display_name is derived rather than stored twice: 104 products, 100 of
-- them prefixed "Seed " (measured read-only 2026-10-15). The backfill strips the
-- prefix and nothing else. The 4 rows without a prefix keep their name verbatim.
-- It fills NULLs only, so a re-run cannot overwrite a curated value.
--
-- THE COLLISION HAZARD THIS FILE CLOSES. The plan's own sketch generated slugs
-- with `row_number() OVER (PARTITION BY base ORDER BY id)` suffixed `-2`, `-3`,
-- .... That is NOT collision-free ACROSS bases: a product whose own natural base
-- is literally `base-2` collides with the suffixed slug of a duplicate pair, and
-- the unique index then aborts the file with 23505. Today's catalog needs no
-- suffixing at all (104 products, 104 distinct names - measured 2026-10-15), so
-- the hazard is LATENT. Latent is exactly what a migration must not rely on.
--
-- The generator is a GREEDY GLOBAL allocation, injective BY CONSTRUCTION. Rows
-- are visited in `id` order (a UUID, so code-unit ordering - never
-- localeCompare, per AGENTS.md section 5) and each row takes the smallest free
-- candidate `base`, `base-2`, `base-3`, ... where "free" means "not already
-- handed out". Every candidate is tested against the FULL set already assigned,
-- so no two products can receive the same slug whatever their bases are.
--
-- `generate_series(1, count(*) + 1)` is not a magic bound: a row visited k-th
-- sees at most `count(*)` - 1 slugs already taken, so among its `count(*)` + 1
-- candidates at least one is free. Exhaustion is impossible, not unlikely.
--
-- Existing non-NULL slugs are seeded into the taken set and never overwritten:
-- a hand re-run is a no-op that cannot collide with (or clobber) a curated slug.
--
-- WHY THE CHECKS ARE PURE SQL, AND WHY THEY PRECEDE THE ASSIGNMENT. Both the
-- unique index and the format CHECK are created BEFORE any slug is written, so
-- they are in force while the assignment runs - the distinctness check is
-- genuinely pre-assignment, not a post-hoc sweep. A generator defect therefore
-- surfaces as
--   ERROR: duplicate key value violates unique constraint "uq_product_slug"
--   DETAIL: Key (slug)=(alpha-beta-2) is duplicated.
-- which NAMES the offender, in the same transaction, so the whole file rolls
-- back with no partial state. No plpgsql is introduced: this directory contains
-- none in 19 files, and Postgres already reports the duplicate key value - the
-- only diagnostic a DO block would add.
--
-- Why `slug` stays NULLABLE (a deliberate deviation from the plan's sketch):
-- `ALTER COLUMN slug SET NOT NULL` would break EVERY product writer that does
-- not supply one. Measured 2026-10-15: database/seeds/001_minimal_builds.sql and
-- 002_catalog_expansion.sql (3 INSERTs), scripts/test-compatibility.js (4),
-- test-layer3.js, test-layer4.js, verify-hardware-schema.js (8) and
-- verify-pool-independence.js - so `npm run seed`, the layer scripts and the
-- `verify:pi1` gate would start failing on their next insert. NULL means UNKNOWN
-- in this schema (AGENTS.md section 8), a fixture product with no slug is
-- honestly unknown, and the unique index still forbids two EQUAL slugs. The
-- completeness half is delivered instead by every catalog row receiving a slug
-- here. A later migration can add NOT NULL once the writers supply one.
--
-- Lock note: the validating ADD CONSTRAINT and the non-concurrent CREATE UNIQUE
-- INDEX each take ACCESS EXCLUSIVE on `product`. Trivial over 104 rows and on an
-- empty replay target, but the shared database is the only dev DB and is where
-- the API connects in P3 - run the apply in a quiet window.
--
-- Re-runnability: ADD COLUMN / CREATE INDEX are guarded by IF NOT EXISTS, and
-- the assignment only touches rows whose slug IS NULL. Postgres has no
-- `ADD CONSTRAINT IF NOT EXISTS`, so a hand re-application raises 42710 on the
-- CHECK - the documented exposure shared with 015 and 018. Single application is
-- in any case guaranteed by the OG-14 ledger.
--
-- STATUS 2026-10-15: APPLIED ON THE TEST BRANCH, together with 019 (ledger
-- 18 -> 20). `verify:replay --test-db --reference=test` replays all 20 files at
-- 0 drift (columns 370/370, checks 79/79, fks 60/60, indexes 100/100), and the
-- backfill ran over 100 real products: 100 slugs / 100 distinct / 0 NULL /
-- 100 display_names / 0 still `Seed `-prefixed / 0 format violations. Re-measured
-- independently on 2026-10-15 by read-only SELECTs, not by re-reading this
-- comment.
--
-- NOT APPLIED ON THE SHARED DATABASE. Shared is still at ledger 18, so
-- `product.slug` / `display_name` and the three image columns do not exist
-- there, and the API's component read fails 42703 against it. The shared apply
-- is the plan's Sprint 5 decision, gated on a recorded Neon restore point.
--
-- An earlier revision of this header recorded the PRE-apply state (TEST_DATABASE_URL
-- returning 28P01 on a stale host, branch unreachable, no local Postgres). That
-- host was repaired the same day - see DEVELOPMENT_NOTES.md, 2026-10-15 - the
-- branch was found at ledger 18 with 019 and 020 both still pending, and both
-- were applied immediately after.
--
-- Line endings: CRLF (repo convention).
-- ===========================================================================

ALTER TABLE product
    ADD COLUMN IF NOT EXISTS display_name TEXT;

ALTER TABLE product
    ADD COLUMN IF NOT EXISTS slug TEXT;

ALTER TABLE product
    ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE product
    ADD COLUMN IF NOT EXISTS image_source TEXT;

ALTER TABLE product
    ADD COLUMN IF NOT EXISTS image_licence_note TEXT;

-- The user-facing name. Fills NULLs only: a row with a curated display_name is
-- left alone, and a name with no "Seed " prefix is copied verbatim.
UPDATE product
   SET display_name = regexp_replace(name, '^Seed ', '')
 WHERE display_name IS NULL;

-- Pre-assignment checks, in force before the first slug exists.
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_slug ON product(slug);

ALTER TABLE product
    ADD CONSTRAINT chk_product_slug_format
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- The generator. See the header for why it is injective and why the bound is
-- provably sufficient. Deterministic: id-ordered (uuid, code-unit), smallest
-- free suffix, no locale-dependent comparison anywhere.
WITH RECURSIVE
pending AS (
    -- uuid has no min() aggregate - `min(uuid)` does not exist in PostgreSQL - so
    -- the walk is sequenced by an integer row_number() instead. `ORDER BY p.id` on
    -- a uuid is BYTE-WISE rather than collation-dependent, so this is deterministic
    -- and code-unit ordered, as AGENTS.md section 5 requires of a tie-break.
    SELECT p.id,
           trim(both '-' FROM regexp_replace(
               lower(regexp_replace(coalesce(p.display_name, p.name), '[^a-zA-Z0-9]+', '-', 'g')),
               '-+', '-', 'g'
           )) AS base,
           row_number() OVER (ORDER BY p.id) AS k
      FROM product p
     WHERE p.slug IS NULL
),
taken AS (
    SELECT coalesce(array_agg(p.slug), ARRAY[]::text[]) AS used
      FROM product p
     WHERE p.slug IS NOT NULL
),
walk AS (
    -- The starting state: everything already handed out, as step k = 0, so one
    -- candidate expression serves the seed and every row alike.
    SELECT 0::bigint AS k, NULL::uuid AS id, NULL::text AS base, NULL::text AS slug, t.used
      FROM taken t
  UNION ALL
    SELECT p.k,
           p.id,
           p.base,
           g.candidate,
           w.used || g.candidate
      FROM walk w
      JOIN pending p
        ON p.k = w.k + 1
      CROSS JOIN LATERAL (
           SELECT CASE WHEN n = 1 THEN p.base ELSE p.base || '-' || n END AS candidate
             FROM generate_series(1, (SELECT count(*) FROM product) + 1) AS n
            WHERE NOT (CASE WHEN n = 1 THEN p.base ELSE p.base || '-' || n END = ANY(w.used))
            ORDER BY n
            LIMIT 1
      ) g
)
UPDATE product p
   SET slug = w.slug
  FROM walk w
 WHERE p.id = w.id;
