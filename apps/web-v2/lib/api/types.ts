/**
 * Named types derived from the generated contract. Screens should import these
 * (or the generated `paths`) rather than restate an API shape.
 *
 * A 200 response with no JSON body yields `never`, which is accurate: these
 * endpoints all answer JSON today.
 */
import type { paths } from "./schema";

export type { paths };

type JsonBody<T> = T extends { content: { "application/json": infer Body } } ? Body : never;

export type HealthResponse = JsonBody<paths["/v1/health"]["get"]["responses"][200]>;
export type MetaOptionsResponse = JsonBody<paths["/v1/meta/options"]["get"]["responses"][200]>;

export type CatalogListResponse = JsonBody<paths["/v1/catalog/products"]["get"]["responses"][200]>;
export type CatalogListQuery = paths["/v1/catalog/products"]["get"]["parameters"]["query"];
export type CatalogProductResponse = JsonBody<
  paths["/v1/catalog/products/{slug}"]["get"]["responses"][200]
>;

export type RecommendationInput =
  paths["/v1/recommendations"]["post"]["requestBody"]["content"]["application/json"];
export type RecommendationResponse = JsonBody<
  paths["/v1/recommendations"]["post"]["responses"][201]
>;

export type PresetsResponse = JsonBody<paths["/v1/presets"]["get"]["responses"][200]>;

/** One row of the preset ladder: a pointer to a persisted pass, not a build. */
export type Preset = PresetsResponse["presets"][number];
export type PriceStatus = Preset["price_status"];

/** `GET /v1/recommendations/{id}` — the detail read behind one card. */
export type PresetDetail = JsonBody<paths["/v1/recommendations/{id}"]["get"]["responses"][200]>;
export type PresetBuild = PresetDetail["builds"][number];
export type BuildComponent = PresetBuild["components"][number];
