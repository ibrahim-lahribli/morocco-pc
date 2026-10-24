'use strict';

// scripts/lib/apply-api-role-cli.test.js — the DB-free contract of
// `scripts/apply-api-role.js`, the OWNER-GATED shared apply.
//
// This script runs DDL against the one database this repo treats as
// non-disposable, so the half of it that decides WHETHER it may run is the half
// that most needs pinning — and it happens to be DB-free by construction: the
// restore-point rule, the password source and the refusal to connect at all on a
// dry run are all decided before a Client exists.
//
// What is pinned, and why each one is a safety property rather than a style
// preference:
//   * a real apply REFUSES without `--restore-point=<id>` of the same shape the
//     migration runner enforces, and the refusal names the pending files — the
//     same placeholder that fails `run-migrations.js` must fail here;
//   * `--dry-run` needs NO restore point and NO password, connects to nothing,
//     and prints the statements with the password REDACTED, so the plan is safe
//     to paste into an issue;
//   * the password is never read from argv, and the target is named by the
//     `db:<12 hex>` digest rather than a host — the report is quotable;
//   * there is no `--test-db`: the branch rehearsal is a different script, and a
//     branch mode here would be a way to apply the role to the wrong database;
//   * `--help` exits 2 with no stack trace, and a refusal exits 1 with no stack
//     trace: a refused apply is an expected outcome, not a crash.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  PASSWORD_ENV,
  createRoleAndGrants,
  guardLabel,
  parseArgs,
  resolvePassword,
  resolveTarget,
  usageText,
} = require('../apply-api-role');
const { API_ROLE_NAME } = require('./api-role');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ARGV = ['node', 'scripts/apply-api-role.js'];
/** A syntactically valid Neon-shaped target. Nothing ever connects to it. */
const FAKE_SHARED = 'postgresql://neondb_owner:owner-s3cret@ep-fake-123456.us-east-2.aws.neon.tech/neondb?sslmode=require';
const RESTORE_POINT = 'br-damp-grass-axyri6yl';

function isolatedEnv(extra) {
  return Object.assign({}, process.env, {
    DATABASE_URL: '',
    TEST_DATABASE_URL: '',
    [PASSWORD_ENV]: '',
  }, extra || {});
}

/** A fake pg client that records statements and can fail on a chosen one. */
function fakeClient(failOn) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(sql);
      if (failOn && failOn.test(sql)) {
        throw Object.assign(new Error('injected failure: ' + sql), { code: 'XX000' });
      }
      return { rows: [], rowCount: 1 };
    },
  };
}

test('createRoleAndGrants reports the created role BEFORE any GRANT can fail', async () => {
  // The half-granted-role defect: a failure on grant 3 used to leave a role on
  // the shared database while the caller believed nothing had been created, so
  // it skipped the rollback and every later run refused an existing role.
  const happy = fakeClient();
  let announcedAt = null;
  const count = await createRoleAndGrants(happy, 'morocco_pc_api', "pa'ss", () => { announcedAt = happy.calls.length; });
  assert.equal(count, 8, 'CREATE ROLE + seven grants');
  assert.equal(announcedAt, 1, 'the callback fires after CREATE ROLE, before the first GRANT');
  assert.match(happy.calls[0], /^CREATE ROLE morocco_pc_api LOGIN PASSWORD 'pa''ss'$/);
  assert.equal(happy.calls.filter((sql) => sql.startsWith('GRANT')).length, 6, 'USAGE, SELECT, INSERT, DELETE and the two column-scoped UPDATEs');
  assert.ok(happy.calls[1].startsWith('GRANT USAGE'), 'the grants follow the CREATE');

  const failing = fakeClient(/^GRANT INSERT/);
  let createdBeforeFailure = false;
  await assert.rejects(
    () => createRoleAndGrants(failing, 'morocco_pc_api', 'pw', () => { createdBeforeFailure = true; }),
    /injected failure: GRANT INSERT/
  );
  assert.equal(createdBeforeFailure, true, 'the caller must be able to roll back a role that now exists');
  assert.equal(failing.calls.length, 4, 'CREATE, USAGE, SELECT, then the failing INSERT');
});

test('a failed CREATE ROLE never claims the role exists', async () => {
  const failing = fakeClient(/^CREATE ROLE/);
  let announced = false;
  await assert.rejects(
    () => createRoleAndGrants(failing, 'morocco_pc_api', 'pw', () => { announced = true; }),
    /injected failure: CREATE ROLE/
  );
  assert.equal(announced, false, 'nothing was created, so there is nothing to roll back');
});

test('the usage names the guard, the restore point and the runbook', () => {
  const usage = usageText();
  assert.match(usage, /--restore-point=<id>/);
  assert.match(usage, new RegExp(API_ROLE_NAME));
  assert.match(usage, /docs\/RECIPES\/provision-the-api-role\.md/, 'the operator is pointed at the procedure');
  assert.match(usage, /SHARED/, 'the target is named in the usage, not left implicit');
});

test('a real apply REFUSES without a usable restore point (and says so without a stack)', () => {
  for (const missing of [null, '', 'short', 'not a valid id!']) {
    const argv = ARGV.concat(missing === null ? [] : ['--restore-point=' + missing]);
    assert.throws(() => parseArgs(argv), (error) => error.usage !== true && /REFUSING to apply/.test(error.message),
      JSON.stringify(missing) + ' must be refused, not defaulted');
  }
  // The same ^[A-Za-z0-9_-]{8,}$ shape the migration runner enforces.
  const accepted = parseArgs(ARGV.concat(['--restore-point=' + RESTORE_POINT]));
  assert.equal(accepted.restorePoint, RESTORE_POINT);
  assert.equal(accepted.dryRun, false);
});

test('--dry-run needs no restore point, and every other argument rule still holds', () => {
  const dry = parseArgs(ARGV.concat(['--dry-run']));
  assert.equal(dry.dryRun, true);
  assert.equal(dry.restorePoint, null);
  // …and a dry run may still carry one, so the operator can preview the exact
  // command they are about to run.
  assert.equal(parseArgs(ARGV.concat(['--dry-run', '--restore-point=' + RESTORE_POINT])).restorePoint, RESTORE_POINT);

  for (const bad of [['--test-db'], ['--nope'], ['extra'], ['--restore-point']]) {
    assert.throws(() => parseArgs(ARGV.concat(bad)), (error) => error.usage === true,
      bad.join(' ') + ' must be a usage error — there is deliberately no --test-db mode');
  }
  assert.throws(() => parseArgs(ARGV.concat(['--help'])), (error) => error.usage === true && /usage:/.test(error.message));
});

test('--target-env names a variable, never carries a URL', () => {
  assert.equal(parseArgs(ARGV.concat(['--dry-run'])).targetEnv, 'DATABASE_URL', 'the default is the shared database');
  assert.equal(parseArgs(ARGV.concat(['--dry-run', '--target-env=TARGET_DATABASE_URL'])).targetEnv,
    'TARGET_DATABASE_URL', 'a named variable is kept verbatim');
  // A URL on the command line would land in shell history and in `ps`, which the
  // password rule already forbids; naming the variable keeps it in the env file.
  for (const bad of ['', 'postgres://u:p@ep-x.neon.tech/neondb', 'lower_case', '1ABC']) {
    assert.throws(() => parseArgs(ARGV.concat(['--dry-run', '--target-env=' + bad])),
      (error) => error.usage === true, JSON.stringify(bad) + ' must be a usage error');
  }
  // The space form is not accepted either: the repo's rule for value-bearing flags.
  assert.throws(() => parseArgs(ARGV.concat(['--dry-run', '--target-env', 'X'])),
    (error) => error.usage === true);
});

test('the password comes from the file or the environment, never from argv', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-api-role-cli-'));
  const file = path.join(dir, 'password');
  try {
    fs.writeFileSync(file, 'from-a-file\n');
    const fromFile = resolvePassword({ passwordFile: file }, { [PASSWORD_ENV]: 'from-the-env' });
    assert.equal(fromFile.password, 'from-a-file', 'one trailing newline is stripped');
    assert.match(fromFile.source, /file /, 'the SOURCE is reported (the password never is)');
    assert.ok(!fromFile.source.includes('from-a-file'), 'the source line must not carry the secret');

    fs.writeFileSync(file, 'no-trailing-newline');
    assert.equal(resolvePassword({ passwordFile: file }, {}).password, 'no-trailing-newline');

    const fromEnv = resolvePassword({ passwordFile: null }, { [PASSWORD_ENV]: 'env-secret' });
    assert.equal(fromEnv.password, 'env-secret');
    assert.equal(fromEnv.source, PASSWORD_ENV);

    assert.throws(() => resolvePassword({ passwordFile: null }, { [PASSWORD_ENV]: '   ' }), /no password supplied/);
    assert.throws(() => resolvePassword({ passwordFile: null }, {}), /no password supplied/);
    assert.throws(() => resolvePassword({ passwordFile: path.join(dir, 'nope') }, {}), /could not read --password-file/);
    // argv is not consulted at all: there is no code path that reads the password
    // from a positional or a flag, so a shell history can never hold it.
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the target is the shared DATABASE_URL, and there is no branch mode to fall into', () => {
  assert.throws(() => resolveTarget({}), /DATABASE_URL is not set/);
  assert.throws(() => resolveTarget({ DATABASE_URL: '   ' }), /DATABASE_URL is not set/);
  // TEST_DATABASE_URL is irrelevant here: the apply targets shared by definition,
  // and a pooled host is reduced to its direct endpoint for the session SET.
  const pooled = resolveTarget({
    DATABASE_URL: 'postgresql://u:p@ep-fake-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require',
    TEST_DATABASE_URL: 'postgresql://u:p@ep-other.us-east-2.aws.neon.tech/neondb',
  });
  assert.equal(pooled.target.endpointId, 'ep-fake-123456', 'the -pooler label is stripped, so the endpoint id is the same');
  // The descriptor reports the DIRECT host, not the host as written: the apply
  // pins `search_path` with a session-level SET, and Neon's PgBouncer (transaction
  // mode) would not carry it past its own transaction. So a pooled DATABASE_URL is
  // reduced here, which is why `pooled` is false.
  assert.equal(pooled.target.pooled, false);
  assert.ok(pooled.directUrl.startsWith('postgresql://u:p@ep-fake-123456.'), 'the credential survives the host swap');
  assert.equal(pooled.target.database, 'neondb');
  assert.match(pooled.digest, /^db:[0-9a-f]{12}$/, 'the target is named by a digest, never a host');
  assert.ok(!pooled.digest.includes('neon.tech'));
  assert.ok(!JSON.stringify(pooled.target).includes('owner-s3cret'), 'the descriptor carries no credential');
  assert.equal(pooled.isShared, true);
  assert.equal(guardLabel(pooled), 'DATABASE_URL (SHARED)');

  // A NAMED variable is a different target, and the guard line must say which.
  const named = resolveTarget({
    DATABASE_URL: FAKE_SHARED,
    TARGET_DATABASE_URL: 'postgresql://u:p@ep-eu-production-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require',
  }, 'TARGET_DATABASE_URL');
  assert.equal(named.target.endpointId, 'ep-eu-production');
  assert.equal(named.isShared, false);
  assert.equal(guardLabel(named), 'TARGET_DATABASE_URL (named target)');
  // An unset NAMED variable fails with ITS OWN name, not the default's.
  assert.throws(() => resolveTarget({ DATABASE_URL: FAKE_SHARED }, 'TARGET_DATABASE_URL'),
    /TARGET_DATABASE_URL is not set/);
  assert.throws(() => resolveTarget({ TARGET_DATABASE_URL: '  ' }, 'TARGET_DATABASE_URL'),
    /TARGET_DATABASE_URL is not set/);
});

test('CLI: --help exits 2, a refusal exits 1, and neither prints a stack trace', () => {
  const help = spawnSync(process.execPath, ['scripts/apply-api-role.js', '--help'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: isolatedEnv(),
  });
  assert.equal(help.status, 2);
  assert.match(help.stdout + help.stderr, /USAGE: usage: node scripts\/apply-api-role\.js/);
  assert.doesNotMatch(help.stdout + help.stderr, /at main|at parseArgs|Node\.js v/);

  const missingRestorePoint = spawnSync(process.execPath, ['scripts/apply-api-role.js'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: isolatedEnv(),
  });
  assert.equal(missingRestorePoint.status, 1, 'a refusal is a run failure, not a usage error');
  const refusal = missingRestorePoint.stdout + missingRestorePoint.stderr;
  assert.match(refusal, /REFUSED: REFUSING to apply/);
  assert.doesNotMatch(refusal, /at main|Node\.js v/);
});

test('CLI: --dry-run prints the plan with the password redacted, exits 0, and needs no secret', () => {
  const child = spawnSync(process.execPath, ['scripts/apply-api-role.js', '--dry-run'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    // No API_ROLE_PASSWORD: a dry run must not need one.
    env: isolatedEnv({ DATABASE_URL: FAKE_SHARED }),
  });
  assert.equal(child.status, 0, 'dry run exits 0 (stderr: ' + child.stderr + ')');
  const output = child.stdout;
  assert.match(output, /AUDIT TARGET: db:[0-9a-f]{12}/, 'it names the target it would write to');
  assert.match(output, /guard: DATABASE_URL \(SHARED\)/);
  assert.match(output, /restore point: \(none\)/);
  assert.match(output, /CREATE ROLE morocco_pc_api LOGIN PASSWORD '<redacted>'/);
  assert.match(output, /GRANT INSERT ON recommendation_profile, recommendation_query, build_candidate, build_component, recommendation_result, build_rejection/);
  assert.match(output, /GRANT DELETE ON build_rejection/);
  assert.match(output, /GRANT UPDATE \(budget_floor\) ON recommendation_query/);
  assert.match(output, /DRY RUN: nothing connected, nothing applied, no password read\./);
  // The endpoint id is printed on purpose (the migration runner and every
  // harness name their target that way); the HOST and the credential are not.
  assert.doesNotMatch(output, /owner-s3cret|neon\.tech/, 'no credential and no host in the printed plan');
  assert.doesNotMatch(output, /GRANT UPDATE ON|GRANT ALL/, 'the plan is the least-privilege block, not something wider');
});

test('CLI: a real apply with the restore point but no password refuses BEFORE connecting', () => {
  const child = spawnSync(process.execPath, [
    'scripts/apply-api-role.js', '--restore-point=' + RESTORE_POINT,
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    // A host that cannot be reached: if the password check did not come first,
    // this would fail with a connection error instead of the refusal below.
    env: isolatedEnv({ DATABASE_URL: FAKE_SHARED }),
  });
  assert.equal(child.status, 1);
  const output = child.stdout + child.stderr;
  assert.match(output, /REFUSED: the password could not be read - no password supplied/);
  assert.doesNotMatch(output, /ECONNREFUSED|ENOTFOUND|getaddrinfo|connection terminated/i, 'it never dialled the target');
  assert.match(output, /CREATE ROLE morocco_pc_api LOGIN PASSWORD '<redacted>'/, 'the refusal still shows the plan');
});

test('requiring the script plans nothing and applies nothing (the require.main guard)', () => {
  const child = spawnSync(
    process.execPath,
    ['-e', 'const m = require("./scripts/apply-api-role.js"); console.log("LOADED-GUARD-OK " + Object.keys(m).sort().join(","));'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: isolatedEnv(),
    }
  );
  assert.equal(child.status, 0, 'require() must exit 0 (stderr: ' + child.stderr + ')');
  assert.match(child.stdout, /LOADED-GUARD-OK APPLICATION_NAME,PASSWORD_ENV,TARGET_ENV_DEFAULT,createRoleAndGrants,guardLabel,parseArgs,parseTargetEnvName,planStatements,resolvePassword,resolveTarget,usageText/);
});
