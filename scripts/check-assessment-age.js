#!/usr/bin/env node
'use strict';

/**
 * Assessment-age gate (READ-ONLY).
 *
 *   node scripts/check-assessment-age.js
 *   node scripts/check-assessment-age.js --target=env:TARGET_DATABASE_URL
 *   node scripts/check-assessment-age.js --due-days=120 --overdue-days=240 --strict
 *
 * WHY: `launch-v2@2.5.0` sets `staleness.per_day_decay: 0` (Decision 66 draft),
 * and `launch-v2@2.4.0`'s `{ max_age_days: 180, per_day_decay: 0.005 }` is the
 * block it changes. With decay off, a score no longer falls as the corpus ages,
 * so nothing in the served number says the evidence is old. This report is that
 * signal: per assessment type and per cohort date, how many rows are older than
 * `--due-days` and `--overdue-days`, plus the oldest rows themselves.
 *
 * It never re-dates, rewrites or deletes a row, and its band is not a verdict on
 * correctness — only on how long it has been since the evidence was collected.
 *
 * Band vocabulary (boundary EXCLUSIVE: a row exactly `due-days` old is not due):
 *   OK       no row older than --due-days
 *   DUE      some row older than --due-days, none older than --overdue-days
 *   OVERDUE  some row older than --overdue-days
 *
 * Exit codes: 0 by default for every band; with `--strict`, 1 when the band is
 * OVERDUE (DUE stays 0 — it is the warning band, not a failure). 2 = usage
 * error, including --help. 1 without `--strict` means the corpus could not be
 * read.
 *
 * Read-only: one SELECT. `--target` takes a variable NAME (`env:NAME`, equals
 * form mandatory) and the connection string is never printed — the label carries
 * the `db:<12 hex>` digest instead.
 */

require('dotenv').config();
const { Client } = require('pg');

const { applyLogTarget } = require('./lib/migrations');
const {
  DEFAULTS,
  evaluateAssessmentAge,
  exitCodeFor,
  formatReport,
} = require('./lib/assessment-age');

const DEFAULT_TARGET_ENV = 'DATABASE_URL';

/** One read: every assessment row, with the product name for the oldest list. */
const AGE_ROWS_SQL = [
  'SELECT a.assessment_type::text AS assessment_type,',
  '       a.assessed_at,',
  '       a.score::float8 AS score,',
  '       a.confidence::text AS confidence,',
  '       p.name AS product_name',
  '  FROM component_assessment a',
  '  JOIN product p ON p.id = a.product_id',
  ' ORDER BY a.assessed_at ASC, a.id ASC;',
].join('\n');

const USAGE = [
  'usage: node scripts/check-assessment-age.js [--target=env:NAME] [--due-days=N]',
  '       [--overdue-days=N] [--oldest=N] [--strict]',
  '',
  '  --target=env:NAME    environment variable holding the connection string',
  '                       (default env:' + DEFAULT_TARGET_ENV + ')',
  '  --due-days=N         age at which a row is DUE (default ' + DEFAULTS.dueDays + ')',
  '  --overdue-days=N     age at which a row is OVERDUE (default ' + DEFAULTS.overdueDays + ')',
  '  --oldest=N           how many oldest rows to list (default ' + DEFAULTS.oldest + ')',
  '  --strict             exit 1 on OVERDUE (DUE stays 0)',
  '',
  'Read-only. The band is about AGE, never about whether a score is still true.',
].join('\n');

/**
 * Parse argv. Equals form only for every value, same as the other read-only
 * gates: a space form leaves the value as an unknown argument rather than
 * silently falling back to a default.
 *
 * @param {string[]} argv
 * @returns {{help: boolean, targetEnv: string, dueDays: number, overdueDays: number,
 *   oldest: number, strict: boolean}}
 * @throws {Error} with `usage: true` on anything unrecognised
 */
function parseArgs(argv) {
  const options = {
    help: false,
    targetEnv: DEFAULT_TARGET_ENV,
    dueDays: DEFAULTS.dueDays,
    overdueDays: DEFAULTS.overdueDays,
    oldest: DEFAULTS.oldest,
    strict: false,
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg.startsWith('--target=env:')) {
      const name = arg.slice('--target=env:'.length).trim();
      if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
        throw Object.assign(new Error('--target must name an environment variable: --target=env:NAME'), { usage: true });
      }
      options.targetEnv = name;
      continue;
    }
    if (arg.startsWith('--due-days=')) {
      options.dueDays = parseCount(arg.slice('--due-days='.length), '--due-days');
      continue;
    }
    if (arg.startsWith('--overdue-days=')) {
      options.overdueDays = parseCount(arg.slice('--overdue-days='.length), '--overdue-days');
      continue;
    }
    if (arg.startsWith('--oldest=')) {
      options.oldest = parseCount(arg.slice('--oldest='.length), '--oldest');
      continue;
    }
    throw Object.assign(new Error('unknown argument: ' + arg), { usage: true });
  }
  return options;
}

function parseCount(raw, flag) {
  if (!/^\d+$/.test(raw)) {
    throw Object.assign(new Error(flag + ' expects a non-negative integer'), { usage: true });
  }
  return parseInt(raw, 10);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error(USAGE);
    process.exit(2);
  }
  if (options.help) {
    console.log(USAGE);
    process.exit(2);
  }
  if (options.overdueDays < options.dueDays) {
    console.error('--overdue-days must be >= --due-days');
    console.error(USAGE);
    process.exit(2);
  }

  const connectionString = process.env[options.targetEnv];
  if (typeof connectionString !== 'string' || connectionString.trim() === '') {
    console.error('ERROR: ' + options.targetEnv + ' is not set');
    process.exit(1);
  }
  let digest;
  try {
    digest = applyLogTarget(connectionString);
  } catch (_error) {
    console.error('ERROR: ' + options.targetEnv + ' is not a usable connection string');
    process.exit(1);
  }

  // One clock for the whole report: the bands and the printed label must agree.
  const asOf = new Date();
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const rows = await client.query(AGE_ROWS_SQL);
    await client.end();

    const report = evaluateAssessmentAge({
      rows: rows.rows,
      asOf,
      dueDays: options.dueDays,
      overdueDays: options.overdueDays,
      oldest: options.oldest,
    });
    const lines = formatReport(report, {
      asOf,
      label: options.targetEnv + ' (' + digest + ')',
    });
    for (const line of lines) console.log(line);

    const exitCode = exitCodeFor(report, options);
    if (exitCode === 1) console.log('STRICT: exit 1 on OVERDUE');
    process.exit(exitCode);
  } catch (err) {
    console.error('ERROR: could not read component_assessment: ' + err.message);
    await client.end().catch(() => {});
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { AGE_ROWS_SQL, USAGE, main, parseArgs };
