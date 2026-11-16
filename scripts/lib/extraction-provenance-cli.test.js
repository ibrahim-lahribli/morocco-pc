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
    manifest(entry) {
      fs.writeFileSync(
        fixture.manifestPath,
        JSON.stringify({ kind: 'extraction-manifest', version: 1, batches: [entry] }, null, 2) + '\n'
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

test('a batch can be selected explicitly, and an unknown one is refused', () => {
  const selected = run(['--batch=step-4b-pr2']);
  assert.equal(selected.status, 0, selected.stderr);
  assert.match(selected.stdout, /moves checked: 21 declared in 1 batch\(es\)/);

  const unknown = run(['--batch=step-4b-pr9']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /declares no batch "step-4b-pr9"/);
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
