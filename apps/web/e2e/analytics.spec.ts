/**
 * apps/web/e2e/analytics.spec.ts — S22's analytics scenarios, in two halves.
 *
 * The first half is Node: `resolveAnalyticsConfig()` and `sanitizeEvent()` are
 * pure, and they are where the two promises are actually kept — that an
 * unconfigured deployment loads nothing, and that no event can carry a value the
 * user typed. A test that only watched the network could not see a rule that
 * holds only because nobody broke it yet.
 *
 * The second half is the browser, and it answers the two scenarios the sprint
 * writes as measurements:
 *
 *   1. **Analytics never blocks rendering.** The loader waits for the window's
 *      `load` event, and that is asserted as an ORDERING fact — the stub records
 *      `performance.now()` when it executes and an init script records the same
 *      clock at `load`. The Lighthouse budgets (`npm run test:lighthouse`) are
 *      the LCP side of the same claim; their delta with analytics on and off is
 *      recorded in `docs/design/STATES.md`, because a number inside a spec that
 *      cannot fail is not a gate.
 *   2. **No query string reaches the provider.** Two facts, because the claim
 *      has two owners: the injected tag carries `data-exclude-search` and
 *      `data-exclude-hash` (OUR side, readable off the element the browser
 *      actually got), and a stub standing in for the vendor honours them, so the
 *      pageview URL it would send has no query (the VENDOR's side, which we can
 *      only demonstrate rather than guarantee). On top of that, every event this
 *      app sends is checked for the budget string.
 *
 * The stub is a stub and the spec says so: `@axe-core/playwright` proves the DOM
 * contract rather than a screen reader, and this proves the ATTRIBUTE contract
 * rather than Plausible's server. What it cannot prove is written down in
 * `docs/design/STATES.md` instead of implied by a green run.
 */
import { expect, test, type Page } from "@playwright/test";

import { ANALYTICS_ENDPOINT, resolveAnalyticsConfig, sanitizeEvent } from "../lib/analytics";
import { IDS, META_OPTIONS, RECOMMENDATION_OK } from "../mock/fixtures.mjs";

// ---------------------------------------------------------------------------
// 1. The rules, without a browser
// ---------------------------------------------------------------------------

test("unconfigured is OFF, and a misspelt configuration is loud", () => {
  // The default a deployment gets by doing nothing.
  expect(resolveAnalyticsConfig({})).toBeNull();
  expect(resolveAnalyticsConfig({ ANALYTICS_PROVIDER: "  " })).toBeNull();
  expect(resolveAnalyticsConfig({ ANALYTICS_PROVIDER: "off" })).toBeNull();

  // Both providers, with the vendor's own script unless a self-hosted one is named.
  expect(
    resolveAnalyticsConfig({ ANALYTICS_PROVIDER: "plausible", ANALYTICS_DOMAIN: "morocco-pc.example" }),
  ).toEqual({
    provider: "plausible",
    domain: "morocco-pc.example",
    scriptSrc: "https://plausible.io/js/script.js",
  });
  expect(
    resolveAnalyticsConfig({
      ANALYTICS_PROVIDER: "umami",
      ANALYTICS_WEBSITE_ID: "0f2c-11ee",
      ANALYTICS_SCRIPT_URL: "https://stats.example/script.js",
    }),
  ).toEqual({
    provider: "umami",
    domain: "0f2c-11ee",
    scriptSrc: "https://stats.example/script.js",
  });

  // Each of these would otherwise send nothing at all while looking configured.
  expect(() => resolveAnalyticsConfig({ ANALYTICS_PROVIDER: "plausibl" })).toThrow(
    /ANALYTICS_PROVIDER/,
  );
  expect(() => resolveAnalyticsConfig({ ANALYTICS_PROVIDER: "plausible" })).toThrow(
    /ANALYTICS_DOMAIN/,
  );
  expect(() => resolveAnalyticsConfig({ ANALYTICS_PROVIDER: "umami" })).toThrow(
    /ANALYTICS_WEBSITE_ID/,
  );
  expect(() =>
    resolveAnalyticsConfig({
      ANALYTICS_PROVIDER: "plausible",
      ANALYTICS_DOMAIN: "morocco-pc.example",
      ANALYTICS_SCRIPT_URL: "/js/script.js",
    }),
  ).toThrow(/absolute URL/);
});

test("an event can only carry a value the map declares", () => {
  // The three wired events, accepted as declared.
  expect(sanitizeEvent({ name: "wizard_step", props: { step: "budget" } })).toEqual({
    name: "wizard_step",
    props: { step: "budget" },
  });
  expect(sanitizeEvent({ name: "config_generated", props: { builds: 3 } })).toEqual({
    name: "config_generated",
    props: { builds: 3 },
  });
  expect(sanitizeEvent({ name: "share_used", props: { channel: "whatsapp" } })).toEqual({
    name: "share_used",
    props: { channel: "whatsapp" },
  });

  // The reasons the runtime check exists: none of these is representable in the
  // TYPE, so each one is a cast — a future call site written loosely, or a
  // payload built from data.
  const loose = (event: unknown) =>
    sanitizeEvent(event as Parameters<typeof sanitizeEvent>[0]);

  // A value outside the set, including a digit string that a shape check would
  // have waved through.
  expect(loose({ name: "wizard_step", props: { step: "9000" } })).toBeNull();
  expect(loose({ name: "wizard_step", props: { step: "budget" } })).not.toBeNull();
  expect(loose({ name: "share_used", props: { channel: "https://exemple.ma/config/x" } })).toBeNull();
  // A prop the map does not declare: the way a budget would actually leak.
  expect(loose({ name: "wizard_step", props: { step: "budget", budget_amount: 9000 } })).toBeNull();
  // A missing prop, an unknown event, and a count that is not a count.
  expect(loose({ name: "wizard_step", props: {} })).toBeNull();
  expect(loose({ name: "pageview", props: { path: "/fr" } })).toBeNull();
  expect(loose({ name: "config_generated", props: { builds: -1 } })).toBeNull();
  expect(loose({ name: "config_generated", props: { builds: 2.5 } })).toBeNull();
  expect(loose({ name: "config_generated", props: { builds: "3" } })).toBeNull();
});

test("the endpoint answers the default, and is not cacheable as a document", async ({
  request,
}) => {
  const response = await request.get(ANALYTICS_ENDPOINT);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(response.headers()["cache-control"]).toContain("max-age=300");
  // The test environment configures nothing, which is also the shipped default.
  expect(await response.json()).toEqual({ provider: null });
});

// ---------------------------------------------------------------------------
// 2. The browser: when it loads, and what it says
// ---------------------------------------------------------------------------

const CONFIG_ROUTE = "**/api/analytics/config";
const STUB_SRC = "http://analytics.test/script.js";
const DOMAIN = "test.local";

/**
 * The stub stands in for the vendor's script. It records the pageview URL it
 * WOULD send, computed exactly the way Plausible and Umami compute it: the
 * attributes on their own tag decide whether the query string and the fragment
 * are included (`data-exclude-search` / `data-exclude-hash`).
 */
const STUB = `
window.__analyticsCalls = [];
window.plausible = function (name, options) {
  window.__analyticsCalls.push({ name: name, props: (options && options.props) || {} });
};
var tag = document.currentScript;
window.__analyticsPageviews = [{
  path: location.pathname,
  query: tag && tag.dataset.excludeSearch === "true" ? "" : location.search,
  fragment: tag && tag.dataset.excludeHash === "true" ? "" : location.hash
}];
window.__analyticsAt = performance.now();
`;

/**
 * A provider whose global throws. The test below proves the action that sent the
 * event still happens; `__analyticsThrew` is set BEFORE the throw so the spec can
 * tell "the event reached the provider" from "the event was still queued".
 */
const THROWING_SRC = "http://analytics.test/throwing.js";
const THROWING_STUB = `
window.__analyticsThrew = false;
window.plausible = function () {
  window.__analyticsThrew = true;
  throw new Error("provider exploded");
};
setTimeout(function () { window.__analyticsArmed = true; }, 100);
`;

/** Turn analytics on for this page, pointing at the stub. */
async function enableAnalytics(
  page: Page,
  scriptSrc: string = STUB_SRC,
  scriptBody: string = STUB,
): Promise<void> {
  await page.route(CONFIG_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      // Same shape the route handler serves, with the script swapped for a stub.
      body: JSON.stringify({ provider: "plausible", domain: DOMAIN, scriptSrc }),
    }),
  );
  await page.route(scriptSrc, (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: scriptBody }),
  );
}

/** The options list and a successful pass, for the tests that submit the wizard. */
async function serveWizardApi(page: Page): Promise<void> {
  await page.route("**/v1/meta/options*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(META_OPTIONS),
    }),
  );
  await page.route("**/v1/recommendations", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type, accept",
        },
      });
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(RECOMMENDATION_OK),
    });
  });
}

/** Record the window's `load` on the same clock the stub uses. */
async function installLoadClock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.addEventListener("load", () => {
      (window as unknown as { __loadAt?: number }).__loadAt = performance.now();
    });
  });
}

type Instrumented = {
  __loadAt?: number;
  __analyticsAt?: number;
  __analyticsCalls?: { name: string; props: Record<string, string | number> }[];
  __analyticsPageviews?: { path: string; query: string; fragment: string }[];
};

async function read(page: Page): Promise<Instrumented> {
  return page.evaluate(() => {
    const w = window as unknown as Instrumented;
    return {
      __loadAt: w.__loadAt,
      __analyticsAt: w.__analyticsAt,
      __analyticsCalls: w.__analyticsCalls ?? [],
      __analyticsPageviews: w.__analyticsPageviews ?? [],
    };
  });
}

test("nothing is loaded until after the load event, and the tag excludes the query", async ({
  page,
}) => {
  await installLoadClock(page);
  // `load` waits for a stylesheet, and delaying one opens a gap between the
  // document arriving and `load` firing — which is the window in which a
  // render-blocking script would live. It does NOT separate "after load" from
  // "after hydration" on this app (measured: React 19's hydration lands after
  // `load` here either way), so what this catches is the realistic regression —
  // a loader mounted in the document, or a tag rendered by the server — not a
  // hypothetical eager call inside the same effect.
  await page.route("**/_next/static/chunks/*.css", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  await enableAnalytics(page);

  // A wizard step whose address carries everything scenario 2 is about.
  const document = await page.goto("/fr/configurer?etape=budget&use_case=GAMING&budget_amount=9000");

  // The strongest form of "never render-blocking": it is not in the document at
  // all. No vendor URL, no tag — so no parser can stop on it.
  const html = await document?.text();
  expect(html).toBeDefined();
  expect(html).not.toContain("analytics.test");
  expect(html).not.toContain("data-analytics");

  // The tag the browser actually got: the attributes ARE our half of the promise.
  const tag = page.locator(`script[data-analytics="plausible"]`);
  await expect(tag).toHaveCount(1);
  await expect(tag).toHaveAttribute("data-domain", DOMAIN);
  await expect(tag).toHaveAttribute("data-exclude-search", "true");
  await expect(tag).toHaveAttribute("data-exclude-hash", "true");
  // A script the browser cannot block on: both flags are set on the element, not
  // inherited from a default.
  await expect(tag).toHaveAttribute("async", "");
  await expect(tag).toHaveAttribute("defer", "");

  // ...and the ordering, as a number rather than a hope.
  await expect
    .poll(async () => (await read(page)).__analyticsAt ?? 0)
    .toBeGreaterThan(0);
  const state = await read(page);
  expect(state.__loadAt).toBeGreaterThan(0);
  expect(state.__analyticsAt as number).toBeGreaterThanOrEqual(state.__loadAt as number);

  // What the vendor would send: the path, no query, no fragment — even though
  // the address bar holds a budget and a use case.
  expect(state.__analyticsPageviews?.[0]).toEqual({
    path: "/fr/configurer",
    query: "",
    fragment: "",
  });
});

test("completing a step sends the step, and never the answer", async ({ page }) => {
  await enableAnalytics(page);
  await page.goto("/fr/configurer?etape=budget&use_case=GAMING&budget_amount=9000");

  await page.getByRole("button", { name: "Suivant" }).click();

  await expect
    .poll(async () => (await read(page)).__analyticsCalls?.length ?? 0)
    .toBeGreaterThan(0);

  const calls = (await read(page)).__analyticsCalls ?? [];
  expect(calls).toContainEqual({ name: "wizard_step", props: { step: "budget" } });

  // The whole payload, serialized: the budget appears nowhere in it.
  const payload = JSON.stringify(calls);
  expect(payload).not.toContain("9000");
  expect(payload).not.toContain("GAMING");
});

test("a generated configuration sends a COUNT, never the id or the budget", async ({ page }) => {
  await enableAnalytics(page);

  // The wizard's last step needs the options list and the POST; the helper owns
  // both, the same pattern as wizard-submit.spec.
  await serveWizardApi(page);

  await page.goto(
    "/fr/configurer?etape=priority&use_case=GAMING&budget_amount=7300&resolution=1440p&priority=3",
  );
  await page.getByRole("button", { name: "Voir mes configurations" }).click();

  await expect(page).toHaveURL(new RegExp(`/fr/config/${RECOMMENDATION_OK.id}$`));
  await expect
    .poll(async () => (await read(page)).__analyticsCalls?.length ?? 0)
    .toBeGreaterThan(0);

  const calls = (await read(page)).__analyticsCalls ?? [];
  expect(calls).toContainEqual({
    name: "config_generated",
    props: { builds: RECOMMENDATION_OK.builds.length },
  });
  // The final step is completed by the submit, so `priority` is reachable too;
  // `config_generated` records the pass, not the step.
  expect(calls).toContainEqual({ name: "wizard_step", props: { step: "priority" } });
  // Client-side navigation keeps the JS context, so this is the SAME page's log:
  // neither the pass id nor the budget is in it.
  const payload = JSON.stringify(calls);
  expect(payload).not.toContain(RECOMMENDATION_OK.id);
  expect(payload).not.toContain("7300");
});

test("a provider that throws cannot stop the submit that sent the event", async ({ page }) => {
  await enableAnalytics(page, THROWING_SRC, THROWING_STUB);
  await serveWizardApi(page);

  await page.goto(
    "/fr/configurer?etape=priority&use_case=GAMING&budget_amount=7300&resolution=1440p&priority=3",
  );

  // The stub arms only after the module's `load` handler has had time to run, so
  // this waits for a LOADED provider rather than one that is still being fetched:
  // an event queued here would never reach the throwing global.
  await page.waitForFunction(
    () => (window as unknown as { __analyticsArmed?: boolean }).__analyticsArmed === true,
  );
  await page.getByRole("button", { name: "Voir mes configurations" }).click();

  // The event really reached the provider and it threw: the flag is set before
  // the throw. Without the guard in `send()`, this click would have thrown before
  // `submit()`, and the URL assertion below would fail.
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __analyticsThrew?: boolean }).__analyticsThrew === true,
      ),
    )
    .toBe(true);
  await expect(page).toHaveURL(new RegExp(`/fr/config/${RECOMMENDATION_OK.id}$`));
});

test("sharing sends the channel, never the link", async ({ page }) => {
  await enableAnalytics(page);
  // A clipboard that resolves without a permission prompt; the share bar's own
  // fallbacks are proven in share.spec.ts, this spec is about the event.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
  });

  await page.goto(`/fr/config/${IDS.threeBuilds}`);
  await page.getByRole("button", { name: "Copier le lien" }).click();

  await expect
    .poll(async () => (await read(page)).__analyticsCalls?.length ?? 0)
    .toBeGreaterThan(0);

  const calls = (await read(page)).__analyticsCalls ?? [];
  expect(calls).toContainEqual({ name: "share_used", props: { channel: "copy" } });
  const payload = JSON.stringify(calls);
  expect(payload).not.toContain(IDS.threeBuilds);
  expect(payload).not.toContain("http");
});
