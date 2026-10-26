-- ===========================================================================
-- Migration 023: recommendation_swap - a committed swap is an APPENDED
-- derived build (Decision 56)
--
-- Gap closed: Decision 55 item 9 ("A mutating swap is OUT of scope,
-- deliberately"), which said in so many words that persisting a swapped build
-- "needs its own decision covering pass immutability, the dedupe key, presets
-- and rank / strategy_key invalidation". Decision 56 is that decision, and this
-- table is the only schema it needs.
--
-- WHY A NEW TABLE AND NOT AN UPDATE. A persisted pass is a RECORD: rank,
-- engine_version, strategy_key, the Decision 47 dedupe key, the
-- recommendation_preset pointer that names the pass, and the golden harness's
-- fingerprints all describe the assembly that produced it. Editing
-- build_component in place would make a reader unable to tell an
-- engine-produced build from an edited one - and the production role has no
-- row-wide UPDATE privilege precisely so that cannot happen quietly
-- (Decision 46 item 7). So a committed swap APPENDS: its own build_candidate
-- plus its own build_component rows, linked here to the result it was derived
-- from.
--
-- WHAT EACH ROW MEANS.
--   source_result_id   the recommendation_result (query + rank) the swap was
--                      applied to. ONE swap per build: the UNIQUE index below
--                      is decision item 6, because stacking a second edit is
--                      either an UPDATE (forbidden) or a chain the wire has no
--                      address for (a derived build has no rank).
--   build_candidate_id the DERIVED build: its own total_price, score and
--                      compatibility_status, written in the same transaction.
--                      Also UNIQUE - one swap row per derived build, so the two
--                      sides of the link cannot disagree about which is which.
--   component_role     the replaced role, one of the eight the engine
--                      assembles. Deliberately NOT a CHECK constraint against
--                      that list: EXPANSION_ORDER is engine policy, and
--                      freezing it here would make an engine change a
--                      migration. The engine and the route validate it.
--   replaced_product_id / replaced_product_variant_id
--                      what was REMOVED, kept as provenance: the derived build's
--                      own rows say what is there now, and only this pair says
--                      what it replaced. The variant is nullable because
--                      non-GPU roles are product-keyed (Decision 9).
--   catalog_version    the LIVE digest the verdict was judged against
--                      (Decision 47/55 item 7), nullable exactly as on
--                      recommendation_query: a swap judged while the digest was
--                      unavailable records UNKNOWN rather than a guess.
--   engine_version     the deploy that computed the derived build's score.
--
-- WHY NO created_at ON THE DERIVED build_candidate. build_candidate already
-- has one; the swap's own created_at is when the reader accepted it, and the
-- two are the same transaction.
--
-- NO BACKFILL, NO DEFAULT FABRICATION: the table starts empty. Every existing
-- pass simply has no swap, which is what `swapped: null` on the wire means.
--
-- INDEX NOTES. Both UNIQUE indexes are the constraint (item 6), not an
-- optimisation. `idx_recommendation_swap_source_result_id` is not added
-- separately: the UNIQUE index on that column already serves the read
-- (`WHERE source_result_id = $1`) and the FK's referential check. The
-- build_candidate side gets the same treatment from its UNIQUE index.
--
-- GRANT: none here, deliberately - same reasoning as migrations 019/021/022.
-- Privileges are not schema, the replay harness builds an empty database with
-- no role to grant to, and the production role's grant list is ONE owner-gated
-- script (scripts/lib/api-role.js). Decision 56 item 10 adds
-- `recommendation_swap` to that script's INSERT targets, which is an operator
-- step against a real database, not a migration.
--
-- BRANCH-FIRST (the 021/022 pattern). Applied to the TEST branch with
-- `run-migrations.js --test-db` in the same change; the shared database is
-- applied separately, owner-gated, from a recorded restore point. Until that
-- happens `verify:replay --reference=shared` reports exactly this file's
-- objects - the documented signal of a migration waiting for its shared apply
-- (AGENTS.md section 6), never a broken replay.
--
-- Re-runnability: CREATE TABLE / CREATE INDEX IF NOT EXISTS and a guarded
-- ADD CONSTRAINT, so a hand re-application is a no-op; single application is
-- guaranteed by the OG-14 ledger in any case.
--
-- Line endings: CRLF (repo convention).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS recommendation_swap (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_result_id UUID NOT NULL REFERENCES recommendation_result (id) ON DELETE NO ACTION,
    build_candidate_id UUID NOT NULL REFERENCES build_candidate (id) ON DELETE NO ACTION,
    component_role component_role NOT NULL,
    replaced_product_id UUID NOT NULL REFERENCES product (id) ON DELETE NO ACTION,
    replaced_product_variant_id UUID REFERENCES product_variant (id) ON DELETE NO ACTION,
    catalog_version TEXT,
    engine_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Decision 56 item 6: ONE committed swap per build.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recommendation_swap_source_result
    ON recommendation_swap (source_result_id);

-- One swap row per derived build, the mirror of the index above.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recommendation_swap_build_candidate
    ON recommendation_swap (build_candidate_id);

-- Same shape as recommendation_query's digest check (migration 021).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_recommendation_swap_catalog_version_format'
    ) THEN
        ALTER TABLE recommendation_swap
            ADD CONSTRAINT chk_recommendation_swap_catalog_version_format
            CHECK (catalog_version IS NULL OR catalog_version ~ '^[0-9a-f]{32}$');
    END IF;
END
$$;
