'use strict';

/**
 * Ingestion CLI argument parsing, target resolution and safety guards (pure: no
 * DB, no I/O).
 *
 * THE PROBLEM THIS SOLVES. Until now the importer could target exactly two
 * databases: `TEST_DATABASE_URL` (via `--test-db`) or whatever `DATABASE_URL`
 * happened to hold. A release import — the EU database — therefore required
 * overriding `DATABASE_URL` in the shell, which is the same variable every other
 * tool reads, so one typo in one `export` pointed the importer (and anything
 * else in that shell) at the wrong database with nothing to check it against.
 * `scripts/generate-presets.js` already solved this for the preset shelf with
 * `--target-env=<NAME>`; this module gives the importer the same shape.
 *
 * THE RULES, in the order the CLI applies them:
 *   1. dry-run is the DEFAULT and needs no restore point;
 *   2. `--commit` against the SHARED `DATABASE_URL` still requires
 *      `--confirm-shared` (`guardSharedCommit`, unchanged);
 *   3. `--commit` against a NAMED target requires `--restore-point=<id>`
 *      matching `^[A-Za-z0-9_-]{8,}$` — the flag names a database this checkout
 *      does not own, and a restore point nobody named is not a rollback plan;
 *   4. a named target must be provably distinct from the shared database: the
 *      comparison is a `db:<12 hex>` DIGEST of the connection target, not the
 *      variable name, so an alias of the shared database under another name is
 *      refused;
 *   5. conflicting flags are refused rather than resolved by precedence:
 *      `--test-db` with `--target-env`, `--confirm-shared` with `--target-env`,
 *      and a `--restore-point` with no named target (where it would be silently
 *      ignored, which is exactly the kind of silence that loses a rollback plan).
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO: it never touches `process.env`. The
 * resolved connection string is a VALUE the caller hands to `pg`, so a release
 * import cannot change what the next command in the same shell — or another
 * module in the same process — reads from `DATABASE_URL`.
 *
 * Exit-code policy lives in the CLI: `UsageError` means "fix the invocation"
 * (exit 2, nothing dialled); anything else is a failed run (exit 1).
 */

const { CONNECTION_TIMEOUT_MILLIS, resolveTestDbUrl } = require('./db-url');
const { applyLogTarget, isValidRestorePointId } = require('./migrations');

const ADAPTERS = new Set(['manual']);
const FORMATS = new Set(['csv', 'json']);

/**
 * Variable names the two default paths already own. Refusing both BY NAME keeps
 * ONE meaning per invocation: either the branch guard ran, or an explicit target
 * did — `--target-env=DATABASE_URL` would otherwise be a way to skip every check
 * while looking like it performed one.
 */
const RESERVED_TARGET_ENVS = new Set(['DATABASE_URL', 'TEST_DATABASE_URL']);

/** A variable NAME, never a URL: a URL on the command line carries a password. */
const TARGET_ENV_RE = /^[A-Z][A-Z0-9_]*$/;

class UsageError extends Error {}

/**
 * Parse the importer's command line.
 *
 * @param {string[]} argv `process.argv.slice(2)`
 * @returns {{adapter: string|null, file: string|null, format: string|null,
 *   commit: boolean, testDb: boolean, confirmShared: boolean,
 *   targetEnv: string|null, restorePoint: string|null, help: boolean,
 *   errors: string[]}}
 */
function parseIngestArgs(argv) {
  const args = {
    adapter: null,
    file: null,
    format: null,
    commit: false,
    testDb: false,
    confirmShared: false,
    targetEnv: null,
    restorePoint: null,
    help: false,
    errors: [],
  };
  const list = Array.isArray(argv) ? argv.slice() : [];

  for (let i = 0; i < list.length; i += 1) {
    const token = list[i];
    if (token === '--commit') args.commit = true;
    else if (token === '--dry-run') args.commit = false;
    else if (token === '--test-db') args.testDb = true;
    else if (token === '--confirm-shared') args.confirmShared = true;
    else if (token === '--help' || token === '-h') args.help = true;
    else if (token.startsWith('--adapter=')) args.adapter = token.slice('--adapter='.length);
    else if (token === '--adapter') args.adapter = list[++i];
    else if (token.startsWith('--file=')) args.file = token.slice('--file='.length);
    else if (token === '--file') args.file = list[++i];
    else if (token.startsWith('--format=')) args.format = token.slice('--format='.length);
    else if (token === '--format') args.format = list[++i];
    else if (token.startsWith('--target-env=')) args.targetEnv = token.slice('--target-env='.length).trim();
    else if (token === '--target-env') {
      // The space form is refused rather than accepted: it is ambiguous with the
      // next flag and it is the form every other target flag in the tree rejects.
      args.errors.push('MALFORMED_FLAG:--target-env needs the equals form (--target-env=NAME)');
    } else if (token.startsWith('--restore-point=')) args.restorePoint = token.slice('--restore-point='.length).trim();
    else if (token === '--restore-point') {
      args.errors.push('MALFORMED_FLAG:--restore-point needs the equals form (--restore-point=<id>)');
    } else args.errors.push('UNKNOWN_ARG:' + token);
  }

  if (!args.help) {
    if (!args.adapter) args.errors.push('MISSING_ADAPTER');
    else if (!ADAPTERS.has(args.adapter)) args.errors.push('UNKNOWN_ADAPTER:' + args.adapter);
    if (!args.file) args.errors.push('MISSING_FILE');
    if (args.format && !FORMATS.has(args.format)) args.errors.push('UNKNOWN_FORMAT:' + args.format);

    if (args.targetEnv !== null) {
      if (!TARGET_ENV_RE.test(args.targetEnv)) {
        args.errors.push('BAD_TARGET_ENV:--target-env expects an environment variable NAME matching ^[A-Z][A-Z0-9_]*$ (received: '
          + JSON.stringify(args.targetEnv) + '); pass a URL through the variable, never on the command line');
      } else if (RESERVED_TARGET_ENVS.has(args.targetEnv)) {
        args.errors.push('RESERVED_TARGET_ENV:--target-env=' + args.targetEnv
          + ' is reserved: omit --target-env for the shared database (with --confirm-shared), or use --test-db for the branch');
      }
    }
    if (args.restorePoint !== null && !isValidRestorePointId(args.restorePoint)) {
      args.errors.push('BAD_RESTORE_POINT:--restore-point must match ^[A-Za-z0-9_-]{8,}$ (received: '
        + JSON.stringify(args.restorePoint) + '); a placeholder fails that shape on purpose');
    }

    // Conflicts are REFUSED, never resolved by precedence: every one of these
    // pairs has two plausible readings and the wrong reading writes to the wrong
    // database.
    if (args.testDb && args.targetEnv !== null) {
      args.errors.push('CONFLICTING_TARGETS:--test-db and --target-env name different databases; pass one');
    }
    if (args.confirmShared && args.targetEnv !== null) {
      args.errors.push('CONFLICTING_SHARED_CONFIRM:--confirm-shared approves a write to the SHARED database, which --target-env='
        + args.targetEnv + ' is not; use --restore-point=<id> for a named target');
    }
    if (args.restorePoint !== null && args.targetEnv === null) {
      args.errors.push('RESTORE_POINT_WITHOUT_TARGET:--restore-point needs --target-env=<NAME>; a restore point that nothing reads is not a rollback plan');
    }
  }
  return args;
}

/**
 * @returns {string|null} a refusal message, or null when the commit may proceed.
 */
function guardSharedCommit(args, options) {
  const targetIsShared = options && options.targetIsShared;
  if (!args.commit) return null;
  if (!targetIsShared) return null;
  if (args.confirmShared) return null;
  return 'REFUSED: --commit against the shared DATABASE_URL requires --confirm-shared. '
    + 'No data was written. Approve the write explicitly, or target the test branch with --test-db.';
}

/**
 * Resolve the connection this run may use.
 *
 * @param {object} args parsed argv
 * @param {object} [env] injected for tests (the db-url.js / model-pin.js convention)
 * @returns {{connectionString: string, connectionTimeoutMillis: number,
 *   label: string, digest: string|null, nonTest: boolean,
 *   restorePoint: string|null}}
 * @throws {UsageError} when a variable is unset, a URL is unusable, the target is
 *         the shared database, or a write has no restore point
 */
function resolveIngestTarget(args, env) {
  const source = env || {};

  if (args.targetEnv === null) {
    if (args.testDb) {
      // The branch guard every write-capable script in this repo uses; it throws
      // a plain Error, so it is re-raised untouched (the message is the contract).
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
    const shared = source.DATABASE_URL;
    if (typeof shared !== 'string' || shared.trim() === '') {
      throw new UsageError('DATABASE_URL is not set: pass --test-db, or name the release database with --target-env=<VAR>');
    }
    let digest;
    try {
      digest = applyLogTarget(shared);
    } catch (_error) {
      throw new UsageError('DATABASE_URL is not a usable connection string');
    }
    return {
      connectionString: shared,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MILLIS,
      label: 'DATABASE_URL (shared)',
      digest,
      nonTest: true,
      restorePoint: args.restorePoint,
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
      + digest + '); name the release database, or use --test-db for the branch');
  }
  if (args.commit && !isValidRestorePointId(args.restorePoint)) {
    throw new UsageError('--commit against --target-env=' + args.targetEnv
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

/** One line naming the target, without a host: `target: VAR (db:<12 hex>)`. */
function targetLine(target) {
  return 'target: ' + target.label + (target.digest === null ? '' : ' (' + target.digest + ')');
}

/**
 * The line a release run prints before it connects: the digest proves WHICH
 * database a run changed without quoting a host, and the restore point is the
 * other half. A run with no restore point (a dry run, or the TEST branch) prints
 * no empty field.
 *
 * @param {{digest: string|null}} target the resolved target
 * @param {string|null} restorePoint the id the write relies on, or null
 * @returns {string} `AUDIT TARGET: db:<12 hex>[ restore-point=<id>]`
 */
function auditTargetLine(target, restorePoint) {
  return 'AUDIT TARGET: ' + target.digest + (restorePoint ? ' restore-point=' + restorePoint : '');
}

module.exports = {
  ADAPTERS,
  FORMATS,
  RESERVED_TARGET_ENVS,
  TARGET_ENV_RE,
  UsageError,
  parseIngestArgs,
  guardSharedCommit,
  resolveIngestTarget,
  targetLine,
  auditTargetLine,
};
