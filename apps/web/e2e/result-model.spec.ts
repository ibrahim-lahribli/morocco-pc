/**
 * apps/web/e2e/result-model.spec.ts — the results page's decisions without a
 * browser.
 *
 * `lib/result/model.ts` is where the page's rules live, so it is tested
 * directly, the way `wizard-model.spec.ts` tests the step machine: a tone or an
 * ordering rule that only fails in the UI would be caught in a spec that also has
 * to render a page and reach an API.
 *
 * The fixtures are the REAL ones the mock serves, not literals, so a change to a
 * fixture's numbers shows up here as a broken invariant rather than as a page
 * that quietly re-derives the wrong sentence.
 */

import { test, expect } from "@playwright/test";

import {
  OTHER_KEY,
  ROLE_ORDER,
  STRATEGY_KEYS,
  barFigures,
  budgetTone,
  hasBar,
  orderBuilds,
  overBudgetBy,
  remainingBudget,
  roleLabel,
  showsVariant,
  strategyLabel,
} from "../lib/result/model";
import ar from "../messages/ar.json";
import fr from "../messages/fr.json";
import { RECOMMENDATION_OVER_BUDGET, RECOMMENDATION_THREE_BUILDS } from "../mock/fixtures.mjs";

test("builds are rendered in RANK order, whatever order they arrive in", () => {
  const [first, second, third] = RECOMMENDATION_THREE_BUILDS.builds;
  const shuffled = orderBuilds([third, first, second]);
  expect(shuffled.map((build: { rank: number }) => build.rank)).toEqual([1, 2, 3]);

  // Already ordered: untouched, and the ARRAY it came from is never mutated.
  const original = RECOMMENDATION_THREE_BUILDS.builds;
  const same = orderBuilds(original);
  expect(same).toEqual(original);
  expect(original.map((build: { rank: number }) => build.rank)).toEqual([1, 2, 3]);

  // Two builds sharing a rank keep the API's own order: the sort is stable, and
  // the tie-break is stated rather than inherited from the engine.
  const tie = orderBuilds([
    { ...RECOMMENDATION_THREE_BUILDS.builds[0], rank: 2, strategy_key: "VALUE" },
    { ...RECOMMENDATION_THREE_BUILDS.builds[0], rank: 2, strategy_key: "BALANCED" },
  ]);
  expect(tie.map((build: { strategy_key: string | null }) => build.strategy_key)).toEqual([
    "VALUE",
    "BALANCED",
  ]);
});

test("the bar needs two numbers: NULL is not 0", () => {
  expect(hasBar(8594, 15000)).toBe(true);
  expect(hasBar(null, 15000)).toBe(false);
  expect(hasBar(8594, null)).toBe(false);
  expect(hasBar(0, 15000)).toBe(false);
  expect(hasBar(8594, 0)).toBe(false);
  expect(hasBar(Number.NaN, 15000)).toBe(false);
  expect(barFigures(8594, 15000)).toEqual({ total: 8594, budget: 15000 });
  expect(barFigures(null, null)).toBeNull();
});

test("the tone is arithmetic above budget, judgement below it", () => {
  // Comfortable, near the ceiling, exactly on it, and past it.
  expect(budgetTone(8594, 15000)).toBe("normal");
  expect(budgetTone(14000, 15000)).toBe("warning");
  expect(budgetTone(15000, 15000)).toBe("warning");
  expect(budgetTone(15001, 15000)).toBe("over");
  // The band's own edge, so moving NEAR_BUDGET_RATIO cannot leave it untested.
  expect(budgetTone(15000 * 0.9, 15000)).toBe("warning");
  expect(budgetTone(15000 * 0.9 - 1, 15000)).toBe("normal");
  // No bar, no claim.
  expect(budgetTone(null, 15000)).toBe("normal");
  expect(budgetTone(8594, null)).toBe("normal");
});

test("over and remaining are both derived from the same pair, and never fake a zero", () => {
  expect(overBudgetBy(8594, 5000)).toBe(3594);
  expect(remainingBudget(8594, 5000)).toBeNull();
  expect(remainingBudget(8594, 15000)).toBe(6406);
  expect(overBudgetBy(8594, 15000)).toBeNull();
  // Exactly on budget: nothing left, nothing over.
  expect(remainingBudget(15000, 15000)).toBe(0);
  expect(overBudgetBy(15000, 15000)).toBeNull();
  // A missing total is not "0 DH over".
  expect(overBudgetBy(null, 5000)).toBeNull();
  expect(remainingBudget(null, 5000)).toBeNull();
});

test("the over-budget fixture really is over its own budget", () => {
  // Guards the fixture: a page spec asserting "over" against a fixture that is
  // not over would pass for the wrong reason.
  const build = RECOMMENDATION_OVER_BUDGET.builds[0];
  expect(build.total_price).toBeGreaterThan(RECOMMENDATION_OVER_BUDGET.budget_amount);
  expect(budgetTone(build.total_price, RECOMMENDATION_OVER_BUDGET.budget_amount)).toBe("over");
});

test("every role and every strategy has a label, and nothing else leaks", () => {
  for (const role of ROLE_ORDER) expect(roleLabel(role)).toBe(role);
  for (const strategy of STRATEGY_KEYS) expect(strategyLabel(strategy)).toBe(strategy);

  // The raw enum must never reach a user: an unknown value becomes OTHER.
  expect(roleLabel("SSD_BOOT")).not.toBe(OTHER_KEY);
  // SSD_SECONDARY is a valid enum value (migration 011) that today's assembler
  // does not emit, so a persisted build can still carry one and it must be
  // named like any other role.
  expect(roleLabel("SSD_SECONDARY")).toBe("SSD_SECONDARY");
  expect(roleLabel("POWER_SUPPLY")).toBe(OTHER_KEY);
  expect(roleLabel("cpu")).toBe(OTHER_KEY);
  expect(strategyLabel(null)).toBe(OTHER_KEY);
  expect(strategyLabel("PRICE")).toBe(OTHER_KEY);
  expect(strategyLabel("BALANCED")).not.toBe(OTHER_KEY);

  // And the fixtures only use vocabulary the catalogue can name.
  const used = new Set(
    RECOMMENDATION_THREE_BUILDS.builds.flatMap((build: { components: { role: string }[] }) =>
      build.components.map((component) => roleLabel(component.role)),
    ),
  );
  expect(used.has(OTHER_KEY)).toBe(false);
  expect(used.size).toBe(8);

  // ...and the COPY exists for every one of them. The vocabulary and the message
  // catalogues are separate files, so a role added without its labels would
  // otherwise ship the raw key `result.roles.X` to a user.
  // Cast to a string-keyed record: the point is to probe keys the JSON's own type
  // cannot prove are there, which is the failure this test exists to catch.
  const frRoles = fr.result.roles as Record<string, string | undefined>;
  const arRoles = ar.result.roles as Record<string, string | undefined>;
  const frStrategies = fr.result.strategies as Record<string, string | undefined>;
  const arStrategies = ar.result.strategies as Record<string, string | undefined>;
  for (const key of [...ROLE_ORDER, OTHER_KEY]) {
    expect(frRoles[key], `fr label for ${key}`).toBeTruthy();
    expect(arRoles[key], `ar label for ${key}`).toBeTruthy();
  }
  for (const key of [...STRATEGY_KEYS, OTHER_KEY]) {
    expect(frStrategies[key], `fr label for ${key}`).toBeTruthy();
    expect(arStrategies[key], `ar label for ${key}`).toBeTruthy();
  }
});

test("the variant is printed only when the name does not already say it", () => {
  // Both cases come from the fixture, and both are real: `display_name` carries
  // "8GB" for the GPU, while the RAM's name stops at the capacity.
  const gpu = RECOMMENDATION_THREE_BUILDS.builds[0].components[1];
  const ram = RECOMMENDATION_THREE_BUILDS.builds[0].components[2];
  expect(showsVariant(gpu.name, gpu.variant)).toBe(false);
  expect(showsVariant(ram.name, ram.variant)).toBe(true);
  expect(showsVariant("Ryzen 5 7600", null)).toBe(false);
  expect(showsVariant("Ryzen 5 7600", "   ")).toBe(false);
  // Case-insensitive, because a vendor's copy is.
  expect(showsVariant("RTX 4060 8gb", "8GB")).toBe(false);
});
