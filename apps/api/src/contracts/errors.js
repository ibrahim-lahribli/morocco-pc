'use strict';

/**
 * apps/api/src/contracts/errors.js - the API's error envelope.
 *
 * One shape for every non-2xx body, so a client has one parse path. `details`
 * carries per-field validation messages only; server-side detail stays in the
 * log and the request id is the only handle a client gets for a 500.
 *
 * `additionalProperties: true` on purpose: an error body is diagnostic, and a
 * response serializer that silently dropped a future field would be worse than
 * a slightly loose schema.
 */

const { Type } = require('@sinclair/typebox');

const ValidationDetailSchema = Type.Object({
  field: Type.String(),
  message: Type.String(),
}, { additionalProperties: false });

const ErrorResponseSchema = Type.Object({
  error: Type.String(),
  message: Type.String(),
  details: Type.Optional(Type.Array(ValidationDetailSchema)),
  request_id: Type.Optional(Type.String()),
}, { additionalProperties: true });

module.exports = { ErrorResponseSchema, ValidationDetailSchema };
