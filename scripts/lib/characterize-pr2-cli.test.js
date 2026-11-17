'use strict';

// scripts/lib/characterize-pr2-cli.test.js - the L2 check has to be runnable in
// CI WITHOUT the ability to rewrite its own baseline.
//
// Two properties are pinned here, and they are different:
//   * --check still agrees with the committed pre-move fixture (the guarantee);
//   * --check never writes - not the committed fixture, not a copy it was
//     pointed at, and not a path that does not exist yet. A gate that can
//     regenerate the thing it checks proves nothing.
//
// DB-free, dependency-free; writes only under os.tmpdir().

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { REPO_ROOT } = require('./extraction-manifest');

const SCRIPT = path.resolve(__dirname, '..', 'characterize-pr2.js');
const FIXTURE = path.resolve(REPO_ROOT, 'packages/recommendation-core/test/fixtures/pr2-characterization.json');

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
}

function snapshot(file) {
  const stat = fs.statSync(file);
  return {
    sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'characterize-pr2-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('--check reproduces the committed fixture and does not write it', () => {
  const before = snapshot(FIXTURE);
  const result = run(['--check']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK - behaviour matches the pre-move baseline/);
  // The default fixture is read from the COMMITTED blob, and the output says so.
  assert.match(
    result.stdout,
    /\(HEAD:packages\/recommendation-core\/test\/fixtures\/pr2-characterization\.json\)/
  );
  assert.match(result.stdout, /fixture origin is not checked here/);
  assert.deepEqual(snapshot(FIXTURE), before, 'the committed fixture must be untouched by --check');
});

test('--check refuses an altered copy and still does not write it', (t) => {
  const dir = tempDir(t);
  const copy = path.join(dir, 'altered.json');
  const document = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  document.igpu_map = [];
  fs.writeFileSync(copy, JSON.stringify(document, null, 2) + '\n');
  const before = snapshot(copy);

  const result = run(['--check', '--fixture=' + copy]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no longer matches the pre-move baseline/);
  assert.deepEqual(snapshot(copy), before, 'a failed --check must not rewrite the file it compared');
});

test('--check accepts an unaltered copy through --fixture, so the flag is not the mismatch', (t) => {
  const dir = tempDir(t);
  const copy = path.join(dir, 'copy.json');
  fs.copyFileSync(FIXTURE, copy);
  const before = snapshot(copy);

  const result = run(['--check', '--fixture=' + copy]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(snapshot(copy), before);
});

test('--check does not create a missing fixture', (t) => {
  const dir = tempDir(t);
  const absent = path.join(dir, 'absent.json');

  const result = run(['--check', '--fixture=' + absent]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /never writes one/);
  assert.equal(fs.existsSync(absent), false, '--check must not create the fixture it could not read');
});

test('--check reports invalid JSON instead of throwing', (t) => {
  const dir = tempDir(t);
  const broken = path.join(dir, 'broken.json');
  fs.writeFileSync(broken, '{ "kind": "pr2-characterization", ');

  const result = run(['--check', '--fixture=' + broken]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /is not valid JSON/);
});

/**
 * A detached worktree of HEAD, so a test can dirty the fixture without touching
 * the shared checkout this suite runs in. The script resolves its root from its
 * own location, so the copy under the worktree reads the worktree's Git data.
 */
function worktree(t) {
  const target = path.join(tempDir(t), 'wt');
  execFileSync('git', ['worktree', 'add', '--detach', '--quiet', target, 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', target], { cwd: REPO_ROOT, stdio: 'ignore' });
    } catch (_err) {
      // The temp directory removal below still cleans the checkout.
    }
  });
  return target;
}

test('--check ignores a dirty working-tree fixture that differs from committed HEAD', (t) => {
  const wt = worktree(t);
  // The worktree is checked out at HEAD, so the script under test is replaced
  // with the working-tree copy: without this the test would exercise whatever
  // HEAD happened to contain. Once this change is committed the copy is a no-op.
  fs.copyFileSync(SCRIPT, path.join(wt, 'scripts/characterize-pr2.js'));
  const fixture = path.join(wt, 'packages/recommendation-core/test/fixtures/pr2-characterization.json');
  const dirty = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  dirty.igpu_map = [];
  fs.writeFileSync(fixture, JSON.stringify(dirty, null, 2) + '\n');
  const dirtyBytes = fs.readFileSync(fixture);

  const result = spawnSync(process.execPath, [path.join(wt, 'scripts/characterize-pr2.js'), '--check'], {
    cwd: wt,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /matches the pre-move baseline \(HEAD:/);
  assert.equal(
    /no longer matches the pre-move baseline/.test(result.stderr),
    false,
    'the broken working-tree copy must not be compared at all'
  );
  assert.deepEqual(
    fs.readFileSync(fixture),
    dirtyBytes,
    '--check must not rewrite the dirty working-tree copy either'
  );
});

test('an unknown argument is refused with a usage line', () => {
  const result = run(['--write']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown argument "--write"/);
  assert.match(result.stderr, /usage: node scripts\/characterize-pr2\.js/);
});
