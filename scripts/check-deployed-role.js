'use strict';

/**
 * scripts/check-deployed-role.js - did the DEPLOYED app actually start using
 * `morocco_pc_api`? READ-ONLY.
 *
 *   node scripts/check-deployed-role.js --target=env:TARGET_DATABASE_URL
 *   node scripts/check-deployed-role.js --target=env:TARGET_DATABASE_URL --app=morocco-pc-api
 *
 * WHY IT EXISTS. The role's arrival has two separate proofs and only one of them
 * is a smoke test. `scripts/smoke-api-role.js` runs the API FROM THIS MACHINE as
 * the role, which proves the role's grants are sufficient for a whole pass; it
 * cannot prove the deployed app uses them, because it opens its own connection
 * and the app's `DATABASE_URL` secret is never readable (`fly secrets list` shows
 * a digest, not a value). The remaining question - "is the running app
 * authenticated as the role, or still as the owner?" - is answerable only from
 * the database side, so this script reads `pg_stat_activity` and classifies the
 * sessions that carry the API's own `application_name` tag.
 *
 * That tag (`morocco-pc-api`) is set on every pooled connection by
 * `apps/api/src/db.js`, which makes the app identifiable without a new endpoint,
 * a new column or a new credential. Measured 2026-10-23 (see
 * `DEVELOPMENT_NOTES.md`): Neon's pooler DOES preserve a client's
 * `application_name` on the server connection, but only once a query has run -
 * a bare `connect()` opens nothing, so an idle app that has never queried is
 * invisible here. That is exactly why the verdict is three-valued rather than
 * two: no observation is not a pass.
 *
 * THIS READ MUST BE DIRECT, and that is measured too. The pooler multiplexes
 * clients onto ONE server connection and applies `application_name` per client,
 * so a checker connected through the pooled URL can land on the very server
 * connection the app used and RELABEL it: on 2026-10-23 a pooled run of this
 * script turned the app-tagged probe session into `morocco-pc-deployed-role-check`
 * and then reported INCONCLUSIVE, hiding the evidence it had just overwritten.
 * `toDirectUrl` (scripts/lib/db-url.js) gives the read its own backend, so the
 * observation cannot change what it is observing.
 *
 * Usage:
 *   node scripts/check-deployed-role.js --target=env:TARGET_DATABASE_URL
 *
 * `--target` takes a VARIABLE NAME (`env:NAME`), never a URL: the connection
 * string carries a password and this report is meant to be pasted into notes.
 * The equals form is mandatory, like the repo's other read-only gates. The
 * variable may hold the pooled or the direct URL; the read is always made
 * through the DIRECT endpoint (see above), and neither form is ever printed.
 *
 * Exit codes: 0 = PASS or INCONCLUSIVE (INCONCLUSIVE prints "NOT a pass" and
 *            never claims one); 1 = FAIL, an unset target variable, or a read
 *            that could not complete; 2 = usage error (including --help).
 *
 * The classification and the wording live in the pure, unit-tested
 * `scripts/lib/deployed-role.js`; this file owns the SELECT and the exit code.
 */

require('dotenv').config();
const { Client } = require('pg');

const { toDirectUrl } = require('./lib/db-url');
const apiRole = require('./lib/api-role');
const {
  APPLICATION_NAME_MAX_LENGTH,
  assertAppTag,
  evaluateDeployedRole,
  formatReport,
} = require('./lib/deployed-role');

const DEFAULT_TARGET_ENV = 'DATABASE_URL';
/**
 * `apps/api/src/db.js` `APPLICATION_NAME`. Pinned by a test rather than imported:
 * this gate must not depend on the API's module graph (which loads `pg` and the
 * write-target guard) to know one string.
 */
const DEFAULT_APP_TAG = 'morocco-pc-api';
/** Distinct from the app tag, so the checker can never count itself as the app. */
const CHECKER_APPLICATION_NAME = 'morocco-pc-deployed-role-check';

const USAGE = [
  'usage: node scripts/check-deployed-role.js [--target=env:NAME] [--app=<tag>] [--role=<name>]',
  '',
  '  --target=env:NAME  environment variable holding the connection string',
  '                     (default env:' + DEFAULT_TARGET_ENV + '; a deployed target is',
  '                     usually env:TARGET_DATABASE_URL)',
  '  --app=<tag>        application_name the API tags its pool with',
  '                     (default ' + DEFAULT_APP_TAG + ')',
  '  --role=<name>      the credential the app SHOULD be using',
  '                     (default ' + apiRole.API_ROLE_NAME + ')',
  '',
  'Read-only. Reports which user the running app\'s DB sessions authenticated as.',
  'PASS = every app session is the expected role; FAIL = one is not (exit 1);',
  'INCONCLUSIVE = no app session was observed, which is NOT a pass.',
  'The read is made through the DIRECT endpoint: a pooled read can relabel the',
  'session it is trying to observe.',
  'docs/RECIPES/deploy-eu-colocation.md section 8.5 is the procedure this checks.',
].join('\n');

/** A usage error carries `usage: true` so the caller can pick exit 2. */
function usageError(message) {
  return Object.assign(new Error(message), { usage: true });
}

/**
 * Parse argv. Value-bearing flags take the `=<value>` form only, the repo's rule
 * for flags whose value is easy to mis-pair with the next token.
 *
 * @param {string[]} argv process.argv.slice(2)
 * @returns {{help: boolean, targetEnv: string, appTag: string, roleName: string}}
 * @throws {Error} with `usage: true` on anything unrecognised or malformed
 */
function parseArgs(argv) {
  const options = {
    help: false,
    targetEnv: DEFAULT_TARGET_ENV,
    appTag: DEFAULT_APP_TAG,
    roleName: apiRole.API_ROLE_NAME,
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg.startsWith('--target=env:')) {
      const name = arg.slice('--target=env:'.length).trim();
      if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
        throw usageError('--target must name an environment variable: --target=env:NAME');
      }
      options.targetEnv = name;
      continue;
    }
    if (arg.startsWith('--app=')) {
      const raw = arg.slice('--app='.length);
      let tag;
      try {
        tag = assertAppTag(raw);
      } catch (error) {
        throw usageError('--app ' + error.message);
      }
      if (tag.length > APPLICATION_NAME_MAX_LENGTH) {
        throw usageError('--app must be at most ' + APPLICATION_NAME_MAX_LENGTH + ' characters');
      }
      options.appTag = tag;
      continue;
    }
    if (arg.startsWith('--role=')) {
      const raw = arg.slice('--role='.length).trim();
      try {
        options.roleName = apiRole.assertRoleName(raw);
      } catch (error) {
        throw usageError('--role ' + error.message);
      }
      continue;
    }
    throw usageError('unknown argument: ' + arg);
  }
  return options;
}

/**
 * Every session in THIS database, folded per (user, application_name). The
 * checker's own backend is excluded by pid, and `current_database()` scopes the
 * question to the database the target actually points at. `backend_start` comes
 * along because a pooled server connection OUTLIVES its client and keeps the
 * last client's tag (measured 2026-10-23), so the start time is what lets a
 * reader tell the running app from a leftover connection.
 */
const SESSIONS_SQL = [
  'SELECT usename::text AS usename,',
  "       coalesce(application_name, '') AS application_name,",
  '       count(*)::int AS connections,',
  '       min(backend_start) AS oldest_start,',
  '       max(backend_start) AS newest_start',
  '  FROM pg_stat_activity',
  ' WHERE datname = current_database()',
  '   AND pid <> pg_backend_pid()',
  ' GROUP BY usename, application_name',
  ' ORDER BY usename ASC, application_name ASC',
].join('\n');

const DATABASE_SQL = 'SELECT current_database() AS database';

/**
 * A pg client configuration that never prints or logs its connection string, and
 * that always reads through the DIRECT endpoint: the pooler would let this
 * connection reuse (and relabel) the app's server connection (see the header).
 */
function defaultClientConfig(connectionString) {
  return {
    connectionString: toDirectUrl(connectionString),
    connectionTimeoutMillis: 15000,
    statement_timeout: 15000,
    application_name: CHECKER_APPLICATION_NAME,
  };
}

/**
 * @param {string[]} argv
 * @param {object} [deps] injectable for tests: createClient, log, logError, now
 * @returns {Promise<number>} the exit code
 */
async function main(argv, deps) {
  const options = deps || {};
  const log = options.log || ((line) => console.log(line));
  const logError = options.logError || ((line) => console.error(line));
  const now = options.now || (() => new Date());

  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    logError('ERROR: ' + error.message);
    logError(USAGE);
    return 2;
  }
  if (args.help) {
    log(USAGE);
    return 2;
  }

  const connectionString = process.env[args.targetEnv];
  if (typeof connectionString !== 'string' || connectionString.trim() === '') {
    logError('ERROR: ' + args.targetEnv + ' is not set (pass --target=env:NAME to name another variable)');
    return 1;
  }

  const createClient = options.createClient || ((config) => new Client(config));
  const client = createClient(defaultClientConfig(connectionString));
  try {
    await client.connect();
    const databaseRow = (await client.query(DATABASE_SQL)).rows[0] || {};
    const sessions = (await client.query(SESSIONS_SQL)).rows;
    const view = evaluateDeployedRole(sessions, { appTag: args.appTag, roleName: args.roleName });
    const lines = formatReport(view, {
      targetEnv: args.targetEnv,
      database: databaseRow.database || null,
      asOf: now(),
    });
    for (const line of lines) log(line);
    return view.verdict === 'FAIL' ? 1 : 0;
  } catch (error) {
    logError('ERROR: ' + (error && error.message ? error.message : String(error)));
    return 1;
  } finally {
    await client.end().catch(() => {});
  }
}

module.exports = {
  CHECKER_APPLICATION_NAME,
  DATABASE_SQL,
  DEFAULT_APP_TAG,
  DEFAULT_TARGET_ENV,
  SESSIONS_SQL,
  USAGE,
  defaultClientConfig,
  main,
  parseArgs,
};

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error('ERROR: ' + (error && error.message ? error.message : String(error)));
      process.exitCode = 1;
    }
  );
}
