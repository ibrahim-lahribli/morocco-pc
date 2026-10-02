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
 * The derivation policy (category from spec-table presence, required types
 * from the active scoring model, deliberate fixtures) lives in
 * scripts/lib/og01-catalog.js - shared with og01-research-checklist.js and
 * measure-og01-reach.js. This file owns only the gate presentation: FAIL for
 * fully-unassessed products (= the remaining research targets, excluding
 * fixtures), INFO for partials (--strict turns REAL partials into a failure,
 * meaningful only after the full OG-01 deliverable has landed: batch 1 =
 * seeds/004a, batch 2 = seeds/004b).
 *
 * Two fixture classes come from scripts/lib/og01-catalog.js and are reported
 * separately from real research targets: DELIBERATE_NO_EVIDENCE (products with
 * NO assessment rows, exercising the whole-product no-evidence branch) and
 * DELIBERATE_PARTIAL (products with SOME of their required types, exercising
 * the missing-type branch of Decision 13 STEP 1). Neither counts as a gap and
 * neither fails --strict; OG-01 batch 2 was scoped to the 56 fully-unassessed
 * products and deliberately leaves the partial fixtures alone.
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

const { loadOg01Catalog, loadCoveredTypes } = require(path.join(
  __dirname,
  'lib',
  'og01-catalog'
));

const ARGS = process.argv.slice(2);
if (ARGS.some((a) => a !== '--strict')) {
  console.error('usage: node scripts/check-og01-coverage.js [--strict]');
  process.exit(2);
}
const STRICT = ARGS.includes('--strict');

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

    const catalog = await loadOg01Catalog(client);
    const assessmentRows = await loadCoveredTypes(client, catalog.products);

    const noEvidence = [];
    const partial = [];
    const partialFixtures = [];
    const fixtures = [];
    let unmapped = 0;

    for (const product of catalog.products) {
      const required = catalog.requiredByCategory.get(product.category);
      if (!required || required.size === 0) {
        unmapped += 1;
        continue;
      }
      const covered = product.coveredTypes;
      const missing = [...required].filter((type) => !covered.has(type)).sort();
      if (missing.length === 0) continue;
      const entry = { name: product.name, category: product.category, missing };
      if (covered.size === 0) {
        if (catalog.fixtures.has(product.name)) fixtures.push(entry);
        else noEvidence.push(entry);
      } else if (catalog.partialFixtures.has(product.name)) {
        // Deliberate seed-001 fixture (DELIBERATE_PARTIAL): a type with no row
        // at all is the missing-type branch of Decision 13 STEP 1. Reported,
        // never a research target, never a --strict failure.
        partialFixtures.push(entry);
      } else {
        partial.push(entry);
      }
    }

    const missingRows = noEvidence.reduce((sum, e) => sum + e.missing.length, 0);

    // Total physical rows (the old gate's "assessment rows" figure; the
    // seed-001 shadow fixture means this exceeds the distinct-pair count).
    const totalAssessmentRows = await client.query(
      'SELECT count(*)::int AS n FROM component_assessment'
    );

    console.log('OG-01 coverage gate (read-only, DATABASE_URL)');
    console.log(
      'Active products: ' +
        catalog.products.length +
        ' | assessment rows: ' +
        totalAssessmentRows.rows[0].n +
        ' | active scoring model: ' +
        catalog.model.name +
        ' ' +
        catalog.model.version
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
          ' partially-assessed products (research targets): ' +
          partial.length +
          (STRICT ? '' : ' (--strict fails on these)')
      );
      for (const entry of partial) {
        console.log(
          '  ' + entry.name + '  [' + entry.category + ']  missing=' + entry.missing.join(',')
        );
      }
    } else {
      console.log(
        'PASS every non-fixture assessed product covers all its required types'
      );
    }

    if (unmapped > 0) {
      console.log('INFO products with no role_weights category (not gated here): ' + unmapped);
    }

    if (partialFixtures.length > 0) {
      console.log(
        'INFO deliberate partial fixtures (missing-type branch kept live, not research targets): ' +
          partialFixtures.length
      );
      for (const entry of partialFixtures) {
        console.log('  ' + entry.name + '  [' + entry.category + ']  missing=' + entry.missing.join(','));
      }
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
