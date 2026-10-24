/**
 * apps/web/e2e/wizard-steps.spec.ts — S9's proof.
 *
 * S9 makes the FLOW profile-dependent, so these specs are about which questions
 * exist and what is said about them, not about a control's geometry (S8 owns
 * that). Three rules are pinned:
 *
 *   1. The resolution question is a gaming question. An office profile walks
 *      three steps, and a URL that names the missing step lands forwards, not on
 *      a screen the profile does not have.
 *   2. The priority question offers THREE of the contract's five answers. The
 *      mock below deliberately serves the real API's `1..5` list, so a filter
 *      that stopped working would show five radios and fail here.
 *   3. With `inputs_applied` absent from the contract (CD-1, today's state) both
 *      questions say the answer is stored rather than used, and the sentence is
 *      attached to the GROUP as its description. A contract that marks an input
 *      applied turns the label off and — because it declared the other input
 *      inert — drops that step entirely.
 *
 * `meta/options` is intercepted for the reason S7's spec gives: `NEXT_PUBLIC_*`
 * is inlined at build time, so only `page.route` can vary the contract per test.
 */

import { test, expect, type Page } from "@playwright/test";

import { META_OPTIONS } from "../mock/fixtures.mjs";

const META_ROUTE = "**/v1/meta/options*";
const JSON_HEADERS = { "access-control-allow-origin": "*" };

const STORED_FR = "Ce choix est enregistré, mais il ne change pas encore les configurations proposées.";
const STORED_AR = "يُحفظ هذا الاختيار، لكنه لا يغيّر التجميعات المقترحة بعد.";

/**
 * The API's own five priorities (`apps/api/src/meta.js`), NOT the fixture's
 * three: this is the contract the wizard narrows, and a test that fed it the
 * already-narrowed list could not tell a filter from a copy.
 */
const META_FIVE_PRIORITIES = {
  ...META_OPTIONS,
  priorities: [
    { value: 1, label: "Prix avant tout" },
    { value: 2, label: "Plutôt le prix" },
    { value: 3, label: "Équilibré" },
    { value: 4, label: "Plutôt la performance" },
    { value: 5, label: "Performance avant tout" },
  ],
};

/** A contract that answers CD-1: only priority changes a result. */
const META_PRIORITY_APPLIED = { ...META_OPTIONS, inputs_applied: ["priority"] };

/**
 * The SAME option lists with `inputs_applied` absent: a 1.6 server, i.e. the
 * "contract is silent" path `lib/wizard/applied.ts` must still handle. The
 * fixture itself carries the field (it models the current API), so the older
 * shape is built here rather than left in the shared fixtures as the default.
 */
const META_SILENT = Object.fromEntries(
  Object.entries(META_OPTIONS).filter(([key]) => key !== "inputs_applied"),
);

async function serveMeta(page: Page, body: unknown = META_OPTIONS): Promise<void> {
  await page.route(META_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }),
  );
}

test("gaming asks where the picture goes; office never does", async ({ page }) => {
  await serveMeta(page);

  await page.goto("/fr/configurer?etape=resolution&use_case=GAMING&budget_amount=7300");
  await expect(page.getByText("Étape 3 sur 4")).toBeVisible();
  await expect(page.getByRole("group", { name: "Quelle résolution visez-vous ?" })).toBeVisible();

  await page.goto("/fr/configurer?etape=budget&use_case=OFFICE&budget_amount=7300");
  // Three steps, and the third one is the priorities: the resolution question
  // does not exist for this profile.
  await expect(page.getByText("Étape 2 sur 3")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Écran" })).toHaveCount(0);

  await page.getByRole("button", { name: "Suivant" }).click();
  await expect(page).toHaveURL(/etape=priority/);
  await expect(page.getByText("Étape 3 sur 3")).toBeVisible();
  await expect(page.getByRole("group", { name: "Qu'est-ce qui compte le plus ?" })).toBeVisible();
});

test("a URL naming the missing step lands forwards, not on a screen the profile lacks", async ({
  page,
}) => {
  await serveMeta(page);

  // The resolution step is step 3 of the gaming flow; for an office profile the
  // honest landing place is the first step at or after that position.
  await page.goto("/fr/configurer?etape=resolution&use_case=OFFICE&budget_amount=7300");

  await expect(page).toHaveURL(/etape=priority/);
  await expect(page.getByText("Étape 3 sur 3")).toBeVisible();
  await expect(page.getByRole("group", { name: "Quelle résolution visez-vous ?" })).toHaveCount(0);
});

test("priority offers three of the contract's five answers, never its own labels", async ({
  page,
}) => {
  await serveMeta(page, META_FIVE_PRIORITIES);
  await page.goto(
    "/fr/configurer?etape=priority&use_case=GAMING&budget_amount=7300&resolution=1440p",
  );

  // Labels are the response's, by value: the three offered are the ones the
  // model chose, and the two amplitudes are not in the DOM at all.
  await expect(page.getByRole("radio")).toHaveCount(3);
  await expect(page.getByRole("radio", { name: "Prix avant tout" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Équilibré" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Performance avant tout" })).toBeVisible();
  await expect(page.getByText("Plutôt le prix")).toHaveCount(0);
  await expect(page.getByText("Plutôt la performance")).toHaveCount(0);

  await page.getByRole("radio", { name: "Prix avant tout" }).focus();
  await page.keyboard.press("ArrowDown");

  await expect(page.getByRole("radio", { name: "Équilibré" })).toBeChecked();
  await expect(page).toHaveURL(/priority=3(&|$)/);
});

test("with inputs_applied absent, both questions say the answer is stored, not used", async ({
  page,
}) => {
  await serveMeta(page, META_SILENT);

  await page.goto("/fr/configurer?etape=resolution&use_case=GAMING&budget_amount=7300");
  // Attached to the GROUP, so a screen reader hears the question and the caveat
  // together rather than two unordered sentences.
  await expect(
    page.getByRole("group", { name: "Quelle résolution visez-vous ?" }),
  ).toHaveAccessibleDescription(STORED_FR);

  await page.goto(
    "/fr/configurer?etape=priority&use_case=GAMING&budget_amount=7300&resolution=1440p",
  );
  await expect(
    page.getByRole("group", { name: "Qu'est-ce qui compte le plus ?" }),
  ).toHaveAccessibleDescription(STORED_FR);
});

test("a contract that marks priority applied drops the caveat and the inert step", async ({
  page,
}) => {
  await serveMeta(page, META_PRIORITY_APPLIED);

  // `resolution` is declared inert by this contract, so the step is not asked —
  // the profile walks three steps even though its use case is gaming — and the
  // priority question no longer carries the caveat.
  await page.goto(
    "/fr/configurer?etape=priority&use_case=GAMING&budget_amount=7300&resolution=1440p",
  );

  await expect(page.getByText("Étape 3 sur 3")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Écran" })).toHaveCount(0);
  const priorityGroup = page.getByRole("group", { name: "Qu'est-ce qui compte le plus ?" });
  await expect(priorityGroup).toBeVisible();
  await expect(priorityGroup).not.toHaveAccessibleDescription(STORED_FR);
  await expect(page.getByText(STORED_FR)).toHaveCount(0);
});

test("the Arabic profile says the same thing about an inert answer", async ({ page }) => {
  await serveMeta(page, META_SILENT);
  await page.goto(
    "/ar/configurer?etape=priority&use_case=GAMING&budget_amount=7300&resolution=1440p",
  );

  await expect(
    page.getByRole("group", { name: "ما الأهم بالنسبة إليك؟" }),
  ).toHaveAccessibleDescription(STORED_AR);
  // RTL text in an RTL document: the caveat must not be the only LTR run.
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});
