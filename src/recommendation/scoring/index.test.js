'use strict';

// ---------------------------------------------------------------------------
// Scoring model (Decision 11): focused barrel-contract test for the public API.
//
// This file proves ONLY the boundary decision: scoring/index.js is the
// canonical public surface and re-exports the loader and the pure
// configuration validator by identity without duplicating logic. Loader
// behavior and configuration rules are NOT re-tested here (see
// load-scoring-model.test.js and configuration.test.js).
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');

const scoring = require('./index');
const loader = require('./load-scoring-model');
const configuration = require('./configuration');
const assessments = require('./load-assessments');
const effective = require('./effective-score');
const candidate = require('./candidate-score');
const build = require('./build-score');

test('scoring barrel exposes exactly the twelve-export public API', () => {
  assert.deepEqual(Object.keys(scoring), [
    'loadScoringModel',
    'SELECT_SCORING_MODEL_SQL',
    'validateScoringModelConfiguration',
    'SCORING_MODEL_CONFIGURATION_KEYS',
    'loadComponentAssessments',
    'SELECT_COMPONENT_ASSESSMENTS_SQL',
    'selectAssessmentRow',
    'computeEffectiveScore',
    'computeCandidateScore',
    'computeCandidateScores',
    'computeBuildScore',
    'computeBuildScores',
  ]);
});

test('scoring barrel re-exports every export by identity - no wrapper, no copy', () => {
  assert.strictEqual(scoring.loadScoringModel, loader.loadScoringModel);
  assert.strictEqual(scoring.SELECT_SCORING_MODEL_SQL, loader.SELECT_SCORING_MODEL_SQL);
  assert.strictEqual(
    scoring.validateScoringModelConfiguration,
    configuration.validateScoringModelConfiguration
  );
  assert.strictEqual(
    scoring.SCORING_MODEL_CONFIGURATION_KEYS,
    configuration.SCORING_MODEL_CONFIGURATION_KEYS
  );
  // Engine 4 (Decision 13 STEP 1-3).
  assert.strictEqual(scoring.loadComponentAssessments, assessments.loadComponentAssessments);
  assert.strictEqual(scoring.SELECT_COMPONENT_ASSESSMENTS_SQL, assessments.SELECT_COMPONENT_ASSESSMENTS_SQL);
  assert.strictEqual(scoring.selectAssessmentRow, effective.selectAssessmentRow);
  assert.strictEqual(scoring.computeEffectiveScore, effective.computeEffectiveScore);
  assert.strictEqual(scoring.computeCandidateScore, candidate.computeCandidateScore);
  assert.strictEqual(scoring.computeCandidateScores, candidate.computeCandidateScores);
  assert.strictEqual(scoring.computeBuildScore, build.computeBuildScore);
  assert.strictEqual(scoring.computeBuildScores, build.computeBuildScores);
});

test('scoring barrel adds no logic of its own', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  assert.ok(source.includes('loadScoringModel'));
  assert.ok(source.includes('validateScoringModelConfiguration'));
  const banned = [
    'async',
    'function load',
    'function validate',
    '.query(',
    "require('pg')",
  ];
  for (const token of banned) {
    assert.ok(!source.includes(token), `scoring/index.js must not contain ${token}`);
  }
});