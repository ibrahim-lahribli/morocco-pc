-- ===========================================================================
-- OG-06: offer identity (natural key) + offer provenance (migration 017)
--
-- Gap: OG-06 (docs/OPEN_GAPS.md). store_offer has had NO unique key since
-- 010_reconcile_layer3.sql dropped uq_store_offer_store_product_variant, so a
-- re-observed price cannot be UPDATE'd safely -- seed 002 documents that the
-- only sound move today is to INSERT a second offer. That is the OG-06 defect.
--
-- Design: docs/PIPELINE_DESIGN.md sections 2 and 4 (Checkpoint 2, approved
-- 2026-10-06). Two index scopes so real offers and legacy seed rows never
-- collide:
--
--   1. Ingested offers are keyed by the retailer-side stable id:
--        UNIQUE (store_id, listing_identifier) WHERE listing_identifier IS NOT NULL
--      Uniqueness is scoped per store (store_id is the leading column).
--
--   2. Legacy/seed rows (all 101 currently have listing_identifier IS NULL)
--      keep a one-offer-per-variant-per-store cap, but ONLY for NULL-id rows:
--        UNIQUE (store_id, product_id, product_variant_id)
--        NULLS NOT DISTINCT WHERE listing_identifier IS NULL
--      Making it PARTIAL is deliberate: an ingested offer (non-NULL
--      listing_identifier) is NOT covered, so a real store may hold more than
--      one listing for the same product/variant without a constraint error.
--      NULLS NOT DISTINCT requires PostgreSQL 15+; the shared server and the
--      TEST branch both report 18.6 (measured 2026-10-06), so no COALESCE
--      fallback is needed.
--
-- Provenance (trimmed, approved): product_url is REUSED as the source URL (no
-- second URL column); fetched_at is the real fetch time and is deliberately
-- NOT merged with last_checked_at (seed 006 re-stamps last_checked_at without
-- any fetch, so the semantics differ); the raw price string lives in staging
-- (product_candidate.raw_data), not here. ingestion_record_id is nullable on
-- BOTH store_offer (last observation) and price_history (each row); NULL means
-- seed/unverified, never an error.
--
-- Safety: the measured duplicate count by (store_id, product_id,
-- product_variant_id) is 0, so both indexes create with no dedup step and no
-- data loss. No row counts change; only fetched_at is backfilled from the
-- existing last_checked_at.
--
-- Re-runnability: every statement is guarded (ADD COLUMN IF NOT EXISTS,
-- CREATE UNIQUE INDEX IF NOT EXISTS). Single application is guaranteed by the
-- OG-14 ledger (scripts/run-migrations.js applies the pending tail once and
-- records the filename), not by these guards alone.
--
-- Line endings: CRLF (repo convention).
-- ===========================================================================

ALTER TABLE store_offer
    ADD COLUMN IF NOT EXISTS listing_identifier TEXT,
    ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ingestion_record_id UUID REFERENCES ingestion_record(id);

ALTER TABLE price_history
    ADD COLUMN IF NOT EXISTS ingestion_record_id UUID REFERENCES ingestion_record(id);

-- Backfill fetched_at from the existing observation timestamp. Rows written by
-- ingestion will set fetched_at directly; the WHERE clause keeps a re-run inert.
UPDATE store_offer
SET fetched_at = last_checked_at
WHERE fetched_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_store_offer_listing
    ON store_offer (store_id, listing_identifier)
    WHERE listing_identifier IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_store_offer_legacy_identity
    ON store_offer (store_id, product_id, product_variant_id)
    NULLS NOT DISTINCT
    WHERE listing_identifier IS NULL;
