'use strict';

/**
 * apps/api/src/server.js - the process entry point.
 *
 * Boundary: environment -> pool -> app -> listen -> graceful shutdown. It is
 * the ONLY file in the API that reads `process.env` for connection settings and
 * the only one that starts a listener; everything it wires is injectable, so
 * the rest of the API is testable without a process.
 *
 * The pool is built first, OUTSIDE the try/catch that reports a listen failure,
 * because `createPool` is where the write-target guard lives: starting against
 * a target that is not provably the isolated TEST branch must fail before a
 * single connection is opened. Its message never contains a URL or a host
 * (see scripts/lib/db-url.js), which is what makes it safe to print.
 *
 * Logging: JSON to stdout via pino by default; `LOG_PRETTY=1` switches to
 * pino-pretty, which is a devDependency - the require is wrapped so a
 * production install (`npm ci --omit=dev`) simply logs JSON instead of
 * crashing. Request bodies are never logged.
 */

require('dotenv').config();

const { createPool } = require('./db');
const { buildApp } = require('./app');
const repository = require('./repository');
const engine = require('./engine');

/** pino options for the current environment. Never logs a body or a URL. */
function buildLoggerOptions(env) {
  const level = env.LOG_LEVEL || 'info';
  if (env.LOG_PRETTY === '1') {
    try {
      require('pino-pretty');
      return {
        level,
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'SYS:standard', ignore: 'pid,hostname' },
        },
      };
    } catch (_error) {
      // Dev-only prettifier is absent (production install): JSON logs are fine.
    }
  }
  return { level };
}

async function start(env) {
  const source = env || process.env;
  const pool = createPool(source);
  const app = buildApp({
    pool,
    repository,
    engine,
    env: source,
    logger: buildLoggerOptions(source),
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
    } finally {
      await pool.end();
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  const port = Number(source.PORT) || 3000;
  const host = source.HOST || '0.0.0.0';
  await app.listen({ port, host });
  app.log.info({ port, host }, 'morocco-pc API listening');
  return app;
}

if (require.main === module) {
  start().then(
    () => {},
    (error) => {
      // The guard messages in db.js / db-url.js are deliberately URL-free.
      console.error('FATAL: ' + (error && error.message ? error.message : String(error)));
      process.exit(1);
    }
  );
}

module.exports = { start, buildLoggerOptions };
