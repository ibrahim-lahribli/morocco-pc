'use strict';

/**
 * scripts/verify-pr2-provenance.js - reproducible provenance check for the
 * step 4B PR 2 extraction (protection L2 + L3).
 *
 * Two claims are made about this PR and both must be checkable by a reviewer
 * without trusting the prose:
 *
 *   L2  the characterization fixture was captured from the code BEFORE anything
 *       moved, and has not been regenerated from the extracted code since;
 *   L3  every moved implementation module is byte-identical to its baseline
 *       blob - a move, not a rewrite. This is stronger than Git's rename
 *       percentage, which cannot reach 100% here because a shim now occupies
 *       each old path.
 *
 * DB-free, dependency-free, read-only. Run from the repository root:
 *   node scripts/verify-pr2-provenance.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURE_REL = 'packages/recommendation-core/test/fixtures/pr2-characterization.json';
const FIXTURE = path.join(REPO_ROOT, FIXTURE_REL);

/** baseline path -> extracted path, for every module the PR moves. */
const MOVED = [
  ['src/recommendation/candidates/roles.js', 'packages/recommendation-core/src/candidates/roles.js'],
  ['src/recommendation/candidates/errors.js', 'packages/recommendation-core/src/candidates/errors.js'],
  ['src/recommendation/candidates/input.js', 'packages/recommendation-core/src/candidates/input.js'],
  ['src/recommendation/candidates/candidate.js', 'packages/recommendation-core/src/candidates/candidate.js'],
  ['src/recommendation/candidates/select.js', 'packages/recommendation-core/src/candidates/select.js'],
  ['src/recommendation/compatibility/aggregate.js', 'packages/recommendation-core/src/compatibility/aggregate.js'],
  ['src/recommendation/compatibility/case-radiator.js', 'packages/recommendation-core/src/compatibility/case-radiator.js'],
  ['src/recommendation/compatibility/cooler.js', 'packages/recommendation-core/src/compatibility/cooler.js'],
  ['src/recommendation/compatibility/cooler-height.js', 'packages/recommendation-core/src/compatibility/cooler-height.js'],
  ['src/recommendation/compatibility/cooler-tdp.js', 'packages/recommendation-core/src/compatibility/cooler-tdp.js'],
  ['src/recommendation/compatibility/cpu-motherboard.js', 'packages/recommendation-core/src/compatibility/cpu-motherboard.js'],
  ['src/recommendation/compatibility/gpu.js', 'packages/recommendation-core/src/compatibility/gpu.js'],
  ['src/recommendation/compatibility/index.js', 'packages/recommendation-core/src/compatibility/index.js'],
  ['src/recommendation/compatibility/memory.js', 'packages/recommendation-core/src/compatibility/memory.js'],
  ['src/recommendation/compatibility/memory-capacity.js', 'packages/recommendation-core/src/compatibility/memory-capacity.js'],
  ['src/recommendation/compatibility/memory-slots.js', 'packages/recommendation-core/src/compatibility/memory-slots.js'],
  ['src/recommendation/compatibility/reason-codes.js', 'packages/recommendation-core/src/compatibility/reason-codes.js'],
  ['src/recommendation/compatibility/result.js', 'packages/recommendation-core/src/compatibility/result.js'],
  ['src/recommendation/compatibility/statuses.js', 'packages/recommendation-core/src/compatibility/statuses.js'],
  ['src/recommendation/filtering/filter.js', 'packages/recommendation-core/src/filtering/filter.js'],
  ['src/recommendation/filtering/igpu-map.js', 'packages/recommendation-core/src/filtering/igpu-map.js'],
];

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function tryGit(args) {
  try {
    return { ok: true, out: git(args) };
  } catch (_err) {
    return { ok: false, out: '' };
  }
}

function main() {
  const failures = [];
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const baseline = fixture.provenance.baseline_sha;

  process.stdout.write('fixture:  ' + FIXTURE_REL + '\n');
  process.stdout.write('baseline: ' + baseline + '\n');

  // 1. The named baseline must be a real commit that precedes HEAD.
  const exists = tryGit(['cat-file', '-e', baseline + '^{commit}']);
  if (!exists.ok) {
    failures.push('the fixture names a baseline commit that does not exist: ' + baseline);
  } else {
    const ancestor = execFileSync('git', ['merge-base', '--is-ancestor', baseline, 'HEAD'], {
      cwd: REPO_ROOT,
    });
    void ancestor; // exit 0 == ancestor; a non-zero status throws.
    process.stdout.write('baseline is an ancestor of HEAD: yes (' + git(['log', '-1', '--format=%cI', baseline]) + ')\n');
    process.stdout.write('fixture generated on:           ' + fixture.provenance.baseline_commit_date + '\n');
  }

  // 2. The fixture must NOT have been regenerated after the move: exactly one
  //    commit may have touched it since the baseline, and it must be the
  //    descriptive pre-move commit, not a later "refresh the fixture" edit.
  const touching = git(['log', '--format=%h\t%s', baseline + '..HEAD', '--', FIXTURE_REL])
    .split('\n')
    .filter(Boolean);
  process.stdout.write('\ncommits touching the fixture since baseline: ' + touching.length + '\n');
  for (const line of touching) process.stdout.write('  ' + line + '\n');
  if (touching.length !== 1) {
    failures.push('the fixture was touched by ' + touching.length + ' commits; expected exactly 1 (its capture)');
  } else if (!/freeze the PR 2 surface/.test(touching[0])) {
    failures.push('the only commit touching the fixture is not the pre-move capture: ' + touching[0]);
  }

  // 3. L3: blob equality for every moved module.
  process.stdout.write('\n| Extracted module | baseline blob | HEAD blob | identical |\n|---|---|---|---|\n');
  let identical = 0;
  for (const [baselinePath, currentPath] of MOVED) {
    const before = tryGit(['rev-parse', baseline + ':' + baselinePath]);
    const after = tryGit(['rev-parse', 'HEAD:' + currentPath]);
    const same = before.ok && after.ok && before.out === after.out;
    if (same) identical += 1;
    else failures.push('blob differs or is missing: ' + currentPath);
    process.stdout.write(
      '| `' + currentPath + '` | ' + (before.ok ? before.out.slice(0, 10) : 'missing') +
      ' | ' + (after.ok ? after.out.slice(0, 10) : 'missing') +
      ' | ' + (same ? 'yes' : '**NO**') + ' |\n'
    );
  }

  process.stdout.write(
    '\nblob-identical: ' + identical + ' / ' + MOVED.length + '\n'
  );

  if (failures.length > 0) {
    process.stderr.write('\nverify-pr2-provenance: FAIL\n');
    for (const failure of failures) process.stderr.write('  - ' + failure + '\n');
    return 1;
  }
  process.stdout.write('verify-pr2-provenance: PASS\n');
  return 0;
}

process.exitCode = main();
