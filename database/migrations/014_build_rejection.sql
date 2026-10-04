-- ===========================================================================
-- Persist rejection reasons per recommendation query (migration 014)
--
-- Gap: OG-04 (docs/OPEN_GAPS.md), open since the architecture audit and named
-- in ARCH section 16 as IMPORTANT: "No rejection-reason persistence (rejected
-- combos invisible) - limits debugging of 'why was nothing recommended?'".
--
-- The defect, in the engine's own words (ARCH section 10): a build whose status
-- would be FAIL "is NOT persisted as a surviving candidate; rejected
-- combinations are logged only in engine diagnostics (no rejection-reason table
-- exists - gap, section 16)".
--
-- What that leaves broken today. Decision 27 gave a pass the ability to
-- explain its own budget floor, so a zero-build outcome can say "the emptiness
-- is compatibility, not budget". It cannot say WHICH pair was incompatible.
-- budget_floor is deliberately not an explanation of pairwise failure - it is
-- the sum of per-role cheapest prices, a lower bound that ignores partners
-- entirely. So the remaining half of the debugging story - "why was nothing
-- recommended?" - is still unanswerable for a specific past run, and the
-- candidate-level REJECT verdicts produced by Engine 2D are discarded the
-- moment the pass ends.
--
-- DESIGN - what is stored, and why exactly this:
--
--   * One row per REJECTED CANDIDATE, not per rejected combination. Engine 2D
--     rejects at the candidate level (filter.js sets status REJECT and carries
--     the decisive reason), so a candidate-level row is the unit the engine
--     actually produces; inventing a pairwise row would require re-deriving
--     pairs the filter never materialized. Pairwise blocking during assembly is
--     a separate concern (see OUT OF SCOPE).
--   * reason_code is TEXT, not a new enum. REASON_CODES currently has 23
--     members and is not persisted anywhere; adding an enum type would mean a
--     migration every time a resolver gains a reason, and would silently reject
--     an unknown-but-real code. TEXT keeps the writer honest about "whatever the
--     resolver said" and lets a CHECK-free column accept a newly added reason
--     without a schema change. It is still NOT NULL, so a rejection with no
--     reason is impossible.
--   * component_role reuses the EXISTING component_role enum rather than a
--     second vocabulary (AGENTS.md section 8: keep enums in sync, never
--     duplicate a vocabulary).
--   * Both FKs are ON DELETE CASCADE: rejection rows are diagnostic detail
--     belonging to a query. If the query is deleted its diagnostics must go
--     with it, rather than being orphaned or blocking the delete.
--   * A partial-friendly shape: one row per (query, role, product, variant,
--     reason). There is deliberately NO uniqueness constraint - the same reason
--     can legitimately be recorded on repeated runs of the same query id, and a
--     re-run guard already refuses to persist a second time.
--
-- Row-volume discipline: the writer inserts only REJECT verdicts, so a healthy
-- query writes ZERO rows here. This table is expected to stay empty in normal
-- operation - that emptiness is the signal that nothing was rejected.
--
-- OUT OF SCOPE, deliberately (recorded so the gap is not over-claimed):
--   * Pairwise rejections detected during assembly (assemble.js abandons a
--     branch when an aggregated pair FAILs). Those are combinations, not
--     candidates, and they are NOT captured here.
--   * UNKNOWN rows. An UNKNOWN is a survival, not a rejection; persisting them
--     here would conflate the two and would bury the REJECTs that matter.
--   * Any change to Engine 2D verdict logic, retention, scoring or ranking.
--
-- Fresh-replay safety: pure CREATE TABLE IF NOT EXISTS, additive, no DROP, no
-- ALTER of an existing table. Safe to run on the live database and on a fresh
-- 001->014 replay.
--
-- Line endings: CRLF (repo convention).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS build_rejection (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The run that produced the verdict. CASCADE: a query's diagnostics are
    -- meaningless without it.
    recommendation_query_id UUID NOT NULL
        REFERENCES recommendation_query(id) ON DELETE CASCADE,

    -- Which candidate was rejected, and against whom. The partner is NULL when
    -- the rejection did not depend on a partner (e.g. a product with no spec
    -- row at all), which is why partner_product_id is nullable but the
    -- rejecting candidate's own ids are not.
    component_role component_role NOT NULL,
    product_id UUID NOT NULL REFERENCES product(id) ON DELETE CASCADE,
    product_variant_id UUID REFERENCES product_variant(id) ON DELETE CASCADE,
    partner_product_id UUID REFERENCES product(id) ON DELETE CASCADE,
    partner_product_variant_id UUID REFERENCES product_variant(id) ON DELETE CASCADE,

    -- REASON_CODES member that decided the REJECT. NOT NULL by construction: a
    -- rejection always carries a reason (filter.js takes the decisive result's
    -- reason), and the writer refuses a REJECT row without one rather than
    -- storing an empty string.
    reason_code TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A partner is either wholly absent or wholly present: a variant-keyed
    -- partner (GPU) always carries both ids, a product-keyed one carries
    -- neither. This forbids the half-populated state that would make a stored
    -- reason untraceable.
    CONSTRAINT chk_build_rejection_partner_pair_complete
        CHECK (
            (partner_product_id IS NULL AND partner_product_variant_id IS NULL)
            OR
            (partner_product_id IS NOT NULL AND partner_product_variant_id IS NOT NULL)
        ),

    -- A reason code is never blank; '' would be indistinguishable from "not
    -- recorded" in a diagnostic query.
    CONSTRAINT chk_build_rejection_reason_not_blank
        CHECK (btrim(reason_code) <> '')
);

-- Query-scoped lookup: "show me every rejection for run X" is the access path
-- this table exists to serve.
CREATE INDEX IF NOT EXISTS idx_build_rejection_query
    ON build_rejection(recommendation_query_id);

-- Role+reason grouping for "which rules are rejecting the most candidates?"
-- across the catalog, without scanning every row.
CREATE INDEX IF NOT EXISTS idx_build_rejection_role_reason
    ON build_rejection(component_role, reason_code);
