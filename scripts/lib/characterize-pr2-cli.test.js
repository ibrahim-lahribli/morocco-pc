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
const { spawnSync } = require('node:child_process');

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

test('an unknown argument is refused with a usage line', () => {
  const result = run(['--write']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown argument "--write"/);
  assert.match(result.stderr, /usage: node scripts\/characterize-pr2\.js/);
});
