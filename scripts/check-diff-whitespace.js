'use strict';

/**
 * scripts/check-diff-whitespace.js - the whitespace gate for an extraction PR,
 * scoped to what the PR can be held responsible for.
 *
 * The problem this solves
 *   `git diff --check` reports whitespace errors in the DIFF, not in the tree.
 *   A byte-identical extraction creates a NEW path whose bytes were already
 *   committed at the baseline, so a file that legitimately ends with a blank
 *   line shows up as `new blank line at EOF.` even though this PR introduced
 *   no whitespace at all. `src/recommendation/assembly/assemble.js` and
 *   `prices.js` are exactly that case at `de659ad`.
 *
 *   The obvious "fix" - stripping the blank line in the destination - is wrong,
 *   and this gate exists so nobody does it: it would break
 *   `npm run verify:extraction`, which requires `identity_policy:
 *   "byte-identical"`, and the extraction workflow forbids formatting changes
 *   inside a move (section 3.6). Byte identity is the load-bearing evidence for
 *   "a move, not a rewrite"; a trailing blank line is not worth it.
 *
 * What is excused, and why that is not a suppression
 *   A warning is excused ONLY when all three hold:
 *     1. the message is exactly `new blank line at EOF.` (no other class of
 *        whitespace error is ever excused);
 *     2. the path is a DESTINATION declared in extraction-manifest.json; and
 *     3. the source blob at that batch's baseline is still equal to the
 *        destination blob at HEAD - i.e. the very fact `verify:extraction`
 *        proves. The report prints the batch and the blob, so the exception is
 *        evidence a reviewer can re-derive, not a path list to trust.
 *
 *   If a declared pair has drifted, the proof fails and the warning FAILS with
 *   it. Nothing is suppressed in `.gitattributes`, no pathspec is hidden and no
 *   message is swallowed: any other whitespace error anywhere else in the range
 *   still fails the gate.
 *
 * DB-free, dependency-free, read-only. Run from the repository root:
 *   node scripts/check-diff-whitespace.js                 # base origin/master
 *   node scripts/check-diff-whitespace.js --base=<git-ref>
 *   node scripts/check-diff-whitespace.js --manifest=<path> --repo=<path>
 *
 * Exit codes: 0 PASS, 1 FAIL, 2 argument or repository error.
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  REPO_ROOT,
  isGitRepository,
  loadManifest,
  manifestFile,
  regularFileAt,
  resolveCommit,
  tryGit,
} = require('./lib/extraction-manifest');

const BLANK_LINE_AT_EOF = 'new blank line at EOF.';
const DEFAULT_BASE = 'origin/master';
const FALLBACK_BASE = 'master';

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Destinations that may be excused, each carrying the proof that it is a
 * byte-identical move. Built from the manifest, never from a hardcoded list:
 * a path with no manifest row, or one whose blob no longer matches, is simply
 * absent here and therefore cannot be excused.
 */
function provenDestinations(repo, batches) {
  const proven = [];
  const unproven = [];
  for (const batch of batches) {
    for (const module of batch.modules) {
      const before = regularFileAt(repo, batch.baseline_sha, module.source);
      const after = regularFileAt(repo, 'HEAD', module.destination);
      if (!before.ok || !after.ok || before.oid !== after.oid) {
        unproven.push({
          batch: batch.id,
          source: module.source,
          destination: module.destination,
          reason: !before.ok
            ? 'baseline source is unreadable'
            : !after.ok
              ? 'destination at HEAD is unreadable'
              : 'not byte-identical (baseline ' + before.oid.slice(0, 10) + ', HEAD ' + after.oid.slice(0, 10) + ')',
        });
        continue;
      }
      proven.push({
        batch: batch.id,
        baseline: batch.baseline_sha,
        oid: after.oid,
        path: module.destination,
        source: module.source,
      });
    }
  }
  return { proven, unproven };
}

const REPORT = /^(.+?):(\d+): (.+)$/;

/**
 * Group the report into findings. `git diff --check` prints one `path:line:
 * message` line per finding and then, for some classes, the offending content
 * as an unprefixed context line; counting those separately would report two
 * problems where there is one.
 */
function findings(lines) {
  const found = [];
  for (const line of lines) {
    if (REPORT.test(line) || found.length === 0) found.push({ line, context: [] });
    else found[found.length - 1].context.push(line);
  }
  return found;
}

/**
 * Split the report into excused and failing findings. Exported so the CLI test
 * can exercise the decision without spawning Git for every case.
 */
function classify(lines, proven) {
  const patterns = proven.map((entry) => ({
    entry,
    pattern: new RegExp(
      '^' + escapeRegExp(entry.path) + ':(\\d+): ' + escapeRegExp(BLANK_LINE_AT_EOF) + '$'
    ),
  }));
  const excused = [];
  const failures = [];
  for (const finding of findings(lines)) {
    const match = patterns.find((candidate) => candidate.pattern.test(finding.line));
    if (match) excused.push({ ...finding, entry: match.entry });
    else failures.push(finding);
  }
  return { excused, failures };
}

function parseArgs(argv) {
  const options = { base: DEFAULT_BASE, manifest: null, repo: REPO_ROOT, errors: [] };
  for (const arg of argv) {
    if (arg.startsWith('--base=')) {
      const value = arg.slice('--base='.length);
      if (value === '') options.errors.push('--base= needs a git reference');
      else options.base = value;
    } else if (arg.startsWith('--manifest=')) {
      const value = arg.slice('--manifest='.length);
      if (value === '') options.errors.push('--manifest= needs a path');
      else options.manifest = path.resolve(value);
    } else if (arg.startsWith('--repo=')) {
      const value = arg.slice('--repo='.length);
      if (value === '') options.errors.push('--repo= needs a path');
      else options.repo = path.resolve(value);
    } else {
      options.errors.push('unknown argument ' + JSON.stringify(arg));
    }
  }
  return options;
}

function git(repo, args) {
  return spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.errors.length > 0) {
    process.stderr.write('check-diff-whitespace: ' + options.errors.join('\n  ') + '\n');
    process.stderr.write(
      'usage: node scripts/check-diff-whitespace.js [--base=<git-ref>] [--manifest=<path>] [--repo=<path>]\n'
    );
    return 2;
  }
  if (!isGitRepository(options.repo)) {
    process.stderr.write('check-diff-whitespace: ' + options.repo + ' is not a Git repository\n');
    return 2;
  }

  let baseRef = options.base;
  let base = resolveCommit(options.repo, baseRef);
  if (!base.ok && baseRef === DEFAULT_BASE) {
    // The gate must not silently pass on a checkout with no origin/master; it
    // falls back to `master` and SAYS so rather than assuming the range.
    baseRef = FALLBACK_BASE;
    base = resolveCommit(options.repo, baseRef);
  }
  if (!base.ok) {
    process.stderr.write('check-diff-whitespace: cannot resolve base ' + JSON.stringify(baseRef) + '\n');
    return 2;
  }

  const file = options.manifest || manifestFile(options.repo);
  const loaded = loadManifest(file);
  if (loaded.errors.length > 0) {
    process.stderr.write('check-diff-whitespace: manifest is not usable:\n  ' + loaded.errors.join('\n  ') + '\n');
    return 1;
  }
  const { proven, unproven } = provenDestinations(options.repo, loaded.batches);

  const range = baseRef + '...HEAD';
  const diff = git(options.repo, ['diff', '--check', range]);
  if (diff.status !== 0 && diff.status !== 2) {
    process.stderr.write(
      'check-diff-whitespace: git diff --check ' + range + ' failed: ' + (diff.stderr || '').trim() + '\n'
    );
    return 2;
  }
  const lines = (diff.stdout || '')
    .split('\n')
    .filter((line) => line.trim() !== '');

  const { excused, failures } = classify(lines, proven);

  process.stdout.write('diff whitespace: ' + range + ' (base ' + base.sha + ')\n');
  process.stdout.write('git diff --check reported ' + (excused.length + failures.length) + ' finding(s)\n');

  if (excused.length > 0) {
    process.stdout.write(
      '  excused ' + excused.length + ' (blank line at EOF, inherited by a byte-identical move)\n'
    );
    for (const item of excused) {
      process.stdout.write(
        '    ' + item.line + '\n' +
          '      batch ' + item.entry.batch +
          ', blob ' + item.entry.oid.slice(0, 10) +
          ' identical at baseline ' + item.entry.baseline.slice(0, 10) +
          ' (' + item.entry.source + ')\n'
      );
    }
  }

  for (const item of unproven) {
    // Only reported when it could have mattered: a finding on that path is in
    // `failures` and the reason it was not excused belongs beside it.
    if (failures.some((finding) => finding.line.startsWith(item.destination + ':'))) {
      process.stdout.write('  not excused: ' + item.destination + ' - ' + item.reason + '\n');
    }
  }

  if (failures.length > 0) {
    process.stdout.write('  remaining ' + failures.length + ':\n');
    for (const finding of failures) {
      process.stdout.write('    ' + finding.line + '\n');
      for (const line of finding.context) process.stdout.write('      ' + line + '\n');
    }
    process.stdout.write('check-diff-whitespace: FAIL\n');
    return 1;
  }

  process.stdout.write('check-diff-whitespace: PASS\n');
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { BLANK_LINE_AT_EOF, classify, findings, main, provenDestinations };
