'use strict';

/**
 * Ingestion CLI argument parsing + safety guards (pure; no DB, no I/O).
 *
 * Dry-run is the DEFAULT. `--commit` is required to write. A commit against the
 * shared DATABASE_URL additionally requires `--confirm-shared` and is refused
 * with a clear message otherwise — the operator must have approved the write.
 */

const ADAPTERS = new Set(['manual']);
const FORMATS = new Set(['csv', 'json']);

function parseIngestArgs(argv) {
  const args = {
    adapter: null,
    file: null,
    format: null,
    commit: false,
    testDb: false,
    confirmShared: false,
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
    else args.errors.push('UNKNOWN_ARG:' + token);
  }

  if (!args.help) {
    if (!args.adapter) args.errors.push('MISSING_ADAPTER');
    else if (!ADAPTERS.has(args.adapter)) args.errors.push('UNKNOWN_ADAPTER:' + args.adapter);
    if (!args.file) args.errors.push('MISSING_FILE');
    if (args.format && !FORMATS.has(args.format)) args.errors.push('UNKNOWN_FORMAT:' + args.format);
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

module.exports = { ADAPTERS, FORMATS, parseIngestArgs, guardSharedCommit };
