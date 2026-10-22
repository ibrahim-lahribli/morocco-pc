/**
 * apps/web/e2e/states.spec.ts — S22's "one primitive, one voice" gate.
 *
 * The DoD is a sentence about sameness: "All error/empty states share the Alert
 * primitive and consistent voice." A copy review cannot hold that (it drifts the
 * next time someone needs a notice), so the parts that CAN be mechanical are
 * asserted here, state by state, on `data-tone` — the attribute the primitive
 * sets and a bespoke `<p>` cannot fake:
 *
 *   - a state that appears as the result of an ACTION is a live region (the
 *     clamp says which bound moved the number; it is spoken);
 *   - a state that is simply TRUE on load is NOT one (a zero-build result is a
 *     result, and announcing it on arrival would interrupt a screen reader for
 *     nothing) — that is the discipline `alert.tsx`'s header describes;
 *   - a refusal is an `error` tone and interrupts, because the reader's next
 *     click may be wrong.
 *
 * The copy review itself — every sentence checked for active voice and for
 * naming the fix — is `docs/design/STATES.md`, which lists each state with the
 * spec that pins it. This file is the half that fails when someone adds a state
 * in its own markup.
 */
import { expect, test, type Page } from "@playwright/test";

import { IDS, META_OPTIONS } from "../mock/fixtures.mjs";

const JSON_HEADERS = { "access-control-allow-origin": "*" };

/** The options list, so the wizard renders a step instead of its skeleton. */
async function serveMeta(page: Page): Promise<void> {
  await page.route("**/v1/meta/options*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: JSON_HEADERS,
      body: JSON.stringify(META_OPTIONS),
    }),
  );
}

test("a clamp is announced, and drawn by the alert primitive", async ({ page }) => {
  await serveMeta(page);
  await page.goto("/fr/configurer?etape=budget&use_case=GAMING");

  const field = page.getByLabel("Votre enveloppe cible");
  await field.fill("200");
  await field.blur();

  // One node, both properties: the primitive's tone and the live region that
  // makes it speak. Before S22 this was a bare `<p>` with the same sentence.
  const notice = page.locator('[data-tone="warning"][role="status"]');
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText(/Le minimum est/);
});

test("a zero-build result is a result: warning tone, and not a live region", async ({ page }) => {
  await page.goto(`/fr/config/${IDS.zeroBuild}`);

  const advice = page.locator('[data-tone="warning"]').first();
  await expect(advice).toBeVisible();
  // Static on load, so it must NOT be a `role="status"`: that would announce a
  // sentence the reader has not asked for, again on every re-render.
  await expect(advice).not.toHaveAttribute("role", "status");
});

test("a rate-limited submit is a warning, announced because an action caused it", async ({
  page,
}) => {
  await serveMeta(page);
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
      status: 429,
      contentType: "application/json",
      headers: {
        ...JSON_HEADERS,
        // The header the API exposes on purpose (V10); without it the countdown
        // could not exist, and this spec would pass against a mock that lies.
        "retry-after": "30",
        "access-control-expose-headers": "retry-after,x-request-id",
      },
      body: JSON.stringify({ code: "RATE_LIMITED", message: "slow down" }),
    });
  });

  await page.goto(
    "/fr/configurer?etape=priority&use_case=GAMING&budget_amount=9000&resolution=1440p&priority=3",
  );
  await page.getByRole("button", { name: "Voir mes configurations" }).click();

  // WARNING, not error: a countdown resolves itself, which is the difference
  // S10 drew. It is still a live region, because it appeared in answer to the
  // reader's click — the rule `alert.tsx` states for a warning that results from
  // an action (S22 wires that role).
  const refusal = page.locator('[data-tone="warning"][role="status"]');
  await expect(refusal).toHaveCount(1);
  await expect(refusal).toContainText(/Trop de demandes/);
});

test("an options failure is an error tone with its fix next to it", async ({ page }) => {
  // No route: the browser's API base is the mock on 3000, so this asks for a
  // path the fixture server does not serve and the wizard's own catch runs.
  await page.route("**/v1/meta/options*", (route) => route.abort("failed"));
  await page.goto("/fr/configurer?etape=usage");

  const failure = page.locator('[data-tone="error"]');
  await expect(failure).toHaveAttribute("role", "alert");
  await expect(failure).toContainText(/Les options n'ont pas pu être chargées/);
  // The fix — "check your connection, then retry" — and the control that does it.
  await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
});
