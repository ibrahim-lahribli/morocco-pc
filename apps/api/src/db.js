'use strict';

/**
 * apps/api/src/db.js - the API's ONE pg Pool, and the shared DB defaults.
 *
 * Boundary: connection lifecycle and transaction plumbing only. No SQL that
 * belongs to a feature (that is repository.js), no engine import, no route.
 *
 * The write-target guard (Decision 36 item 1): the shared Neon database is NOT
 * disposable, and every POST writes Layer 4 rows, so the API is write-capable
 * by construction. It therefore starts against the isolated TEST branch and
 * REFUSES to start at all unless the operator explicitly opts in with
 * API_ALLOW_SHARED=1. The check reuses `scripts/lib/db-url.js` `resolveTestDbUrl`
 * - the same guard every write-capable script uses - rather than re-implementing
 * host comparison, so "TEST_DATABASE_URL must not target the shared database"
 * has exactly one owner.
 *
 * Defaults: statement_timeout is set so a pathological query cannot pin a
 * connection forever, and every connection is tagged with an application_name
 * so a DBA can see who is connected. Nothing here reads the clock or the
 * environment for anything but the explicit `env` argument it is given, so the
 * module is testable without a live database.
 */

const { Pool } = require('pg');
const { resolveTestDbUrl } = require('../../../scripts/lib/db-url');

/** Server-side cap on any single statement this API issues. */
const STATEMENT_TIMEOUT_MS = 10000;
/** TCP/connection-establishment cap, matching the scripts convention. */
const CONNECTION_TIMEOUT_MS = 15000;
/** /v1/health's own timeout for the liveness probe. */
const PING_TIMEOUT_MS = 2000;
/** Visible in pg_stat_activity, so connections are attributable. */
const APPLICATION_NAME = 'morocco-pc-api';

/**
 * Resolve the pool configuration, failing closed on a write-capable start
 * against the shared database.
 *
 * API_ALLOW_SHARED=1 is the explicit, documented opt-in; anything else routes
 * through `resolveTestDbUrl`, which throws when TEST_DATABASE_URL is absent,
 * unparseable, or targets the same endpoint as DATABASE_URL.
 *
 * @param {object} env environment-like object (never read from process.env here)
 * @returns {object} pg PoolConfig
 * @throws {Error} when the target is not provably the isolated TEST branch
 */
function resolvePoolConfig(env) {
  const source = env || {};

  if (source.API_ALLOW_SHARED === '1') {
    if (typeof source.DATABASE_URL !== 'string' || source.DATABASE_URL.trim() === '') {
      throw new Error('API_ALLOW_SHARED=1 requires DATABASE_URL to be set');
    }
    return {
      connectionString: source.DATABASE_URL,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      statement_timeout: STATEMENT_TIMEOUT_MS,
      application_name: APPLICATION_NAME,
    };
  }

  const testConfig = resolveTestDbUrl(source);
  return {
    connectionString: testConfig.connectionString,
    connectionTimeoutMillis: testConfig.connectionTimeoutMillis,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    application_name: APPLICATION_NAME,
  };
}

/** Build the process-wide Pool. Nothing connects until the first query. */
function createPool(env) {
  return new Pool(resolvePoolConfig(env));
}

/**
 * Run `work(client)` inside one BEGIN/COMMIT on a dedicated client.
 *
 * The API owns exactly two transactions of its own: the profile+query insert
 * (here), and nothing else - the engine's read snapshot and write commit are
 * owned by the orchestrator wrappers and must never be nested inside this one
 * (an inner COMMIT would end the outer transaction). The ROLLBACK failure is
 * deliberately swallowed so the CAUSE is never masked by the cleanup.
 *
 * @param {object} client a single dedicated connection (a checked-out
 *        PoolClient), never the Pool itself
 * @param {Function} work async (client) => value
 * @returns {Promise<*>} whatever `work` returned
 */
async function withTransaction(client, work) {
  await client.query('BEGIN');
  let value;
  try {
    value = await work(client);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_rollbackError) {
      // The original error is the one worth reporting.
    }
    throw error;
  }
  await client.query('COMMIT');
  return value;
}

/**
 * Liveness probe for /v1/health: 'ok' when `SELECT 1` answers inside the
 * timeout, 'down' otherwise. Never throws, never returns the error, never
 * echoes a connection string.
 */
async function ping(pool, timeoutMs) {
  const limit = Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : PING_TIMEOUT_MS;
  let timer = null;
  try {
    await Promise.race([
      pool.query('SELECT 1 AS ok'),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('database ping timed out')), limit);
        if (timer && typeof timer.unref === 'function') {
          timer.unref();
        }
      }),
    ]);
    return 'ok';
  } catch (_error) {
    return 'down';
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

module.exports = {
  STATEMENT_TIMEOUT_MS,
  CONNECTION_TIMEOUT_MS,
  PING_TIMEOUT_MS,
  APPLICATION_NAME,
  resolvePoolConfig,
  createPool,
  withTransaction,
  ping,
};
