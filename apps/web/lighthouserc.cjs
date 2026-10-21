/**
 * apps/web/lighthouserc.cjs — S6's performance budgets, expressed in the repo.
 *
 * The URL is a FIXTURE RESULT page, not the home shell: the budgets exist to
 * protect the page people actually share, and its id is imported from the mock
 * (the same constant `share.spec.ts` and `result.spec.ts` use) so the two cannot
 * drift apart. `scripts/lighthouse-ci.mjs` starts the built app and the mock
 * before this config is read — `lhci autorun` on its own would measure whatever
 * happens to be listening, which is how a budget quietly becomes a lie.
 *
 * WARNING-FIRST, per S6: all three assertions are `warn`, so a regression is
 * printed and stored under `.lighthouseci/` without turning a PR red while W3
 * has not landed yet. S19 promotes them to `error` and owns the preset-page JS
 * budget; this file is the one place those numbers live.
 *
 * 170 KB is 174 080 bytes — S6's hypothesis, measured as TRANSFER size (so
 * compression counts). `resource-summary:script:size` is the closest audit LHCI
 * can assert on: it counts the JavaScript the page actually fetched, which is
 * what "initial JS" means for a server-rendered route.
 */
const { IDS } = require("./mock/fixtures.mjs");

const APP_ORIGIN = "http://localhost:3210";

module.exports = {
  ci: {
    collect: {
      url: [`${APP_ORIGIN}/fr/config/${IDS.threeBuilds}`],
      // Three runs, so the artifact carries a median instead of one unlucky
      // sample; assertions aggregate optimistically (LHCI's default), which is
      // the right bias for a budget that only warns today.
      numberOfRuns: 3,
      settings: {
        // S6's profile is the product's own: a 360 px phone on throttled 4G.
        formFactor: "mobile",
        screenEmulation: {
          mobile: true,
          width: 360,
          height: 800,
          deviceScaleFactor: 2,
          disabled: false,
        },
        throttlingMethod: "simulate",
        throttling: { rttMs: 150, throughputKbps: 1638.4, cpuSlowdownMultiplier: 4 },
        onlyCategories: ["performance"],
      },
    },
    assert: {
      assertions: {
        "largest-contentful-paint": ["warn", { maxNumericValue: 2500 }],
        "cumulative-layout-shift": ["warn", { maxNumericValue: 0.1 }],
        "resource-summary:script:size": ["warn", { maxNumericValue: 174080 }],
      },
    },
    upload: {
      // A local report, uploaded as a CI artifact. Deliberately NOT
      // temporary-public-storage: nothing about a result page should be shipped
      // to a third party just to read a CLS number.
      target: "filesystem",
      outputDir: ".lighthouseci",
    },
  },
};
