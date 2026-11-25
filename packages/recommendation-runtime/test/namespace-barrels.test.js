'use strict';

// packages/recommendation-runtime/test/namespace-barrels.test.js — the step 5
// W3 namespace barrels, and the proof that composing them is safe.
//
// W3 needed the candidate, filtering and scoring namespaces to resolve from the
// orchestrator at BOTH depths. The answer is one barrel per namespace in this
// package, with the old path an identity shim to it. Two of the three compose
// the pure core namespace with a SPREAD, so this file carries the proof the
// batch's review requires:
//
//   1. the core namespace is a plain object: no accessor (getter/setter) and no
//      non-enumerable or symbol member, so a spread copies every member and
//      cannot evaluate code or lose a hidden one (proved over the real
//      namespaces, and over a synthetic accessor to show the proof is not
//      vacuous);
//   2. the composed object's key set is EXACTLY the surface the old path
//      published - a committed, sorted array, so a new core export fails here
//      instead of appearing silently;
//   3. every member is the SAME VALUE through both paths, and every pure member
//      is the core's own function object - the composition adds no wrapper, so
//      a consumer (and the orchestrator's patch seam) cannot observe two
//      different modules.
//
// DB-free and dependency-free: loading the barrels executes no query.
//
//   npm run test:runtime        (from the repo root)

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const core = require('../src/core-entry');

const barrels = {
  candidates: {
    name: 'candidates',
    barrel: require('../src/candidates'),
    shim: require('../../../src/recommendation/candidates'),
    expected: [
      'COMPONENT_ROLES',
      'ROLE_ORDER',
      'SINGULAR_ROLES',
      'PRODUCT_CATEGORIES',
      'ROLE_CATEGORIES',
      'isValidComponentRole',
      'isValidProductCategory',
      'expectedCategoryForRole',
      'ERROR_CODES',
      'CandidateSelectionError',
      'createCandidateSelectionInput',
      'createCandidate',
      'loadCandidates',
      'SELECTION_STAGES',
      'IMPLEMENTED_STAGES',
      'selectCandidatePool',
      'compareCandidates',
    ],
  },
  filtering: {
    name: 'filtering',
    barrel: require('../src/filtering'),
    shim: require('../../../src/recommendation/filtering'),
    expected: [
      'loadFilteringContext',
      'CONTEXT_COMPAT_KEYS',
      'buildIntegratedGpuPresentMap',
      'filterCandidates',
      'CANDIDATE_STATUSES',
      'filterCandidatesForRecommendation',
    ],
  },
  scoring: {
    name: 'scoring',
    barrel: require('../src/scoring'),
    shim: require('../../../src/recommendation/scoring'),
    expected: [
      'loadScoringModel',
      'SELECT_SCORING_MODEL_SQL',
      'validateScoringModelConfiguration',
      'SCORING_MODEL_CONFIGURATION_KEYS',
      'OPTIONAL_CONFIGURATION_KEYS',
      'listUseCases',
      'validateUseCaseProfiles',
      'USE_CASE_PROFILES_KEY',
      'GPU_POLICIES',
      'loadComponentAssessments',
      'SELECT_COMPONENT_ASSESSMENTS_SQL',
      'selectAssessmentRow',
      'computeEffectiveScore',
      'computeCandidateScore',
      'computeCandidateScores',
      'computeBuildScore',
      'computeBuildScores',
      'computeBuildScoreContributions',
    ],
  },
};

/**
 * A namespace is spread-safe when every own property is an enumerable DATA
 * property: a spread would otherwise invoke a getter (code at copy time) or
 * silently drop a non-enumerable member.
 */
function spreadUnsafeMembers(namespace) {
  const unsafe = [];
  for (const key of Reflect.ownKeys(namespace)) {
    const descriptor = Object.getOwnPropertyDescriptor(namespace, key);
    if ('get' in descriptor || 'set' in descriptor) unsafe.push(String(key) + ': accessor');
    else if (descriptor.enumerable !== true) unsafe.push(String(key) + ': non-enumerable');
  }
  return unsafe;
}

describe('the core namespaces the W3 barrels spread are plain objects', () => {
  for (const name of ['candidates', 'filtering', 'scoring']) {
    it('core.' + name + ' has no accessor and no non-enumerable member', () => {
      const namespace = core[name];
      assert.equal(typeof namespace, 'object', 'core.' + name + ' must be an object');
      assert.notEqual(namespace, null);
      assert.deepEqual(spreadUnsafeMembers(namespace), []);
      // Object.keys must already see every own key, symbol keys aside: the
      // surface is string-keyed in this project, so a symbol would be a defect.
      assert.deepEqual(
        Object.keys(namespace).sort(),
        Reflect.ownKeys(namespace).map(String).sort(),
        'core.' + name + ' must expose no symbol-keyed member'
      );
    });
  }

  it('the proof is not vacuous: a synthetic accessor is reported', () => {
    const probe = {};
    Object.defineProperty(probe, 'hidden', { get() { return 1; }, enumerable: true });
    Object.defineProperty(probe, 'invisible', { value: 2, enumerable: false });
    assert.deepEqual(spreadUnsafeMembers(probe), ['hidden: accessor', 'invisible: non-enumerable']);
  });
});

describe('each W3 barrel publishes exactly the surface the old path published', () => {
  for (const [name, entry] of Object.entries(barrels)) {
    it(name + ': the old path is the SAME object as the new barrel', () => {
      // The identity is load-bearing: the orchestrator's documented patch seam
      // patches the object the OLD path resolves to, and the implementation
      // calls through the object the NEW path resolves to.
      assert.equal(entry.shim, entry.barrel);
    });

    it(name + ': the composed key set is exactly the committed list', () => {
      assert.deepEqual(Object.keys(entry.barrel).sort(), entry.expected.slice().sort());
      assert.equal(
        Object.keys(entry.barrel).length,
        entry.expected.length,
        name + ' must not repeat a key'
      );
    });
  }

  it('scoring: the published key ORDER is preserved (loaders in the middle)', () => {
    assert.deepEqual(Object.keys(barrels.scoring.barrel), barrels.scoring.expected);
  });
});

describe('the composition adds no wrapper: every member is the same function object', () => {
  it('candidates: pure members are core.candidates, the loader is ./loader', () => {
    const { loadCandidates } = require('../src/candidates/loader');
    for (const key of barrels.candidates.expected) {
      const expected = key === 'loadCandidates' ? loadCandidates : core.candidates[key];
      assert.equal(barrels.candidates.barrel[key], expected, 'candidates.' + key + ' is not the original');
      assert.equal(barrels.candidates.shim[key], expected, 'candidates.' + key + ' differs through the old path');
    }
  });

  it('filtering: pure members are core.filtering, the SQL members are their modules', () => {
    const contextLoader = require('../src/filtering/context-loader');
    const pipeline = require('../src/filtering/pipeline');
    const sources = {
      loadFilteringContext: contextLoader.loadFilteringContext,
      CONTEXT_COMPAT_KEYS: contextLoader.CONTEXT_COMPAT_KEYS,
      filterCandidatesForRecommendation: pipeline.filterCandidatesForRecommendation,
    };
    for (const key of barrels.filtering.expected) {
      const expected = Object.prototype.hasOwnProperty.call(sources, key)
        ? sources[key]
        : core.filtering[key];
      assert.equal(barrels.filtering.barrel[key], expected, 'filtering.' + key + ' is not the original');
    }
  });

  it('scoring: pure members are core.scoring, the loaders are their modules', () => {
    const modelLoader = require('../src/scoring/load-scoring-model');
    const assessmentLoader = require('../src/scoring/load-assessments');
    const sources = {
      loadScoringModel: modelLoader.loadScoringModel,
      SELECT_SCORING_MODEL_SQL: modelLoader.SELECT_SCORING_MODEL_SQL,
      loadComponentAssessments: assessmentLoader.loadComponentAssessments,
      SELECT_COMPONENT_ASSESSMENTS_SQL: assessmentLoader.SELECT_COMPONENT_ASSESSMENTS_SQL,
    };
    for (const key of barrels.scoring.expected) {
      const expected = Object.prototype.hasOwnProperty.call(sources, key)
        ? sources[key]
        : core.scoring[key];
      assert.equal(barrels.scoring.barrel[key], expected, 'scoring.' + key + ' is not the original');
    }
  });
});
