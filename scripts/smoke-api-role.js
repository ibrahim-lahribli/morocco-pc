'use strict';

// scripts/smoke-api-role.js — prove the API itself RUNS as the production role.
//
// Platform P3 Sprint 2 Step 5, the step after `scripts/apply-api-role.js`. The
// procedure is `docs/RECIPES/provision-the-api-role.md`; this file is its smoke
// test, and what it adds over the apply's self-check is the API's OWN code path:
// the self-check answers what the role MAY do, this answers what the API really
// does with it — its pool guard, its routes, its repository statements and the
// engine's 74-statement write path, all as `morocco_pc_api`.
//
// WHY IT WRITES, AND WHY THAT IS THE POINT
// A read-only check (`GET /v1/health`, `GET /v1/meta/options`) would pass for a
// role with no INSERT grant at all, so it would prove nothing about the only
// reason the role exists: the API is write-capable. The smoke test therefore
// POSTs one real recommendation, and that means it writes Layer 4 rows to the
// SHARED database — the one database this repo treats as non-disposable.
//
// The residue is therefore part of the contract, not an afterthought:
//   * `--confirm-shared` is REQUIRED, so this can never run by accident or in CI;
//   * the rows are deleted in dependency order and the SIX WHOLE-TABLE counts are
//     compared before/after (a scoped-to-ids zero would miss a row written
//     outside the tracked ids, and the golden harness preflight refuses to run
//     while ANY unmarked `recommendation_query` row exists);
//   * a failed cleanup fails the run, and the exit code is folded explicitly
//     because `process.exit(code)` ignores `process.exitCode`;
//   * cleanup adopts ONLY a pass THIS run created (`adoptPassForCleanup`): a
//     dedupe reuse points at a previous run's rows, and deleting those would
//     destroy a pass this test never wrote.
//
// WHAT IT ASSERTS, and refuses to call green without
//   0. the target's schema carries what the API's code requires — 021's
//      `recommendation_query.catalog_version` and 022's `recommendation_preset`.
//      A target a migration behind the code fails its very first request with a
//      `500` that looks exactly like a privilege fault, so this REFUSES before
//      writing anything and names the pending migration instead;
//   1. the role exists on the target (an apply has happened);
//   2. the API's pool starts through its OWN shared path
//      (`API_ALLOW_SHARED=1` + `DATABASE_URL` -> `resolvePoolConfig`), pointed at
//      the role's credentials;
//   3. the connection really IS the role (`SELECT current_user`), so a smoke test
//      can never pass on the owner's credentials by accident;
//   4. `GET /v1/health` is 200 with `db == "ok"` — the BODY, not the status code,
//      because this endpoint deliberately answers 200 while the database is down;
//   5. `POST /v1/recommendations` answers 201 (or 200 for a zero-build pass), was
//      NOT served from the dedupe cache (`reused === false` — a reused reply runs
//      no engine pass and would prove nothing), and COMMITTED BUILDS: with zero
//      builds the four build-table INSERT grants were never exercised, which is
//      reported as an inconclusive run rather than a pass;
//   6. no statement on the API's pool failed 42501 (instrumented, so this is an
//      assertion rather than an absence of visible errors);
//   7. the residue is gone: all six Layer 4 counts equal their pre-run values.
//
// Exit codes: 2 = usage (including --help), 1 = refused, inconclusive or failed
// (including a failed cleanup), 0 = every assertion above held.
//
// Usage:
//   node scripts/smoke-api-role.js --dry-run
//   API_ROLE_PASSWORD=<from the secret store> node scripts/smoke-api-role.js --confirm-shared

require('dotenv').config();

const fs = require('fs');
const { Client } = require('pg');

const { toDirectUrl, describeTarget } = require('./lib/db-url');
const { applyLogTarget } = require('./lib/migrations');
const apiRole = require('./lib/api-role');
const passRows = require('./lib/pass-rows');
const { createPool } = require('../apps/api/src/db');
const { buildApp } = require('../apps/api/src/app');
const repository = require('../apps/api/src/repository');
const engine = require('../apps/api/src/engine');

/** Decision 46: this is a probe, not a deploy, so it names itself. */
const SMOKE_ENGINE_VERSION = 'smoke-api-role';
/** The one environment variable the password is read from (a FILE is the alternative). */
const PASSWORD_ENV = 'API_ROLE_PASSWORD';
const APPLICATION_NAME = 'morocco-pc-smoke-api-role';

function fail(message) {
  throw new Error(message);
}

function usageError(message) {
  return Object.assign(new Error(message), { usage: true });
}

function usageText() {
  return 'usage: node scripts/smoke-api-role.js --confirm-shared [--budget=N] [--use-case=U] [--dry-run]\n'
    + '          [--password-file=<path>]\n'
    + 'Runs the API against the SHARED database as ' + apiRole.API_ROLE_NAME + ': health, then one real POST,\n'
    + 'then removes the rows it wrote and asserts the six Layer 4 counts returned. Writes to the shared\n'
    + 'database, which is why --confirm-shared is required. Read docs/RECIPES/provision-the-api-role.md first.';
}

function parseArgs(argv) {
  if (argv.includes('--help')) throw usageError(usageText());
  const args = { confirmShared: false, dryRun: false, budget: 20000, useCase: 'GAMING', passwordFile: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--confirm-shared') {
      args.confirmShared = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg.startsWith('--budget=')) {
      args.budget = Number(arg.slice('--budget='.length));
    } else if (arg.startsWith('--use-case=')) {
      args.useCase = arg.slice('--use-case='.length);
    } else if (arg.startsWith('--password-file=')) {
      args.passwordFile = arg.slice('--password-file='.length);
    } else if (arg.startsWith('--')) {
      throw usageError('unknown argument: ' + arg + '\n' + usageText());
    } else {
      throw usageError('unexpected positional argument: ' + arg + '\n' + usageText());
    }
  }
  if (!Number.isFinite(args.budget) || args.budget <= 0) {
    throw usageError('--budget must be a positive finite number');
  }
  if (typeof args.useCase !== 'string' || args.useCase.trim() === '') {
    throw usageError('--use-case must be a non-empty value');
  }
  return args;
}

/**
 * The password, from the file when given, else the environment — never argv.
 * Duplicated from `apply-api-role.js` on purpose: two owner scripts, each with a
 * self-contained guard, is cheaper to audit than a third module whose only job is
 * to read a secret.
 *
 * @returns {{password: string, source: string}}
 */
function resolvePassword(args, env = process.env) {
  let password = null;
  let source = null;
  if (args.passwordFile !== null) {
    try {
      password = fs.readFileSync(args.passwordFile, 'utf8').replace(/\r?\n$/, '');
      source = 'file ' + args.passwordFile;
    } catch (error) {
      throw new Error('could not read --password-file: ' + error.message);
    }
  } else {
    const fromEnv = env ? env[PASSWORD_ENV] : undefined;
    if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
      password = fromEnv;
      source = PASSWORD_ENV;
    }
  }
  if (typeof password !== 'string' || password === '') {
    throw new Error('no password supplied: set ' + PASSWORD_ENV + ' or pass --password-file=<path>');
  }
  return { password, source };
}

/** Parse the shared target WITHOUT connecting. */
function resolveTarget(env = process.env) {
  const url = env ? env.DATABASE_URL : undefined;
  if (typeof url !== 'string' || url.trim() === '') {
    throw new Error('DATABASE_URL is not set: this smoke test targets the SHARED database');
  }
  const directUrl = toDirectUrl(url);
  const target = describeTarget(directUrl);
  return { url, directUrl, target, digest: applyLogTarget(url) };
}

/**
 * The schema the API's own code REQUIRES, and the migration that provides each piece.
 *
 * Measured 2026-10-17: the shared database stands at 020 while the API's code reads and writes
 * `recommendation_query.catalog_version` (migration 021, Decision 47) unconditionally and the
 * presets route reads `recommendation_preset` (022, Decision 48). Against a database without
 * them, a correctly granted role still fails its very first request - a `42703` / `42P01` is an
 * UNEXPECTED error, so the client gets a `500 INTERNAL_ERROR`, not a `503`. That is a schema
 * problem wearing a privilege problem's clothes, and the whole point of this preflight is to
 * name which one it is BEFORE the run writes anything.
 */
const API_SCHEMA_PREREQUISITES = Object.freeze([
  Object.freeze({
    id: 'recommendation_query.catalog_version',
    migration: '021_recommendation_query_catalog_version.sql',
    kind: 'COLUMN',
    table: 'recommendation_query',
    name: 'catalog_version',
  }),
  Object.freeze({
    id: 'recommendation_preset',
    migration: '022_recommendation_preset.sql',
    kind: 'TABLE',
    table: 'recommendation_preset',
    name: null,
  }),
]);

/** ONE statement answering whether the target carries the schema the API needs. */
function buildSchemaPreflightSql() {
  const branches = API_SCHEMA_PREREQUISITES.map((entry) => (entry.kind === 'COLUMN'
    ? "SELECT '" + entry.id + "' AS id, (SELECT count(*)::int FROM information_schema.columns"
      + " WHERE table_schema = 'public' AND table_name = '" + entry.table + "' AND column_name = '" + entry.name + "') AS present"
    : "SELECT '" + entry.id + "' AS id, (SELECT count(*)::int FROM information_schema.tables"
      + " WHERE table_schema = 'public' AND table_name = '" + entry.table + "') AS present"));
  return branches.join(' UNION ALL ') + ' ORDER BY 1';
}

/**
 * Which prerequisites are MISSING, in the order they are declared. Pure.
 *
 * A target whose schema is behind the deploy is a REFUSAL, never a green run and never a
 * degraded "best effort": the alternative is a smoke test that fails with an opaque body and
 * sends the operator hunting through the role's grants for a fault that is a pending migration.
 *
 * @param {Array<{id: string, present: number|string}>} rows the preflight result rows
 * @returns {Array<{id: string, migration: string}>} the missing prerequisites, [] when all present
 */
function missingSchemaPrerequisites(rows) {
  if (!Array.isArray(rows)) fail('missingSchemaPrerequisites requires an array of preflight rows');
  const present = new Map();
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || typeof row.id !== 'string') {
      fail('every preflight row must carry a string id');
    }
    present.set(row.id, Number(row.present) > 0);
  }
  return API_SCHEMA_PREREQUISITES
    .filter((entry) => present.get(entry.id) !== true)
    .map((entry) => ({ id: entry.id, migration: entry.migration }));
}

/** Record every statement the API's pool issues, and how each one ended. */
function instrumentPool(pool, sink) {
  const originalQuery = pool.query.bind(pool);
  pool.query = function recordedQuery(...args) {
    const sqlArg = args[0];
    const sql = typeof sqlArg === 'string' ? sqlArg : (sqlArg && sqlArg.text) || String(sqlArg);
    const label = sql.replace(/\s+/g, ' ').trim().slice(0, 80);
    const promise = originalQuery(...args);
    if (promise && typeof promise.then === 'function') {
      return promise.then(
        (value) => { sink.push({ sql: label, error: null }); return value; },
        (error) => { sink.push({ sql: label, error: (error && error.code) || 'ERROR' }); throw error; }
      );
    }
    return promise;
  };
  const originalConnect = pool.connect.bind(pool);
  pool.connect = function recordedConnect(...args) {
    if (typeof args[args.length - 1] === 'function') return originalConnect(...args);
    return originalConnect(...args).then((client) => {
      if (client.__smokeInstrumented === true) return client;
      const original = client.query.bind(client);
      client.query = function recordedClientQuery(...innerArgs) {
        const sqlArg = innerArgs[0];
        const sql = typeof sqlArg === 'string' ? sqlArg : (sqlArg && sqlArg.text) || String(sqlArg);
        const label = sql.replace(/\s+/g, ' ').trim().slice(0, 80);
        const promise = original(...innerArgs);
        if (promise && typeof promise.then === 'function') {
          return promise.then(
            (value) => { sink.push({ sql: label, error: null }); return value; },
            (error) => { sink.push({ sql: label, error: (error && error.code) || 'ERROR' }); throw error; }
          );
        }
        return promise;
      };
      client.__smokeInstrumented = true;
      return client;
    });
  };
}

/**
 * The health contract: 200 AND `db === "ok"`. The status code alone is not the
 * contract - `/v1/health` answers 200 while the database is unreachable, by
 * design - so a monitor (or this smoke test) that reads only the status reports
 * a total database outage as healthy.
 *
 * @param {number} statusCode
 * @param {object|null} body the parsed JSON body
 * @returns {boolean}
 */
function healthIsOk(statusCode, body) {
  return statusCode === 200 && body !== null && typeof body === 'object' && body.db === 'ok';
}

/**
 * Which rows this run OWNS and may therefore delete.
 *
 * Only a pass THIS request created is adoptable. A `reused: true` reply points at
 * a pass a previous run wrote: adopting its id would make the cleanup below
 * delete rows this run did not create. `reused` undefined/absent is UNKNOWN, and
 * UNKNOWN is never "fresh": it is neither adopted nor accepted (the caller
 * throws on it).
 *
 * @param {object} postBody the POST response body
 * @returns {{id: string|null, reused: boolean|null, created: boolean}}
 */
function adoptPassForCleanup(postBody) {
  const id = postBody && postBody.id !== undefined && postBody.id !== null ? postBody.id : null;
  const reused = postBody && postBody.reused !== undefined ? postBody.reused : null;
  return { id, reused, created: reused === false && id !== null };
}

async function main() {
  const args = parseArgs(process.argv);
  const target = resolveTarget(process.env);
  const roleName = apiRole.API_ROLE_NAME;

  console.log('AUDIT TARGET: ' + target.digest);
  console.log('target: endpoint ' + target.target.endpointId + ' (' + (target.target.pooled ? 'pooled' : 'direct')
    + '), database ' + target.target.database + '; guard: DATABASE_URL (SHARED)');

  if (!args.confirmShared && !args.dryRun) {
    console.error('REFUSED: this smoke test writes Layer 4 rows to the SHARED database. Pass --confirm-shared'
      + ' to say so deliberately; it never runs by default and nothing in CI sets it.');
    process.exit(1);
  }
  if (args.dryRun) {
    console.log('DRY RUN: would run the API as ' + roleName + ' against ' + target.digest
      + ' with input ' + args.useCase + ' / ' + args.budget + ' MAD, then POST once and delete the rows it wrote.');
    console.log('A real run additionally requires --confirm-shared and the role password.');
    process.exit(0);
  }

  let password;
  let passwordSource;
  try {
    const resolved = resolvePassword(args, process.env);
    password = resolved.password;
    passwordSource = resolved.source;
  } catch (error) {
    console.error('REFUSED: ' + error.message);
    process.exit(1);
  }

  // The preflight connection: the OWNER's credentials, read-only. The API's own pool is not
  // built until the target has been proven to have the schema the API needs.
  const owner = new Client({
    connectionString: target.directUrl,
    connectionTimeoutMillis: 15000,
    application_name: APPLICATION_NAME,
  });

  const poolStatements = [];
  const cleanupFailures = [];
  let app = null;
  let pool = null;
  let ids = { queryId: null, profileId: null };
  // Did THIS run write a pass? Cleanup is gated on it, not on "the response had
  // an id" - a reused reply has an id too, and those rows are not ours.
  let passCreatedByThisRun = false;

  const report = {
    tool: 'smoke-api-role',
    role: roleName,
    ran_at: new Date().toISOString(),
    target: {
      endpoint: target.target.endpointId,
      mode: target.target.pooled ? 'pooled' : 'direct',
      database: target.target.database,
      digest: target.digest,
    },
    input: { budget: args.budget, currency: 'MAD', use_case: args.useCase },
    engine_version: SMOKE_ENGINE_VERSION,
    password_source: passwordSource,
    assertions: {},
  };

  let ok = true;

  try {
    await owner.connect();
    report.assertions.target_is_shared = true;

    // 0. The target's schema must carry what the API's code requires. Checked FIRST, before
    // the role and before anything is written: the refusal a behind-schema target produces
    // later looks exactly like a privilege fault, and it is the earlier item in the recipe's
    // order (`docs/RECIPES/provision-the-api-role.md`).
    const preflight = await owner.query(buildSchemaPreflightSql());
    const missingSchema = missingSchemaPrerequisites(preflight.rows);
    report.schema_preflight = {
      checked: API_SCHEMA_PREREQUISITES.map((entry) => entry.id),
      missing: missingSchema,
    };
    report.assertions.schema_supports_the_api = missingSchema.length === 0;
    if (missingSchema.length > 0) {
      throw new Error('this target is BEHIND the API: missing '
        + missingSchema.map((entry) => entry.id).join(', ') + ' (pending migration(s) '
        + missingSchema.map((entry) => entry.migration).join(', ') + '). Apply them FIRST -'
        + ' node scripts/run-migrations.js --test-db on the branch, or --restore-point=<id> on'
        + ' shared - because a role cannot grant a column that does not exist. The role is not'
        + ' the problem; the schema is.');
    }

    // 1. The role must exist: an apply has to have happened first.
    const roleRow = await owner.query('SELECT rolname FROM pg_roles WHERE rolname = $1', [roleName]);
    if (roleRow.rows.length === 0) {
      throw new Error('role ' + roleName + ' does not exist on ' + target.digest
        + '; run scripts/apply-api-role.js first (docs/RECIPES/provision-the-api-role.md)');
    }
    report.assertions.role_exists_on_target = true;

    report.residue_before = await passRows.layer4Counts(owner);

    // 2. The API's OWN shared path builds the pool, pointed at the role.
    const roleUrl = apiRole.roleConnectionString(target.url, roleName, password);
    try {
      pool = createPool({ API_ALLOW_SHARED: '1', DATABASE_URL: roleUrl });
      report.assertions.pool_built_through_api_shared_path = true;
    } catch (error) {
      throw new Error('the API refused to build its shared pool: ' + error.message);
    }
    instrumentPool(pool, poolStatements);
    app = buildApp({
      pool,
      repository,
      engine,
      engineVersion: SMOKE_ENGINE_VERSION,
      env: { ENGINE_VERSION: SMOKE_ENGINE_VERSION, ALLOWED_ORIGINS: '' },
      logger: false,
    });

    // 3. The connection is the role - never assumed.
    const identity = await pool.query('SELECT current_user AS u, session_user AS s');
    report.api_connection = identity.rows[0];
    if (identity.rows[0].u !== roleName) {
      throw new Error('the API connected as ' + identity.rows[0].u + ', not ' + roleName);
    }
    report.assertions.api_connection_is_the_role = true;

    // 4. Health, asserted on the BODY (200 alone means nothing here).
    const health = await app.inject({ method: 'GET', url: '/v1/health' });
    const healthBody = health.json();
    report.health = { status: health.statusCode, body: healthBody };
    report.assertions.health_ok = healthIsOk(health.statusCode, healthBody);
    if (!report.assertions.health_ok) {
      throw new Error('/v1/health answered ' + health.statusCode + ' with db='
        + JSON.stringify(healthBody === null ? null : healthBody.db)
        + '; the contract is the BODY (db == "ok"), because this endpoint answers 200 during a database outage');
    }

    // 5. One real POST through the API's write path.
    const post = await app.inject({
      method: 'POST',
      url: '/v1/recommendations',
      payload: { budget_amount: args.budget, currency: 'MAD', use_case: args.useCase },
    });
    const postBody = post.json();
    report.post = {
      status: post.statusCode,
      id: postBody.id === undefined ? null : postBody.id,
      reused: postBody.reused === undefined ? null : postBody.reused,
      builds: Array.isArray(postBody.builds) ? postBody.builds.length : null,
      reason: postBody.reason === undefined ? null : postBody.reason,
    };
    const adopted = adoptPassForCleanup(postBody);
    passCreatedByThisRun = adopted.created;
    ids.queryId = adopted.created ? adopted.id : null;

    report.assertions.post_status_ok = post.statusCode === 201 || post.statusCode === 200;
    if (!report.assertions.post_status_ok) {
      throw new Error('POST answered ' + post.statusCode + ' (body keys: ' + Object.keys(postBody).join(', ') + ')');
    }
    if (report.post.reused === true) {
      throw new Error('POST was served from the dedupe cache (reused: true), so NO engine pass ran and nothing'
        + ' was proven; re-run once the cached pass is gone');
    }
    if (report.post.reused !== false) {
      // NULL/unknown is not "fresh": without an explicit `reused: false` there is
      // no evidence an engine pass ran, and no evidence the rows are ours.
      throw new Error('the POST response did not state reused: false (received '
        + JSON.stringify(report.post.reused) + '), so it is UNKNOWN whether an engine pass ran');
    }
    report.assertions.post_not_reused = report.post.reused === false;
    if (report.post.builds === null || report.post.builds < 1) {
      throw new Error('the pass committed ' + (report.post.builds === null ? 'no builds array' : '0 builds')
        + ' (reason: ' + report.post.reason + '), so the INSERT grants on the four build tables were never'
        + ' exercised; re-run with a larger --budget');
    }
    report.assertions.builds_committed = true;

    // 6. No 42501 anywhere on the API's pool.
    const privilegeErrors = poolStatements.filter((s) => s.error === '42501');
    report.pool_statements = poolStatements.length;
    report.privilege_errors = privilegeErrors;
    report.other_pool_errors = poolStatements.filter((s) => s.error !== null && s.error !== '42501');
    report.assertions.no_42501_on_the_api_pool = privilegeErrors.length === 0;
    if (!report.assertions.no_42501_on_the_api_pool) {
      throw new Error('the API issued ' + privilegeErrors.length + ' statement(s) refused 42501');
    }

    // Read the profile back so the cleanup can remove it too (the POST body does
    // not carry it, and the query's FK points at the profile).
    if (ids.queryId !== null) {
      const profile = await owner.query('SELECT recommendation_profile_id AS id FROM recommendation_query WHERE id = $1::uuid', [ids.queryId]);
      ids.profileId = profile.rows.length > 0 ? profile.rows[0].id : null;
    }
  } catch (error) {
    ok = false;
    report.failure = (error && error.code ? error.code + ': ' : '') + ((error && error.message) || String(error));
  }

  // Close the API cleanly before touching the database again.
  try {
    if (app !== null) await app.close();
    if (pool !== null) await pool.end();
    // null, not true, when no pool was ever built: a refusal that never started the API must
    // not report an assertion it never tested.
    report.assertions.api_closed = app === null && pool === null ? null : true;
  } catch (error) {
    ok = false;
    cleanupFailures.push('closing the API: ' + error.message);
  }

  // Nothing below may throw: a throw here would skip the steps after it.
  try {
    if (passCreatedByThisRun === true && ids.queryId !== null) {
      report.residue_removed = await passRows.deletePassRows(owner, ids);
      report.residue_after = await passRows.layer4Counts(owner);
      const drifted = passRows.residueDrift(report.residue_before, report.residue_after);
      report.residue_drifted_tables = drifted;
      report.assertions.residue_clean = drifted.length === 0;
      if (drifted.length > 0) {
        ok = false;
        cleanupFailures.push('residue: ' + JSON.stringify(drifted));
      }
    } else {
      // NOT MEASURED, not clean: this run wrote no pass of its own (it stopped before the
      // write phase, or the POST was a reuse), so the before/after comparison this
      // assertion exists for never happened - and the cleanup must not touch rows it
      // did not create.
      report.assertions.residue_clean = null;
      report.residue_note = 'this run created no pass, so residue was never measured and no rows were deleted';
    }
  } catch (error) {
    ok = false;
    cleanupFailures.push('deleting the smoke test rows: ' + error.message);
  }

  try {
    await owner.end();
  } catch (_endError) {
    // Already closed.
  }

  report.cleanup_failures = cleanupFailures;
  report.ok = ok && cleanupFailures.length === 0;
  console.log(JSON.stringify(report, null, 2));
  if (report.ok) {
    console.log('SMOKE OK: the API ran as ' + roleName + ' on ' + target.digest + ' (health db=ok, POST '
      + report.post.status + ' with ' + report.post.builds + ' builds, ' + report.pool_statements
      + ' statements, residue back to its pre-run counts).');
  } else {
    console.error('SMOKE FAILED: ' + (report.failure || 'cleanup failed') + ' - see the report above.');
  }
  process.exit(report.ok ? 0 : 1);
}

module.exports = {
  API_SCHEMA_PREREQUISITES,
  PASSWORD_ENV,
  SMOKE_ENGINE_VERSION,
  adoptPassForCleanup,
  buildSchemaPreflightSql,
  healthIsOk,
  missingSchemaPrerequisites,
  parseArgs,
  resolvePassword,
  resolveTarget,
  usageText,
};

if (require.main === module) {
  main().catch((error) => {
    const usage = Boolean(error && error.usage);
    console.error((usage ? 'USAGE: ' : 'REFUSED: ') + ((error && error.message) || String(error)));
    process.exit(usage ? 2 : 1);
  });
}
