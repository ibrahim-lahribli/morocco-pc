'use strict';

// packages/recommendation-core/test/hermetic-run.js — RFC §11.6 "Hermetic run".
//
// The package suite must pass with NO installed packages. Asserting that
// package.json declares no dependencies is not proof: a test could still import
// something that happens to sit in the repository's node_modules. This runner
// proves the property instead of asserting it:
//
//   1. copy the package (package.json, src/, test/) into a fresh temporary
//      directory OUTSIDE the repository, so the repository's node_modules is
//      not an ancestor of the copy;
//   2. fail if a node_modules entry exists in the copy or in any ancestor of
//      it — any depth, and whether it is a directory, a file or a symbolic
//      link, because Node resolves packages through every one of those;
//      so no bare import can be satisfied;
//   3. run the package's own command (`node --test "test/*.test.js"`) from the
//      copy with NODE_PATH emptied;
//   4. remove the temporary tree in a `finally`, whether the run passed, failed
//      or threw.
//
// This file is not itself a suite: test:core globs `test/*.test.js`, and a test
// that re-ran the whole suite would invoke itself forever. CI runs it as its
// own step (`node packages/recommendation-core/test/hermetic-run.js`), and
// test/hermetic-run.test.js requires the reachability helpers below — `main()`
// runs only when this file is the entry point.
//
// Node's own test runner only: no third-party package, no database, no network.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const COPY_ENTRIES = ['package.json', 'src', 'test'];

function ancestorNodeModules(start) {
  const found = [];
  let current = path.resolve(start);
  for (;;) {
    const candidate = path.join(current, 'node_modules');
    if (fs.existsSync(candidate)) found.push(candidate);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return found;
}

function realpathOrNull(target) {
  try {
    return fs.realpathSync(target);
  } catch (_err) {
    return null;
  }
}

/**
 * Every `node_modules` entry under `directory`, at any depth, including one
 * that IS a symbolic link (`test/node_modules -> ...`) and one inside a
 * symbolic-linked directory.
 *
 * Each entry is inspected with `lstat`, not with the Dirent's own type: a
 * `node_modules` symlink is not `isDirectory()`, and Node still resolves
 * packages through it. An entry named `node_modules` is reported whatever it
 * is — directory, file or link — because each can satisfy an import. A link to
 * a directory is followed, with real paths remembered so a link loop
 * terminates; a broken link resolves nothing and is skipped.
 */
function nestedNodeModules(directory, visited) {
  const found = [];
  const seen = visited || new Set();
  const realDirectory = realpathOrNull(directory);
  if (realDirectory !== null) {
    if (seen.has(realDirectory)) return found;
    seen.add(realDirectory);
  }
  for (const entry of fs.readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (entry === 'node_modules') {
      found.push(full);
      continue;
    }
    let entryStat;
    try {
      entryStat = fs.lstatSync(full);
    } catch (err) {
      throw new Error('cannot inspect ' + full + ': ' + err.message);
    }
    if (entryStat.isSymbolicLink()) {
      let targetStat;
      try {
        targetStat = fs.statSync(full);
      } catch (_err) {
        continue; // a broken link cannot satisfy an import
      }
      if (targetStat.isDirectory()) found.push(...nestedNodeModules(full, seen));
      continue;
    }
    if (entryStat.isDirectory()) found.push(...nestedNodeModules(full, seen));
  }
  return found;
}

function copyPackage(destination) {
  for (const entry of COPY_ENTRIES) {
    fs.cpSync(path.join(PACKAGE_ROOT, entry), path.join(destination, entry), { recursive: true });
  }
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'recommendation-core-hermetic-'));
  try {
    const packageCopy = path.join(tempRoot, 'packages', 'recommendation-core');
    copyPackage(packageCopy);

    const strays = [...ancestorNodeModules(packageCopy), ...nestedNodeModules(packageCopy)];
    if (strays.length > 0) {
      console.error('hermetic core run: FAIL — node_modules can satisfy an import: ' + strays.join(', '));
      return 1;
    }

    console.log('hermetic core run: ' + packageCopy);
    console.log('  node_modules: none in the copy (nested or symlinked) or any ancestor');
    console.log('  NODE_PATH: ""');

    const result = spawnSync(process.execPath, ['--test', 'test/*.test.js'], {
      cwd: packageCopy,
      env: { ...process.env, NODE_PATH: '' },
      stdio: 'inherit',
    });

    if (result.error) {
      console.error('hermetic core run: FAIL — could not start node: ' + result.error.message);
      return 1;
    }
    if (result.status !== 0) {
      console.error('hermetic core run: FAIL — the isolated suite exited ' + result.status);
      return result.status === null ? 1 : result.status;
    }
    console.log('hermetic core run: PASS');
    return 0;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

module.exports = { ancestorNodeModules, nestedNodeModules, main };

if (require.main === module) {
  process.exitCode = main();
}
