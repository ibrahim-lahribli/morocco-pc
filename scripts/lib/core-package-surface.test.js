'use strict';

// scripts/lib/core-package-surface.test.js - the core's public interface, checked
// against the approved RFC §11.4 contract.
//
// The contract itself lives in ./core-approved-interface.js so the script gate
// and the API-image gate (a read-only bind mount inside the container) enforce
// ONE map, not two copies that can drift. There is no barrel-per-directory rule:
// `./offers` is `src/offers/as-of.js` (there is no `offers/index.js`) and
// `./errors` is `src/candidates/errors.js`.
//
// The manifest's `exports` map is compared as a whole: missing subpaths,
// additional subpaths (including `./package.json`) and incorrectly mapped
// targets all fail, whether or not the target file exists. Containment is
// filesystem-real (realpath), so a symlink cannot point an export outside the
// package.
//
// This gate lives in scripts/lib, not packages/recommendation-core/test, because
// the core-test purity audit forbids node:fs and dynamic require there, and the
// hermetic core copy must never read repo paths.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  APPROVED_INTERFACE,
  APPROVED_NAMESPACES,
  approvedExportsMap,
  exportsMapProblems,
  namespaceProblems,
  targetProblems,
  runContainerGate,
} = require('./core-approved-interface');

const CORE_ROOT = path.resolve(__dirname, '../../packages/recommendation-core');
const SNAPSHOT = path.join(CORE_ROOT, 'test/export-surface.json');
const MANIFEST = path.join(CORE_ROOT, 'package.json');

const core = require(CORE_ROOT);

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

// A synthetic manifest that satisfies the approved interface. Negative tests
// start from this, not from the working tree, so the validator is exercised
// even when the real map is not declared yet.
function approvedManifest() {
  return {
    name: '@morocco-pc/recommendation-core',
    main: 'src/index.js',
    exports: approvedExportsMap(),
  };
}

describe('core package surface', () => {
  it('the snapshot matches the package metadata and the entry point', () => {
    const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const pkg = readManifest();

    assert.equal(snapshot.package, pkg.name);
    assert.equal(snapshot.entry, pkg.main);
    assert.deepEqual([...snapshot.exports].sort(), Object.keys(core).sort());
  });

  it('publishes exactly the RFC section 11.4 namespaces at the root', () => {
    assert.deepEqual(Object.keys(core).sort(), APPROVED_NAMESPACES,
      'the root entry must publish the approved namespaces and nothing else');
    assert.deepEqual(namespaceProblems('root', core, APPROVED_INTERFACE['.'].requires), []);
  });

  it('declares exactly the approved eleven-subpath exports map', () => {
    const pkg = readManifest();
    assert.equal(Object.keys(APPROVED_INTERFACE).length, 11,
      'RFC section 11.4 approves exactly eleven subpaths');
    assert.deepEqual(exportsMapProblems(pkg), [], 'the declared interface must be the approved one');

    for (const [subpath, entry] of Object.entries(APPROVED_INTERFACE)) {
      assert.equal(pkg.exports[subpath].replace(/\\/g, '/'), entry.target,
        subpath + ' must map to its approved target');
    }
  });

  it('keeps every approved target inside the package on the real filesystem', () => {
    for (const [subpath, entry] of Object.entries(APPROVED_INTERFACE)) {
      assert.deepEqual(
        targetProblems({ packageRoot: CORE_ROOT, subpath, target: entry.target }),
        [],
        subpath + ' must resolve to a file inside the package'
      );
    }
  });

  it('every namespace target is the object the root entry publishes', () => {
    for (const [subpath, entry] of Object.entries(APPROVED_INTERFACE)) {
      const loaded = require(path.resolve(CORE_ROOT, entry.target));
      if (entry.namespace !== null) {
        assert.equal(loaded, core[entry.namespace],
          subpath + ' must load the same object the root entry publishes as ' + entry.namespace);
      } else if (subpath === '.') {
        assert.equal(loaded, core, subpath + ' must load the root entry');
      }
    }
  });

  it('accepts offers/as-of.js as the offers entry point', () => {
    const asOf = require(path.resolve(CORE_ROOT, 'src/offers/as-of.js'));
    assert.equal(readManifest().exports['./offers'], './src/offers/as-of.js');
    assert.equal(core.offers, asOf, 'the root offers namespace must be the as-of module');
    assert.equal(typeof core.offers.parseAsOf, 'function');
    assert.deepEqual(namespaceProblems('offers', core.offers, APPROVED_INTERFACE['./offers'].requires), []);
    assert.equal('selectOfferPrices' in core.offers, false,
      'the SQL-executing offers barrel must stay in the runtime tree');
  });

  it('every namespace exposes its RFC exports', () => {
    for (const [subpath, entry] of Object.entries(APPROVED_INTERFACE)) {
      if (subpath === '.') continue;
      const loaded = require(path.resolve(CORE_ROOT, entry.target));
      assert.deepEqual(namespaceProblems(subpath, loaded, entry.requires), [],
        subpath + ' does not expose the approved interface');
    }
  });

  it('./errors exposes the same error contract as the candidates namespace', () => {
    const errors = require(path.resolve(CORE_ROOT, APPROVED_INTERFACE['./errors'].target));
    assert.equal(errors.ERROR_CODES, core.candidates.ERROR_CODES);
    assert.equal(errors.CandidateSelectionError, core.candidates.CandidateSelectionError);
  });

  it('the container gate accepts the shipped package and rejects its six tampered maps', () => {
    const result = runContainerGate(CORE_ROOT);
    assert.deepEqual(result.namespaces, APPROVED_NAMESPACES);
    assert.equal(result.negatives, 6);
  });
});

describe('core package surface rejects an interface that is not the approved one', () => {
  it('accepts the approved map itself', () => {
    assert.deepEqual(exportsMapProblems(approvedManifest()), []);
  });

  it('rejects ./package.json as an unauthorized additional export', () => {
    const pkg = approvedManifest();
    const problems = exportsMapProblems({
      ...pkg,
      exports: { ...pkg.exports, './package.json': './package.json' },
    });
    assert.ok(problems.some((problem) => problem.includes('unauthorized subpath ./package.json')),
      'expected an unauthorized-subpath problem, got: ' + JSON.stringify(problems));
  });

  it('rejects an unauthorized subpath even when its target is an existing valid file', () => {
    const pkg = approvedManifest();
    const existingTarget = APPROVED_INTERFACE['./errors'].target;
    assert.ok(fs.existsSync(path.resolve(CORE_ROOT, existingTarget)),
      'the fixture assumes the target exists');
    const problems = exportsMapProblems({
      ...pkg,
      exports: { ...pkg.exports, './internal': existingTarget },
    });
    assert.ok(problems.includes('unauthorized subpath ./internal'),
      'existence alone must never authorize a subpath: ' + JSON.stringify(problems));
  });

  it('rejects a missing approved subpath', () => {
    const pkg = approvedManifest();
    const { './offers': omitted, ...rest } = pkg.exports;
    assert.equal(omitted, './src/offers/as-of.js');
    const problems = exportsMapProblems({ ...pkg, exports: rest });
    assert.ok(problems.includes('missing approved subpath ./offers'), JSON.stringify(problems));
  });

  it('rejects an incorrectly mapped subpath', () => {
    const pkg = approvedManifest();
    const problems = exportsMapProblems({
      ...pkg,
      exports: { ...pkg.exports, './offers': './src/offers/index.js' },
    });
    assert.ok(problems.some((problem) => problem.includes('is mapped to ./src/offers/index.js')),
      JSON.stringify(problems));
  });

  it('rejects a subpath remapped to a different existing file', () => {
    const pkg = approvedManifest();
    const existingTarget = APPROVED_INTERFACE['./candidates'].target;
    assert.ok(fs.existsSync(path.resolve(CORE_ROOT, existingTarget)));
    const problems = exportsMapProblems({
      ...pkg,
      exports: { ...pkg.exports, './assembly': existingTarget },
    });
    assert.ok(problems.includes(
      './assembly is mapped to ' + existingTarget + '; the approved target is ./src/assembly/index.js'
    ), JSON.stringify(problems));
  });

  it('rejects a conditional target instead of a static file', () => {
    const pkg = approvedManifest();
    const problems = exportsMapProblems({
      ...pkg,
      exports: { ...pkg.exports, './offers': { require: './src/offers/as-of.js' } },
    });
    assert.ok(problems.includes('./offers must map to one static target, not a condition'),
      JSON.stringify(problems));
  });

  it('rejects a package with no exports map at all', () => {
    const pkg = approvedManifest();
    const { exports: omitted, ...rest } = pkg;
    assert.ok(omitted, 'the fixture assumes a declared map to remove');
    const problems = exportsMapProblems(rest);
    assert.ok(problems.some((problem) => problem.includes('must declare the RFC section 11.4 exports map')),
      JSON.stringify(problems));
  });

  it('rejects an empty namespace', () => {
    const problems = namespaceProblems('offers', {}, APPROVED_INTERFACE['./offers'].requires);
    assert.ok(problems.includes('offers is published but exports nothing'), JSON.stringify(problems));
    assert.ok(problems.includes('offers is missing required export parseAsOf'), JSON.stringify(problems));
  });

  it('rejects a namespace whose approved export is undefined', () => {
    const problems = namespaceProblems('offers', { parseAsOf: undefined }, APPROVED_INTERFACE['./offers'].requires);
    assert.ok(problems.includes('offers.parseAsOf is undefined'), JSON.stringify(problems));
  });

  it('rejects a namespace whose approved export has the wrong kind', () => {
    const problems = namespaceProblems('offers', { parseAsOf: 42 }, APPROVED_INTERFACE['./offers'].requires);
    assert.ok(problems.includes('offers.parseAsOf must be a function, not number'), JSON.stringify(problems));
  });

  it('accepts a populated namespace with the approved export', () => {
    assert.deepEqual(
      namespaceProblems('offers', { parseAsOf() {} }, APPROVED_INTERFACE['./offers'].requires),
      []
    );
  });
});

describe('core package surface contains export targets on the real filesystem', () => {
  it('fails closed on a target that does not exist', () => {
    const problems = targetProblems({
      packageRoot: CORE_ROOT,
      subpath: './missing',
      target: './src/this-file-does-not-exist.js',
    });
    assert.ok(problems.some((problem) => problem.includes('target is missing')), JSON.stringify(problems));
  });

  it('rejects a symlink that resolves outside the package', (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'core-surface-escape-'));
    try {
      const pkgRoot = path.join(tempRoot, 'pkg');
      const outside = path.join(tempRoot, 'outside');
      fs.mkdirSync(pkgRoot);
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, 'secret.js'), 'module.exports = {};\n');
      try {
        fs.symlinkSync(outside, path.join(pkgRoot, 'src'),
          process.platform === 'win32' ? 'junction' : 'dir');
      } catch (err) {
        if (['EPERM', 'EACCES', 'ENOTSUP', 'EUNKNOWN'].includes(err.code)) {
          t.skip('this platform refuses to create a directory link: ' + err.code);
          return;
        }
        throw err;
      }

      const problems = targetProblems({ packageRoot: pkgRoot, subpath: './escape', target: './src/secret.js' });
      assert.ok(problems.some((problem) => problem.includes('escapes the package')),
        'a symlink target outside the package must fail: ' + JSON.stringify(problems));
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5 });
    }
  });

  it('accepts a link whose real target stays inside the package', (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'core-surface-inside-'));
    try {
      const pkgRoot = path.join(tempRoot, 'pkg');
      const real = path.join(pkgRoot, 'src', 'real');
      fs.mkdirSync(real, { recursive: true });
      fs.writeFileSync(path.join(real, 'index.js'), 'module.exports = {};\n');
      try {
        fs.symlinkSync(real, path.join(pkgRoot, 'src', 'alias'),
          process.platform === 'win32' ? 'junction' : 'dir');
      } catch (err) {
        if (['EPERM', 'EACCES', 'ENOTSUP', 'EUNKNOWN'].includes(err.code)) {
          t.skip('this platform refuses to create a directory link: ' + err.code);
          return;
        }
        throw err;
      }

      assert.deepEqual(
        targetProblems({ packageRoot: pkgRoot, subpath: './alias', target: './src/alias/index.js' }),
        [],
        'a link that resolves inside the package must remain legitimate'
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5 });
    }
  });
});
