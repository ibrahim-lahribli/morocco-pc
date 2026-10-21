/**
 * apps/web/e2e/share.spec.ts — S15's proof: one canonical URL, three channels.
 *
 * The results page is server-rendered, so the state selector stays the fixture
 * id in the URL, exactly as result.spec.ts established. The four sprint
 * scenarios map to:
 *
 *   1. the wa.me anchor's `text` decodes to the honest sentence with the true
 *      total, the badge's word, and the canonical absolute URL;
 *   2. with the Web Share API removed, the copy fallback writes the canonical
 *      URL and the empty live region announces it;
 *   3. the raw HTML carries og:title (with the total and the word),
 *      og:description, og:url, og:image, twitter:card, and noindex;
 *   4. the preview image route answers PNG with an exact-size declaration and
 *      a bounded byte cost.
 *
 * The model half pins the URL math without a browser: the id is never allowed
 * to become part of the authority.
 */

import { test, expect } from "@playwright/test";

import { formatMoney } from "../lib/i18n/format";
import { absoluteResultUrl, waMeHref } from "../lib/result/share";
import { IDS, RECOMMENDATION_OVER_BUDGET, RECOMMENDATION_THREE_BUILDS } from "../mock/fixtures.mjs";

const money = (amount: number) => formatMoney(amount, "fr");

const THREE = `/fr/config/${IDS.threeBuilds}`;
const OVER = `/fr/config/${IDS.overBudget}`;
const ZERO = `/fr/config/${IDS.zeroBuild}`;

const ORIGIN = "http://localhost:3210";
const canonical = (id: string) => absoluteResultUrl(ORIGIN, "fr", id);

// ---------------------------------------------------------------------------
// The URL math, without a browser
// ---------------------------------------------------------------------------

test("the canonical URL is locale-absolute and the id can never become the authority", () => {
  expect(absoluteResultUrl(ORIGIN, "fr", IDS.threeBuilds)).toBe(
    ORIGIN + "/fr/config/" + IDS.threeBuilds,
  );
  // A slash, a question mark or a paragraph break in the id stays data.
  expect(absoluteResultUrl(ORIGIN, "ar", "../et?x")).toBe(
    ORIGIN + "/ar/config/..%2Fet%3Fx",
  );
  // The wa.me intent encodes the whole text, once.
  const text = "Salut / ? é:https://x";
  expect(waMeHref(text)).toBe("https://wa.me/?text=Salut%20%2F%20%3F%20%C3%A9%3Ahttps%3A%2F%2Fx");
});

// ---------------------------------------------------------------------------
// Scenario 1 — the WhatsApp anchor's pre-filled text is the honest one
// ---------------------------------------------------------------------------

test("the wa.me link decodes to the true total, the badge word and the canonical URL", async ({
  page,
}) => {
  await page.goto(THREE);

  const link = page.getByRole("link", { name: "Partager sur WhatsApp" });
  await expect(link).toBeVisible();
  // It must be a link: real href, real new-tab semantics, no opener leak.
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);

  const href = await link.getAttribute("href");
  expect(href).not.toBeNull();
  const parsed = new URL(href as string);
  expect(parsed.origin + parsed.pathname).toBe("https://wa.me/");
  const decoded = parsed.searchParams.get("text") ?? "";
  const total = RECOMMENDATION_THREE_BUILDS.builds[0].total_price as number;
  const budget = RECOMMENDATION_THREE_BUILDS.budget_amount as number;
  const url = canonical(IDS.threeBuilds);

  expect(decoded).toBe(
    `Ma configuration PC : ${money(total)} sur un budget de ${money(budget)} (vérifié) — ${url}`,
  );
  // And a preview crop can never disagree with the badge: the total is the
  // first build's own number, not a pass-wide invention.
  expect(decoded).toContain(money(total));
  expect(decoded).not.toContain("Seed");
});

// ---------------------------------------------------------------------------
// Scenario 2 — no Web Share API: the copy fallback writes and announces
// ---------------------------------------------------------------------------

test("without the Web Share API the copy button writes the canonical URL and announces it", async ({
  page,
}) => {
  // Playwright's desktop Chromium has no clipboard write by default; both
  // scenarios prove the honest names before the grating permissions are added.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  // The Web Share API is REMOVED, not stubbed off: the feature check after
  // hydration must see the absence, so the fallback is what a user gets.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { get: () => undefined });
  });

  await page.goto(THREE);

  // The native button only exists when the API does — revealed after mount.
  await expect(page.getByRole("button", { name: "Partager", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Copier le lien" }).click();
  await expect(page.locator('[aria-live="polite"]')).toHaveText("Lien copié.");

  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(canonical(IDS.threeBuilds));
});

test("with the Web Share API present the third button shares via it, not via a copy", async ({
  page,
}) => {
  await page.addInitScript(() => {
    type ShareCall = { text: string; url: string };
    const calls: ShareCall[] = [];
    (window as unknown as { __shareCalls: ShareCall[] }).__shareCalls = calls;
    Object.defineProperty(navigator, "share", {
      value: (payload: ShareCall) => {
        calls.push(payload);
        return Promise.resolve();
      },
      writable: true,
    });
  });

  await page.goto(THREE);
  const native = page.getByRole("button", { name: "Partager", exact: true });
  await expect(native).toBeVisible();
  await native.click();

  const calls = await page.evaluate(() => {
    const w = window as unknown as {
      __shareCalls: { text: string; url: string }[];
    };
    return JSON.stringify(w.__shareCalls);
  });
  const share = JSON.parse(calls) as { text: string; url: string }[];
  expect(share).toHaveLength(1);
  const total = RECOMMENDATION_THREE_BUILDS.builds[0].total_price as number;
  expect(share[0].url).toBe(canonical(IDS.threeBuilds));
  expect(share[0].text).toContain(money(total));
  // Success through the sheet announces nothing: no false "copied".
  await expect(page.locator('[aria-live="polite"]')).toHaveText("");
});

// ---------------------------------------------------------------------------
// Scenario 3 — the shared link's meta tags are the honest ones, and noindex
// ---------------------------------------------------------------------------

test("the shared link carries og/twitter meta with the real total and the word, and stays noindex", async ({
  request,
}) => {
  const response = await request.get(THREE);
  expect(response.status()).toBe(200);
  const html = await response.text();
  const total = RECOMMENDATION_THREE_BUILDS.builds[0].total_price as number;
  const budget = RECOMMENDATION_THREE_BUILDS.budget_amount as number;

  // og:title: the DoD's honesty sentence — total + provenance word.
  const url = canonical(IDS.threeBuilds);
  const title = `Ma configuration PC : ${money(total)} sur un budget de ${money(budget)} (vérifié)`;
  expect(html).toContain(`property="og:title"`);
  expect(html).toContain(title);
  const desc =
    "Configuration compatible générée par morocco-pc pour le marché marocain. Prix en dirhams (DH).";
  expect(html).toContain(desc);
  expect(html).toContain(`name="description" content="${desc}"`);
  expect(html).toContain(`property="og:url" content="${url}"`);
  expect(html).toContain(`property="og:site_name" content="morocco-pc"`);
  expect(html).toContain(`name="twitter:card" content="summary_large_image"`);
  // The promise this sprint keeps from the plan: a user page is still noindex.
  expect(html).toMatch(/name="robots" content="[^"]*noindex/);

  // The words the badge would shout, not enums, not seed vocabulary.
  expect(html).not.toContain("SEED_UNVERIFIED");
  expect(html).not.toContain("indiquatif");
});

// ---------------------------------------------------------------------------
// Scenario 4 — the preview image is a real PNG of declared size, bounded cost
// ---------------------------------------------------------------------------

test("the og:image route serves a declared 1200x630 PNG at a bounded byte cost", async ({
  request,
}) => {
  const page = await request.get(THREE);
  const html = await page.text();
  const match = html.match(/property="og:image" content="([^"]+)"/);
  expect(match).not.toBeNull();
  const imageRef = (match as RegExpMatchArray)[1];
  // A base with a path would swallow the segment; pin the card where it lives.
  expect(imageRef).toContain("/fr/config/");
  expect(imageRef).toContain(IDS.threeBuilds);
  const image = new URL(imageRef, "http://localhost:3210");

  const response = await request.get(image.pathname + image.search);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/png");
  // Bounded: a card heavier than a quarter megabyte would slow every preview
  // crop on a 4G phone.
  expect((await response.body()).length).toBeLessThan(250_000);

  // Explicit dimensions in the meta, so a preview box never has to guess.
  expect(html).toContain(`property="og:image:width" content="1200"`);
  expect(html).toContain(`property="og:image:height" content="630"`);
  expect(html).toContain('property="og:image"');
});

// ---------------------------------------------------------------------------
// The states a share payload must NOT exist for
// ---------------------------------------------------------------------------

test("a zero-build pass has no share surface: there is nothing honest to advertise", async ({
  page,
}) => {
  await page.goto(ZERO);
  await expect(
    page.getByRole("group", { name: "Partager cette configuration" }),
  ).toHaveCount(0);
});

test("an over-budget pass still shares its own number and the word, never a smoothed one", async ({
  page,
}) => {
  await page.goto(OVER);
  const link = page.getByRole("link", { name: "Partager sur WhatsApp" });
  const href = await link.getAttribute("href");
  const decoded = decodeURIComponent((href ?? "").replace("https://wa.me/?text=", ""));
  const total = RECOMMENDATION_OVER_BUDGET.builds[0].total_price as number;
  // 8 594 DH past a 5 000 DH budget: the payload says the REAL number, and
  // every line of it is first-build truth (no pass-wide smoothing).
  expect(decoded).toContain(money(total));
  expect(decoded).toContain(canonical(IDS.overBudget));
});
