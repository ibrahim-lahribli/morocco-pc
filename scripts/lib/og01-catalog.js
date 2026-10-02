'use strict';

/**
 * scripts/lib/og01-catalog.js — single owner of the OG-01 catalog-derivation
 * policy (read-only).
 *
 * Why this exists: three consumers need the SAME derivation — the coverage
 * gate (check-og01-coverage.js), the research-checklist generator
 * (og01-research-checklist.js), and the reach measurement
 * (measure-og01-reach.js). Before this module the derivation lived as a
 * private copy inside the gate. The engine's candidates/loader.js MUST stay
 * pure (no DB client imports, no script concerns), so the shared home is
 * here, not in src/.
 *
 * Policy (mirrors candidates/loader.js, the engine's category authority):
 *   - category is DERIVED from canonical spec-table presence, never from a
 *     product column (`product` has no category column). GPU is the one
 *     variant-keyed category (product -> product_variant -> gpu_board_spec);
 *   - the required assessment types per category come from the ACTIVE scoring
 *     model's configuration.role_weights (never hardcoded);
 *   - role -> category comes from the engine's ROLE_CATEGORIES constant, so a
 *     STORAGE product inherits SSD_BOOT's required types, etc.
 *
 * Read-only: SELECT-only. Callers pass in a pg-compatible client exposing
 * query(sql) (single-statement; no parameters needed). No dotenv here — the
 * caller loads env, same convention as scripts/lib/db-url.js.
 *
 * Exit-code policy lives with the consumers; this module only throws on
 * derivation errors (no/ambiguous active model, no role_weights).
 */

const path = require('path');

const { ROLE_CATEGORIES } = require(path.join(
  __dirname,
  '..',
  '..',
  'src',
  'recommendation',
  'candidates',
  'roles'
));

/**
 * Products DELIBERATELY left without any `component_assessment` row as
 * STEP-1 no-evidence fixtures (`database/seeds/001_minimal_builds.sql`
 * "CASE1 (compact) has NO rows -> no-evidence"). Their lack of research is
 * an engine fixture, not an OG-01 research target. If seed 001 ever changes,
 * consumers surface the difference instead of hiding it.
 */
const DELIBERATE_NO_EVIDENCE = Object.freeze(['Seed NZXT H5 Flow Compact']);

/**
 * Products deliberately left with only SOME of their required assessment
 * types, so the missing-type branch of Decision 13 STEP 1 (a type with no
 * row takes the same no-evidence branch as a NULL-score row) stays covered
 * in a LIVE database run.
 *
 * Seed 001 wrote a curated subset per product rather than all three required
 * types; the per-type gaps are an artifact of that fixture set, not OG-01
 * research debt. OG-01 batch 2 was scoped 2026-10-02 to the 56 fully
 * unassessed products (168 rows) and EXCLUDES these on purpose: filling them
 * would remove live branch coverage without closing any gap.
 *
 * Consequence for consumers: these are reported separately from real
 * partials and are never research targets. `--strict` fails only on partials
 * outside this set. If seed 001 ever changes, a name that stops being a
 * partial simply stops appearing; a partial that appears that is NOT listed
 * here is surfaced as a real one.
 */
const DELIBERATE_PARTIAL = Object.freeze([
  'Seed Fractal Pop XL',
  'Seed DeepCool AG400',
  'Seed Noctua NH-U12S SE-AM5',
  'Seed Ryzen 5 7500F',
  'Seed Ryzen 5 8600G',
  'Seed RTX 4060 8GB',
  'Seed Corsair Vengeance 16GB DDR5-5200',
  'Seed G.Skill Flare X5 32GB DDR5-6000',
  'Seed Gigabyte B650 AORUS ELITE AX',
  'Seed MSI PRO B650M-P',
  'Seed Corsair CX550M 550W',
  'Seed MSI MAG A750GL 750W',
  'Seed Samsung 990 Pro 2TB',
  'Seed WD Blue SN580 1TB',
]);

/**
 * Canonical product-keyed category -> spec table mapping. Trusted static
 * identifiers, deliberately duplicated from candidates/loader.js (that module
 * does not export the map; the KEYS must stay identical to its
 * PRODUCT_KEYED_SPEC_BY_CATEGORY). This module is the single script-side copy.
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

/** ACTIVE products per category: product-keyed tables + the GPU variant join. */
const PRODUCTS_SQL =
  Object.entries(PRODUCT_KEYED_SPEC_BY_CATEGORY)
    .map(
      ([category, table]) => `SELECT p.id, p.name, '${category}' AS category
  FROM product p
  JOIN ${table} s ON s.product_id = p.id
 WHERE p.lifecycle_status = 'ACTIVE'`
    )
    .concat([
      `SELECT p.id, p.name, 'GPU' AS category
  FROM product p
  JOIN product_variant pv ON pv.product_id = p.id
  JOIN gpu_board_spec s ON s.product_variant_id = pv.id
 WHERE p.lifecycle_status = 'ACTIVE'`,
    ])
    .join('\nUNION\n') + '\n ORDER BY category ASC, name ASC;';

const SCORING_MODELS_SQL = `SELECT id::text AS id, name, version,
       configuration->'role_weights' AS role_weights
  FROM scoring_model
 WHERE is_active = true
 ORDER BY id ASC;`;

const OFFERS_SQL = `SELECT o.product_id, min(o.price) AS min_price, max(o.price) AS max_price,
       count(*)::int AS offer_count
  FROM store_offer o
  JOIN product p ON p.id = o.product_id
 WHERE p.lifecycle_status = 'ACTIVE'
 GROUP BY o.product_id;`;

/**
 * category -> Set(required assessment types), from role_weights x
 * ROLE_CATEGORIES. Only types with a positive finite weight are required.
 */
function requiredTypesByCategory(roleWeights) {
  const byCategory = new Map();
  for (const [role, weights] of Object.entries(roleWeights)) {
    const category = ROLE_CATEGORIES[role];
    if (!category || weights === null || typeof weights !== 'object') continue;
    const types = byCategory.get(category) || new Set();
    for (const [type, weight] of Object.entries(weights)) {
      if (typeof weight === 'number' && Number.isFinite(weight) && weight > 0) {
        types.add(type);
      }
    }
    byCategory.set(category, types);
  }
  return byCategory;
}

/**
 * Derive the OG-01 catalog view from the live DB.
 *
 * @param {object} db pg-compatible client exposing query(sql)
 * @returns {Promise<{model: {id,name,version}, requiredByCategory: Map,
 *   products: Array<{id,name,category,coveredTypes:Set,minPrice,maxPrice,offerCount}>,
 *   fixtures: Set<string>, partialFixtures: Set<string>}>}
 *   products are sorted category ASC, name ASC; coveredTypes is the set of
 *   assessment types the product already has rows for; min/maxPrice are
 *   numbers in offer currency (MAD today) or null when the product has no
 *   active offer.
 */
async function loadOg01Catalog(db) {
  if (db === null || typeof db !== 'object' || typeof db.query !== 'function') {
    throw new Error('loadOg01Catalog requires a database client exposing query()');
  }

  const models = await db.query(SCORING_MODELS_SQL);
  if (models.rows.length !== 1) {
    throw new Error(
      'expected exactly ONE active scoring_model row, found ' +
        models.rows.length +
        ' (coverage cannot be derived unambiguously)'
    );
  }
  const model = models.rows[0];
  if (model.role_weights === null || typeof model.role_weights !== 'object') {
    throw new Error('active scoring_model "' + model.name + '" has no configuration.role_weights');
  }

  const requiredByCategory = requiredTypesByCategory(model.role_weights);
  if (requiredByCategory.size === 0) {
    throw new Error('role_weights yielded no roles - nothing to derive');
  }

  const [productsRes, offersRes] = await Promise.all([
    db.query(PRODUCTS_SQL),
    db.query(OFFERS_SQL),
  ]);
  const offersByProduct = new Map();
  for (const row of offersRes.rows) {
    offersByProduct.set(row.product_id, {
      minPrice: row.min_price === null ? null : Number(row.min_price),
      maxPrice: row.max_price === null ? null : Number(row.max_price),
      offerCount: row.offer_count,
    });
  }

  const products = productsRes.rows.map((row) => {
    const offer = offersByProduct.get(row.id) || {
      minPrice: null,
      maxPrice: null,
      offerCount: 0,
    };
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      coveredTypes: new Set(),
      minPrice: offer.minPrice,
      maxPrice: offer.maxPrice,
      offerCount: offer.offerCount,
    };
  });
  // Code-unit sort (never localeCompare): the engine's determinism rule
  // (AGENTS section 5) applies to any ordering consumers may print or diff.
  products.sort(
    (a, b) =>
      (a.category < b.category ? -1 : a.category > b.category ? 1 : 0) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  );

  return {
    model: { id: model.id, name: model.name, version: model.version },
    requiredByCategory,
    products,
    fixtures: new Set(DELIBERATE_NO_EVIDENCE),
    partialFixtures: new Set(DELIBERATE_PARTIAL),
  };
}

/** Attach covered assessment types onto catalog products (mutates the passed products' coveredTypes). Returns the full product_id -> Set(types) map including products outside this catalog's rows (e.g. rows whose product is not ACTIVE). */
async function loadCoveredTypes(db, products) {
  const res = await db.query(
    'SELECT product_id, assessment_type FROM component_assessment;'
  );
  const byProduct = new Map();
  for (const row of res.rows) {
    let set = byProduct.get(row.product_id);
    if (!set) {
      set = new Set();
      byProduct.set(row.product_id, set);
    }
    set.add(row.assessment_type);
  }
  for (const p of products) {
    p.coveredTypes = byProduct.get(p.id) || new Set();
  }
  return byProduct;
}

module.exports = {
  DELIBERATE_NO_EVIDENCE,
  DELIBERATE_PARTIAL,
  PRODUCT_KEYED_SPEC_BY_CATEGORY,
  requiredTypesByCategory,
  loadOg01Catalog,
  loadCoveredTypes,
};
