'use strict';

// scripts/lib/extraction-provenance-cli.test.js - the manifest-driven provenance
// gate, exercised end to end through its CLI against throwaway Git repositories.
//
// Every scenario builds its own repository under os.tmpdir(), so a test can move
// a file, rewrite it, drop it, or pick a baseline that is not an ancestor of HEAD
// without touching the checkout this suite runs in. DB-free, dependency-free.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { REPO_ROOT } = require('./extraction-manifest');

const SCRIPT = path.resolve(__dirname, '..', 'verify-pr2-provenance.js');

function run(args, options = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: options.cwd || REPO_ROOT,
    encoding: 'utf8',
  });
}

/**
 * A temp directory holding `repo/` (the Git repository) and `manifest.json`
 * (outside it, so the manifest never becomes part of the history it describes).
 */
function makeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extraction-provenance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'repo');
  fs.mkdirSync(dir);

  const git = (args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '--quiet']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['config', 'user.name', 'Extraction Test']);
  git(['config', 'commit.gpgsign', 'false']);
  // Byte identity must mean the bytes written, not the bytes after EOL
  // conversion on this machine's global core.autocrlf.
  git(['config', 'core.autocrlf', 'false']);

  const fixture = {
    root,
    dir,
    manifestPath: path.join(root, 'manifest.json'),
    git,
    write(relative, text) {
      const absolute = path.join(dir, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, text);
    },
    remove(relative) {
      fs.rmSync(path.join(dir, relative), { force: true });
    },
    commit(message) {
      git(['add', '-A']);
      git(['commit', '--quiet', '-m', message]);
      return git(['rev-parse', 'HEAD']);
    },
    /** Move a file preserving its bytes, exactly as `git mv` would. */
    move(source, destination) {
      const bytes = fs.readFileSync(path.join(dir, source));
      fixture.write(destination, bytes);
      fixture.remove(source);
    },
    hashBlob(text) {
      return execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: dir, encoding: 'utf8', input: text }).trim();
    },
    /** Stage one index entry directly: a mode, an object, a path - no working-tree file. */
    stage(mode, objectId, relative) {
      git(['update-index', '--add', '--cacheinfo', mode + ',' + objectId + ',' + relative]);
    },
    unstage(relative) {
      git(['update-index', '--force-remove', relative]);
    },
    /** Commit the INDEX as staged. `git add -A` here would delete cacheinfo entries. */
    commitStaged(message) {
      git(['commit', '--quiet', '-m', message]);
      return git(['rev-parse', 'HEAD']);
    },
    manifest(entry) {
      fs.writeFileSync(
        fixture.manifestPath,
        JSON.stringify(
          { kind: 'extraction-manifest', version: 1, batches: [{ identity_policy: 'byte-identical', ...entry }] },
          null,
          2
        ) + '\n'
      );
      return fixture.manifestPath;
    },
    verify(extra = []) {
      return run(['--repo=' + dir, '--manifest=' + fixture.manifestPath, ...extra]);
    },
  };
  return fixture;
}

/** A one-move repository: baseline has src/a.js, HEAD has packages/a.js. */
function movedRepository(t) {
  const fixture = makeFixture(t);
  fixture.write('src/a.js', 'module.exports = 1;\n');
  const baseline = fixture.commit('baseline');
  fixture.move('src/a.js', 'packages/a.js');
  fixture.commit('move');
  return { fixture, baseline };
}

test('a valid unchanged move passes', (t) => {
  const { fixture, baseline } = movedRepository(t);
  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    modules: [{ source: 'src/a.js', destination: 'packages/a.js' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /baseline is an ancestor of HEAD: yes/);
  assert.match(result.stdout, /blob-identical: 1 \/ 1/);
  assert.match(result.stdout, /moves checked: 1 declared in 1 batch\(es\), each exactly once/);
  assert.match(result.stdout, /verify-pr2-provenance: PASS/);
});

test('a changed destination blob fails: a rewrite is not a move', (t) => {
  const { fixture, baseline } = movedRepository(t);
  fixture.write('packages/a.js', 'module.exports = 2;\n');
  fixture.commit('rewrite the extracted module');
  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    modules: [{ source: 'src/a.js', destination: 'packages/a.js' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blob differs for packages\/a\.js/);
  assert.match(result.stdout, /blob-identical: 0 \/ 1/);
});

test('a missing source at the baseline fails', (t) => {
  const { fixture, baseline } = movedRepository(t);
  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    modules: [{ source: 'src/absent.js', destination: 'packages/a.js' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /source src\/absent\.js does not exist at baseline/);
});

test('a missing destination at HEAD fails', (t) => {
  const { fixture, baseline } = movedRepository(t);
  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    modules: [{ source: 'src/a.js', destination: 'packages/absent.js' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /destination packages\/absent\.js does not exist at HEAD/);
});

test('a baseline that is not a commit fails', (t) => {
  const { fixture } = movedRepository(t);
  fixture.manifest({
    id: 'batch-one',
    baseline_sha: 'f'.repeat(40),
    modules: [{ source: 'src/a.js', destination: 'packages/a.js' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /the baseline f{40} does not exist in this repository/);
});

test('an abbreviated baseline is a malformed record, not a guess', (t) => {
  const { fixture, baseline } = movedRepository(t);
  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline.slice(0, 7),
    modules: [{ source: 'src/a.js', destination: 'packages/a.js' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /baseline_sha must be a full 40-character lowercase commit SHA/);
});

test('a baseline that is not an ancestor of HEAD fails', (t) => {
  const fixture = makeFixture(t);
  fixture.write('src/a.js', 'module.exports = 1;\n');
  fixture.commit('baseline');
  const initialBranch = fixture.git(['rev-parse', '--abbrev-ref', 'HEAD']);

  fixture.git(['checkout', '--quiet', '-b', 'unrelated']);
  fixture.write('src/other.js', 'module.exports = 2;\n');
  const unrelated = fixture.commit('unrelated work');

  fixture.git(['checkout', '--quiet', initialBranch]);
  fixture.move('src/a.js', 'packages/a.js');
  fixture.commit('move');

  fixture.manifest({
    id: 'batch-one',
    baseline_sha: unrelated,
    modules: [{ source: 'src/other.js', destination: 'packages/a.js' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /is not an ancestor of HEAD/);
});

test('duplicate move entries are rejected', (t) => {
  const { fixture, baseline } = movedRepository(t);
  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    modules: [
      { source: 'src/a.js', destination: 'packages/a.js' },
      { source: 'src/a.js', destination: 'packages/a.js' },
    ],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate move/);
});

test('a malformed manifest record fails closed', (t) => {
  const { fixture, baseline } = movedRepository(t);
  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    modules: [{ source: 'src/a.js', destination: '/etc/passwd' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /destination must be a repo-relative POSIX path/);
});

test('a characterization record proves the fixture predates the move', (t) => {
  const fixture = makeFixture(t);
  fixture.write('src/a.js', 'module.exports = 1;\n');
  const baseline = fixture.commit('baseline');

  const behaviour = { provenance: { baseline_sha: baseline, command: 'node scripts/characterize.js' }, captured: { verdict: 'PASS' } };
  fixture.write('fixtures/characterization.json', JSON.stringify(behaviour, null, 2) + '\n');
  const capture = fixture.commit('test: freeze the surface before anything moves');

  fixture.move('src/a.js', 'packages/a.js');
  fixture.commit('move');

  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    characterization: {
      fixture: 'fixtures/characterization.json',
      capture_command: 'node scripts/characterize.js',
      capture_commit_subject: 'test: freeze the surface before anything moves',
      expect_touch_commits: 1,
    },
    modules: [{ source: 'src/a.js', destination: 'packages/a.js' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fixture captured before the move: yes/);
  assert.match(result.stdout, /fixture unchanged since its capture commit: yes/);
  assert.match(result.stdout, /characterization verified for: batch-one/);
  // A capture commit that adds ONLY the fixture passes the path restriction:
  // with no declared capture_paths, the fixture is the one path it may change.
  assert.match(result.stdout, /capture commit changes only declared paths: A fixtures\/characterization\.json/);
  assert.equal(capture, fixture.git(['rev-parse', capture]), 'the capture commit is a real commit');
});

test('a regenerated fixture fails even when the blobs still match', (t) => {
  const fixture = makeFixture(t);
  fixture.write('src/a.js', 'module.exports = 1;\n');
  const baseline = fixture.commit('baseline');

  const behaviour = { provenance: { baseline_sha: baseline, command: 'node scripts/characterize.js' }, captured: { verdict: 'PASS' } };
  fixture.write('fixtures/characterization.json', JSON.stringify(behaviour, null, 2) + '\n');
  fixture.commit('test: freeze the surface before anything moves');
  fixture.move('src/a.js', 'packages/a.js');
  fixture.commit('move');
  fixture.write(
    'fixtures/characterization.json',
    JSON.stringify({ provenance: behaviour.provenance, captured: { verdict: 'REJECT' } }, null, 2) + '\n'
  );
  fixture.commit('refresh the characterization fixture');

  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    characterization: {
      fixture: 'fixtures/characterization.json',
      capture_command: 'node scripts/characterize.js',
      capture_commit_subject: 'test: freeze the surface before anything moves',
      expect_touch_commits: 1,
    },
    modules: [{ source: 'src/a.js', destination: 'packages/a.js' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /the fixture was touched by 2 commits/);
});

test('a fixture that names another baseline fails', (t) => {
  const fixture = makeFixture(t);
  fixture.write('src/a.js', 'module.exports = 1;\n');
  const baseline = fixture.commit('baseline');
  fixture.write(
    'fixtures/characterization.json',
    JSON.stringify(
      { provenance: { baseline_sha: 'f'.repeat(40), command: 'node scripts/characterize.js' }, captured: {} },
      null,
      2
    ) + '\n'
  );
  fixture.commit('test: freeze the surface before anything moves');
  fixture.move('src/a.js', 'packages/a.js');
  fixture.commit('move');

  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    characterization: {
      fixture: 'fixtures/characterization.json',
      capture_command: 'node scripts/characterize.js',
      capture_commit_subject: 'test: freeze the surface before anything moves',
      expect_touch_commits: 1,
    },
    modules: [{ source: 'src/a.js', destination: 'packages/a.js' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /the fixture names baseline f{40} but the manifest baseline is/);
});

test('a missing characterization fixture fails', (t) => {
  const { fixture, baseline } = movedRepository(t);
  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    characterization: {
      fixture: 'fixtures/absent.json',
      capture_command: 'node scripts/characterize.js',
      capture_commit_subject: 'capture',
      expect_touch_commits: 1,
    },
    modules: [{ source: 'src/a.js', destination: 'packages/a.js' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /characterization fixture fixtures\/absent\.json is missing/);
});

test('a batch that declares no characterization says so instead of implying L2', (t) => {
  const { fixture, baseline } = movedRepository(t);
  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    modules: [{ source: 'src/a.js', destination: 'packages/a.js' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /characterization: none declared for this batch/);
  assert.match(result.stdout, /characterization verified for: no batch/);
});

test('an executable 100755 source and destination with identical content pass', (t) => {
  const fixture = makeFixture(t);
  const blob = fixture.hashBlob('#!/bin/sh\necho hi\n');
  fixture.stage('100755', blob, 'src/tool.sh');
  const baseline = fixture.commitStaged('baseline');
  fixture.unstage('src/tool.sh');
  fixture.stage('100755', blob, 'packages/tool.sh');
  fixture.commitStaged('move');
  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    modules: [{ source: 'src/tool.sh', destination: 'packages/tool.sh' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /100755 [0-9a-f]{10}/);
  assert.match(result.stdout, /blob-identical: 1 \/ 1/);
});

test('a permission-bit change with identical bytes passes: byte identity, not file state', (t) => {
  const fixture = makeFixture(t);
  const blob = fixture.hashBlob('same bytes\n');
  fixture.stage('100644', blob, 'src/run.sh');
  const baseline = fixture.commitStaged('baseline');
  fixture.unstage('src/run.sh');
  fixture.stage('100755', blob, 'packages/run.sh');
  fixture.commitStaged('make the moved file executable');
  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    modules: [{ source: 'src/run.sh', destination: 'packages/run.sh' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /100644 [0-9a-f]{10} \| 100755 [0-9a-f]{10}/);
});

test('a directory source is rejected as a tree, and only that side is named', (t) => {
  const fixture = makeFixture(t);
  fixture.write('src/dir/a.js', 'content\n');
  const baseline = fixture.commit('baseline');
  fixture.write('packages/a.js', 'content\n');
  fixture.remove('src/dir/a.js');
  fixture.commit('move');
  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    modules: [{ source: 'src/dir', destination: 'packages/a.js' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /batch batch-one: source src\/dir is a directory \(tree\) at baseline [0-9a-f]{40}, not a regular file/
  );
  assert.equal(/destination packages\/a\.js/.test(result.stderr), false, 'the valid side must not be reported');
});

test('a directory destination is rejected as a tree, and only that side is named', (t) => {
  const fixture = makeFixture(t);
  fixture.write('src/a.js', 'content\n');
  const baseline = fixture.commit('baseline');
  fixture.write('packages/dir/a.js', 'content\n');
  fixture.remove('src/a.js');
  fixture.commit('move');
  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    modules: [{ source: 'src/a.js', destination: 'packages/dir' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /batch batch-one: destination packages\/dir is a directory \(tree\) at HEAD, not a regular file/);
  assert.equal(/source src\/a\.js/.test(result.stderr), false, 'the valid side must not be reported');
});

test('a gitlink source is rejected as a submodule commit', (t) => {
  const fixture = makeFixture(t);
  fixture.write('vendor.txt', 'v\n');
  const vendored = fixture.commit('vendor');
  const blob = fixture.hashBlob('module.exports = 1;\n');
  fixture.stage('160000', vendored, 'src/sub');
  const baseline = fixture.commitStaged('baseline');
  fixture.unstage('src/sub');
  fixture.stage('100644', blob, 'packages/sub');
  fixture.commitStaged('move');
  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    modules: [{ source: 'src/sub', destination: 'packages/sub' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /batch batch-one: source src\/sub is a gitlink \(mode 160000, a submodule commit\) at baseline [0-9a-f]{40}, not a regular file/
  );
  assert.equal(/destination packages\/sub/.test(result.stderr), false, 'the valid side must not be reported');
});

test('a gitlink destination is rejected as a submodule commit', (t) => {
  const fixture = makeFixture(t);
  const blob = fixture.hashBlob('module.exports = 1;\n');
  fixture.write('vendor.txt', 'v\n');
  const vendored = fixture.commit('vendor');
  fixture.stage('100644', blob, 'src/lib.js');
  const baseline = fixture.commitStaged('baseline');
  fixture.unstage('src/lib.js');
  fixture.stage('160000', vendored, 'packages/sub');
  fixture.commitStaged('move');
  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    modules: [{ source: 'src/lib.js', destination: 'packages/sub' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /batch batch-one: destination packages\/sub is a gitlink \(mode 160000, a submodule commit\) at HEAD, not a regular file/
  );
  assert.equal(/source src\/lib\.js/.test(result.stderr), false, 'the valid side must not be reported');
});

test('a symlink source is rejected even when its blob matches the destination file', (t) => {
  const fixture = makeFixture(t);
  const linkBlob = fixture.hashBlob('target.js');
  fixture.stage('120000', linkBlob, 'src/link.js');
  const baseline = fixture.commitStaged('baseline');
  fixture.unstage('src/link.js');
  // The regular file holds exactly the bytes the link target names, so the two
  // blobs are identical: only the tree-entry mode distinguishes them.
  fixture.stage('100644', linkBlob, 'packages/target.js');
  fixture.commitStaged('move');
  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    modules: [{ source: 'src/link.js', destination: 'packages/target.js' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /batch batch-one: source src\/link\.js is a symlink \(mode 120000\) at baseline [0-9a-f]{40}, not a regular file/
  );
  assert.equal(/destination packages\/target\.js/.test(result.stderr), false, 'the valid side must not be reported');
});

test('a symlink destination is rejected even when its blob matches the source file', (t) => {
  const fixture = makeFixture(t);
  const linkBlob = fixture.hashBlob('target.js');
  fixture.stage('100644', linkBlob, 'src/target.js');
  const baseline = fixture.commitStaged('baseline');
  fixture.unstage('src/target.js');
  fixture.stage('120000', linkBlob, 'packages/link.js');
  fixture.commitStaged('move');
  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    modules: [{ source: 'src/target.js', destination: 'packages/link.js' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /batch batch-one: destination packages\/link\.js is a symlink \(mode 120000\) at HEAD, not a regular file/);
  assert.equal(/source src\/target\.js/.test(result.stderr), false, 'the valid side must not be reported');
});

test('the real PR 2 batch still verifies 21/21', () => {
  const result = run([]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /## batch step-4b-pr2/);
  assert.match(result.stdout, /baseline: afccc671dae5abe6df80ad56dfcbc231d7947c7a/);
  assert.match(result.stdout, /commits touching the fixture since baseline: 1/);
  assert.match(result.stdout, /blob-identical: 21 \/ 21/);
  assert.match(result.stdout, /characterization verified for: step-4b-pr2/);
  assert.match(result.stdout, /verify-pr2-provenance: PASS/);
});

test('an unknown argument and a non-repository are refused', (t) => {
  const badArgument = run(['--frobnicate']);
  assert.equal(badArgument.status, 2);
  assert.match(badArgument.stderr, /unknown argument "--frobnicate"/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extraction-provenance-nogit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const notARepo = run(['--repo=' + root]);
  assert.equal(notARepo.status, 1);
  assert.match(notARepo.stderr, /is not a git repository/);
});

// The capture commit is the moment the surface is frozen, so it may not carry
// anything else: a commit that edits implementation code and commits a fixture
// beside it would prove nothing about what the fixture saw. PR 2's real capture
// (581ee73) also added its own capture tool, so the manifest names such paths
// explicitly in `capture_paths` and the verifier proves each was absent at the
// baseline - a declared path can be introduced, never altered.

test('a capture commit that also modifies implementation code fails', (t) => {
  const fixture = makeFixture(t);
  fixture.write('src/a.js', 'module.exports = 1;\n');
  const baseline = fixture.commit('baseline');

  fixture.write('src/a.js', 'module.exports = 2;\n');
  const behaviour = { provenance: { baseline_sha: baseline, command: 'node scripts/characterize.js' }, captured: { verdict: 'PASS' } };
  fixture.write('fixtures/characterization.json', JSON.stringify(behaviour, null, 2) + '\n');
  fixture.commit('test: freeze the surface before anything moves');

  // The move still preserves the baseline bytes, so identity is not the failure.
  fixture.write('packages/a.js', 'module.exports = 1;\n');
  fixture.remove('src/a.js');
  fixture.commit('move');

  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    characterization: {
      fixture: 'fixtures/characterization.json',
      capture_command: 'node scripts/characterize.js',
      capture_commit_subject: 'test: freeze the surface before anything moves',
      expect_touch_commits: 1,
    },
    modules: [{ source: 'src/a.js', destination: 'packages/a.js' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /batch batch-one: the capture commit [0-9a-f]{40} changes paths other than the fixture and its declared capture paths: M src\/a\.js/
  );
  assert.equal(
    /changes paths other than the fixture and its declared capture paths:.*characterization\.json/.test(result.stderr),
    false,
    'the fixture itself is not an unexpected path'
  );
  assert.equal(/blob differs for/.test(result.stderr), false, 'the move still preserves the baseline bytes');
  assert.match(result.stdout, /blob-identical in 'batch-one': 1 \/ 1/);
});

test('a capture commit that adds an unrelated file fails', (t) => {
  const fixture = makeFixture(t);
  fixture.write('src/a.js', 'module.exports = 1;\n');
  const baseline = fixture.commit('baseline');

  const behaviour = { provenance: { baseline_sha: baseline, command: 'node scripts/characterize.js' }, captured: { verdict: 'PASS' } };
  fixture.write('fixtures/characterization.json', JSON.stringify(behaviour, null, 2) + '\n');
  fixture.write('scripts/unrelated.js', 'module.exports = 3;\n');
  fixture.commit('test: freeze the surface before anything moves');

  fixture.move('src/a.js', 'packages/a.js');
  fixture.commit('move');

  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    characterization: {
      fixture: 'fixtures/characterization.json',
      capture_command: 'node scripts/characterize.js',
      capture_commit_subject: 'test: freeze the surface before anything moves',
      expect_touch_commits: 1,
    },
    modules: [{ source: 'src/a.js', destination: 'packages/a.js' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /changes paths other than the fixture and its declared capture paths: A scripts\/unrelated\.js/
  );
  assert.match(result.stdout, /blob-identical in 'batch-one': 1 \/ 1/);
});

test('the fixture is read from HEAD, so a dirty working-tree copy cannot stand in', (t) => {
  const fixture = makeFixture(t);
  fixture.write('src/a.js', 'module.exports = 1;\n');
  const baseline = fixture.commit('baseline');

  const behaviour = { provenance: { baseline_sha: baseline, command: 'node scripts/characterize.js' }, captured: { verdict: 'PASS' } };
  fixture.write('fixtures/characterization.json', JSON.stringify(behaviour, null, 2) + '\n');
  fixture.commit('test: freeze the surface before anything moves');
  fixture.move('src/a.js', 'packages/a.js');
  fixture.commit('move');

  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    characterization: {
      fixture: 'fixtures/characterization.json',
      capture_command: 'node scripts/characterize.js',
      capture_commit_subject: 'test: freeze the surface before anything moves',
      expect_touch_commits: 1,
    },
    modules: [{ source: 'src/a.js', destination: 'packages/a.js' }],
  });

  // Uncommitted: the working tree now disagrees with HEAD about the fixture.
  fixture.write('fixtures/characterization.json', '{ "provenance": { "baseline_sha": "not-the-baseline" } }');

  const result = fixture.verify();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /characterization fixture: fixtures\/characterization\.json \(read from HEAD\)/);
  assert.match(result.stdout, /fixture unchanged since its capture commit: yes/);
});

test('a committed fixture that is not valid JSON fails clearly', (t) => {
  const fixture = makeFixture(t);
  fixture.write('src/a.js', 'module.exports = 1;\n');
  const baseline = fixture.commit('baseline');

  fixture.write('fixtures/characterization.json', '{ "provenance": oops }\n');
  fixture.commit('test: freeze the surface before anything moves');
  fixture.move('src/a.js', 'packages/a.js');
  fixture.commit('move');

  // A valid working-tree copy must not rescue an unparsable committed fixture.
  fixture.write(
    'fixtures/characterization.json',
    JSON.stringify({ provenance: { baseline_sha: baseline, command: 'node scripts/characterize.js' }, captured: {} }) + '\n'
  );

  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    characterization: {
      fixture: 'fixtures/characterization.json',
      capture_command: 'node scripts/characterize.js',
      capture_commit_subject: 'test: freeze the surface before anything moves',
      expect_touch_commits: 1,
    },
    modules: [{ source: 'src/a.js', destination: 'packages/a.js' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /characterization fixture fixtures\/characterization\.json is not valid JSON at HEAD/);
});

test('a fixture deleted after its capture fails as missing at HEAD', (t) => {
  const fixture = makeFixture(t);
  fixture.write('src/a.js', 'module.exports = 1;\n');
  const baseline = fixture.commit('baseline');

  const behaviour = { provenance: { baseline_sha: baseline, command: 'node scripts/characterize.js' }, captured: {} };
  fixture.write('fixtures/characterization.json', JSON.stringify(behaviour, null, 2) + '\n');
  fixture.commit('test: freeze the surface before anything moves');
  fixture.move('src/a.js', 'packages/a.js');
  fixture.commit('move');
  fixture.remove('fixtures/characterization.json');
  fixture.commit('drop the characterization fixture');

  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    characterization: {
      fixture: 'fixtures/characterization.json',
      capture_command: 'node scripts/characterize.js',
      capture_commit_subject: 'test: freeze the surface before anything moves',
      expect_touch_commits: 1,
    },
    modules: [{ source: 'src/a.js', destination: 'packages/a.js' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /characterization fixture fixtures\/characterization\.json is missing at HEAD/);
});

test('a declared capture path introduced by the capture commit passes', (t) => {
  const fixture = makeFixture(t);
  fixture.write('src/a.js', 'module.exports = 1;\n');
  const baseline = fixture.commit('baseline');

  const behaviour = { provenance: { baseline_sha: baseline, command: 'node scripts/characterize.js' }, captured: {} };
  fixture.write('fixtures/characterization.json', JSON.stringify(behaviour, null, 2) + '\n');
  fixture.write('scripts/characterize.js', 'console.log("capture");\n');
  fixture.commit('test: freeze the surface before anything moves');

  fixture.move('src/a.js', 'packages/a.js');
  fixture.commit('move');

  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    characterization: {
      fixture: 'fixtures/characterization.json',
      capture_command: 'node scripts/characterize.js',
      capture_commit_subject: 'test: freeze the surface before anything moves',
      expect_touch_commits: 1,
      capture_paths: ['scripts/characterize.js'],
    },
    modules: [{ source: 'src/a.js', destination: 'packages/a.js' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /capture commit changes only declared paths: A fixtures\/characterization\.json, A scripts\/characterize\.js/
  );
});

test('a declared capture path that already existed at the baseline is refused', (t) => {
  const fixture = makeFixture(t);
  fixture.write('src/a.js', 'module.exports = 1;\n');
  fixture.write('scripts/characterize.js', 'console.log("capture v1");\n');
  const baseline = fixture.commit('baseline');

  // The capture commit rewrites an existing tool, so the declared path is not a
  // path it introduced: declaring it would hide a modification of baseline code.
  fixture.write('scripts/characterize.js', 'console.log("capture v2");\n');
  const behaviour = { provenance: { baseline_sha: baseline, command: 'node scripts/characterize.js' }, captured: {} };
  fixture.write('fixtures/characterization.json', JSON.stringify(behaviour, null, 2) + '\n');
  fixture.commit('test: freeze the surface before anything moves');

  fixture.move('src/a.js', 'packages/a.js');
  fixture.commit('move');

  fixture.manifest({
    id: 'batch-one',
    baseline_sha: baseline,
    characterization: {
      fixture: 'fixtures/characterization.json',
      capture_command: 'node scripts/characterize.js',
      capture_commit_subject: 'test: freeze the surface before anything moves',
      expect_touch_commits: 1,
      capture_paths: ['scripts/characterize.js'],
    },
    modules: [{ source: 'src/a.js', destination: 'packages/a.js' }],
  });

  const result = fixture.verify();
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /batch batch-one: capture path scripts\/characterize\.js already exists at the baseline [0-9a-f]{40}, so it cannot have been introduced by the capture commit/
  );
  assert.match(result.stderr, /changes paths other than the fixture and its declared capture paths: M scripts\/characterize\.js/);
});
