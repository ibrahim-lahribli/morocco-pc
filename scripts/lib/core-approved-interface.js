'use strict';

// scripts/lib/core-approved-interface.js - the ONE approved public interface
// of packages/recommendation-core, shared by the host-side gate
// (scripts/lib/core-package-surface.test.js) and the in-container gate
// (.github/workflows/api-image.yml).
//
// RFC §11.4 / decision A2 approves eleven subpaths. The manifest's `exports`
// map is compared as a WHOLE: a missing, additional or incorrectly mapped
// subpath is a failure, so `./package.json` and any convenience subpath are
// rejected by name rather than tolerated because their file exists. `./offers`
// is src/offers/as-of.js - there is no offers/index.js - so a rule that every
// namespace must have a barrel is wrong for this package.
//
// Containment is filesystem-real, not lexical: every target is realpath'd and
// must stay inside the realpath'd package root, so a symlink cannot smuggle a
// target outside. A nonexistent target fails closed.
//
// This file is not named *.test.js: it is a contract module, not a suite. It
// resolves no repository path at import time, so the container can require it
// from a read-only bind mount (scripts/ is excluded from the image).

const fs = require('node:fs');
const path = require('node:path');

// RFC §11.4, approved as written (A2). `requires` is the set of RFC-named
// exports for the subpath; an existing-but-empty module must fail.
const APPROVED_INTERFACE = {
  '.': {
    target: './src/index.js',
    namespace: null,
    requires: {
      functions: [],
      values: [
        'assembly',
        'candidates',
        'compatibility',
        'explanation',
        'filtering',
        'offers',
        'ranking',
        'retention',
        'scoring',
      ],
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

function approvedExportsMap() {
  return Object.fromEntries(
    Object.entries(APPROVED_INTERFACE).map(([subpath, entry]) => [subpath, entry.target])
  );
}

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
      problems.push(
        subpath + ' is mapped to ' + target + '; the approved target is ' + entry.target
      );
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

// Filesystem-real containment: exists (fail closed) -> realpath the root and
// the target (realpathSync, never .native: Windows returns a \\?\ prefix) ->
// the target must stay inside the package root -> it must be a regular file.
function targetProblems({ packageRoot, subpath, target }) {
  const problems = [];
  if (typeof target !== 'string' || !target.startsWith('./')) {
    problems.push(subpath + ' must use a relative ./ target, got ' + target);
    return problems;
  }

  const resolved = path.resolve(packageRoot, target);
  if (!fs.existsSync(resolved)) {
    problems.push(subpath + ' target is missing: ' + target);
    return problems;
  }

  let realRoot;
  let realTarget;
  try {
    realRoot = fs.realpathSync(packageRoot);
    realTarget = fs.realpathSync(resolved);
  } catch (err) {
    problems.push(subpath + ' target cannot be resolved: ' + target + ' (' + err.code + ')');
    return problems;
  }

  const relative = path.relative(realRoot, realTarget);
  if (
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative)
  ) {
    problems.push(subpath + ' target escapes the package: ' + target + ' -> ' + realTarget);
    return problems;
  }

  let stat;
  try {
    stat = fs.statSync(realTarget);
  } catch (err) {
    problems.push(subpath + ' target cannot be statted: ' + target + ' (' + err.code + ')');
    return problems;
  }
  if (!stat.isFile()) {
    problems.push(subpath + ' target is not a file: ' + target);
  }
  return problems;
}

function problemList(packageRoot, manifest) {
  const problems = exportsMapProblems(manifest);
  if (manifest && typeof manifest === 'object' && manifest.exports && typeof manifest.exports === 'object' && !Array.isArray(manifest.exports)) {
    for (const [subpath, entry] of Object.entries(APPROVED_INTERFACE)) {
      if (Object.prototype.hasOwnProperty.call(manifest.exports, subpath)) {
        problems.push(...targetProblems({ packageRoot, subpath, target: manifest.exports[subpath] }));
      }
    }
  }
  return problems;
}

// Zero-problem negative fixtures. Each tampered manifest must be rejected, or
// the gate itself is broken (fail closed, never pass because a file exists).
function negativeChecks(packageRoot, manifest) {
  const approved = approvedExportsMap();
  const expect = (label, problems, fragment) => {
    if (!problems.some((problem) => problem.includes(fragment))) {
      throw new Error(
        'core surface: negative check "' + label + '" was not rejected (' + JSON.stringify(problems) + ')'
      );
    }
  };

  const missing = { ...approved };
  delete missing['./assembly'];
  expect('missing ./assembly', exportsMapProblems({ ...manifest, exports: missing }),
    'missing approved subpath ./assembly');

  expect('additional ./package.json',
    exportsMapProblems({ ...manifest, exports: { ...approved, './package.json': './package.json' } }),
    'unauthorized subpath ./package.json');

  // The target exists and is a valid module, so a gate that only checks
  // existence would pass. The subpath itself is unauthorized.
  const existingValidTarget = path.resolve(packageRoot, APPROVED_INTERFACE['./errors'].target);
  if (!fs.existsSync(existingValidTarget)) {
    throw new Error('core surface: negative fixture target is missing: ' + existingValidTarget);
  }
  expect('unauthorized subpath to an existing file',
    exportsMapProblems({ ...manifest, exports: { ...approved, './internal': APPROVED_INTERFACE['./errors'].target } }),
    'unauthorized subpath ./internal');

  expect('incorrect mapping to an existing file',
    exportsMapProblems({ ...manifest, exports: { ...approved, './assembly': APPROVED_INTERFACE['./candidates'].target } }),
    './assembly is mapped to ' + APPROVED_INTERFACE['./candidates'].target);

  expect('conditional target',
    exportsMapProblems({ ...manifest, exports: { ...approved, './offers': { require: APPROVED_INTERFACE['./offers'].target } } }),
    './offers must map to one static target');

  const nonexistent = targetProblems({
    packageRoot,
    subpath: './does-not-exist',
    target: './src/does-not-exist.js',
  });
  expect('nonexistent target', nonexistent, 'target is missing');

  return 6;
}

// The gate the API image runs: validate the shipped manifest against the
// approved map, prove the entry/namespace identity, then prove the gate still
// rejects six tampered maps. Throws on the first problem; returns evidence.
function runContainerGate(packageRoot) {
  const manifestPath = path.join(packageRoot, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const problems = problemList(packageRoot, manifest);
  if (problems.length > 0) {
    throw new Error('core surface: ' + problems.join('; '));
  }

  const core = require(path.join(packageRoot, 'src'));
  const namespaces = Object.keys(core).sort();
  if (namespaces.length === 0) {
    throw new Error('core surface: the entry point publishes nothing');
  }

  for (const name of namespaces) {
    const value = core[name];
    if (value === null || typeof value !== 'object') {
      throw new Error('core surface: ' + name + ' is not a namespace object');
    }
    const subpath = './' + name;
    if (!Object.prototype.hasOwnProperty.call(APPROVED_INTERFACE, subpath)) {
      throw new Error('core surface: ' + name + ' is published without an approved subpath');
    }
    const target = manifest.exports[subpath];
    if (typeof target !== 'string') {
      throw new Error('core surface: ' + name + ' has no declared subpath');
    }
    if (require(path.resolve(packageRoot, target)) !== value) {
      throw new Error('core surface: ' + name + ' is not the module its subpath declares');
    }
  }

  for (const [subpath, entry] of Object.entries(APPROVED_INTERFACE)) {
    if (entry.namespace !== null && !namespaces.includes(entry.namespace)) {
      throw new Error('core surface: ' + subpath + ' is declared but ' + entry.namespace + ' is not published');
    }
  }

  const rootProblems = namespaceProblems('root', core, APPROVED_INTERFACE['.'].requires);
  if (rootProblems.length > 0) {
    throw new Error('core surface: ' + rootProblems.join('; '));
  }

  for (const [subpath, entry] of Object.entries(APPROVED_INTERFACE)) {
    if (subpath === '.') continue;
    const loaded = require(path.resolve(packageRoot, entry.target));
    const shape = namespaceProblems(subpath, loaded, entry.requires);
    if (shape.length > 0) {
      throw new Error('core surface: ' + shape.join('; '));
    }
  }

  const negatives = negativeChecks(packageRoot, manifest);
  return { namespaces, negatives };
}

module.exports = {
  APPROVED_INTERFACE,
  APPROVED_NAMESPACES,
  approvedExportsMap,
  exportsMapProblems,
  namespaceProblems,
  targetProblems,
  runContainerGate,
};
