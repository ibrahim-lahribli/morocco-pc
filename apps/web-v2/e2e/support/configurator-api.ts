import { expect, type Page } from "@playwright/test";

import type { PresetDetail } from "../../lib/api/types";

/**
 * Stub every `/v1/**` call the configurator can make.
 *
 * Read-only: `meta/options` for the currency, `presets` for the homepage leg of
 * the journey (the Step 3.3 spec drives both screens through this one stub) and
 * `recommendations/{id}` for the pass behind a `?from=` link. Nothing here
 * reaches a real API. A non-GET method is recorded as a write and answered
 * `405`; any other API path is recorded as unmatched and answered `404`, so an
 * unexpected call fails the spec instead of returning fixture data that hides
 * it.
 */

export const FROM_ID = "3b157941-b4df-4945-a6ae-e6e079644e4c";

/** The same four-tier ladder the homepage stub serves, so both legs agree. */
const PRESET_LADDER = [5_000, 8_000, 12_000, 15_000] as const;

/** Rank 1 total, and the rank 2 total a spec observes after switching. */
export const FIRST_TOTAL = 11_946;
export const SECOND_TOTAL = 13_480;

/** The floor a zero-build pass reports, so a spec can assert the diagnostic. */
export const FLOOR_TOTAL = 8_450;

export const COMPONENT_NAMES = [
  "AMD Ryzen 5 5600",
  "NVIDIA GeForce RTX 4060",
  "MSI B550M Pro-VDH",
  "Corsair Vengeance 16 Go",
  "Samsung 980 1 To",
  "Corsair RM650",
  "Fractal Design Pop Mini",
  "DeepCool AK400",
] as const;

const SECOND_BUILD_NAMES = [
  "AMD Ryzen 7 5700X",
  "NVIDIA GeForce RTX 4060 Ti",
  "MSI B550 Tomahawk",
  "Corsair Vengeance 32 Go",
  "Samsung 990 1 To",
  "Corsair RM750",
  "Fractal Design North",
  "DeepCool AK620",
] as const;

const ROLES = [
  "CPU",
  "GPU",
  "MOTHERBOARD",
  "RAM",
  "SSD_BOOT",
  "PSU",
  "CASE",
  "CPU_COOLER",
] as const;

export interface ConfiguratorApiControls {
  /** `null` serves the fixture; 404/500/503 serve the API's error envelope. */
  detailStatus: number | null;
  /** Read before each detail answer, so a spec can observe the loading state. */
  detailDelayMs: number;
  /** Serve a pass that loaded successfully with `builds: []` and a priced floor. */
  zeroBuilds: boolean;
}

export interface StubConfiguratorApi {
  /** Every non-GET call, as `METHOD pathname`. Must always be empty. */
  writes: string[];
  /** Every API call, as `METHOD pathname`, for "no request" assertions. */
  calls: string[];
  /** GET calls no route handled. Must always be empty. */
  unmatched: string[];
  controls: ConfiguratorApiControls;
}

const JSON_HEADERS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
};

function wait(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function components(names: readonly string[]) {
  return ROLES.map((role, index) => ({
    role,
    product_id: `${role.toLowerCase()}-stub`,
    name: names[index] ?? `${role} stub`,
    slug: `${role.toLowerCase()}-stub`,
    variant: null,
    price_used: 500 + index * 250,
    offer_class: "SEED_UNVERIFIED",
    store_offer_id: null,
  }));
}

/** The one pass the stub serves, carrying every field the contract requires. */
function detailBody(): PresetDetail {
  return {
    id: FROM_ID,
    budget_amount: 12_000,
    currency: "MAD",
    use_case: "GAMING",
    generated_at: null,
    budget_floor: null,
    engine_version: "stub-engine@1.0.0",
    catalog_version: "stub-v1",
    reused: false,
    reason: null,
    disclaimer: "Prix indicatifs, non actualisés.",
    input_effects: [{ input: "use_case", effect: "APPLIED", reason: "Usage pris en compte." }],
    served_by: { engine_version: "stub-engine@1.0.0" },
    builds: [
      {
        rank: 1,
        engine_version: "stub-engine@1.0.0",
        strategy_key: "BALANCED",
        total_price: FIRST_TOTAL,
        build_score: 72.5,
        compatibility_status: "PASS",
        explanation: null,
        swapped: null,
        price_status: "indicative",
        components: components(COMPONENT_NAMES),
      },
      {
        rank: 2,
        engine_version: "stub-engine@1.0.0",
        strategy_key: "PERFORMANCE",
        total_price: SECOND_TOTAL,
        build_score: 78.25,
        compatibility_status: "PASS",
        explanation: null,
        swapped: null,
        price_status: "indicative",
        components: components(SECOND_BUILD_NAMES),
      },
    ],
  };
}

/** The same pass, loaded successfully: no assembled build, but a priced floor. */
function zeroBuildBody(): PresetDetail {
  return {
    ...detailBody(),
    builds: [],
    budget_floor: {
      cheapest_total: FLOOR_TOTAL,
      currency: "MAD",
      budget_amount: 12_000,
      within_budget: false,
      cheapest_by_role: {},
      missing_roles: [],
    },
  };
}

export function detailCalls(stub: StubConfiguratorApi): string[] {
  return stub.calls.filter((call) => call.startsWith("GET /v1/recommendations/"));
}

/** Fail a spec that wrote anything, or whose call no stub route handled. */
export function expectNoApiViolations(stub: StubConfiguratorApi): void {
  expect(stub.writes, "the configurator must never write").toEqual([]);
  expect(stub.unmatched, "every API path must be stubbed").toEqual([]);
}

export async function stubConfiguratorApi(
  page: Page,
  options: Partial<ConfiguratorApiControls> = {},
): Promise<StubConfiguratorApi> {
  const writes: string[] = [];
  const calls: string[] = [];
  const unmatched: string[] = [];
  const controls: ConfiguratorApiControls = {
    detailStatus: null,
    detailDelayMs: 0,
    zeroBuilds: false,
    ...options,
  };

  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    calls.push(`${method} ${url.pathname}`);

    if (method !== "GET") {
      writes.push(`${method} ${url.pathname}`);
      return route.fulfill({
        status: 405,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          error: "METHOD_NOT_ALLOWED",
          message: "the configurator is read-only",
          request_id: "stub",
        }),
      });
    }

    if (url.pathname === "/v1/meta/options") {
      return route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          use_cases: [
            { value: "GAMING", label: "Gaming" },
            { value: "OFFICE", label: "Bureautique" },
            { value: "WORKSTATION", label: "Création" },
          ],
          currencies: [{ value: "MAD", label: "Dirham marocain" }],
          resolutions: [],
          priorities: [],
          inputs_applied: ["use_case"],
        }),
      });
    }

    if (url.pathname === "/v1/presets") {
      // One row per tier for any advertised use case: the homepage's cards pick
      // the tier at or below the ceiling from this ladder, and the ids are the
      // ones the journey asserts in the URL.
      const useCase = url.searchParams.get("use_case") ?? "";
      return route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          catalog_version: "stub-v1",
          generated_at: null,
          presets: PRESET_LADDER.map((budget_amount) => ({
            budget_amount,
            recommendation_id: `rec-${useCase}-${budget_amount}`,
            build_score: 60 + budget_amount / 1_000,
            price_status: "indicative",
          })),
        }),
      });
    }

    if (url.pathname.startsWith("/v1/recommendations/")) {
      await wait(controls.detailDelayMs);

      if (controls.detailStatus !== null) {
        return route.fulfill({
          status: controls.detailStatus,
          headers: JSON_HEADERS,
          body: JSON.stringify({
            error: controls.detailStatus === 404 ? "NOT_FOUND" : "INTERNAL",
            message: "stub failure",
            request_id: "stub",
          }),
        });
      }

      return route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(controls.zeroBuilds ? zeroBuildBody() : detailBody()),
      });
    }

    unmatched.push(`${method} ${url.pathname}`);
    return route.fulfill({
      status: 404,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "NOT_FOUND", message: `stub has no ${url.pathname}` }),
    });
  });

  return { writes, calls, unmatched, controls };
}
