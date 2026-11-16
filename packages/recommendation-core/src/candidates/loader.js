/**
 * Engine 2B - Database candidate loader.
 *
 * Boundary: turns a recommendation-query-shaped engine input into validated
 * Engine 2A candidate records by loading canonical Layer 1 identities.
 *
 *   recommendation-query-shaped input
 *         |  validate via Engine 2A createCandidateSelectionInput()
 *         v
 *   validated selection input
 *         |  derive product category from canonical Layer 1 hardware-spec
 *         |  table presence (there is NO product.category column)
 *         v
 *   Engine 2A candidate records (createCandidate() contract)
 *
 * Responsibility: data retrieval + mapping ONLY. No compatibility filtering,
 * no budget filtering, no scoring, no ranking, no build assembly.
 *
 * Category source (settled by the Engine 2B architectural investigation):
 * category is DERIVED from canonical hardware-spec table presence, never read
 * from product_candidate.source_category and never from name heuristics.
 *
 *   product-keyed specs (product.id = spec.product_id):
 *     cpu_spec -> CPU, motherboard_spec -> MOTHERBOARD, ram_spec -> MEMORY,
 *     ssd_spec -> STORAGE, psu_spec -> PSU, case_spec -> CASE,
 *     cooler_spec -> COOLER
 *   variant-keyed spec (product -> product_variant -> gpu_board_spec):
 *     gpu_board_spec -> GPU   (guarantee: product_variant_id != null)
 *
 * This module never reads prices, offers, price history, benchmark, or
 * recommendation tables, and never filters on budget or use_case.
 */

const { createCandidateSelectionInput } = require('./input');
const { createCandidate } = require('./candidate');
const { ROLE_CATEGORIES, ROLE_ORDER } = require('./roles');
const { CandidateSelectionError, ERROR_CODES } = require('./errors');

/** Canonical lifecycle policy: only ACTIVE products are recommendation candidates. */
const LIFECYCLE_ACTIVE = 'ACTIVE';

/** GPU is variant-keyed; there is no product-level GPU spec. */
const GPU_CATEGORY = 'GPU';

/**
 * Canonical product-keyed category -> spec table mapping (migration 004).
 * Trusted static identifiers, never derived from user input.
 */
const PRODUCT_KEYED_SPEC_BY_CATEGORY = Object.freeze({
  CPU: 'cpu_spec',
  MOTHERBOARD: 'motherboard_spec',
  MEMORY: 'ram_spec',
  STORAGE: 'ssd_spec',
  PSU: 'psu_spec',
  CASE: 'case_spec',
  COOLER: 'cooler_spec',
});

/**
 * Canonical data-integrity guard SQL.
 *
 * PostgreSQL does NOT enforce cross-spec-table exclusivity, so a single product
 * may legitimately appear in two product-keyed spec tables. GPU is excluded
 * from this guard because gpu_board_spec is intentionally variant-keyed: a
 * product-level spec plus a GPU variant is a valid canonical data model, not a
 * category conflict (see the Engine 2B investigation report, section 7).
 * Enforcement is scoped in loadCandidates: only ambiguous ids behind
 * returned product-keyed candidates fail the load.
 *
 * Returns one row per ACTIVE product that appears in more than one of the seven
 * product-keyed spec tables.
 */
const PRODUCT_KEYED_AMBIGUITY_SQL = `
SELECT p.id AS product_id,
       count(*) AS category_count
  FROM product p
  JOIN (
         SELECT product_id, 'cpu_spec'          AS src FROM cpu_spec
         UNION ALL SELECT product_id, 'motherboard_spec' FROM motherboard_spec
         UNION ALL SELECT product_id, 'ram_spec' FROM ram_spec
         UNION ALL SELECT product_id, 'ssd_spec' FROM ssd_spec
         UNION ALL SELECT product_id, 'psu_spec' FROM psu_spec
         UNION ALL SELECT product_id, 'case_spec' FROM case_spec
         UNION ALL SELECT product_id, 'cooler_spec' FROM cooler_spec
       ) specs ON specs.product_id = p.id
 WHERE p.lifecycle_status = 'ACTIVE'
 GROUP BY p.id
HAVING count(*) > 1
 ORDER BY p.id ASC;
`;

/**
 * Build the candidate SQL for a product-keyed category.
 *
 * Base-only:
 *   exactly one base product candidate (product_variant_id = NULL);
 *   generic product_variant rows never create candidates.
 * Candidate identity follows the key of the canonical hardware specification:
 * product-keyed spec yields a base product candidate; the variant-keyed GPU
 * spec yields variant candidates. No product_variant_type, name, or
 * variant-metadata logic is used.
 *
 * `specTable` is always a trusted identifier from PRODUCT_KEYED_SPEC_BY_CATEGORY.
 */
function productKeyedSql(specTable) {
  return `
SELECT p.id AS product_id,
       NULL::uuid AS product_variant_id
  FROM product p
 WHERE p.lifecycle_status = 'ACTIVE'
   AND EXISTS (SELECT 1 FROM ${specTable} s WHERE s.product_id = p.id)

 ORDER BY product_id ASC;
`;
}

/**
 * GPU candidate SQL. GPU identity lives at the variant level: a variant is
 * eligible only when it has a gpu_board_spec row. There is deliberately no
 * product-level (NULL variant) GPU candidate.
 */
const GPU_SQL = `
SELECT p.id AS product_id,
       pv.id AS product_variant_id
  FROM product p
  JOIN product_variant pv ON pv.product_id = p.id
  JOIN gpu_board_spec s ON s.product_variant_id = pv.id
 WHERE p.lifecycle_status = 'ACTIVE'
 ORDER BY p.id ASC, pv.id ASC;
`;

/**
 * Fixed per-category SQL statements keyed by canonical product category.
 * Only categories reachable through ROLE_CATEGORIES are present.
 */
const QUERY_BY_CATEGORY = Object.freeze(
  Object.assign(
    {},
    ...Object.entries(PRODUCT_KEYED_SPEC_BY_CATEGORY).map(([category, table]) => ({
      [category]: productKeyedSql(table),
    })),
    { [GPU_CATEGORY]: GPU_SQL }
  )
);

/**
 * Deterministic candidate comparator matching Engine 2A's conceptual ordering:
 *   1. component role (canonical ROLE_ORDER)
 *   2. product_id ascending
 *   3. null variant first, then product_variant_id ascending
 */
function compareCandidates(a, b) {
  const roleA = ROLE_ORDER[a.component_role];
  const roleB = ROLE_ORDER[b.component_role];
  const ra = roleA === undefined ? Number.MAX_SAFE_INTEGER : roleA;
  const rb = roleB === undefined ? Number.MAX_SAFE_INTEGER : roleB;
  if (ra !== rb) return ra - rb;

  if (a.product_id !== b.product_id) {
    return a.product_id < b.product_id ? -1 : 1;
  }

  const va = a.product_variant_id;
  const vb = b.product_variant_id;
  if (va === null && vb !== null) return -1;
  if (va !== null && vb === null) return 1;
  if (va !== vb) return va < vb ? -1 : 1;
  return 0;
}

/** Read rows from a pg-compatible query result. */
async function queryRows(db, sql) {
  const result = await db.query(sql, []);
  if (result === null || result === undefined) return [];
  if (!Array.isArray(result.rows)) return [];
  return result.rows;
}

/**
 * Load canonical DB candidates for a recommendation-query-shaped input.
 *
 * @param {object} input  passed through Engine 2A createCandidateSelectionInput()
 * @param {object} db     pg-compatible client exposing db.query(sql, params)
 * @returns {Promise<{input: object, candidates: Array<object>}>}
 *          candidates are frozen Engine 2A candidate records, deterministically
 *          ordered by role, product_id ASC, variant ASC (NULLS FIRST).
 */
async function loadCandidates(input, db) {
  const validated = createCandidateSelectionInput(input);

  if (db === null || typeof db !== 'object' || typeof db.query !== 'function') {
    throw new CandidateSelectionError(
      ERROR_CODES.INVALID_INPUT,
      'loadCandidates requires a database client exposing query()',
      'db'
    );
  }

  // 1. Load per role in canonical role order (candidate identity follows the
  //    key of the canonical hardware specification).
  const candidates = [];
  for (const role of Object.keys(ROLE_ORDER)) {
    if (!validated.required_roles.includes(role)) continue;

    const category = ROLE_CATEGORIES[role];
    if (category === undefined) {
      throw new CandidateSelectionError(
        ERROR_CODES.INVALID_COMPONENT_ROLE,
        `No canonical product category mapping exists for component role "${role}"`,
        'required_roles'
      );
    }

    const sql = QUERY_BY_CATEGORY[category];
    if (sql === undefined) {
      throw new CandidateSelectionError(
        ERROR_CODES.ROLE_CATEGORY_MISMATCH,
        `No canonical spec-table derivation exists for category "${category}" of role "${role}"`,
        'category'
      );
    }

    const rows = await queryRows(db, sql);
    for (const row of rows) {
      if (row.product_id === null || row.product_id === undefined) {
        throw new CandidateSelectionError(
          ERROR_CODES.INVALID_CANDIDATE,
          'Candidate row is missing product_id',
          'product_id'
        );
      }

      const productVariantId = row.product_variant_id === undefined ? null : row.product_variant_id;

      if (category === GPU_CATEGORY && productVariantId === null) {
        throw new CandidateSelectionError(
          ERROR_CODES.INVALID_CANDIDATE,
          'GPU candidates must carry a non-null product_variant_id',
          'product_variant_id'
        );
      }

      if (category !== GPU_CATEGORY && productVariantId !== null) {
        throw new CandidateSelectionError(
          ERROR_CODES.INVALID_CANDIDATE,
          'Product-keyed candidate must carry a null product_variant_id',
          'product_variant_id'
        );
      }

      candidates.push(
        createCandidate({
          product_id: String(row.product_id),
          product_variant_id: productVariantId,
          category,
          component_role: role,
        })
      );
    }
  }

  // 2. Scoped canonical category guard: never silently choose a category,
  //    but only fail when an ambiguous product actually contributed a
  //    product-keyed candidate to this request. Unrelated catalog issues
  //    never block valid roles. GPU is variant-keyed and excluded here.
  const productKeyedIds = new Set();
  for (const built of candidates) {
    if (built.category !== GPU_CATEGORY) { productKeyedIds.add(built.product_id); }
  }
  if (productKeyedIds.size > 0) {
    const ambiguousRows = await queryRows(db, PRODUCT_KEYED_AMBIGUITY_SQL);
    const relevant = [];
    for (const amb of ambiguousRows) {
      const pid = amb.product_id;
      const key = (pid === null || pid === undefined) ? '' : String(pid);
      if (key.length > 0 && productKeyedIds.has(key)) { relevant.push(key); }
    }
    relevant.sort();
    if (relevant.length > 0) {
      throw new CandidateSelectionError(
        ERROR_CODES.CANONICAL_CATEGORY_AMBIGUITY,
        'Canonical category ambiguity: product(s) appear in multiple product-keyed category spec tables: ' + relevant.join(', '),
        'product_id'
      );
    }
  }

  // 3. Ensure determinism regardless of query result order.
  candidates.sort(compareCandidates);

  return Object.freeze({
    input: validated,
    candidates: Object.freeze(candidates),
  });
}

module.exports = { loadCandidates };
