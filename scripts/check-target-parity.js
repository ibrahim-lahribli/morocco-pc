'use strict';

/**
 * scripts/check-target-parity.js - prove a replayed target is the SAME catalog
 * (Platform P1 Sprint 1 Step 6).
 *
 *   node scripts/check-target-parity.js --a="postgres://..." --b="postgres://..."
 *   node scripts/check-target-parity.js --a=env:DATABASE_URL --b=env:TARGET_DATABASE_URL
 *
 * READ-ONLY. Two SELECT-only snapshots are compared; nothing is created, written
 * or dropped, and no URL, host, user or password is printed - a target is named
 * by its endpoint id (scripts/lib/db-url.js `describeTarget`), which is what the
 * harness lines already print.
 *
 * Exit codes:
 *   0  every check MATCHED
 *   1  a DIFF, a connection failure, or a table that could not be read
 *   2  usage error (missing/blank `--a` or `--b`, unknown flag)
 *
 * What is compared, and why each part is needed:
 *   - `schema_migrations`: the ledger IS the record of which migrations ran, so
 *     a replayed target that is missing a file is not "the same schema" however
 *     identical its columns look today.
 *   - the `public` table list and the full column/enum shape: a column with the
 *     same name and a different type or nullability changes behaviour, and a
 *     name-only comparison would pass it (the weakness C-30 recorded for schema
 *     diffs).
 *   - row counts of the engine's catalog tables: a seed file that silently wrote
 *     nothing leaves a smaller catalog, and every later latency number would be
 *     measuring less work.
 *   - the identity of every `scoring_model` row and whether it is ACTIVE: two
 *     branches can agree on the row COUNT while serving different scores, so
 *     parity of counts is not parity of behaviour. The active model is the fact
 *     a release check is actually asked to confirm.
 *   - row counts of the Layer 4 tables: the new target must start EMPTY there.
 *     A non-zero count is not automatically fatal, but it is a difference an
 *     operator must explain before calling the target "the same".
 *
 * The comparison logic lives in scripts/lib/target-parity.js, which has no SQL
 * and is unit-tested; this file is the I/O half.
 */

require('dotenv').config();

const { Client } = require('pg');
const { describeTarget } = require('./lib/db-url');
const { PARITY_TABLES, shortDigest, compareSnapshots } = require('./lib/target-parity');

const USAGE = 'usage: node scripts/check-target-parity.js --a=<url|env:NAME> --b=<url|env:NAME> [--help]';

/** A value that names an environment variable instead of carrying a URL. */
function resolveArgValue(raw) {
  if (raw.startsWith('env:')) {
    const name = raw.slice('env:'.length);
    if (name.trim() === '') throw new Error('env: expects a variable name');
    const value = process.env[name];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error('environment variable ' + name + ' is not set');
    }
    return value.trim();
  }
  return raw;
}

/**
 * Parse argv. `--a`/`--b` take the `=<value>` form only (the repo's rule for
 * secret-bearing flags: a space form leaks into shell history differently and
 * is easy to mis-pair with the next flag).
 *
 * @param {string[]} argv process.argv.slice(2)
 * @returns {{help: boolean, a?: string, b?: string}}
 */
function parseArgs(argv) {
  const parsed = { help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg.startsWith('--a=')) {
      parsed.a = arg.slice('--a='.length);
      continue;
    }
    if (arg.startsWith('--b=')) {
      parsed.b = arg.slice('--b='.length);
      continue;
    }
    throw new Error('unknown argument: ' + arg);
  }
  return parsed;
}

/** One client, read-only settings, a timeout so a bad host fails fast. */
function createClient(url) {
  return new Client({
    connectionString: url,
    connectionTimeoutMillis: 15000,
    statement_timeout: 15000,
    application_name: 'morocco-pc-target-parity',
  });
}

/** Ledger filenames, or null when the database predates the ledger. */
async function readLedger(client) {
  const reg = await client.query("SELECT to_regclass('public.schema_migrations') AS reg");
  if (reg.rows[0].reg === null) return null;
  const result = await client.query('SELECT filename FROM schema_migrations ORDER BY filename ASC');
  return result.rows.map((row) => row.filename);
}

async function readTables(client) {
  const result = await client.query(
    "SELECT table_name FROM information_schema.tables" +
      " WHERE table_schema = 'public' AND table_type = 'BASE TABLE'" +
      ' ORDER BY table_name ASC'
  );
  return result.rows.map((row) => row.table_name);
}

/**
 * Column + enum shape, byte-identical to the derivation `gen-schema-reference.js`
 * and `verify-docs.js --live` digest. Kept as ROWS here so a difference can be
 * named; the 16-hex digest is only printed.
 */
async function readShape(client) {
  const result = await client.query(
    "SELECT 'col' AS kind, table_name AS a, column_name || ':' || data_type || ':' || is_nullable AS b" +
      " FROM information_schema.columns WHERE table_schema = 'public'" +
      ' UNION ALL ' +
      "SELECT 'enum' AS kind, t.typname AS a, e.enumlabel AS b" +
      ' FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid' +
      " JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'" +
      ' ORDER BY kind, a, b'
  );
  return result.rows.map((row) => row.kind + '|' + row.a + '|' + row.b);
}

/**
 * Every scoring model as `name@version|active|inactive`, name/version order, or
 * null when the table predates `008`.
 *
 * The row COUNT alone is not enough (see the header): a database with one
 * active model and a database with one active model can still score the same
 * build differently. Reading the identity and the active flag is what turns
 * "same row count" into "same behaviour".
 */
async function readModels(client) {
  const reg = await client.query("SELECT to_regclass('public.scoring_model') AS reg");
  if (reg.rows[0].reg === null) return null;
  const result = await client.query(
    'SELECT name, version, is_active FROM scoring_model ORDER BY name ASC, version ASC'
  );
  return result.rows.map(
    (row) => row.name + '@' + row.version + '|' + (row.is_active ? 'active' : 'inactive')
  );
}

/**
 * Row counts for the fixed table list.
 *
 * `null` means the table DOES NOT EXIST on that target (PostgreSQL `42P01`),
 * which is a legitimate state for a database below a migration and is compared
 * as one. Every other error - a permission denial, a timeout - is rethrown: a
 * gate that cannot read a table has not proved anything about it, and treating
 * a `42501` as "absent" would let a role without SELECT pass as parity.
 */
async function readCounts(client) {
  const counts = {};
  for (const table of PARITY_TABLES) {
    try {
      const result = await client.query('SELECT count(*)::int AS n FROM "' + table + '"');
      counts[table] = result.rows[0].n;
    } catch (error) {
      if (error && error.code === '42P01') {
        counts[table] = null;
        continue;
      }
      throw error;
    }
  }
  return counts;
}

async function readSnapshot(url, label) {
  const client = createClient(url);
  try {
    await client.connect();
    const { endpointId, pooled, database } = describeTarget(url);
    const snapshot = {
      label: label + ': ' + endpointId + (pooled ? ' (pooled)' : '') + ' / ' + database,
      ledger: await readLedger(client),
      tables: await readTables(client),
      shape: await readShape(client),
      counts: await readCounts(client),
      models: await readModels(client),
    };
    return snapshot;
  } finally {
    await client.end();
  }
}

function printReport(a, b, comparison) {
  const width = 28;
  console.log('A  ' + a.label);
  console.log('B  ' + b.label);  const tail = (snapshot) => {
    if (snapshot.ledger === null) return 'absent';
    if (snapshot.ledger.length === 0) return '0 files, empty';
    return snapshot.ledger.length + ' files, tail ' + snapshot.ledger[snapshot.ledger.length - 1];
  };
  console.log('   ledger ' + tail(a) + '  vs  ' + tail(b));
  const activeModels = (snapshot) => {
    if (!Array.isArray(snapshot.models)) return 'table absent';
    const active = snapshot.models.filter((row) => row.endsWith('|active'));
    return active.length === 0 ? 'none active' : active.join(', ');
  };
  console.log('   models ' + activeModels(a) + '  vs  ' + activeModels(b));
  console.log('   shape  ' + shortDigest(a.shape) + '  vs  ' + shortDigest(b.shape));
  console.log('');
  console.log('check'.padEnd(width) + 'status  detail');
  for (const row of comparison.rows) {
    console.log(row.check.padEnd(width) + row.status.padEnd(8) + row.detail);
  }
  console.log('');
  console.log(comparison.ok ? 'RESULT: MATCH' : 'RESULT: DIFF');
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error('ERROR: ' + error.message);
    console.error(USAGE);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    console.log('Read-only. Exits 0 when every check matches, 1 on any difference, 2 on usage.');
    return 0;
  }
  if (typeof args.a !== 'string' || args.a.trim() === '' || typeof args.b !== 'string' || args.b.trim() === '') {
    console.error('ERROR: --a=<url|env:NAME> and --b=<url|env:NAME> are both required');
    console.error(USAGE);
    return 2;
  }

  // Argument resolution is a USAGE concern (an unset `env:NAME` is a typo, not
  // a database result), so it exits 2 before anything connects.
  let urlA;
  let urlB;
  try {
    urlA = resolveArgValue(args.a);
    urlB = resolveArgValue(args.b);
  } catch (error) {
    console.error('ERROR: ' + error.message);
    console.error(USAGE);
    return 2;
  }

  let a;
  let b;
  try {
    a = await readSnapshot(urlA, 'A');
    b = await readSnapshot(urlB, 'B');
  } catch (error) {
    // The guard messages and connection errors never carry a credential; the
    // URL is not interpolated here on purpose.
    console.error('ERROR: ' + (error && error.message ? error.message : String(error)));
    return 1;
  }

  const comparison = compareSnapshots(a, b);
  printReport(a, b, comparison);
  return comparison.ok ? 0 : 1;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error('ERROR: ' + (error && error.message ? error.message : String(error)));
      process.exitCode = 1;
    }
  );
}

module.exports = { parseArgs, resolveArgValue, readSnapshot, main, USAGE };
