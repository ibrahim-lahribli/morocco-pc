'use strict';

// scripts/lib/runtime-package-exports.test.js - the runtime package's public
// boundary, exercised the way a real consumer reaches it.
//
// packages/recommendation-runtime/test/index.test.js pins the manifest's own
// strings and resolves its targets by RELATIVE path. That cannot prove the
// property that matters operationally: that
// `require('@morocco-pc/recommendation-runtime/loaders')` works from OUTSIDE
// the package, that each subpath names its intended file, and that the
// implementation tree stays unreachable. This suite builds a throwaway consumer
// with the package installed in its own node_modules and asks Node's resolver.
//
// RFC §11.5 (approved as written by decision A2) approves four subpaths. §19.4.3
// deferred the map until W3 and its call sites existed; W3 supplies both, so the
// map is a contract now rather than a path that happens to resolve.
//
// Two packages are installed, not one. The runtime reaches the pure core by a
// RELATIVE specifier (`../../recommendation-core` from `src/**`), because the
// RFC's dependency direction is runtime -> core and a bare specifier would
// require a node_modules layout this repository does not have. Reproducing that
// layout in the consumer is what lets the real resolution path run: from
// `node_modules/@morocco-pc/recommendation-runtime/src/x.js`, `../../` is
// `node_modules/@morocco-pc`, so the core belongs at
// `node_modules/@morocco-pc/recommendation-core`.
//
// It lives in scripts/lib, not in the runtime test directory: package-surface
// validation belongs to repository tooling, and the runtime suite is audited to
// stay DB-free and dependency-free. Writes only under os.tmpdir(); DB-free.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

const REPO_ROOT = path.resolve(__dirname, '../..');
const RUNTIME_ROOT = path.join(REPO_ROOT, 'packages', 'recommendation-runtime');
const CORE_ROOT = path.join(REPO_ROOT, 'packages', 'recommendation-core');
const PACKAGE_NAME = '@morocco-pc/recommendation-runtime';
const CORE_PACKAGE_NAME = '@morocco-pc/recommendation-core';

// RFC §11.5 / decision A2. This table is the approved contract: adding,
// removing or retargeting a subpath is an RFC amendment, not a test edit.
const APPROVED_SUBPATHS = {
  '.': 'src/index.js',
  './loaders': 'src/loaders/index.js',
  './orchestrator': 'src/orchestrator/index.js',
  './persistence': 'src/persistence/index.js',
};

const NAMESPACE_NAMES = Object.keys(APPROVED_SUBPATHS)
  .filter((subpath) => subpath !== '.')
  .map((subpath) => subpath.slice(2))
  .sort();

const MANIFEST = JSON.parse(fs.readFileSync(path.join(RUNTIME_ROOT, 'package.json'), 'utf8'));

let consumerRoot = null;
let installedRoot = null;
let requireFromConsumer = null;

/**
 * Install a package under a consumer's node_modules. A junction (Windows) or
 * directory symlink (POSIX) tests the real tree; copying is the fallback for
 * platforms that refuse links. Node resolves the package boundary through
 * realpath either way, so the exports map is what decides each subpath.
 */
function installPackage(sourceRoot, destination) {
  try {
    fs.symlinkSync(sourceRoot, destination, process.platform === 'win32' ? 'junction' : 'dir');
    return;
  } catch (err) {
    if (!['EPERM', 'EACCES', 'ENOTSUP', 'EUNKNOWN'].includes(err.code)) throw err;
  }
  fs.mkdirSync(destination, { recursive: true });
  fs.copyFileSync(path.join(sourceRoot, 'package.json'), path.join(destination, 'package.json'));
  fs.cpSync(path.join(sourceRoot, 'src'), path.join(destination, 'src'), { recursive: true });
}

before(() => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-package-consumer-'));
  consumerRoot = fs.realpathSync(tempRoot);
  const scoped = path.join(consumerRoot, 'node_modules', '@morocco-pc');
  fs.mkdirSync(scoped, { recursive: true });
  installPackage(RUNTIME_ROOT, path.join(scoped, 'recommendation-runtime'));
  installPackage(CORE_ROOT, path.join(scoped, 'recommendation-core'));
  installedRoot = fs.realpathSync(path.join(scoped, 'recommendation-runtime'));
  requireFromConsumer = createRequire(path.join(consumerRoot, 'consumer.cjs'));
});

after(() => {
  if (consumerRoot !== null) {
    fs.rmSync(consumerRoot, { recursive: true, force: true, maxRetries: 5 });
  }
});

function installedFile(relative) {
  return fs.realpathSync(path.join(installedRoot, relative));
}

describe('runtime package exports: the approved map', () => {
  it('declares exactly the RFC §11.5 subpaths and their intended targets', () => {
    assert.deepEqual(Object.keys(MANIFEST.exports).sort(), Object.keys(APPROVED_SUBPATHS).sort());
    for (const [subpath, target] of Object.entries(APPROVED_SUBPATHS)) {
      assert.equal(MANIFEST.exports[subpath], './' + target, subpath + ' must map to ' + target);
    }
  });

  it('does not publish ./package.json or any convenience subpath', () => {
    assert.equal('./package.json' in MANIFEST.exports, false,
      './package.json is repository metadata, not an approved public subpath');
    assert.equal(MANIFEST.exports['.'], './' + MANIFEST.main,
      'the root subpath must name the declared main entry');
  });
});

describe('runtime package exports: real resolution through the package name', () => {
  it('resolves every approved subpath to its intended file and loads it', () => {
    for (const [subpath, target] of Object.entries(APPROVED_SUBPATHS)) {
      const specifier = subpath === '.' ? PACKAGE_NAME : PACKAGE_NAME + subpath.slice(1);
      const resolved = fs.realpathSync(requireFromConsumer.resolve(specifier));
      assert.equal(resolved, installedFile(target), specifier + ' must resolve to ' + target);
      const loaded = requireFromConsumer(specifier);
      assert.equal(loaded !== null && typeof loaded === 'object', true,
        specifier + ' must load an object');
    }
  });

  it('exposes each namespace through its subpath as the same object the root publishes', () => {
    const root = requireFromConsumer(PACKAGE_NAME);
    assert.deepEqual(Object.keys(root), ['loaders', 'orchestrator', 'persistence'],
      'the root publishes the RFC §11.5 namespaces, in the approved order');
    assert.deepEqual(Object.keys(root).sort(), NAMESPACE_NAMES);
    for (const name of NAMESPACE_NAMES) {
      assert.equal(requireFromConsumer(PACKAGE_NAME + '/' + name), root[name],
        'require(' + PACKAGE_NAME + '/' + name + ') must be the root namespace object');
    }
  });

  it('loads the whole package with the core reachable only by its relative layout', () => {
    // The dependency direction is runtime -> core, and the specifier that
    // expresses it is relative. If the core were absent from the consumer this
    // would throw MODULE_NOT_FOUND, which is the failure mode a bare specifier
    // would hide behind a hoisted node_modules in the repository.
    const root = requireFromConsumer(PACKAGE_NAME);
    assert.equal(typeof root.orchestrator.runRecommendation, 'function');
    assert.equal(typeof root.loaders.loadQueryInput, 'function');
    assert.equal(typeof root.persistence.persistRanked, 'function');
    const core = requireFromConsumer(CORE_PACKAGE_NAME);
    assert.equal(root.orchestrator.runRecommendation !== core.ranking.rankBuilds, true);
  });
});

describe('runtime package exports: private paths are unreachable', () => {
  it('rejects every unapproved and private specifier', () => {
    const forbidden = [
      PACKAGE_NAME + '/package.json',
      PACKAGE_NAME + '/src/index.js',
      PACKAGE_NAME + '/src/loaders/index.js',
      PACKAGE_NAME + '/src/orchestrator/run',
      PACKAGE_NAME + '/src/persistence/persist-ranked',
      // The three mixed-barrel composites are the byte-identical-move seam, not
      // a publication (docs/MIXED_BARRELS.md §5). If one ever resolved through
      // the package name, the runtime would be publishing the pure members it
      // re-exports and the ownership split would be gone.
      PACKAGE_NAME + '/candidates',
      PACKAGE_NAME + '/filtering',
      PACKAGE_NAME + '/scoring',
      PACKAGE_NAME + '/offers',
      PACKAGE_NAME + '/query',
      PACKAGE_NAME + '/nope',
      PACKAGE_NAME + '/loaders/index',
    ];
    for (const specifier of forbidden) {
      assert.throws(
        () => requireFromConsumer(specifier),
        (err) => {
          assert.equal(err.code, 'ERR_PACKAGE_PATH_NOT_EXPORTED',
            specifier + ' must be unreachable; got ' + err.code);
          return true;
        }
      );
    }
  });

  it('keeps the published namespaces and the src directories in a declared relation', () => {
    // Core can assert a bijection because every src/<dir> is a namespace.
    // Runtime cannot: src/ also holds the core adapter, the entry point, the
    // two runtime-only barrels (offers, query) and the three composites. The
    // assertion is therefore exact in both directions - every published
    // namespace is a directory with an index.js, and every other directory is
    // named here as deliberately unpublished.
    const directories = fs.readdirSync(path.join(installedRoot, 'src'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(
      directories,
      ['candidates', 'filtering', 'loaders', 'offers', 'orchestrator', 'persistence', 'query', 'scoring']
    );
    for (const name of NAMESPACE_NAMES) {
      assert.ok(directories.includes(name), name + ' must be a src directory');
    }
    const UNPUBLISHED = ['candidates', 'filtering', 'offers', 'query', 'scoring'];
    for (const name of UNPUBLISHED) {
      assert.equal(directories.includes(name), true, name + ' is a known unpublished directory');
      assert.equal(NAMESPACE_NAMES.includes(name), false, name + ' must not be a published namespace');
    }
  });
});
