/**
 * apps/web/e2e/saved.spec.ts — S25's saved builds, in a real browser.
 *
 * The DoD's scenarios are the shape of this file:
 *
 *   1. save a build → it survives a reload, and the shelf lists it;
 *   2. clearing this browser's storage → the empty state, with its call to action;
 *   3. storage that refuses (private mode) or is full → an inline sentence, no
 *      crash, and nothing claimed to be saved.
 *
 * Everything is asserted through the SAME catalogue the pages read
 * (`messages/*.json`), so a rewording is one edit and a spec that still runs —
 * while a page that renders a raw key fails here, because the words would not
 * match.
 *
 * Each Playwright test gets a fresh context, so a save in one test can never be
 * the reason another passes; the shelf starts empty every time.
 */

import { test, expect, type Locator, type Page } from "@playwright/test";

import { formatDate } from "../lib/i18n/format";
import { IDS } from "../mock/fixtures.mjs";
import ar from "../messages/ar.json";
import fr from "../messages/fr.json";

const RESULT = `/fr/config/${IDS.threeBuilds}`;
const SHELF = "/fr/enregistrements";
const AR_SHELF = "/ar/enregistrements";

/** The shelf's rows: the footer's legal links are list items too, so scope to main. */
const rows = (page: Page) => page.locator("main li");

/** The first card of a result page — the primary build. */
const firstCard = (page: Page) => page.locator("article").first();

/**
 * Click a toggle until it reports the state we asked for.
 *
 * A click can land before hydration has attached the handler, and Playwright
 * cannot see hydration — so the click is repeated WITH the assertion instead of
 * the assertion alone being retried against a page that never heard the first
 * one. The block stops as soon as both hold, so a working click is never doubled.
 */
async function clickUntil(button: Locator, pressed: "true" | "false"): Promise<void> {
  await expect(async () => {
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", pressed);
  }).toPass();
}

/** The same, for an action whose only visible result is a sentence. */
async function clickUntilVisible(button: Locator, notice: Locator): Promise<void> {
  await expect(async () => {
    await button.click();
    await expect(notice).toBeVisible();
  }).toPass();
}

test("a saved build survives a reload, and the shelf lists it", async ({ page }) => {
  await page.goto(RESULT);
  const save = firstCard(page).getByRole("button", { name: fr.saved.save });

  await expect(save).toHaveAttribute("aria-pressed", "false");
  await clickUntil(save, "true");
  await expect(firstCard(page).getByText(fr.saved.saved)).toBeVisible();
  // Saving leads somewhere in the same breath: the shelf is one click away.
  await expect(firstCard(page).getByRole("link", { name: fr.saved.openShelf })).toHaveAttribute(
    "href",
    SHELF,
  );

  // A reload is a new document: the shelf is the only thing that remembers.
  await page.reload();
  await expect(firstCard(page).getByRole("button", { name: fr.saved.save })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.goto(SHELF);
  const row = rows(page).first();
  await expect(row).toContainText(fr.result.strategies.BALANCED);
  await expect(row.getByRole("link", { name: new RegExp(fr.saved.open) })).toHaveAttribute(
    "href",
    `/fr/config/${IDS.threeBuilds}`,
  );
  // A total is shown as the page recorded it, through the money helper.
  await expect(row).toContainText("DH");
});

test("two builds of one result are two entries", async ({ page }) => {
  await page.goto(RESULT);
  const cards = page.locator("article");
  await clickUntil(cards.nth(0).getByRole("button", { name: fr.saved.save }), "true");
  await clickUntil(cards.nth(1).getByRole("button", { name: fr.saved.save }), "true");

  await page.goto(SHELF);
  // One entry per (result, rank): two builds saved is two rows, not one.
  await expect(rows(page)).toHaveCount(2);
});

test("removing the last entry leaves the empty state and its way forward", async ({ page }) => {
  await page.goto(RESULT);
  await clickUntil(firstCard(page).getByRole("button", { name: fr.saved.save }), "true");

  await page.goto(SHELF);
  await expect(rows(page)).toHaveCount(1);

  await expect(async () => {
    await page.getByRole("button", { name: new RegExp(fr.saved.remove) }).click();
    await expect(page.getByRole("heading", { name: fr.saved.emptyTitle })).toBeVisible();
  }).toPass();

  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByRole("link", { name: fr.saved.emptyCta })).toHaveAttribute(
    "href",
    "/fr/configurer",
  );
});

test("removing a row leaves focus on the shelf, not on the body", async ({ page }) => {
  // The removed row owned the focus, so a keyboard user must be given somewhere
  // to be: the shelf itself, never `<body>` and never the next row's Retirer
  // (a held Enter would otherwise delete the shelf one item per keypress).
  await page.goto(RESULT);
  const cards = page.locator("article");
  await clickUntil(cards.nth(0).getByRole("button", { name: fr.saved.save }), "true");
  await clickUntil(cards.nth(1).getByRole("button", { name: fr.saved.save }), "true");

  await page.goto(SHELF);
  await expect(rows(page)).toHaveCount(2);

  await page.getByRole("button", { name: new RegExp(fr.saved.remove) }).first().click();
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator("main ul")).toBeFocused();

  await page.getByRole("button", { name: new RegExp(fr.saved.remove) }).click();
  await expect(page.getByRole("heading", { name: fr.saved.emptyTitle })).toBeVisible();
  await expect(page.locator("main div[data-shelf-focus]")).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
});

test("clearing this browser's storage is the empty state, not an error", async ({ page }) => {
  await page.goto(RESULT);
  await clickUntil(firstCard(page).getByRole("button", { name: fr.saved.save }), "true");

  await page.goto(SHELF);
  await expect(rows(page)).toHaveCount(1);

  // What a reader does when they clear site data: the page must recover, and
  // must not report an error it did not have. The recovery itself is asserted by
  // the three auto-retrying expectations below; that they run against the HYDRATED
  // page (and not the server's identical empty state) is proven by the absence of
  // a page error — a hydration that crashed throws before it could paint anything
  // else. `waitForLoadState("networkidle")` was the previous hydrator gate, and
  // turned hostile on master: the layout's prefetch of the (now ISR-revalidated)
  // home route starves networkidle for ~30 s on a reload, so the gate itself
  // became the failure instead of the state it was checking.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: fr.saved.emptyTitle })).toBeVisible();
  await expect(page.getByRole("link", { name: fr.saved.emptyCta })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a browser that refuses storage says nothing was saved, and does not crash", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Private mode / blocked storage: the write throws, the page keeps working.
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key: string, value: string): void {
      if (String(key).startsWith("morocco-pc:")) {
        throw new DOMException("denied", "SecurityError");
      }
      original.call(this, key, value);
    };
  });

  await page.goto(RESULT);
  const card = firstCard(page);
  const save = card.getByRole("button", { name: fr.saved.save });
  await clickUntilVisible(save, card.getByText(fr.saved.saveUnavailable));

  await expect(save).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});

test("a full device asks for room instead of pretending", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key: string, value: string): void {
      if (String(key).startsWith("morocco-pc:")) {
        throw new DOMException("no room", "QuotaExceededError");
      }
      original.call(this, key, value);
    };
  });

  await page.goto(RESULT);
  const card = firstCard(page);
  const save = card.getByRole("button", { name: fr.saved.save });
  await clickUntilVisible(save, card.getByText(fr.saved.full));

  await expect(save).toHaveAttribute("aria-pressed", "false");
});

test("a shelf that cannot read storage says so instead of claiming it is empty", async ({
  page,
}) => {
  await page.goto(RESULT);
  await clickUntil(firstCard(page).getByRole("button", { name: fr.saved.save }), "true");

  // Reads now fail for this app's key: the list exists and cannot be seen, which
  // is the one case where an empty state would be a claim the page cannot make.
  await page.addInitScript(() => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(key: string): string | null {
      if (String(key).startsWith("morocco-pc:")) {
        throw new DOMException("denied", "SecurityError");
      }
      return original.call(this, key);
    };
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(SHELF);
  await expect(page.getByText(fr.saved.readUnavailable)).toBeVisible();
  await expect(page.getByRole("heading", { name: fr.saved.emptyTitle })).toHaveCount(0);
  await expect(page.getByRole("link", { name: fr.saved.emptyCta })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a corrupt stored entry is dropped instead of breaking the shelf", async ({ page }) => {
  // A hand-edited store, or one written by a future shape: the good record
  // survives, the unformattable date does not, and the page still renders.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "morocco-pc:saved-builds:v1",
      JSON.stringify([
        { id: "broken", rank: 1, strategyKey: "BALANCED", totalPrice: 1, savedAt: "not-a-date" },
        {
          id: "fixture-result",
          rank: 2,
          strategyKey: "PERFORMANCE",
          totalPrice: 9000,
          savedAt: "2026-10-22T18:00:00.000Z",
        },
      ]),
    );
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(SHELF);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText(fr.result.strategies.PERFORMANCE);
  await expect(page.getByRole("heading", { name: fr.saved.emptyTitle })).toHaveCount(0);
  await expect(page.getByText(fr.saved.readUnavailable)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the Arabic shelf is Arabic, and the date is the locale's own", async ({ page }) => {
  await page.goto(`/ar/config/${IDS.threeBuilds}`);
  await clickUntil(firstCard(page).getByRole("button", { name: ar.saved.save }), "true");

  await page.goto(AR_SHELF);
  await expect(page.getByRole("heading", { level: 1, name: ar.saved.title })).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).direction)).toBe("rtl");

  // The stored value is an ISO string; what the page prints is the ARABIC date,
  // so the entry cannot be a French month on an Arabic page.
  const row = rows(page).first();
  await expect(row).toContainText(ar.saved.savedOnLabel);
  const time = row.locator("time").first();
  const iso = await time.getAttribute("datetime");
  expect(iso).not.toBeNull();
  expect((await time.textContent())?.trim()).toBe(formatDate(iso as string, "ar"));
});

test("the shelf stays out of the index", async ({ request }) => {
  const response = await request.get(SHELF);
  expect(response.status()).toBe(200);
  expect(await response.text()).toMatch(/name="robots"[^>]*noindex/);
});
