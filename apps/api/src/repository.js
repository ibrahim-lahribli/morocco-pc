'use strict';

/**
 * apps/api/src/repository.js - every SQL statement the API issues.
 *
 * Boundary: SQL only. It contains no HTTP concepts (no status code, no error
 * mapping, no response shape), no engine import, and no business rule beyond
 * what each statement must do to be correct. Routes receive row-shaped data and
 * present it; the engine receives a query id and does the rest.
 *
 * The read-after-write design is deliberate (Decision 36 item 4): POST does NOT
 * build its response from the engine's in-memory result. It re-reads the
 * PERSISTED rows through the very same statement GET uses, so POST and GET are
 * identical on every persisted field by construction rather than by discipline
 * - and the API cannot accidentally expose a value that was never stored.
 *
 * That property is now TOTAL. Until migration 019 there was exactly one
 * exception: `budget_floor`, a pass diagnostic with no column to read back, so
 * POST served the engine's in-memory copy and GET served null. 019 added the
 * column (`recommendation_query.budget_floor`) plus the two per-result
 * provenance fields (`engine_version`, `strategy_key`), and the two statements
 * below read all three back - so the engine's in-memory result no longer feeds
 * the response at all, and a zero-build pass still carries its floor because
 * `persistPassFacts` writes it unconditionally.
 *
 * Reads are parameterized only; nothing is interpolated. NUMERIC columns come
 * back from pg as strings and are converted by the presenter, not here, so the
 * row shape stays honest about what the database actually returned.
 *
 * REQUEST DEDUPE (Platform P1 Sprint 5, Decision 47). Since migration 021 the
 * query row also records the CATALOG VERSION its pass ran against, and
 * `findReusableQuery` is the read that makes a repeated POST cheap: the route
 * asks for an existing pass with the SAME request identity and the SAME catalog
 * and engine version BEFORE it creates anything. The key is deliberately the
 * eight components PLAN_PLATFORM_P1.md Sprint 5 names - budget, currency, use
 * case, resolution, priority, model, catalog version, engine version - and not
 * the profile's UUID name, which is per-request by construction and identifies
 * nothing.
 */

const { randomUUID } = require('node:crypto');
const { withTransaction } = require('./db');

/**
 * The active scoring model.
 *
 * `is_active` IS the eligibility predicate here - unlike the engine's Decision
 * 11 loader, which resolves a PINNED id and treats ineligibility as an error,
 * the API has no pinned id yet and must choose one. The tie-break is explicit
 * (newest `created_at`, then `id`) so two active models never make the choice
 * depend on physical row order. No row means the caller answers 503; the API
 * never invents a model.
 */
const SELECT_ACTIVE_SCORING_MODEL_SQL = [
  'SELECT id, configuration',
  'FROM scoring_model',
  'WHERE is_active = true',
  'ORDER BY created_at DESC, id ASC',
  'LIMIT 1',
].join(' ');

/**
 * One profile per API request. `name` is the generated uuid: the unique index
 * `idx_recommendation_profile_name` (migration 011 5.3) makes a human name a
 * collision risk, and the name is not part of the API contract.
 */
const INSERT_PROFILE_SQL = [
  'INSERT INTO recommendation_profile (id, name, description, use_case, priority, default_resolution)',
  'VALUES ($1, $2, $3, $4, $5, $6)',
  'RETURNING id',
].join(' ');

/**
 * The query row the engine pins. `scoring_model_id` is resolved here, ONCE, and
 * stored - which is what makes the pass reproducible after the model list
 * changes: the row records which model produced it.
 */
const INSERT_QUERY_SQL = [
  'INSERT INTO recommendation_query',
  '  (id, recommendation_profile_id, scoring_model_id, budget_amount, currency, use_case, priority, resolution,',
  '   catalog_version)',
  'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
  'RETURNING id',
].join(' ');

/**
 * The query resource itself: presence decides 404, created_at backs
 * generated_at.
 *
 * `budget_floor` is the Decision 27 diagnostic, persisted by Decision 46's
 * `persistPassFacts` (migration 019). pg parses a jsonb column into a JS value
 * already, so this row field is an OBJECT here, not a string - the presenter's
 * `parseFloor` handles the string case only for safety.
 *
 * Decision 52 added three fields that the presenter needs to answer what each
 * input CHANGED, and one of them is a second table:
 *
 *   - `q.resolution` and `q.priority` are the request's own values, stored since
 *     the Layer 4 schema existed but never selected here until now. They were
 *     not omitted by accident: nothing in the response depended on them, and a
 *     column nobody reads is not a field the API should expose. `input_effects`
 *     depends on them.
 *   - `sm.configuration` is the configuration of the model this pass PINNED
 *     (`q.scoring_model_id`, written once at INSERT - see INSERT_QUERY_SQL). The
 *     join is LEFT and the configuration is nullable on purpose: a deleted model
 *     row is UNKNOWN, and inventing the CURRENTLY active model's configuration
 *     for an older pass would be exactly the kind of retro-fitted claim this
 *     contract exists to prevent.
 *
 * No ORDER or LIMIT is added: the id is the primary key.
 */
const SELECT_QUERY_SQL = [
  'SELECT q.id, q.budget_amount, q.currency, q.use_case, q.resolution, q.priority,',
  '       q.created_at, q.budget_floor, q.catalog_version, q.scoring_model_id,',
  '       sm.configuration',
  'FROM recommendation_query q',
  'LEFT JOIN scoring_model sm ON sm.id = q.scoring_model_id',
  'WHERE q.id = $1',
].join(' ');

/**
 * An existing pass that answers this request EXACTLY, or nothing.
 *
 * Seven components are columns on `recommendation_query`, one on
 * `recommendation_result`. Every comparison is a value comparison, never a
 * LIKE or a range: a dedupe key that matched APPROXIMATELY would serve an
 * answer computed for a different request.
 *
 * `IS NOT DISTINCT FROM` for `resolution` and `priority`, and plain `=` for
 * `catalog_version` - a deliberate asymmetry, not an oversight. Omitting a
 * resolution is a property of the REQUEST, so two requests that both omit it
 * are the same request, and `= NULL` would make the row unmatchable (including
 * the row this very request would have written). An UNRECORDED catalog version
 * means something else entirely: the state is UNKNOWN, and Decision 47 item 10
 * says an unknown version is a MISS, never a match. Two rows that both failed to
 * record a version are not known to have run against the same catalog, so
 * matching them would risk exactly the stale answer the column exists to
 * prevent. `q.catalog_version IS NOT NULL AND q.catalog_version = $7` states both
 * halves: the row must have recorded a version, and a request with no version
 * (`= NULL` is NULL, never true) matches nothing.
 *
 * The engine version is not a column on this table; it is recorded per RESULT
 * row (Decision 46), so it is expressed as "no row disagrees": a pass whose
 * result rows all name the answering deploy matches, and a pass from any other
 * deploy does not. A committed pass that assembled NOTHING has no result row to
 * consult - see the `budget_floor IS NOT NULL` condition below and the note on
 * that residual case.
 *
 * `q.budget_floor IS NOT NULL` is the COMMITTED-PASS condition, and it is
 * load-bearing. Decision 46's `persistPassFacts` writes the floor
 * unconditionally on commit (Decision 27 computes it unconditionally), so a
 * non-null floor means the pass reached its write transaction. A row with a
 * NULL floor is therefore a FAILED pass - the API inserts the query row before
 * running the engine, so a pass that threw before the commit stage leaves one
 * behind. Serving such a row is wrong in a way a shape check would not catch:
 * its `reason` is not persisted, so the reply would have to FABRICATE one, and
 * a repeat request would keep being answered from a failure that a later fix
 * cannot clear. A failed pass is not an answer, so it is not reused; the
 * trigger to revisit is EMPTY_CANDIDATE_POOL becoming common, at which point the
 * honest fix is to persist the reason as a pass fact the way Decision 46
 * persists the others, and then a reuse can be exact.
 *
 * Neither the ordering nor the LIMIT is arbitrary: any match is an equivalent
 * answer, so the newest one is served (its rows are the freshest), with a
 * deterministic tie-break on id so two passes created in the same transaction
 * cannot make the choice depend on physical row order.
 */
const SELECT_REUSABLE_QUERY_SQL = [
  'SELECT q.id',
  'FROM recommendation_query q',
  'WHERE q.scoring_model_id = $1',
  '  AND q.budget_amount = $2',
  '  AND q.currency = $3',
  '  AND q.use_case = $4',
  '  AND q.resolution IS NOT DISTINCT FROM $5',
  '  AND q.priority IS NOT DISTINCT FROM $6',
  '  AND q.catalog_version IS NOT NULL',
  '  AND q.catalog_version = $7',
  '  AND q.budget_floor IS NOT NULL',
  '  AND NOT EXISTS (',
  '    SELECT 1 FROM recommendation_result r',
  '    WHERE r.recommendation_query_id = q.id',
  '      AND r.engine_version IS DISTINCT FROM $8',
  '  )',
  'ORDER BY q.created_at DESC, q.id ASC',
  'LIMIT 1',
].join(' ');

/**
 * Every persisted build of one query, flattened one row per component.
 *
 * ORDER BY is total and deterministic (rank, then the canonical enum order of
 * component_role, then the component id), so two reads of the same committed
 * data serialize to byte-identical JSON. The component joins are LEFT joins
 * because a build_candidate row is the unit of existence: a candidate with no
 * components still belongs to the response, and the presenter drops the null
 * component rows. `product_id`/`product_variant_id` are carried so the response
 * can name the component (the engine's in-memory build carries no product name;
 * product_variant has no name column at all - only `sku`).
 *
 * The name itself comes from `COALESCE(p.display_name, p.name)` since migration
 * 020 (product identity), and `p.slug` is carried alongside it. The COALESCE is
 * the reason the `Seed ` prefix stops reaching clients: 020 backfills
 * `display_name` for every existing product, and the fallback to `name` keeps
 * the statement total for a row inserted after that backfill, where nullable is
 * the honest state (see migration 020's header). `slug` is read, not derived:
 * 020 stores a globally unique, deterministic slug, so the API never invents
 * one and never has to reproduce the generator.
 *
 * `r.engine_version` / `r.strategy_key` are the Decision 46 provenance facts:
 * which deploy produced this rank, and which E4 archetype nominated it. Both
 * are TEXT and nullable, so a pre-019 row (or a pass that ran without an
 * engine version) reads back null rather than an invented value - NULL means
 * UNKNOWN in this schema, and the presenter passes it through.
 */
const SELECT_BUILDS_SQL = [
  'SELECT',
  '  r.rank,',
  '  r.explanation,',
  '  r.engine_version,',
  '  r.strategy_key,',
  '  r.created_at AS result_created_at,',
  '  b.id AS build_candidate_id,',
  '  b.total_price,',
  '  b.score AS build_score,',
  '  b.compatibility_status,',
  '  c.id AS component_id,',
  '  c.component_role AS role,',
  '  c.product_id,',
  '  c.product_variant_id,',
  '  c.selected_price,',
  '  c.offer_class,',
  '  c.store_offer_id,',
  '  p.slug AS product_slug,',
  '  COALESCE(p.display_name, p.name) AS product_name,',
  '  v.sku AS variant_sku',
  'FROM recommendation_result r',
  'JOIN build_candidate b ON b.id = r.build_candidate_id',
  'LEFT JOIN build_component c ON c.build_candidate_id = b.id',
  'LEFT JOIN product p ON p.id = c.product_id',
  'LEFT JOIN product_variant v ON v.id = c.product_variant_id',
  'WHERE r.recommendation_query_id = $1',
  'ORDER BY r.rank ASC, c.component_role ASC, c.id ASC',
].join(' ');

/**
 * The preset ribbon of ONE (use case, currency, catalog version), cheapest
 * budget first (Decision 48 / migration 022) - the rows GET /v1/presets serves.
 *
 * The three counts are computed here, not by the presenter: they are facts of
 * the PERSISTED rows, and only the statement can see them. They are what the
 * route's derived `price_status` stands on:
 *
 *   - `build_count` - the builds the pass committed. 0 for a pass that
 *     assembled nothing, which is a legitimate outcome (Decision 17.2), and
 *     then there is no price to make a claim about.
 *   - `rank1_component_count` - the components of the SHOWN build (rank 1).
 *   - `rank1_unverified_count` - those whose `offer_class` is not exactly
 *     'VERIFIED'. `IS DISTINCT FROM` is deliberate: a NULL offer_class is
 *     UNKNOWN provenance, and unknown is never advertised as verified
 *     (Decision 36 item 4). Two counts rather than one `NOT EXISTS (... <> ...)`
 *     because an empty component set contradicts nothing and would read as
 *     verified.
 *
 * `build_score` is the rank-1 build's score - NUMERIC, so a string at this
 * boundary - and NULL when nothing was assembled, never 0 (a score nobody
 * computed). The rank-1 pick is total and deterministic (`ORDER BY b.id ASC`),
 * so two reads of the same committed rows are byte-identical.
 *
 * `p.catalog_version = $3` is plain `=`, never `IS NOT DISTINCT FROM` - the
 * same asymmetry SELECT_REUSABLE_QUERY_SQL documents: the endpoint selects BY
 * the version it computed, and an unknown version selects nothing (Decision 47
 * item 10 - a miss, never a match).
 */
const SELECT_PRESETS_SQL = [
  'SELECT',
  '  p.budget_amount,',
  '  p.query_id AS recommendation_id,',
  '  p.generated_at,',
  '  (SELECT b.score',
  '   FROM recommendation_result r',
  '   JOIN build_candidate b ON b.id = r.build_candidate_id',
  '   WHERE r.recommendation_query_id = p.query_id AND r.rank = 1',
  '   ORDER BY b.id ASC',
  '   LIMIT 1) AS build_score,',
  '  (SELECT count(*)::int',
  '   FROM recommendation_result r',
  '   WHERE r.recommendation_query_id = p.query_id) AS build_count,',
  '  (SELECT count(*)::int',
  '   FROM recommendation_result r',
  '   JOIN build_component c ON c.build_candidate_id = r.build_candidate_id',
  '   WHERE r.recommendation_query_id = p.query_id AND r.rank = 1) AS rank1_component_count,',
  '  (SELECT count(*)::int',
  '   FROM recommendation_result r',
  '   JOIN build_component c ON c.build_candidate_id = r.build_candidate_id',
  '   WHERE r.recommendation_query_id = p.query_id AND r.rank = 1',
  "     AND c.offer_class IS DISTINCT FROM 'VERIFIED') AS rank1_unverified_count",
  'FROM recommendation_preset p',
  'WHERE p.use_case = $1',
  '  AND p.currency = $2',
  '  AND p.catalog_version = $3',
  'ORDER BY p.budget_amount ASC',
].join(' ');

/** The exact key's pass, or nothing - the generator's SKIP (idempotency layer 1). */
const FIND_PRESET_QUERY_ID_SQL = [
  'SELECT query_id',
  'FROM recommendation_preset',
  'WHERE use_case = $1',
  '  AND currency = $2',
  '  AND catalog_version = $3',
  '  AND budget_amount = $4',
].join(' ');

/**
 * Record the pointer, replacing an existing one (Decision 31's replace-idempotent
 * convention): the four-part key is the PRIMARY KEY, so a duplicate row is
 * unrepresentable and a re-run converges on ONE row whose pointer MOVES to the
 * new pass instead of raising 23505. `generated_at` is the row's creation time
 * (migration 022's column comment) and is deliberately not touched.
 */
const UPSERT_PRESET_SQL = [
  'INSERT INTO recommendation_preset (use_case, currency, catalog_version, budget_amount, query_id)',
  'VALUES ($1, $2, $3, $4, $5)',
  'ON CONFLICT (use_case, currency, catalog_version, budget_amount)',
  'DO UPDATE SET query_id = EXCLUDED.query_id',
  'RETURNING query_id',
].join(' ');

/**
 * Remove the preset rows of a scope and return the passes they pointed at, so
 * the caller can delete those too (the preset rows would cascade from the
 * query, but the caller owns the pass cleanup and reports it). Every scope
 * field is OPTIONAL: a null parameter widens the scope instead of filtering,
 * which is what lets `generate-presets.js --cleanup` mean "every preset" or
 * "one catalog version" with one statement.
 */
const DELETE_PRESETS_SQL = [
  'DELETE FROM recommendation_preset',
  'WHERE ($1::text IS NULL OR use_case = $1)',
  '  AND ($2::text IS NULL OR currency = $2)',
  '  AND ($3::text IS NULL OR catalog_version = $3)',
  'RETURNING query_id',
].join(' ');

/**
 * Prune a family (use case, currency, budget) down to ONE catalog version
 * (Decision 48's retention policy): the rows of every other version go, and the
 * passes they pointed at are returned so the caller can remove those as well.
 * Plain `<>` because `catalog_version` is NOT NULL here (migration 022) - a
 * preset with no version is unrepresentable.
 */
const DELETE_SUPERSEDED_PRESETS_SQL = [
  'DELETE FROM recommendation_preset',
  'WHERE use_case = $1',
  '  AND currency = $2',
  '  AND budget_amount = $3',
  '  AND catalog_version <> $4',
  'RETURNING query_id',
].join(' ');

/* -------------------------------------------------------------------------
 * CATALOG READ SURFACE (Platform P2 Sprint 3)
 *
 * Two public, read-only reads: a keyset page of ACTIVE products and one
 * product by `slug`. They exist for the storefront, and four rules shape them.
 *
 * 1. CATEGORY IS DERIVED, NEVER STORED. `product` has no category column
 *    (AGENTS section 5; the engine derives it the same way in
 *    candidates/loader.js). The CASE below tests canonical spec-table presence
 *    in the `product_category` enum's declaration order, and GPU is the one
 *    VARIANT-keyed category - a GPU product is reached through
 *    `product_variant` -> `gpu_board_spec`. A product with no spec row is not a
 *    catalog product at all and is EXCLUDED rather than served with a null
 *    category; that is the same set the engine can select from.
 *
 * 2. PAGINATION IS KEYSET ON `slug`, never OFFSET. `slug` is the only
 *    candidate key with a uniqueness guarantee (migration 020's
 *    `uq_product_slug`); `product.name` has none, which is exactly how an
 *    OFFSET page can repeat or skip a row while looking correct. The page
 *    query asks for `limit + 1` rows so the caller can answer `next_cursor`
 *    without a COUNT, and the cursor is compared with `>`, the same total order
 *    the ORDER BY uses.
 *
 * 3. A PRICE ALWAYS TRAVELS WITH ITS PROVENANCE. `offer_class` is derived the
 *    way the engine derives it (Decision 35 / migration 018):
 *    `ingestion_record_id IS NULL` -> SEED_UNVERIFIED, otherwise VERIFIED.
 *    A catalog price without its class would let a beta seed price read as
 *    confirmed, which is the failure mode this sprint exists to prevent.
 *
 * 4. ELIGIBILITY MIRRORS THE ENGINE. Currency exact, `price > 0`,
 *    `availability <> 'OUT_OF_STOCK'`, and the 30-day freshness window that
 *    seed offers are exempt from - the same predicate as
 *    offers/select.js, so the catalog cannot advertise a price the engine
 *    would refuse to build with. The exemption is unconditional here because
 *    the API always runs that way (apps/api/src/engine.js,
 *    API_ENGINE_OPTIONS). A NULL `last_checked_at` is never fresh: NULL is
 *    UNKNOWN, and an unknown age is not a waiver.
 *
 * The catalog reads NO Layer 4 table and writes nothing.
 * ---------------------------------------------------------------------- */

/**
 * The derived-category expression. Every reference is `p.id`; the spec tables
 * are a fixed, literal list (never a value from a request).
 */
const CATALOG_CATEGORY_EXPRESSION = [
  'CASE',
  "  WHEN EXISTS (SELECT 1 FROM cpu_spec s WHERE s.product_id = p.id) THEN 'CPU'",
  "  WHEN EXISTS (SELECT 1 FROM motherboard_spec s WHERE s.product_id = p.id) THEN 'MOTHERBOARD'",
  "  WHEN EXISTS (SELECT 1 FROM ram_spec s WHERE s.product_id = p.id) THEN 'MEMORY'",
  '  WHEN EXISTS (',
  '    SELECT 1 FROM gpu_board_spec s',
  '    JOIN product_variant v ON v.id = s.product_variant_id',
  '    WHERE v.product_id = p.id',
  "  ) THEN 'GPU'",
  "  WHEN EXISTS (SELECT 1 FROM ssd_spec s WHERE s.product_id = p.id) THEN 'STORAGE'",
  "  WHEN EXISTS (SELECT 1 FROM psu_spec s WHERE s.product_id = p.id) THEN 'PSU'",
  "  WHEN EXISTS (SELECT 1 FROM case_spec s WHERE s.product_id = p.id) THEN 'CASE'",
  "  WHEN EXISTS (SELECT 1 FROM cooler_spec s WHERE s.product_id = p.id) THEN 'COOLER'",
  '  ELSE NULL',
  // The alias is part of the fragment: BOTH statements select it as
  // `category`, and an unaliased CASE is named "case" by Postgres - which
  // surfaces as a confusing "column c.category does not exist" from the CTE.
  'END AS category',
].join('\n');

/**
 * The offer-eligibility predicate, shared verbatim by the list and the detail.
 * One joined condition on purpose: both statements inline it after their own
 * `AND`, so a fragment already carrying `AND`s would emit `AND AND`.
 */
const CATALOG_OFFER_ELIGIBILITY_SQL = [
  'o.price > 0',
  "o.availability <> 'OUT_OF_STOCK'",
  "(o.last_checked_at >= CURRENT_TIMESTAMP - INTERVAL '30 days' OR o.ingestion_record_id IS NULL)",
].join(' AND ');

/**
 * One page of ACTIVE catalog products, ordered by slug, cheapest eligible offer
 * alongside it.
 *
 * $1 text    category filter, or NULL for every category
 * $2 text    keyset cursor (the previous page's last slug), or NULL for the first
 * $3 integer page size + 1 - the extra row is how "there is a next page" is
 *            known without counting
 * $4 text    advertised currency (exact match, no conversion)
 *
 * `best_offer` ranks each product's eligible offers by `(price, id)`: the same
 * total order offers/select.js uses, so the catalog's "from" price and the
 * engine's selected price cannot disagree about which offer is cheapest. The
 * LEFT JOIN keeps a product with NO eligible offer in the page - silent
 * omission would make the catalog look complete when it is not - and the
 * caller reports `has_offer: false`.
 */
const SELECT_CATALOG_PRODUCTS_SQL = [
  'WITH categorized AS (',
  '  SELECT p.id, p.slug, COALESCE(p.display_name, p.name) AS display_name,',
  CATALOG_CATEGORY_EXPRESSION.split('\n').map((line) => '  ' + line).join('\n'),
  '  FROM product p',
  "  WHERE p.lifecycle_status = 'ACTIVE' AND p.slug IS NOT NULL",
  '),',
  'listed AS (',
  '  SELECT c.id, c.slug, c.display_name, c.category',
  '  FROM categorized c',
  '  WHERE c.category IS NOT NULL',
  '    AND ($1::text IS NULL OR c.category = $1)',
  '    AND ($2::text IS NULL OR c.slug > $2)',
  '  ORDER BY c.slug ASC',
  '  LIMIT $3',
  '),',
  'best_offer AS (',
  '  SELECT o.product_id, o.price, o.ingestion_record_id,',
  '         ROW_NUMBER() OVER (PARTITION BY o.product_id ORDER BY o.price ASC, o.id ASC) AS rn',
  '  FROM store_offer o',
  '  WHERE o.currency = $4',
  '    AND ' + CATALOG_OFFER_ELIGIBILITY_SQL,
  ')',
  'SELECT l.slug, l.display_name, l.category,',
  '       b.price AS from_price,',
  '       CASE WHEN b.product_id IS NULL THEN NULL',
  "            WHEN b.ingestion_record_id IS NULL THEN 'SEED_UNVERIFIED'",
  "            ELSE 'VERIFIED' END AS offer_class",
  'FROM listed l',
  'LEFT JOIN best_offer b ON b.product_id = l.id AND b.rn = 1',
  'ORDER BY l.slug ASC',
].join('\n');

/**
 * One ACTIVE catalog product's identity, by slug. `category IS NOT NULL` is the
 * same eligibility the list applies, so a slug the list can never serve is a
 * 404 here too rather than a product page with an unknown category.
 *
 * $1 text  slug
 */
const SELECT_CATALOG_PRODUCT_SQL = [
  'WITH categorized AS (',
  '  SELECT p.id, p.slug, COALESCE(p.display_name, p.name) AS display_name,',
  CATALOG_CATEGORY_EXPRESSION.split('\n').map((line) => '  ' + line).join('\n'),
  '  FROM product p',
  "  WHERE p.lifecycle_status = 'ACTIVE' AND p.slug = $1",
  ')',
  'SELECT id, slug, display_name, category',
  'FROM categorized',
  'WHERE category IS NOT NULL',
].join('\n');

/**
 * Every ELIGIBLE offer of one product, cheapest first - the detail page's
 * price list. Same eligibility as the list, same total order, so the first row
 * IS the list's `from_price`.
 *
 * $1 uuid  product id
 * $2 text  currency
 */
const SELECT_CATALOG_OFFERS_SQL = [
  'SELECT o.id, o.product_variant_id, o.price, o.currency, o.ingestion_record_id',
  'FROM store_offer o',
  'WHERE o.product_id = $1',
  '  AND o.currency = $2',
  '  AND ' + CATALOG_OFFER_ELIGIBILITY_SQL,
  'ORDER BY o.price ASC, o.id ASC',
].join('\n');

/**
 * Every observation of one catalog product's price, NEWEST first, capped.
 *
 * HISTORY IS A RECORD, NOT A CURRENT ELIGIBILITY CLAIM. The list and the detail
 * prune offers through `CATALOG_OFFER_ELIGIBILITY_SQL` (in stock, checked within
 * 30 days). Applying that here would let history DELETE ITSELF as an offer ages
 * out, so a price that rose while the offer went out of stock would render as a
 * flat line. The product must still be ACTIVE and categorized - the identity
 * statement owns that - and every point still carries its offer's provenance
 * class, so a seed observation is never mistaken for a verified one.
 *
 * The cap takes the NEWEST rows; the presenter collapses them to one point per
 * observation moment and serves them ascending, so the cut-off drops ancient
 * points and never recent ones.
 *
 * $1 uuid    product id
 * $2 text    currency
 * $3 integer cap, newest first
 */
const SELECT_PRICE_HISTORY_SQL = [
  'SELECT h.observed_at, h.price, o.ingestion_record_id',
  'FROM price_history h',
  'JOIN store_offer o ON o.id = h.store_offer_id',
  'WHERE o.product_id = $1',
  '  AND h.currency = $2',
  'ORDER BY h.observed_at DESC, h.id DESC',
  'LIMIT $3',
].join('\n');

/**
 * The spec columns that are IDENTITY, not specification. They are stripped from
 * the served object: a catalog consumer needs `socket`, `tdp_watts` and the
 * like, not row keys or audit timestamps.
 *
 * `id` is in the list although no `*_spec` table has one: each spec table's PK
 * is `product_id` or `product_variant_id` (migration 004 - one-to-one). jsonb's
 * `-` ignores a missing key, so naming it costs nothing and keeps a future
 * surrogate key out of the response without another edit.
 */
const CATALOG_SPEC_STRIP_COLUMNS = "ARRAY['id', 'product_id', 'product_variant_id', 'created_at', 'updated_at']";

/**
 * Category -> the statement returning its spec row as ONE jsonb object.
 *
 * The table name is a TRUSTED LITERAL from this frozen map, selected by the
 * category the database itself derived - never by a request value. Product-keyed
 * categories read `product_id`; GPU reads the VARIANT's spec, because a GPU
 * board row is variant-keyed. `$1` is always the product id; the GPU statement
 * also takes `$2`.
 *
 * Each spec table is ONE-TO-ONE with its key (migration 004: `product_id` or
 * `product_variant_id` is the PK), so there is no ordering to impose; `LIMIT 1`
 * only stops a violated invariant from producing two rows.
 */
const CATALOG_SPEC_SQL_BY_CATEGORY = Object.freeze({
  CPU: 'SELECT to_jsonb(s) - ' + CATALOG_SPEC_STRIP_COLUMNS + ' AS specs FROM cpu_spec s WHERE s.product_id = $1 LIMIT 1',
  MOTHERBOARD: 'SELECT to_jsonb(s) - ' + CATALOG_SPEC_STRIP_COLUMNS + ' AS specs FROM motherboard_spec s WHERE s.product_id = $1 LIMIT 1',
  MEMORY: 'SELECT to_jsonb(s) - ' + CATALOG_SPEC_STRIP_COLUMNS + ' AS specs FROM ram_spec s WHERE s.product_id = $1 LIMIT 1',
  STORAGE: 'SELECT to_jsonb(s) - ' + CATALOG_SPEC_STRIP_COLUMNS + ' AS specs FROM ssd_spec s WHERE s.product_id = $1 LIMIT 1',
  PSU: 'SELECT to_jsonb(s) - ' + CATALOG_SPEC_STRIP_COLUMNS + ' AS specs FROM psu_spec s WHERE s.product_id = $1 LIMIT 1',
  CASE: 'SELECT to_jsonb(s) - ' + CATALOG_SPEC_STRIP_COLUMNS + ' AS specs FROM case_spec s WHERE s.product_id = $1 LIMIT 1',
  COOLER: 'SELECT to_jsonb(s) - ' + CATALOG_SPEC_STRIP_COLUMNS + ' AS specs FROM cooler_spec s WHERE s.product_id = $1 LIMIT 1',
  /**
   * $2 is the variant the CHEAPEST eligible offer belongs to, so the spec shown
   * is the thing priced. NULL (no offer, or a variant-less offer) falls back to
   * the product's lowest-id variant, deterministically - a product with two GPU
   * variants exists in the live catalog (measured 2026-10-17: 21 GPU products,
   * 22 variants), so "whichever row came back" is not good enough here.
   */
  GPU: 'SELECT to_jsonb(s) - ' + CATALOG_SPEC_STRIP_COLUMNS + ' AS specs FROM gpu_board_spec s'
    + ' WHERE s.product_variant_id = COALESCE($2::uuid,'
    + ' (SELECT v.id FROM product_variant v WHERE v.product_id = $1 ORDER BY v.id ASC LIMIT 1))'
    + ' LIMIT 1',
});

/**
 * One page of catalog products.
 *
 * @param {object} db pool or client exposing query(sql, params)
 * @param {object} key { category: string|null, cursor: string|null,
 *        limit: number (page size + 1), currency }
 * @returns {Promise<Array<object>>} raw rows; NUMERIC is a string here
 */
async function selectCatalogProducts(db, key) {
  const result = await db.query(SELECT_CATALOG_PRODUCTS_SQL, [
    key.category === undefined ? null : key.category,
    key.cursor === undefined ? null : key.cursor,
    key.limit,
    key.currency,
  ]);
  return result && Array.isArray(result.rows) ? result.rows : [];
}

/**
 * One catalog product with its offers and its spec object.
 *
 * @param {object} db pool or client exposing query(sql, params)
 * @param {object} key { slug, currency }
 * @returns {Promise<{found: false} | {found: true, product: object,
 *   offers: Array<object>, specs: object|null}>} `specs` is null only if the
 *   derived category has no spec row, which the list query cannot produce.
 */
async function readCatalogProduct(db, key) {
  const identity = await db.query(SELECT_CATALOG_PRODUCT_SQL, [key.slug]);
  const identityRows = identity && Array.isArray(identity.rows) ? identity.rows : [];
  if (identityRows.length === 0) {
    return { found: false };
  }
  const product = identityRows[0];

  const offerResult = await db.query(SELECT_CATALOG_OFFERS_SQL, [product.id, key.currency]);
  const offers = offerResult && Array.isArray(offerResult.rows) ? offerResult.rows : [];

  const specSql = CATALOG_SPEC_SQL_BY_CATEGORY[product.category];
  if (specSql === undefined) {
    // Unreachable by construction: the identity statement's CASE and this map
    // are the same eight categories. Throwing beats serving a product page with
    // a silently empty spec block.
    throw new Error('no catalog spec statement for derived category ' + String(product.category));
  }
  const specParams = product.category === 'GPU'
    ? [product.id, offers.length > 0 ? offers[0].product_variant_id : null]
    : [product.id];
  const specResult = await db.query(specSql, specParams);
  const specRows = specResult && Array.isArray(specResult.rows) ? specResult.rows : [];

  return {
    found: true,
    product,
    offers,
    specs: specRows.length === 0 ? null : specRows[0].specs,
  };
}

/**
 * One catalog product's price observations, newest first.
 *
 * @param {object} db pool or client exposing query(sql, params)
 * @param {object} key { slug, currency, limit }
 * @returns {Promise<{found: false} | {found: true, product: object,
 *   points: Array<object>}>} `points` is the NEWEST `limit` rows, newest first
 */
async function readPriceHistory(db, key) {
  const identity = await db.query(SELECT_CATALOG_PRODUCT_SQL, [key.slug]);
  const identityRows = identity && Array.isArray(identity.rows) ? identity.rows : [];
  if (identityRows.length === 0) {
    return { found: false };
  }
  const product = identityRows[0];

  const result = await db.query(SELECT_PRICE_HISTORY_SQL, [product.id, key.currency, key.limit]);
  const points = result && Array.isArray(result.rows) ? result.rows : [];
  return { found: true, product, points };
}

/**
 * The active scoring model, or null when none is active.
 *
 * @param {object} db pool or client exposing query(sql, params)
 * @returns {Promise<{id: string, configuration: object}|null>}
 */
async function selectActiveScoringModel(db) {
  const result = await db.query(SELECT_ACTIVE_SCORING_MODEL_SQL);
  const rows = result && Array.isArray(result.rows) ? result.rows : [];
  if (rows.length === 0) {
    return null;
  }
  const row = rows[0];
  return { id: row.id, configuration: row.configuration };
}

/**
 * Insert the profile+query pair in ONE transaction, so a failure leaves
 * neither row behind. Returns the ids the caller needs (the engine pins only
 * the query id; the profile id is returned for tests and diagnostics).
 *
 * `catalogVersion` is written ONCE, at INSERT, and never updated: it is the
 * catalog state this pass is about to read, and a later pass writes its own row.
 * An absent value is SQL NULL rather than an invented one - the caller degrades
 * to "not recorded" when the digest fails, which disables reuse for that row
 * instead of guessing (Decision 47 item 10).
 *
 * @param {object} client a single dedicated connection
 * @param {object} input { scoringModelId, budgetAmount, currency, useCase,
 *        resolution, priority, catalogVersion }
 * @returns {Promise<{profileId: string, queryId: string}>} frozen
 */
async function createRecommendationQuery(client, input) {
  const profileId = randomUUID();
  const queryId = randomUUID();
  await withTransaction(client, async (tx) => {
    await tx.query(INSERT_PROFILE_SQL, [
      profileId,
      'api-' + profileId,
      'Created by POST /v1/recommendations',
      input.useCase,
      input.priority === undefined ? null : input.priority,
      input.resolution === undefined ? null : input.resolution,
    ]);
    await tx.query(INSERT_QUERY_SQL, [
      queryId,
      profileId,
      input.scoringModelId,
      input.budgetAmount,
      input.currency,
      input.useCase,
      input.priority === undefined ? null : input.priority,
      input.resolution === undefined ? null : input.resolution,
      input.catalogVersion === undefined ? null : input.catalogVersion,
    ]);
  });
  return Object.freeze({ profileId, queryId });
}

/**
 * The existing pass that answers this request exactly, if there is one.
 *
 * A READ, deliberately: the caller runs it before `createRecommendationQuery`,
 * on the same dedicated connection, so a hit costs one statement instead of a
 * whole engine pass (74 statements, measured).
 *
 * @param {object} db pool or client exposing query(sql, params)
 * @param {object} key { scoringModelId, budgetAmount, currency, useCase,
 *        resolution, priority, catalogVersion, engineVersion }
 * @returns {Promise<{queryId: string}|null>} the reusable query, or null when
 *          this request has no equivalent stored pass
 */
async function findReusableQuery(db, key) {
  const result = await db.query(SELECT_REUSABLE_QUERY_SQL, [
    key.scoringModelId,
    key.budgetAmount,
    key.currency,
    key.useCase,
    key.resolution === undefined ? null : key.resolution,
    key.priority === undefined ? null : key.priority,
    key.catalogVersion === undefined ? null : key.catalogVersion,
    key.engineVersion === undefined ? null : key.engineVersion,
  ]);
  const rows = result && Array.isArray(result.rows) ? result.rows : [];
  if (rows.length === 0) {
    return null;
  }
  return Object.freeze({ queryId: rows[0].id });
}

/**
 * Read the persisted state of one recommendation query.
 *
 * @param {object} db pool or client exposing query(sql, params)
 * @param {string} queryId recommendation_query id
 * @returns {Promise<{found: boolean, query?: object, rows?: Array<object>}>}
 *          `found: false` means the query row itself is unknown - the ONLY 404
 *          condition. A known query with zero builds is `found: true, rows: []`.
 */
async function readRecommendationResult(db, queryId) {
  const queryResult = await db.query(SELECT_QUERY_SQL, [queryId]);
  const queryRows = queryResult && Array.isArray(queryResult.rows) ? queryResult.rows : [];
  if (queryRows.length === 0) {
    return { found: false };
  }
  const buildsResult = await db.query(SELECT_BUILDS_SQL, [queryId]);
  const rows = buildsResult && Array.isArray(buildsResult.rows) ? buildsResult.rows : [];
  return { found: true, query: queryRows[0], rows };
}

/**
 * The preset ribbon rows of one (use case, currency, catalog version), cheapest
 * budget first. Rows are RAW pg rows - NUMERIC as strings, timestamps as Dates -
 * exactly as `readRecommendationResult` returns them; the route's presenter
 * converts.
 *
 * @param {object} db pool or client exposing query(sql, params)
 * @param {object} key { useCase, currency, catalogVersion }
 * @returns {Promise<Array<object>>} SELECT_PRESETS_SQL rows
 */
async function selectPresets(db, key) {
  const result = await db.query(SELECT_PRESETS_SQL, [
    key.useCase,
    key.currency,
    key.catalogVersion,
  ]);
  return result && Array.isArray(result.rows) ? result.rows : [];
}

/**
 * The exact key's pass id, or null - the SKIP that makes a second generator run
 * write nothing. Exact on all four key parts; a partial match is no match.
 *
 * @param {object} db pool or client exposing query(sql, params)
 * @param {object} key { useCase, currency, catalogVersion, budgetAmount }
 * @returns {Promise<string|null>} the recorded pass id
 */
async function findPresetQueryId(db, key) {
  const result = await db.query(FIND_PRESET_QUERY_ID_SQL, [
    key.useCase,
    key.currency,
    key.catalogVersion,
    key.budgetAmount,
  ]);
  const rows = result && Array.isArray(result.rows) ? result.rows : [];
  return rows.length === 0 ? null : rows[0].query_id;
}

/**
 * Record (or MOVE) the key's pointer. Replace-idempotent: one row per key,
 * pointing at the pass just written.
 *
 * @param {object} client a single dedicated connection
 * @param {object} key { useCase, currency, catalogVersion, budgetAmount, queryId }
 * @returns {Promise<{queryId: string}>} the pointer the row holds after the write
 */
async function upsertPreset(client, key) {
  const result = await client.query(UPSERT_PRESET_SQL, [
    key.useCase,
    key.currency,
    key.catalogVersion,
    key.budgetAmount,
    key.queryId,
  ]);
  return { queryId: result.rows[0].query_id };
}

/**
 * Delete the preset rows of a scope - every field optional - and return the pass
 * ids they pointed at. Pass cleanup (FK order, profiles) belongs to the caller.
 *
 * @param {object} client a single dedicated connection
 * @param {object} [scope] { useCase?, currency?, catalogVersion? }; empty means
 *        every preset row
 * @returns {Promise<string[]>} the deleted rows' query ids
 */
async function deletePresets(client, scope) {
  const s = scope || {};
  const result = await client.query(DELETE_PRESETS_SQL, [
    s.useCase === undefined ? null : s.useCase,
    s.currency === undefined ? null : s.currency,
    s.catalogVersion === undefined ? null : s.catalogVersion,
  ]);
  return result.rows.map((row) => row.query_id);
}

/**
 * Prune the family's superseded rows (every catalog version but the key's own)
 * and return their pass ids so the caller can delete the passes too.
 *
 * @param {object} client a single dedicated connection
 * @param {object} key { useCase, currency, catalogVersion, budgetAmount }
 * @returns {Promise<string[]>} the pruned rows' query ids
 */
async function deleteSupersededPresets(client, key) {
  const result = await client.query(DELETE_SUPERSEDED_PRESETS_SQL, [
    key.useCase,
    key.currency,
    key.budgetAmount,
    key.catalogVersion,
  ]);
  return result.rows.map((row) => row.query_id);
}

module.exports = {
  SELECT_ACTIVE_SCORING_MODEL_SQL,
  INSERT_PROFILE_SQL,
  INSERT_QUERY_SQL,
  SELECT_QUERY_SQL,
  SELECT_BUILDS_SQL,
  SELECT_REUSABLE_QUERY_SQL,
  SELECT_PRESETS_SQL,
  FIND_PRESET_QUERY_ID_SQL,
  UPSERT_PRESET_SQL,
  DELETE_PRESETS_SQL,
  DELETE_SUPERSEDED_PRESETS_SQL,
  CATALOG_CATEGORY_EXPRESSION,
  CATALOG_SPEC_SQL_BY_CATEGORY,
  SELECT_CATALOG_PRODUCTS_SQL,
  SELECT_CATALOG_PRODUCT_SQL,
  SELECT_CATALOG_OFFERS_SQL,
  SELECT_PRICE_HISTORY_SQL,
  selectCatalogProducts,
  readCatalogProduct,
  readPriceHistory,
  selectActiveScoringModel,
  createRecommendationQuery,
  findReusableQuery,
  readRecommendationResult,
  selectPresets,
  findPresetQueryId,
  upsertPreset,
  deletePresets,
  deleteSupersededPresets,
};
