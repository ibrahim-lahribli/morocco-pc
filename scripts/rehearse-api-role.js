'use strict';

// scripts/rehearse-api-role.js — rehearse the production database role on the
// TEST branch and assert every privilege it is supposed to have.
//
// Platform P3 Sprint 2, Steps 1-4 (spec: PLAN_PLATFORM_P3.md; the role script
// itself is the operator-facing block in docs/API.md, section "Production
// mode"). This file is the rehearsal of THAT block, on the disposable branch, so
// the shared apply (Sprint 2 Step 5, owner-gated) is a measured step rather than
// a hope.
//
// WHAT IT PROVES, in order
//   1. the role does not already exist — it REFUSES if it does (see SAFETY);
//   2. the CREATE ROLE + GRANT block applies cleanly as the database owner;
//   3. a SECOND connection, authenticated AS morocco_pc_api, drives the API's
//      whole POST write path — selectActiveScoringModel -> catalogVersion ->
//      createRecommendationQuery -> runFullRun -> readRecommendationResult —
//      issuing ZERO statements that fail 42501 (insufficient_privilege);
//   4. the self-check's 20 privilege answers match PRIVILEGE_EXPECTATIONS
//      exactly: an expectation with no answer is a FAILURE, never a skip;
//   5. the NEGATIVE direction: a row-wide UPDATE is DENIED 42501 while the three
//      column-scoped UPDATEs SUCCEED. A privilege test that only walks the
//      allowed paths cannot distinguish a correctly-scoped role from an
//      over-granted one;
//   6. cleanup: the pass's own rows are deleted back to their pre-run counts and
//      the role is GONE from pg_roles.
//
// SAFETY
//   * The target comes from getWriteTestDbUrl() — the same TEST_DATABASE_URL
//     guard every write-capable script uses — so it can never connect to the
//     shared database. The DIRECT host is used: Neon's pooled (PgBouncer
//     transaction-mode) host would not carry a session-level SET.
//   * CREATE ROLE is CLUSTER-scoped, not a row. The branch guard keeps the
//     CONNECTION off shared, and the role is removed again in `finally`. Two
//     guards make a leak impossible to miss: the script REFUSES to start when
//     `morocco_pc_api` already exists — a `DROP ROLE IF EXISTS` first would
//     silently destroy a role someone else created — and a teardown that fails
//     exits non-zero.
//   * Teardown is a REVOKE SWEEP, not a bare DROP ROLE. Measured on this branch
//     2026-10-17: `DROP ROLE` fails 2BP01 ("cannot be dropped because some
//     objects depend on it") while the role holds the grants — the dependencies
//     are the privileges themselves, one pg_shdepend row per granted object —
//     and `DROP OWNED BY` is refused 42501 because the owner role is not a
//     MEMBER of the role being dropped. Revoking the table/schema/default
//     privileges empties pg_shdepend and DROP ROLE then succeeds (measured: 44
//     dependency rows -> 0, drop OK).
//   * No credential is ever printed. The rehearsal's password is generated here
//     (24 random bytes, base64url), used only for the role's own connection, and
//     discarded; the target line carries describeTarget()'s endpoint id, never a
//     host or a connection string.
//   * `SET search_path = public` precedes the self-check, because a branch client
//     can default to pg_temp (AGENTS.md §6) and the self-check names its tables
//     unqualified.
//
// WHAT IT DELIBERATELY DOES NOT DO
//   * No scoring-model pin. This rehearses the API's OWN selection (the active
//     model the POST route would use) and reports which model it ran, because
//     the question here is privileges, not measurement. Every comparison harness
//     pins (scripts/lib/model-pin.js); a role rehearsal must not.
//   * `findReusableQuery` is NOT called: a reuse hit runs no engine pass at all,
//     and running one is the point of this script. Dedupe is covered by
//     apps/api/test/db/dedupe.db.test.js.
//   * The three column-scoped UPDATEs are ALSO exercised incidentally by the pass
//     itself (Decision 46's pass-facts writer runs inside runFullRun), so step 5
//     repeats them explicitly rather than inferring them.
//
// Exit codes: 2 = usage (including --help), 1 = the rehearsal or its cleanup
// failed, 0 = every assertion above passed.
//
// Usage: node scripts/rehearse-api-role.js [--budget=N] [--use-case=U] [--help]

require('dotenv').config();

const crypto = require('crypto');
const { Client } = require('pg');

const { getWriteTestDbUrl, describeTarget, toDirectUrl } = require('./lib/db-url');
const repository = require('../apps/api/src/repository');
const engine = require('../apps/api/src/engine');

/**
 * Decision 46: this harness is not a deploy, but it writes real rows, so it
 * names ITSELF as the engine version rather than claiming a deploy's identity or
 * leaving the column NULL with no way to tell which tool wrote it.
 */
const REHEARSAL_ENGINE_VERSION = 'rehearse-api-role';

/** The one role name this rehearsal creates, grants, probes and removes. */
const API_ROLE_NAME = 'morocco_pc_api';

/** A role name is interpolated into DDL, so it is validated, never trusted. */
const ROLE_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

/** The six Layer 4 tables the write path INSERTs into (Decision 46 item 1). */
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

/** Every Layer 4 table, for the pre/post row-count baseline. */
const LAYER4_TABLES = Object.freeze([
  'recommendation_profile',
  'recommendation_query',
  'build_candidate',
  'build_component',
  'recommendation_result',
  'build_rejection',
]);

/**
 * The 20 privilege answers the production role must give, written out LITERALLY
 * rather than derived from the grants above.
 *
 * That redundancy is the point: the grants are what the script APPLIES and this
 * table is what docs/API.md SAYS the role has, so a wrong grant cannot quietly
 * rewrite its own expectation. The composition — 3 table-level `false` for
 * `product` (INSERT/UPDATE/DELETE) plus 2 for `store_offer` (INSERT/DELETE), 1
 * `true` for `product` SELECT, the six INSERT targets all `true`,
 * `build_component` DELETE `false` and `build_rejection` DELETE `true`, the two
 * row-wide UPDATEs `false`, and the three column-scoped UPDATEs `true` — is
 * asserted in scripts/lib/rehearse-api-role-cli.test.js.
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

/** A single-quoted SQL literal (the password and the self-check labels are text). */
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
 * The REVOKE sweep that must precede DROP ROLE (see the header: the privileges
 * ARE the dependencies, so `DROP ROLE` alone fails 2BP01).
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
 * the returned string, and the WHATWG setters percent-encode what they are
 * given, so a generated password needs no escaping. The result carries a
 * credential and must never be logged.
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

function parseArgs(argv) {
  if (argv.includes('--help')) {
    const usage = Object.assign(new Error(
      'usage: node scripts/rehearse-api-role.js [--budget=N] [--use-case=U] [--test-db] [--help]\n'
      + 'Rehearses the production role ' + API_ROLE_NAME + ' on the TEST branch: creates it, drives the\n'
      + 'API POST write path as it, asserts all ' + PRIVILEGE_EXPECTATIONS.length + ' privilege answers, proves a\n'
      + 'row-wide UPDATE is denied, then removes the role. TEST branch only (TEST_DATABASE_URL guard).'
    ), { usage: true });
    throw usage;
  }

  const args = { budget: 20000, useCase: 'GAMING' };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--budget=')) {
      args.budget = Number(arg.slice('--budget='.length));
    } else if (arg.startsWith('--use-case=')) {
      args.useCase = arg.slice('--use-case='.length);
    } else if (arg === '--test-db') {
      // Accepted for symmetry with apply-seed.js: this script is ALWAYS the TEST branch.
      continue;
    } else {
      throw Object.assign(new Error('unknown argument: ' + arg + '\nusage: node scripts/rehearse-api-role.js [--budget=N] [--use-case=U] [--test-db] [--help]'), { usage: true });
    }
  }
  if (!Number.isFinite(args.budget) || args.budget <= 0) {
    throw Object.assign(new Error('--budget must be a positive finite number'), { usage: true });
  }
  if (typeof args.useCase !== 'string' || args.useCase.trim() === '') {
    throw Object.assign(new Error('--use-case must be a non-empty value'), { usage: true });
  }
  return args;
}

/** Record every statement the role's connection issues, and how each one ended. */
function instrumentRoleClient(client, sink) {
  const original = client.query.bind(client);
  client.query = function recordedQuery(...args) {
    const sqlArg = args[0];
    const sql = typeof sqlArg === 'string' ? sqlArg : (sqlArg && sqlArg.text) || String(sqlArg);
    const label = sql.replace(/\s+/g, ' ').trim().slice(0, 80);
    const promise = original(...args);
    if (promise && typeof promise.then === 'function') {
      return promise.then(
        (value) => { sink.push({ sql: label, error: null }); return value; },
        (error) => { sink.push({ sql: label, error: (error && error.code) || 'ERROR' }); throw error; }
      );
    }
    return promise;
  };
}

/** Row counts of the six Layer 4 tables, in one round trip. */
async function layer4Counts(client) {
  const sql = LAYER4_TABLES
    .map((table) => "SELECT '" + table + "' AS table_name, count(*)::int AS n FROM " + table)
    .join(' UNION ALL ');
  const result = await client.query(sql + ' ORDER BY 1');
  const counts = {};
  for (const row of result.rows) counts[row.table_name] = Number(row.n);
  return counts;
}

/** Delete THIS rehearsal's rows, children first (spec tables FKs are NO ACTION). */
async function deleteRehearsalRows(client, ids) {
  const removed = {};
  if (!ids.queryId) return removed;
  const steps = [
    ['build_rejection', 'DELETE FROM build_rejection WHERE recommendation_query_id = $1::uuid'],
    ['recommendation_result', 'DELETE FROM recommendation_result WHERE recommendation_query_id = $1::uuid'],
    ['build_component', 'DELETE FROM build_component WHERE build_candidate_id IN (SELECT id FROM build_candidate WHERE recommendation_query_id = $1::uuid)'],
    ['build_candidate', 'DELETE FROM build_candidate WHERE recommendation_query_id = $1::uuid'],
    ['recommendation_query', 'DELETE FROM recommendation_query WHERE id = $1::uuid'],
  ];
  for (const [table, sql] of steps) {
    const result = await client.query(sql, [ids.queryId]);
    removed[table] = result.rowCount;
  }
  if (ids.profileId) {
    const result = await client.query('DELETE FROM recommendation_profile WHERE id = $1::uuid', [ids.profileId]);
    removed.recommendation_profile = result.rowCount;
  }
  return removed;
}

/** Run one statement that MUST be refused with 42501. */
async function expectPrivilegeDenied(client, sql, params) {
  try {
    await client.query(sql, params);
  } catch (error) {
    return { code: (error && error.code) || null, message: (error && error.message) || String(error), denied: error && error.code === '42501' };
  }
  return { code: null, message: null, denied: false };
}

/** Run one statement that MUST be allowed (the positive half of Step 4). */
async function expectPrivilegeAllowed(client, sql, params) {
  try {
    const result = await client.query(sql, params);
    return { allowed: true, row_count: result.rowCount, code: null, message: null };
  } catch (error) {
    return { allowed: false, row_count: null, code: (error && error.code) || null, message: (error && error.message) || String(error) };
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const config = getWriteTestDbUrl();
  const directUrl = toDirectUrl(config.connectionString);
  const target = describeTarget(directUrl);
  const password = crypto.randomBytes(24).toString('base64url');

  const owner = new Client(Object.assign({}, config, {
    connectionString: directUrl,
    application_name: 'morocco-pc-rehearse-api-role',
  }));
  let roleClient = null;

  const roleStatements = [];
  const ids = { queryId: null, profileId: null };
  const cleanupFailures = [];

  const report = {
    tool: 'rehearse-api-role',
    role: API_ROLE_NAME,
    target: {
      endpoint: target.endpointId,
      mode: target.pooled ? 'pooled' : 'direct',
      database: target.database,
      guard: 'getWriteTestDbUrl (TEST_DATABASE_URL)',
    },
    input: { budget: args.budget, currency: 'MAD', use_case: args.useCase },
    assertions: {},
  };

  let ok = true;

  try {
    await owner.connect();
    const probe = await owner.query('SELECT 1 AS ok');
    if (probe.rows.length !== 1) throw new Error('TEST branch preflight SELECT 1 returned no rows');

    // Guard: never mutate a role someone else created.
    const existing = await owner.query('SELECT rolsuper, rolcanlogin FROM pg_roles WHERE rolname = $1', [API_ROLE_NAME]);
    if (existing.rows.length > 0) {
      throw new Error('role ' + API_ROLE_NAME + ' ALREADY EXISTS on this instance; refusing to touch it.'
        + ' The rehearsal only creates a role it can also prove it removed. Drop it deliberately, or'
        + ' rehearse on a branch where it does not exist.');
    }
    report.assertions.role_was_absent_before = true;

    report.owner = {
      database: (await owner.query('SELECT current_database() AS d')).rows[0].d,
      role_attributes: (await owner.query('SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user')).rows[0],
    };
    report.residue_before = await layer4Counts(owner);

    // ---- Step 2a: create the role and apply the grants -----------------------
    const grants = buildGrantStatements(API_ROLE_NAME, password);
    for (const statement of grants) await owner.query(statement);
    report.grants_applied = grants.length;

    // Every self-check table name is unqualified, so the search_path is pinned
    // explicitly: a branch client can otherwise default to pg_temp.
    await owner.query('SET search_path = public');

    const roleRow = await owner.query(
      'SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname = $1',
      [API_ROLE_NAME]
    );
    report.role_row = roleRow.rows[0];
    report.table_owners = (await owner.query(
      "SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1) ORDER BY tablename",
      [['product', 'store_offer', 'build_candidate']]
    )).rows;
    report.assertions.role_is_not_superuser = report.role_row.rolsuper === false;
    report.assertions.no_probed_table_is_owned_by_the_role = report.table_owners.every((row) => row.tableowner !== API_ROLE_NAME);

    // ---- Step 1/3: the 20-answer self-check, compared to the fixture ---------
    const selfCheck = await owner.query(buildSelfCheckSql(API_ROLE_NAME));
    const verdict = comparePrivilegeAnswers(selfCheck.rows, API_ROLE_NAME);
    report.privilege_self_check = {
      assertions: PRIVILEGE_EXPECTATIONS.length,
      answered: selfCheck.rows.length,
      matched: verdict.checks.filter((check) => check.ok).length,
      missing: verdict.missing,
      mismatches: verdict.mismatches,
      unexpected: verdict.unexpected,
      checks: verdict.checks.map((check) => ({ id: check.id, expected: check.expected, actual: check.actual, ok: check.ok })),
    };

    // ---- Step 2b: a second connection, authenticated AS the role -------------
    roleClient = new Client({
      connectionString: roleConnectionString(directUrl, API_ROLE_NAME, password),
      connectionTimeoutMillis: config.connectionTimeoutMillis,
      statement_timeout: 10000,
      application_name: 'morocco-pc-rehearse-api-role-as-role',
    });
    instrumentRoleClient(roleClient, roleStatements);
    await roleClient.connect();
    const identity = await roleClient.query('SELECT current_user AS u, session_user AS s, current_database() AS db');
    report.role_connection = identity.rows[0];
    if (identity.rows[0].u !== API_ROLE_NAME) {
      throw new Error('the second connection is NOT ' + API_ROLE_NAME + ' (it reports ' + identity.rows[0].u + ')');
    }

    // ---- Step 2c: the API's POST write path, as the role --------------------
    const model = await repository.selectActiveScoringModel(roleClient);
    if (model === null) throw new Error('no active scoring model on this target; the POST path cannot be rehearsed');
    report.active_path = { scoring_model_id: model.id, engine_version: REHEARSAL_ENGINE_VERSION };

    // Decision 47: the route degrades to "not recorded" when the digest fails —
    // but a 42501 is never a degradation, so it is rethrown.
    let catalogVersion;
    try {
      catalogVersion = await engine.catalogVersion(roleClient);
    } catch (error) {
      if (error && error.code === '42501') throw error;
      catalogVersion = undefined;
    }
    report.active_path.catalog_version_recorded = typeof catalogVersion === 'string';

    const created = await repository.createRecommendationQuery(roleClient, {
      scoringModelId: model.id,
      budgetAmount: args.budget,
      currency: 'MAD',
      useCase: args.useCase,
      catalogVersion,
    });
    ids.queryId = created.queryId;
    ids.profileId = created.profileId;

    const runResult = await engine.runFullRun(roleClient, created.queryId, REHEARSAL_ENGINE_VERSION);
    const snapshot = await repository.readRecommendationResult(roleClient, created.queryId);
    report.active_path.builds = runResult.builds.length;
    report.active_path.budget_floor_recorded = runResult.budget_floor !== undefined && runResult.budget_floor !== null;
    report.active_path.read_back = { found: snapshot.found, rows: snapshot.found ? snapshot.rows.length : 0 };

    // Snapshot the allowed-path verdict BEFORE the deliberate 42501 below.
    const allowedPath = {
      statements: roleStatements.length,
      insufficient_privilege: roleStatements.filter((s) => s.error === '42501').length,
      other_errors: roleStatements.filter((s) => s.error !== null && s.error !== '42501').map((s) => ({ sql: s.sql, error: s.error })),
    };
    report.active_path.statements = allowedPath.statements;
    report.assertions.no_42501_on_the_allowed_path = allowedPath.insufficient_privilege === 0;
    report.active_path.errors = allowedPath.other_errors;
    report.assertions.pass_completed_as_the_role = snapshot.found === true;

    // ---- Step 4: the negative proof -----------------------------------------
    const rowWideUpdate = await expectPrivilegeDenied(
      roleClient,
      'UPDATE recommendation_result SET rank = rank WHERE recommendation_query_id = $1::uuid',
      [created.queryId]
    );
    report.negative_proof = { row_wide_update: rowWideUpdate };

    const queryColumnUpdate = await expectPrivilegeAllowed(
      roleClient,
      'UPDATE recommendation_query SET budget_floor = budget_floor WHERE id = $1::uuid',
      [created.queryId]
    );
    const resultColumnUpdate = await expectPrivilegeAllowed(
      roleClient,
      'UPDATE recommendation_result SET engine_version = engine_version, strategy_key = strategy_key'
      + ' WHERE recommendation_query_id = $1::uuid',
      [created.queryId]
    );
    report.negative_proof.column_scoped_updates = {
      recommendation_query_budget_floor: queryColumnUpdate,
      recommendation_result_engine_version_strategy_key: resultColumnUpdate,
    };

    report.assertions.row_wide_update_denied_42501 = rowWideUpdate.denied === true;
    report.assertions.column_scoped_updates_allowed = queryColumnUpdate.allowed === true && resultColumnUpdate.allowed === true;
    report.assertions.privilege_self_check_matches_fixture = verdict.ok === true;

    if (!report.assertions.row_wide_update_denied_42501) {
      throw new Error('a row-wide UPDATE was NOT denied (code ' + rowWideUpdate.code + '): the role is over-granted');
    }
    if (!report.assertions.column_scoped_updates_allowed) {
      throw new Error('a column-scoped UPDATE was refused: ' + JSON.stringify(report.negative_proof.column_scoped_updates));
    }
    if (!verdict.ok) {
      throw new Error('the privilege self-check did not match the fixture: missing ' + JSON.stringify(verdict.missing)
        + ', mismatches ' + JSON.stringify(verdict.mismatches) + ', unexpected ' + JSON.stringify(verdict.unexpected));
    }
    if (!report.assertions.no_42501_on_the_allowed_path) {
      throw new Error('the allowed path issued ' + allowedPath.insufficient_privilege + ' statement(s) refused 42501');
    }
    if (!report.assertions.role_is_not_superuser || !report.assertions.no_probed_table_is_owned_by_the_role) {
      throw new Error('the role is a superuser or owns a catalog table');
    }
  } catch (error) {
    ok = false;
    report.failure = (error && error.code ? error.code + ': ' : '') + ((error && error.message) || String(error));
  } finally {
    // Nothing in this block may throw: a throw here would skip the steps after it
    // (AGENTS.md §7 item "a throw inside a probe's finally skips every cleanup").
    try {
      if (roleClient !== null) {
        try { await roleClient.end(); } catch (_endError) { /* already closed */ }
      }
    } catch (error) {
      cleanupFailures.push('closing the role connection: ' + error.message);
    }

    try {
      report.residue_removed = await deleteRehearsalRows(owner, ids);
      report.residue_after = await layer4Counts(owner);
      const before = report.residue_before || {};
      const after = report.residue_after || {};
      const drifted = LAYER4_TABLES.filter((table) => (after[table] || 0) !== (before[table] || 0));
      report.assertions.residue_clean = drifted.length === 0;
      report.residue_drifted_tables = drifted;
      if (drifted.length > 0) {
        ok = false;
        cleanupFailures.push('residue: ' + JSON.stringify(drifted.map((table) => ({ table, before: before[table] || 0, after: after[table] || 0 }))));
      }
    } catch (error) {
      ok = false;
      cleanupFailures.push('deleting the rehearsal rows: ' + error.message);
    }

    try {
      const present = await owner.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [API_ROLE_NAME]);
      if (present.rows.length > 0) {
        for (const statement of buildTeardownStatements(API_ROLE_NAME)) {
          try {
            await owner.query(statement);
          } catch (error) {
            cleanupFailures.push('teardown: ' + statement + ' :: ' + error.message);
          }
        }
        try {
          await owner.query('DROP ROLE ' + API_ROLE_NAME);
        } catch (error) {
          cleanupFailures.push('DROP ROLE ' + API_ROLE_NAME + ' :: ' + error.message);
        }
      }
      const gone = await owner.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [API_ROLE_NAME]);
      report.assertions.role_removed = gone.rows.length === 0;
      if (!report.assertions.role_removed) {
        ok = false;
        cleanupFailures.push('role ' + API_ROLE_NAME + ' is STILL present after teardown');
      }
    } catch (error) {
      ok = false;
      cleanupFailures.push('tearing the role down: ' + error.message);
    }

    try { await owner.end(); } catch (_endError) { /* already closed */ }
  }

  report.cleanup_failures = cleanupFailures;
  report.statements_issued_as_the_role = roleStatements.length;
  report.ok = ok && cleanupFailures.length === 0;
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

// Exported so the DB-free contract tests (scripts/lib/rehearse-api-role-cli.test.js)
// can check the fixture, the SQL it generates and the CLI. The guard below is
// what makes that safe: `require()` must never create a role.
module.exports = {
  API_ROLE_NAME,
  COLUMN_UPDATE_GRANTS,
  DELETE_TARGET_TABLES,
  LAYER4_TABLES,
  PRIVILEGE_EXPECTATIONS,
  REHEARSAL_ENGINE_VERSION,
  WRITE_TARGET_TABLES,
  assertRoleName,
  buildGrantStatements,
  buildSelfCheckSql,
  buildTeardownStatements,
  comparePrivilegeAnswers,
  parseArgs,
  privilegeExpression,
  quoteSqlLiteral,
  roleConnectionString,
};

if (require.main === module) {
  // parseArgs and getWriteTestDbUrl both throw BEFORE main's own try block, so a
  // rejected promise is how a usage error or a guard refusal reaches the user.
  // Print the message alone: an unhandled rejection buries the usage text under
  // a Node stack trace.
  main().catch((error) => {
    const usage = Boolean(error && error.usage);
    console.error((usage ? 'USAGE: ' : 'REHEARSAL FAILED: ') + ((error && error.message) || String(error)));
    process.exit(usage ? 2 : 1);
  });
}
