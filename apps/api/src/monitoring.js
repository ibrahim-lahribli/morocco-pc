'use strict';

/**
 * apps/api/src/monitoring.js - optional error capture (Platform P3 Sprint 4).
 *
 * Boundary: this module owns the DECISION and the CONFIG, never a request. It is
 * required by `server.js` and by its own unit test, and it requires
 * `@sentry/node` LAZILY inside `createCapture` - so importing this file never
 * loads the SDK, never starts a transport, and cannot slow a test run.
 *
 * Feature detection, not configuration: with no `SENTRY_DSN` the API behaves
 * exactly as it did before this file existed - no client, no integrations, no
 * transport, no outbound socket. `pino-pretty` in `server.js` uses the same
 * pattern, for the same reason (a production install must not depend on an
 * optional package being present).
 *
 * What is NEVER sent. `beforeSend` deletes the WHOLE `request` object before an
 * event leaves the process, so no query string, request body, header or cookie
 * can reach a sink even if a future integration starts attaching one.
 * `sendDefaultPii` is false and tracing is off (`tracesSampleRate: 0`): the only
 * payload this module produces is the error plus a `request_id` tag.
 *
 * The DSN is a secret: it is read from the environment, never logged, and never
 * echoed by an error message here.
 */

/** The only variable that turns capture on. */
const DSN_ENV = 'SENTRY_DSN';

/**
 * True only for a non-blank STRING DSN. A whitespace-only value is a
 * misconfiguration, not an enable switch, and a non-string is refused rather
 * than coerced - the same discipline the API applies to request fields.
 */
function sentryEnabled(env) {
  const source = env || {};
  return typeof source[DSN_ENV] === 'string' && source[DSN_ENV].trim().length > 0;
}

/** Drops request-scoped data (query string included) from every outgoing event. */
function stripRequest(event) {
  if (event && typeof event === 'object') {
    delete event.request;
  }
  return event;
}

function nonBlank(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * The `Sentry.init` options, kept PURE so they can be asserted without loading
 * the SDK or opening a transport.
 *
 * `release` prefers `SENTRY_RELEASE` and falls back to `ENGINE_VERSION`, so an
 * event names the deploy that produced it even when the platform sets only the
 * variable the API already requires.
 */
function buildSentryOptions(env) {
  const source = env || {};
  const options = {
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: stripRequest,
  };

  const dsn = nonBlank(source[DSN_ENV]);
  if (dsn !== null) {
    options.dsn = dsn;
  }

  const environment = nonBlank(source.SENTRY_ENVIRONMENT);
  if (environment !== null) {
    options.environment = environment;
  }

  const release = nonBlank(source.SENTRY_RELEASE) || nonBlank(source.ENGINE_VERSION);
  if (release !== null) {
    options.release = release;
  }

  return options;
}

/**
 * A capture function of the shape `buildApp` takes, or null when capture is
 * off. `server.js` passes null straight through, which is why "no DSN" costs
 * nothing: there is no indirection to pay for on the error path either.
 */
function createCapture(env) {
  if (!sentryEnabled(env)) {
    return null;
  }
  const Sentry = require('@sentry/node');
  Sentry.init(buildSentryOptions(env));

  return function captureError(error, requestId) {
    Sentry.withScope((scope) => {
      if (typeof requestId === 'string' && requestId.length > 0) {
        scope.setTag('request_id', requestId);
      }
      Sentry.captureException(error);
    });
  };
}

module.exports = {
  DSN_ENV,
  sentryEnabled,
  stripRequest,
  buildSentryOptions,
  createCapture,
};
