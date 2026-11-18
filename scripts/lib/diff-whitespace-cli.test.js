'use strict';

// scripts/lib/diff-whitespace-cli.test.js - the scoped `git diff --check` gate,
// exercised end to end through its CLI against throwaway Git repositories.
//
// The gate's whole value is that an exemption is PROVEN rather than declared, so
// the scenarios below are the two sides of that: a blank line at EOF on a
// manifest-declared byte-identical destination passes, and the same warning
// fails the moment the row is missing or the blobs have drifted. DB-free,
// dependency-free, writes only under os.tmpdir().

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { REPO_ROOT } = require('./extraction-manifest');

const SCRIPT = path.resolve(__dirname, '..', 'check-diff-whitespace.js');

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
}

/**
 * A temp directory holding `repo/` and, beside it, `manifest.json` (outside the
 * repository, so the evidence never becomes part of the history it describes).
 */
function makeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-whitespace-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'repo');
  fs.mkdirSync(dir);

  const git = (args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '--quiet']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['config', 'user.name', 'Whitespace Test']);
  git(['config', 'commit.gpgsign', 'false']);
  // Byte identity means the bytes written, not the bytes after EOL conversion.
  git(['config', 'core.autocrlf', 'false']);

  const fixture = {
    dir,
    git,
    manifestPath: path.join(root, 'manifest.json'),
    write(relative, text) {
      const absolute = path.join(dir, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, text);
    },
    commit(message) {
      git(['add', '-A']);
      git(['commit', '--quiet', '-m', message]);
      return git(['rev-parse', 'HEAD']);
    },
    /** A batch declaring one move; `baseline` is the commit the bytes came from. */
    manifest(baseline, source, destination, id = 'step-test') {
      fs.writeFileSync(
        fixture.manifestPath,
        JSON.stringify(
          {
            kind: 'extraction-manifest',
            version: 1,
            batches: [
              {
                id,
                baseline_sha: baseline,
                identity_policy: 'byte-identical',
                modules: [{ source, destination }],
              },
            ],
          },
          null,
          2
        )
      );
      return fixture.manifestPath;
    },
    args(baseline) {
      return ['--base=' + baseline, '--manifest=' + fixture.manifestPath, '--repo=' + dir];
    },
  };
  return fixture;
}

test('a clean range passes and excuses nothing', (t) => {
  const fixture = makeFixture(t);
  fixture.write('src/c.js', 'module.exports = 3;\n');
  const baseline = fixture.commit('baseline');

  fixture.write('packages/core/c.js', 'module.exports = 3;\n');
  fixture.write('src/c.js', "module.exports = require('../../packages/core/c');\n");
  fixture.commit('move');

  fixture.manifest(baseline, 'src/c.js', 'packages/core/c.js');
  const result = run(fixture.args(baseline));

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /reported 0 finding\(s\)/);
  assert.match(result.stdout, /check-diff-whitespace: PASS/);
});

test('a blank line at EOF inherited by a byte-identical move is excused, with its proof', (t) => {
  const fixture = makeFixture(t);
  // The baseline file legitimately ends with a blank line; the move copies the
  // bytes, so the destination is a NEW path carrying pre-existing whitespace.
  fixture.write('src/a.js', 'module.exports = 1;\n\n');
  const baseline = fixture.commit('baseline');

  fixture.write('packages/core/a.js', 'module.exports = 1;\n\n');
  fixture.write('src/a.js', "module.exports = require('../../packages/core/a');\n");
  fixture.commit('move');

  fixture.manifest(baseline, 'src/a.js', 'packages/core/a.js', 'step-test-identical');
  const result = run(fixture.args(baseline));

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /excused 1/);
  assert.match(result.stdout, /step-test-identical/);
  assert.match(result.stdout, /new blank line at EOF\./);
  assert.match(result.stdout, /identical at baseline/);
  assert.match(result.stdout, /check-diff-whitespace: PASS/);
});

test('the same warning fails when no manifest row declares the path', (t) => {
  const fixture = makeFixture(t);
  fixture.write('src/a.js', 'module.exports = 1;\n\n');
  const baseline = fixture.commit('baseline');

  fixture.write('packages/core/a.js', 'module.exports = 1;\n\n');
  fixture.write('src/a.js', "module.exports = require('../../packages/core/a');\n");
  fixture.commit('move');

  // The manifest exists and is valid, but declares an unrelated move: an
  // undeclared path has nothing to prove, so nothing may be excused for it.
  fixture.manifest(baseline, 'src/unrelated.js', 'packages/core/unrelated.js');
  const result = run(fixture.args(baseline));

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /remaining 1/);
  assert.match(result.stdout, /check-diff-whitespace: FAIL/);
});

test('a declared pair that has drifted is not excused', (t) => {
  const fixture = makeFixture(t);
  fixture.write('src/a.js', 'module.exports = 1;\n');
  const baseline = fixture.commit('baseline');

  // The destination gained a trailing blank line: this is NOT a move, so the
  // row cannot excuse anything - the proof is what grants the exemption.
  fixture.write('packages/core/a.js', 'module.exports = 1;\n\n');
  fixture.write('src/a.js', "module.exports = require('../../packages/core/a');\n");
  fixture.commit('rewrite while moving');

  fixture.manifest(baseline, 'src/a.js', 'packages/core/a.js');
  const result = run(fixture.args(baseline));

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /not excused: packages\/core\/a\.js - not byte-identical/);
  assert.match(result.stdout, /check-diff-whitespace: FAIL/);
});

test('a trailing-whitespace error is never excused, even on a declared pair', (t) => {
  const fixture = makeFixture(t);
  fixture.write('src/b.js', 'module.exports = 2;   \n');
  const baseline = fixture.commit('baseline');

  fixture.write('packages/core/b.js', 'module.exports = 2;   \n');
  fixture.write('src/b.js', "module.exports = require('../../packages/core/b');\n");
  fixture.commit('move');

  fixture.manifest(baseline, 'src/b.js', 'packages/core/b.js');
  const result = run(fixture.args(baseline));

  // Byte identity holds, but only blank-at-EOF is excused: the class of error
  // matters, so a genuine trailing-whitespace defect is still reported.
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /remaining 1/);
  assert.match(result.stdout, /trailing whitespace/);
});

test('an unresolvable base is an argument error, not a pass', (t) => {
  const fixture = makeFixture(t);
  fixture.write('src/c.js', 'module.exports = 3;\n');
  const baseline = fixture.commit('baseline');
  fixture.manifest(baseline, 'src/c.js', 'packages/core/c.js');

  const result = run([...fixture.args(baseline), '--base=does-not-exist']);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /cannot resolve base/);
});
