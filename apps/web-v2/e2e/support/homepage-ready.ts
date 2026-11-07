import { expect, type Page } from "@playwright/test";

/**
 * Wait for the homepage's recommended configurations to reach their final layout.
 *
 * Shared by every spec that measures the finished page: the Arabic overflow
 * sweep and the phone-card spec both assert on a grid that only reaches its
 * final width once the detail read has filled the cards in. Until then the
 * cards are skeletons and the grid's implicit track is still clamped to its
 * container, so the page reads as overflowing by nothing — measured before
 * `grid-cols-1`, the track was 328 px while the cards were skeletons and
 * 350.7 px once a price landed. A price is the last thing a card renders, so
 * waiting for it measures the layout the visitor gets.
 */
export async function waitForSettledCards(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("#configurations article dd").last()).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/** Page-level horizontal overflow, in pixels; `<= 0` means none. */
export function horizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}
