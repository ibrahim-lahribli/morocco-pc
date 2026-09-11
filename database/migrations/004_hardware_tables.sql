-- ===========================================================================
-- Hardware specification layer (migration 004)
--
-- One-to-one spec tables (PK = product_id / product_variant_id):
--   cpu_spec, gpu_board_spec, motherboard_spec, ram_spec, ssd_spec,
--   psu_spec, case_spec, cooler_spec
--
-- Shared lookup tables (reusable normalisation entities):
--   chipset, gpu_chipset
--
-- Unknown / missing values are stored as NULL where the column is nullable.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- chipset (shared lookup). The motherboard owns its socket; socket_id is
-- intentionally NOT added to chipset.
-- ---------------------------------------------------------------------------
CREATE TABLE chipset (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manufacturer_id UUID NOT NULL REFERENCES manufacturer(id),
    name           TEXT NOT NULL,
    created_at     TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_chipset_manufacturer_name ON chipset(manufacturer_id, name);

-- ---------------------------------------------------------------------------
-- gpu_chipset (shared lookup: the silicon itself, reusable across board SKUs).
-- Board dimensions live on gpu_board_spec, NOT here.
-- Contains only agreed Layer 1 fields.
-- ---------------------------------------------------------------------------
CREATE TABLE gpu_chipset (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manufacturer_id        UUID NOT NULL REFERENCES manufacturer(id),
    name                   TEXT NOT NULL,
    vram_capacity_gb       INTEGER,
    vram_type              TEXT,
    memory_bus_width_bit   INTEGER,
    pcie_interface         TEXT,
    base_tgp_watts         INTEGER,
    created_at             TIMESTAMP NOT NULL DEFAULT now(),

    CONSTRAINT chk_gpu_chipset_vram_capacity_positive
        CHECK (vram_capacity_gb > 0),
    CONSTRAINT chk_gpu_chipset_memory_bus_positive
        CHECK (memory_bus_width_bit > 0),
    CONSTRAINT chk_gpu_chipset_base_tgp_positive
        CHECK (base_tgp_watts > 0)
);

CREATE UNIQUE INDEX idx_gpu_chipset_manufacturer_name ON gpu_chipset(manufacturer_id, name);

-- ---------------------------------------------------------------------------
-- cpu_spec : one-to-one with product (product_id is PK + FK).
-- ---------------------------------------------------------------------------
CREATE TABLE cpu_spec (
    product_id                       UUID PRIMARY KEY REFERENCES product(id),

    socket_id                        UUID NOT NULL REFERENCES socket(id),
    cores                            INTEGER,
    threads                          INTEGER,
    base_clock_mhz                   INTEGER,
    boost_clock_mhz                  INTEGER,
    tdp_watts                        INTEGER,
    pbp_mtp_watts                    INTEGER,
    memory_channels                  INTEGER,
    max_official_memory_speed_mtps   INTEGER,
    pcie_generation                  INTEGER,
    integrated_gpu_present           BOOLEAN,
    integrated_gpu_model             TEXT,
    package_note                     TEXT,

    created_at                       TIMESTAMP NOT NULL DEFAULT now(),
    updated_at                       TIMESTAMP NOT NULL DEFAULT now(),

    CONSTRAINT chk_cpu_cores_positive
        CHECK (cores > 0),
    CONSTRAINT chk_cpu_threads_ge_cores
        CHECK (threads IS NULL OR cores IS NULL OR threads >= cores),
    CONSTRAINT chk_cpu_boost_ge_base
        CHECK (boost_clock_mhz IS NULL OR base_clock_mhz IS NULL OR boost_clock_mhz >= base_clock_mhz),
    CONSTRAINT chk_cpu_tdp_positive
        CHECK (tdp_watts > 0),
    CONSTRAINT chk_cpu_pbp_mtp_positive
        CHECK (pbp_mtp_watts > 0),
    CONSTRAINT chk_cpu_memory_channels_positive
        CHECK (memory_channels > 0),
    CONSTRAINT chk_cpu_max_mem_speed_positive
        CHECK (max_official_memory_speed_mtps > 0),
    CONSTRAINT chk_cpu_pcie_generation_positive
        CHECK (pcie_generation > 0)
);

-- ---------------------------------------------------------------------------
-- gpu_board_spec : one-to-one with product_variant (product_variant_id is PK + FK).
-- ---------------------------------------------------------------------------
CREATE TABLE gpu_board_spec (
    product_variant_id        UUID PRIMARY KEY REFERENCES product_variant(id),

    gpu_chipset_id            UUID NOT NULL REFERENCES gpu_chipset(id),
    board_tgp_watts           INTEGER,
    length_mm                 INTEGER,
    width_slots               NUMERIC(4,2),
    height_mm                 INTEGER,
    required_power_connectors JSONB,
    recommended_psu_watts     INTEGER,

    created_at                TIMESTAMP NOT NULL DEFAULT now(),
    updated_at                TIMESTAMP NOT NULL DEFAULT now(),

    CONSTRAINT chk_gpu_board_tgp_positive
        CHECK (board_tgp_watts > 0),
    CONSTRAINT chk_gpu_board_length_positive
        CHECK (length_mm > 0),
    CONSTRAINT chk_gpu_board_width_slots_positive
        CHECK (width_slots > 0),
    CONSTRAINT chk_gpu_board_height_positive
        CHECK (height_mm > 0),
    CONSTRAINT chk_gpu_board_recommended_psu_positive
        CHECK (recommended_psu_watts > 0)
);

-- ---------------------------------------------------------------------------
-- motherboard_spec : one-to-one with product (product_id is PK + FK).
-- motherboard_spec.socket_id is authoritative.
-- ---------------------------------------------------------------------------
CREATE TABLE motherboard_spec (
    product_id                      UUID PRIMARY KEY REFERENCES product(id),

    socket_id                       UUID NOT NULL REFERENCES socket(id),
    chipset_id                      UUID NOT NULL REFERENCES chipset(id),
    form_factor                     motherboard_form_factor,
    memory_type_id                  UUID NOT NULL REFERENCES memory_type(id),
    dimm_slots                      INTEGER,
    max_memory_capacity_gb          INTEGER,
    official_memory_speed_min_mtps  INTEGER,
    official_memory_speed_max_mtps  INTEGER,
    pcie_x16_slots                  INTEGER,
    pcie_slot_generation            INTEGER,
    m2_slots                        INTEGER,
    sata_ports                      INTEGER,
    wifi_present                    BOOLEAN,
    bios_notes                      TEXT,

    created_at                      TIMESTAMP NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMP NOT NULL DEFAULT now(),

    CONSTRAINT chk_mb_dimm_slots_positive
        CHECK (dimm_slots > 0),
    CONSTRAINT chk_mb_max_memory_capacity_positive
        CHECK (max_memory_capacity_gb > 0),
    CONSTRAINT chk_mb_memory_speed_min_positive
        CHECK (official_memory_speed_min_mtps > 0),
    CONSTRAINT chk_mb_memory_speed_max_positive
        CHECK (official_memory_speed_max_mtps > 0),
    CONSTRAINT chk_mb_memory_speed_max_ge_min
        CHECK (official_memory_speed_max_mtps IS NULL OR official_memory_speed_min_mtps IS NULL OR official_memory_speed_max_mtps >= official_memory_speed_min_mtps),
    CONSTRAINT chk_mb_pcie_x16_slots_nonneg
        CHECK (pcie_x16_slots >= 0),
    CONSTRAINT chk_mb_m2_slots_nonneg
        CHECK (m2_slots >= 0),
    CONSTRAINT chk_mb_sata_ports_nonneg
        CHECK (sata_ports >= 0),
    CONSTRAINT chk_mb_pcie_slot_generation_positive
        CHECK (pcie_slot_generation > 0)
);

-- ---------------------------------------------------------------------------
-- ram_spec : one-to-one with product (product_id is PK + FK).
-- Total capacity is NOT stored; it is module_count * capacity_per_module_gb.
-- ---------------------------------------------------------------------------
CREATE TABLE ram_spec (
    product_id             UUID PRIMARY KEY REFERENCES product(id),

    memory_type_id         UUID NOT NULL REFERENCES memory_type(id),
    module_count           INTEGER,
    capacity_per_module_gb INTEGER,
    rated_speed_mtps       INTEGER,
    voltage_v              NUMERIC(4,2),

    created_at             TIMESTAMP NOT NULL DEFAULT now(),
    updated_at             TIMESTAMP NOT NULL DEFAULT now(),

    CONSTRAINT chk_ram_module_count_positive
        CHECK (module_count > 0),
    CONSTRAINT chk_ram_capacity_per_module_positive
        CHECK (capacity_per_module_gb > 0),
    CONSTRAINT chk_ram_rated_speed_positive
        CHECK (rated_speed_mtps > 0),
    CONSTRAINT chk_ram_voltage_positive
        CHECK (voltage_v > 0)
);

-- ---------------------------------------------------------------------------
-- ssd_spec : one-to-one with product (product_id is PK + FK).
-- ---------------------------------------------------------------------------
CREATE TABLE ssd_spec (
    product_id        UUID PRIMARY KEY REFERENCES product(id),

    capacity_gb       INTEGER,
    form_factor       ssd_form_factor,
    interface         TEXT,
    protocol          TEXT,
    pcie_generation   INTEGER,

    created_at        TIMESTAMP NOT NULL DEFAULT now(),
    updated_at        TIMESTAMP NOT NULL DEFAULT now(),

    CONSTRAINT chk_ssd_capacity_positive
        CHECK (capacity_gb > 0),
    CONSTRAINT chk_ssd_pcie_generation_positive
        CHECK (pcie_generation > 0)
);

-- ---------------------------------------------------------------------------
-- psu_spec : one-to-one with product (product_id is PK + FK).
-- ---------------------------------------------------------------------------
CREATE TABLE psu_spec (
    product_id                UUID PRIMARY KEY REFERENCES product(id),

    rated_wattage             INTEGER,
    efficiency_certification  TEXT,
    atx_standard_version      TEXT,
    form_factor               psu_form_factor,
    length_mm                 INTEGER,
    connector_24pin_atx       BOOLEAN,
    connector_eps_count       INTEGER,
    connector_pcie_8pin       INTEGER,
    connector_12vhpwr         INTEGER,
    connector_sata            INTEGER,
    modularity                psu_modularity,

    created_at                TIMESTAMP NOT NULL DEFAULT now(),
    updated_at                TIMESTAMP NOT NULL DEFAULT now(),

    CONSTRAINT chk_psu_rated_wattage_positive
        CHECK (rated_wattage > 0),
    CONSTRAINT chk_psu_length_positive
        CHECK (length_mm > 0),
    CONSTRAINT chk_psu_connector_eps_count_nonneg
        CHECK (connector_eps_count >= 0),
    CONSTRAINT chk_psu_connector_pcie_8pin_nonneg
        CHECK (connector_pcie_8pin >= 0),
    CONSTRAINT chk_psu_connector_12vhpwr_nonneg
        CHECK (connector_12vhpwr >= 0),
    CONSTRAINT chk_psu_connector_sata_nonneg
        CHECK (connector_sata >= 0)
);

-- ---------------------------------------------------------------------------
-- case_spec : one-to-one with product (product_id is PK + FK).
-- ---------------------------------------------------------------------------
CREATE TABLE case_spec (
    product_id               UUID PRIMARY KEY REFERENCES product(id),

    max_gpu_length_mm        INTEGER,
    max_gpu_thickness_slots  INTEGER,
    max_cpu_cooler_height_mm INTEGER,
    psu_form_factor          psu_form_factor,
    max_psu_length_mm        INTEGER,

    created_at               TIMESTAMP NOT NULL DEFAULT now(),
    updated_at               TIMESTAMP NOT NULL DEFAULT now(),

    CONSTRAINT chk_case_max_gpu_length_positive
        CHECK (max_gpu_length_mm > 0),
    CONSTRAINT chk_case_max_gpu_thickness_positive
        CHECK (max_gpu_thickness_slots > 0),
    CONSTRAINT chk_case_max_cpu_cooler_height_positive
        CHECK (max_cpu_cooler_height_mm > 0),
    CONSTRAINT chk_case_max_psu_length_positive
        CHECK (max_psu_length_mm > 0)
);

-- ---------------------------------------------------------------------------
-- cooler_spec : one-to-one with product (product_id is PK + FK).
-- ---------------------------------------------------------------------------
CREATE TABLE cooler_spec (
    product_id    UUID PRIMARY KEY REFERENCES product(id),

    cooling_type  cooling_type,
    max_tdp_watts INTEGER,
    height_mm     INTEGER,
    length_mm     INTEGER,
    width_mm      INTEGER,

    created_at    TIMESTAMP NOT NULL DEFAULT now(),
    updated_at    TIMESTAMP NOT NULL DEFAULT now(),

    CONSTRAINT chk_cooler_max_tdp_positive
        CHECK (max_tdp_watts > 0),
    CONSTRAINT chk_cooler_height_positive
        CHECK (height_mm > 0),
    CONSTRAINT chk_cooler_length_positive
        CHECK (length_mm > 0),
    CONSTRAINT chk_cooler_width_positive
        CHECK (width_mm > 0)
);
