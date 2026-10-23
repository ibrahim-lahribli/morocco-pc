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
 *   - `trustProxy` is OFF unless `TRUST_PROXY` names the proxy's ADDRESS. The
 *     limiter keys on `request.ip`, so without it every caller behind a platform
 *     proxy shares one bucket; trusting the whole chain instead would let every
 *     caller write its own key. See `parseTrustProxy` below.
 *   - Error capture is INJECTED (`captureError`) and defaults to a no-op, so the
 *     HTTP layer never imports a monitoring SDK. `server.js` decides whether one
 *     exists (see `monitoring.js`), which keeps the unit suites network-free and
 *     makes "one 500 is one event" assertable with a plain function.
 *   - Routes are registered INSIDE a plugin so they are added after
 *     `@fastify/rate-limit` and `@fastify/swagger` have loaded - both attach
 *     `onRoute` hooks, and a route added before them would be invisible to
 *     both.
 */

const net = require('node:net');

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const rateLimit = require('@fastify/rate-limit');
const swagger = require('@fastify/swagger');

const { registerCatalogRoutes } = require('./routes/catalog');
const { registerHealthRoutes } = require('./routes/health');
const { registerMetaRoutes } = require('./routes/meta');
const { registerPresetRoutes } = require('./routes/presets');
const { registerRecommendationRoutes } = require('./routes/recommendations');
const { registerDocsRoutes } = require('./routes/docs');

/** The whole request body is five scalars; see the header. */
const BODY_LIMIT_BYTES = 10 * 1024;

/**
 * What runs when the caller injects no capture collaborator. A 500 path must
 * not branch on whether monitoring is configured; `server.js` passes either the
 * real capture or null, and the unit suites pass a stub or nothing.
 */
function noopCapture() {}

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

/**
 * `TRUST_PROXY` names the proxy whose `X-Forwarded-For` we accept, and it
 * defaults to OFF. It is NOT a hop count - see below.
 *
 * Fastify's `trustProxy` decides how `request.ip` is derived from
 * `X-Forwarded-For`, and `@fastify/rate-limit` keys every bucket on that value.
 * The accepted forms are proxy-addr's: an address, a CIDR, or one of its named
 * ranges, comma-separated. Three consequences shape this parser:
 *
 *   - `false` (unset, blank, `false`, `0`, `off`, `no`) is the default: the
 *     header is ignored entirely, which is correct for a directly reachable
 *     process and is the only safe default before a proxy is known to exist.
 *   - A trusted ADDRESS makes Fastify stop at the first untrusted hop, so the
 *     client is the address the proxy appended - never the leftmost entry,
 *     which a client can write.
 *   - A HOP COUNT and `true` are both REFUSED. fastify@5.12 disables
 *     hop-count trust outright (`getTrustProxyFn` returns a function that
 *     trusts nothing) because it cannot validate the immediate peer, and
 *     `true` trusts the whole chain, so either one hands every caller its own
 *     rate-limit key. A `/0` prefix is refused on the same ground - it is
 *     `true` in CIDR spelling. A start must fail loudly instead of silently
 *     voiding the per-IP limit; the error names the supported form.
 */
const TRUST_PROXY_RANGES = new Set(['loopback', 'linklocal', 'uniquelocal']);

/**
 * Why one comma-separated entry is unusable, or null when it is fine.
 *
 * A `/0` prefix is refused explicitly: it trusts EVERY peer, which makes
 * `request.ip` the leftmost `X-Forwarded-For` entry - exactly the hole that
 * refusing `true` closes. Accepting it would reopen the same bypass under a
 * CIDR spelling.
 */
function trustProxyEntryProblem(value) {
  if (TRUST_PROXY_RANGES.has(value)) {
    return null;
  }
  const parts = value.split('/');
  if (parts.length > 2) {
    return 'not an IP address or CIDR';
  }
  const family = net.isIP(parts[0]);
  if (family === 0) {
    return 'not an IP address or CIDR';
  }
  if (parts.length === 1) {
    return null;
  }
  if (!/^[0-9]{1,3}$/.test(parts[1])) {
    return 'not an IP address or CIDR';
  }
  const prefix = Number(parts[1]);
  if (prefix > (family === 4 ? 32 : 128)) {
    return 'prefix out of range';
  }
  if (prefix === 0) {
    return 'trusts every peer';
  }
  return null;
}

function parseTrustProxy(raw) {
  if (raw === undefined || raw === null || raw === false) {
    return false;
  }
  if (Array.isArray(raw)) {
    return parseTrustProxy(raw.join(','));
  }
  if (typeof raw === 'number') {
    throw new TypeError(
      'TRUST_PROXY is a trusted proxy address, not a hop count (' + raw + '). ' +
      'fastify@5.12 disables hop-count trust because it cannot validate the immediate peer; ' +
      'set TRUST_PROXY to the proxy\'s address or CIDR, e.g. TRUST_PROXY=127.0.0.1'
    );
  }
  if (typeof raw !== 'string') {
    throw new TypeError('TRUST_PROXY must be a comma-separated proxy address list or false; got ' + typeof raw);
  }
  const value = raw.trim();
  if (value === '' || /^(false|off|no|0)$/i.test(value)) {
    return false;
  }
  if (/^[0-9]+$/.test(value)) {
    throw new TypeError(
      'TRUST_PROXY is a trusted proxy address, not a hop count ("' + value + '"). ' +
      'fastify@5.12 disables hop-count trust because it cannot validate the immediate peer; ' +
      'set TRUST_PROXY to the proxy\'s address or CIDR, e.g. TRUST_PROXY=127.0.0.1'
    );
  }
  if (/^(true|yes|on)$/i.test(value)) {
    throw new TypeError(
      'TRUST_PROXY=true would trust the whole X-Forwarded-For chain, letting any caller pick ' +
      'its own rate-limit bucket; name the proxy\'s address or CIDR instead'
    );
  }
  const entries = value.split(',').map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    return false;
  }
  const problems = entries
    .map((entry) => ({ entry, problem: trustProxyEntryProblem(entry) }))
    .filter((item) => item.problem !== null);
  if (problems.some((item) => item.problem === 'trusts every peer')) {
    throw new TypeError(
      'TRUST_PROXY has a /0 entry, which trusts EVERY peer: a caller could then write its own ' +
      'X-Forwarded-For and choose its rate-limit bucket, exactly what `true` is refused for. ' +
      'Name a narrower address or CIDR instead.'
    );
  }
  if (problems.length > 0) {
    throw new TypeError(
      'TRUST_PROXY has an entry that is not an IP address, CIDR or known range: "' +
      problems.map((item) => item.entry + ' (' + item.problem + ')').join(', ') + '"'
    );
  }
  return entries;
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
  const captureError = typeof opts.captureError === 'function' ? opts.captureError : noopCapture;

  const trustProxy = parseTrustProxy(
    opts.trustProxy === undefined ? env.TRUST_PROXY : opts.trustProxy
  );

  const app = Fastify({
    logger: opts.logger === undefined ? false : opts.logger,
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy,
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
  app.register(cors, {
    origin: origins.length > 0 ? origins : false,
    // A browser can only read a NON-simple response header when the server
    // lists it here. Without these two, a cross-origin web client cannot see
    // `Retry-After` (the 429 countdown, V10) or `X-Request-Id` (the support
    // handle on a 500) at all: `fetch` returns them as null, which looks
    // exactly like the API never sending them. `request_id` in the error
    // BODY still works either way; the header is what a proxy or an
    // intermediary sets, so both paths have to reach the client.
    exposedHeaders: ['Retry-After', 'X-Request-Id'],
  });
  app.register(rateLimit, { global: false });
  app.register(swagger, {
    openapi: {
      info: {
        title: 'morocco-pc API',
        description: 'Recommendation API over the morocco-pc engine. Prices are indicative.',
        // 1.1.0 (2026-10-14): the response surfaces the persisted pass facts
        // (budget_floor, engine_version, strategy_key) instead of serving two
        // of them as null on GET.
        // 1.2.0 (2026-10-15): product identity - each component carries its
        // persisted `slug`, and `name` is read from
        // COALESCE(product.display_name, product.name), so the `Seed ` prefix
        // no longer reaches a client. Pinned byte-for-byte by
        // apps/api/test/unit/openapi-snapshot.test.js.
        // 1.3.0 (2026-10-16): request dedupe (Platform P1 Sprint 5). A POST
        // whose request identity, catalog version and engine version match an
        // existing committed pass answers 200 with `reused: true` and the
        // ORIGINAL id; every response now also carries the pass's
        // `catalog_version` (Decision 47).
        // 1.4.0 (2026-10-16): GET /v1/presets (Platform P1 Sprint 6 /
        // Decision 48) - the generated landing-page ribbon: the presets of the
        // CURRENT catalog version for one use case and currency, cheapest
        // budget first.
        // 1.5.0 (2026-10-17): the read-only catalog (Platform P2 Sprint 3) -
        // GET /v1/catalog/products (keyset pagination on slug) and
        // GET /v1/catalog/products/:slug. Every price carries its Decision 35
        // provenance class, and the detail carries the derived price_status
        // and the disclaimer.
        // 1.6.0 (2026-10-23): the price history behind one product -
        // GET /v1/catalog/products/:slug/price-history, the observations in
        // ascending order with their provenance, and a summary whose change
        // fields are null until there are two points (Decision 51). No existing
        // field or path changed. Pinned byte-for-byte by
        // apps/api/test/unit/openapi-v1.6.json.
        version: '1.6.0',
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
      // The request id is what lets a client (and the log) correlate the limit
      // that fired; it is the same field a 500 carries, so one parse path covers
      // both. `@fastify/rate-limit` also sends `Retry-After` (seconds), which is
      // the header that tells a caller to wait rather than give up.
      return reply.code(429).send({
        error: 'RATE_LIMITED',
        message: 'Too many requests',
        request_id: String(request.id),
      });
    }
    // Unexpected: log the detail, return a generic body plus the request id.
    // Never echo the error message - it can carry a SQL fragment or a host.
    request.log.error({ err: error }, 'unhandled request error');
    // Capture ONLY the unexpected path, and only the error plus the request id.
    // A monitoring sink must never change what the client receives: a failing
    // capture is logged and swallowed, because the 500 is already the outcome.
    try {
      captureError(error, String(request.id));
    } catch (captureFailure) {
      request.log.warn({ err: captureFailure }, 'error capture failed');
    }
    return reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: 'Internal server error',
      request_id: String(request.id),
    });
  });

  // Registered as a plugin so these routes are added after the plugins above
  // have attached their onRoute hooks (see the header).
  app.register(async (instance) => {
    registerCatalogRoutes(instance);
    registerHealthRoutes(instance);
    registerMetaRoutes(instance);
    registerPresetRoutes(instance);
    registerRecommendationRoutes(instance);
    registerDocsRoutes(instance);
  });

  return app;
}

module.exports = {
  buildApp,
  BODY_LIMIT_BYTES,
  parseOrigins,
  parseTrustProxy,
  validationDetails,
};
