'use strict';

// scripts/lib/harness-orphans.test.js - DB-free tests for the E0e marker and
// orphan-selection logic. node:test + node:assert/strict only, no connection.
//   node --test scripts/lib/harness-orphans.test.js
// (also picked up by `npm run test:scripts`).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  HARNESS_PROFILE_PREFIX,
  harnessProfileName,
  isHarnessProfileName,
  partitionProfiles,
  harnessProfileIds,
  classifyQueries,
  orphanQueryIds,
} = require('./harness-orphans');

const P1 = 'profile-harness-1';
const P2 = 'profile-harness-2';
const FOREIGN = 'profile-api-1';

describe('harnessProfileName', () => {
  it('prefixes the run id', () => {
    assert.equal(harnessProfileName('20261008T211359Z-1234'), 'golden-eval-20261008T211359Z-1234');
  });

  it('rejects an empty or missing run id', () => {
    assert.throws(() => harnessProfileName(''), /non-empty run id/);
    assert.throws(() => harnessProfileName('   '), /non-empty run id/);
    assert.throws(() => harnessProfileName(undefined), /non-empty run id/);
  });
});

describe('isHarnessProfileName', () => {
  it('accepts only names with a non-empty suffix after the prefix', () => {
    assert.equal(isHarnessProfileName('golden-eval-abc'), true);
    assert.equal(isHarnessProfileName(HARNESS_PROFILE_PREFIX), false, 'bare prefix is not a marker');
    assert.equal(isHarnessProfileName('golden-eval'), false);
    assert.equal(isHarnessProfileName('api-profile'), false);
    assert.equal(isHarnessProfileName(''), false);
    assert.equal(isHarnessProfileName(null), false);
    assert.equal(isHarnessProfileName(undefined), false);
  });

  it('is case-sensitive: a differently-cased name is NOT a marker', () => {
    assert.equal(isHarnessProfileName('Golden-Eval-abc'), false);
    assert.equal(isHarnessProfileName('GOLDEN-EVAL-abc'), false);
  });
});

describe('partitionProfiles / harnessProfileIds', () => {
  const profiles = [
    { id: P1, name: 'golden-eval-run-a' },
    { id: 'profile-foreign', name: 'api-game-1080p' },
    { id: P2, name: 'golden-eval-run-b' },
    { id: 'profile-nullname', name: null },
  ];

  it('separates harness-owned from foreign profiles', () => {
    const { harness, foreign } = partitionProfiles(profiles);
    assert.deepEqual(harness.map((r) => r.id), [P1, P2]);
    assert.deepEqual(foreign.map((r) => r.id), ['profile-foreign', 'profile-nullname']);
  });

  it('returns only harness profile ids as delete targets', () => {
    assert.deepEqual(harnessProfileIds(profiles), [P1, P2]);
  });

  it('is empty for an empty or malformed input', () => {
    assert.deepEqual(harnessProfileIds([]), []);
    assert.deepEqual(harnessProfileIds([{ id: 'x' }]), []);
  });
});

describe('classifyQueries / orphanQueryIds', () => {
  const queries = [
    { id: 'q-marked-1', recommendation_profile_id: P1 },
    { id: 'q-unmarked-null', recommendation_profile_id: null },
    { id: 'q-foreign', recommendation_profile_id: FOREIGN },
    { id: 'q-marked-2', recommendation_profile_id: P2 },
    { id: 'q-unknown', recommendation_profile_id: 'profile-does-not-exist' },
  ];
  const owned = [P1, P2];

  it('marks only rows whose profile is a harness-owned id', () => {
    const { marked, unmarked } = classifyQueries(queries, owned);
    assert.deepEqual(marked.map((r) => r.id), ['q-marked-1', 'q-marked-2']);
    assert.deepEqual(unmarked.map((r) => r.id), ['q-unmarked-null', 'q-foreign', 'q-unknown']);
  });

  it('never selects an unmarked row, even when no profile is owned', () => {
    assert.deepEqual(orphanQueryIds(queries, []), []);
    const { unmarked } = classifyQueries(queries, []);
    assert.equal(unmarked.length, queries.length);
  });

  it('deletes nothing when the only rows are foreign or NULL-profiled', () => {
    const onlyForeign = [
      { id: 'a', recommendation_profile_id: null },
      { id: 'b', recommendation_profile_id: FOREIGN },
    ];
    assert.deepEqual(orphanQueryIds(onlyForeign, owned), []);
  });

  it('tolerates an undefined profile id and an empty query list', () => {
    assert.deepEqual(orphanQueryIds([{ id: 'x' }], owned), []);
    assert.deepEqual(orphanQueryIds([], owned), []);
  });

  it('compares ids as strings so uuid/string round-trips still match', () => {
    const { marked } = classifyQueries([{ id: 'q', recommendation_profile_id: 12345 }], ['12345']);
    assert.equal(marked.length, 1);
  });
});
