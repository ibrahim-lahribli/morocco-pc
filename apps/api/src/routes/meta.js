'use strict';

/**
 * apps/api/src/routes/meta.js - GET /v1/meta/options.
 *
 * The option lists a client renders before it can POST anything. `use_case` is
 * derived from the ACTIVE scoring model through `engine.js`, so when that model
 * cannot be read - or declares no usable vocabulary - the route answers 503,
 * never an empty array. An empty use-case list would look like a valid answer
 * and would leave a client with a form it can never submit (Decision 36 item
 * 3). Both causes share ONE body, so a client has a single state to handle.
 */

const meta = require('../meta');
const { MetaOptionsSchema, ErrorResponseSchema } = require('../contracts');

const META_RATE_LIMIT = Object.freeze({ max: 120, timeWindow: '1 minute' });

/**
 * The one 503 body the two causes share: no active model at all, or an active
 * model whose configuration yields no use-case vocabulary. The code is what a
 * client keys on, and the message stays true of both - there is no usable
 * active model right now.
 */
function scoringUnavailable() {
  return {
    error: 'SCORING_MODEL_UNAVAILABLE',
    message: 'No active scoring model is configured',
  };
}

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
      return reply.code(503).send(scoringUnavailable());
    }
    // The vocabulary belongs to the ACTIVE model (Decision 37). Deriving it
    // here, and refusing to present an UNKNOWN one, is what stops an unusable
    // model from being served as a 200 with an empty form.
    const useCases = app.engine.useCaseVocabulary(model.configuration);
    if (useCases === null) {
      return reply.code(503).send(scoringUnavailable());
    }
    return reply.code(200).send(meta.buildOptions(useCases));
  });
}

module.exports = { registerMetaRoutes, META_RATE_LIMIT };
