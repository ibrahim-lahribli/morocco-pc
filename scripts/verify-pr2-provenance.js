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
 *   scripts/lib/extraction-manifest.js, so adding a batch is publishing a new
 *   object in the manifest rather than editing a checker. PR 2's baseline is the
 *   commit recorded in the manifest and in the frozen fixture; it is never
 *   re-derived from the working tree.
 *
 * What is verified, per batch
 *   * the baseline is a real commit and an ancestor of HEAD;
 *   * every source path exists at the baseline and every destination exists at
 *     HEAD;
 *   * the source blob at the baseline equals the destination blob at HEAD under
 *     the declared identity policy;
 *   * every declared move is checked exactly once (duplicates are rejected while
 *     validating the manifest, and re-detected here);
 *   * a batch that declares a characterization record must also show that its
 *     fixture names the same baseline, was ADDED by a commit whose parent is
 *     that baseline (captured before the move), is the only commit that touched
 *     it since, and has not changed since the capture commit.
 *
 * Fail-closed: a missing manifest, an unknown batch, a malformed record, an
 * unsupported identity policy or a missing object is a FAIL, never a skip.
 *
 * DB-free, dependency-free, read-only. Run from the repository root:
 *   node scripts/verify-pr2-provenance.js
 *   node scripts/verify-pr2-provenance.js --batch=step-4b-pr2
 *   node scripts/verify-pr2-provenance.js --manifest=<path> --repo=<path>
 *
 * Exit codes: 0 PASS, 1 FAIL, 2 argument error.
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  REPO_ROOT,
  blobAt,
  fileExistsAt,
  isAncestor,
  isGitRepository,
  loadManifest,
  manifestFile,
  resolveCommit,
  tryGit,
} = require('./lib/extraction-manifest');

const USAGE =
  'usage: node scripts/verify-pr2-provenance.js [--manifest=<path>] [--repo=<path>] [--batch=<id>]';

function parseArgs(argv) {
  const options = { repo: REPO_ROOT, manifest: null, batch: null, errors: [] };
  for (const arg of argv) {
    if (arg.startsWith('--repo=')) {
      const value = arg.slice('--repo='.length);
      if (value.length === 0) options.errors.push('--repo= needs a path');
      else options.repo = path.resolve(process.cwd(), value);
    } else if (arg.startsWith('--manifest=')) {
      const value = arg.slice('--manifest='.length);
      if (value.length === 0) options.errors.push('--manifest= needs a path');
      else options.manifest = path.resolve(process.cwd(), value);
    } else if (arg.startsWith('--batch=')) {
      const value = arg.slice('--batch='.length);
      if (value.length === 0) options.errors.push('--batch= needs a batch id');
      else options.batch = value;
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

/**
 * L2, for one batch: the fixture predates the move and was not regenerated.
 *
 * The fixture cannot prove its own honesty, so the proof is in Git history:
 * exactly `expect_touch_commits` commits touched it since the baseline, the
 * commit that ADDED it is one of them, that commit's parent is the baseline (so
 * the capture was committed before anything moved), its subject matches the
 * manifest, and the fixture has not changed since.
 */
function verifyCharacterization(repo, batch, lines, failures) {
  const record = batch.characterization;
  const label = batch.id;
  const fixtureAbs = path.join(repo, record.fixture);

  lines.push('characterization fixture: ' + record.fixture);

  if (!fs.existsSync(fixtureAbs)) {
    failures.push('batch ' + label + ': characterization fixture ' + record.fixture + ' is missing');
    return;
  }

  let fixture;
  try {
    fixture = JSON.parse(fs.readFileSync(fixtureAbs, 'utf8'));
  } catch (err) {
    failures.push('batch ' + label + ': characterization fixture ' + record.fixture + ' is not valid JSON: ' + err.message);
    return;
  }

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
    failures.push(
      'batch ' + label + ': the fixture must be ADDED by exactly one commit after the baseline, found ' + captures.length
    );
    return;
  }
  const capture = captures[0];

  const parent = tryGit(repo, ['rev-parse', capture + '^']);
  if (!parent.ok || parent.out !== batch.baseline_sha) {
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

  lines.push('fixture captured before the move: ' + (parent.ok && parent.out === batch.baseline_sha ? 'yes' : '**NO**'));
  lines.push('fixture unchanged since its capture commit: ' + (unchanged.ok ? 'yes' : '**NO**'));
}

/** Verify one batch's baseline, fixture origin and every declared move. */
function verifyBatch(repo, batch, failures) {
  const lines = [''];
  lines.push('## batch ' + batch.id);
  if (batch.description) lines.push(batch.description);
  lines.push('baseline: ' + batch.baseline_sha);

  const resolved = resolveCommit(repo, batch.baseline_sha);
  if (!resolved.ok) {
    failures.push('batch ' + batch.id + ': the baseline ' + batch.baseline_sha + ' does not exist in this repository');
    return { lines, declared: batch.modules.length, identical: 0, characterized: false };
  }
  if (!isAncestor(repo, batch.baseline_sha, 'HEAD')) {
    failures.push('batch ' + batch.id + ': the baseline ' + batch.baseline_sha + ' is not an ancestor of HEAD');
    return { lines, declared: batch.modules.length, identical: 0, characterized: false };
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
  lines.push('| Declared move | baseline blob | HEAD blob | identical |');
  lines.push('|---|---|---|---|');

  let identical = 0;
  for (const module of batch.modules) {
    const sourceThere = fileExistsAt(repo, batch.baseline_sha, module.source);
    const destinationThere = fileExistsAt(repo, 'HEAD', module.destination);
    if (!sourceThere) {
      failures.push('batch ' + batch.id + ': source ' + module.source + ' does not exist at baseline ' + batch.baseline_sha);
    }
    if (!destinationThere) {
      failures.push('batch ' + batch.id + ': destination ' + module.destination + ' does not exist at HEAD');
    }

    const before = sourceThere ? blobAt(repo, batch.baseline_sha, module.source) : { ok: false, oid: null };
    const after = destinationThere ? blobAt(repo, 'HEAD', module.destination) : { ok: false, oid: null };

    let same = false;
    if (before.ok && after.ok) {
      if (module.identity_policy !== 'byte-identical') {
        failures.push('batch ' + batch.id + ': identity policy ' + JSON.stringify(module.identity_policy) + ' is not implemented');
      } else if (before.oid === after.oid) {
        same = true;
        identical += 1;
      } else {
        failures.push('batch ' + batch.id + ': blob differs for ' + module.destination + ' - the file was rewritten, not moved');
      }
    }

    lines.push(
      '| `' + module.source + '` -> `' + module.destination + '` | ' +
      (before.ok ? before.oid.slice(0, 10) : 'missing') + ' | ' +
      (after.ok ? after.oid.slice(0, 10) : 'missing') + ' | ' +
      (same ? 'yes' : '**NO**') + ' |'
    );
  }

  lines.push('');
  lines.push("blob-identical in '" + batch.id + "': " + identical + ' / ' + batch.modules.length);

  return {
    lines,
    declared: batch.modules.length,
    identical,
    characterized: Boolean(batch.characterization),
  };
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

  let batches = loaded.batches;
  if (options.batch) {
    batches = batches.filter((batch) => batch.id === options.batch);
    if (batches.length === 0) {
      process.stderr.write(
        'verify-pr2-provenance: FAIL\n  - the manifest declares no batch ' + JSON.stringify(options.batch) + '\n'
      );
      return 2;
    }
  }

  const failures = [];
  const checked = new Set();
  const characterized = [];
  let declared = 0;
  let identical = 0;

  for (const batch of batches) {
    const result = verifyBatch(options.repo, batch, failures);
    for (const line of result.lines) process.stdout.write(line + '\n');
    declared += result.declared;
    identical += result.identical;
    if (result.characterized) characterized.push(batch.id);

    // "Every declared move is checked exactly once": validation already rejects
    // duplicates; this is the second, independent statement of the same rule.
    for (const module of batch.modules) {
      const key = module.source + '\u0000' + module.destination;
      if (checked.has(key)) {
        failures.push('move ' + module.source + ' -> ' + module.destination + ' was verified more than once');
      }
      checked.add(key);
    }
  }

  process.stdout.write(
    '\nmoves checked: ' + declared + ' declared in ' + batches.length + ' batch(es), each exactly once\n' +
    'blob-identical: ' + identical + ' / ' + declared + '\n' +
    'characterization verified for: ' + (characterized.length > 0 ? characterized.join(', ') : 'no batch') + '\n'
  );

  if (failures.length > 0) {
    process.stderr.write('\nverify-pr2-provenance: FAIL\n');
    for (const failure of failures) process.stderr.write('  - ' + failure + '\n');
    return 1;
  }

  process.stdout.write(
    'verify-pr2-provenance: PASS - ' + declared + ' declared move(s) across ' + batches.length +
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
  verifyBatch,
  verifyCharacterization,
};
