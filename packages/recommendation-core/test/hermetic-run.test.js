'use strict';

// packages/recommendation-core/test/hermetic-run.test.js — fixtures for the
// reachability check behind RFC §11.6 "Hermetic run".
//
// ./hermetic-run.js copies the package outside the repository and refuses to run
// when any node_modules is reachable from the copy. That claim rests on the
// scan being exhaustive, so the scan is exercised here against fixtures that a
// directory-only walk would miss: a node_modules nested at any depth, one that
// is itself a symbolic link (`test/node_modules`), and one inside a
// symbolic-linked directory. Node resolves packages through all three.
//
// ./hermetic-run.js runs the isolated suite only when it is the entry point, so
// requiring it here is safe — and this file is copied with the package, so it
// runs inside the hermetic copy as well.
//
// DB-free, dependency-free: node:test + node:assert only. The symlink fixtures
// skip only where the platform refuses to create a link (Windows without
// Developer Mode); CI is Linux, where they always run.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ancestorNodeModules, nestedNodeModules } = require('./hermetic-run');

function makeTempTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-hermetic-fixture-'));
  return {
    root,
    dir(relative) {
      const full = path.join(root, relative);
      fs.mkdirSync(full, { recursive: true });
      return full;
    },
    dispose() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * Create a symbolic link, or skip when the platform refuses one (Windows
 * without Developer Mode returns EPERM). A junction stands in for a directory
 * link where it is available: it is reported by `lstat().isSymbolicLink()` and
 * resolved by `realpath`, which is the shape the runner sees.
 */
function trySymlink(t, target, linkPath, type) {
  const attempts = [{ target, type }];
  if (process.platform === 'win32' && type === 'dir') attempts.push({ target, type: 'junction' });
  let lastError = null;
  for (const attempt of attempts) {
    try {
      fs.symlinkSync(attempt.target, linkPath, attempt.type);
      return true;
    } catch (err) {
      lastError = err;
      if (err.code !== 'EPERM' && err.code !== 'EACCES' && err.code !== 'ENOTSUP' && err.code !== 'EUNKNOWN') {
        throw err;
      }
    }
  }
  t.skip('symbolic links are not permitted on this platform (' + (lastError && lastError.code) + ')');
  return false;
}

describe('hermetic runner: no reachable node_modules may hide from the scan', () => {
  it('reports a node_modules nested under src/ and under test/', () => {
    const tree = makeTempTree();
    try {
      tree.dir('src');
      const nestedTest = tree.dir('test/node_modules');
      const nestedSrc = tree.dir('src/vendor/node_modules');
      assert.deepEqual(nestedNodeModules(tree.root).sort(), [nestedTest, nestedSrc].sort());
    } finally {
      tree.dispose();
    }
  });

  it('reports a node_modules that is itself a symbolic link', (t) => {
    const tree = makeTempTree();
    const outside = makeTempTree();
    try {
      tree.dir('test');
      const packages = outside.dir('packages');
      if (!trySymlink(t, packages, path.join(tree.root, 'test', 'node_modules'), 'dir')) return;
      assert.deepEqual(nestedNodeModules(tree.root), [path.join(tree.root, 'test', 'node_modules')]);
    } finally {
      tree.dispose();
      outside.dispose();
    }
  });

  it('reports a node_modules inside a symbolic-linked directory', (t) => {
    const tree = makeTempTree();
    const outside = makeTempTree();
    try {
      tree.dir('src');
      outside.dir('vendor/node_modules');
      if (!trySymlink(t, outside.dir('vendor'), path.join(tree.root, 'src', 'vendor'), 'dir')) return;
      assert.deepEqual(nestedNodeModules(tree.root), [path.join(tree.root, 'src', 'vendor', 'node_modules')]);
    } finally {
      tree.dispose();
      outside.dispose();
    }
  });

  it('stays empty on an ordinary tree, and does not follow a link loop twice', (t) => {
    const tree = makeTempTree();
    try {
      tree.dir('src/stage');
      tree.dir('test');
      fs.writeFileSync(path.join(tree.root, 'src', 'index.js'), 'module.exports = {};\n');
      assert.deepEqual(nestedNodeModules(tree.root), []);
      if (!trySymlink(t, tree.root, path.join(tree.root, 'src', 'self'), 'dir')) return;
      assert.deepEqual(nestedNodeModules(tree.root), [], 'a loop must terminate without inventing a node_modules');
    } finally {
      tree.dispose();
    }
  });

  it('still finds a node_modules in an ancestor of the copy', () => {
    const tree = makeTempTree();
    try {
      const nodeModules = path.join(tree.root, 'node_modules');
      fs.mkdirSync(nodeModules);
      const copy = tree.dir('tmp/packages/recommendation-core/test');
      assert.deepEqual(ancestorNodeModules(copy), [nodeModules]);
    } finally {
      tree.dispose();
    }
  });
});
