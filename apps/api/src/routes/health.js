'use strict';

/**
 * apps/api/src/routes/health.js - GET /v1/health.
 *
 * Liveness and database reachability in one payload. Always 200 when the
 * process can answer: a health endpoint that 500s during a database outage
 * cannot be used to tell "the app is broken" from "the database is broken".
 * No secrets, no database version, no connection string - the host is not even
 * read.
 */

const { ping, PING_TIMEOUT_MS } = require('../db');
const { HealthResponseSchema, ErrorResponseSchema } = require('../contracts');

const HEALTH_RATE_LIMIT = Object.freeze({ max: 120, timeWindow: '1 minute' });

function registerHealthRoutes(app) {
  app.get('/v1/health', {
    config: { rateLimit: HEALTH_RATE_LIMIT },
    schema: {
      tags: ['ops'],
      summary: 'Liveness plus database reachability',
      // 429 and 500 are declared on every route: the rate limiter and the generic
      // error handler apply to all of them, and the contract-completeness gate
      // (apps/api/test/unit/openapi-coverage.test.js) fails on an undeclared one.
      response: { 200: HealthResponseSchema, 429: ErrorResponseSchema, 500: ErrorResponseSchema },
    },
  }, async (_request, reply) => {
    const db = app.pool ? await ping(app.pool, PING_TIMEOUT_MS) : 'down';
    return reply.code(200).send({
      status: 'ok',
      db,
      engine_version: app.engineVersion,
    });
  });
}

module.exports = { registerHealthRoutes, HEALTH_RATE_LIMIT };
