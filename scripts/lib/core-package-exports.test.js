'use strict';

// scripts/lib/core-package-exports.test.js - the core package's public
// boundary, exercised the way a real consumer reaches it.
//
// packages/recommendation-core/test/index.test.js pins the manifest's own
// strings and resolves RELATIVE specifiers. That cannot prove the property
// that matters operationally: that `require('@morocco-pc/recommendation-core/x')`
// works from OUTSIDE the package, that each subpath names its intended file,
// and that the implementation tree stays unreachable. This suite builds a
// throwaway consumer with the package installed in its own node_modules and
// asks Node's resolver.
//
// It lives in scripts/lib, not in the core test directory: the core suite is
// audited for purity by scripts/audit-pr2-test-ownership.js (no bare
// specifiers, no repository paths), and package-surface validation belongs to
// repository tooling. Writes only under os.tmpdir(); DB-free.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

const CORE_ROOT = path.resolve(__dirname, '../../packages/recommendation-core');
const PACKAGE_NAME = '@morocco-pc/recommendation-core';

// RFC §11.4 / decision A2. This table is the approved contract: adding,
// removing or retargeting a subpath is an RFC amendment, not a test edit.
const APPROVED_SUBPATHS = {
  '.': 'src/index.js',
  './assembly': 'src/assembly/index.js',
  './candidates': 'src/candidates/index.js',
  './compatibility': 'src/compatibility/index.js',
  './errors': 'src/candidates/errors.js',
  './explanation': 'src/explanation/index.js',
  './filtering': 'src/filtering/index.js',
  './offers': 'src/offers/as-of.js',
  './ranking': 'src/ranking/index.js',
  './retention': 'src/retention/index.js',
  './scoring': 'src/scoring/index.js',
};

// Every subpath except the root aggregate and the error module names a
// namespace published by the entry point.
const NAMESPACE_NAMES = Object.keys(APPROVED_SUBPATHS)
  .filter((subpath) => subpath !== '.' && subpath !== './errors')
  .map((subpath) => subpath.slice(2))
  .sort();

const MANIFEST = JSON.parse(fs.readFileSync(path.join(CORE_ROOT, 'package.json'), 'utf8'));

let consumerRoot = null;
let installedRoot = null;
let requireFromConsumer = null;

/**
 * Install the package under a consumer's node_modules. A junction (Windows) or
 * directory symlink (POSIX) tests the real tree; copying is the fallback for
 * platforms that refuse links. Node resolves the package boundary through
 * realpath either way, so the exports map is what decides each subpath.
 */
function installPackage(destination) {
  try {
    fs.symlinkSync(CORE_ROOT, destination, process.platform === 'win32' ? 'junction' : 'dir');
    return;
  } catch (err) {
    if (!['EPERM', 'EACCES', 'ENOTSUP', 'EUNKNOWN'].includes(err.code)) throw err;
  }
  fs.mkdirSync(destination, { recursive: true });
  fs.copyFileSync(path.join(CORE_ROOT, 'package.json'), path.join(destination, 'package.json'));
  fs.cpSync(path.join(CORE_ROOT, 'src'), path.join(destination, 'src'), { recursive: true });
}

before(() => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'core-package-consumer-'));
  consumerRoot = fs.realpathSync(tempRoot);
  const destination = path.join(consumerRoot, 'node_modules', '@morocco-pc', 'recommendation-core');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  installPackage(destination);
  installedRoot = fs.realpathSync(destination);
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

function directoryNames(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe('core package exports: the approved map', () => {
  it('declares exactly the RFC 11.4 subpaths and their intended targets', () => {
    assert.deepEqual(Object.keys(MANIFEST.exports).sort(), Object.keys(APPROVED_SUBPATHS).sort());
    for (const [subpath, target] of Object.entries(APPROVED_SUBPATHS)) {
      assert.equal(MANIFEST.exports[subpath], './' + target,
        subpath + ' must map to ' + target);
    }
  });

  it('does not publish ./package.json or any convenience subpath', () => {
    assert.equal('./package.json' in MANIFEST.exports, false,
      './package.json is repository metadata, not an approved public subpath');
    assert.equal(MANIFEST.exports['.'], './' + MANIFEST.main,
      'the root subpath must name the declared main entry');
  });
});

describe('core package exports: real resolution through the package name', () => {
  it('resolves every approved subpath to its intended file and loads it', () => {
    for (const [subpath, target] of Object.entries(APPROVED_SUBPATHS)) {
      const specifier = subpath === '.' ? PACKAGE_NAME : PACKAGE_NAME + subpath.slice(1);
      const resolved = fs.realpathSync(requireFromConsumer.resolve(specifier));
      assert.equal(resolved, installedFile(target), specifier + ' must resolve to ' + target);
      const loaded = requireFromConsumer(specifier);
      assert.equal(loaded !== null && (typeof loaded === 'object' || typeof loaded === 'function'), true,
        specifier + ' must load an object or a function');
    }
  });

  it('exposes each namespace through its subpath as the same module the root publishes', () => {
    const root = requireFromConsumer(PACKAGE_NAME);
    assert.deepEqual(Object.keys(root).sort(), NAMESPACE_NAMES);
    for (const name of NAMESPACE_NAMES) {
      assert.equal(requireFromConsumer(PACKAGE_NAME + '/' + name), root[name],
        'require(' + PACKAGE_NAME + '/' + name + ') must be the root namespace object');
    }
  });

  it('publishes ./offers as the as-of module itself, with no core offers barrel', () => {
    const root = requireFromConsumer(PACKAGE_NAME);
    const offers = requireFromConsumer(PACKAGE_NAME + '/offers');
    assert.equal(offers, root.offers);
    assert.equal(fs.realpathSync(requireFromConsumer.resolve(PACKAGE_NAME + '/offers')),
      installedFile('src/offers/as-of.js'));
    assert.equal(fs.existsSync(path.join(installedRoot, 'src', 'offers', 'index.js')), false,
      'offers is the as-of module; the SQL barrel stays runtime');
    assert.deepEqual(Object.keys(offers).sort(), ['parseAsOf']);
  });

  it('publishes ./errors as the error contract runtime imports by name', () => {
    const errors = requireFromConsumer(PACKAGE_NAME + '/errors');
    const root = requireFromConsumer(PACKAGE_NAME);
    assert.deepEqual(Object.keys(errors).sort(), ['CandidateSelectionError', 'ERROR_CODES']);
    assert.equal(errors.ERROR_CODES, root.candidates.ERROR_CODES);
    assert.equal(errors.CandidateSelectionError, root.candidates.CandidateSelectionError);
  });
});

describe('core package exports: drift between metadata and the tree', () => {
  it('keeps the entry namespaces, the subpaths and the src directories in a bijection', () => {
    const root = requireFromConsumer(PACKAGE_NAME);
    assert.deepEqual(Object.keys(root).sort(), NAMESPACE_NAMES,
      'the entry point namespaces and the approved namespace subpaths must match');

    const directories = directoryNames(path.join(installedRoot, 'src'));
    assert.deepEqual(directories, NAMESPACE_NAMES,
      'every src/<dir> must be a published namespace; no private helper directories');

    for (const subpath of Object.keys(APPROVED_SUBPATHS)) {
      if (subpath === '.' || subpath === './errors') continue;
      const target = APPROVED_SUBPATHS[subpath];
      const namespace = subpath.slice(2);
      assert.ok(target.startsWith('src/' + namespace + '/'),
        subpath + ' must point inside src/' + namespace + '/, got ' + target);
    }
  });
});

describe('core package exports: private paths are unreachable', () => {
  it('rejects every unapproved and private specifier', () => {
    const forbidden = [
      PACKAGE_NAME + '/package.json',
      PACKAGE_NAME + '/src/index.js',
      PACKAGE_NAME + '/src/ranking/rank',
      PACKAGE_NAME + '/src/candidates/errors',
      PACKAGE_NAME + '/offers/index',
      PACKAGE_NAME + '/nope',
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

  it('needs no private implementation import to obtain every namespace', () => {
    const root = requireFromConsumer(PACKAGE_NAME);
    for (const name of NAMESPACE_NAMES) {
      const namespace = requireFromConsumer(PACKAGE_NAME + '/' + name);
      assert.equal(typeof namespace, 'object');
      assert.equal(Object.keys(namespace).length > 0, true, name + ' must expose a non-empty surface');
      assert.equal(namespace, root[name]);
    }
  });
});
