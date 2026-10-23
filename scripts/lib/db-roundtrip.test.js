'use strict';

// DB-free tests for the V1 latency probe's pure half. The numbers here are the
// contract: nearest-rank percentiles, the median x statements budget, and an
// argument parser that refuses the space form (matching every other `--flag=N`
// CLI in scripts/) and refuses a URL where a variable NAME belongs.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COLOCATED_RTT_MS,
  DEFAULT_SAMPLES,
  DEFAULT_STATEMENTS,
  DEFAULT_TARGET_ENV,
  V1_TARGET_MS,
  parseArgs,
  percentile,
  renderReport,
  statementBudget,
  summarize,
} = require('./db-roundtrip');

test('percentile uses nearest rank on an ascending array', () => {
  const sorted = [1, 2, 3, 4, 5];
  assert.equal(percentile(sorted, 0), 1);
  assert.equal(percentile(sorted, 50), 3);
  assert.equal(percentile(sorted, 95), 5);
  assert.equal(percentile(sorted, 100), 5);
  assert.equal(percentile([7], 50), 7);
});

test('percentile rejects an empty array and an out-of-range p', () => {
  assert.throws(() => percentile([], 50), /non-empty array/);
  assert.throws(() => percentile([1], -1), /\[0, 100]/);
  assert.throws(() => percentile([1], 101), /\[0, 100]/);
});

test('summarize reports min, median, p95, max and mean, rounded once', () => {
  const stats = summarize([10, 20, 30, 40]);
  assert.deepEqual(stats, {
    count: 4,
    min: 10,
    median: 20,
    p95: 40,
    max: 40,
    mean: 25,
  });
  assert.equal(summarize([1.234, 2.345]).median, 1.2);
});

test('summarize does not mutate its argument', () => {
  const samples = [30, 10, 20];
  summarize(samples);
  assert.deepEqual(samples, [30, 10, 20]);
});

test('summarize rejects an empty or non-numeric sample set', () => {
  assert.throws(() => summarize([]), /at least one sample/);
  assert.throws(() => summarize([1, NaN]), /finite, non-negative/);
  assert.throws(() => summarize([-1]), /finite, non-negative/);
});

test('statementBudget multiplies the median and p95 by the statement count', () => {
  const stats = summarize([100, 100, 100, 200]);
  const budget = statementBudget(stats, 49);
  assert.deepEqual(budget, {
    statements: 49,
    typical_ms: 4900,
    worst_ms: 9800, // p95 of four samples is the LARGEST one (nearest rank)
    colocated_ms: 49 * COLOCATED_RTT_MS,
  });
  assert.throws(() => statementBudget(stats, 0), /positive integer/);
  assert.throws(() => statementBudget({}, 49), /stats must come from summarize/);
});

test('parseArgs defaults to DATABASE_URL and the documented sample count', () => {
  assert.deepEqual(parseArgs([]), {
    targetEnv: DEFAULT_TARGET_ENV,
    samples: DEFAULT_SAMPLES,
    statements: DEFAULT_STATEMENTS,
  });
  assert.equal(DEFAULT_TARGET_ENV, 'DATABASE_URL');
  assert.equal(V1_TARGET_MS, 3000);
});

test('parseArgs reads every flag in the equals form', () => {
  assert.deepEqual(parseArgs(['--samples=5', '--statements=49', '--target=env:TEST_DATABASE_URL']), {
    targetEnv: 'TEST_DATABASE_URL',
    samples: 5,
    statements: 49,
  });
});

test('parseArgs rejects the space form, unknown flags and bad values', () => {
  assert.throws(() => parseArgs(['--samples', '5']), /unknown argument: --samples/);
  assert.throws(() => parseArgs(['--nope=1']), /unknown argument: --nope=1/);
  assert.throws(() => parseArgs(['--samples=0']), /positive integer/);
  assert.throws(() => parseArgs(['--statements=-2']), /positive integer/);
  assert.throws(() => parseArgs(['--samples=five']), /positive integer/);
});

test('parseArgs takes a variable NAME, never a URL', () => {
  assert.throws(() => parseArgs(['--target=postgres://user:secret@host/db']), /env:NAME/);
  assert.throws(() => parseArgs(['--target=env:lower-case']), /environment variable/);
});

test('--help throws the usage text so nothing connects', () => {
  assert.throws(() => parseArgs(['--help']), /usage: node scripts\/measure-db-roundtrip\.js/);
});

test('renderReport prints the band, the verdict and the colocated scale', () => {
  const report = renderReport({
    label: 'TEST_DATABASE_URL',
    stats: summarize([100, 100, 100, 100]),
    statements: 49,
  });
  assert.match(report, /DB round-trip - TEST_DATABASE_URL \(read-only: 4 x SELECT 1\)/);
  assert.match(report, /median 100 ms/);
  assert.match(report, /one pass = 49 statements/);
  assert.match(report, /4900 ms \(median\) to 4900 ms \(p95\)/);
  assert.match(report, /V1 target: 3000 ms -> at THIS distance the pass is ABOVE the target/);
  assert.match(report, /colocated with it would pay ~98 ms/);
  assert.doesNotMatch(report, /:\/\//, 'a report must never carry a connection string');
});

test('renderReport says "within" when the round trip fits the target', () => {
  const report = renderReport({ label: 'DATABASE_URL', stats: summarize([1, 1, 1]), statements: 49 });
  assert.match(report, /within the target/);
});
