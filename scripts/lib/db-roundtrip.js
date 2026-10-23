'use strict';

// scripts/lib/db-roundtrip.js - the PURE half of the V1 latency input.
//
// WHY IT EXISTS. V1 promises "a recommendation POST completes in under 3 s", and
// that promise cannot be measured yet: nothing is deployed. A local run is worse
// than merely useless for it - on 2026-10-23 a single `SELECT 1` from the dev box
// took a MEDIAN of 120.7 ms to the TEST branch, so one 49-statement pass spent
// about 8.9 s of its 10.2 s in round trips. That number describes the laptop's
// distance to Neon, not the product.
//
// What CAN be measured today is the raw round trip from a host with a sane,
// repeatable network (a CI runner), which turns the target into a BAND instead of
// a guess: `statements x RTT` is a floor every origin pays, and an origin that
// colocated with its database pays a small fraction of the runner's figure. The
// script (scripts/measure-db-roundtrip.js) owns the connection and prints this
// module's report; THIS module owns the arithmetic, so the rules are pinned by
// tests that need no database.
//
// PURITY. No `pg`, no clock, no I/O, no mutation: `summarize` sorts a COPY of its
// argument, and every number is rounded the same way on every run, so the same
// samples always render the same report.

const DEFAULT_SAMPLES = 20;

// 49 = the statement count `scripts/measure-api-pass-phases.js` attributed to one
// GAMING pass at `launch-v2@1.0.0` on 2026-10-23 (8 960 ms of statements inside a
// 10 163 ms pass). It is a DEFAULT, not a fact about every pass: that harness
// prints its own count on each run, and a scoring-model or path change moves it.
const DEFAULT_STATEMENTS = 49;

const V1_TARGET_MS = 3000;

// Same-region origin/database round trips land in single-digit milliseconds, and
// 1-2 ms is the usual range. This is an ASSUMPTION used to show the scale of the
// difference, never a measurement - no colocated origin exists yet.
const COLOCATED_RTT_MS = 2;

const DEFAULT_TARGET_ENV = 'DATABASE_URL';

const USAGE = [
  'usage: node scripts/measure-db-roundtrip.js [--samples=N] [--statements=N] [--target=env:NAME]',
  '',
  '  --samples=N        sequential SELECT 1 round trips to time (default ' + DEFAULT_SAMPLES + ')',
  '  --statements=N     statements in one pass, for the budget (default ' + DEFAULT_STATEMENTS + ')',
  '  --target=env:NAME  environment variable holding the connection string',
  '                     (default env:' + DEFAULT_TARGET_ENV + ')',
  '',
  'Equals form is mandatory: "--samples 5" is rejected, "--samples=5" is not.',
  'The probe is READ ONLY - it issues SELECT 1 and nothing else.',
].join('\n');

function round1(value) {
  return Math.round(value * 10) / 10;
}

/** Nearest-rank percentile on an ASCENDING array. Returns a number, never NaN. */
function percentile(sortedAsc, p) {
  if (!Array.isArray(sortedAsc) || sortedAsc.length === 0) {
    throw new Error('percentile: samples must be a non-empty array');
  }
  if (typeof p !== 'number' || Number.isNaN(p) || p < 0 || p > 100) {
    throw new Error('percentile: p must be a number in [0, 100]');
  }
  const n = sortedAsc.length;
  const rank = Math.ceil((p / 100) * n);
  const index = Math.min(n - 1, Math.max(0, rank - 1));
  return sortedAsc[index];
}

/**
 * Summarize raw round-trip samples in milliseconds.
 * @param {number[]} samples
 * @returns {{count:number,min:number,median:number,p95:number,max:number,mean:number}}
 */
function summarize(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error('summarize: at least one sample is required');
  }
  for (const value of samples) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error('summarize: every sample must be a finite, non-negative number');
    }
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    min: round1(sorted[0]),
    median: round1(percentile(sorted, 50)),
    p95: round1(percentile(sorted, 95)),
    max: round1(sorted[sorted.length - 1]),
    mean: round1(total / sorted.length),
  };
}

/**
 * What the round trip alone costs one pass, and what the same pass would cost an
 * origin colocated with its database.
 */
function statementBudget(stats, statements) {
  if (!stats || typeof stats.median !== 'number' || typeof stats.p95 !== 'number') {
    throw new Error('statementBudget: stats must come from summarize()');
  }
  if (!Number.isInteger(statements) || statements < 1) {
    throw new Error('statementBudget: statements must be a positive integer');
  }
  return {
    statements,
    typical_ms: Math.round(stats.median * statements),
    worst_ms: Math.round(stats.p95 * statements),
    colocated_ms: statements * COLOCATED_RTT_MS,
  };
}

/**
 * Parse argv. The `=<value>` form is mandatory, exactly like
 * check-offer-freshness.js' `--fail-days=N`; `--help` throws the usage text so the
 * caller can print it and exit non-zero without touching a database.
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const options = {
    targetEnv: DEFAULT_TARGET_ENV,
    samples: DEFAULT_SAMPLES,
    statements: DEFAULT_STATEMENTS,
  };

  for (const arg of argv) {
    if (arg === '--help') throw new Error(USAGE);

    if (arg.startsWith('--samples=')) {
      const raw = arg.slice('--samples='.length);
      const value = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isInteger(value) || value < 1) {
        throw new Error('--samples must be a positive integer: ' + raw);
      }
      options.samples = value;
      continue;
    }

    if (arg.startsWith('--statements=')) {
      const raw = arg.slice('--statements='.length);
      const value = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isInteger(value) || value < 1) {
        throw new Error('--statements must be a positive integer: ' + raw);
      }
      options.statements = value;
      continue;
    }

    if (arg.startsWith('--target=')) {
      const raw = arg.slice('--target='.length);
      if (!raw.startsWith('env:')) {
        throw new Error('--target must be env:NAME (never a URL): ' + raw);
      }
      const name = raw.slice('env:'.length);
      if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
        throw new Error('--target must name an environment variable: ' + name);
      }
      options.targetEnv = name;
      continue;
    }

    throw new Error('unknown argument: ' + arg);
  }

  return options;
}

/**
 * Render the report. Never receives or prints a connection string: the label is
 * the VARIABLE NAME the caller read, which is all a log should carry.
 */
function renderReport({ label, stats, statements, targetMs = V1_TARGET_MS }) {
  const budget = statementBudget(stats, statements);
  const within = budget.typical_ms <= targetMs;
  return [
    'DB round-trip - ' + label + ' (read-only: ' + stats.count + ' x SELECT 1)',
    '  min ' + stats.min + ' ms | median ' + stats.median + ' ms | p95 ' + stats.p95 + ' ms | max ' + stats.max + ' ms | mean ' + stats.mean + ' ms',
    '  one pass = ' + budget.statements + ' statements, so the round-trip share alone is ' +
      budget.typical_ms + ' ms (median) to ' + budget.worst_ms + ' ms (p95)',
    '  V1 target: ' + targetMs + ' ms -> at THIS distance the pass is ' +
      (within ? 'within' : 'ABOVE') + ' the target before the engine does any work',
    '  band: this measures the MEASURING HOST to the database, not the deployed origin. An origin',
    '  colocated with it would pay ~' + budget.colocated_ms + ' ms of round trip for the same ' +
      budget.statements + ' statements (assuming ' + COLOCATED_RTT_MS + ' ms per statement).',
  ].join('\n');
}

module.exports = {
  COLOCATED_RTT_MS,
  DEFAULT_SAMPLES,
  DEFAULT_STATEMENTS,
  DEFAULT_TARGET_ENV,
  USAGE,
  V1_TARGET_MS,
  parseArgs,
  percentile,
  renderReport,
  statementBudget,
  summarize,
};
