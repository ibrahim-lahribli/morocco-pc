import type { Page } from "@playwright/test";

/**
 * Stub every `/v1/**` call the homepage makes.
 *
 * The homepage is read-only in Step 1: `meta/options`, three preset ladders and
 * one detail per rendered card. Nothing here reaches a real API, and every POST
 * is recorded instead of fulfilled, so a spec can assert the page never writes.
 *
 * The ladders carry four tiers (5 000 … 15 000) so the 12 000 ceiling rule is
 * observable: a card showing 15 000 would mean the ceiling was ignored.
 */

const LADDER = [5_000, 8_000, 12_000, 15_000] as const;

const USE_CASES = ["GAMING", "OFFICE", "WORKSTATION"] as const;

export const CARD_TITLES = {
  GAMING: "PC Gaming",
  OFFICE: "PC Bureautique",
  WORKSTATION: "PC Création & Professionnel",
} as const;

export interface StubHomepageApiOptions {
  /** Use cases whose preset ladder answers `200` with `presets: []`. */
  emptyPresetsFor?: readonly string[];
  /** Use cases whose presets request fails. */
  failPresetsFor?: readonly string[];
  /** Status used for `failPresetsFor`; 500 by default. */
  failPresetsStatus?: number;
  /** Overrides the price status the served build reports, per use case. */
  detailBadge?: Partial<Record<string, "verified" | "indicative" | null>>;
  /**
   * Test latency before the presets answer, so a spec can observe the pending
   * state of a ladder it is waiting on. Never a product sleep.
   */
  presetsDelayMs?: number;
  /** Test latency before a detail answer, for the same reason. */
  detailDelayMs?: number;
}

export interface StubHomepageApiResult {
  /** Every POST the page issued, as `METHOD url`. */
  posts: string[];
  /** Every API call the page issued, as `METHOD pathname`. */
  calls: string[];
}

const DEFAULT_BADGE: Record<string, "verified" | "indicative" | null> = {
  GAMING: "verified",
  OFFICE: "indicative",
  WORKSTATION: null,
};

const JSON_HEADERS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
};

/** Hold a stub answer open for `ms`, so the caller can observe its pending state. */
function wait(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function presetIdFor(useCase: string, budgetAmount: number): string {
  return `rec-${useCase}-${budgetAmount}`;
}

function component(role: string, name: string) {
  return {
    role,
    product_id: `${role.toLowerCase()}-stub`,
    name,
    slug: `${role.toLowerCase()}-stub`,
    variant: null,
    price_used: 1_999,
    offer_class: "SEED_UNVERIFIED",
    store_offer_id: null,
  };
}

function detailBody(id: string, badge: "verified" | "indicative" | null) {
  const [, useCase = "GAMING", budget = "12000"] = id.split("-");

  return {
    id,
    budget_amount: Number(budget),
    currency: "MAD",
    use_case: useCase,
    generated_at: null,
    catalog_version: "stub-v1",
    disclaimer: "Prix indicatifs, non actualisés.",
    builds: [
      {
        rank: 1,
        total_price: Number(budget) - 500,
        build_score: 72.5,
        compatibility_status: "PASS",
        strategy_key: "BALANCED",
        explanation: `Trame ${useCase} servie par le moteur.`,
        price_status: badge,
        components: [
          component("CPU", "AMD Ryzen 5 5600"),
          component("GPU", "NVIDIA RTX 4060"),
          component("RAM", "32 Go DDR4"),
          component("SSD_BOOT", "NVMe 1 To"),
        ],
      },
    ],
  };
}

export async function stubHomepageApi(
  page: Page,
  options: StubHomepageApiOptions = {},
): Promise<StubHomepageApiResult> {
  const posts: string[] = [];
  const calls: string[] = [];

  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    calls.push(`${method} ${url.pathname}`);

    if (method !== "GET") {
      posts.push(`${method} ${url.pathname}`);
      return route.fulfill({
        status: 201,
        headers: JSON_HEADERS,
        body: JSON.stringify({ id: "stub-pass" }),
      });
    }

    if (url.pathname === "/v1/meta/options") {
      return route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          use_cases: USE_CASES.map((value) => ({ value, label: value })),
          currencies: [{ value: "MAD", label: "Dirham marocain" }],
          resolutions: [{ value: "1080p", label: "1080p" }],
          priorities: [{ value: 3, label: "Équilibré" }],
          inputs_applied: ["use_case", "priority"],
        }),
      });
    }

    if (url.pathname === "/v1/presets") {
      const useCase = url.searchParams.get("use_case") ?? "";
      await wait(options.presetsDelayMs ?? 0);

      if (options.failPresetsFor?.includes(useCase)) {
        return route.fulfill({
          status: options.failPresetsStatus ?? 500,
          headers: JSON_HEADERS,
          body: JSON.stringify({ error: "INTERNAL", message: "stub failure", request_id: "stub" }),
        });
      }

      const presets = options.emptyPresetsFor?.includes(useCase)
        ? []
        : LADDER.map((budget_amount) => ({
            budget_amount,
            recommendation_id: presetIdFor(useCase, budget_amount),
            build_score: 60 + budget_amount / 1000,
            price_status: "verified",
          }));

      return route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          catalog_version: "stub-v1",
          generated_at: null,
          presets,
        }),
      });
    }

    if (url.pathname.startsWith("/v1/recommendations/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      await wait(options.detailDelayMs ?? 0);
      const useCase = id.split("-")[1] ?? "";
      const badge = options.detailBadge?.[useCase] ?? DEFAULT_BADGE[useCase] ?? null;

      return route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(detailBody(id, badge)),
      });
    }

    return route.fulfill({
      status: 404,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "NOT_FOUND", message: `stub has no ${url.pathname}` }),
    });
  });

  return { posts, calls };
}
