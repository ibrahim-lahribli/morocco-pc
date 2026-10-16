-- ===========================================================================
-- Decision 48: recommendation_preset (migration 022)
--
-- What this table is. One row per generated landing-page recommendation, keyed
-- by (use_case, currency, catalog_version, budget_amount) and POINTING at the
-- persisted pass that produced it. Platform P1 Sprint 6 generates the ribbon
-- (budget 6k-40k in 2k steps x the active model's use cases), persists each pass
-- through the ordinary API write path, and serves the rows from
-- GET /v1/presets - so the rib is the SEO landing-page source and a client that
-- follows a preset id lands on exactly the recommendation the page showed.
--
-- WHY A NATURAL COMPOSITE KEY AND NOT A SURROGATE id
-- The identity of a preset IS its four-part key: there is no fifth fact about a
-- preset that a surrogate id would let us address. Making the key the PRIMARY
-- KEY is what makes "generate twice, get no duplicates" (the sprint's scenario
-- 6.2) a DATABASE property rather than a convention the generator has to
-- remember: a second row for the same key is rejected, and the writer's
-- ON CONFLICT ... DO UPDATE makes a re-run replace rather than accumulate
-- (Decision 31's replace-idempotent convention). Decision 34 set the same
-- precedent for offer identity.
--
-- WHY THE KEY COLUMNS ARE IN THIS ORDER
-- The read path is `WHERE use_case = $1 AND currency = $2 AND catalog_version = $3
-- ORDER BY budget_amount ASC` - the endpoint serves one use case in one currency
-- at the CURRENT catalog version. Declaring the key in exactly that order makes
-- that query a single index range scan with no sort step, so no additional index
-- is created here (the same reasoning migration 021 used for the dedupe lookup:
-- an index chosen before there is a plan to look at is a guess).
--
-- WHY catalog_version IS NOT NULL HERE (it IS nullable on recommendation_query)
-- The two columns answer different questions. On a query row, NULL honestly
-- records "this pass did not record which catalog state it ran against" -
-- pre-021 rows and a pass whose digest was unavailable - and Decision 47 item 10
-- makes that unmatchable rather than comparable. A preset, by contrast, exists
-- ONLY to be served, and the endpoint selects rows by the CURRENT catalog
-- version: a NULL version could never be selected, so permitting it would create
-- rows that are dead on arrival. NOT NULL plus the same format CHECK 021 uses
-- keeps that failure out of the table instead of discovering it at read time.
--
-- WHY query_id IS UNIQUE
-- A pass answers exactly one (use case, budget, currency) triple at one catalog
-- version, so a second preset row pointing at the same pass is a defect, not a
-- variant. UNIQUE makes that unrepresentable and keeps the pointer 1:1.
--
-- WHY ON DELETE CASCADE
-- A preset without its pass serves nothing: the pass IS the answer, and this row
-- only remembers which landing page it belongs to (migration 014's reasoning for
-- build_rejection, which is likewise diagnostic detail belonging to a query).
-- CASCADE therefore removes the dead pointer automatically, and it is what makes
-- the generator's prune and cleanup paths simple: deleting the pass rows takes
-- the preset rows with them.
--
-- Row volume, stated so growth is checkable: 18 budgets x 3 use cases x 1
-- currency = at most 54 rows at one catalog version. A regeneration for a NEW
-- catalog version prunes the superseded rows of each (use_case, currency, budget)
-- family, so a family holds ONE catalog version at a time and the table does not
-- grow with every price update. The policy is Decision 48's; the endpoint serves
-- only rows matching the current catalog version.
--
-- Fresh-replay safety: pure CREATE TABLE IF NOT EXISTS plus its constraints,
-- additive, no DROP, no ALTER of an existing table, so it is safe on the live
-- database and on a fresh 001->022 replay.
--
-- Applied TEST-first (the API and the generator both run against the branch).
-- Until the same apply lands on the SHARED target from a recorded restore point,
-- `node scripts/verify-migrations-replay.js` reports this table as fresh-only
-- drift against the shared reference BY DESIGN, and `npm run gen:schema` (which
-- reads DATABASE_URL) will not list it - see docs/RECIPES/add-a-migration.md,
-- "A TEST-first migration reports drift against the SHARED reference". Clear it
-- by landing the shared apply, never by weakening the gate.
--
-- Line endings: CRLF (repo convention).
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS recommendation_preset (
    -- The four-part identity, in read-path order (see the header).
    use_case TEXT NOT NULL,
    currency TEXT NOT NULL,
    catalog_version TEXT NOT NULL,
    budget_amount NUMERIC NOT NULL,

    -- The pass that produced this landing page. UNIQUE: 1:1 with a preset.
    query_id UUID NOT NULL
        REFERENCES recommendation_query(id) ON DELETE CASCADE,

    -- When this preset was generated (the row's creation time, mirroring the
    -- created_at/generated_at convention of the other Layer 4 tables).
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_recommendation_preset
        PRIMARY KEY (use_case, currency, catalog_version, budget_amount),

    CONSTRAINT uq_recommendation_preset_query UNIQUE (query_id),

    -- Mirrors recommendation_query's own budget rule, which is NOT NULL and
    -- strictly positive there.
    CONSTRAINT chk_recommendation_preset_budget_positive CHECK (budget_amount > 0),

    -- The digest format migration 021 pins, so a hand-inserted value cannot put
    -- an unservable version into the table.
    CONSTRAINT chk_recommendation_preset_catalog_version_format
        CHECK (catalog_version ~ '^[0-9a-f]{32}$'),

    -- The currency is a three-letter code (the API's vocabulary is the owner of
    -- which codes are accepted; this only keeps the shape honest, as
    -- recommendation_query does not).
    CONSTRAINT chk_recommendation_preset_currency_shape
        CHECK (currency ~ '^[A-Z]{3}$'),

    -- A use case is never blank: '' would be indistinguishable from "not
    -- recorded" and could never match a vocabulary value.
    CONSTRAINT chk_recommendation_preset_use_case_not_blank
        CHECK (btrim(use_case) <> '')
);

COMMIT;
