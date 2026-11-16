'use strict';

/**
 * scripts/verify-pr2-provenance.js - manifest-driven extraction provenance gate
 * (protection L2 + L3). Step 4B PR 2 is batch 1 of the manifest.
 *
 * Two claims are made about an extraction and both must be checkable by a
 * reviewer without trusting the prose:
 *
 *   L2  the characterization fixture was captured from the code BEFORE anything
 *       moved, and has not been regenerated from the extracted code since;
 *   L3  every moved implementation module is byte-identical to its baseline
 *       blob - a move, not a rewrite. This is stronger than Git's rename
 *       percentage, which cannot reach 100% here because a shim now occupies
 *       each old path.
 *
 * Where the claims come from
 *   Not from this file. Every declared move, baseline and identity policy is
 *   read from extraction-manifest.json (version 1) through
 *   scripts/lib/extraction-manifest.js. PR 2's baseline is the commit recorded in
 *   the manifest and in the frozen fixture; it is never re-derived from the
 *   working tree, and a batch whose record does not validate is never partially
 *   verified.
 *
 * What is verified, per batch
 *   * the baseline is a real commit and an ancestor of HEAD;
 *   * every source and destination is a REGULAR FILE (mode 100644 or 100755) at
 *     its own revision - not a directory tree, a gitlink or a symlink, and a
 *     missing path is named as missing rather than as a mode problem;
 *   * the source blob at the baseline equals the destination blob at HEAD
 *     (IDENTITY_POLICY is the only policy, so there is nothing to branch on);
 *   * a batch that declares a characterization record must also show that its
 *     committed copy at HEAD (never the working tree) is a regular file that
 *     parses and names the same baseline, was ADDED by a commit whose parent is
 *     that baseline (captured before the move), is the only commit that touched
 *     it since, and has not changed since the capture commit;
 *   * that capture commit changed nothing except the fixture and the batch's
 *     declared `capture_paths` - no added, modified, renamed or deleted path
 *     outside them - and each declared capture path was absent at the baseline
 *     and is a regular file at the capture commit.
 *
 * DB-free, dependency-free, read-only. Run from the repository root:
 *   node scripts/verify-pr2-provenance.js
 *   node scripts/verify-pr2-provenance.js --manifest=<path> --repo=<path>
 *
 * Exit codes: 0 PASS, 1 FAIL, 2 argument error.
 */

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  REPO_ROOT,
  isAncestor,
  isGitRepository,
  loadManifest,
  manifestFile,
  regularFileAt,
  resolveCommit,
  tryGit,
} = require('./lib/extraction-manifest');

const USAGE = 'usage: node scripts/verify-pr2-provenance.js [--manifest=<path>] [--repo=<path>]';

function parseArgs(argv) {
  const options = { repo: REPO_ROOT, manifest: null, errors: [] };
  for (const arg of argv) {
    if (arg.startsWith('--repo=') || arg.startsWith('--manifest=')) {
      const value = arg.slice(arg.indexOf('=') + 1);
      if (value.length === 0) {
        options.errors.push(arg.slice(0, arg.indexOf('=') + 1) + ' needs a path');
      } else if (arg.startsWith('--repo=')) {
        options.repo = path.resolve(process.cwd(), value);
      } else {
        options.manifest = path.resolve(process.cwd(), value);
      }
    } else {
      options.errors.push('unknown argument ' + JSON.stringify(arg));
    }
  }
  return options;
}

function displayPath(absolute) {
  const relative = path.relative(REPO_ROOT, absolute);
  return (relative.length === 0 ? absolute : relative).split(path.sep).join('/');
}

/** One failure message, naming the side, the path and the revision that failed. */
function rejection(batchId, side, filePath, where, entry) {
  const prefix = 'batch ' + batchId + ': ' + side + ' ' + filePath;
  switch (entry.reason) {
    case 'missing':
      return prefix + ' does not exist at ' + where;
    case 'directory':
      return prefix + ' is a directory (tree) at ' + where + ', not a regular file';
    case 'gitlink':
      return prefix + ' is a gitlink (mode 160000, a submodule commit) at ' + where + ', not a regular file';
    case 'symlink':
      return prefix + ' is a symlink (mode 120000) at ' + where + ', not a regular file';
    case 'mode':
    case 'object':
      return prefix + ' is not a regular file at ' + where +
        ' (mode ' + (entry.mode || '?') + ', type ' + (entry.type || '?') + ')';
    default:
      return prefix + ' could not be read as a Git object at ' + where;
  }
}

/** A table cell: the accepted file's mode and blob prefix, or why it was refused. */
function renderEntry(entry) {
  if (entry.ok) return entry.mode + ' ' + entry.oid.slice(0, 10);
  if (entry.reason === 'missing') return 'missing';
  return entry.mode ? entry.reason + ' ' + entry.mode : entry.reason;
}

/** Why a path is not a usable regular file at `where`. */
function describeEntryAt(where, entry) {
  if (entry.reason === 'missing') return 'is missing at ' + where;
  if (entry.reason === 'directory') return 'is a directory (tree) at ' + where + ', not a regular file';
  if (entry.reason === 'gitlink') return 'is a gitlink (mode 160000, a submodule commit) at ' + where + ', not a regular file';
  if (entry.reason === 'symlink') return 'is a symlink (mode 120000) at ' + where + ', not a regular file';
  if (entry.reason === 'mode' || entry.reason === 'object') {
    return 'is not a regular file at ' + where + ' (mode ' + (entry.mode || '?') + ', type ' + (entry.type || '?') + ')';
  }
  return 'could not be read as a Git object at ' + where;
}

/**
 * Raw `git diff-tree --no-commit-id -r -M -z <commit>` output, untrimmed.
 *
 * `diff-tree` reads the commit's own trees, so the working tree cannot
 * contribute to the answer. The raw record format is used (not
 * `--name-status`) because it carries the tree modes beside the status, and
 * `-z` emits paths unquoted so an exact comparison with a manifest path is
 * meaningful. Output is NOT trimmed: a trailing-space path is still a path.
 */
function runGitRaw(repo, args) {
  try {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (_err) {
    return null;
  }
}

/**
 * Every path a commit changed, with its status and destination mode.
 *
 * A record is `:<old mode> <new mode> <old sha> <new sha> <status>\0<path>\0`,
 * and a rename or copy carries TWO paths (`R100\0old\0new\0`), so a rename
 * INTO an allowed name is still visible as a rename and still fails.
 */
function commitChanges(repo, commit) {
  const output = runGitRaw(repo, ['diff-tree', '--no-commit-id', '-r', '-M', '-z', commit]);
  if (output === null) return null;
  const tokens = output.split('\u0000');
  const changes = [];
  for (let i = 0; i < tokens.length; ) {
    const header = tokens[i];
    if (header === '') break;
    const parsed = /^:(\d{6}) (\d{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])(\d{1,3})?$/.exec(header);
    if (!parsed) return null;
    const status = parsed[5] + (parsed[6] || '');
    const paired = parsed[5] === 'R' || parsed[5] === 'C';
    const paths = paired ? [tokens[i + 1], tokens[i + 2]] : [tokens[i + 1]];
    if (paths.some((changed) => typeof changed !== 'string' || changed.length === 0)) return null;
    changes.push({
      status,
      paths,
      mode: parsed[2],
      description: status + ' ' + paths.join(' -> '),
    });
    i += paired ? 3 : 2;
  }
  return changes;
}

/**
 * L2, for one batch: the fixture predates the move and was not regenerated.
 *
 * The fixture cannot prove its own honesty, so the proof is in Git history, and
 * the fixture is read from HEAD rather than the working tree - a dirty or
 * edited file must not stand in for the committed evidence:
 *   * the committed fixture is a regular file at HEAD and parses;
 *   * it names the manifest baseline and the declared capture command;
 *   * exactly `expect_touch_commits` commits touched it since the baseline, each
 *     carrying the declared subject;
 *   * the commit that ADDED it is the only one, and its parent is the baseline,
 *     so the capture was committed before anything moved;
 *   * that commit changes NOTHING except the fixture and any declared
 *     `capture_paths`; each declared path must have been absent at the baseline
 *     (nothing to alter) and be a regular file at the capture commit;
 *   * the fixture has not changed since.
 */
function verifyCharacterization(repo, batch, lines, failures) {
  const record = batch.characterization;
  const label = batch.id;
  const fixtureLabel = 'characterization fixture ' + record.fixture;
  const capturePaths = record.capture_paths || [];

  const atHead = regularFileAt(repo, 'HEAD', record.fixture);
  if (!atHead.ok) {
    failures.push('batch ' + label + ': ' + fixtureLabel + ' ' + describeEntryAt('HEAD', atHead));
    return;
  }
  const committed = tryGit(repo, ['show', 'HEAD:' + record.fixture]);
  if (!committed.ok) {
    failures.push('batch ' + label + ': ' + fixtureLabel + ' could not be read at HEAD');
    return;
  }
  let fixture;
  try {
    fixture = JSON.parse(committed.out);
  } catch (err) {
    failures.push('batch ' + label + ': ' + fixtureLabel + ' is not valid JSON at HEAD: ' + err.message);
    return;
  }

  lines.push('characterization fixture: ' + record.fixture + ' (read from HEAD)');

  const provenance = fixture && typeof fixture === 'object' ? fixture.provenance : null;
  if (provenance === null || typeof provenance !== 'object') {
    failures.push('batch ' + label + ': the fixture has no provenance block to compare with the manifest');
    return;
  }
  if (provenance.baseline_sha !== batch.baseline_sha) {
    failures.push(
      'batch ' + label + ': the fixture names baseline ' + String(provenance.baseline_sha) +
      ' but the manifest baseline is ' + batch.baseline_sha
    );
  }
  if (provenance.command !== record.capture_command) {
    failures.push(
      'batch ' + label + ': the fixture was produced by ' + JSON.stringify(provenance.command) +
      ', not the declared ' + JSON.stringify(record.capture_command)
    );
  }

  const touching = tryGit(repo, ['log', '--format=%H\t%s', batch.baseline_sha + '..HEAD', '--', record.fixture]);
  const touches = touching.ok ? touching.out.split('\n').filter(Boolean) : [];
  lines.push('commits touching the fixture since baseline: ' + touches.length + ' (expected ' + record.expect_touch_commits + ')');
  for (const line of touches) lines.push('  ' + line.replace('\t', ' '));
  if (touches.length !== record.expect_touch_commits) {
    failures.push(
      'batch ' + label + ': the fixture was touched by ' + touches.length + ' commits; expected exactly ' +
      record.expect_touch_commits + ' (its capture)'
    );
  }
  for (const line of touches) {
    const subject = line.split('\t').slice(1).join(' ');
    if (subject !== record.capture_commit_subject) {
      failures.push(
        'batch ' + label + ': a commit touching the fixture is not the pre-move capture (' +
        JSON.stringify(subject) + ' != ' + JSON.stringify(record.capture_commit_subject) + ')'
      );
    }
  }

  const added = tryGit(repo, ['log', '--diff-filter=A', '--format=%H', batch.baseline_sha + '..HEAD', '--', record.fixture]);
  const captures = added.ok ? added.out.split('\n').filter(Boolean) : [];
  if (captures.length !== 1) {
    failures.push('batch ' + label + ': the fixture must be ADDED by exactly one commit after the baseline, found ' + captures.length);
    return;
  }
  const capture = captures[0];

  const changes = commitChanges(repo, capture);
  if (changes === null) {
    failures.push('batch ' + label + ': the changed paths of the capture commit ' + capture + ' could not be read');
  } else {
    const allowed = new Set([record.fixture, ...capturePaths]);
    const unexpected = changes.filter((change) => change.status !== 'A' || !allowed.has(change.paths[0]));
    if (changes.length === 0) {
      failures.push('batch ' + label + ': the capture commit ' + capture + ' changes no path, so it cannot be the fixture capture');
    } else if (unexpected.length > 0) {
      failures.push(
        'batch ' + label + ': the capture commit ' + capture +
        ' changes paths other than the fixture and its declared capture paths: ' +
        unexpected.map((change) => change.description).join(', ')
      );
    } else {
      lines.push('capture commit changes only declared paths: ' + changes.map((change) => change.description).join(', '));
    }

    for (const capturePath of capturePaths) {
      if (regularFileAt(repo, batch.baseline_sha, capturePath).reason !== 'missing') {
        failures.push(
          'batch ' + label + ': capture path ' + capturePath + ' already exists at the baseline ' +
          batch.baseline_sha + ', so it cannot have been introduced by the capture commit'
        );
      }
      const atCapture = regularFileAt(repo, capture, capturePath);
      if (!atCapture.ok) {
        failures.push(
          'batch ' + label + ': capture path ' + capturePath + ' ' +
          describeEntryAt('the capture commit ' + capture, atCapture)
        );
      }
    }
  }

  const parent = tryGit(repo, ['rev-parse', capture + '^']);
  const capturedBeforeTheMove = parent.ok && parent.out === batch.baseline_sha;
  if (!capturedBeforeTheMove) {
    failures.push(
      'batch ' + label + ': the fixture capture commit ' + capture.slice(0, 10) +
      ' is not a child of the baseline ' + batch.baseline_sha +
      ', so it was not captured before the move'
    );
  }

  const unchanged = tryGit(repo, ['diff', '--quiet', capture, 'HEAD', '--', record.fixture]);
  if (!unchanged.ok) {
    failures.push('batch ' + label + ': the fixture changed after its capture commit ' + capture.slice(0, 10) + ' - it was regenerated');
  }

  lines.push('fixture captured before the move: ' + (capturedBeforeTheMove ? 'yes' : '**NO**'));
  lines.push('fixture unchanged since its capture commit: ' + (unchanged.ok ? 'yes' : '**NO**'));
}

/** Verify one batch's baseline, fixture origin and every declared move. */
function verifyBatch(repo, batch, failures) {
  const lines = [''];
  lines.push('## batch ' + batch.id);
  if (batch.description) lines.push(batch.description);
  lines.push('baseline: ' + batch.baseline_sha);

  if (!resolveCommit(repo, batch.baseline_sha).ok) {
    failures.push('batch ' + batch.id + ': the baseline ' + batch.baseline_sha + ' does not exist in this repository');
    return { lines, identical: 0 };
  }
  if (!isAncestor(repo, batch.baseline_sha)) {
    failures.push('batch ' + batch.id + ': the baseline ' + batch.baseline_sha + ' is not an ancestor of HEAD');
    return { lines, identical: 0 };
  }

  const date = tryGit(repo, ['log', '-1', '--format=%cI', batch.baseline_sha]);
  lines.push('baseline is an ancestor of HEAD: yes' + (date.ok ? ' (' + date.out + ')' : ''));
  lines.push('identity policy: ' + batch.identity_policy);

  if (batch.characterization) {
    verifyCharacterization(repo, batch, lines, failures);
  } else {
    lines.push('characterization: none declared for this batch (L3 blob identity only)');
  }

  lines.push('');
  lines.push('| Declared move | baseline entry | HEAD entry | identical |');
  lines.push('|---|---|---|---|');

  let identical = 0;
  for (const module of batch.modules) {
    const before = regularFileAt(repo, batch.baseline_sha, module.source);
    const after = regularFileAt(repo, 'HEAD', module.destination);
    if (!before.ok) failures.push(rejection(batch.id, 'source', module.source, 'baseline ' + batch.baseline_sha, before));
    if (!after.ok) failures.push(rejection(batch.id, 'destination', module.destination, 'HEAD', after));

    const same = before.ok && after.ok && before.oid === after.oid;
    if (before.ok && after.ok && !same) {
      failures.push('batch ' + batch.id + ': blob differs for ' + module.destination + ' - the file was rewritten, not moved');
    }
    if (same) identical += 1;

    lines.push(
      '| `' + module.source + '` -> `' + module.destination + '` | ' +
      renderEntry(before) + ' | ' + renderEntry(after) + ' | ' + (same ? 'yes' : '**NO**') + ' |'
    );
  }

  lines.push('');
  lines.push("blob-identical in '" + batch.id + "': " + identical + ' / ' + batch.modules.length);

  return { lines, identical };
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.errors.length > 0) {
    process.stderr.write('verify-pr2-provenance: ' + options.errors.join('\n  ') + '\n' + USAGE + '\n');
    return 2;
  }

  if (!isGitRepository(options.repo)) {
    process.stderr.write('verify-pr2-provenance: FAIL\n  - ' + options.repo + ' is not a git repository\n');
    return 1;
  }

  const file = options.manifest || manifestFile(options.repo);
  const loaded = loadManifest(file);
  process.stdout.write('manifest: ' + displayPath(file) + '\n');

  if (loaded.errors.length > 0) {
    process.stderr.write('verify-pr2-provenance: FAIL\n');
    for (const error of loaded.errors) process.stderr.write('  - ' + error + '\n');
    return 1;
  }

  const failures = [];
  const characterized = [];
  let declared = 0;
  let identical = 0;

  // Validation already rejects duplicate moves and shared destinations, so a
  // normalised manifest gives each move exactly one visit here.
  for (const batch of loaded.batches) {
    const result = verifyBatch(options.repo, batch, failures);
    for (const line of result.lines) process.stdout.write(line + '\n');
    declared += batch.modules.length;
    identical += result.identical;
    if (batch.characterization) characterized.push(batch.id);
  }

  process.stdout.write(
    '\nmoves checked: ' + declared + ' declared in ' + loaded.batches.length + ' batch(es), each exactly once\n' +
    'blob-identical: ' + identical + ' / ' + declared + '\n' +
    'characterization verified for: ' + (characterized.length > 0 ? characterized.join(', ') : 'no batch') + '\n'
  );

  if (failures.length > 0) {
    process.stderr.write('\nverify-pr2-provenance: FAIL\n');
    for (const failure of failures) process.stderr.write('  - ' + failure + '\n');
    return 1;
  }

  process.stdout.write(
    'verify-pr2-provenance: PASS - ' + declared + ' declared move(s) across ' + loaded.batches.length +
    ' batch(es); ' + identical + ' blob-identical; ' +
    (characterized.length > 0 ? characterized.length + ' fixture origin(s) verified' : 'no fixture origin declared') + '\n'
  );
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

// Exported for inspection and for the regression suite: requiring this file must
// not run the gate.
module.exports = {
  parseArgs,
  rejection,
  renderEntry,
  verifyBatch,
  verifyCharacterization,
};
