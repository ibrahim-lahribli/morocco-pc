CREATE TYPE product_category AS ENUM (
    'CPU',
    'MOTHERBOARD',
    'MEMORY',
    'GPU',
    'STORAGE',
    'PSU',
    'CASE',
    'COOLER'
);

CREATE TYPE lifecycle_status AS ENUM (
    'ACTIVE',
    'DISCONTINUED',
    'DEVELOPMENT',
    'PRE_RELEASE'
);

CREATE TYPE product_variant_type AS ENUM (
    'STANDARD',
    'OEM',
    'BUNDLE',
    'REFURBISHED',
    'LIMITED'
);

CREATE TYPE support_status AS ENUM (
    'ACTIVE',
    'DISCONTINUED',
    'END_OF_LIFE'
);

CREATE TYPE compatibility_status AS ENUM (
    'PASS',
    'FAIL',
    'UNKNOWN',
    'CONDITIONAL'
);

CREATE TYPE source_type AS ENUM (
    'OFFICIAL',
    'USER_SUBMITTED',
    'DATASHEET',
    'COMMUNITY',
    'RETAILER'
);

CREATE TYPE confidence_level AS ENUM (
    'CONFIRMED',
    'HIGH',
    'MEDIUM',
    'LOW',
    'UNVERIFIED'
);

CREATE TYPE cooling_type AS ENUM (
    'AIR',
    'LIQUID',
    'PASSIVE',
    'HYBRID'
);

CREATE TYPE psu_modularity AS ENUM (
    'FULLY_MODULAR',
    'SEMI_MODULAR',
    'NON_MODULAR'
);

CREATE TYPE ssd_form_factor AS ENUM (
    'M_2_2280',
    'M_2_2242',
    'M_2_2260',
    'M_2_22110',
    'SATA_25',
    'SATA_35',
    'U_2',
    'PCIE_CARD',
    'MSATA',
    'NGFF'
);

CREATE TYPE motherboard_form_factor AS ENUM (
    'ATX',
    'MICRO_ATX',
    'MINI_ITX',
    'E_ATX',
    'XL_ATX',
    'MINI_STX',
    'DTX',
    'ITX',
    'NANO_ITX',
    'PICO_ITX'
);

CREATE TYPE psu_form_factor AS ENUM (
    'ATX',
    'SFX',
    'SFX_L',
    'TFX',
    'FLEX_ATX',
    'LFX'
);
