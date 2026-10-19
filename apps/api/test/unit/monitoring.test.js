'use strict';

/**
 * apps/api/test/unit/monitoring.test.js - optional error capture (P3 Sprint 4).
 *
 * DB-free and NETWORK-FREE: nothing here initialises the SDK, so no transport is
 * created and no event is ever sent. What is pinned is the decision and the
 * configuration:
 *
 *   - capture exists only when SENTRY_DSN is a non-blank string;
 *   - tracing is off and default PII is off;
 *   - `beforeSend` deletes the WHOLE request object, so no query string, body,
 *     header or cookie can reach a sink even if a future integration starts
 *     attaching one;
 *   - importing this module never loads @sentry/node.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const monitoring = require('../../src/monitoring');

const DSN = 'https://public@example.ingest.sentry.io/1';

test('capture is OFF unless SENTRY_DSN is a non-blank string', () => {
  assert.equal(monitoring.sentryEnabled({}), false);
  assert.equal(monitoring.sentryEnabled({ SENTRY_DSN: '' }), false);
  assert.equal(monitoring.sentryEnabled({ SENTRY_DSN: '   ' }), false);
  assert.equal(monitoring.sentryEnabled({ SENTRY_DSN: 42 }), false);
  assert.equal(monitoring.sentryEnabled({ SENTRY_DSN: null }), false);
  assert.equal(monitoring.sentryEnabled({ SENTRY_DSN: DSN }), true);
});

test('the init options never sample traces and never send default PII', () => {
  const options = monitoring.buildSentryOptions({
    SENTRY_DSN: DSN,
    SENTRY_ENVIRONMENT: 'staging',
    SENTRY_RELEASE: 'abc1234',
    ENGINE_VERSION: 'ignored-when-release-is-set',
  });

  assert.equal(options.dsn, DSN);
  assert.equal(options.tracesSampleRate, 0, 'tracing is off: an error sink must not become a tracer');
  assert.equal(options.sendDefaultPii, false, 'no IP address or user identity is attached');
  assert.equal(options.environment, 'staging');
  assert.equal(options.release, 'abc1234');
});

test('release falls back to ENGINE_VERSION, and empty fields are omitted rather than blank', () => {
  const options = monitoring.buildSentryOptions({
    SENTRY_DSN: DSN,
    SENTRY_ENVIRONMENT: '   ',
    SENTRY_RELEASE: '',
    ENGINE_VERSION: 'deadbee',
  });

  assert.equal(options.release, 'deadbee');
  assert.equal(Object.prototype.hasOwnProperty.call(options, 'environment'), false,
    'a blank SENTRY_ENVIRONMENT must not become an environment named ""');
});

test('beforeSend strips the whole request object and keeps the error', () => {
  const options = monitoring.buildSentryOptions({ SENTRY_DSN: DSN });
  const exception = { values: [{ type: 'Error', value: 'boom' }] };
  const event = {
    exception,
    request: {
      url: 'https://api.example/v1/recommendations?token=super-secret',
      method: 'POST',
      data: { budget_amount: 20000 },
      headers: { cookie: 'session=abc' },
    },
  };

  const sent = options.beforeSend(event);

  assert.equal(Object.prototype.hasOwnProperty.call(sent, 'request'), false,
    'request data - query string included - must never reach the sink');
  assert.deepEqual(sent.exception, exception);
});

test('beforeSend tolerates a minimal event', () => {
  const options = monitoring.buildSentryOptions({ SENTRY_DSN: DSN });
  assert.deepEqual(options.beforeSend({ message: 'x' }), { message: 'x' });
});

test('the SDK is only loaded on the DSN-bearing path', () => {
  const resolved = require.resolve('@sentry/node');

  assert.equal(monitoring.createCapture({}), null);
  assert.equal(monitoring.createCapture({ SENTRY_DSN: '' }), null);
  assert.equal(monitoring.createCapture({ SENTRY_DSN: '  ' }), null);

  assert.equal(require.cache[resolved], undefined,
    'importing the module and asking for capture without a DSN must not load @sentry/node');
});
