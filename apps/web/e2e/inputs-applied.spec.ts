/**
 * apps/web/e2e/inputs-applied.spec.ts — Decision 52's web half.
 *
 * Two kinds of proof, and they are deliberately separate:
 *
 *   1. the PARSER, as pure functions. Silence (`undefined`) and an empty list
 *      are different facts, and an entry outside the closed vocabularies is
 *      dropped rather than guessed - a rule that can be stated without a page,
 *      so it is.
 *   2. the RENDERED block on a real result page, in both locales. The page is a
 *      server component reading the mock's fixture, so "the block exists" is
 *      proven against the same request path a visitor takes, not by mounting
 *      the component with props.
 *
 * The mock's `baseResponse` carries one effect per input, with `resolution`
 * NOT_PROVIDED (its POST body carries no resolution). That is the state these
 * specs assert, and it is a state the copy must explain without inventing an
 * effect for the input the user never chose.
 */

import { test, expect } from "@playwright/test";

import { readInputEffects } from "../lib/result/inputs";
import { IDS } from "../mock/fixtures.mjs";

test.describe("readInputEffects: silence, emptiness and vocabulary", () => {
  test("a body without the field is SILENCE, not an empty list", () => {
    expect(readInputEffects(undefined)).toBeNull();
    expect(readInputEffects(null)).toBeNull();
    expect(readInputEffects("input_effects")).toBeNull();
    // A 1.6 body: no field at all.
    expect(readInputEffects({ builds: [] })).toBeNull();
    // A field of the wrong shape is silence too, never a crash.
    expect(readInputEffects({ input_effects: "use_case" })).toBeNull();
    // An EMPTY list is a different fact: the server spoke and named nothing.
    expect(readInputEffects({ input_effects: [] })).toEqual([]);
  });

  test("entries outside the closed vocabularies are DROPPED, never guessed", () => {
    const parsed = readInputEffects({
      input_effects: [
        { input: "use_case", effect: "APPLIED", reason: "USE_CASE_PROFILE" },
        // An input this client does not know: dropped, not rendered raw.
        { input: "budget_amount", effect: "APPLIED", reason: "USE_CASE_PROFILE" },
        // An effect outside APPLIED | NO_EFFECT | UNKNOWN: dropped, never
        // coerced to APPLIED.
        { input: "resolution", effect: "MAYBE", reason: "GPU_TARGET_SCALED" },
        // A blank reason has nothing to say.
        { input: "priority", effect: "NO_EFFECT", reason: "   " },
        null,
        "USE_CASE_PROFILE",
        [],
      ],
    });

    expect(parsed).toEqual([
      { input: "use_case", effect: "APPLIED", reason: "USE_CASE_PROFILE" },
    ]);
  });

  test("a well-formed list keeps the API's own order", () => {
    const parsed = readInputEffects({
      input_effects: [
        { input: "priority", effect: "APPLIED", reason: "STRATEGY_ORDER" },
        { input: "resolution", effect: "NO_EFFECT", reason: "NOT_PROVIDED" },
        { input: "use_case", effect: "APPLIED", reason: "USE_CASE_PROFILE" },
      ],
    });
    expect(parsed?.map((view) => view.input)).toEqual(["priority", "resolution", "use_case"]);
  });
});

test.describe("the results page states what the inputs changed", () => {
  test("fr: one row per input, each naming the mechanism", async ({ page }) => {
    await page.goto(`/fr/config/${IDS.ok}`);

    const block = page.getByRole("region", { name: "Ce que vos choix ont changé" });
    await expect(block).toBeVisible();
    await expect(block.locator("dt")).toHaveCount(3);
    await expect(block.locator("dt")).toHaveText(["Usage", "Résolution", "Priorité"]);

    // USE_CASE_PROFILE: the profile was selected.
    await expect(
      block.getByText("a choisi le profil de votre usage : politique GPU et répartition du budget."),
    ).toBeVisible();
    // NOT_PROVIDED: the input the request never carried says exactly that -
    // not "no effect on the build", which the server cannot know.
    await expect(block.getByText("n'a pas été indiqué.")).toBeVisible();
    // STRATEGY_ORDER: the priority's real consequence (the ranking below).
    await expect(
      block.getByText("a fixé l'ordre des profils essayés, d'où le classement ci-dessous."),
    ).toBeVisible();

    // The status travels as a data attribute for a machine, and the sentence
    // for a human - a raw code must never appear on screen.
    await expect(block.locator("[data-effect]")).toHaveCount(3);
    await expect(block).not.toContainText("USE_CASE_PROFILE");
    await expect(block).not.toContainText("STRATEGY_ORDER");
  });

  test("ar: the same facts, in Arabic, inside an RTL document", async ({ page }) => {
    await page.goto(`/ar/config/${IDS.ok}`);

    const block = page.getByRole("region", { name: "ما غيّرته اختياراتك" });
    await expect(block).toBeVisible();
    await expect(block.locator("dt")).toHaveText(["الاستخدام", "الدقة", "الأولوية"]);
    await expect(block.getByText("لم يُذكر في الطلب.")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });
});
