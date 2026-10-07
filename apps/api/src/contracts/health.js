'use strict';

/**
 * apps/api/src/contracts/health.js - GET /v1/health response contract.
 *
 * `status` is the process verdict and is always 'ok' when the HTTP layer can
 * answer at all; `db` is the separate database verdict. Splitting them is what
 * lets a load balancer keep the process in rotation while an operator sees the
 * database is down - a single boolean could not express that.
 */

const { Type } = require('@sinclair/typebox');

const HealthResponseSchema = Type.Object({
  status: Type.Literal('ok'),
  db: Type.Union([Type.Literal('ok'), Type.Literal('down')]),
  engine_version: Type.String(),
}, { additionalProperties: false });

module.exports = { HealthResponseSchema };
