/**
 * apps/web/lighthouserc.devtools.cjs — the LCP check under a REAL throttle.
 *
 * Same profile, same two fixture URLs, same median of three as `lighthouserc.cjs`;
 * the difference is `throttlingMethod: "devtools"`. Lantern (`simulate`) projects
 * a load time from the observed trace and lands 2 475-2 628 ms on these routes
 * with single runs up to 2 879 ms, so its LCP assertion sits inside its own noise
 * (LCP_INVESTIGATION_2.md §1). Under devtools the same pages measure 1 773-1 922 ms
 * across 40 consecutive runs, sigma 24-44 ms, margin ~670 ms — a verdict that means
 * "this page is slow on a throttled phone" instead of "the projection moved".
 *
 * ONE assertion, and it is `error` INSIDE this config: LCP <= 2500 ms, median of
 * three. Nothing else is budgeted here — script bytes, CLS and the category score
 * stay in `lighthouserc.cjs`, where they are enforced, so this file cannot become a
 * second, softer copy of the budget.
 *
 * The check is NOT blocking yet (`.github/workflows/web.yml` runs it with
 * `continue-on-error: true` and uploads its report). Promotion rule, owner-approved
 * 2026-11-05: after about ten CI runs, make it blocking if the CI LCP stays under
 * 2 200 ms. Until then `npm run test:lighthouse:devtools` is a measurement, and the
 * simulated LCP in `lighthouserc.cjs` is a warning.
 *
 * Own output directory: `lhci autorun` would otherwise overwrite the enforced run's
 * `.lighthouseci` report, and the two artifacts are read for different questions.
 */
const { IDS } = require("./mock/fixtures.mjs");

const APP_ORIGIN = "http://localhost:3210";

module.exports = {
  ci: {
    collect: {
      url: [
        `${APP_ORIGIN}/fr/config/${IDS.threeBuilds}`,
        `${APP_ORIGIN}/fr/config-pc-gamer-9000-dh`,
      ],
      numberOfRuns: 3,
      settings: {
        formFactor: "mobile",
        screenEmulation: {
          mobile: true,
          width: 360,
          height: 800,
          deviceScaleFactor: 2,
          disabled: false,
        },
        // The whole point of this config: a real throttle, not Lantern's projection.
        throttlingMethod: "devtools",
        throttling: { rttMs: 150, throughputKbps: 1638.4, cpuSlowdownMultiplier: 4 },
        onlyCategories: ["performance"],
      },
    },
    assert: {
      aggregationMethod: "median",
      assertions: {
        "largest-contentful-paint": ["error", { maxNumericValue: 2500 }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci-devtools",
    },
  },
};
