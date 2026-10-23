/**
 * apps/web/lighthouserc.cjs — S6's performance budgets, expressed in the repo.
 *
 * The URLs are FIXTURE pages, not the home shell: the budgets exist to protect
 * the pages people actually land on and share. The result page's id is imported
 * from the mock (the same constant `share.spec.ts` and `result.spec.ts` use) so
 * the two cannot drift apart; S16 added the preset page, which is where the
 * sprint's 170 KB script budget was always meant to be measured. Its budget is a
 * literal because this file is CommonJS and the committed preset fixtures are
 * TypeScript — but the harness probes every URL below for a 200 at its own path,
 * so a fixture whose budget moved fails loudly instead of measuring a 404.
 * `scripts/lighthouse-ci.mjs` starts the built app and the mock before this
 * config is read — `lhci autorun` on its own would measure whatever happens to
 * be listening, which is how a budget quietly becomes a lie.
 * * ENFORCED, per S19: all four assertions are `error`, so a regression fails the
 * web job instead of only decorating its artifact. They were `warn` from S6
 * until the budgets had run on a few real runners (2026-10-21).
 *
 * `aggregationMethod: "median"` is part of the enforcement, not a detail: with
 * LHCI's default (`optimistic`, the MINIMUM of three runs for a max-assertion)
 * one 3.09 s sample passed a 2.5 s budget because two samples were 2.36 s. A
 * budget that reports its best run is not a budget. The median of the three is
 * what the next sample most resembles.
 * * 170 KB is 174 080 bytes — S6's hypothesis, measured as TRANSFER size (so
 * compression counts). `resource-summary:script:size` is the closest audit LHCI
 * can assert on: it counts the JavaScript the page actually fetched, which is
 * what "initial JS" means for a server-rendered route.
 *
 * `categories:performance` >= 0.90 is S26's DoD line — "Lighthouse mobile >= 90 on
 * preset pages, asserted in CI" — and it is NOT redundant with the three metrics
 * above. A page can hold every one of them and still fall below 90 on the audits
 * nobody budgeted (total blocking time, speed index, first contentful paint), so
 * the three answer "did the things we measured regress" while the score answers
 * "is the page fast", which is what the exit gate actually promises. `minScore`
 * takes the 0..1 category score, not a 0..100 number: 0.9 is 90.
 */
const { IDS } = require("./mock/fixtures.mjs");

const APP_ORIGIN = "http://localhost:3210";

module.exports = {
  ci: {
    collect: {
      url: [
        `${APP_ORIGIN}/fr/config/${IDS.threeBuilds}`,
        // S16: a PRESET page (the 9000 MAD committed fixture), so the DoD's
        // script budget is enforced on the SEO surface too.
        `${APP_ORIGIN}/fr/config-pc-gamer-9000-dh`,
      ],
      // Three runs, so the assertion can take a median instead of one unlucky
      // sample (see the header: `optimistic` would report the best run).
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
      // One aggregation for all four, so no assertion can drift back to the
      // optimistic default on its own.
      aggregationMethod: "median",
      assertions: {
        "largest-contentful-paint": ["error", { maxNumericValue: 2500 }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
        "resource-summary:script:size": ["error", { maxNumericValue: 174080 }],
        // S26's exit gate: the category SCORE, taken as the median of the three
        // runs like every other assertion here.
        "categories:performance": ["error", { minScore: 0.9 }],
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
