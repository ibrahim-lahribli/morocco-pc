-- ===========================================================================
-- Decision 47: recommendation_query.catalog_version (migration 021)
--
-- What this column is. The version of the CATALOG STATE a pass ran against: a
-- 32-character lowercase hex content digest, computed by
-- src/recommendation/query/catalog-version.js `catalogVersion(db)` and written
-- once, at INSERT, by the API when it creates the query row. It is not a
-- timestamp, not a serial and not a per-instance counter (Decision 47 item 1).
--
-- Why it must be persisted at all. Platform P1 Sprint 5 dedupes a repeated POST
-- by keying it on (budget, currency, use_case, resolution, priority, model id,
-- catalog version, engine version) and returning the existing recommendation id
-- instead of running a second pass. Six of those eight components are already
-- columns on recommendation_query or on recommendation_result; the catalog
-- version had nowhere to live:
--   recommendation_query  10 columns - no catalog_version
-- Without it, a dedupe can only compare a request's CURRENT catalog state
-- against nothing, so a pass run before a seed or a price change would be served
-- again after it - precisely the failure mode PLAN_PLATFORM_P1.md section 7
-- names first ("a cache without it returns stale builds after a seed or a price
-- update").
--
-- Why the pass must RECORD the version it ran under, and not merely compute one
-- on demand (Decision 47 item 10). Recomputing the CURRENT version at read time
-- cannot tell whether a STORED pass is still current - the comparison only means
-- something if the stored row says which state produced it. Decision 46 set the
-- precedent: a pass persists facts about itself. This is one more of them.
--
-- Why TEXT and not an enum, a UUID or a numeric: the value is an md5 digest, so
-- its natural type is fixed-width text. An enum would need a migration per new
-- value (it has unboundedly many), and AGENTS.md section 8 forbids destructively
-- altering an enum anyway. The format is pinned by the CHECK below rather than
-- by the type, which is the same choice migration 020 made for product.slug.
--
-- Why NULLABLE, with NO default and NO backfill: pre-021 rows genuinely do not
-- record it - nothing computed one - and NULL means UNKNOWN in this schema
-- (AGENTS.md section 8). A DEFAULT would fabricate history: every existing row
-- would claim to have run against a catalog state it cannot be compared to.
-- The CHECK is written `catalog_version IS NULL OR ...` for exactly that reason:
-- an unrecorded version must be storable, and must never match a request
-- (Decision 47 item 10: an unknown version is a MISS, never a match).
--
-- Safety, MEASURED before authoring (2026-10-16, shared database): the Layer 4
-- write tables are EMPTY - recommendation_query 0, recommendation_result 0,
-- build_candidate 0, build_component 0, build_rejection 0 - so this ALTER
-- rewrites no row. Adding a nullable column with no default is a catalogue-only
-- change on PostgreSQL 11+ and takes no table rewrite regardless.
--
-- No new index, deliberately. The dedupe lookup filters on seven columns and
-- takes LIMIT 1, and PostgreSQL will sequentially scan recommendation_query to
-- answer it. That is correct TODAY because the table holds zero rows and grows
-- only with DISTINCT requests (dedupe is what removes the repeated-POST growth
-- the sprint exists for). An index chosen before there is a query plan to look
-- at would be a guess about predicate selectivity; the trigger to add one is a
-- measured slow lookup on a table with enough rows to have a plan, which is the
-- same standard Decision 47 item 8 sets for replacing the digest itself.
--
-- No GRANT here, deliberately - privileges are not schema, and this repo's
-- migrations are schema-only. The documented production role (docs/API.md,
-- section "Production mode") is expected to write this table; if its INSERT is
-- ever narrowed to a COLUMN list, catalog_version must be added to that list.
-- Decision 46 item 7 already records the column-scoped UPDATE grants that role
-- needs, and the replay harness builds an empty database with no role to grant
-- to, so a GRANT here would be skipped by the very check that proves this file
-- replays.
--
-- Applied TEST-first (the API only ever runs against the branch). Until the same
-- apply lands on the SHARED target from a recorded restore point,
-- `node scripts/verify-migrations-replay.js` reports drift against the shared
-- reference by design - see docs/RECIPES/add-a-migration.md, "A TEST-first
-- migration reports drift against the SHARED reference". Clear it by landing the
-- shared apply, never by weakening the gate.
-- ===========================================================================

BEGIN;

ALTER TABLE recommendation_query
    ADD COLUMN IF NOT EXISTS catalog_version TEXT;

ALTER TABLE recommendation_query
    ADD CONSTRAINT chk_recommendation_query_catalog_version_format
    CHECK (catalog_version IS NULL OR catalog_version ~ '^[0-9a-f]{32}$');

COMMIT;
