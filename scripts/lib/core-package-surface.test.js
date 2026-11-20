'use strict';

// scripts/lib/core-package-surface.test.js - the core's public interface, checked
// against the approved RFC §11.4 contract.
//
// There is no barrel-per-directory rule here. The approved interface names an
// exact target per subpath: `./offers` is `src/offers/as-of.js` (there is no
// `offers/index.js`), `./errors` is `src/candidates/errors.js`, and the root is
// the hand-written entry point. A namespace is published only when the manifest
// declares it AND the module it declares actually exposes its RFC exports, so a
// directory or source file that merely exists never counts as a namespace.
//
// The manifest's `exports` map is the interface, so it is compared as a whole:
// missing subpaths, additional subpaths (including `./package.json`, which RFC
// §11.4 does not approve) and incorrectly mapped targets are all failures. There
// is no allow-list and no exception.
//
// This gate lives in scripts/lib, not packages/recommendation-core/test, because
// the core-test purity audit forbids node:fs and dynamic require there, and the
// hermetic core copy must never read repo paths.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CORE_ROOT = path.resolve(__dirname, '../../packages/recommendation-core');
const SNAPSHOT = path.join(CORE_ROOT, 'test/export-surface.json');
const MANIFEST = path.join(CORE_ROOT, 'package.json');

const core = require(CORE_ROOT);

// RFC §11.4, approved as written (A2). `requires` is the minimum set of names
// the RFC gives for the subpath; exact key-by-key lists stay in the core's own
// test/surface.test.js. A namespace entry (namespace !== null) must also be the
// object the root entry publishes under that name.
const APPROVED_INTERFACE = {
  '.': {
    target: './src/index.js',
    namespace: null,
    requires: {
      functions: [],
      values: ['assembly', 'candidates', 'compatibility', 'explanation', 'filtering', 'offers', 'ranking', 'retention', 'scoring'],
    },
  },
  './assembly': {
    target: './src/assembly/index.js',
    namespace: 'assembly',
    requires: {
      functions: [
        'validateEngine3Input',
        'priceKey',
        'validatePrices',
        'lookupPrice',
        'resolveGpuRequirement',
        'assembleBuilds',
        'buildGpuInputs',
        'assembleBuildsForRecommendation',
        'evaluateBuild',
        'evaluateBuildReplacement',
      ],
      values: ['EXPANSION_ORDER'],
    },
  },
  './candidates': {
    target: './src/candidates/index.js',
    namespace: 'candidates',
    requires: {
      functions: [
        'createCandidateSelectionInput',
        'createCandidate',
        'selectCandidatePool',
        'compareCandidates',
        'CandidateSelectionError',
      ],
      values: ['COMPONENT_ROLES', 'ROLE_ORDER', 'ERROR_CODES'],
    },
  },
  './compatibility': {
    target: './src/compatibility/index.js',
    namespace: 'compatibility',
    requires: {
      functions: ['createCompatibilityResult', 'aggregateCompatibilityResults'],
      values: ['REASON_CODES'],
    },
  },
  './errors': {
    target: './src/candidates/errors.js',
    namespace: null,
    requires: {
      functions: ['CandidateSelectionError'],
      values: ['ERROR_CODES'],
    },
  },
  './explanation': {
    target: './src/explanation/index.js',
    namespace: 'explanation',
    requires: {
      functions: ['explainSelection', 'deriveReasons'],
      values: ['REASON_CODES', 'REASON_ORDER'],
    },
  },
  './filtering': {
    target: './src/filtering/index.js',
    namespace: 'filtering',
    requires: {
      functions: ['filterCandidates', 'buildIntegratedGpuPresentMap'],
      values: ['CANDIDATE_STATUSES'],
    },
  },
  './offers': {
    target: './src/offers/as-of.js',
    namespace: 'offers',
    requires: { functions: ['parseAsOf'], values: [] },
  },
  './ranking': {
    target: './src/ranking/index.js',
    namespace: 'ranking',
    requires: {
      functions: ['rankBuilds', 'selectArchetypes', 'selectDiverseTop'],
      values: ['PERFORMANCE_FLOOR', 'STRATEGIES', 'REASON_CODES', 'TOP_N_PERSISTED', 'MAX_PER_PAIR'],
    },
  },
  './retention': {
    target: './src/retention/index.js',
    namespace: 'retention',
    requires: {
      functions: [
        'retainTopKPerRole',
        'computeBudgetFloor',
        'computeRoleTargets',
        'excludedCpuProductIds',
        'resolutionMultiplier',
      ],
      values: [],
    },
  },
  './scoring': {
    target: './src/scoring/index.js',
    namespace: 'scoring',
    requires: {
      functions: [
        'listUseCases',
        'selectAssessmentRow',
        'computeEffectiveScore',
        'computeCandidateScore',
        'computeCandidateScores',
        'computeBuildScore',
        'computeBuildScores',
        'computeBuildScoreContributions',
      ],
      values: ['GPU_POLICIES'],
    },
  },
};

const APPROVED_NAMESPACES = Object.entries(APPROVED_INTERFACE)
  .filter(([, entry]) => entry.namespace !== null)
  .map(([, entry]) => entry.namespace)
  .sort();

// Pure: every problem with a package manifest's declared interface. Returns an
// empty array only when the map is exactly the approved one.
function exportsMapProblems(pkg) {
  const problems = [];
  if (pkg === null || typeof pkg !== 'object') {
    problems.push('package.json must be an object');
    return problems;
  }
  const map = pkg.exports;
  if (map === undefined) {
    problems.push('package.json must declare the RFC section 11.4 exports map');
    return problems;
  }
  if (map === null || typeof map !== 'object' || Array.isArray(map)) {
    problems.push('exports must be an object map');
    return problems;
  }

  for (const subpath of Object.keys(APPROVED_INTERFACE)) {
    if (!Object.prototype.hasOwnProperty.call(map, subpath)) {
      problems.push('missing approved subpath ' + subpath);
    }
  }
  for (const subpath of Object.keys(map)) {
    if (!Object.prototype.hasOwnProperty.call(APPROVED_INTERFACE, subpath)) {
      problems.push('unauthorized subpath ' + subpath);
    }
  }

  for (const [subpath, entry] of Object.entries(APPROVED_INTERFACE)) {
    if (!Object.prototype.hasOwnProperty.call(map, subpath)) continue;
    const target = map[subpath];
    if (typeof target !== 'string') {
      problems.push(subpath + ' must map to one static target, not a condition');
      continue;
    }
    if (!target.startsWith('./')) {
      problems.push(subpath + ' must use a relative ./ target, got ' + target);
      continue;
    }
    if (target.replace(/\\/g, '/') !== entry.target) {
      problems.push(subpath + ' is mapped to ' + target + '; the approved target is ' + entry.target);
    }
  }

  if (typeof map['.'] === 'string' && typeof pkg.main === 'string' && map['.'] !== './' + pkg.main) {
    problems.push('exports["."] must name main (' + pkg.main + '), got ' + map['.']);
  }

  return problems;
}

// Pure: every problem with one namespace value against its RFC exports. A
// namespace whose source file exists but exposes nothing fails here.
function namespaceProblems(name, value, requires) {
  const problems = [];
  if (value === undefined) {
    problems.push(name + ' is undefined');
    return problems;
  }
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    problems.push(name + ' must be an object or function, not ' + typeof value);
    return problems;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    problems.push(name + ' is published but exports nothing');
  }
  const shape = requires || { functions: [], values: [] };
  for (const key of shape.functions) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      problems.push(name + ' is missing required export ' + key);
    } else if (value[key] === undefined) {
      problems.push(name + '.' + key + ' is undefined');
    } else if (typeof value[key] !== 'function') {
      problems.push(name + '.' + key + ' must be a function, not ' + typeof value[key]);
    }
  }
  for (const key of shape.values) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      problems.push(name + ' is missing required export ' + key);
    } else if (value[key] === undefined || value[key] === null) {
      problems.push(name + '.' + key + ' must be defined');
    }
  }
  for (const key of keys) {
    if (value[key] === undefined) problems.push(name + '.' + key + ' is undefined');
  }
  return problems;
}

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

// A synthetic manifest that satisfies the approved interface. Negative tests
// start from this, not from the working tree, so they still exercise the
// validator on a branch where the real map is not declared yet.
function approvedManifest() {
  return {
    name: '@morocco-pc/recommendation-core',
    main: 'src/index.js',
    exports: Object.fromEntries(
      Object.entries(APPROVED_INTERFACE).map(([subpath, entry]) => [subpath, entry.target])
    ),
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

  it('declares exactly the approved exports map, with every target present', () => {
    const pkg = readManifest();
    assert.deepEqual(exportsMapProblems(pkg), [], 'the declared interface must be the approved one');

    for (const [subpath, entry] of Object.entries(APPROVED_INTERFACE)) {
      const resolved = path.resolve(CORE_ROOT, entry.target);
      assert.ok(resolved.startsWith(CORE_ROOT + path.sep),
        subpath + ' must stay inside the package, got ' + resolved);
      assert.ok(fs.existsSync(resolved), subpath + ' target is missing: ' + entry.target);
      assert.equal(pkg.exports[subpath].replace(/\\/g, '/'), entry.target,
        subpath + ' must map to its approved target');
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
