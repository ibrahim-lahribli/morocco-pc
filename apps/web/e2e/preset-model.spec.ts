/**
 * apps/web/e2e/preset-model.spec.ts — S16's pure half.
 *
 * The page specs (`preset.spec.ts`) prove the route renders; these prove the two
 * DECISIONS the route makes, because both fail silently in a browser:
 *
 *   - the slug grammar. A too-permissive parser does not crash — it renders a page
 *     for `/config-pc-gamer-09000-dh`, which is a second URL for one budget and an
 *     SEO defect that no visual assertion would catch;
 *   - indexability. A page that is wrongly indexable looks identical on screen, and
 *     the mistake is only visible to a crawler.
 *
 * The fixture-integrity checks at the end pin the data the build actually
 * prerenders: a preset fixture whose budget disagrees with its own pass would make
 * the page title and its budget bar advertise different numbers.
 */
import { test, expect } from "@playwright/test";

import { PRESET_FIXTURES } from "../lib/presets/fixtures";
import {
  PRESET_FAMILIES,
  PRESET_REVALIDATE_SECONDS,
  parsePresetSlug,
  presetIndexable,
  presetSlug,
} from "../lib/presets/model";
import { PRESETS_OK } from "../mock/fixtures.mjs";

const FAMILY = PRESET_FAMILIES[0];

/** A complete component, so the price facts below are the contract's shape. */
const component = (offerClass: string) => ({
  role: "CPU",
  product_id: "11111111-1111-4111-8111-111111111111",
  name: "Ryzen 5 7600",
  slug: null,
  variant: null,
  price_used: 1899,
  offer_class: offerClass,
  store_offer_id: null,
});

test("the slug grammar accepts the pinned family and reads a plain integer budget", () => {
  const parsed = parsePresetSlug("config-pc-gamer-9000-dh");
  expect(parsed).not.toBeNull();
  expect(parsed?.family.useCase).toBe("GAMING");
  expect(parsed?.family.currency).toBe("MAD");
  expect(parsed?.budget).toBe(9000);

  // The inverse round-trips, so no link or test hand-builds a URL the parser refuses.
  expect(presetSlug(9000)).toBe("config-pc-gamer-9000-dh");
  expect(parsePresetSlug(presetSlug(20000))?.budget).toBe(20000);
  expect(PRESET_FAMILIES).toHaveLength(1);
});

test("every malformed slug is refused, so it becomes a 404 rather than a page", () => {
  const refused = [
    // Not this family (the families S16 deliberately did not ship).
    "config-pc-bureau-9000-dh",
    "config-pc-workstation-9000-dh",
    // Wrong or missing suffix — the DoD's URL ends in -dh.
    "config-pc-gamer-9000",
    "config-pc-gamer-9000-mad",
    "config-pc-gamer-9000-dh-x",
    // Not a plain positive integer: leading zeros and 0 are separate URLs for 0.
    "config-pc-gamer-0-dh",
    "config-pc-gamer-09000-dh",
    "config-pc-gamer-9.5-dh",
    "config-pc-gamer--9000-dh",
    "config-pc-gamer-abc-dh",
    // Above the wizard's ceiling: the CTA could not pre-fill a valid query.
    "config-pc-gamer-9000000-dh",
    // Empty / unrelated segments the generic route also catches.
    "",
    "pas-un-preset",
    "configurer",
  ];
  for (const slug of refused) {
    expect(parsePresetSlug(slug), `expected ${JSON.stringify(slug)} to be refused`).toBeNull();
  }
});

test("presetSlug refuses a budget it could not put in a URL", () => {
  for (const budget of [0, -1, 1.5, Number.NaN]) {
    expect(() => presetSlug(budget)).toThrow(RangeError);
  }
});

test("indexability requires BOTH an API source and every build verified", () => {
  const verified = { price_status: "verified" as const, components: [component("VERIFIED")] };
  const indicative = {
    price_status: "indicative" as const,
    components: [component("VERIFIED"), component("SEED_UNVERIFIED")],
  };
  const demo = { price_status: "indicative" as const, components: [component("SEED_UNVERIFIED")] };

  // The fixture path is never indexable, whatever the fixture asserts.
  expect(presetIndexable("fixture", [verified])).toBe(false);
  // The API path, all verified.
  expect(presetIndexable("api", [verified, verified])).toBe(true);
  // One demo/indicative card is enough to keep the page out of the index.
  expect(presetIndexable("api", [verified, indicative])).toBe(false);
  expect(presetIndexable("api", [demo])).toBe(false);
  // A page with no build advertises nothing and must not rank.
  expect(presetIndexable("api", [])).toBe(false);
});

test("the committed preset fixtures are honest: budget matches, totals add up", () => {
  expect(PRESET_FIXTURES.length).toBeGreaterThan(0);
  for (const fixture of PRESET_FIXTURES) {
    expect(fixture.recommendation.use_case).toBe(fixture.useCase);
    // The page's title and bar use the SLUG's budget; the pass must agree.
    expect(fixture.recommendation.budget_amount).toBe(fixture.budget);
    expect(fixture.recommendation.builds.length).toBeGreaterThan(0);
    for (const build of fixture.recommendation.builds) {
      const sum = build.components.reduce((total, entry) => total + (entry.price_used ?? 0), 0);
      expect(build.total_price).toBe(sum);
    }
  }
});

test("a budget the ribbon serves but the fixtures omit is the on-demand proof", () => {
  // `preset.spec.ts` renders `/fr/config-pc-gamer-20000-dh` and expects the API's
  // data. That assertion only means something while 20000 is ABSENT here: if it
  // were a fixture, the build would prerender it and the spec would prove nothing.
  const fixtureBudgets = PRESET_FIXTURES.map((fixture) => fixture.budget);
  const apiOnly = PRESETS_OK.presets
    .map((preset: { budget_amount: number }) => preset.budget_amount)
    .filter((budget: number) => !fixtureBudgets.includes(budget));

  expect(apiOnly.length).toBeGreaterThan(0);
  for (const budget of fixtureBudgets) {
    expect(PRESETS_OK.presets.map((preset: { budget_amount: number }) => preset.budget_amount)).toContain(
      budget,
    );
  }
});

test("the revalidation interval is a positive, finite number of seconds", () => {
  // The page exports the same number as a literal (Next requires a statically
  // analyzable value) and `preset.spec.ts` pins the resulting s-maxage.
  expect(Number.isInteger(PRESET_REVALIDATE_SECONDS)).toBe(true);
  expect(PRESET_REVALIDATE_SECONDS).toBeGreaterThan(0);
  expect(FAMILY.slug).toBe("config-pc-gamer");
});
