'use strict';

// scripts/apply-api-role.js — apply the production database role to a real
// database. OWNER-GATED: this is DDL on a database this repo does not rebuild.
//
// Platform P3 Sprint 2 Step 5. The procedure that surrounds this command — the
// restore point, the smoke test, the rollback and where to record the outcome —
// is `docs/RECIPES/provision-the-api-role.md`; read it first. This file is the
// apply half, and it is deliberately shaped like `scripts/run-migrations.js`
// because the plan says Step 5 needs a restore point "for the same reason an
// apply does":
//
//   * the target defaults to the shared `DATABASE_URL`; `--target-env=<NAME>`
//     names ANOTHER environment variable that holds the target URL (the EU
//     production database lives in `TARGET_DATABASE_URL`, loaded from
//     `.env.eu`). There is NO `--test-db` mode: the branch rehearsal is
//     `scripts/rehearse-api-role.js`, which creates, proves and removes the
//     role in one run;
//   * a REAL apply REFUSES (exit 1, nothing written) unless `--restore-point=<id>`
//     matches the same `^[A-Za-z0-9_-]{8,}$` shape the migration runner enforces,
//     and it prints the statements it would have run instead;
//   * `--dry-run` connects to NOTHING and needs neither a restore point nor a
//     password, and prints the statements with the password REDACTED;
//   * it REFUSES when the role already exists, printing the exact removal
//     sequence, because a second CREATE ROLE would fail half way and a silent
//     DROP-then-recreate would discard grants someone else may have tuned;
//   * the password comes from the secret store, never from the command line
//     history: `API_ROLE_PASSWORD` in the environment, or `--password-file=<path>`
//     (one trailing newline is stripped). It is never printed, and no URL or host
//     is either — the target is named by `applyLogTarget`'s `db:<12 hex>` digest.
//
// AFTER the grants it runs the 21-answer self-check from `scripts/lib/api-role.js`
// and compares it to the fixture. Green prints a report and a ready-to-paste
// record for `DEVELOPMENT_NOTES.md`. Red ROLLS BACK — it removes the role it just
// created (REVOKE sweep, then DROP ROLE) and exits 1 — because a mis-privileged
// role left standing on the shared database is worse than no role, and the
// report it prints first contains the diagnosis.
//
// Exit codes: 2 = usage (including --help), 1 = refused or failed (including a
// failed self-check or cleanup), 0 = applied and every privilege answer matched.
//
// Usage:
//   node scripts/apply-api-role.js --dry-run
//   API_ROLE_PASSWORD=<from the secret store> node scripts/apply-api-role.js --restore-point=<neon-branch-id>
//   API_ROLE_PASSWORD=<secret> node scripts/apply-api-role.js --target-env=TARGET_DATABASE_URL --restore-point=<id>

require('dotenv').config();

const fs = require('fs');
const { execSync } = require('child_process');
const { Client } = require('pg');

const { toDirectUrl, describeTarget } = require('./lib/db-url');
const { applyLogTarget, isValidRestorePointId } = require('./lib/migrations');
const apiRole = require('./lib/api-role');

/** Visible in pg_stat_activity, so an operator can see this run. */
const APPLICATION_NAME = 'morocco-pc-apply-api-role';
/** The one environment variable the password is read from (a FILE is the alternative). */
const PASSWORD_ENV = 'API_ROLE_PASSWORD';
/** Default target variable: the shared database, unchanged from before --target-env. */
const TARGET_ENV_DEFAULT = 'DATABASE_URL';

/**
 * `--target-env` value: a VARIABLE NAME, never a URL.
 *
 * A URL on the command line would land in shell history and in `ps`, which is
 * exactly what the password rule already forbids; naming the variable keeps the
 * secret in the env file. Shape-checked so a typo fails before anything runs.
 *
 * @param {string} raw the value after `--target-env=`
 * @returns {string} the variable name
 */
function parseTargetEnvName(raw) {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    throw usageError('--target-env expects an environment variable NAME matching ^[A-Z][A-Z0-9_]*$'
      + ' (received: ' + JSON.stringify(raw) + '); pass a URL through the variable, never on the command line');
  }
  return name;
}

function usageError(message) {
  return Object.assign(new Error(message), { usage: true });
}

/** The full-precision HEAD sha, or 'unknown' — the migration runner's convention. */
function gitHash() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch (_error) {
    return 'unknown';
  }
}

function usageText() {
  return 'usage: node scripts/apply-api-role.js [--dry-run] --restore-point=<id> [--password-file=<path>]\n'
    + '          [--target-env=<NAME>]\n'
    + 'Applies the production role ' + apiRole.API_ROLE_NAME + ' to the database named by --target-env\n'
    + '(default DATABASE_URL, the SHARED database).\n'
    + 'A real apply requires --restore-point=<id> (a Neon restore point / branch id, ^[A-Za-z0-9_-]{8,}$);\n'
    + 'the password comes from ' + PASSWORD_ENV + ' or --password-file=<path>, never from this command line.\n'
    + '--dry-run contacts nothing and prints the statements with the password redacted.\n'
    + 'Read docs/RECIPES/provision-the-api-role.md first.';
}

function parseArgs(argv) {
  if (argv.includes('--help')) throw usageError(usageText());
  const args = { dryRun: false, restorePoint: null, passwordFile: null, targetEnv: TARGET_ENV_DEFAULT };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg.startsWith('--target-env=')) {
      args.targetEnv = parseTargetEnvName(arg.slice('--target-env='.length));
    } else if (arg.startsWith('--restore-point=')) {
      args.restorePoint = arg.slice('--restore-point='.length);
    } else if (arg.startsWith('--password-file=')) {
      args.passwordFile = arg.slice('--password-file='.length);
    } else if (arg.startsWith('--')) {
      throw usageError('unknown argument: ' + arg + '\n' + usageText());
    } else {
      throw usageError('unexpected positional argument: ' + arg + '\n' + usageText());
    }
  }
  // A real apply requires a valid restore point; --dry-run never needs one.
  if (!args.dryRun && !isValidRestorePointId(args.restorePoint)) {
    throw Object.assign(new Error(
      'REFUSING to apply: a real apply against a database needs --restore-point=<id>'
      + ' matching ^[A-Za-z0-9_-]{8,}$ (received: ' + JSON.stringify(args.restorePoint) + ').'
      + ' This is a placeholder or missing, and a placeholder fails that shape on purpose.'
    ), { pending: true });
  }
  return args;
}

/**
 * The password, from the file when given, else the environment. Never logged, and
 * never taken from argv — a command line ends up in a shell history and in `ps`.
 *
 * @param {{passwordFile: string|null}} args
 * @param {object} env
 * @returns {{password: string, source: string}} the password and where it came from
 *   (the source is logged; the password never is)
 * @throws {Error} when absent, unreadable or blank
 */
function resolvePassword(args, env = process.env) {
  let password = null;
  let source = null;
  if (typeof args.passwordFile === 'string' && args.passwordFile !== '') {
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
    throw new Error('no password supplied: set ' + PASSWORD_ENV + ' or pass --password-file=<path>'
      + ' (the value comes from the secret store; it is never taken from the command line)');
  }
  return { password, source };
}

/**
 * Parse and validate the target WITHOUT connecting.
 *
 * @param {object} [env] process.env by default
 * @param {string} [targetEnv] the variable NAME holding the URL
 * @returns {{url: string, directUrl: string, target: object, digest: string, targetEnv: string, isShared: boolean}}
 */
function resolveTarget(env = process.env, targetEnv = TARGET_ENV_DEFAULT) {
  const url = env ? env[targetEnv] : undefined;
  if (typeof url !== 'string' || url.trim() === '') {
    throw new Error(targetEnv + ' is not set: pass --target-env=<NAME> naming a variable that holds the target URL'
      + ' (the default is ' + TARGET_ENV_DEFAULT + ', the shared database)');
  }
  const directUrl = toDirectUrl(url);
  const target = describeTarget(directUrl);
  return {
    url,
    directUrl,
    target,
    digest: applyLogTarget(url),
    targetEnv,
    isShared: targetEnv === TARGET_ENV_DEFAULT,
  };
}

/** Human label for the guard line: the shared database is named as such. */
function guardLabel(target) {
  return target.isShared ? TARGET_ENV_DEFAULT + ' (SHARED)' : target.targetEnv + ' (named target)';
}

/** The plan, printed for a refusal as well as for a dry run. Password redacted. */
function planStatements() {
  return apiRole.buildGrantStatementsRedacted(apiRole.API_ROLE_NAME);
}

function printPlan(target, args) {
  console.log('AUDIT TARGET: ' + target.digest);
  console.log('target: endpoint ' + target.target.endpointId + ' (' + (target.target.pooled ? 'pooled' : 'direct')
    + '), database ' + target.target.database + '; guard: ' + guardLabel(target));
  console.log('restore point: ' + (args.restorePoint === null ? '(none)' : args.restorePoint));
  console.log('the ' + planStatements().length + ' statements this applies, in order:');
  for (const statement of planStatements()) console.log('  ' + statement);
}

/** Exit 1 without a stack trace: refusals are expected outcomes, not crashes. */
function refuse(message, target, args) {
  console.error('REFUSED: ' + message);
  if (target) printPlan(target, args);
  process.exit(1);
}

/**
 * Create the role and apply its GRANT block, reporting the moment the role
 * EXISTS so the caller can roll it back.
 *
 * The CREATE is issued alone first, then `onCreated` fires, then the grants run.
 * That order is the whole point: a failure on grant 3 of 7 leaves a role on the
 * shared database, and a caller that only learns about it after the last
 * statement would report "nothing to roll back" while the half-granted role
 * stays behind - and the next run refuses an existing role.
 *
 * `buildGrantStatements` puts CREATE ROLE first by construction, pinned by
 * scripts/lib/api-role.test.js.
 *
 * @param {object} client pg-compatible client, as the shared database owner
 * @param {string} roleName
 * @param {string} password the role's password, interpolated as a quoted literal
 * @param {() => void} [onCreated] called after CREATE ROLE succeeds, before any GRANT
 * @returns {Promise<number>} the number of statements issued
 */
async function createRoleAndGrants(client, roleName, password, onCreated) {
  const statements = apiRole.buildGrantStatements(roleName, password);
  await client.query(statements[0]);
  if (typeof onCreated === 'function') onCreated();
  for (const statement of statements.slice(1)) await client.query(statement);
  return statements.length;
}

async function main() {
  const args = parseArgs(process.argv);
  const target = resolveTarget(process.env, args.targetEnv);
  const roleName = apiRole.API_ROLE_NAME;

  printPlan(target, args);

  if (args.dryRun) {
    console.log('DRY RUN: nothing connected, nothing applied, no password read.');
    console.log('A real apply additionally requires --restore-point=<id> and the role password.');
    process.exit(0);
  }

  let password;
  let passwordSource;
  try {
    const resolved = resolvePassword(args, process.env);
    password = resolved.password;
    passwordSource = resolved.source;
  } catch (error) {
    refuse('the password could not be read - ' + error.message, target, args);
  }

  const client = new Client({
    connectionString: target.directUrl,
    connectionTimeoutMillis: 15000,
    application_name: APPLICATION_NAME,
  });

  const report = {
    tool: 'apply-api-role',
    role: roleName,
    applied_at: new Date().toISOString(),
    git_sha: gitHash(),
    target: {
      endpoint: target.target.endpointId,
      mode: target.target.pooled ? 'pooled' : 'direct',
      database: target.target.database,
      digest: target.digest,
    },
    restore_point: args.restorePoint,
    password_source: passwordSource,
  };

  let ok = false;
  let exitCode = 0;
  let roleCreated = false;

  try {
    await client.connect();

    const existing = await client.query('SELECT rolsuper FROM pg_roles WHERE rolname = $1', [roleName]);
    if (existing.rows.length > 0) {
      console.error('REFUSED: role ' + roleName + ' ALREADY EXISTS on ' + target.digest + '.');
      console.error('This apply will not recreate it. To remove it first (sweep, then drop):');
      for (const statement of apiRole.buildRemovalStatements(roleName)) console.error('  ' + statement);
      process.exit(1);
    }

    // `roleCreated` must flip BEFORE the grants: see createRoleAndGrants.
    report.statements_applied = await createRoleAndGrants(client, roleName, password, () => {
      roleCreated = true;
    });

    // The self-check names its tables unqualified, so the search_path is pinned.
    await client.query('SET search_path = public');
    const selfCheck = await client.query(apiRole.buildSelfCheckSql(roleName));
    const verdict = apiRole.comparePrivilegeAnswers(selfCheck.rows, roleName);

    report.role_attributes = (await client.query(
      'SELECT rolsuper, rolcreatedb, rolcreaterole, rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname = $1',
      [roleName]
    )).rows[0];
    report.self_check = {
      assertions: apiRole.PRIVILEGE_EXPECTATIONS.length,
      answered: selfCheck.rows.length,
      matched: verdict.checks.filter((check) => check.ok).length,
      missing: verdict.missing,
      mismatches: verdict.mismatches,
      unexpected: verdict.unexpected,
      checks: verdict.checks.map((check) => ({ id: check.id, expected: check.expected, actual: check.actual, ok: check.ok })),
    };

    if (verdict.ok) {
      ok = true;
      report.rolled_back = false;
      report.role_exists_after = true;
      report.record_for_development_notes = 'Applied ' + roleName + ' to ' + target.digest
        + ' (endpoint ' + target.target.endpointId + ', database ' + target.target.database + ') from restore point '
        + args.restorePoint + ' at ' + report.git_sha + ' (' + report.applied_at + '): '
        + report.statements_applied + ' statements, self-check ' + report.self_check.matched + '/'
        + report.self_check.assertions + ' matched. Password source: ' + passwordSource + '.';
    } else {
      ok = false;
      exitCode = 1;
      report.rolled_back = true;
      report.failure = 'the privilege self-check did not match the fixture: missing '
        + JSON.stringify(verdict.missing) + ', mismatches ' + JSON.stringify(verdict.mismatches)
        + ', unexpected ' + JSON.stringify(verdict.unexpected);
    }
  } catch (error) {
    exitCode = 1;
    report.failure = (error && error.code ? error.code + ': ' : '') + ((error && error.message) || String(error));
  }

  // Roll back a role this run created but could not prove, and never let a failed
  // cleanup pass silently: the exit code is folded at the end.
  if (roleCreated && !ok) {
    const teardownFailures = [];
    try {
      for (const statement of apiRole.buildTeardownStatements(roleName)) {
        try {
          await client.query(statement);
        } catch (error) {
          teardownFailures.push(statement + ' :: ' + error.message);
        }
      }
      try {
        await client.query('DROP ROLE ' + roleName);
      } catch (error) {
        teardownFailures.push('DROP ROLE :: ' + error.message);
      }
      const gone = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [roleName]);
      report.role_exists_after = gone.rows.length > 0;
    } catch (error) {
      teardownFailures.push('rollback: ' + error.message);
    }
    report.rollback_failures = teardownFailures;
    if (teardownFailures.length > 0 || report.role_exists_after === true) {
      exitCode = 1;
      report.cleanup_verdict = 'ROLLBACK INCOMPLETE - remove ' + roleName + ' by hand (see docs/RECIPES/provision-the-api-role.md)';
    } else {
      report.cleanup_verdict = 'the role this run created was REMOVED; the database is as it was before';
    }
  }

  try {
    await client.end();
  } catch (_endError) {
    // Already closed.
  }

  console.log(JSON.stringify(report, null, 2));
  if (ok) {
    console.log('APPLIED: ' + roleName + ' on ' + target.digest + ', self-check '
      + report.self_check.matched + '/' + report.self_check.assertions
      + '. Next: the smoke test (docs/RECIPES/provision-the-api-role.md).');
  } else {
    console.error('FAILED: ' + (report.failure || 'unknown') + ' - see the report above.');
  }
  process.exit(exitCode);
}

module.exports = {
  APPLICATION_NAME,
  PASSWORD_ENV,
  TARGET_ENV_DEFAULT,
  createRoleAndGrants,
  guardLabel,
  parseArgs,
  parseTargetEnvName,
  planStatements,
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
