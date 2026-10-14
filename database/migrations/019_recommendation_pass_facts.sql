-- ===========================================================================
-- Decision 46: recommendation pass facts - budget_floor, engine_version,
-- strategy_key (migration 019)
--
-- Gap: OG-45 ("E4 strategy_key is returned but never persisted"). Its re-check
-- trigger is THIS migration landing. The engine-side writer
-- (src/recommendation/persistence/persist-pass-facts.js) and the commit/full-run
-- seam shipped in Decision 46 Sprints 1-2 and have nowhere to write until the
-- three columns below exist. Neither table had a column for any of the facts:
--   recommendation_query   9 columns - no budget_floor
--   recommendation_result  6 columns - no engine_version, no strategy_key
--
-- What the three facts are, and why they were being thrown away:
--   * budget_floor - the Decision 27 diagnostic (cheapest_total, currency,
--     budget_amount, within_budget, cheapest_by_role, missing_roles). It is the
--     whole of Decision 27's "the emptiness is compatibility, not budget" story,
--     and it lived ONLY in the HTTP reply, so a later GET of the same query
--     could not reproduce it.
--   * strategy_key - which E4 archetype (PERFORMANCE / BALANCED / VALUE,
--     Decision 41) nominated a ranked row.
--   * engine_version - which engine build produced the row.
--
-- Why JSONB for budget_floor and not six columns: the diagnostic is ONE nested
-- value that no engine rule reads (Decision 27: "budget_floor is a data field
-- only, deliberately not wired into Engine 6 explanation text"). It is a
-- diagnostic payload, not a queryable substrate, and a schema-per-field would
-- need a migration again every time the diagnostic gains a facet. The shape
-- precedent for a structured payload is scoring_model.configuration.
--
-- Why TEXT for engine_version and strategy_key and not an enum: use_case is TEXT
-- (migration 011) and the E4 strategy vocabulary is expected to grow, so a new
-- archetype must not require a migration. AGENTS.md section 8 forbids
-- destructively altering an enum, and this repo has never dropped one.
--
-- Why all three are NULLABLE with NO default and NO backfill: pre-019 rows are
-- genuinely unknowable - nothing recorded them - and NULL means UNKNOWN in this
-- schema (AGENTS.md section 8). A DEFAULT would fabricate history, and the
-- writer treats an absent fact as SQL NULL rather than inventing one
-- (Decision 46 items 4 and 8).
--
-- Safety, MEASURED before authoring (2026-10-14, both databases): all four
-- Layer 4 write tables are EMPTY - recommendation_query 0, recommendation_result
-- 0, build_candidate 0, build_component 0 - so these ALTERs rewrite no row, and
-- adding a nullable column with no default is a catalogue-only change that takes
-- no table rewrite on PostgreSQL 11+.
--
-- No new index. persistPassFacts addresses result rows by
-- (recommendation_query_id, rank), which migration 011 already covers with the
-- UNIQUE index uq_recommendation_result_query_rank - confirmed present on both
-- databases - so the writer's `AND rank = $4` match hits at most one row with no
-- sequential scan. The query side is addressed by its PRIMARY KEY.
--
-- No GRANT here, deliberately. The documented production role (docs/API.md,
-- section "Production mode") has no UPDATE privilege at all, and Decision 46
-- item 7 resolves that with COLUMN-scoped grants
--   UPDATE (budget_floor)                 ON recommendation_query
--   UPDATE (engine_version, strategy_key) ON recommendation_result
-- applied to the role as an operator step. Privileges are not schema, this
-- repo's migrations are schema-only, and a GRANT here would also be skipped by
-- the replay harness, which builds an empty database with no role to grant to.
--
-- Re-runnability: every statement is guarded by ADD COLUMN IF NOT EXISTS and
-- there is no ADD CONSTRAINT, so unlike 018 this file has no 42710 exposure - a
-- hand re-application is a genuine no-op. Single application is in any case
-- guaranteed by the OG-14 ledger.
--
-- Line endings: CRLF (repo convention).
-- ===========================================================================

ALTER TABLE recommendation_query
    ADD COLUMN IF NOT EXISTS budget_floor JSONB;

ALTER TABLE recommendation_result
    ADD COLUMN IF NOT EXISTS engine_version TEXT;

ALTER TABLE recommendation_result
    ADD COLUMN IF NOT EXISTS strategy_key TEXT;
