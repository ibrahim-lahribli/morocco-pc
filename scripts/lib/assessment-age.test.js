'use strict';

/**
 * scripts/lib/assessment-age.test.js — the pure half of the age gate: bands,
 * boundary, cohort grouping, the oldest list, and the exit-code rule.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BANDS,
  DEFAULTS,
  evaluateAssessmentAge,
  exitCodeFor,
  formatReport,
  toMs,
} = require('./assessment-age');

const AS_OF = new Date('2026-11-08T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function row(type, daysAgo, extra) {
  return Object.assign({
    assessment_type: type,
    assessed_at: new Date(AS_OF.getTime() - daysAgo * DAY),
    product_name: 'Seed ' + type,
    confidence: 'HIGH',
    score: 70,
  }, extra || {});
}

test('a corpus inside the due band is OK and the counts agree', () => {
  const report = evaluateAssessmentAge({
    rows: [row('PERFORMANCE', 10), row('QUALITY', 40), row('VALUE', 0)],
    asOf: AS_OF,
  });
  assert.equal(report.band, BANDS.OK);
  assert.equal(report.total, 3);
  assert.equal(report.due, 0);
  assert.equal(report.overdue, 0);
  assert.equal(report.dueDays, 90);
  assert.equal(report.overdueDays, 180);
  assert.equal(report.cohorts.length, 3);
  assert.equal(report.types.length, 3);
});

test('the due boundary is EXCLUSIVE: exactly 90 days old is still OK', () => {
  const atBoundary = evaluateAssessmentAge({ rows: [row('PERFORMANCE', 90)], asOf: AS_OF });
  assert.equal(atBoundary.band, BANDS.OK);
  assert.equal(atBoundary.due, 0);
  const past = evaluateAssessmentAge({ rows: [row('PERFORMANCE', 90.5)], asOf: AS_OF });
  assert.equal(past.band, BANDS.DUE);
  assert.equal(past.due, 1);
});

test('one row past the due band is DUE, one past overdue is OVERDUE', () => {
  const due = evaluateAssessmentAge({
    rows: [row('PERFORMANCE', 30), row('QUALITY', 120), row('VALUE', 181)],
    asOf: AS_OF,
  });
  assert.equal(due.band, BANDS.OVERDUE);
  assert.equal(due.due, 2);
  assert.equal(due.overdue, 1);

  const dueOnly = evaluateAssessmentAge({
    rows: [row('PERFORMANCE', 30), row('QUALITY', 120)],
    asOf: AS_OF,
  });
  assert.equal(dueOnly.band, BANDS.DUE);
  assert.equal(dueOnly.due, 1);
  assert.equal(dueOnly.overdue, 0);
});

test('cohorts group by type AND calendar date, with their own counts', () => {
  // Two rows of ONE type on ONE calendar day (08:00 and 20:00) share a cohort,
  // the same day's row of another type does not, and a different day does not.
  // 2026-07-31 is 100 days before AS_OF and 2026-08-01 is 99, so both cross the
  // 90-day line - which the cohort row must carry, not inherit from the corpus.
  const report = evaluateAssessmentAge({
    rows: [
      row('PERFORMANCE', 100, { assessed_at: new Date('2026-07-31T08:00:00Z') }),
      row('PERFORMANCE', 100, { assessed_at: new Date('2026-07-31T20:00:00Z') }),
      row('QUALITY', 100, { assessed_at: new Date('2026-07-31T08:00:00Z') }),
      row('VALUE', 99, { assessed_at: new Date('2026-08-01T08:00:00Z') }),
    ],
    asOf: AS_OF,
  });
  const performanceJul31 = report.cohorts.find((c) => c.assessment_type === 'PERFORMANCE' && c.cohort === '2026-07-31');
  assert.equal(performanceJul31.rows, 2);
  assert.equal(performanceJul31.due, 2);
  assert.equal(report.cohorts.length, 3);
  assert.equal(report.due, 4);
  assert.equal(report.band, BANDS.DUE);
  const quality = report.types.find((t) => t.assessment_type === 'QUALITY');
  assert.equal(quality.rows, 1);
  assert.equal(quality.due, 1);
});

test('the oldest list is ordered by age and respects --oldest', () => {
  const report = evaluateAssessmentAge({
    rows: [row('PERFORMANCE', 5), row('QUALITY', 200), row('VALUE', 150), row('THERMALS', 199)],
    asOf: AS_OF,
    oldest: 2,
  });
  assert.equal(report.oldest.length, 2);
  assert.equal(report.oldest[0].assessment_type, 'QUALITY');
  assert.equal(report.oldest[0].age_days, 200);
  assert.equal(report.oldest[1].assessment_type, 'THERMALS');
  assert.equal(report.oldest_age_days, 200);
  assert.equal(report.oldest[0].product_name, 'Seed QUALITY');
});

test('a future timestamp is age 0, never negative age', () => {
  const report = evaluateAssessmentAge({
    rows: [row('PERFORMANCE', -10)],
    asOf: AS_OF,
  });
  assert.equal(report.band, BANDS.OK);
  assert.equal(report.oldest_age_days, 0);
});

test('thresholds are validated instead of silently reinterpreted', () => {
  assert.throws(() => evaluateAssessmentAge({ rows: [], asOf: AS_OF, dueDays: 1.5 }),
    /dueDays must be a non-negative integer/);
  assert.throws(() => evaluateAssessmentAge({ rows: [], asOf: AS_OF, overdueDays: -1 }),
    /overdueDays must be a non-negative integer/);
  assert.throws(() => evaluateAssessmentAge({ rows: [], asOf: AS_OF, dueDays: 90, overdueDays: 30 }),
    /overdueDays must be >= dueDays/);
  assert.throws(() => evaluateAssessmentAge({ rows: [], asOf: new Date('nope') }),
    /asOf must be a valid Date/);
});

test('an unreadable assessed_at fails the run rather than being skipped', () => {
  assert.throws(
    () => evaluateAssessmentAge({ rows: [row('PERFORMANCE', 10, { assessed_at: 'not-a-date' })], asOf: AS_OF }),
    /assessed_at is unreadable/
  );
  assert.ok(Number.isFinite(toMs('2026-10-01T00:00:00Z')));
  assert.ok(!Number.isFinite(toMs(null)));
});

test('an empty corpus is OK and says so, not OVERDUE', () => {
  const report = evaluateAssessmentAge({ rows: [], asOf: AS_OF });
  assert.equal(report.band, BANDS.OK);
  assert.equal(report.total, 0);
  assert.equal(report.oldest_age_days, null);
  const lines = formatReport(report, { asOf: AS_OF, label: 'env:TEST' }).join('\n');
  assert.match(lines, /RESULT: OK/);
});

test('the report pins the vocabulary and the strict rule', () => {
  const report = evaluateAssessmentAge({ rows: [row('QUALITY', 200)], asOf: AS_OF });
  const lines = formatReport(report, { asOf: AS_OF, label: 'env:TEST (db:0123456789ab)' }).join('\n');
  assert.match(lines, /RESULT: OVERDUE/);
  assert.match(lines, /older than 180 days/);
  assert.match(lines, /zero decay/);
  assert.match(lines, /As of: 2026-11-08T12:00:00\.000Z/);
  assert.match(lines, /DUE older than 90 days, OVERDUE older than 180 days/);

  assert.equal(exitCodeFor({ band: BANDS.OK }, { strict: true }), 0);
  assert.equal(exitCodeFor({ band: BANDS.DUE }, { strict: true }), 0);
  assert.equal(exitCodeFor({ band: BANDS.OVERDUE }, { strict: true }), 1);
  assert.equal(exitCodeFor({ band: BANDS.OVERDUE }, { strict: false }), 0);
  assert.equal(exitCodeFor({ band: BANDS.OVERDUE }), 0);
  assert.equal(DEFAULTS.dueDays, 90);
  assert.equal(DEFAULTS.overdueDays, 180);
});
