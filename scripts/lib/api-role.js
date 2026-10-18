'use strict';

// scripts/lib/api-role.js — the production database role's privilege contract,
// and nothing else. PURE: no I/O, no clock, no environment reads.
//
// WHY THIS MODULE OWNS IT
// The role `morocco_pc_api` is described by the operator-facing block in
// `docs/API.md` § "Production mode" and is exercised by three scripts, so the
// contract has exactly ONE owner rather than a copy per consumer:
//
//   * `scripts/rehearse-api-role.js` — creates the role on the TEST branch,
//     drives the API's write path through it, then removes it (P3 Sprint 2
//     Steps 1-4, measured 2026-10-17);
//   * `scripts/apply-api-role.js` — applies the role to a target database, the
//     owner-gated Step 5;
//   * `scripts/smoke-api-role.js` — proves the API itself runs as the role.
//
// The GRANT builder and the EXPECTATION table live side by side ON PURPOSE, and
// the expectations are written out LITERALLY rather than derived from the
// grants: deriving them would let a wrong grant rewrite its own expectation, so
// a rehearsal could report 20/20 while claiming a privilege the operator script
// never granted. Written literally, the two must agree, and a unit test asserts
// that every expectation expecting `true` is satisfiable by the statements
// `buildGrantStatements()` emits.
//
// The privilege set itself is Decision 46 item 1 + item 7: SELECT on the whole
// `public` schema (the catalog and `scoring_model` are read-only inputs), INSERT
// on the six Layer 4 tables, DELETE on `build_rejection` ONLY (Decision 31's
// replace-idempotence), and THREE column-scoped UPDATEs — never a row-wide one,
// so `has_table_privilege(...,'UPDATE')` stays `f` on both tables while a role
// cannot rewrite a row it merely inserted.

/** The one role name this contract describes. */
const API_ROLE_NAME = 'morocco_pc_api';

/** A role name is interpolated into DDL, so it is validated, never trusted. */
const ROLE_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

/** The six Layer 4 tables the API's write path INSERTs into. */
const WRITE_TARGET_TABLES = Object.freeze([
  'recommendation_profile',
  'recommendation_query',
  'build_candidate',
  'build_component',
  'recommendation_result',
  'build_rejection',
]);

/** The ONE table the write path deletes from (Decision 31 replace-idempotence). */
const DELETE_TARGET_TABLES = Object.freeze(['build_rejection']);

/** Decision 46 item 7: exactly three columns may be UPDATEd, never a whole row. */
const COLUMN_UPDATE_GRANTS = Object.freeze([
  Object.freeze({ table: 'recommendation_query', columns: Object.freeze(['budget_floor']) }),
  Object.freeze({ table: 'recommendation_result', columns: Object.freeze(['engine_version', 'strategy_key']) }),
]);

/**
 * The 20 privilege answers the production role must give, written out LITERALLY
 * (see the header). The composition — 3 table-level `false` for `product`
 * (INSERT/UPDATE/DELETE) plus 2 for `store_offer` (INSERT/DELETE), 1 `true` for
 * `product` SELECT, the six INSERT targets all `true`, `build_component` DELETE
 * `false` and `build_rejection` DELETE `true`, the two row-wide UPDATEs `false`,
 * and the three column-scoped UPDATEs `true` — is asserted in
 * `scripts/lib/api-role.test.js`.
 */
const PRIVILEGE_EXPECTATIONS = Object.freeze([
  Object.freeze({ id: 'schema_public_create', kind: 'SCHEMA', target: 'public', privilege: 'CREATE', expected: false }),
  Object.freeze({ id: 'product_insert', kind: 'TABLE', target: 'product', privilege: 'INSERT', expected: false }),
  Object.freeze({ id: 'product_update', kind: 'TABLE', target: 'product', privilege: 'UPDATE', expected: false }),
  Object.freeze({ id: 'product_delete', kind: 'TABLE', target: 'product', privilege: 'DELETE', expected: false }),
  Object.freeze({ id: 'product_select', kind: 'TABLE', target: 'product', privilege: 'SELECT', expected: true }),
  Object.freeze({ id: 'store_offer_insert', kind: 'TABLE', target: 'store_offer', privilege: 'INSERT', expected: false }),
  Object.freeze({ id: 'store_offer_delete', kind: 'TABLE', target: 'store_offer', privilege: 'DELETE', expected: false }),
  Object.freeze({ id: 'recommendation_profile_insert', kind: 'TABLE', target: 'recommendation_profile', privilege: 'INSERT', expected: true }),
  Object.freeze({ id: 'recommendation_query_insert', kind: 'TABLE', target: 'recommendation_query', privilege: 'INSERT', expected: true }),
  Object.freeze({ id: 'build_candidate_insert', kind: 'TABLE', target: 'build_candidate', privilege: 'INSERT', expected: true }),
  Object.freeze({ id: 'build_component_insert', kind: 'TABLE', target: 'build_component', privilege: 'INSERT', expected: true }),
  Object.freeze({ id: 'recommendation_result_insert', kind: 'TABLE', target: 'recommendation_result', privilege: 'INSERT', expected: true }),
  Object.freeze({ id: 'build_rejection_insert', kind: 'TABLE', target: 'build_rejection', privilege: 'INSERT', expected: true }),
  Object.freeze({ id: 'build_component_delete', kind: 'TABLE', target: 'build_component', privilege: 'DELETE', expected: false }),
  Object.freeze({ id: 'build_rejection_delete', kind: 'TABLE', target: 'build_rejection', privilege: 'DELETE', expected: true }),
  Object.freeze({ id: 'recommendation_query_update', kind: 'TABLE', target: 'recommendation_query', privilege: 'UPDATE', expected: false }),
  Object.freeze({ id: 'recommendation_result_update', kind: 'TABLE', target: 'recommendation_result', privilege: 'UPDATE', expected: false }),
  Object.freeze({ id: 'recommendation_query_budget_floor_update', kind: 'COLUMN', target: 'recommendation_query', column: 'budget_floor', privilege: 'UPDATE', expected: true }),
  Object.freeze({ id: 'recommendation_result_engine_version_update', kind: 'COLUMN', target: 'recommendation_result', column: 'engine_version', privilege: 'UPDATE', expected: true }),
  Object.freeze({ id: 'recommendation_result_strategy_key_update', kind: 'COLUMN', target: 'recommendation_result', column: 'strategy_key', privilege: 'UPDATE', expected: true }),
]);

function fail(message) {
  throw new Error(message);
}

/** Refuse anything that is not a plain role identifier (it is interpolated into DDL). */
function assertRoleName(roleName) {
  if (typeof roleName !== 'string' || !ROLE_NAME_PATTERN.test(roleName)) {
    fail('role name ' + JSON.stringify(roleName) + ' is not a plain identifier and cannot be interpolated into DDL');
  }
  return roleName;
}

/** A single-quoted SQL literal (a password and the self-check labels are text). */
function quoteSqlLiteral(value) {
  if (typeof value !== 'string') fail('quoteSqlLiteral requires a string, received ' + typeof value);
  return "'" + value.replace(/'/g, "''") + "'";
}

/**
 * The catalog call one expectation stands on.
 *
 * The three function names are catalog builtins, so they are NOT schema-qualified
 * or quoted; the role, relation, column and privilege are all literals.
 *
 * @param {object} entry one PRIVILEGE_EXPECTATIONS row
 * @param {string} roleName
 * @returns {string} the SQL expression, e.g. `has_column_privilege('r','t','c','UPDATE')`
 */
function privilegeExpression(entry, roleName) {
  assertRoleName(roleName);
  const role = quoteSqlLiteral(roleName);
  if (entry.kind === 'SCHEMA') {
    return 'has_schema_privilege(' + role + ',' + quoteSqlLiteral(entry.target) + ',' + quoteSqlLiteral(entry.privilege) + ')';
  }
  if (entry.kind === 'TABLE') {
    return 'has_table_privilege(' + role + ',' + quoteSqlLiteral(entry.target) + ',' + quoteSqlLiteral(entry.privilege) + ')';
  }
  if (entry.kind === 'COLUMN') {
    return 'has_column_privilege(' + role + ',' + quoteSqlLiteral(entry.target) + ','
      + quoteSqlLiteral(entry.column) + ',' + quoteSqlLiteral(entry.privilege) + ')';
  }
  fail('unknown privilege-check kind: ' + entry.kind);
  return '';
}

/**
 * ONE statement answering all 20 expectations, labelled by id. One round trip,
 * and the labels are what let a missing answer be detected rather than guessed.
 */
function buildSelfCheckSql(roleName) {
  const branches = PRIVILEGE_EXPECTATIONS.map((entry) => 'SELECT ' + quoteSqlLiteral(entry.id)
    + ' AS id, ' + privilegeExpression(entry, roleName) + ' AS allowed');
  return branches.join(' UNION ALL ') + ' ORDER BY 1';
}

/**
 * Compare the self-check's answers to the fixture. Pure.
 *
 * A missing answer, an unexpected answer and a wrong answer are all failures —
 * none is a skip, because a self-check that silently drops a row would report
 * "20 of 20" on a role that was never asked about one of them.
 *
 * @param {Array<{id: string, allowed: boolean|null}>} rows the self-check result rows
 * @param {string} [roleName]
 * @returns {{ok: boolean, checks: Array<object>, mismatches: string[],
 *           missing: string[], unexpected: string[]}}
 */
function comparePrivilegeAnswers(rows, roleName = API_ROLE_NAME) {
  if (!Array.isArray(rows)) fail('comparePrivilegeAnswers requires an array of self-check rows');
  const byId = new Map();
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || typeof row.id !== 'string') {
      fail('every self-check row must carry a string id');
    }
    if (byId.has(row.id)) fail('the self-check answered ' + row.id + ' twice');
    byId.set(row.id, row.allowed === null || row.allowed === undefined ? null : Boolean(row.allowed));
  }

  const checks = [];
  const expectedIds = new Set();
  for (const entry of PRIVILEGE_EXPECTATIONS) {
    expectedIds.add(entry.id);
    const answered = byId.has(entry.id);
    const actual = answered ? byId.get(entry.id) : null;
    checks.push({
      id: entry.id,
      expression: privilegeExpression(entry, roleName),
      expected: entry.expected,
      actual,
      answered,
      ok: answered && actual !== null && actual === entry.expected,
    });
  }

  const missing = checks.filter((check) => !check.answered).map((check) => check.id);
  const mismatches = checks
    .filter((check) => check.answered && (check.actual === null || check.actual !== check.expected))
    .map((check) => check.id);
  const unexpected = Array.from(byId.keys()).filter((id) => !expectedIds.has(id)).sort();

  return {
    ok: missing.length === 0 && mismatches.length === 0 && unexpected.length === 0,
    checks,
    mismatches,
    missing,
    unexpected,
  };
}

/**
 * The operator-facing CREATE ROLE + GRANT block from docs/API.md, one statement
 * per element so a failure names the statement it came from.
 */
function buildGrantStatements(roleName, password) {
  assertRoleName(roleName);
  if (typeof password !== 'string' || password.length === 0) fail('buildGrantStatements requires a password');
  return [
    'CREATE ROLE ' + roleName + ' LOGIN PASSWORD ' + quoteSqlLiteral(password),
    'GRANT USAGE ON SCHEMA public TO ' + roleName,
    'GRANT SELECT ON ALL TABLES IN SCHEMA public TO ' + roleName,
    'GRANT INSERT ON ' + WRITE_TARGET_TABLES.join(', ') + ' TO ' + roleName,
    'GRANT DELETE ON ' + DELETE_TARGET_TABLES.join(', ') + ' TO ' + roleName,
    ...COLUMN_UPDATE_GRANTS.map((grant) => 'GRANT UPDATE (' + grant.columns.join(', ') + ') ON '
      + grant.table + ' TO ' + roleName),
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ' + roleName,
  ];
}

/**
 * The same statements with the password REDACTED, for a dry run that must be
 * safe to paste into an issue or a doc.
 */
function buildGrantStatementsRedacted(roleName) {
  assertRoleName(roleName);
  return buildGrantStatements(roleName, 'PASSWORD').map((statement) => statement
    .replace(' LOGIN PASSWORD ' + quoteSqlLiteral('PASSWORD'), " LOGIN PASSWORD '<redacted>'"));
}

/**
 * The REVOKE sweep that must precede DROP ROLE.
 *
 * Measured 2026-10-17: while the role holds the grants, `DROP ROLE` fails 2BP01
 * ("cannot be dropped because some objects depend on it" — one `pg_shdepend` row
 * per granted object) and `DROP OWNED BY` is refused 42501 because the owner is
 * not a MEMBER of the role it just created. Revoking these four scopes empties
 * `pg_shdepend` and DROP ROLE then succeeds (measured: 44 -> 0). The `DROP ROLE`
 * itself is issued by the caller AFTER this sweep, never inside it.
 */
function buildTeardownStatements(roleName) {
  assertRoleName(roleName);
  return [
    'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ' + roleName,
    'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ' + roleName,
    'REVOKE ALL ON SCHEMA public FROM ' + roleName,
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ' + roleName,
  ];
}

/**
 * A connection string for the SAME database, authenticated as another role.
 *
 * The replacement is total on purpose: the owner's password never travels into
 * the returned string. The generated passwords this repo uses are 24 random
 * bytes rendered base64url (`[A-Za-z0-9_-]`), a charset that needs no escaping
 * in a URL's userinfo, so it travels verbatim; the setters would percent-encode
 * anything else. The result carries a credential and must never be logged.
 */
function roleConnectionString(connectionString, roleName, password) {
  assertRoleName(roleName);
  if (typeof connectionString !== 'string' || connectionString === '') fail('roleConnectionString requires a connection string');
  if (typeof password !== 'string' || password.length === 0) fail('roleConnectionString requires a password');
  const url = new URL(connectionString);
  url.username = roleName;
  url.password = password;
  return url.href;
}

/** The statements that remove the role, sweep first — the exact rollback order. */
function buildRemovalStatements(roleName) {
  return buildTeardownStatements(roleName).concat(['DROP ROLE ' + assertRoleName(roleName)]);
}

module.exports = {
  API_ROLE_NAME,
  COLUMN_UPDATE_GRANTS,
  DELETE_TARGET_TABLES,
  PRIVILEGE_EXPECTATIONS,
  ROLE_NAME_PATTERN,
  WRITE_TARGET_TABLES,
  assertRoleName,
  buildGrantStatements,
  buildGrantStatementsRedacted,
  buildRemovalStatements,
  buildSelfCheckSql,
  buildTeardownStatements,
  comparePrivilegeAnswers,
  privilegeExpression,
  quoteSqlLiteral,
  roleConnectionString,
};
