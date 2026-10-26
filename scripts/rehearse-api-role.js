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
// THE CONTRACT IS NOT DEFINED HERE. The privilege table, the GRANT block and the
// self-check live in `scripts/lib/api-role.js`, which this script, the shared
// apply (`scripts/apply-api-role.js`) and the smoke test
// (`scripts/smoke-api-role.js`) all consume; the Layer 4 row bookkeeping it uses
// to clean up after itself lives in `scripts/lib/pass-rows.js`. This file owns
// the RUN: the order, the second connection, the assertions, the teardown.
//
// WHAT IT PROVES, in order
//   1. the role does not already exist — it REFUSES if it does (see SAFETY);
//   2. the CREATE ROLE + GRANT block applies cleanly as the database owner;
//   3. a SECOND connection, authenticated AS morocco_pc_api, drives the API's
//      whole POST write path — selectActiveScoringModel -> catalogVersion ->
//      createRecommendationQuery -> runFullRun -> readRecommendationResult —
//      issuing ZERO statements that fail 42501 (insufficient_privilege);
//   4. the self-check's 21 privilege answers match the fixture exactly: an
//      expectation with no answer is a FAILURE, never a skip;
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
//     CONNECTION off shared, and the role is removed again in `finally` — but
//     ONLY when THIS run created it (`removeCreatedRole`). That gate is the
//     guard's promise made executable: refusing to start on an existing role
//     would be undone by a cleanup that swept and dropped it anyway. Two guards
//     make a leak impossible to miss: the refusal, and a teardown that fails
//     exiting non-zero.
//   * Teardown is the REVOKE SWEEP from `scripts/lib/api-role.js`
//     (`buildTeardownStatements`), not a bare DROP ROLE: measured 2026-10-17,
//     `DROP ROLE` fails 2BP01 while the role holds the grants, and `DROP OWNED
//     BY` is refused 42501 because the owner is not a MEMBER of the role.
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
const apiRole = require('./lib/api-role');
const passRows = require('./lib/pass-rows');
const repository = require('../apps/api/src/repository');
const engine = require('../apps/api/src/engine');

/**
 * Decision 46: this harness is not a deploy, but it writes real rows, so it
 * names ITSELF as the engine version rather than claiming a deploy's identity or
 * leaving the column NULL with no way to tell which tool wrote it.
 */
const REHEARSAL_ENGINE_VERSION = 'rehearse-api-role';

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

/**
 * Remove a role this run created. THE ONLY place the rehearsal drops a role.
 *
 * `createdByThisRun` is the guard's own promise made executable: the script
 * REFUSES to start when `morocco_pc_api` already exists, so its cleanup must
 * not then delete that role. Measured before this helper existed: a refusal
 * still fell through to the `finally`, swept the grants and dropped the role it
 * had just declined to touch.
 *
 * The sweep runs first because `DROP ROLE` fails 2BP01 while the grants are
 * held (see the header); the verification SELECT runs last, so a sweep that
 * silently did nothing is detected rather than assumed.
 *
 * @param {object} client pg-compatible client, as the database owner
 * @param {string} roleName the role to remove
 * @param {boolean} createdByThisRun false means ISSUE NOTHING
 * @returns {Promise<{attempted: boolean, removed: boolean|null, failures: string[]}>}
 */
async function removeCreatedRole(client, roleName, createdByThisRun) {
  if (createdByThisRun !== true) {
    return { attempted: false, removed: null, failures: [] };
  }
  const failures = [];
  for (const statement of apiRole.buildTeardownStatements(roleName)) {
    try {
      await client.query(statement);
    } catch (error) {
      failures.push('teardown: ' + statement + ' :: ' + error.message);
    }
  }
  try {
    await client.query('DROP ROLE ' + roleName);
  } catch (error) {
    failures.push('DROP ROLE ' + roleName + ' :: ' + error.message);
  }
  let removed = null;
  try {
    const gone = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [roleName]);
    removed = gone.rows.length === 0;
  } catch (error) {
    failures.push('verifying the role is gone: ' + error.message);
  }
  return { attempted: true, removed, failures };
}

function parseArgs(argv) {
  if (argv.includes('--help')) {
    const usage = Object.assign(new Error(
      'usage: node scripts/rehearse-api-role.js [--budget=N] [--use-case=U] [--test-db] [--help]\n'
      + 'Rehearses the production role ' + apiRole.API_ROLE_NAME + ' on the TEST branch: creates it, drives the\n'
      + 'API POST write path as it, asserts all ' + apiRole.PRIVILEGE_EXPECTATIONS.length + ' privilege answers, proves a\n'
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

async function main() {
  const args = parseArgs(process.argv);
  const config = getWriteTestDbUrl();
  const directUrl = toDirectUrl(config.connectionString);
  const target = describeTarget(directUrl);
  const password = crypto.randomBytes(24).toString('base64url');
  const roleName = apiRole.API_ROLE_NAME;

  const owner = new Client(Object.assign({}, config, {
    connectionString: directUrl,
    application_name: 'morocco-pc-rehearse-api-role',
  }));
  let roleClient = null;
  // Did THIS run create the role? Cleanup is gated on it (removeCreatedRole):
  // the existing-role guard below refuses to touch a role someone else created,
  // and the teardown must keep that promise.
  let roleCreated = false;

  const roleStatements = [];
  const ids = { queryId: null, profileId: null };
  const cleanupFailures = [];

  const report = {
    tool: 'rehearse-api-role',
    role: roleName,
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
    const existing = await owner.query('SELECT rolsuper, rolcanlogin FROM pg_roles WHERE rolname = $1', [roleName]);
    if (existing.rows.length > 0) {
      throw new Error('role ' + roleName + ' ALREADY EXISTS on this instance; refusing to touch it.'
        + ' The rehearsal only creates a role it can also prove it removed. Drop it deliberately, or'
        + ' rehearse on a branch where it does not exist.');
    }
    report.assertions.role_was_absent_before = true;

    report.owner = {
      database: (await owner.query('SELECT current_database() AS d')).rows[0].d,
      role_attributes: (await owner.query('SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user')).rows[0],
    };
    report.residue_before = await passRows.layer4Counts(owner);

    // ---- Step 2a: create the role and apply the grants -----------------------
    // The CREATE is separated from the GRANTs so `roleCreated` is set BEFORE the
    // rest: a failure part-way through the grants must still roll back a role
    // this run created. `buildGrantStatements` puts CREATE ROLE first by
    // construction, pinned by scripts/lib/api-role.test.js.
    const grants = apiRole.buildGrantStatements(roleName, password);
    await owner.query(grants[0]);
    roleCreated = true;
    for (const statement of grants.slice(1)) await owner.query(statement);
    report.grants_applied = grants.length;

    // Every self-check table name is unqualified, so the search_path is pinned
    // explicitly: a branch client can otherwise default to pg_temp.
    await owner.query('SET search_path = public');

    const roleRow = await owner.query(
      'SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname = $1',
      [roleName]
    );
    report.role_row = roleRow.rows[0];
    report.table_owners = (await owner.query(
      "SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1) ORDER BY tablename",
      [['product', 'store_offer', 'build_candidate']]
    )).rows;
    report.assertions.role_is_not_superuser = report.role_row.rolsuper === false;
    report.assertions.no_probed_table_is_owned_by_the_role = report.table_owners.every((row) => row.tableowner !== roleName);

    // ---- Step 1/3: the 21-answer self-check, compared to the fixture ---------
    const selfCheck = await owner.query(apiRole.buildSelfCheckSql(roleName));
    const verdict = apiRole.comparePrivilegeAnswers(selfCheck.rows, roleName);
    report.privilege_self_check = {
      assertions: apiRole.PRIVILEGE_EXPECTATIONS.length,
      answered: selfCheck.rows.length,
      matched: verdict.checks.filter((check) => check.ok).length,
      missing: verdict.missing,
      mismatches: verdict.mismatches,
      unexpected: verdict.unexpected,
      checks: verdict.checks.map((check) => ({ id: check.id, expected: check.expected, actual: check.actual, ok: check.ok })),
    };

    // ---- Step 2b: a second connection, authenticated AS the role -------------
    roleClient = new Client({
      connectionString: apiRole.roleConnectionString(directUrl, roleName, password),
      connectionTimeoutMillis: config.connectionTimeoutMillis,
      statement_timeout: 10000,
      application_name: 'morocco-pc-rehearse-api-role-as-role',
    });
    instrumentRoleClient(roleClient, roleStatements);
    await roleClient.connect();
    const identity = await roleClient.query('SELECT current_user AS u, session_user AS s, current_database() AS db');
    report.role_connection = identity.rows[0];
    if (identity.rows[0].u !== roleName) {
      throw new Error('the second connection is NOT ' + roleName + ' (it reports ' + identity.rows[0].u + ')');
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
      if (ids.queryId === null) {
        // Nothing was written, so a before/after snapshot would measure an
        // empty write. UNMEASURED, not clean - and never a failure.
        report.assertions.residue_clean = null;
        report.residue_note = 'the run wrote no pass, so residue was never measured';
      } else {
        report.residue_removed = await passRows.deletePassRows(owner, ids);
        report.residue_after = await passRows.layer4Counts(owner);
        const drifted = passRows.residueDrift(report.residue_before, report.residue_after);
        report.assertions.residue_clean = drifted.length === 0;
        report.residue_drifted_tables = drifted;
        if (drifted.length > 0) {
          ok = false;
          cleanupFailures.push('residue: ' + JSON.stringify(drifted));
        }
      }
    } catch (error) {
      ok = false;
      cleanupFailures.push('deleting the rehearsal rows: ' + error.message);
    }

    try {
      const cleanup = await removeCreatedRole(owner, roleName, roleCreated);
      report.assertions.role_removed = cleanup.removed;
      if (cleanup.attempted === false) {
        report.role_cleanup_note = 'this run did not create the role, so it did not touch it';
      }
      if (cleanup.failures.length > 0) {
        ok = false;
        cleanupFailures.push.apply(cleanupFailures, cleanup.failures);
      }
      if (cleanup.removed === false) {
        ok = false;
        cleanupFailures.push('role ' + roleName + ' is STILL present after teardown');
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
// can check the CLI. The guard below is what makes that safe: `require()` must
// never create a role.
module.exports = {
  REHEARSAL_ENGINE_VERSION,
  parseArgs,
  removeCreatedRole,
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
