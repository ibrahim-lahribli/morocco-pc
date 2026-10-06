-- ===========================================================================
-- Decision 35: build_component offer provenance — offer_class + store_offer_id
-- (migration 018)
--
-- Gap closed: none (additive provenance). LP: Decision 35 (beta seed-offer
-- freshness exemption). OG-21 ("store_offer_id provenance FK on
-- build_component — snapshot columns suffice today", class FUTURE) is landed
-- early by this migration and its register row is updated alongside it.
--
-- Why offer_class: Decision 35 labels every Stage 1 selected offer as
-- SEED_UNVERIFIED (ingestion_record_id IS NULL, migration 017) or VERIFIED,
-- and that label must survive into a permalink. It is SNAPSHOT at commit time
-- so a later store_offer UPDATE cannot relabel an already-persisted build —
-- the same reason the price columns are already denormalized onto
-- build_component (migration 011; Decision 19.6). The build-level label is
-- DERIVED from these rows, never stored.
--
-- Why TEXT + CHECK and not an enum: the two values are a provenance vocabulary
-- that may grow (e.g. a future REVIEWED tier). AGENTS.md section 8 forbids
-- destructively altering an enum, and this repo has never dropped one.
-- SEED_UNVERIFIED is the honest default — a row written before this migration,
-- or by a pass run with the exemption off, genuinely is unverified.
--
-- Why store_offer_id: the label is only auditable if it traces back to the
-- exact offer that produced it. Declared WITHOUT ON DELETE, matching every
-- other FK in this schema: an offer referenced by a persisted build cannot be
-- deleted. seed 006_offer_refresh.sql only re-stamps last_checked_at, so
-- nothing deletes offers today.
--
-- Safety: build_component is EMPTY (0 rows, measured 2026-10-06 on the shared
-- DB), so the NOT NULL DEFAULT backfills nothing and no existing row changes.
--
-- Re-runnability: ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS are
-- guarded, but Postgres has no ADD CONSTRAINT IF NOT EXISTS, so a hand
-- re-application would raise 42710 on chk_build_component_offer_class. Single
-- application is guaranteed by the OG-14 ledger (scripts/run-migrations.js
-- applies the pending tail once and records the filename), not by the guards.
--
-- Line endings: CRLF (repo convention).
-- ===========================================================================

ALTER TABLE build_component
    ADD COLUMN IF NOT EXISTS offer_class TEXT NOT NULL DEFAULT 'SEED_UNVERIFIED';

ALTER TABLE build_component
    ADD COLUMN IF NOT EXISTS store_offer_id UUID REFERENCES store_offer(id);

ALTER TABLE build_component
    ADD CONSTRAINT chk_build_component_offer_class
    CHECK (offer_class IN ('SEED_UNVERIFIED', 'VERIFIED'));

-- FK columns are indexed here (sibling: idx_build_component_store_id), so the
-- implied store_offer delete check does not sequentially scan build_component.
CREATE INDEX IF NOT EXISTS idx_build_component_store_offer_id
    ON build_component (store_offer_id);
