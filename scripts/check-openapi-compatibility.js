#!/usr/bin/env node
'use strict';

/**
 * scripts/check-openapi-compatibility.js - the backward-compatibility gate.
 *
 *   node scripts/check-openapi-compatibility.js --base=origin/master
 *
 * The BASELINE is retrieved from the Git ref the caller names - never from a
 * second committed file, and never from the served document. There is no
 * "already-approved baseline" to drift: the history is the baseline.
 *
 * The CANDIDATE is the working-tree contract located by
 * `scripts/lib/openapi-contract.js` (exactly one file, in `contract/`).
 *
 * Exit status:
 *   0  ADDITIVE or NEUTRAL, or a BREAKING change explicitly approved
 *   1  an unauthorized BREAKING change
 *   2  usage error (or a baseline that cannot be read) - nothing was judged
 *
 * An approved breaking change needs BOTH `--allow-breaking` and a non-trivial
 * `--approval-note="<who reviewed it and why>"`. The note is printed with the
 * verdict, so the waiver is visible in the CI log instead of implied by a
 * flag; a bare flag is a refusal, not a waiver.
 *
 * The pre-3b location (`apps/api/test/unit/openapi-*.json`) is read from
 * history when the ref predates the move: that is a historical path, not a
 * second maintained baseline. The candidate is never read from there.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { inspectContract, isContractName } = require('./lib/openapi-contract');
const { compareContracts } = require('./lib/openapi-compat');

const ROOT = path.resolve(__dirname, '..');
const LEGACY_DIR = 'apps/api/test/unit';
let root = ROOT;

function usage(message) {
  if (message) console.error('check-openapi-compatibility: ' + message);
  console.error(
    'usage: node scripts/check-openapi-compatibility.js --base=<git-ref> [--allow-breaking --approval-note="<review>"]'
  );
  process.exit(2);
}

function parseArgs(argv) {
  const args = { base: null, allowBreaking: false, approvalNote: null, root: ROOT };
  for (const token of argv) {
    if (token.startsWith('--base=')) {
      args.base = token.slice('--base='.length).trim();
    } else if (token.startsWith('--root=')) {
      // Test hook only: the gate always runs against its own repository checkout.
      args.root = path.resolve(token.slice('--root='.length).trim());
    } else if (token === '--allow-breaking') {
      args.allowBreaking = true;
    } else if (token.startsWith('--approval-note=')) {
      args.approvalNote = token.slice('--approval-note='.length).trim();
    } else if (token === '--help' || token === '-h') {
      usage(null);
    } else {
      usage('unknown argument ' + JSON.stringify(token));
    }
  }
  if (!args.base) usage('--base=<git-ref> is required: the baseline comes from Git history, not from a committed copy');
  return args;
}

function git(gitArgs) {
  return execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8' });
}

/**
 * The baseline contract path at a ref. `contract/` is authoritative; the legacy
 * test directory is accepted only for refs that predate the move.
 *
 * @returns {{path: string, legacy: boolean}}
 */
function baselinePath(ref) {
  for (const directory of [ 'contract', LEGACY_DIR ]) {
    let listing;
    try {
      listing = git(['ls-tree', '-r', '--name-only', ref, '--', directory]);
    } catch (_error) {
      usage('cannot read git ref ' + JSON.stringify(ref) + '; fetch it first (git fetch origin)');
    }
    const candidates = listing
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.endsWith('.json') && isContractName(path.basename(line)));
    if (candidates.length === 1) {
      return { path: candidates[0], legacy: directory === LEGACY_DIR };
    }
    if (candidates.length > 1) {
      usage(
        'ref ' + ref + ' carries ' + candidates.length + ' contracts under ' + directory + '/ ('
          + candidates.join(', ') + '); a baseline must be unambiguous'
      );
    }
  }
  usage('ref ' + ref + ' carries no openapi-<major>.<minor>.<patch>.json contract');
  return { path: '', legacy: false };
}

function describe(change) {
  return '  ' + change.classification + '  ' + change.code + '  ' + change.location + ' - ' + change.detail;
}

function main(argv) {
  const args = parseArgs(argv);
  root = args.root;

  const candidate = inspectContract(root);
  if (!candidate.ok) {
    console.error('FAIL contract-location');
    for (const problem of candidate.problems) console.error('  - ' + problem);
    process.exit(2);
  }

  const baseline = baselinePath(args.base);
  let baseDocument;
  try {
    baseDocument = JSON.parse(git(['show', args.base + ':' + baseline.path]));
  } catch (error) {
    usage('cannot read the baseline contract ' + baseline.path + ' at ' + args.base + ': ' + error.message);
  }

  let candidateDocument;
  try {
    candidateDocument = JSON.parse(fs.readFileSync(path.join(root, candidate.file), 'utf8'));
  } catch (error) {
    usage('cannot read the candidate contract ' + candidate.file + ': ' + error.message);
  }

  const result = compareContracts(baseDocument, candidateDocument);

  console.log(
    'baseline: ' + args.base + ':' + baseline.path
      + (baseline.legacy ? ' (pre-3b location, read from history only)' : '')
  );
  console.log('candidate: ' + candidate.file + ' (contract ' + candidate.version + ')');

  if (result.changes.length === 0) {
    console.log('PASS openapi-compatibility - no client-visible change');
    return 0;
  }
  for (const item of result.changes) console.log(describe(item));

  const approved = args.allowBreaking && typeof args.approvalNote === 'string' && args.approvalNote.length >= 10;

  if (result.breaking.length === 0) {
    console.log('PASS openapi-compatibility - ' + result.verdict + ', ' + result.changes.length + ' change(s), 0 breaking');
    return 0;
  }

  if (!approved) {
    console.error('FAIL openapi-compatibility - ' + result.breaking.length + ' BREAKING change(s)');
    console.error(
      '  A breaking change needs a documented review and owner approval. Bump the major version (see the versioning\n'
      + '  policy in docs/architecture/...). If the change really is approved, re-run with:\n'
      + '    --allow-breaking --approval-note="<who approved this and why>"'
    );
    return 1;
  }

  console.log(
    'PASS openapi-compatibility - ' + result.breaking.length + ' BREAKING change(s) ACCEPTED under an explicit waiver'
  );
  console.log('  approval-note: ' + args.approvalNote);
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { main, parseArgs, baselinePath };
