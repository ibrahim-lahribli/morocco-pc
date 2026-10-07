'use strict';

/**
 * apps/api/src/contracts/meta.js - GET /v1/meta/options response contract.
 *
 * Every list is an array of `{ value, label }` objects: the value is what the
 * client POSTs back, the label is what it renders. `priority`'s values are
 * integers, so the option schema accepts a number; the rest are strings.
 * Keeping one option type means the frontend has one renderer.
 */

const { Type } = require('@sinclair/typebox');

const OptionSchema = Type.Object({
  value: Type.Union([Type.String(), Type.Integer()]),
  label: Type.String(),
}, { additionalProperties: false });

const MetaOptionsSchema = Type.Object({
  use_cases: Type.Array(OptionSchema),
  currencies: Type.Array(OptionSchema),
  resolutions: Type.Array(OptionSchema),
  priorities: Type.Array(OptionSchema),
}, { additionalProperties: false });

module.exports = { MetaOptionsSchema, OptionSchema };
