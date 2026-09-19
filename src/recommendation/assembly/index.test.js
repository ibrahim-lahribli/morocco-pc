'use strict';

// ---------------------------------------------------------------------------
// Engine 3 Step 7: focused barrel-contract test for the assembly public API.
//
// This file proves ONLY the Step 7 boundary decision: assembly/index.js is the
// canonical public surface and re-exports the Step 1-4 modules plus the
// GPU-input loading / assembly entry point by identity without duplicating
// logic. Input contract fields, price carrier rules, GPU policy branches, DFS
// expansion behavior, GPU-input loading and pipeline composition are NOT
// re-tested here (see input.test.js, prices.test.js, gpu-policy.test.js,
// assemble.test.js, gpu-input.test.js and pipeline.test.js).
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');

const assembly = require('./index');
const input = require('./input');
const prices = require('./prices');
const gpuPolicy = require('./gpu-policy');
const assemble = require('./assemble');
const gpuInput = require('./gpu-input');
const pipeline = require('./pipeline');

test('assembly barrel exposes exactly the nine-export public API, in order', () => {
  // The nine expected exports exist - and only those nine, in this order.
  // The Step 1-4 exports keep their original positions; GPU-input loading and
  // the assembly entry point are appended.
  assert.deepEqual(Object.keys(assembly), [
    'validateEngine3Input',
    'priceKey',
    'validatePrices',
    'lookupPrice',
    'resolveGpuRequirement',
    'assembleBuilds',
    'EXPANSION_ORDER',
    'buildGpuInputs',
    'assembleBuildsForRecommendation',
  ]);
});

test('assembly barrel re-exports every export by identity - no wrapper, no copy', () => {
  // Step 1 input contract.
  assert.strictEqual(assembly.validateEngine3Input, input.validateEngine3Input);

  // Step 2 price carrier.
  assert.strictEqual(assembly.priceKey, prices.priceKey);
  assert.strictEqual(assembly.validatePrices, prices.validatePrices);
  assert.strictEqual(assembly.lookupPrice, prices.lookupPrice);

  // Step 3 GPU requirement policy.
  assert.strictEqual(assembly.resolveGpuRequirement, gpuPolicy.resolveGpuRequirement);

  // Step 4 build assembly.
  assert.strictEqual(assembly.assembleBuilds, assemble.assembleBuilds);
  assert.strictEqual(assembly.EXPANSION_ORDER, assemble.EXPANSION_ORDER);

  // GPU-input loading (Step 3 inputs) - by identity, no wrapper, no copy.
  assert.strictEqual(assembly.buildGpuInputs, gpuInput.buildGpuInputs);

  // Assembly entry point (Steps 1-4 composed) - by identity, no wrapper, no copy.
  assert.strictEqual(
    assembly.assembleBuildsForRecommendation,
    pipeline.assembleBuildsForRecommendation
  );
});
