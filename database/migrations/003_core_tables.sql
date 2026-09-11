CREATE TABLE manufacturer (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    website TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_manufacturer_name ON manufacturer(name);

CREATE TABLE socket (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_socket_name ON socket(name);

CREATE TABLE platform (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    socket_id UUID NOT NULL REFERENCES socket(id),
    release_year INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE memory_type (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_memory_type_name ON memory_type(name);

CREATE TABLE platform_memory_support (
    platform_id UUID NOT NULL REFERENCES platform(id),
    memory_type_id UUID NOT NULL REFERENCES memory_type(id),
    PRIMARY KEY (platform_id, memory_type_id)
);

CREATE TABLE product_family (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    manufacturer_id UUID NOT NULL REFERENCES manufacturer(id),
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE product (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_family_id UUID NOT NULL REFERENCES product_family(id),
    manufacturer_id UUID NOT NULL REFERENCES manufacturer(id),
    name TEXT NOT NULL,
    manufacturer_part_number TEXT,
    ean_gtin TEXT,
    lifecycle_status lifecycle_status NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE product_variant (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES product(id),
    sku TEXT NOT NULL,
    variant_type product_variant_type NOT NULL DEFAULT 'STANDARD',
    support_status support_status NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_product_variant_sku ON product_variant(sku);
