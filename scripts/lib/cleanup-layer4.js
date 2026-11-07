'use strict';

// scripts/lib/cleanup-layer4.js — R-14 shared Layer-4 cleanup: the PURE half.
//
// What this owns: the command-line contract, the demo scope predicate, the
// FK-ordered delete plan and the residue check. It performs no I/O, so every
// refusal and every ordering rule is testable without a database.
//
// THE SCOPE IS DELIBERATELY NARROW. R-14 records 12 `recommendation_query` rows
// (16 results, 16 candidates, 126 components, 24 rejections, 13 profiles) that
// the public demo created on the shared database. Every one hangs off a profile
// named `api-<uuid>` described "Created by POST /v1/recommendations" (measured
// 2026-11-07: 13 such profiles, 12 queries, 0 presets, 0 swaps). Nothing else
// is touched: a preset shelf pass, an EU pass or a test run does not carry that
// profile shape, and a scoped query that a preset points at is a REFUSAL rather
// than a silent shelf deletion.
//
// DELETE ORDER IS THE FK ORDER, and it is not cosmetic. build_component and
// recommendation_result both reference build_candidate with NO ACTION, and
// recommendation_swap references recommendation_result AND build_candidate, so
// a bare `DELETE FROM recommendation_query` raises a constraint violation and
// leaks every child row (AGENTS §7 item 11).

const { isValidRestorePointId } = require('./migrations');

/** The demo profile name shape: `api-<uuid>`. A SQL LIKE pattern, not a regex. */
const DEMO_PROFILE_NAME_PATTERN = 'api-%';

/** The exact description POST /v1/recommendations writes on a created profile. */
const DEMO_PROFILE_DESCRIPTION = 'Created by POST /v1/recommendations';

/** Every Layer 4 table this cleanup can touch, in report order. */
const LAYER4_TABLES = [
  'recommendation_swap',
  'recommendation_preset',
  'recommendation_query',
  'recommendation_result',
  'build_candidate',
  'build_component',
  'build_rejection',
  'recommendation_profile',
];

const USAGE = [
  'usage: node scripts/cleanup-layer4.js [--dry-run|--commit --confirm-shared --restore-point=<id>] [--help]',
  'Target: DATABASE_URL (the shared database) only. --test-db and --target-env are REFUSED.',
  'Default is --dry-run: it prints the scope, the before counts and the FK-ordered plan, and writes nothing.',
  'A --commit needs a Neon restore point matching ^[A-Za-z0-9_-]{8,}$ and an explicit --confirm-shared.',
].join('\n');

/** A bad COMMAND LINE, as opposed to a failed run (exit 2, the repo convention). */
class UsageError extends Error {}

/**
 * The scope predicate's parameters, in one place: `[pattern, description]`.
 * Both scope SQL queries and the residue query take exactly these two.
 *
 * @returns {[string, string]}
 */
function scopeParams() {
  return [DEMO_PROFILE_NAME_PATTERN, DEMO_PROFILE_DESCRIPTION];
}

const SCOPE_PROFILE_IDS_SQL = [
  'SELECT p.id',
  '  FROM recommendation_profile p',
  ' WHERE p.name LIKE $1 AND p.description = $2',
  ' ORDER BY p.id',
].join('\n');

const SCOPE_QUERY_IDS_SQL = [
  'SELECT q.id',
  '  FROM recommendation_query q',
  '  JOIN recommendation_profile p ON p.id = q.recommendation_profile_id',
  ' WHERE p.name LIKE $1 AND p.description = $2',
  ' ORDER BY q.id',
].join('\n');

const SCOPE_RESULT_IDS_SQL = [
  'SELECT r.id',
  '  FROM recommendation_result r',
  ' WHERE r.recommendation_query_id = ANY($1::uuid[])',
  ' ORDER BY r.id',
].join('\n');

const SCOPE_CANDIDATE_IDS_SQL = [
  'SELECT b.id',
  '  FROM build_candidate b',
  ' WHERE b.recommendation_query_id = ANY($1::uuid[])',
  ' ORDER BY b.id',
].join('\n');

/** How many scoped presets exist: a non-zero answer is a REFUSAL, not a delete. */
const SCOPE_PRESET_COUNT_SQL = [
  'SELECT count(*)::int AS n',
  '  FROM recommendation_preset rp',
  '  JOIN recommendation_query q ON q.id = rp.query_id',
  '  JOIN recommendation_profile p ON p.id = q.recommendation_profile_id',
  ' WHERE p.name LIKE $1 AND p.description = $2',
].join('\n');

/** One row per Layer 4 table, so before/after is one statement and one snapshot. */
function countsSql() {
  return LAYER4_TABLES
    .map((table) => "SELECT '" + table + "' AS relation, count(*)::int AS n FROM " + table)
    .join('\nUNION ALL\n');
}

/**
 * Scoped residue, counted by SCOPE rather than by remembered ids: after the
 * deletes, every count here must be 0 for the run to commit.
 *
 * `queries` and `profiles` are the direct measure; the rest join through them,
 * so an orphan written between the plan and the delete still surfaces.
 */
function residueSql() {
  return [
    'SELECT',
    '  (SELECT count(*) FROM recommendation_profile p',
    '    WHERE p.name LIKE $1 AND p.description = $2)::int AS profiles,',
    '  (SELECT count(*) FROM recommendation_query q',
    '     JOIN recommendation_profile p ON p.id = q.recommendation_profile_id',
    '    WHERE p.name LIKE $1 AND p.description = $2)::int AS queries,',
    '  (SELECT count(*) FROM recommendation_result r',
    '     JOIN recommendation_query q ON q.id = r.recommendation_query_id',
    '     JOIN recommendation_profile p ON p.id = q.recommendation_profile_id',
    '    WHERE p.name LIKE $1 AND p.description = $2)::int AS results,',
    '  (SELECT count(*) FROM build_candidate b',
    '     JOIN recommendation_query q ON q.id = b.recommendation_query_id',
    '     JOIN recommendation_profile p ON p.id = q.recommendation_profile_id',
    '    WHERE p.name LIKE $1 AND p.description = $2)::int AS candidates,',
    '  (SELECT count(*) FROM build_component c',
    '     JOIN build_candidate b ON b.id = c.build_candidate_id',
    '     JOIN recommendation_query q ON q.id = b.recommendation_query_id',
    '     JOIN recommendation_profile p ON p.id = q.recommendation_profile_id',
    '    WHERE p.name LIKE $1 AND p.description = $2)::int AS components,',
    '  (SELECT count(*) FROM build_rejection j',
    '     JOIN recommendation_query q ON q.id = j.recommendation_query_id',
    '     JOIN recommendation_profile p ON p.id = q.recommendation_profile_id',
    '    WHERE p.name LIKE $1 AND p.description = $2)::int AS rejections,',
    '  (SELECT count(*) FROM recommendation_swap s',
    '    WHERE EXISTS (SELECT 1 FROM recommendation_result r',
    '                    JOIN recommendation_query q ON q.id = r.recommendation_query_id',
    '                    JOIN recommendation_profile p ON p.id = q.recommendation_profile_id',
    '                   WHERE r.id = s.source_result_id',
    '                     AND p.name LIKE $1 AND p.description = $2)',
    '       OR EXISTS (SELECT 1 FROM build_candidate b',
    '                    JOIN recommendation_query q ON q.id = b.recommendation_query_id',
    '                    JOIN recommendation_profile p ON p.id = q.recommendation_profile_id',
    '                   WHERE b.id = s.build_candidate_id',
    '                     AND p.name LIKE $1 AND p.description = $2))::int AS swaps,',
    '  (SELECT count(*) FROM recommendation_preset rp',
    '     JOIN recommendation_query q ON q.id = rp.query_id',
    '     JOIN recommendation_profile p ON p.id = q.recommendation_profile_id',
    '    WHERE p.name LIKE $1 AND p.description = $2)::int AS presets',
  ].join('\n');
}

/**
 * The delete plan, in FK order. Every statement is parameterized: relation
 * names come from this module's own constants and ids travel as uuid arrays,
 * so a value can never become SQL.
 *
 * @param {{queryIds: string[], resultIds: string[], candidateIds: string[],
 *          profileIds: string[]}} scope
 * @returns {Array<{relation: string, sql: string, params: Array}>}
 */
function deletePlan(scope) {
  const s = scope || {};
  const queryIds = s.queryIds || [];
  const resultIds = s.resultIds || [];
  const candidateIds = s.candidateIds || [];
  const profileIds = s.profileIds || [];
  return [
    {
      relation: 'recommendation_swap',
      sql: 'DELETE FROM recommendation_swap'
        + ' WHERE source_result_id = ANY($1::uuid[]) OR build_candidate_id = ANY($2::uuid[])',
      params: [resultIds, candidateIds],
    },
    {
      relation: 'recommendation_preset',
      sql: 'DELETE FROM recommendation_preset WHERE query_id = ANY($1::uuid[])',
      params: [queryIds],
    },
    {
      relation: 'build_rejection',
      sql: 'DELETE FROM build_rejection WHERE recommendation_query_id = ANY($1::uuid[])',
      params: [queryIds],
    },
    {
      relation: 'recommendation_result',
      sql: 'DELETE FROM recommendation_result WHERE recommendation_query_id = ANY($1::uuid[])',
      params: [queryIds],
    },
    {
      relation: 'build_component',
      sql: 'DELETE FROM build_component WHERE build_candidate_id = ANY($1::uuid[])',
      params: [candidateIds],
    },
    {
      relation: 'build_candidate',
      sql: 'DELETE FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[])',
      params: [queryIds],
    },
    {
      relation: 'recommendation_query',
      sql: 'DELETE FROM recommendation_query WHERE id = ANY($1::uuid[])',
      params: [queryIds],
    },
    {
      relation: 'recommendation_profile',
      // A profile another query still references is NOT residue and must survive.
      sql: 'DELETE FROM recommendation_profile p'
        + ' WHERE p.id = ANY($1::uuid[])'
        + ' AND NOT EXISTS (SELECT 1 FROM recommendation_query q'
        + '                  WHERE q.recommendation_profile_id = p.id)',
      params: [profileIds],
    },
  ];
}

/**
 * Parse the command line. `--dry-run` is the default, and the two modes are
 * mutually exclusive rather than last-wins: silently honouring the later one
 * could turn an intended preview into a real delete.
 *
 * @param {string[]} argv
 * @returns {{commit: boolean, restorePoint: string|null, confirmShared: boolean}}
 * @throws {UsageError} on --help, an unknown flag, both modes, the space form of
 *   --restore-point, or a flag this shared-only script refuses by name
 */
function parseArgs(argv) {
  const args = { commit: false, restorePoint: null, confirmShared: false, modeSet: false };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help') {
      throw new UsageError(USAGE);
    } else if (arg === '--dry-run') {
      if (args.modeSet && args.commit) throw new UsageError('--dry-run and --commit are mutually exclusive');
      args.modeSet = true;
    } else if (arg === '--commit') {
      if (args.modeSet && !args.commit) throw new UsageError('--dry-run and --commit are mutually exclusive');
      args.modeSet = true;
      args.commit = true;
    } else if (arg === '--confirm-shared') {
      args.confirmShared = true;
    } else if (arg.startsWith('--restore-point=')) {
      // An empty value is kept as '' and refused by validateRun's shape check, the
      // same way the other CLIs treat it: a missing/placeholder id is a REFUSAL
      // (exit 1), not a malformed command line (exit 2).
      args.restorePoint = arg.slice('--restore-point='.length);
    } else if (arg === '--restore-point') {
      throw new UsageError('--restore-point takes the EQUALS form: --restore-point=<id>');
    } else if (arg === '--test-db') {
      throw new UsageError('this cleanup targets the shared DATABASE_URL only; --test-db is refused');
    } else if (arg === '--target-env' || arg.startsWith('--target-env=')) {
      throw new UsageError('this cleanup targets the shared DATABASE_URL only; --target-env is refused');
    } else {
      throw new UsageError('unknown argument: ' + arg + '\n' + USAGE);
    }
  }
  return args;
}

/**
 * Decide whether this run must refuse BEFORE it connects. Pure, so the refusal
 * is pinned without a database.
 *
 * @param {{commit: boolean, restorePoint: string|null, confirmShared: boolean}} args
 * @returns {string|null} the refusal message, or null when the run may proceed
 */
function validateRun(args) {
  const a = args || {};
  if (!a.commit) return null;
  if (!isValidRestorePointId(a.restorePoint)) {
    return 'REFUSING to clean the shared database: --commit needs --restore-point=<id>'
      + ' matching ^[A-Za-z0-9_-]{8,}$ (received: ' + JSON.stringify(a.restorePoint) + ').';
  }
  if (!a.confirmShared) {
    return 'REFUSING to clean the shared database: --commit also needs --confirm-shared.';
  }
  return null;
}

/**
 * Name every scoped count that is not zero. An empty array is the only success.
 *
 * @param {Record<string, number>} counts residueSql()'s row
 * @returns {string[]}
 */
function residueProblems(counts) {
  const c = counts || {};
  return Object.keys(c)
    .filter((key) => Number(c[key]) !== 0)
    .map((key) => key + ': ' + c[key] + ' row(s) remain');
}

/**
 * Render the before/after table. Both sides are keyed by relation so a table
 * missing from one snapshot is reported as `?` rather than silently dropped.
 *
 * @param {Record<string, number>} before
 * @param {Record<string, number>|null} after
 * @returns {string}
 */
function formatCounts(before, after) {
  const rows = [['relation', 'before', 'after']];
  for (const table of LAYER4_TABLES) {
    rows.push([
      table,
      String(before && before[table] !== undefined ? before[table] : '?'),
      after === null || after === undefined ? '-' : String(after[table] !== undefined ? after[table] : '?'),
    ]);
  }
  const widths = [0, 1, 2].map((col) => Math.max(...rows.map((row) => row[col].length)));
  return rows.map((row) => row
    .map((cell, col) => (col === 0 ? cell.padEnd(widths[col]) : cell.padStart(widths[col])))
    .join('  ')).join('\n');
}

module.exports = {
  DEMO_PROFILE_NAME_PATTERN,
  DEMO_PROFILE_DESCRIPTION,
  LAYER4_TABLES,
  USAGE,
  UsageError,
  scopeParams,
  SCOPE_PROFILE_IDS_SQL,
  SCOPE_QUERY_IDS_SQL,
  SCOPE_RESULT_IDS_SQL,
  SCOPE_CANDIDATE_IDS_SQL,
  SCOPE_PRESET_COUNT_SQL,
  countsSql,
  residueSql,
  deletePlan,
  parseArgs,
  validateRun,
  residueProblems,
  formatCounts,
};
