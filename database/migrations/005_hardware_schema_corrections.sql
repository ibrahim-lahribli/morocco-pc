-- ===========================================================================
-- Migration 005: Hardware schema corrections
--
-- Corrects the hardware specification tables applied in migration 004.
-- This migration is idempotent and safe to run on both existing databases
-- (that had the old 004 applied) and fresh databases (that have the
-- corrected 004 applied).
--
-- Corrections:
--   1. gpu_board_spec.required_power_connectors -> JSONB NULL
--   2. gpu_board_spec.width_slots -> NUMERIC(4,2) NULL
--   3. gpu_chipset: remove inferred fields (architecture, compute_units,
--      base_clock_mhz, boost_clock_mhz, tdp_watts, memory_type,
--      memory_bandwidth_gbps, memory_bus_width_bits)
--   4. gpu_chipset: add agreed Layer 1 fields (vram_capacity_gb, vram_type,
--      memory_bus_width_bit, pcie_interface, base_tgp_watts)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. GPU board spec: required_power_connectors -> JSONB NULL
-- ---------------------------------------------------------------------------
ALTER TABLE gpu_board_spec
    ALTER COLUMN required_power_connectors TYPE JSONB
    USING required_power_connectors::jsonb;

-- ---------------------------------------------------------------------------
-- 2. GPU board spec: width_slots -> NUMERIC(4,2) NULL
-- ---------------------------------------------------------------------------
ALTER TABLE gpu_board_spec
    ALTER COLUMN width_slots TYPE NUMERIC(4,2)
    USING width_slots::numeric(4,2);

-- ---------------------------------------------------------------------------
-- 3. gpu_chipset: drop inferred fields and their constraints
-- ---------------------------------------------------------------------------
ALTER TABLE gpu_chipset
    DROP CONSTRAINT IF EXISTS chk_gpu_chipset_boost_ge_base,
    DROP CONSTRAINT IF EXISTS chk_gpu_chipset_compute_units_positive,
    DROP CONSTRAINT IF EXISTS chk_gpu_chipset_memory_bandwidth_positive,
    DROP CONSTRAINT IF EXISTS chk_gpu_chipset_memory_bus_positive,
    DROP CONSTRAINT IF EXISTS chk_gpu_chipset_tdp_positive;

ALTER TABLE gpu_chipset
    DROP COLUMN IF EXISTS architecture,
    DROP COLUMN IF EXISTS compute_units,
    DROP COLUMN IF EXISTS base_clock_mhz,
    DROP COLUMN IF EXISTS boost_clock_mhz,
    DROP COLUMN IF EXISTS tdp_watts,
    DROP COLUMN IF EXISTS memory_type,
    DROP COLUMN IF EXISTS memory_bandwidth_gbps,
    DROP COLUMN IF EXISTS memory_bus_width_bits;

-- ---------------------------------------------------------------------------
-- 4. gpu_chipset: add agreed Layer 1 fields
-- ---------------------------------------------------------------------------
ALTER TABLE gpu_chipset
    ADD COLUMN IF NOT EXISTS vram_capacity_gb     INTEGER,
    ADD COLUMN IF NOT EXISTS vram_type            TEXT,
    ADD COLUMN IF NOT EXISTS memory_bus_width_bit INTEGER,
    ADD COLUMN IF NOT EXISTS pcie_interface       TEXT,
    ADD COLUMN IF NOT EXISTS base_tgp_watts       INTEGER;

ALTER TABLE gpu_chipset
    DROP CONSTRAINT IF EXISTS chk_gpu_chipset_vram_capacity_positive,
    DROP CONSTRAINT IF EXISTS chk_gpu_chipset_memory_bus_positive,
    DROP CONSTRAINT IF EXISTS chk_gpu_chipset_base_tgp_positive;

ALTER TABLE gpu_chipset
    ADD CONSTRAINT chk_gpu_chipset_vram_capacity_positive
        CHECK (vram_capacity_gb > 0),
    ADD CONSTRAINT chk_gpu_chipset_memory_bus_positive
        CHECK (memory_bus_width_bit > 0),
    ADD CONSTRAINT chk_gpu_chipset_base_tgp_positive
        CHECK (base_tgp_watts > 0);
