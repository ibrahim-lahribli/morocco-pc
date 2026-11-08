/**
 * Real-API verification for the Step 3.5 homepage.
 *
 * THIS IS NOT A CI GATE. It needs a served production build pointed at a REAL
 * recommendation API, so it cannot run in the pull-request job (which has no
 * database and no API). Its evidence is real API evidence; the fixture-backed
 * numbers in `docs/screenshots/step-3-5/after/` are a different thing and the
 * two are never interchangeable.
 *
 * Prerequisites, in two terminals:
 *
 *   1. an API answering, with this app's origin in its ALLOWED_ORIGINS:
 *        cd <repo root> && ALLOWED_ORIGINS=http://localhost:3220 npm run start:api
 *      (the API refuses to start against the shared database; the TEST branch
 *      is the sanctioned target, and `node scripts/generate-presets.js --commit`
 *      is what gives it a preset ladder to serve)
 *
 *   2. this app built against that API and served on port 3220:
 *        cd apps/web-v2
 *        NEXT_PUBLIC_API_BASE_URL=http://localhost:3000 npm run build
 *        NEXT_PUBLIC_API_BASE_URL=http://localhost:3000 npm run start
 *
 * Then:
 *
 *   VERIFY_BASE_URL=http://localhost:3220 node scripts/verify-real-api.mjs
 *
 * What it proves, in order:
 *   1. the initial Gaming recommendation renders the SERVED score, price, badge
 *      and component pills (cross-checked against the JSON the browser received,
 *      not against a second API call);
 *   2. the request set is exactly one meta read, one ladder per use case and one
 *      detail per rendered card, with no duplicate, no 4xx/5xx and no console
 *      error;
 *   3. switching the finder to OFFICE narrows to the OFFICE card, leaves the
 *      hero's Gaming preview untouched and issues no new ladder read;
 *   4. French and Arabic both format the score and the price per locale, `/ar`
 *      is `dir="rtl"`, and neither locale overflows at 360 px.
 *
 * Output is a PASS/FAIL line per check plus a summary; exit 1 on any failure.
 * No credential, cookie, header or request body is printed — only paths, status
 * codes and the public response fields the UI renders.
 */
import { chromium } from "@playwright/test";

const baseUrl = process.env.VERIFY_BASE_URL ?? "http://localhost:3220";
const CEILING = 12_000;
const NBSP = "\u00a0";
/** The currency suffix the dictionaries use; the API's own `currency` is the code. */
const CURRENCY_LABEL = { fr: "DH", ar: "د.م." };

const failures = [];
const checks = [];

function check(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
  if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

const normalize = (value) => (value ?? "").replace(/[\s\u00a0\u202f\u2009]+/g, " ").trim();

function groupNumber(value) {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

function formatPrice(value, currency) {
  return `${groupNumber(value)}${NBSP}${currency}`;
}

function formatScore(value, locale) {
  return value.toFixed(1).replace(".", locale === "fr" ? "," : ".");
}

function highestAtOrBelow(presets, ceiling) {
  let selected = null;
  for (const preset of presets) {
    if (preset.budget_amount > ceiling) continue;
    if (selected === null || preset.budget_amount > selected.budget_amount) selected = preset;
  }
  return selected;
}

/** One page session with the network/console evidence the checks read. */
async function session(browser, { locale, width }) {
  const context = await browser.newContext({
    viewport: { width, height: width < 640 ? 844 : 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();

  const requests = [];
  const responses = [];
  const failed = [];
  const consoleErrors = [];
  const presets = new Map();
  const details = new Map();

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/v1/")) {
      requests.push({ method: request.method(), path: `${url.pathname}${url.search}` });
    }
  });
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/v1/")) return;
    responses.push({ path: `${url.pathname}${url.search}`, status: response.status() });
    if (response.status() >= 400) return;
    try {
      if (url.pathname === "/v1/presets") {
        presets.set(url.searchParams.get("use_case"), await response.json());
      } else if (url.pathname.startsWith("/v1/recommendations/")) {
        details.set(decodeURIComponent(url.pathname.split("/").pop()), await response.json());
      }
    } catch {
      // A body that cannot be read is a failure the caller asserts on separately.
    }
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/v1/")) {
      failed.push(`${url.pathname}${url.search} ${request.failure()?.errorText ?? ""}`.trim());
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto(`${baseUrl}/${locale}`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => {
      const section = document.querySelector("#configurations");
      const hero = document.querySelector("[data-testid='hero-preview']");
      if (section === null || hero === null) return false;
      if (section.querySelector("[aria-busy='true']") !== null) return false;
      return hero.querySelector("[aria-busy='true']") === null;
    },
    undefined,
    { timeout: 45_000 },
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });

  return { context, page, requests, responses, failed, consoleErrors, presets, details };
}

async function readCards(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("#configurations article")].map((article) => {
      const values = [...article.querySelectorAll("dl dd")].map((dd) => ({
        text: (dd.textContent ?? "").trim(),
        label: dd.getAttribute("aria-label"),
      }));
      return {
        title: (article.querySelector("h3")?.textContent ?? "").trim(),
        badge: (article.querySelector("[data-slot='badge']")?.textContent ?? "").trim(),
        values,
        pills: [...article.querySelectorAll("ul li")].map((li) => (li.textContent ?? "").trim()),
        cta: article.querySelector("a[href*='/configurateur']")?.getAttribute("href") ?? null,
      };
    }),
  );
}

async function readHero(page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-testid='hero-preview']");
    const text = (selector) => (root?.querySelector(selector)?.textContent ?? "").trim();
    return {
      state: root?.getAttribute("data-hero-state") ?? null,
      score: text("[data-testid='hero-preview-score']"),
      price: text("[data-testid='hero-preview-price']"),
      title: text("[data-testid='hero-preview-title']"),
      visible: root !== null && root.getClientRects().length > 0,
    };
  });
}

const browser = await chromium.launch();
try {
  // ---------------------------------------------------------------- French, desktop
  const fr = await session(browser, { locale: "fr", width: 1280 });

  // 1. request set
  const metaReads = fr.requests.filter((r) => r.path === "/v1/meta/options");
  const ladderReads = fr.requests.filter((r) => r.path.startsWith("/v1/presets?"));
  const detailReads = fr.requests.filter((r) => r.path.startsWith("/v1/recommendations/"));
  check("one meta/options read", metaReads.length === 1, `saw ${metaReads.length}`);
  for (const useCase of ["GAMING", "OFFICE", "WORKSTATION"]) {
    const reads = ladderReads.filter((r) => r.path.includes(`use_case=${useCase}`));
    check(
      `one ${useCase} ladder read`,
      reads.length === 1,
      `saw ${reads.length}: ${reads.map((r) => r.path).join(", ")}`,
    );
  }
  check("one detail read per rendered card", detailReads.length === 3, `saw ${detailReads.length}`);
  check(
    "no duplicate request",
    new Set(fr.requests.map((r) => `${r.method} ${r.path}`)).size === fr.requests.length,
    fr.requests.map((r) => r.path).join(", "),
  );
  check("no failed request", fr.failed.length === 0, fr.failed.join(", "));
  check(
    "no 4xx/5xx response",
    fr.responses.every((r) => r.status < 400),
    fr.responses
      .filter((r) => r.status >= 400)
      .map((r) => `${r.path} ${r.status}`)
      .join(", "),
  );
  check("no console error", fr.consoleErrors.length === 0, fr.consoleErrors.join(" | "));

  // 2. the hero renders the SERVED Gaming build at the 12 000 ceiling
  const gamingPresets = fr.presets.get("GAMING")?.presets ?? [];
  const gamingPreset = highestAtOrBelow(gamingPresets, CEILING);
  check("the served GAMING ladder has a preset at or below 12 000", gamingPreset !== null);
  if (gamingPreset !== null) {
    const detail = fr.details.get(gamingPreset.recommendation_id);
    const build = detail?.builds?.[0] ?? null;
    const hero = await readHero(fr.page);
    check("the hero is in its ready state", hero.state === "ready", `state=${hero.state}`);
    check(
      "the hero score is the served rank-1 score",
      build !== null && hero.score.includes(`${formatScore(build.build_score, "fr")}/100`),
      `rendered "${hero.score}"`,
    );
    check(
      "the hero price is the served rank-1 total",
      build !== null &&
        normalize(hero.price) === normalize(formatPrice(build.total_price, CURRENCY_LABEL.fr)),
      `rendered "${normalize(hero.price)}"`,
    );
  }

  // 3. every card renders its own served build
  const cards = await readCards(fr.page);
  check("three cards rendered", cards.length === 3, `saw ${cards.length}`);
  const expectedTitles = ["PC Gaming", "PC Bureautique", "PC Création & Professionnel"];
  for (const [index, useCase] of ["GAMING", "OFFICE", "WORKSTATION"].entries()) {
    const ladder = fr.presets.get(useCase)?.presets ?? [];
    const preset = highestAtOrBelow(ladder, CEILING);
    const detail = preset === null ? null : fr.details.get(preset.recommendation_id);
    const build = detail?.builds?.[0] ?? null;
    const card = cards[index];
    check(`${useCase} card title`, card?.title === expectedTitles[index], `saw "${card?.title}"`);
    if (build === null || card === undefined) {
      check(`${useCase} card has a served build`, false, "no detail");
      continue;
    }
    check(
      `${useCase} card score`,
      card.values[0]?.text.includes(formatScore(build.build_score, "fr")),
      `saw "${card.values[0]?.text}"`,
    );
    check(
      `${useCase} card price`,
      card.values[1]?.label === formatPrice(build.total_price, CURRENCY_LABEL.fr),
      `saw "${card.values[1]?.label}"`,
    );
    const badge = build.price_status === "verified" ? "Prix vérifié" : "Prix indicatif";
    check(`${useCase} card badge`, card.badge === badge, `saw "${card.badge}"`);
    const expectedPills = build.components
      .filter((component) => ["CPU", "GPU", "RAM", "SSD_BOOT"].includes(component.role))
      .map((component) => component.name);
    check(
      `${useCase} card pills are the served component names`,
      expectedPills.every((name) => card.pills.includes(name)),
      `rendered [${card.pills.join(" | ")}]`,
    );
    check(
      `${useCase} card CTA carries the served tier`,
      card.cta === `/fr/configurateur?use_case=${useCase}&budget=${preset.budget_amount}`,
      `saw "${card.cta}"`,
    );
  }

  // 4. switching to OFFICE narrows the section, keeps the hero, fetches nothing new
  const before = {
    ladders: fr.requests.filter((r) => r.path.startsWith("/v1/presets?")).length,
    details: fr.requests.filter((r) => r.path.startsWith("/v1/recommendations/")).length,
    hero: await readHero(fr.page),
  };
  await fr.page.getByRole("radio", { name: /Études et bureautique/ }).check({ force: true });
  await fr.page.waitForFunction(
    () => document.querySelectorAll("#configurations article").length === 1,
    undefined,
    { timeout: 15_000 },
  );
  const officeCards = await readCards(fr.page);
  const afterHero = await readHero(fr.page);
  check("switching to OFFICE leaves exactly one card", officeCards.length === 1);
  check("the remaining card is the OFFICE one", officeCards[0]?.title === "PC Bureautique");
  check(
    "the hero keeps its Gaming score",
    afterHero.score === before.hero.score && afterHero.price === before.hero.price,
    `${before.hero.score} -> ${afterHero.score}`,
  );
  check(
    "no new ladder or detail read on the switch",
    fr.requests.filter((r) => r.path.startsWith("/v1/presets?")).length === before.ladders &&
      fr.requests.filter((r) => r.path.startsWith("/v1/recommendations/")).length ===
        before.details,
    "a cache miss would show here",
  );
  check("no console error after the switch", fr.consoleErrors.length === 0);

  // 5. the EMPTY state, from real data: the ladder has no tier at or below 3 500
  const detailsBeforeEmpty = fr.requests.filter((r) =>
    r.path.startsWith("/v1/recommendations/"),
  ).length;
  await fr.page.getByRole("radio", { name: /Jeux vidéo & Gaming/ }).check({ force: true });
  await fr.page.getByRole("spinbutton", { name: "Budget exact en dirhams" }).fill("3500");
  await fr.page
    .getByText("Aucune configuration disponible pour cet usage")
    .waitFor({ timeout: 15_000 });
  const emptyCards = await readCards(fr.page);
  check("a below-cheapest budget shows the empty slot", emptyCards.length === 1);
  check(
    "the empty slot renders no price",
    emptyCards[0]?.values.length === 0,
    `saw ${JSON.stringify(emptyCards[0]?.values)}`,
  );
  check(
    "the empty slot issues no detail read",
    fr.requests.filter((r) => r.path.startsWith("/v1/recommendations/")).length ===
      detailsBeforeEmpty,
    "a detail read for a missing preset would be a request the API never needs",
  );

  // 6. the card CTA opens the configurator carrying the two answers (Task 3's
  //    approved contract: use_case + served tier, no pass id, so the panel is
  //    honestly empty until the visitor submits — it invents no build).
  await fr.page.getByRole("spinbutton", { name: "Budget exact en dirhams" }).fill("12000");
  await fr.page.getByRole("link", { name: "Voir la configuration" }).first().click();
  await fr.page.waitForURL(/\/fr\/configurateur\?use_case=GAMING&budget=12000$/, {
    timeout: 20_000,
  });
  await fr.page.locator('[data-slot="build-summary"]').waitFor({ timeout: 30_000 });
  check(
    "the configurator opens on the handed use case",
    await fr.page.getByRole("radio", { name: /Jeux vidéo & Gaming/ }).isChecked(),
  );
  check(
    "the configurator opens on the served tier",
    (await fr.page.getByRole("spinbutton", { name: "Budget (DH)" }).inputValue()) === "12000",
  );
  const summary = await fr.page.evaluate(() => {
    const root = document.querySelector('[data-slot="build-summary"]');
    return {
      text: (root?.textContent ?? "").replace(/\s+/g, " ").trim(),
      values: [...(root?.querySelectorAll("dl dd") ?? [])].map((dd) => ({
        text: (dd.textContent ?? "").trim(),
        label: dd.getAttribute("aria-label"),
      })),
    };
  });
  check(
    "the configurator invents no build before a submit",
    summary.values.length === 0,
    `summary "${summary.text.slice(0, 120)}"`,
  );
  check("no console error on the configurator", fr.consoleErrors.length === 0);
  await fr.context.close();

  // ---------------------------------------------------------------- Arabic, desktop
  const ar = await session(browser, { locale: "ar", width: 1280 });
  const arHero = await readHero(ar.page);
  const arDir = await ar.page.evaluate(() => document.documentElement.dir);
  const arPreset = highestAtOrBelow(ar.presets.get("GAMING")?.presets ?? [], CEILING);
  const arBuild =
    arPreset === null ? null : (ar.details.get(arPreset.recommendation_id)?.builds?.[0] ?? null);
  check("Arabic document is rtl", arDir === "rtl", `dir=${arDir}`);
  check(
    "Arabic hero score uses the decimal point",
    arBuild !== null && arHero.score.includes(`${formatScore(arBuild.build_score, "ar")}/100`),
    `rendered "${arHero.score}"`,
  );
  check(
    "Arabic hero price carries the Arabic currency suffix",
    normalize(arHero.price).endsWith("د.م."),
    `rendered "${normalize(arHero.price)}"`,
  );
  check("no console error on /ar", ar.consoleErrors.length === 0, ar.consoleErrors.join(" | "));
  check("no failed request on /ar", ar.failed.length === 0, ar.failed.join(", "));
  await ar.context.close();

  // ---------------------------------------------------------------- 360 px, both locales
  for (const locale of ["fr", "ar"]) {
    const narrow = await session(browser, { locale, width: 360 });
    const overflow = await narrow.page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`no horizontal overflow at 360 (${locale})`, overflow <= 0, `${overflow}px`);
    const navRight = await narrow.page.evaluate(() =>
      Math.max(
        ...[...document.querySelectorAll("[data-slot='mobile-nav'] li")].map((li) =>
          Math.round(li.getBoundingClientRect().right),
        ),
      ),
    );
    check(`the mobile nav fits at 360 (${locale})`, navRight <= 360, `right edge ${navRight}px`);
    check(
      `no console error at 360 (${locale})`,
      narrow.consoleErrors.length === 0,
      narrow.consoleErrors.join(" | "),
    );
    await narrow.context.close();
  }
} finally {
  await browser.close();
}

for (const result of checks) {
  console.log(
    `${result.ok ? "PASS" : "FAIL"}  ${result.name}${result.ok ? "" : ` — ${result.detail}`}`,
  );
}
const passed = checks.filter((c) => c.ok).length;
console.log(
  `\n${passed}/${checks.length} checks passed against ${baseUrl} (REAL API evidence, not fixtures)`,
);
if (failures.length > 0) process.exitCode = 1;
