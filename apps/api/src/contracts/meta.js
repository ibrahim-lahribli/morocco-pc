'use strict';

/**
 * apps/api/src/contracts/meta.js - GET /v1/meta/options response contract.
 *
 * Every list is an array of `{ value, label }` objects: the value is what the
 * client POSTs back, the label is what it renders. `priority`'s values are
 * integers, so the option schema accepts a number; the rest are strings.
 * Keeping one option type means the frontend has one renderer.
 *
 * `inputs_applied` is the one field that is NOT an option list (Decision 52):
 * it names which of `use_case` / `resolution` / `priority` the ACTIVE model's
 * configuration gives a reader at all, so a client can stop asking a question
 * nothing downstream reads. It is REQUIRED and may be empty - an empty list is
 * a fact ("the model reads none of them"), which is exactly why the web parser
 * treats it differently from an absent field (`lib/wizard/applied.ts`).
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
  inputs_applied: Type.Array(Type.String()),
}, { additionalProperties: false });

module.exports = { MetaOptionsSchema, OptionSchema };
