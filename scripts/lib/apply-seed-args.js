'use strict';

/**
 * scripts/lib/apply-seed-args.js — argv parsing and target resolution for
 * `scripts/apply-seed.js` (pure: no DB, no I/O, never assigns `process.env`).
 *
 * WHY THIS EXISTS. The seed applier could target exactly ONE database:
 * `TEST_DATABASE_URL`, through `resolveTestDbUrl()`. The two-stage release
 * recipe therefore could not run its own seed step — the documented
 * `--target-env` / `--restore-point` flags were refused as unknown arguments
 * (reproduced 2026-11-10 on the release branch: exit 1,
 * `APPLY FAILED: unknown argument: --target-env=TARGET_DATABASE_URL`).
 * Overriding `DATABASE_URL` in the shell would have worked, and is exactly what
 * R-29 removed for the importer: it is the variable every other tool in that
 * shell reads, with nothing checking which database the run actually reached.
 *
 * THE RULES, in the order the CLI applies them:
 *   1. with no `--target-env`, this stays the TEST-branch tool it always was:
 *      `resolveTestDbUrl` refuses a missing branch and a branch whose normalized
 *      host equals the shared database's;
 *   2. `--target-env=<NAME>` reads the connection string from that VARIABLE
 *      NAME (never a URL on argv, which would carry a password) and leaves
 *      `process.env` untouched, so the next command in the shell is unaffected.
 *      `DATABASE_URL` and `TEST_DATABASE_URL` are refused BY NAME: each already
 *      owns a path with different guards, and naming one here would skip every
 *      check while looking like it performed one;
 *   3. a named target must be provably distinct from the shared database by the
 *      `db:<12 hex>` DIGEST of host+database, so an alias of shared under another
 *      variable name (or its `-pooler` host) is refused;
 *   4. a WRITE to a named target requires `--restore-point=<id>` matching
 *      `^[A-Za-z0-9_-]{8,}$` — this names a database the checkout does not own,
 *      and a restore point nobody named is not a rollback plan. `--dry-run`
 *      connects to nothing, so it needs none;
 *   5. conflicting flags are REFUSED, never resolved by precedence:
 *      `--test-db` with `--target-env`, and a `--restore-point` with no named
 *      target (where it would be silently ignored — the kind of silence that
 *      loses a rollback plan).
 *
 * WHAT THE CALLER MUST DO. Print the resolved identity BEFORE connecting:
 * `target: <label> (db:<12 hex>)` and, for a named target,
 * `AUDIT TARGET: db:<12 hex> restore-point=<id>`. Nothing here is allowed to
 * print a connection string, a host or a credential.
 */

const { CONNECTION_TIMEOUT_MILLIS, resolveTestDbUrl } = require('../../packages/database-guard/src');
const { applyLogTarget, isValidRestorePointId } = require('./migrations');

/** A variable NAME, never a URL. */
const TARGET_ENV_RE = /^[A-Z][A-Z0-9_]*$/;

/** The two variables that already own a guarded path of their own. */
const RESERVED_TARGET_ENVS = new Set(['DATABASE_URL', 'TEST_DATABASE_URL']);

/** Usage errors mean "fix the invocation"; the CLI exits 2 having dialled nothing. */
class UsageError extends Error {}

function parseApplySeedArgs(argv) {
  const args = {
    file: null,
    dryRun: false,
    testDb: false,
    targetEnv: null,
    restorePoint: null,
    help: false,
  };
  const errors = [];
  const list = Array.isArray(argv) ? argv.slice() : [];

  for (let i = 0; i < list.length; i += 1) {
    const token = list[i];
    if (token === '--dry-run') {
      args.dryRun = true;
    } else if (token === '--test-db') {
      args.testDb = true;
    } else if (token === '--help' || token === '-h') {
      args.help = true;
    } else if (token.startsWith('--file=')) {
      args.file = token.slice('--file='.length);
    } else if (token === '--file') {
      errors.push('MALFORMED_FLAG:--file needs the equals form (--file=<path>)');
    } else if (token.startsWith('--target-env=')) {
      args.targetEnv = token.slice('--target-env='.length).trim();
    } else if (token === '--target-env') {
      errors.push('MALFORMED_FLAG:--target-env needs the equals form (--target-env=NAME)');
    } else if (token.startsWith('--restore-point=')) {
      args.restorePoint = token.slice('--restore-point='.length).trim();
    } else if (token === '--restore-point') {
      errors.push('MALFORMED_FLAG:--restore-point needs the equals form (--restore-point=<id>)');
    } else if (token.startsWith('--')) {
      errors.push('UNKNOWN_FLAG:' + token);
    } else if (args.file === null) {
      args.file = token;
    } else {
      errors.push('UNEXPECTED_ARGUMENT:' + token);
    }
  }

  if (args.help) return args;

  if (args.file === null || args.file.trim() === '') {
    errors.push('MISSING_SEED_FILE');
  }
  if (args.targetEnv !== null) {
    if (!TARGET_ENV_RE.test(args.targetEnv)) {
      errors.push('BAD_TARGET_ENV:--target-env expects an environment variable NAME matching ^[A-Z][A-Z0-9_]*$ (received: '
        + JSON.stringify(args.targetEnv) + '); pass a URL through the variable, never on the command line');
    } else if (RESERVED_TARGET_ENVS.has(args.targetEnv)) {
      errors.push('RESERVED_TARGET_ENV:--target-env=' + args.targetEnv
        + ' is reserved: omit --target-env for the TEST branch guard, and never name the shared database here');
    }
  }
  if (args.restorePoint !== null && !isValidRestorePointId(args.restorePoint)) {
    errors.push('BAD_RESTORE_POINT:--restore-point must match ^[A-Za-z0-9_-]{8,}$ (received: '
      + JSON.stringify(args.restorePoint) + '); a placeholder fails that shape on purpose');
  }
  if (args.testDb && args.targetEnv !== null) {
    errors.push('CONFLICTING_TARGETS:--test-db and --target-env name different databases; pass one');
  }
  if (args.restorePoint !== null && args.targetEnv === null) {
    errors.push('RESTORE_POINT_WITHOUT_TARGET:--restore-point needs --target-env=<NAME>; a restore point that nothing reads is not a rollback plan');
  }

  if (errors.length > 0) {
    throw new UsageError(errors.join(', '));
  }
  return args;
}

/**
 * Resolve the connection this run may use.
 *
 * @param {object} args parsed argv
 * @param {object} [env] injected for tests (the db-url.js / ingest-args.js convention)
 * @returns {{connectionString: string, connectionTimeoutMillis: number,
 *   label: string, digest: string|null, nonTest: boolean,
 *   restorePoint: string|null}}
 * @throws {Error} from resolveTestDbUrl on the branch path (that message is the contract)
 * @throws {UsageError} when a variable is unset, a URL is unusable, the target is
 *         the shared database, or a write has no restore point
 */
function resolveApplySeedTarget(args, env) {
  const source = env || {};

  if (args.targetEnv === null) {
    const guarded = resolveTestDbUrl(source);
    return {
      connectionString: guarded.connectionString,
      connectionTimeoutMillis: guarded.connectionTimeoutMillis,
      label: 'TEST_DATABASE_URL (write guard)',
      digest: null,
      nonTest: false,
      restorePoint: null,
    };
  }

  const raw = source[args.targetEnv];
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new UsageError('--target-env=' + args.targetEnv + ' names an unset or empty variable');
  }
  const shared = source.DATABASE_URL;
  if (typeof shared !== 'string' || shared.trim() === '') {
    // Without the baseline there is nothing to compare against, and "I could not
    // prove it is not shared" must never be read as "it is not shared".
    throw new UsageError('DATABASE_URL is not set, so --target-env=' + args.targetEnv
      + ' cannot be proven distinct from the shared database');
  }
  let digest;
  let sharedDigest;
  try {
    digest = applyLogTarget(raw);
  } catch (_error) {
    throw new UsageError('--target-env=' + args.targetEnv + ' is not a usable connection string');
  }
  try {
    sharedDigest = applyLogTarget(shared);
  } catch (_error) {
    throw new UsageError('DATABASE_URL is not a usable connection string');
  }
  if (digest === sharedDigest) {
    throw new UsageError('REFUSING to target --target-env=' + args.targetEnv + ': it IS the shared database ('
      + digest + '); name the release database, or omit --target-env for the TEST branch guard');
  }
  if (!args.dryRun && !isValidRestorePointId(args.restorePoint)) {
    throw new UsageError('a write to --target-env=' + args.targetEnv
      + ' needs --restore-point=<id> matching ^[A-Za-z0-9_-]{8,}$ (received: '
      + JSON.stringify(args.restorePoint) + '). A placeholder fails that shape on purpose.');
  }
  return {
    connectionString: raw,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MILLIS,
    label: args.targetEnv,
    digest,
    nonTest: true,
    restorePoint: args.restorePoint,
  };
}

module.exports = {
  UsageError,
  RESERVED_TARGET_ENVS,
  TARGET_ENV_RE,
  parseApplySeedArgs,
  resolveApplySeedTarget,
};
