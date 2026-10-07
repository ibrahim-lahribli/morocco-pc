'use strict';

/**
 * apps/api/src/routes/meta.js - GET /v1/meta/options.
 *
 * The option lists a client renders before it can POST anything. `use_case` is
 * derived from the ACTIVE scoring model, so when that model cannot be read the
 * route answers 503 - never an empty array. An empty use-case list would look
 * like a valid answer and would leave a client with a form it can never submit
 * (Decision 36 item 3).
 */

const meta = require('../meta');
const { MetaOptionsSchema, ErrorResponseSchema } = require('../contracts');

const META_RATE_LIMIT = Object.freeze({ max: 120, timeWindow: '1 minute' });

function registerMetaRoutes(app) {
  app.get('/v1/meta/options', {
    config: { rateLimit: META_RATE_LIMIT },
    schema: {
      tags: ['meta'],
      summary: 'Accepted use cases, currencies, resolutions and priorities',
      response: { 200: MetaOptionsSchema, 503: ErrorResponseSchema },
    },
  }, async (_request, reply) => {
    const model = await app.repo.selectActiveScoringModel(app.pool);
    if (model === null) {
      return reply.code(503).send({
        error: 'SCORING_MODEL_UNAVAILABLE',
        message: 'No active scoring model is configured',
      });
    }
    return reply.code(200).send(meta.buildOptions(model.configuration));
  });
}

module.exports = { registerMetaRoutes, META_RATE_LIMIT };
