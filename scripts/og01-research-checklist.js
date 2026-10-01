'use strict';

/**
 * OG-01 research-checklist generator (read-only; plan section 5.1).
 *
 * Emits the batch-2 research worksheet: one line per product still missing
 * required assessment types, with its category, the missing types, the live
 * offer price range (VALUE scores are relative to live prices), a blank URL
 * column for provenance, and blank score columns. No row may be skipped
 * silently (plan rule: no URL, no row).
 *
 * Consumers of the same derivation: scripts/lib/og01-catalog.js (single
 * owner), scripts/check-og01-coverage.js (the gate). The checklist is the
 * human-facing counterpart of the gate: the gate says WHAT remains, the
 * checklist is WHERE the researcher writes.
 *
 * Deliberate no-evidence fixtures (seed 001) are excluded - they are not
 * research targets (see og01-catalog.js DELIBERATE_NO_EVIDENCE). Seed 001's
 * PARTIAL fixtures (some types deliberately missing for STEP-1 branch
 * coverage) ARE listed - completing them is real batch-2 work; the gate
 * reports the same set as INFO-partials. This is why the checklist can list
 * more products than the gate's FAIL line (56 fully-unassessed + 14 partials
 * = 70 worksheet rows as of 2026-10-01).
 *
 * Read-only: SELECT-only, reads DATABASE_URL. Safe against the shared DB.
 *
 * Usage:
 *   node scripts/og01-research-checklist.js                 # markdown to stdout
 *   node scripts/og01-research-checklist.js --out <file>    # also write the file
 *   node scripts/og01-research-checklist.js --csv           # CSV instead of markdown
 * Exit codes: 0 = checklist generated; 1 = derivation error; 2 = usage error.
 */

require('dotenv').config();
const fs = require('fs');
const { Client } = require('pg');
const path = require('path');

const { loadOg01Catalog, loadCoveredTypes } = require(path.join(
  __dirname,
  'lib',
  'og01-catalog'
));

const ARGS = process.argv.slice(2);
const CSV = ARGS.includes('--csv');
const OUT_IDX = ARGS.indexOf('--out');
const OUT_FILE = OUT_IDX !== -1 ? ARGS[OUT_IDX + 1] : null;
if (ARGS.some((a) => a !== '--csv' && a !== '--out' && a !== OUT_FILE)) {
  console.error('usage: node scripts/og01-research-checklist.js [--csv] [--out <file>]');
  process.exit(2);
}
if (OUT_IDX !== -1 && (!OUT_FILE || OUT_FILE.startsWith('--'))) {
  console.error('usage: --out requires a file path');
  process.exit(2);
}

function missingTypes(product, requiredByCategory) {
  const required = requiredByCategory.get(product.category);
  if (!required) return [];
  return [...required].filter((type) => !product.coveredTypes.has(type)).sort();
}

function priceRange(product) {
  if (product.offerCount === 0) return 'NO OFFER - VALUE not scoreable';
  if (product.minPrice === product.maxPrice) return product.minPrice + ' MAD';
  return product.minPrice + '-' + product.maxPrice + ' MAD';
}

function markdown(catalog, targets) {
  const lines = [];
  lines.push('# OG-01 batch-2 research checklist (generated ' + new Date().toISOString().slice(0, 10) + ')');
  lines.push('');
  lines.push('Source: live DB (scoring model ' + catalog.model.name + ' ' + catalog.model.version + ').');
  lines.push('Derived by scripts/og01-research-checklist.js from scripts/lib/og01-catalog.js - regenerate, never hand-edit.');
  lines.push('Rules: docs/OG-01_ASSESSMENT_RESEARCH_PLAN.md sections 2 (hard rules), 3 (sourcing), 4 (rubric).');
  lines.push('No URL, no row (plan section 2.6). Honest NULL beats a guessed number (section 2.7).');
  lines.push('');
  lines.push('Targets: ' + targets.length + ' products, ' + targets.reduce((s, t) => s + t.missing.length, 0) + ' rows implied.');
  lines.push('');
  lines.push('| Product | Category | Missing types | Live offer (MAD) | Source URL(s) | Scores (P/Q/V/U/T/E) | Notes |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const t of targets) {
    lines.push(
      '| ' + t.name + ' | ' + t.category + ' | ' + t.missing.join(', ') + ' | ' + t.price + ' | | | |'
    );
  }
  lines.push('');
  return lines.join('\n');
}

function csv(targets) {
  const rows = ['product,category,missing_types,offer_price_mad,source_urls,scores,notes'];
  for (const t of targets) {
    const esc = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    rows.push(
      [t.name, t.category, t.missing.join(' '), t.price, '', '', ''].map(esc).join(',')
    );
  }
  return rows.join('\n') + '\n';
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL is not set in .env');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  try {
    await client.connect();
    const catalog = await loadOg01Catalog(client);
    await loadCoveredTypes(client, catalog.products);

    const targets = [];
    for (const product of catalog.products) {
      if (catalog.fixtures.has(product.name)) continue;
      const missing = missingTypes(product, catalog.requiredByCategory);
      if (missing.length === 0) continue;
      targets.push({
        name: product.name,
        category: product.category,
        missing,
        price: priceRange(product),
      });
    }

    const body = (CSV ? csv(targets) : markdown(catalog, targets)).replace(/\n/g, '\r\n');
    if (OUT_FILE) {
      // Repo CRLF convention for docs/** (AGENTS section 8).
      fs.writeFileSync(OUT_FILE, body);
      console.log('WROTE: ' + OUT_FILE + ' (' + targets.length + ' target products)');
    } else {
      process.stdout.write(body);
    }
    await client.end();
  } catch (err) {
    console.error('ERROR:', err.message);
    if (client) await client.end();
    process.exit(1);
  }
}

main();
