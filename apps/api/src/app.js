'use strict';

/**
 * apps/api/src/app.js - the Fastify instance, wired but not listening.
 *
 * Boundary: composition only. It owns the server-wide policy (body limit,
 * CORS, rate limiting, the OpenAPI document, the error envelope) and hands the
 * routes their collaborators by DECORATION - `repo`, `engine`, `pool`,
 * `engineVersion` - which is what makes the whole API testable with
 * `fastify.inject` and stubs, with no database and no network.
 *
 * Deliberate choices:
 *   - `bodyLimit: 10 KB`. Every accepted body is five short scalars; 10 KB is
 *     already generous, and it bounds what an unauthenticated caller can make
 *     the process buffer.
 *   - `ajv.removeAdditional: false` + `additionalProperties: false` on the body
 *     schema means an UNKNOWN field is a 422, not a silently dropped typo.
 *     `coerceTypes: false` keeps `budget_amount: "20000"` out: the engine's
 *     loader accepts only a finite number here, so the API says so at the edge.
 *   - Rate limits are per route (`config.rateLimit`), registered with
 *     `global: false`: a GET is cheap and a POST runs a whole engine pass, so
 *     they must not share a budget. 30/min on POST, 120/min on GET.
 *   - Routes are registered INSIDE a plugin so they are added after
 *     `@fastify/rate-limit` and `@fastify/swagger` have loaded - both attach
 *     `onRoute` hooks, and a route added before them would be invisible to
 *     both.
 */

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const rateLimit = require('@fastify/rate-limit');
const swagger = require('@fastify/swagger');

const { registerHealthRoutes } = require('./routes/health');
const { registerMetaRoutes } = require('./routes/meta');
const { registerRecommendationRoutes } = require('./routes/recommendations');
const { registerDocsRoutes } = require('./routes/docs');

/** The whole request body is five scalars; see the header. */
const BODY_LIMIT_BYTES = 10 * 1024;

/**
 * `ALLOWED_ORIGINS` is a comma-separated list. Unset/empty disables CORS
 * entirely (no `Access-Control-Allow-Origin` header at all) rather than
 * reflecting any origin - the safe default for a beta with no frontend
 * deployed yet.
 */
function parseOrigins(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/** ajv errors -> the `details` array of the error envelope. */
function validationDetails(error) {
  const items = Array.isArray(error.validation) ? error.validation : [];
  return items.map((item) => {
    const path = typeof item.instancePath === 'string' ? item.instancePath : '';
    // A required-property violation and an additional-property violation both
    // report an empty instancePath, so the offending name comes from `params`.
    const params = item.params || {};
    const named = typeof params.missingProperty === 'string' && params.missingProperty.length > 0
      ? params.missingProperty
      : (typeof params.additionalProperty === 'string' ? params.additionalProperty : '');
    return {
      field: path.length > 0 ? path.replace(/^\//, '').replace(/\//g, '.') : named,
      message: typeof item.message === 'string' ? item.message : 'invalid value',
    };
  });
}

function buildApp(options) {
  const opts = options || {};
  const env = opts.env || process.env;

  const app = Fastify({
    logger: opts.logger === undefined ? false : opts.logger,
    bodyLimit: BODY_LIMIT_BYTES,
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
      },
    },
  });

  // Injected collaborators. `pool` may be null in a unit test; nothing else may.
  app.decorate('repo', opts.repository);
  app.decorate('engine', opts.engine);
  app.decorate('pool', opts.pool === undefined ? null : opts.pool);
  app.decorate('engineVersion', opts.engineVersion || env.ENGINE_VERSION || 'dev');

  const origins = parseOrigins(env.ALLOWED_ORIGINS);
  app.register(cors, { origin: origins.length > 0 ? origins : false });
  app.register(rateLimit, { global: false });
  app.register(swagger, {
    openapi: {
      info: {
        title: 'morocco-pc API',
        description: 'Recommendation API over the morocco-pc engine. Prices are indicative.',
        version: '1.0.0',
      },
    },
  });

  app.setErrorHandler((error, request, reply) => {
    if (error && error.validation) {
      return reply.code(422).send({
        error: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: validationDetails(error),
      });
    }
    if (error && (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || error.statusCode === 413)) {
      return reply.code(413).send({
        error: 'PAYLOAD_TOO_LARGE',
        message: 'Request body exceeds the maximum allowed size',
      });
    }
    if (error && error.code === 'SCORING_MODEL_UNAVAILABLE') {
      return reply.code(503).send({
        error: 'SCORING_MODEL_UNAVAILABLE',
        message: 'No active scoring model is configured',
      });
    }
    // A plugin (rate limiting) that signals a client error by THROWING an error
    // carrying a 4xx statusCode would otherwise be flattened into a 500 here.
    // Honor the status, but keep the message ours.
    if (error && error.statusCode === 429) {
      return reply.code(429).send({
        error: 'RATE_LIMITED',
        message: 'Too many requests',
      });
    }
    // Unexpected: log the detail, return a generic body plus the request id.
    // Never echo the error message - it can carry a SQL fragment or a host.
    request.log.error({ err: error }, 'unhandled request error');
    return reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: 'Internal server error',
      request_id: String(request.id),
    });
  });

  // Registered as a plugin so these routes are added after the plugins above
  // have attached their onRoute hooks (see the header).
  app.register(async (instance) => {
    registerHealthRoutes(instance);
    registerMetaRoutes(instance);
    registerRecommendationRoutes(instance);
    registerDocsRoutes(instance);
  });

  return app;
}

module.exports = { buildApp, BODY_LIMIT_BYTES, parseOrigins, validationDetails };
