-- ===========================================================================
-- Compatibility tables (migration 005)
--
-- Junction / fact tables that describe real-world compatibility between
-- products and components:
--
--   cpu_motherboard_support      – which CPUs (or CPU families) a motherboard
--                                   supports, including BIOS version notes
--   cooler_socket_support        – which sockets a cooler supports
--   case_motherboard_form_factor – which motherboard form factors fit a case
--   case_radiator_support        – radiator sizes / positions supported by a case
--
-- NOTE: platform_memory_support already exists in migration 003_core_tables.sql
-- and is intentionally NOT duplicated here.
--
-- gpu_case_compatibility and gpu_psu_compatibility are deliberately omitted;
-- they are derived later from canonical specifications.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- cpu_motherboard_support
--
-- Exactly ONE of cpu_product_family_id or cpu_product_id must be populated.
--   - cpu_product_family_id → family-level compatibility (e.g. "all AM5 CPUs")
--   - cpu_product_id        → exact-CPU compatibility (a specific SKU)
--
-- Partial unique indexes prevent duplicate family-level or exact-CPU rules
-- for the same motherboard, while still allowing one family rule and one
-- exact-CPU rule to coexist.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cpu_motherboard_support (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    motherboard_product_id UUID NOT NULL REFERENCES product(id),

    cpu_product_family_id  UUID REFERENCES product_family(id),
    cpu_product_id         UUID REFERENCES product(id),

    support_status       compatibility_status NOT NULL,
    min_bios_version     TEXT,
    source_note          TEXT,

    created_at           TIMESTAMP NOT NULL DEFAULT now(),
    updated_at           TIMESTAMP NOT NULL DEFAULT now(),

    -- Exactly one of the two specificity columns must be set.
    CONSTRAINT chk_cpu_motherboard_specificity
        CHECK (
            (cpu_product_family_id IS NOT NULL AND cpu_product_id IS NULL)
         OR
            (cpu_product_family_id IS NULL AND cpu_product_id IS NOT NULL)
        )
);

-- Family-level rule: motherboard + cpu_product_family (cpu_product_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_cpu_mb_support_family
    ON cpu_motherboard_support (motherboard_product_id, cpu_product_family_id)
    WHERE cpu_product_id IS NULL;

-- Exact-CPU rule: motherboard + cpu_product (cpu_product_id IS NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_cpu_mb_support_cpu
    ON cpu_motherboard_support (motherboard_product_id, cpu_product_id)
    WHERE cpu_product_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- cooler_socket_support
--
-- Records which sockets a given cooler can mount on.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cooler_socket_support (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cooler_product_id UUID NOT NULL REFERENCES product(id),
    socket_id         UUID NOT NULL REFERENCES socket(id),
    support_status    compatibility_status NOT NULL,
    mounting_note     TEXT,
    created_at        TIMESTAMP NOT NULL DEFAULT now(),
    updated_at        TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cooler_socket_support
    ON cooler_socket_support (cooler_product_id, socket_id);


-- ---------------------------------------------------------------------------
-- case_motherboard_form_factor
--
-- States which motherboard form factors a case physically supports.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS case_motherboard_form_factor (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_product_id  UUID NOT NULL REFERENCES product(id),
    form_factor      motherboard_form_factor NOT NULL,
    created_at       TIMESTAMP NOT NULL DEFAULT now(),
    updated_at       TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_case_mb_form_factor
    ON case_motherboard_form_factor (case_product_id, form_factor);


-- ---------------------------------------------------------------------------
-- case_radiator_support
--
-- Records radiator sizes and positions a case can accommodate.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS case_radiator_support (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_product_id    UUID NOT NULL REFERENCES product(id),
    radiator_size_mm   INTEGER NOT NULL,
    position           TEXT NOT NULL,
    created_at         TIMESTAMP NOT NULL DEFAULT now(),
    updated_at         TIMESTAMP NOT NULL DEFAULT now(),

    CONSTRAINT chk_case_radiator_size_positive
        CHECK (radiator_size_mm > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_case_radiator_support
    ON case_radiator_support (case_product_id, radiator_size_mm, position);
