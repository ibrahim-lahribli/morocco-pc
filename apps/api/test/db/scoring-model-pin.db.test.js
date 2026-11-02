'use strict';

/**
 * apps/api/test/db/scoring-model-pin.db.test.js - `SCORING_MODEL_PIN` against a
 * REAL `scoring_model` table (Decision 62).
 *
 * TEST BRANCH ONLY. `resolveTestDbUrl` runs at module scope and throws when
 * TEST_DATABASE_URL is absent or points at the shared endpoint, so a missing
 * environment fails the file loudly instead of skipping it.
 *
 * READ-ONLY BY CONSTRUCTION: one SELECT to learn which rows exist, then calls to
 * `repository.selectActiveScoringModel` - which is SELECT-only. Nothing is
 * inserted, so there is no cleanup and no residue assertion; the write suites own
 * those, and a whole-table comparison here would measure THEIR work.
 *
 * What only a real database can prove:
 *
 *   1. A pin resolves THAT row. The unit suite pins the statement's shape against
 *      a fake db, which cannot show that the parameters land on the intended row
 *      of a table holding seven models, six of them ACTIVE.
 *   2. The pin and the implicit rule really do disagree here, which is the whole
 *      reason the setting exists: with no pin the API answers the NEWEST active
 *      row (`created_at DESC, id ASC`), so pinning the OLDEST active one returns
 *      a different model from the same table in the same moment. Measured
 *      2026-11-01: applying a seed moved what the deployed origin served with no
 *      deploy and no error (OG-54 / Decision 57's amendment).
 *   3. An INACTIVE row's pin is REFUSED, never activated (Decision 11).
 *      `seed-minimal-v1@1.0.0` is INACTIVE on this branch, so that hazard is live
 *      data rather than a hypothetical.
 *
 * A skip is possible in principle (the inactive half needs an inactive row) and
 * is reported as a skip, never as a pass.
 */

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

const { resolveTestDbUrl } = require('../../../../scripts/lib/db-url');
const repository = require('../../src/repository');
const { STATEMENT_TIMEOUT_MS } = require('../../src/db');

// Module scope on purpose: an unusable environment fails the file, not a test.
const POOL_CONFIG = resolveTestDbUrl(process.env);

function createPool() {
  return new Pool({
    connectionString: POOL_CONFIG.connectionString,
    connectionTimeoutMillis: POOL_CONFIG.connectionTimeoutMillis,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    application_name: 'morocco-pc-model-pin-test',
  });
}

/**
 * Every model, in the order the API's implicit rule reads them
 * (`SELECT_ACTIVE_SCORING_MODEL_SQL`), so "newest" and "oldest" mean exactly what
 * the served rule means.
 */
async function modelRows(db) {
  const result = await db.query(
    'SELECT id, name, version, is_active FROM scoring_model'
    + ' ORDER BY created_at DESC, id ASC'
  );
  return result.rows;
}

/** `name@version` - the pin grammar, built from a row rather than hand-typed. */
function pinOf(row) {
  return row.name + '@' + row.version;
}

test('a pin resolves THAT active row, not merely the newest one', async () => {
  const pool = createPool();
  try {
    const rows = await modelRows(pool);
    const active = rows.filter((row) => row.is_active === true);
    assert.ok(active.length > 0, 'the TEST branch must hold an ACTIVE scoring model');

    const oldest = active[active.length - 1];
    const model = await repository.selectActiveScoringModel(pool, pinOf(oldest));

    assert.equal(model.id, oldest.id, 'the pin must select the row it names');
    assert.ok(model.configuration !== null && typeof model.configuration === 'object',
      'the served model carries its configuration');
  } finally {
    await pool.end();
  }
});

test('the pin and the implicit newest-row rule disagree on this database', async () => {
  const pool = createPool();
  try {
    const rows = await modelRows(pool);
    const active = rows.filter((row) => row.is_active === true);
    assert.ok(active.length > 1,
      'this suite rests on the TEST branch holding MORE THAN ONE active model; '
      + 'with one row the two rules cannot differ and nothing below would prove anything');

    const newest = active[0];
    const oldest = active[active.length - 1];

    const unpinned = await repository.selectActiveScoringModel(pool, null);
    assert.equal(unpinned.id, newest.id, 'unset keeps the pre-existing newest-active-row rule');

    const pinned = await repository.selectActiveScoringModel(pool, pinOf(oldest));
    assert.notEqual(pinned.id, unpinned.id,
      'the pin must be able to serve a DIFFERENT model than the implicit rule');
  } finally {
    await pool.end();
  }
});

test('a pin matching no row is SCORING_MODEL_UNAVAILABLE, never the newest row', async () => {
  const pool = createPool();
  try {
    await assert.rejects(
      () => repository.selectActiveScoringModel(pool, 'no-such-model@0.0.0'),
      (error) => error.code === 'SCORING_MODEL_UNAVAILABLE'
    );
  } finally {
    await pool.end();
  }
});

test('a pin naming an INACTIVE row is refused, never activated', async (t) => {
  const pool = createPool();
  try {
    const rows = await modelRows(pool);
    const inactive = rows.filter((row) => row.is_active !== true);
    if (inactive.length === 0) {
      t.skip('no INACTIVE scoring_model row on this branch to pin');
      return;
    }

    await assert.rejects(
      () => repository.selectActiveScoringModel(pool, pinOf(inactive[0])),
      (error) => error.code === 'SCORING_MODEL_UNAVAILABLE' && /no ACTIVE row/.test(error.message),
      'an inactive pin must be a refusal, not a silent activation (Decision 11)'
    );
  } finally {
    await pool.end();
  }
});
