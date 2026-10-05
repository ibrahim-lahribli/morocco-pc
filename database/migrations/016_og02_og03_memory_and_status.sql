-- ===========================================================================
-- OG-02 + OG-03: motherboard memory support + explicit status on
-- presence-only compatibility tables (migration 016)
--
-- Gap: OG-02 and OG-03 (docs/OPEN_GAPS.md), closed by Decision 33.
--
-- OG-02. motherboard_spec.memory_type_id is a single NOT NULL FK to
-- memory_type (004_hardware_tables.sql), so a motherboard that supports BOTH
-- DDR4 and DDR5 (real LGA1700 boards) cannot be represented. Engine 1 Rule 7
-- rejects any RAM whose memory_type_id differs from that one column - a
-- false REJECT for dual-memory boards. Fix: a new explicit support table,
-- mirroring the shape of platform_memory_support but WITH a status column:
--
--   motherboard_memory_support (
--     motherboard_product_id, memory_type_id, support_status, source_note )
--
-- Resolution rule (Decision 33): rows in this table are the SOURCE OF TRUTH
-- for a board that has any; a board with ZERO rows falls back to the legacy
-- motherboard_spec.memory_type_id exactly as today. Every currently seeded
-- board is backfilled by seed 012, so live behaviour is unchanged while
-- dual-memory boards become representable by adding a second row.
--
-- The legacy column is deliberately NOT dropped: migrations 001-015 are
-- replay-verified as a fixed set (OG-13/C-30) and loaders/seeds still write
-- it; dropping it here would break that contract in the same change. It
-- becomes denormalized legacy data, kept in sync for single-memory boards.
--
-- OG-03. case_motherboard_form_factor, case_radiator_support and
-- platform_memory_support are presence-only (a row means supported, absence
-- means UNKNOWN per the Decision 1 asymmetric policy) and cannot store an
-- explicit FAIL/UNKNOWN/CONDITIONAL. Fix: a nullable
-- support_status compatibility_status column on each. NULL preserves the
-- presence-only meaning byte-for-byte (the resolvers already read an
-- optional support_status and treat NULL the same as an absent status);
-- a non-NULL value is honoured as explicit evidence.
--
-- Re-runnability: every statement is guarded (CREATE TABLE IF NOT EXISTS,
-- ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS). Single application
-- is guaranteed by the OG-14 ledger (scripts/run-migrations.js applies the
-- pending tail once and records the filename), not by these guards alone.
--
-- Line endings: CRLF (repo convention).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS motherboard_memory_support (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    motherboard_product_id  UUID NOT NULL REFERENCES product(id) ON DELETE CASCADE,
    memory_type_id          UUID NOT NULL REFERENCES memory_type(id),
    support_status          compatibility_status NOT NULL DEFAULT 'PASS',
    source_note             TEXT,
    created_at              TIMESTAMP NOT NULL DEFAULT now(),
    updated_at              TIMESTAMP NOT NULL DEFAULT now(),

    CONSTRAINT chk_mms_status_not_unknown
        CHECK (support_status <> 'UNKNOWN')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mms_board_memory_type
    ON motherboard_memory_support (motherboard_product_id, memory_type_id);

CREATE INDEX IF NOT EXISTS idx_mms_motherboard_product_id
    ON motherboard_memory_support (motherboard_product_id);

ALTER TABLE case_motherboard_form_factor
    ADD COLUMN IF NOT EXISTS support_status compatibility_status;

ALTER TABLE case_radiator_support
    ADD COLUMN IF NOT EXISTS support_status compatibility_status;

ALTER TABLE platform_memory_support
    ADD COLUMN IF NOT EXISTS support_status compatibility_status;
