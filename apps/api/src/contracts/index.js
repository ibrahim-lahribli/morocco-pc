'use strict';

/** apps/api/src/contracts/index.js - boundary-only barrel for the schemas. */

const errors = require('./errors');
const health = require('./health');
const meta = require('./meta');
const recommendations = require('./recommendations');

module.exports = {
  ErrorResponseSchema: errors.ErrorResponseSchema,
  ValidationDetailSchema: errors.ValidationDetailSchema,
  HealthResponseSchema: health.HealthResponseSchema,
  MetaOptionsSchema: meta.MetaOptionsSchema,
  OptionSchema: meta.OptionSchema,
  DISCLAIMER: recommendations.DISCLAIMER,
  CreateRecommendationBodySchema: recommendations.CreateRecommendationBodySchema,
  BuildComponentSchema: recommendations.BuildComponentSchema,
  BuildSchema: recommendations.BuildSchema,
  BudgetFloorSchema: recommendations.BudgetFloorSchema,
  RecommendationResponseSchema: recommendations.RecommendationResponseSchema,
  RecommendationParamsSchema: recommendations.RecommendationParamsSchema,
};
