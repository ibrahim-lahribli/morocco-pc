'use strict';

/**
 * scripts/lib/assessment-age.js — assessment-age gate, pure half (no DB, no
 * clock, no I/O): the classification behind `check-assessment-age.js`.
 *
 * WHY THIS GATE EXISTS. Decision 66 (draft) turns assessment decay OFF for
 * `launch-v2@2.5.0`, so the served score no longer falls as the corpus ages.
 * That removes the only automatic signal that the evidence is old — which is
 * why the replacement is an explicit one: this report says HOW old the corpus
 * is, per assessment type and per cohort date, and names the rows that have
 * crossed a threshold.
 *
 * WHAT IT DOES NOT DO. It never rewrites, re-dates or deletes an assessment, and
 * it never guesses whether an old row is still TRUE. Age is not correctness: a
 * 200-day-old `PERFORMANCE` score may be perfectly accurate and a 2-day-old one
 * wrong. The band names a review obligation, not a defect.
 *
 * BANDS (inclusive boundary: a row exactly `dueDays` old is NOT due yet):
 *   OK        no row older than `dueDays`
 *   DUE       at least one row older than `dueDays`, none older than `overdueDays`
 *   OVERDUE   at least one row older than `overdueDays`
 *
 * The vocabulary is deliberately the repo's, not a fourth one: OK / DUE /
 * OVERDUE reads as a maintenance schedule, where PASS / FAIL would imply the
 * fresh corpus had been validated.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const BANDS = Object.freeze({ OK: 'OK', DUE: 'DUE', OVERDUE: 'OVERDUE' });

const DEFAULTS = Object.freeze({ dueDays: 90, overdueDays: 180, oldest: 10 });

/** Coerce the pg TIMESTAMP-without-tz / string / number forms to epoch ms. */
function toMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}

function requireCount(value, fallback, name) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(name + ' must be a non-negative integer');
  }
  return value;
}

/**
 * Classify the corpus.
 *
 * @param {object} input
 * @param {Array<{assessment_type: string, assessed_at: (Date|string|number),
 *   product_name?: string, confidence?: string, score?: number}>} input.rows
 *   EVERY component_assessment row in scope (one row per (product, type) is not
 *   guaranteed; duplicates are counted, never collapsed)
 * @param {Date} input.asOf the single clock for the whole report
 * @param {number} [input.dueDays]
 * @param {number} [input.overdueDays]
 * @param {number} [input.oldest] how many oldest rows to carry
 * @returns {{band: string, total: number, due: number, overdue: number,
 *   dueDays: number, overdueDays: number, oldest_age_days: number|null,
 *   cohorts: Array<{assessment_type: string, cohort: string, rows: number,
 *   due: number, overdue: number, oldest_age_days: number}>,
 *   types: Array<{assessment_type: string, rows: number, due: number,
 *   overdue: number, oldest_age_days: number}>,
 *   oldest: Array<{assessment_type: string, cohort: string, age_days: number,
 *   product_name: string|null, confidence: string|null, score: number|null}>}}
 */
function evaluateAssessmentAge(input) {
  const rows = Array.isArray(input && input.rows) ? input.rows : [];
  const asOf = input && input.asOf instanceof Date ? input.asOf : null;
  if (asOf === null || Number.isNaN(asOf.getTime())) {
    throw new Error('asOf must be a valid Date');
  }
  const dueDays = requireCount(input && input.dueDays, DEFAULTS.dueDays, 'dueDays');
  const overdueDays = requireCount(input && input.overdueDays, DEFAULTS.overdueDays, 'overdueDays');
  const oldest = requireCount(input && input.oldest, DEFAULTS.oldest, 'oldest');
  if (overdueDays < dueDays) {
    throw new Error('overdueDays must be >= dueDays');
  }

  const cohortKey = new Map();
  const typeKey = new Map();
  const normalised = [];
  let due = 0;
  let overdue = 0;

  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    const type = typeof row.assessment_type === 'string' && row.assessment_type.trim() !== ''
      ? row.assessment_type
      : 'UNKNOWN';
    const ms = toMs(row.assessed_at);
    if (!Number.isFinite(ms)) {
      // A row whose timestamp cannot be read is not silently dropped: it cannot
      // be aged, so it is reported as its own 0-day cohort marker would lie.
      throw new Error('component_assessment.assessed_at is unreadable for [' + type + ']');
    }
    const ageDays = Math.max(0, (asOf.getTime() - ms) / MS_PER_DAY);
    const isDue = ageDays > dueDays;
    const isOverdue = ageDays > overdueDays;
    if (isDue) due += 1;
    if (isOverdue) overdue += 1;

    const cohort = new Date(ms).toISOString().slice(0, 10);
    const cKey = type + '|' + cohort;
    const c = cohortKey.get(cKey) || { assessment_type: type, cohort, rows: 0, due: 0, overdue: 0, oldest_age_days: 0 };
    c.rows += 1;
    if (isDue) c.due += 1;
    if (isOverdue) c.overdue += 1;
    c.oldest_age_days = Math.max(c.oldest_age_days, ageDays);
    cohortKey.set(cKey, c);

    const t = typeKey.get(type) || { assessment_type: type, rows: 0, due: 0, overdue: 0, oldest_age_days: 0 };
    t.rows += 1;
    if (isDue) t.due += 1;
    if (isOverdue) t.overdue += 1;
    t.oldest_age_days = Math.max(t.oldest_age_days, ageDays);
    typeKey.set(type, t);

    normalised.push({
      assessment_type: type,
      cohort,
      age_days: ageDays,
      product_name: typeof row.product_name === 'string' ? row.product_name : null,
      confidence: typeof row.confidence === 'string' ? row.confidence : null,
      score: typeof row.score === 'number' ? row.score : null,
    });
  }

  const band = overdue > 0 ? BANDS.OVERDUE : due > 0 ? BANDS.DUE : BANDS.OK;
  const cohorts = [...cohortKey.values()].sort((a, b) => (
    a.assessment_type < b.assessment_type ? -1 : a.assessment_type > b.assessment_type ? 1
      : a.cohort < b.cohort ? -1 : a.cohort > b.cohort ? 1 : 0
  ));
  const types = [...typeKey.values()].sort((a, b) => (
    a.assessment_type < b.assessment_type ? -1 : a.assessment_type > b.assessment_type ? 1 : 0
  ));
  const oldestRows = normalised
    .slice()
    .sort((a, b) => (b.age_days - a.age_days)
      || (a.assessment_type < b.assessment_type ? -1 : a.assessment_type > b.assessment_type ? 1 : 0))
    .slice(0, oldest);

  return {
    band,
    total: normalised.length,
    due,
    overdue,
    dueDays,
    overdueDays,
    oldest_age_days: oldestRows.length > 0 ? oldestRows[0].age_days : null,
    cohorts,
    types,
    oldest: oldestRows,
  };
}

/**
 * The exit code the CLI should use. `--strict` escalates OVERDUE only: DUE is the
 * warning band by construction, and a gate that fails on it would be red for
 * most of every review cycle.
 *
 * @param {{band: string}} report
 * @param {{strict?: boolean}} [options]
 * @returns {0|1}
 */
function exitCodeFor(report, options) {
  const strict = Boolean(options && options.strict);
  return strict && report.band === BANDS.OVERDUE ? 1 : 0;
}

/** Human line for one age, in days, to one decimal. */
function days(value) {
  return value === null || value === undefined ? 'n/a' : value.toFixed(1);
}

/**
 * Render the report as lines (no I/O, so a test can pin the wording).
 *
 * @param {ReturnType<typeof evaluateAssessmentAge>} report
 * @param {{asOf: Date, label: string}} context
 * @returns {string[]}
 */
function formatReport(report, context) {
  const lines = [];
  lines.push('Assessment age (read-only; per type and cohort, decision 66 replacement signal)');
  lines.push('Target: ' + context.label);
  lines.push('As of: ' + context.asOf.toISOString());
  lines.push('Bands: DUE older than ' + report.dueDays + ' days, OVERDUE older than '
    + report.overdueDays + ' days (boundary exclusive)');
  lines.push('');
  lines.push('  rows ' + report.total + ' | due ' + report.due + ' | overdue ' + report.overdue
    + ' | oldest ' + days(report.oldest_age_days) + ' day(s)');
  lines.push('');
  lines.push('  type / cohort        rows   due  overdue  oldest');
  for (const c of report.cohorts) {
    lines.push(
      '  ' + (c.assessment_type + ' / ' + c.cohort).padEnd(20)
      + String(c.rows).padStart(5)
      + String(c.due).padStart(6)
      + String(c.overdue).padStart(9)
      + days(c.oldest_age_days).padStart(9)
    );
  }
  if (report.oldest.length > 0) {
    lines.push('');
    lines.push('  oldest ' + report.oldest.length + ' row(s):');
    for (const row of report.oldest) {
      lines.push('   ' + days(row.age_days).padStart(7) + 'd  '
        + (row.assessment_type + ' / ' + row.cohort).padEnd(20)
        + ' score=' + String(row.score === null ? 'null' : row.score).padStart(3)
        + ' conf=' + String(row.confidence || 'null').padEnd(10)
        + ' ' + (row.product_name || '(unnamed)'));
    }
  }
  lines.push('');
  lines.push('RESULT: ' + report.band);

  if (report.band === BANDS.OK) {
    lines.push('Every row is inside the ' + report.dueDays + '-day band; nothing to schedule.');
  } else if (report.band === BANDS.DUE) {
    lines.push(
      report.due + ' row(s) are older than ' + report.dueDays + ' days but none is older than '
      + report.overdueDays + ': a re-assessment sweep is due, not overdue.'
    );
  } else {
    lines.push(
      report.overdue + ' row(s) are older than ' + report.overdueDays + ' days. With Decision 66\'s'
      + ' zero decay this age is no longer visible in the score, so this gate is the only signal'
      + ' that the evidence has aged.'
    );
  }
  return lines;
}

module.exports = {
  BANDS,
  DEFAULTS,
  MS_PER_DAY,
  evaluateAssessmentAge,
  exitCodeFor,
  formatReport,
  toMs,
};
