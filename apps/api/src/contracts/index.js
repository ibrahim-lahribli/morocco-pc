'use strict';

/** apps/api/src/contracts/index.js - boundary-only barrel for the schemas. */

const catalog = require('./catalog');
const errors = require('./errors');
const health = require('./health');
const meta = require('./meta');
const presets = require('./presets');
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
  InputEffectSchema: recommendations.InputEffectSchema,
  RecommendationResponseSchema: recommendations.RecommendationResponseSchema,
  RecommendationParamsSchema: recommendations.RecommendationParamsSchema,
  CompatibilityPairSchema: recommendations.CompatibilityPairSchema,
  SwapPreviewParamsSchema: recommendations.SwapPreviewParamsSchema,
  SwapPreviewQuerySchema: recommendations.SwapPreviewQuerySchema,
  SwapPreviewResponseSchema: recommendations.SwapPreviewResponseSchema,
  SwappedSchema: recommendations.SwappedSchema,
  SwapCommitParamsSchema: recommendations.SwapCommitParamsSchema,
  SwapCommitBodySchema: recommendations.SwapCommitBodySchema,
  SwapCommitResponseSchema: recommendations.SwapCommitResponseSchema,
  PresetSchema: presets.PresetSchema,
  PresetsResponseSchema: presets.PresetsResponseSchema,
  PresetsQuerySchema: presets.PresetsQuerySchema,
  CatalogProductSchema: catalog.CatalogProductSchema,
  CatalogVariantSchema: catalog.CatalogVariantSchema,
  CatalogListResponseSchema: catalog.CatalogListResponseSchema,
  CatalogProductsQuerySchema: catalog.CatalogProductsQuerySchema,
  CatalogProductParamsSchema: catalog.CatalogProductParamsSchema,
  CatalogOfferSchema: catalog.CatalogOfferSchema,
  CatalogProductDetailSchema: catalog.CatalogProductDetailSchema,
  PriceHistoryPointSchema: catalog.PriceHistoryPointSchema,
  PriceHistoryResponseSchema: catalog.PriceHistoryResponseSchema,
};
