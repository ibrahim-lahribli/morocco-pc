/**
 * apps/web/e2e/swap.spec.ts — S24's swap control, in a browser.
 *
 * The subject is the CONTROL, and what makes it worth three hundred lines is
 * that it is the app's first question asked AFTER the page rendered: the card is
 * server HTML, the panel is a client island, and the verdict comes from the API
 * at click time. So the specs are shaped around four facts:
 *
 *   1. **Nothing is asked until asked.** Opening the panel and picking a role
 *      fires no preview; the endpoint is a pass-priced read with a 30/min budget
 *      (Decision 55), and an eager fetch per card would spend it on curiosity.
 *   2. **Every number on screen is the API's.** The spec asserts the price line,
 *      the delta, the total and the bar text against the numbers the FIXTURE
 *      serves (3200 -> 6100, +2900, 11 494 of 15 000), not against anything the
 *      page could have computed from the card's own components.
 *   3. **A FAIL and an UNKNOWN are RESULTS, not errors.** They keep their own
 *      word and their own sentence, and neither is folded into "compatible" —
 *      the three-state vocabulary is load-bearing.
 *   4. **A GPU is chosen by its SKU.** Engine 2B is variant-keyed, so the picker
 *      offers `RTX 4070 12GB · MOCK-4070-STD-12G`, and the request it builds
 *      names both the product and the variant.
 *
 * The mock answers by the chosen `product_id`, so a spec selects a scenario by
 * selecting a component — the same arrangement `result.spec.ts` uses for ids.
 */

import { test, expect, type Page } from "@playwright/test";

import { formatMoney } from "../lib/i18n/format";
import { IDS } from "../mock/fixtures.mjs";

const money = (amount: number) => formatMoney(amount, "fr");
const moneyAr = (amount: number) => formatMoney(amount, "ar");

const THREE = `/fr/config/${IDS.threeBuilds}`;
const THREE_AR = `/ar/config/${IDS.threeBuilds}`;

const FR_LABEL = "Remplacer un composant";
const AR_LABEL = "استبدال مكوّن";
const FR_PREVIEW = "Vérifier l'impact";

/** One card's panel, scoped by rank — every card carries one (V13). */
function card(page: Page, index = 0) {
  return page.locator("article").nth(index);
}

function swapControl(page: Page, index = 0) {
  return card(page, index).getByRole("button", { name: FR_LABEL });
}

/** The role select of one card's OPEN panel. */
function roleSelect(page: Page, index = 0) {
  return card(page, index).getByLabel("Pièce à remplacer", { exact: true });
}

/** The candidate select of one card's OPEN panel. */
function candidateSelect(page: Page, index = 0) {
  return card(page, index).getByLabel("Nouveau modèle", { exact: true });
}

/** A `<option>`'s text, built the way the panel builds it (name · sku · price). */
function optionText(name: string, sku: string, price: number): string {
  return `${name} · ${sku} · ${money(price)}`;
}

/** Open one card's panel and pick a role; returns after the catalogue landed. */
async function chooseRole(page: Page, roleLabel: string, index = 0): Promise<void> {
  await swapControl(page, index).click();
  await expect(swapControl(page, index)).toHaveAttribute("data-swap", "open");
  await roleSelect(page, index).selectOption({ label: roleLabel });
}

test("the control opens a panel of THIS build's roles, and asks the API nothing until asked", async ({
  page,
}) => {
  const previews: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.endsWith("/swap-preview")) previews.push(pathname);
  });

  await page.goto(THREE);

  // The control is LIVE now: CD-8 is served, so the disabled state is gone.
  const control = swapControl(page);
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  await expect(control).toHaveAttribute("data-swap", "available");
  await expect(control).toHaveAttribute("aria-expanded", "false");

  await control.click();
  await expect(control).toHaveAttribute("aria-expanded", "true");
  await expect(card(page, 0).getByLabel("Pièce à remplacer", { exact: true })).toBeVisible();

  // The build's own roles, in the engine's assembly order — never a role the
  // build does not have, and never a raw enum.
  const roles = roleSelect(page).locator("option");
  await expect(roles).toHaveCount(9);
  const labels = await roles.allTextContents();
  expect(labels).toEqual([
    "Choisir une pièce",
    "Processeur",
    "Carte mère",
    "Mémoire",
    "Carte graphique",
    "Alimentation",
    "Boîtier",
    "Refroidissement",
    "SSD système",
  ]);

  // Opening a panel and listing roles is LOCAL state: the endpoint has been
  // asked nothing, and no catalogue read has been made either.
  await page.waitForTimeout(400);
  expect(previews).toEqual([]);
});

test("a GPU swap answers PASS with the API's price, total, bar and provenance", async ({ page }) => {
  const urls: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/swap-preview")) urls.push(url);
  });

  await page.goto(THREE);
  await chooseRole(page, "Carte graphique");

  const candidates = candidateSelect(page);
  await expect(candidates).toBeEnabled();

  // A GPU is chosen by its SKU: the installed 4060 is not offered back, and the
  // 4070 offers both of its variants.
  await expect(candidates.locator("option")).toHaveCount(5);
  await expect(
    candidates.locator("option").filter({ hasText: "MOCK-4070-STD-12G" }),
  ).toHaveCount(1);
  await candidates.selectOption({
    label: optionText("RTX 4070 12GB", "MOCK-4070-STD-12G", 6100),
  });

  await card(page).getByRole("button", { name: FR_PREVIEW }).click();

  const verdict = card(page).locator("[data-swap-verdict]");
  await expect(verdict).toHaveAttribute("data-swap-verdict", "PASS");
  await expect(verdict.getByText("Compatible", { exact: true })).toBeVisible();

  // Every figure below is the FIXTURE's: previous 3200 (the card's own GPU),
  // next 6100 (the catalogue's), delta 2900, total 11 494 of a 15 000 budget.
  await expect(verdict.getByText(`De ${money(3200)} à ${money(6100)}`)).toBeVisible();
  await expect(verdict.getByText(`Surcoût de ${money(2900)}.`)).toBeVisible();
  // The bar's TRUE relationship is the accessible value (ARIA clamps
  // `aria-valuenow`), and its visible detail is the remaining budget.
  await expect(verdict.getByRole("progressbar")).toHaveAttribute(
    "aria-valuetext",
    `${money(11494)} sur un budget de ${money(15000)}.`,
  );
  await expect(verdict.getByText(`Reste ${money(3506)}.`)).toBeVisible();
  // Provenance is the offer's, not a guess: a VERIFIED offer reads "Vérifié".
  await expect(verdict.getByText("Vérifié", { exact: true })).toBeVisible();

  // The request named BOTH identities — the variant is what makes a GPU swap
  // addressable at all (Engine 2B is variant-keyed).
  expect(urls).toHaveLength(1);
  expect(urls[0].searchParams.get("role")).toBe("GPU");
  expect(urls[0].searchParams.get("product_id")).toBe("22222222-2222-4222-8222-222222222223");
  expect(urls[0].searchParams.get("product_variant_id")).toBe(
    "aaaa1111-0000-4000-8000-000000000011",
  );
});

test("a failing swap is a 200 result, said in words and never as compatible", async ({ page }) => {
  await page.goto(THREE);
  await chooseRole(page, "Carte graphique");
  await candidateSelect(page).selectOption({
    label: optionText("Radeon RX 7600 8GB", "MOCK-7600-STD-8G", 3390),
  });
  await card(page).getByRole("button", { name: FR_PREVIEW }).click();

  const verdict = card(page).locator("[data-swap-verdict]");
  await expect(verdict).toHaveAttribute("data-swap-verdict", "FAIL");
  await expect(verdict.getByText("Incompatible", { exact: true })).toBeVisible();
  await expect(
    verdict.getByText("Au moins une relation entre les pièces ne peut pas fonctionner."),
  ).toBeVisible();

  // The relation that failed is named by its ROLES, with its status in words -
  // no `gpu_psu`, no `FAIL`, no `SEED_UNVERIFIED` anywhere on the page.
  const failing = verdict.locator('[data-pair-status="FAIL"]');
  await expect(failing).toHaveCount(1);
  await expect(failing).toContainText("Carte graphique");
  await expect(failing).toContainText("Incompatible");

  // The price is still the answer's: a FAIL is not a refusal to price.
  await expect(verdict.getByText(`De ${money(3200)} à ${money(3390)}`)).toBeVisible();

  const text = await card(page).innerText();
  expect(text).not.toContain("gpu_psu");
  expect(text).not.toContain("SEED_UNVERIFIED");
});

test("an unchecked relationship keeps its own state, and is never compatible", async ({ page }) => {
  await page.goto(THREE);
  await chooseRole(page, "Carte graphique");
  await candidateSelect(page).selectOption({
    label: optionText(
      "GeForce RTX 4060 Ti Gaming OC 16 Go Édition Ventus 3X Blanc",
      "MOCK-4060TI-VENTUS-16G",
      4499,
    ),
  });
  await card(page).getByRole("button", { name: FR_PREVIEW }).click();

  const verdict = card(page).locator("[data-swap-verdict]");
  await expect(verdict).toHaveAttribute("data-swap-verdict", "UNKNOWN");
  await expect(verdict.getByText("Compatibilité inconnue", { exact: true })).toBeVisible();
  await expect(
    verdict.getByText(
      "Une relation entre les pièces n'a pas pu être vérifiée avec les données actuelles : ce n'est pas une confirmation.",
    ),
  ).toBeVisible();
  await expect(verdict.getByText("Relations non vérifiées : 1.")).toBeVisible();
  // UNKNOWN is not "no price": the answer still carries one, and its provenance
  // is the SEED offer's own word — "Démo".
  await expect(verdict.getByText(`De ${money(3200)} à ${money(4499)}`)).toBeVisible();
  await expect(verdict.getByText("Démo", { exact: true })).toBeVisible();
});

test("a candidate with no eligible offer says why, and shows no price", async ({ page }) => {
  await page.goto(THREE);
  // The SECOND card's memory is a different product, so the catalogue's only
  // memory fixture is offered here — and it has no offers at all.
  await chooseRole(page, "Mémoire", 1);
  // A product-keyed choice carries no SKU, and this one has no offer either, so
  // its option text is the name alone — no invented price.
  await candidateSelect(page, 1).selectOption({ label: "Kit DDR5 16 Go" });
  await card(page, 1).getByRole("button", { name: FR_PREVIEW }).click();

  const verdict = card(page, 1).locator("[data-swap-verdict]");
  await expect(verdict).toHaveAttribute("data-swap-verdict", "FAIL");
  await expect(
    verdict.getByText("Ce modèle n'a aucune offre en vigueur, donc aucun prix à comparer."),
  ).toBeVisible();
  await expect(
    verdict.getByText("Le prix du nouveau modèle est inconnu : aucune offre éligible."),
  ).toBeVisible();
  // No delta, and the budget bar is not drawn from a missing number.
  await expect(verdict.getByText(/^Surcoût|^Économie/)).toHaveCount(0);
  await expect(
    verdict.getByText("Le total après remplacement n'est pas calculable."),
  ).toBeVisible();
  await expect(verdict.getByRole("progressbar")).toHaveCount(0);
});

test("the panel speaks Arabic, and the verdict is Arabic too", async ({ page }) => {
  await page.goto(THREE_AR);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  await card(page).getByRole("button", { name: AR_LABEL }).click();
  await expect(card(page).getByRole("button", { name: AR_LABEL })).toHaveAttribute(
    "data-swap",
    "open",
  );

  await card(page).getByLabel("القطعة المراد استبدالها", { exact: true }).selectOption({
    label: "بطاقة الرسوميات",
  });
  const candidates = card(page).getByLabel("الطراز الجديد", { exact: true });
  await expect(candidates).toBeEnabled();

  const options = await candidates.locator("option").allTextContents();
  const standard = options.find((text) => text.includes("MOCK-4070-STD-12G"));
  expect(standard).toBeTruthy();
  expect(standard).toContain(moneyAr(6100));
  await candidates.selectOption({ label: standard as string });

  await card(page).getByRole("button", { name: "تحقّق من الأثر" }).click();

  const verdict = card(page).locator("[data-swap-verdict]");
  await expect(verdict).toHaveAttribute("data-swap-verdict", "PASS");
  await expect(verdict.getByText("متوافق", { exact: true })).toBeVisible();
  await expect(verdict.getByText(`من ${moneyAr(3200)} إلى ${moneyAr(6100)}`)).toBeVisible();
});

test("the panel fits at 360 px with no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(THREE);
  await chooseRole(page, "Carte graphique");
  await expect(candidateSelect(page)).toBeEnabled();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

// ---------------------------------------------------------------------------
// S24 / Decision 56: the COMMIT. The preview is a question; this is the answer
// the API keeps. The mock answers the POST statelessly (the SSR read and the
// browser's call are two processes), so the state a commit PRODUCES is pinned
// against its own fixture — `IDS.swapped` is what the API serves afterwards.
// ---------------------------------------------------------------------------

const SWAPPABLE = `/fr/config/${IDS.swappable}`;

/** One card's "apply" button. */
function applyButton(page: Page, index = 0) {
  return card(page, index).getByRole("button", { name: "Enregistrer ce remplacement" });
}

test("a PASS swap can be applied, and the 201's own numbers are what is shown", async ({ page }) => {
  const posts: { url: URL; body: string | null }[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname.endsWith("/swap")) {
      posts.push({ url, body: request.postData() });
    }
  });

  await page.goto(SWAPPABLE);

  // Before any answer there is nothing to keep: the button appears WITH the
  // preview, not with the panel.
  await chooseRole(page, "Carte graphique");
  await expect(applyButton(page)).toHaveCount(0);

  await candidateSelect(page).selectOption({
    label: optionText("RTX 4070 12GB", "MOCK-4070-STD-12G", 6100),
  });
  await card(page).getByRole("button", { name: FR_PREVIEW }).click();
  await expect(card(page).locator("[data-swap-verdict]")).toHaveAttribute(
    "data-swap-verdict",
    "PASS",
  );

  const apply = applyButton(page);
  await expect(apply).toBeVisible();
  await expect(apply).toHaveAttribute("data-swap-apply", "available");
  await apply.click();

  // The applied state names the ROLE and the PERSISTED total: 8594 - 3200 + 6100.
  const applied = card(page).locator('[data-swap-applied="GPU"]');
  await expect(applied).toBeVisible();
  await expect(applied.getByText("Remplacement enregistré", { exact: true })).toBeVisible();
  await expect(
    applied.getByText(
      `Carte graphique remplacé. Nouveau total de la configuration : ${money(11494)}.`,
    ),
  ).toBeVisible();

  // The request repeated the preview's triple, and its body is JSON - the
  // variant is there because a GPU candidate is variant-keyed (Engine 2B).
  expect(posts).toHaveLength(1);
  expect(posts[0].url.pathname).toBe(`/v1/recommendations/${IDS.swappable}/builds/1/swap`);
  expect(JSON.parse(posts[0].body as string)).toEqual({
    role: "GPU",
    product_id: "22222222-2222-4222-8222-222222222223",
    product_variant_id: "aaaa1111-0000-4000-8000-000000000011",
  });

  // A second apply cannot be asked for: the panel knows the swap is stored.
  await expect(applyButton(page)).toHaveCount(0);
});

test("a FAIL verdict offers no apply button at all", async ({ page }) => {
  await page.goto(THREE);
  await chooseRole(page, "Carte graphique");
  await candidateSelect(page).selectOption({
    label: optionText("Radeon RX 7600 8GB", "MOCK-7600-STD-8G", 3390),
  });
  await card(page).getByRole("button", { name: FR_PREVIEW }).click();
  await expect(card(page).locator("[data-swap-verdict]")).toHaveAttribute(
    "data-swap-verdict",
    "FAIL",
  );

  // The commit route refuses a FAIL (409), so the button is absent rather than
  // present-and-doomed.
  await expect(applyButton(page)).toHaveCount(0);
});

test("a build the API serves as swapped says so, and stops offering an explanation", async ({
  page,
}) => {
  await page.goto(`/fr/config/${IDS.swapped}`);

  // The badge is server data (`build.swapped`), not panel state: it is on the
  // first paint, before anything is clicked.
  const badge = card(page).locator('[data-swap-badge="GPU"]');
  await expect(badge).toBeVisible();
  await expect(badge).toContainText("Configuration modifiée : Carte graphique remplacé");

  // The derived build's own total, from the fixture - not the pre-swap 8594.
  await expect(card(page).getByText(money(11494), { exact: true })).toBeVisible();

  // The explanation is gone, and the disclosure says WHY rather than opening
  // onto an empty panel (Decision 56 item 7).
  await card(page).getByText("Pourquoi ce choix").click();
  await expect(
    card(page).getByText(
      "Cette configuration a été modifiée : l'explication d'origine décrivait les pièces remplacées, elle n'est plus affichée",
    ),
  ).toBeVisible();
});
