'use strict';

/**
 * apps/api/src/routes/docs.js - GET /v1/docs/json.
 *
 * `@fastify/swagger` (v9) builds the document and decorates the instance with
 * `fastify.swagger()`, but it no longer SERVES it: the `exposeRoute` option was
 * removed and the UI route belongs to `@fastify/swagger-ui`, which is not an
 * approved dependency here. The document endpoint is therefore a two-line route
 * of our own - which is also why it exists at `/v1/docs/json` and not at the
 * plugin's historical `/documentation/json` default.
 *
 * The route is hidden from the document it serves (onRoute would otherwise
 * advertise a docs route inside its own spec).
 */

const DOCS_RATE_LIMIT = Object.freeze({ max: 120, timeWindow: '1 minute' });

function registerDocsRoutes(app) {
  app.get('/v1/docs/json', {
    config: { rateLimit: DOCS_RATE_LIMIT },
    schema: {
      hide: true,
      summary: 'OpenAPI 3.0 document for this API',
    },
  }, async (_request, reply) => {
    return reply.type('application/json; charset=utf-8').send(app.swagger());
  });
}

module.exports = { registerDocsRoutes, DOCS_RATE_LIMIT };
