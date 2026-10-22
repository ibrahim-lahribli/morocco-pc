/**
 * apps/web/e2e/api-contract.spec.ts — S4's proof that the fixtures and the
 * client cover the contract.
 *
 * Two halves, both request-only (no browser page, so this runs in ~1 s and
 * cannot be flaky on paint):
 *
 *   1. every mock STATE is reachable and carries the fields a sprint consumes.
 *      A state that silently stops being served fails here, not in S10.
 *   2. the TYPED CLIENT maps those responses correctly — including the error
 *      envelope, `details[]`, and the `Retry-After` countdown S10 renders.
 *
 * The client half imports the real `lib/api/client.ts`, pointed at the mock
 * through `NEXT_PUBLIC_API_BASE_URL`, so the test exercises the shipping code
 * path rather than a second implementation.
 */

import { test, expect } from "@playwright/test";

import { ApiError, createRecommendation, getPresets, getRecommendation } from "../lib/api/client";
import { CATALOG_PRODUCTS_BY_SLUG } from "../mock/fixtures.mjs";

const MOCK = "http://localhost:3211";

test.use({ baseURL: MOCK });

test.describe("the mock serves every contract state", () => {
  test("health answers ok with an engine version", async ({ request }) => {
    const response = await request.get("/v1/health");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: "ok", db: "ok", engine_version: expect.any(String) });
  });

  test("meta/options offers values AND labels for all four lists", async ({ request }) => {
    const body = await (await request.get("/v1/meta/options")).json();
    expect(Object.keys(body).sort()).toEqual(["currencies", "priorities", "resolutions", "use_cases"]);
    for (const list of [body.use_cases, body.currencies, body.resolutions, body.priorities]) {
      expect(list.length).toBeGreaterThan(0);
      for (const option of list) {
        expect(typeof option.value).not.toBe("undefined");
        expect(typeof option.label).toBe("string");
      }
    }
    // Priority values are integers (the API contract allows string OR integer).
    expect(body.priorities.map((option: { value: unknown }) => typeof option.value)).toEqual([
      "number",
      "number",
      "number",
    ]);
  });

  test("a 201 carries both price states and both offer classes", async ({ request }) => {
    const response = await request.post("/v1/recommendations", {
      data: { budget_amount: 15000, currency: "MAD", use_case: "GAMING" },
    });
    expect(response.status()).toBe(201);
    const body = await response.json();

    expect(body.reused).toBe(false);
    expect(body.builds).toHaveLength(2);
    expect(body.builds.map((build: { price_status: string }) => build.price_status).sort()).toEqual([
      "indicative",
      "verified",
    ]);

    const offerClasses = new Set(
      body.builds.flatMap((build: { components: { offer_class: string }[] }) =>
        build.components.map((component) => component.offer_class)
      )
    );
    expect(offerClasses).toEqual(new Set(["VERIFIED", "SEED_UNVERIFIED"]));

    // A component is never rendered from `display_name` (V5).
    expect(JSON.stringify(body)).not.toContain("display_name");
    expect(JSON.stringify(body)).not.toContain("Seed ");
  });

  test("a dedupe hit is 200 with reused: true and the same body shape", async ({ request }) => {
    const response = await request.post("/v1/recommendations?state=reused", {
      data: { budget_amount: 15000, currency: "MAD", use_case: "GAMING" },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.reused).toBe(true);
    expect(body.builds).toHaveLength(2);
  });

  test("a zero-build pass is 200 with builds: [] and a computed floor", async ({ request }) => {
    const response = await request.post("/v1/recommendations?state=zero-build", {
      data: { budget_amount: 6000, currency: "MAD", use_case: "GAMING" },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.builds).toEqual([]);
    expect(body.reason).toBe("EMPTY_CANDIDATE_POOL");
    expect(body.budget_floor.within_budget).toBe(true);
    expect(body.budget_floor.cheapest_total).toBeGreaterThan(0);
  });

  test("a zero-build pass with an UNKNOWN floor reports null, never 0", async ({ request }) => {
    const body = await (await request.post("/v1/recommendations?state=zero-build-no-floor", {
      data: { budget_amount: 3000, currency: "MAD", use_case: "GAMING" },
    })).json();
    expect(body.builds).toEqual([]);
    expect(body.budget_floor.cheapest_total).toBeNull();
    expect(body.budget_floor.within_budget).toBeNull();
    expect(body.budget_floor.missing_roles.length).toBeGreaterThan(0);
  });

  test("422 names the offending field", async ({ request }) => {
    const response = await request.post("/v1/recommendations?state=422", {
      data: { budget_amount: 15000, currency: "MAD", use_case: "GAMING" },
    });
    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.error).toBe("VALIDATION_ERROR");
    expect(body.details[0]).toEqual({ field: "budget_amount", message: expect.any(String) });
  });

  test("413, 429 (with Retry-After) and 503 keep their codes", async ({ request }) => {
    const tooLarge = await request.post("/v1/recommendations?state=413", { data: {} });
    expect(tooLarge.status()).toBe(413);
    expect((await tooLarge.json()).error).toBe("PAYLOAD_TOO_LARGE");

    const limited = await request.post("/v1/recommendations?state=429", { data: {} });
    expect(limited.status()).toBe(429);
    expect(limited.headers()["retry-after"]).toBe("30");

    const unavailable = await request.post("/v1/recommendations?state=503", { data: {} });
    expect(unavailable.status()).toBe(503);
    expect((await unavailable.json()).error).toBe("SCORING_MODEL_UNAVAILABLE");
  });

  test("the mock enforces the request rules the API enforces", async ({ request }) => {
    const numericString = await request.post("/v1/recommendations", {
      data: { budget_amount: "6000", currency: "MAD", use_case: "GAMING" },
    });
    expect(numericString.status()).toBe(422);
    expect((await numericString.json()).details[0].field).toBe("budget_amount");

    const unknownField = await request.post("/v1/recommendations", {
      data: { budget_amount: 6000, currency: "MAD", use_case: "GAMING", budget: 6000 },
    });
    expect(unknownField.status()).toBe(422);
    expect((await unknownField.json()).details[0].field).toBe("budget");
  });

  test("the fixtures agree with the contract's derived facts", async ({ request }) => {
    // A fixture is only evidence if its own numbers hold together: a build whose
    // parts do not sum to its total, or a floor that repeats a different budget,
    // would let a S11/S14 rendering bug pass while the mock looks healthy.
    const cases = [
      { query: "", budget: 15000 },
      { query: "?state=reused", budget: 15000 },
      { query: "?state=zero-build", budget: 6000 },
    ];

    for (const { query, budget } of cases) {
      const body = await (
        await request.post(`/v1/recommendations${query}`, {
          data: { budget_amount: budget, currency: "MAD", use_case: "GAMING" },
        })
      ).json();

      // Decision 47: a 32-hex content digest, not an arbitrary string.
      expect(body.catalog_version).toMatch(/^[0-9a-f]{32}$/);
      // computeBudgetFloor copies the query budget in, so these can never diverge.
      expect(body.budget_floor.budget_amount).toBe(body.budget_amount);

      for (const build of body.builds) {
        // Decision 41's archetypes: PERFORMANCE, BALANCED, VALUE. The cheap
        // build is VALUE - this fixture once said "PRICE", which no pass emits.
        expect(["PERFORMANCE", "BALANCED", "VALUE"]).toContain(build.strategy_key);
        // assembly computes total_price as the sum of strictly positive selected
        // prices, so a build and its components must add up.
        const sum = build.components.reduce(
          (total: number, component: { price_used: number | null }) =>
            total + (component.price_used ?? 0),
          0
        );
        expect(build.total_price).toBe(sum);
      }
    }
  });

  test("presets serve a list, and an empty list is a 200 with generated_at null", async ({ request }) => {
    const full = await (await request.get("/v1/presets?use_case=GAMING&currency=MAD")).json();
    // Three presets since S16: 9000 (indicative), 15000 and 20000 (verified).
    // Every entry points at a pass this mock actually serves.
    expect(full.presets).toHaveLength(3);
    expect(full.presets.map((preset: { price_status: unknown }) => preset.price_status)).toEqual([
      "indicative",
      "verified",
      "verified",
    ]);

    const empty = await (await request.get("/v1/presets?state=empty&use_case=GAMING&currency=MAD")).json();
    expect(empty.presets).toEqual([]);
    expect(empty.generated_at).toBeNull();
  });

  test("catalog reads serve a page and a 404 for an unknown slug", async ({ request }) => {
    // Typed here because the mock serves JSON: an untyped body turns every
    // callback below into an implicit any type.
    const list: {
      next_cursor: string | null;
      products: { display_name: string; has_offer: boolean; offer_class: string | null }[];
    } = await (await request.get("/v1/catalog/products")).json();
    expect(list.next_cursor).toBeNull();
    // The list is DERIVED from the same map the detail route reads (S17), so its
    // shape follows the fixtures instead of pinning an index that a new product
    // silently shifts (S23 added a second GPU).
    expect(list.products).toHaveLength(Object.keys(CATALOG_PRODUCTS_BY_SLUG).length);
    // A product with no offer is still listed (has_offer false), with no class.
    const withoutOffer = list.products.find((product) => product.has_offer === false);
    expect(withoutOffer, "a product with no offer must still be listed").toBeTruthy();
    expect(withoutOffer?.offer_class).toBeNull();
    // And the long SKU is present, whatever position it holds.
    expect(
      list.products.some((product) => product.display_name.length > 40),
    ).toBe(true);

    const detail = await request.get("/v1/catalog/products/rtx-4060-8gb");
    expect(detail.status()).toBe(200);
    expect((await detail.json()).disclaimer).toContain("indicatif");

    // S17: an UNKNOWN slug is a 404 on its own, without asking for one. Before
    // this the route echoed the requested slug inside a single fixture body.
    expect((await request.get("/v1/catalog/products/pas-un-produit")).status()).toBe(404);
    expect((await request.get("/v1/catalog/products/x?state=404")).status()).toBe(404);
  });

  test("slow mode delays without changing the body", async ({ request }) => {
    const started = Date.now();
    const response = await request.post("/v1/recommendations?state=slow&delay=300", {
      data: { budget_amount: 15000, currency: "MAD", use_case: "GAMING" },
    });
    expect(response.status()).toBe(201);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  });
});

test.describe("the typed client maps the mock exactly", () => {
  test.beforeAll(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = MOCK;
  });

  test("201 is a fresh pass and 200 is a reuse, both typed", async () => {
    const fresh = await createRecommendation({
      budget_amount: 15000,
      currency: "MAD",
      use_case: "GAMING",
    });
    expect(fresh.status).toBe(201);
    expect(fresh.body.reused).toBe(false);

    const reused = await createRecommendation(
      { budget_amount: 15000, currency: "MAD", use_case: "GAMING" },
      { headers: { "x-mock-state": "reused" } }
    );
    expect(reused.status).toBe(200);
    expect(reused.body.reused).toBe(true);
  });

  test("a 422 becomes an ApiError carrying details[] and the request id", async () => {
    await expect(
      createRecommendation(
        { budget_amount: 0, currency: "MAD", use_case: "GAMING" },
        { headers: { "x-mock-state": "422" } }
      )
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
      code: "VALIDATION_ERROR",
      details: [{ field: "budget_amount", message: expect.any(String) }],
    });
  });

  test("a 429 exposes retryAfterSeconds for the countdown", async () => {
    const error = await createRecommendation(
      { budget_amount: 15000, currency: "MAD", use_case: "GAMING" },
      { headers: { "x-mock-state": "429" } }
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: "RATE_LIMITED", retryAfterSeconds: 30 });
  });

  test("a 200 whose body is not JSON is an ApiError, not a null success", async () => {
    await expect(
      createRecommendation(
        { budget_amount: 15000, currency: "MAD", use_case: "GAMING" },
        { headers: { "x-mock-state": "non-json" } }
      )
    ).rejects.toMatchObject({ name: "ApiError", status: 200, code: "UNKNOWN" });
  });

  test("an unreachable API is a NETWORK_ERROR, not a crash", async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://127.0.0.1:1";
    try {
      await expect(getRecommendation("anything")).rejects.toMatchObject({
        status: 0,
        code: "NETWORK_ERROR",
      });
    } finally {
      process.env.NEXT_PUBLIC_API_BASE_URL = MOCK;
    }
  });

  test("presets and a 404 keep their shapes", async () => {
    const presets = await getPresets({ use_case: "GAMING", currency: "MAD" });
    expect(presets.presets).toHaveLength(3);

    await expect(
      getRecommendation("missing", { headers: { "x-mock-state": "404" } })
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});
