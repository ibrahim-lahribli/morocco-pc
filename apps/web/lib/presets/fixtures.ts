/**
 * lib/presets/fixtures.ts — the preset pages a build can render with NO API (S16).
 *
 * The sprint's feature check is "`GET /v1/presets` absent → pages build from
 * committed fixtures". "Committed" has to mean *committed in this package*, not
 * *reachable at build time*: CI builds with no API running, so the only source a
 * prerender can rely on is data in the tree.
 *
 * The bodies are imported from `mock/fixtures.mjs` rather than copied. That is
 * deliberate: the fixture the mock serves at request time and the fixture a build
 * prerenders are then the same bytes, so a page generated offline and the same
 * page generated against the mock cannot disagree about a total, an archetype or
 * a price badge. It is also why this module is server-only by construction — the
 * page imports it from a server component, and nothing here ever reaches the
 * browser bundle.
 *
 * The list is a SNAPSHOT, not the mock's live ribbon: the ribbon also carries a
 * preset this module deliberately omits, so that page can only exist by reading
 * the API at request time (the on-demand half of the feature check, pinned by
 * `e2e/preset.spec.ts`). A preset added to the ribbon therefore
 * appears without a rebuild; the two budgets here are what a cold build can
 * produce on its own.
 */
import type { RecommendationResponse } from "../api/client";
import { IDS, RECOMMENDATIONS_BY_ID } from "../../mock/fixtures.mjs";

export interface PresetFixture {
  /** The contract's `use_case` this page belongs to. */
  useCase: string;
  /** The budget the slug names; the pass behind it must agree (pinned by a spec). */
  budget: number;
  /** The whole pass body, so the page renders exactly what the results page does. */
  recommendation: RecommendationResponse;
}

/**
 * A fixture body as the API's own response type.
 *
 * The cast is the price of importing a JavaScript fixture module into a typed
 * one: `RECOMMENDATIONS_BY_ID` is an object literal, so TypeScript sees its
 * properties widened to `string` rather than the contract's unions. The
 * alternative — hand-typing a second copy of the fixtures — is exactly the drift
 * this module exists to avoid; `e2e/api-contract.spec.ts` pins the same bodies
 * against the client, which is where the shape is actually proven.
 */
function responseOf(id: string): RecommendationResponse {
  const byId = RECOMMENDATIONS_BY_ID as Record<string, unknown>;
  return byId[id] as RecommendationResponse;
}

export const PRESET_FIXTURES: readonly PresetFixture[] = [
  {
    useCase: "GAMING",
    budget: 9000,
    // One verified offer + one placeholder: the "indicatif" state on the page.
    recommendation: responseOf(IDS.indicative),
  },
  {
    useCase: "GAMING",
    budget: 15000,
    // Three builds, the rank-1 card carrying all eight roles.
    recommendation: responseOf(IDS.threeBuilds),
  },
];
