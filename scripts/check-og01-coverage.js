'use strict';

/**
 * OG-01 assessment-coverage gate (read-only).
 *
 * The OG-01 gap: the seed-002 expanded catalog has no `component_assessment`
 * rows, so every weighted type scores the flat no-evidence branch (40.000,
 * Decision 13 STEP 1) and product reach falls back to random UUID order
 * (`database/seeds/002_catalog_expansion.sql` D2, amended 2026-09-28).
 *
 * This gate answers "does any active catalog product still lack assessment
 * research for every type the scoring model weights?" - the deliverable
 * boundary of docs/OG-01_ASSESSMENT_RESEARCH_PLAN.md (section 6).
 *
 * Contract (mirrors candidates/loader.js, the engine's category authority):
 *   - category is DERIVED from canonical spec-table presence, never from a
 *     product column (`product` has no category column). GPU is the one
 *     variant-keyed category (product -> product_variant -> gpu_board_spec);
 *   - the required assessment types per role come from the ACTIVE scoring
 *     model's configuration.role_weights (never hardcoded here);
 *   - role -> category comes from the engine's ROLE_CATEGORIES constant, so a
 *     STORAGE product inherits SSD_BOOT's required types, etc.
 *
 * Sections:
 *   FAIL  fully-unassessed products (zero `component_assessment` rows) = the
 *         remaining research targets, excluding the documented
 *         DELIBERATE_NO_EVIDENCE fixtures below. Non-empty means OG-01 is
 *         still open.
 *   INFO  partially-assessed products (some required types missing). NOT a
 *         failure by default: seed 001's fixtures are deliberately partial
 *         (STEP-1 branch coverage). --strict turns it into a failure and is
 *         only meaningful after the full OG-01 deliverable has landed
 *         (batch 1 = seeds/004a GPU+PSU, batch 2 = seeds/004b the rest).
 *
 * Read-only: SELECT-only, reads DATABASE_URL, performs no writes. It is safe
 * to run against the shared database and does not need the TEST_DATABASE_URL
 * guard (that guard exists for write-capable tests).
 *
 * Usage: node scripts/check-og01-coverage.js [--strict]
 * Exit codes: 0 = gate satisfied; 1 = gate failed or the live data could not
 * be read/derived; 2 = usage error.
 */

require('dotenv').config();
const { Client } = require('pg');
const path = require('path');

const { ROLE_CATEGORIES } = require(path.join(
  __dirname,
  '..',
  'src',
  'recommendation',
  'candidates',
  'roles'
));

const ARGS = process.argv.slice(2);
if (ARGS.some((a) => a !== '--strict')) {
  console.error('usage: node scripts/check-og01-coverage.js [--strict]');
  process.exit(2);
}
const STRICT = ARGS.includes('--strict');

/**
 * Products DELIBERATELY left without any `component_assessment` row as
 * STEP-1 no-evidence fixtures (`database/seeds/001_minimal_builds.sql`
 * lines 452-455: "CASE1 (compact) has NO rows -> no-evidence"). Their lack of
 * research is an engine fixture, not an OG-01 research target, so they are
 * reported separately and never counted as open coverage. If seed 001 ever
 * changes, the gate surfaces the difference instead of hiding it.
 */
const DELIBERATE_NO_EVIDENCE = Object.freeze(['Seed NZXT H5 Flow Compact']);

/**
 * Canonical product-keyed category -> spec table mapping. Trusted static
 * identifiers, deliberately duplicated from candidates/loader.js (that module
 * does not export the map; the KEYS must stay identical to its
 * PRODUCT_KEYED_SPEC_BY_CATEGORY).
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

/** ACTIVE-only, mirroring the candidate loader's lifecycle policy. */
const PRODUCTS_SQL =
  Object.entries(PRODUCT_KEYED_SPEC_BY_CATEGORY)
    .map(
      ([category, table]) => `SELECT p.id::text AS product_id, p.name, '${category}' AS category
  FROM product p
  JOIN ${table} s ON s.product_id = p.id
 WHERE p.lifecycle_status = 'ACTIVE'`
    )
    .concat([
      `SELECT p.id::text AS product_id, p.name, 'GPU' AS category
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

const ASSESSMENTS_SQL = `SELECT product_id::text AS product_id,
       assessment_type::text AS assessment_type
  FROM component_assessment;`;

/** category -> Set(required types), from role_weights x ROLE_CATEGORIES. */
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

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL is not set in .env');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  let exitCode = 0;

  try {
    await client.connect();

    const models = await client.query(SCORING_MODELS_SQL);
    if (models.rows.length !== 1) {
      console.error(
        'ERROR: expected exactly ONE active scoring_model row, found ' +
          models.rows.length +
          ' (coverage cannot be derived unambiguously)'
      );
      process.exit(1);
    }
    const model = models.rows[0];
    if (model.role_weights === null || typeof model.role_weights !== 'object') {
      console.error(
        'ERROR: active scoring_model "' + model.name + '" has no configuration.role_weights'
      );
      process.exit(1);
    }

    const byCategory = requiredTypesByCategory(model.role_weights);
    if (byCategory.size === 0) {
      console.error('ERROR: role_weights yielded no roles - nothing to verify');
      process.exit(1);
    }

    const products = await client.query(PRODUCTS_SQL);
    const assessments = await client.query(ASSESSMENTS_SQL);

    const coveredByProduct = new Map();
    for (const row of assessments.rows) {
      const types = coveredByProduct.get(row.product_id) || new Set();
      types.add(row.assessment_type);
      coveredByProduct.set(row.product_id, types);
    }

    const noEvidence = [];
    const partial = [];
    const fixtures = [];
    let unmapped = 0;

    for (const product of products.rows) {
      const required = byCategory.get(product.category);
      if (!required || required.size === 0) {
        unmapped += 1;
        continue;
      }
      const covered = coveredByProduct.get(product.product_id) || new Set();
      const missing = [...required].filter((type) => !covered.has(type)).sort();
      if (missing.length === 0) continue;
      const entry = { name: product.name, category: product.category, missing };
      if (covered.size === 0) {
        if (DELIBERATE_NO_EVIDENCE.includes(product.name)) fixtures.push(entry);
        else noEvidence.push(entry);
      } else {
        partial.push(entry);
      }
    }

    const missingRows = noEvidence.reduce((sum, e) => sum + e.missing.length, 0);

    console.log('OG-01 coverage gate (read-only, DATABASE_URL)');
    console.log(
      'Active products: ' +
        products.rows.length +
        ' | assessment rows: ' +
        assessments.rows.length +
        ' | active scoring model: ' +
        model.name +
        ' ' +
        model.version
    );
    console.log(
      'Required types per role derived from configuration.role_weights + ROLE_CATEGORIES'
    );

    if (noEvidence.length > 0) {
      console.log(
        'FAIL fully-unassessed products: ' +
          noEvidence.length +
          ' (' +
          missingRows +
          ' research rows implied)'
      );
      for (const entry of noEvidence) {
        console.log(
          '  ' + entry.name + '  [' + entry.category + ']  missing=' + entry.missing.join(',')
        );
      }
    } else {
      console.log('PASS no fully-unassessed active product');
    }

    if (fixtures.length > 0) {
      console.log(
        'INFO deliberate no-evidence fixtures (not research targets): ' + fixtures.length
      );
      for (const entry of fixtures) {
        console.log('  ' + entry.name + '  [' + entry.category + ']');
      }
    }

    if (partial.length > 0) {
      console.log(
        (STRICT ? 'FAIL' : 'INFO') +
          ' partially-assessed products: ' +
          partial.length +
          (STRICT ? '' : ' (seed 001 fixtures are deliberately partial; --strict fails on these)')
      );
      for (const entry of partial) {
        console.log(
          '  ' + entry.name + '  [' + entry.category + ']  missing=' + entry.missing.join(',')
        );
      }
    } else {
      console.log('PASS every assessed product covers all its required types');
    }

    if (unmapped > 0) {
      console.log('INFO products with no role_weights category (not gated here): ' + unmapped);
    }

    const failed = noEvidence.length > 0 || (STRICT && partial.length > 0);
    console.log(
      'RESULT: ' +
        (failed ? 'FAIL - OG-01 research targets remain' : 'PASS - OG-01 coverage complete') +
        (STRICT ? ' (strict)' : '')
    );
    exitCode = failed ? 1 : 0;
    await client.end();
  } catch (err) {
    console.error('ERROR:', err.message);
    if (client) await client.end();
    process.exit(1);
  }

  process.exit(exitCode);
}

main();
