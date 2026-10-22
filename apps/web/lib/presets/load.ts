/**
 * lib/presets/load.ts — where a preset page's data comes from (S16).
 *
 * The page must be generated at build/ISR time with **zero client-side data
 * fetch**, and it must work in two very different environments:
 *
 *   - **`next build` in CI**, where no API is running at all. The pages come from
 *     `PRESET_FIXTURES`, committed in this package, and stay noindex (they are
 *     demonstrations of the layout, not quotes).
 *   - **a deployed build**, where `API_BASE_URL` names a real API. The ribbon and
 *     each preset's pass are read at build time, and — for a budget that was not
 *     in the build's ribbon — generated on demand at request time and cached for
 *     `PRESET_REVALIDATE_SECONDS`. That is the "`GET /v1/presets` present → real
 *     data with `revalidate` configured" half of the DoD.
 *
 * Two boundaries are worth stating because they are easy to blur:
 *
 * 1. **The API is not consulted during a build unless an API base is explicitly
 *    configured.** `serverApiBaseUrl()` falls back to `localhost:3000` so a
 *    server can be pointed at a local API without ceremony, but a build that
 *    silently reached whatever happened to be on that port would make `next build`
 *    depend on ambient state — and would bake a developer's local database into
 *    the artifact. An environment that names an API gets one; everyone else gets
 *    the fixtures, deterministically and offline.
 *
 * 2. **A failure to read a named preset's pass PROPAGATES.** Falling back to the
 *    fixture there would swap a real page (possibly a verified one) for demo data
 *    during an API blip. Letting the render fail is what makes Next keep serving
 *    the last good ISR copy; the fixture fallback is for a budget the ribbon did
 *    not name, and for a build that could not reach the API at all.
 *
 * The outcome is an outcome, never a throw for the ordinary "this slug names
 * nothing" case: the route segment is generic, so every single-segment path inside
 * a locale lands here and must be able to return a 404.
 */
import { cache } from "react";

import {
  getPresetsForServer,
  getRecommendationForStatic,
  isApiConfigured,
  type RecommendationResponse,
} from "@/lib/api/client";

import { PRESET_FIXTURES } from "./fixtures";
import {
  PRESET_FAMILIES,
  PRESET_REVALIDATE_SECONDS,
  parsePresetSlug,
  presetSlug,
  presetBudget,
  type PresetFamily,
  type PresetSource,
} from "./model";

/** A build may wait this long for an API it was explicitly told about. */
const BUILD_TIMEOUT_MS = 3000;
/** A request may wait this long before the page fails and ISR keeps its copy. */
const REQUEST_TIMEOUT_MS = 5000;

export interface PresetPage {
  family: PresetFamily;
  /** The budget the SLUG names — the page's own promise. */
  budget: number;
  slug: string;
  /** Where the data came from; the half of indexability that is not a price. */
  source: PresetSource;
  recommendation: RecommendationResponse;
}

export type PresetOutcome = { kind: "ok"; page: PresetPage } | { kind: "missing" };

interface RibbonEntry {
  budget: number;
  recommendationId: string;
}

type RibbonRead = { kind: "ok"; entries: RibbonEntry[] } | { kind: "error"; cause: unknown };

/**
 * The ribbon for one family, as budgets + pass ids, cheapest first (the order the
 * API serves). A budget the API cannot price as a number is dropped rather than
 * becoming `NaN` in a URL; an unreachable API is an error outcome, never an empty
 * ribbon — "no presets" and "cannot ask" are different facts.
 */
async function readRibbon(family: PresetFamily, timeoutMs: number): Promise<RibbonRead> {
  try {
    const body = await getPresetsForServer(
      { use_case: family.useCase, currency: family.currency },
      { revalidate: PRESET_REVALIDATE_SECONDS, signal: AbortSignal.timeout(timeoutMs) },
    );
    // A budget the slug grammar cannot express is dropped here, not carried into
    // `generateStaticParams`: `presetSlug()` throws on it and the grammar would
    // reject the URL it produced, so an API typo would crash a build that its own
    // contract says never throws.
    const entries = body.presets.flatMap((preset) =>
      presetBudget(preset.budget_amount) === null
        ? []
        : [{ budget: preset.budget_amount, recommendationId: preset.recommendation_id }],
    );
    entries.sort((a, b) => a.budget - b.budget);
    return { kind: "ok", entries };
  } catch (cause) {
    return { kind: "error", cause };
  }
}

function fixtureFor(family: PresetFamily, budget: number) {
  return PRESET_FIXTURES.find(
    (fixture) => fixture.useCase === family.useCase && fixture.budget === budget,
  );
}

export interface BuildPreset {
  family: PresetFamily;
  budget: number;
  slug: string;
}

/**
 * The pages `generateStaticParams` should prerender: the committed fixtures, plus
 * — only when an API is explicitly configured — whatever its ribbon currently
 * serves. Deduped by family + budget, cheapest first, so the build output order is
 * deterministic.
 *
 * Never throws. A build must not fail because an optional API was slow: the
 * fixtures are always enough to produce a valid site.
 */
export async function presetsForBuild(): Promise<BuildPreset[]> {
  const seen = new Set<string>();
  const pages: BuildPreset[] = [];
  const add = (family: PresetFamily, budget: number) => {
    const slug = presetSlug(budget, family);
    if (seen.has(slug)) return;
    seen.add(slug);
    pages.push({ family, budget, slug });
  };

  for (const family of PRESET_FAMILIES) {
    for (const fixture of PRESET_FIXTURES) {
      if (fixture.useCase === family.useCase) add(family, fixture.budget);
    }
    if (!isApiConfigured()) continue;
    const ribbon = await readRibbon(family, BUILD_TIMEOUT_MS);
    if (ribbon.kind !== "ok") {
      console.warn(
        "presets: ribbon unavailable at build time; prerendering the committed fixtures only",
        ribbon.cause instanceof Error ? ribbon.cause.message : ribbon.cause,
      );
      continue;
    }
    for (const entry of ribbon.entries) add(family, entry.budget);
  }

  return pages.sort((a, b) => a.budget - b.budget);
}

/**
 * One preset page, or `missing`.
 *
 * Order of preference: the API's own pointer (when the ribbon names this budget),
 * then a committed fixture for the same budget. The fixture fallback also covers
 * the "an API is running but serves a different ribbon" case, which is what keeps
 * the suite deterministic on a developer machine while still letting a deployed
 * site show real data.
 */
export async function loadPreset(slug: string): Promise<PresetOutcome> {
  const parsed = parsePresetSlug(slug);
  if (parsed === null) return { kind: "missing" };
  const { family, budget } = parsed;

  const ribbon = await readRibbon(family, REQUEST_TIMEOUT_MS);
  if (ribbon.kind === "ok") {
    const match = ribbon.entries.find((entry) => entry.budget === budget);
    if (match !== undefined) {
      // Deliberately NOT wrapped: an API that named this preset and then failed
      // to serve its pass is an outage, and a failed revalidation must leave the
      // previous page in place rather than replace it with demo data.
      const recommendation = await getRecommendationForStatic(match.recommendationId, {
        revalidate: PRESET_REVALIDATE_SECONDS,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      // A landing page that advertises no build is not a page (Decision 48's
      // ribbon is generated from passes that assembled something).
      if (recommendation.builds.length === 0) return { kind: "missing" };
      return {
        kind: "ok",
        page: { family, budget, slug, source: "api", recommendation },
      };
    }
  } else if (isApiConfigured()) {
    // Reachable-but-broken is worth a line; an unconfigured API at build time is
    // the documented normal path and stays quiet.
    console.warn(
      "presets: ribbon unavailable; serving the committed fixture for this budget",
      ribbon.cause instanceof Error ? ribbon.cause.message : ribbon.cause,
    );
  }

  const fixture = fixtureFor(family, budget);
  if (fixture === undefined) return { kind: "missing" };
  if (fixture.recommendation.builds.length === 0) return { kind: "missing" };
  return {
    kind: "ok",
    page: {
      family,
      budget,
      slug,
      source: "fixture",
      recommendation: fixture.recommendation,
    },
  };
}

/**
 * The request-scoped memo: `generateMetadata` and the page body both need the
 * same preset, and a visitor should cost ONE API read (the S11/S15 pattern).
 */
export const loadPresetCached = cache(loadPreset);
