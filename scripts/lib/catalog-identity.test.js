'use strict';

/**
 * scripts/lib/catalog-identity.test.js - the PURE half of the catalogue-identity
 * gate (`scripts/check-catalog-identity.js`, OG-60).
 *
 * The four questions these tests answer, and why each is not obvious:
 *
 *   1. What does an EMPTY catalogue say? Not PASS. A gate that has checked
 *      nothing must not read as "identity verified" - that is the same class of
 *      error as a freshness gate printing PASS over zero offers.
 *   2. Is ONE missing column enough to fail? Migration 020's served field is
 *      `slug`, and a NULL `display_name` still leaks the `Seed ` prefix into a
 *      client. Either column alone is a defect, and the report must name WHICH
 *      one so the repair is obvious.
 *   3. Does the count survive a truncated report? A broken catalogue can hold
 *      thousands of rows; printing all of them makes the nightly log unreadable
 *      and printing only the sample makes the damage look small.
 *   4. Is the order deterministic? Code-unit on `id`, never `localeCompare` - a
 *      locale-dependent order would make two runs of the same data report
 *      different lines (AGENTS.md section 5).
 */

const test = require('node:test');
const assert = require('node:assert');

const identity = require('./catalog-identity');

test('an EMPTY scope is INCONCLUSIVE, never PASS', () => {
  const result = identity.evaluateCatalogIdentity({ scopeSize: 0, rows: [] });
  assert.equal(result.verdict, identity.VERDICTS.INCONCLUSIVE);
  assert.equal(identity.verdictExitCode(result.verdict), 0);
});

test('a fully identified ACTIVE catalogue is PASS with no offenders', () => {
  const rows = [{ id: 'p1', name: 'A', slug: 'a', display_name: 'A' }];
  const result = identity.evaluateCatalogIdentity({ scopeSize: 1, rows });
  assert.equal(result.verdict, identity.VERDICTS.PASS);
  assert.equal(result.offenderCount, 0);
  assert.equal(identity.verdictExitCode(result.verdict), 0);
});

test('a row missing BOTH columns is a FAIL naming both, in fixed order', () => {
  const rows = [{ id: 'p1', name: 'A', slug: null, display_name: null }];
  const result = identity.evaluateCatalogIdentity({ scopeSize: 1, rows });
  assert.equal(result.verdict, identity.VERDICTS.FAIL);
  assert.equal(identity.verdictExitCode(result.verdict), 1);
  assert.deepEqual(result.offenders[0].missing, ['slug', 'display_name']);
});

test('either column alone is enough to fail, and the missing one is named', () => {
  assert.deepEqual(
    identity.missingIdentityColumns({ slug: null, display_name: 'X' }), ['slug']
  );
  assert.deepEqual(
    identity.missingIdentityColumns({ slug: 'x', display_name: null }), ['display_name']
  );
  assert.deepEqual(
    identity.missingIdentityColumns({ slug: 'x', display_name: 'X' }), []
  );
});

test('offenders are ordered by id code-unit, not locale', () => {
  const rows = [
    { id: 'b', name: 'b', slug: null, display_name: null },
    { id: 'A', name: 'A', slug: null, display_name: null },
    { id: '_z', name: 'z', slug: null, display_name: null },
    { id: 'a', name: 'a', slug: null, display_name: null },
  ];
  const result = identity.evaluateCatalogIdentity({ scopeSize: 4, rows });
  assert.deepEqual(result.offenders.map((o) => o.id), ['A', '_z', 'a', 'b']);
});

test('the report counts every offender but prints at most maxExamples', () => {
  const rows = [];
  for (let i = 0; i < 25; i += 1) {
    rows.push({ id: 'p' + String(i).padStart(2, '0'), name: 'n' + i, slug: null, display_name: null });
  }
  const result = identity.evaluateCatalogIdentity({ scopeSize: 25, rows });
  assert.equal(result.offenderCount, 25);
  const lines = identity.formatReport(result, 20);
  assert.match(lines[0], /FAIL/);
  assert.match(lines[0], /25/);
  assert.equal(lines.filter((l) => l.startsWith('  ')).length, 20);
});
