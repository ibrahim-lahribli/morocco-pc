'use strict';

/**
 * Audit A5 + A9 tooling: generate docs/SCHEMA_REFERENCE.md and
 * docs/DATA_STATE.md from the live database (read-only).
 *
 * Reads information_schema / pg_catalog / row counts via DATABASE_URL and
 * emits deterministic Markdown (every query ORDER BYs its output, so two
 * consecutive runs against an unchanged database are byte-identical).
 *
 * Usage:
 *   node scripts/gen-schema-reference.js            # generate both files
 *   node scripts/gen-schema-reference.js --check    # exit 1 if either file
 *                                                   # is stale vs a regen
 *
 * Both output files are GENERATED — never edit by hand. Structure facts
 * (columns, constraints, enums) are authoritative as of generation; DATA_STATE
 * figures are instance-specific snapshots and must never be cited as permanent
 * claims (see AGENTS.md section 5 on determinism and the retention UUID gap).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ARGS = process.argv.slice(2);
const CHECK = ARGS.includes('--check');
if (ARGS.some((a) => a !== '--check')) {
  console.error('usage: node scripts/gen-schema-reference.js [--check]');
  process.exit(2);
}

const SCHEMA_REF = path.join(ROOT, 'docs', 'SCHEMA_REFERENCE.md');
const DATA_STATE = path.join(ROOT, 'docs', 'DATA_STATE.md');

const DIGEST_MARKER = 'schema-digest:';

const GENERATED_BANNER =
  '<!-- GENERATED FILE — do not edit by hand. Regenerate with `npm run gen:schema` ' +
  '(node scripts/gen-schema-reference.js). `--check` exits non-zero when this file is stale. -->';

async function main() {
  require('dotenv').config();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL is not set (.env)');
    process.exit(1);
  }
  const { Client } = require('pg');
  const client = new Client({ connectionString });
  try {
    await client.connect();
  } catch (err) {
    console.error('ERROR: cannot connect: ' + err.message);
    process.exit(1);
  }

  try {
    const schemaMd = await buildSchemaReference(client);
    const stateMd = await buildDataState(client);
    writeIfChanged(SCHEMA_REF, schemaMd, 'docs/SCHEMA_REFERENCE.md');
    writeIfChanged(DATA_STATE, stateMd, 'docs/DATA_STATE.md');
  } finally {
    await client.end().catch(() => {});
  }
}

function writeIfChanged(file, content, label) {
  if (CHECK) {
    let current = null;
    try {
      current = fs.readFileSync(file, 'utf8');
    } catch (_err) {
      console.error('STALE: ' + label + ' is missing; run `npm run gen:schema`');
      process.exit(1);
    }
    if (current !== content) {
      console.error('STALE: ' + label + ' differs from a fresh generation; run `npm run gen:schema`');
      process.exit(1);
    }
    console.log('OK: ' + label + ' is up to date');
    return;
  }
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  fs.writeFileSync(file, content, 'utf8');
  console.log((prev === content ? 'UNCHANGED: ' : 'WROTE: ') + label);
}

function q(text) {
  return '`' + text + '`';
}

function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/\|/g, '\\|');
}

// ---------------------------------------------------------------- schema ref

// MUST stay in sync with the digest query in scripts/verify-docs.js
// (checkLive, 'schema-digest' check): same rows, same hash, same truncation.
function computeSchemaDigest(rows) {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256');
  for (const r of rows) hash.update(r.kind + '|' + r.a + '|' + r.b + '\n');
  return hash.digest('hex').slice(0, 16);
}

async function buildSchemaReference(client) {
  const out = [];
  out.push('# Schema Reference (generated)');
  out.push('');
  out.push(GENERATED_BANNER);
  out.push('');
  out.push('Column-level truth for every table in the `public` schema, generated from the');
  out.push('live database (`information_schema` / `pg_catalog`). Per `AGENTS.md` section 9,');
  out.push('`database/migrations/*.sql` remains the authoritative source; this file is a');
  out.push('generated lookup so "does this column exist?" never requires reading 11 SQL files');
  out.push('(the question that produced audit finding D2).');
  out.push('');

  // Digest of the schema structure this file renders. verify-docs --live
  // recomputes it from the live DB and fails when it no longer matches, which
  // gates this file in CI the same way gen-decision-index --check gates the
  // decision index. Must mirror the query in verify-docs.js exactly.
  const digestRows = await client.query(
    "SELECT 'col' AS kind, table_name AS a, column_name || ':' || data_type || ':' || is_nullable AS b" +
    " FROM information_schema.columns WHERE table_schema = 'public'" +
    ' UNION ALL ' +
    "SELECT 'enum' AS kind, t.typname AS a, e.enumlabel AS b" +
    ' FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid' +
    " JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'" +
    ' ORDER BY kind, a, b'
  );
  out.push('<!-- ' + DIGEST_MARKER + ' ' + computeSchemaDigest(digestRows.rows) + ' -->');
  out.push('');

  // Tables (base tables only; skip views) in dependency-free name order.
  const tables = await client.query(
    "SELECT table_name FROM information_schema.tables" +
    " WHERE table_schema = 'public' AND table_type = 'BASE TABLE'" +
    ' ORDER BY table_name'
  );
  const tableNames = tables.rows.map((r) => r.table_name);

  // Enum vocabularies.
  const enums = await client.query(
    "SELECT t.typname, e.enumlabel AS label, e.enumsortorder AS ord" +
    ' FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid' +
    " JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'" +
    ' ORDER BY t.typname, e.enumsortorder'
  );
  const enumMap = new Map();
  for (const r of enums.rows) {
    if (!enumMap.has(r.typname)) enumMap.set(r.typname, []);
    enumMap.get(r.typname).push(r.label);
  }

  out.push('## Enum vocabularies (' + enumMap.size + ')');
  out.push('');
  out.push('| Enum | Values |');
  out.push('|---|---|');
  for (const [typname, labels] of enumMap) {
    out.push('| ' + q(typname) + ' | ' + labels.map(esc).join(' \\| ') + ' |');
  }
  out.push('');
  out.push('## Tables (' + tableNames.length + ')');
  out.push('');

  for (const t of tableNames) {
    const cols = await client.query(
      'SELECT column_name, data_type, is_nullable, column_default,' +
      " coalesce(character_maximum_length::text, '') AS max_len," +
      " coalesce(numeric_precision::text, '') AS num_prec," +
      " coalesce(numeric_scale::text, '') AS num_scale" +
      ' FROM information_schema.columns' +
      " WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
      [t]
    );
    const pk = await client.query(
      'SELECT kcu.column_name' +
      ' FROM information_schema.table_constraints tc' +
      ' JOIN information_schema.key_column_usage kcu' +
      ' ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema' +
      " WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'" +
      ' ORDER BY kcu.ordinal_position',
      [t]
    );
    const fks = await client.query(
      "SELECT tc.constraint_name, kcu.column_name," +
      " ccu.table_name AS foreign_table, ccu.column_name AS foreign_column," +
      ' rc.delete_rule' +
      ' FROM information_schema.table_constraints tc' +
      ' JOIN information_schema.key_column_usage kcu' +
      ' ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema' +
      ' JOIN information_schema.constraint_column_usage ccu' +
      ' ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema' +
      ' JOIN information_schema.referential_constraints rc' +
      ' ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema' +
      " WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'FOREIGN KEY'" +
      ' ORDER BY tc.constraint_name, kcu.ordinal_position',
      [t]
    );
    const checks = await client.query(
      "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint" +
      " WHERE contype = 'c' AND conrelid = $1::regclass ORDER BY conname",
      ['public.' + t]
    );
    const uniques = await client.query(
      "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint" +
      " WHERE contype = 'u' AND conrelid = $1::regclass ORDER BY conname",
      ['public.' + t]
    );
    const indexes = await client.query(
      "SELECT indexname, indexdef FROM pg_indexes" +
      " WHERE schemaname = 'public' AND tablename = $1 ORDER BY indexname",
      [t]
    );

    out.push('### ' + q(t) + ' (' + cols.rows.length + ' columns)');
    out.push('');
    out.push('| Column | Type | Null | Default |');
    out.push('|---|---|---|---|');
    const pkCols = new Set(pk.rows.map((r) => r.column_name));
    for (const c of cols.rows) {
      let type = c.data_type;
      if (c.data_type === 'character varying' && c.max_len) type += '(' + c.max_len + ')';
      if (c.data_type === 'numeric' && c.num_prec) type += '(' + c.num_prec + ',' + c.num_scale + ')';
      const name = pkCols.has(c.column_name) ? q(c.column_name) + ' 🔑' : q(c.column_name);
      out.push('| ' + name + ' | ' + esc(type) + ' | ' + (c.is_nullable === 'YES' ? 'YES' : 'NO') +
        ' | ' + esc(c.column_default || '') + ' |');
    }
    if (fks.rows.length > 0) {
      out.push('');
      out.push('**Foreign keys:** ' + fks.rows.map((r) =>
        q(r.constraint_name) + ': ' + q(r.column_name) + ' → ' + q(r.foreign_table + '.' + r.foreign_column) +
        ' (ON DELETE ' + r.delete_rule + ')').join(' · '));
    }
    if (checks.rows.length > 0) {
      out.push('');
      out.push('**CHECK constraints:**');
      out.push('');
      for (const r of checks.rows) {
        out.push('- ' + q(r.conname) + ' — ' + esc(r.def));
      }
    }
    if (uniques.rows.length > 0) {
      out.push('');
      out.push('**UNIQUE constraints:** ' + uniques.rows.map((r) => q(r.conname)).join(' · '));
    }
    // Non-constraint indexes (constraint-backed ones are implied by the above).
    const constraintIndexNames = new Set(
      [...pk.rows.map((r) => r.constraint_name),
        ...uniques.rows.map((r) => r.constraint_name),
        ...fks.rows.map((r) => r.constraint_name)]
    );
    const plain = indexes.rows.filter((r) => !constraintIndexNames.has(r.indexname));
    if (plain.length > 0) {
      out.push('');
      out.push('**Indexes:** ' + plain.map((r) => q(r.indexname)).join(' · '));
    }
    out.push('');
  }
  out.push('---');
  out.push('');
  out.push('*Generated from the live database; regenerating against a schema that changed');
  out.push('will update this file. Keep hand-written schema claims in the migrations.*');
  out.push('');
  return out.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- data state

async function buildDataState(client) {
  const out = [];
  out.push('# Data State (generated)');
  out.push('');
  out.push(GENERATED_BANNER);
  out.push('');
  out.push('Snapshot of the live database contents at generation time. **Every figure here');
  out.push('is instance-specific** — it describes this database at this moment and must never');
  out.push('be cited as a permanent claim in hand-written docs (cite `CONTEXT.md` status');
  out.push('sections instead, which the audit workflow keeps reconciled).');
  out.push('');
  out.push('Retention warning (AGENTS.md section 5): retention ties fall through to random');
  out.push('`product.id` UUIDs, so *which* tied products reach a build is not stable across a');
  out.push('database reset — reach figures below are one instance\'s draw, not a property of');
  out.push('the catalog.');
  out.push('');

  const counts = await client.query(
    "SELECT c.relname AS table_name, c.reltuples::bigint AS est" +
    " FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace" +
    " WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname"
  );
  // reltuples is an estimate; get exact counts for every table (cheap at this scale).
  const exact = {};
  for (const r of counts.rows) {
    const res = await client.query('SELECT count(*)::int AS n FROM ' + JSON.stringify(r.table_name).replace(/"/g, '"'));
    exact[r.table_name] = res.rows[0].n;
  }
  const names = Object.keys(exact);

  out.push('## Row counts (' + names.length + ' tables)');
  out.push('');
  out.push('| Table | Rows |');
  out.push('|---|---|');
  for (const n of names) {
    out.push('| ' + q(n) + ' | ' + exact[n] + ' |');
  }

  const layer1 = ['manufacturer', 'socket', 'platform', 'memory_type', 'product_family', 'product', 'product_variant'];
  const layer2 = ['benchmark_source', 'benchmark', 'benchmark_result', 'component_assessment', 'scoring_model'];
  const layer3 = ['store', 'store_offer', 'price_history'];
  const layer4 = ['recommendation_profile', 'recommendation_query', 'recommendation_result', 'build_candidate', 'build_component'];

  const sum = (list) => list.reduce((acc, t) => acc + (exact[t] || 0), 0);
  out.push('');
  out.push('## Layer summary');
  out.push('');
  out.push('| Layer | Tables | Rows |');
  out.push('|---|---|---|');
  out.push('| 1 — Catalog/Hardware | ' + layer1.length + ' | ' + sum(layer1) + ' |');
  out.push('| 2 — Performance/Assessment | ' + layer2.length + ' | ' + sum(layer2) + ' |');
  out.push('| 3 — Market | ' + layer3.length + ' | ' + sum(layer3) + ' |');
  out.push('| 4 — Recommendation | ' + layer4.length + ' | ' + sum(layer4) + ' |');

  const cov = await client.query(
    'SELECT' +
      ' (SELECT count(*)::int FROM product) AS products,' +
      ' (SELECT count(*)::int FROM product_variant) AS variants,' +
      ' (SELECT count(DISTINCT product_id)::int FROM component_assessment) AS assessed_products,' +
      ' (SELECT count(*)::int FROM component_assessment) AS assessments,' +
      ' (SELECT count(*)::int FROM store_offer) AS offers,' +
      ' (SELECT min(last_checked_at)::text FROM store_offer) AS oldest_offer,' +
      ' (SELECT max(last_checked_at)::text FROM store_offer) AS newest_offer,' +
      ' (SELECT count(*)::int FROM gpu_board_spec WHERE width_slots IS NULL OR height_mm IS NULL) AS gpu_null_dims,' +
      ' (SELECT count(*)::int FROM psu_spec WHERE connector_12vhpwr IS NULL) AS psu_null_12vhpwr'
  );
  const c = cov.rows[0];
  out.push('');
  out.push('## Coverage');
  out.push('');
  out.push('- Products: ' + c.products + ' (' + c.variants + ' variants)');
  out.push('- Assessed products: ' + c.assessed_products + ' of ' + c.products +
    ' (' + c.assessments + ' assessment rows) — the rest score the flat no-evidence baseline (OG-01)');
  out.push('- Offers: ' + c.offers + ' (checked ' + (c.oldest_offer || 'n/a') + ' … ' + (c.newest_offer || 'n/a') + ')');
  out.push('- GPU variants with NULL width_slots/height_mm: ' + c.gpu_null_dims + ' (OG-07)');
  out.push('- PSUs with NULL connector_12vhpwr: ' + c.psu_null_12vhpwr + ' (OG-08)');
  const l4 = sum(layer4);
  out.push('- Layer 4 emptiness: ' + (l4 === 0 ? 'ALL five tables 0 rows (write path proven only on the test branch)' : l4 + ' rows present'));

  out.push('');
  out.push('---');
  out.push('');
  out.push('*Generated from the live database. Regenerate after any seed or migration:*');
  out.push('`npm run gen:schema`.');
  out.push('');
  return out.join('\r\n') + '\r\n';
}

main().catch((err) => {
  console.error('ERROR: ' + err.message);
  process.exit(1);
});
