import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BudgetUsageFinder } from "@/components/home/budget-usage-finder";
import { formatPrice, groupNumber } from "@/lib/format/price";
import { useHomepageStore } from "@/lib/homepage/store";
import fr from "@/messages/fr.json";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push }) }));

const CURRENCY = fr.Price.currency;
const CUSTOM_LABEL = fr.Homepage.finder.budget.customLabel;

/** jest-dom compares against whitespace-normalized text, so drop the NBSP. */
const plain = (value: string) => value.replace(/\u00A0/g, " ");

/** The exact range message, interpolated the way the component does it. */
const RANGE_MESSAGE = fr.Homepage.finder.error.budgetRange
  .replace("{min}", groupNumber(3_500))
  .replace("{max}", groupNumber(100_000));

function renderFinder() {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <BudgetUsageFinder />
    </NextIntlClientProvider>,
  );
}

// The accessible name is matched byte for byte, so the NBSP stays.
const preset = (amount: number) =>
  screen.getByRole("radio", {
    name: fr.Homepage.finder.budget.presetLabel.replace("{amount}", formatPrice(amount, CURRENCY)),
  });
const customField = () => screen.getByRole("spinbutton", { name: CUSTOM_LABEL });
const customToggle = () =>
  screen.getByRole("button", { name: fr.Homepage.finder.budget.customToggle });
const budgetStatus = () => screen.getByRole("status");
const cta = () => screen.getByRole("button", { name: fr.Homepage.finder.cta });

/** The reveal every custom-budget test starts from. */
function revealCustomBudget() {
  fireEvent.click(customToggle());
}

beforeEach(() => {
  useHomepageStore.getState().reset();
  push.mockClear();
});

describe("BudgetUsageFinder", () => {
  it("starts empty with the custom field collapsed: no checked radio, a disabled CTA and the unset status", () => {
    renderFinder();

    expect(screen.queryAllByRole("radio", { checked: true })).toHaveLength(0);
    expect(cta()).toBeDisabled();
    expect(budgetStatus()).toHaveTextContent(fr.Homepage.finder.budget.unset);
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(customToggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the selected amount beside the Step 1 heading instead of on its own row", () => {
    renderFinder();

    const budgetGroup = within(screen.getByRole("group", { name: /Quel est votre budget/ }));
    expect(budgetGroup.getByRole("status")).toBe(budgetStatus());

    fireEvent.click(preset(8_000));

    expect(plain(budgetStatus().textContent ?? "")).toBe(plain(formatPrice(8_000, CURRENCY)));
  });

  it("reveals a focused custom field from the compact action", () => {
    renderFinder();

    revealCustomBudget();

    expect(customToggle()).toHaveAttribute("aria-expanded", "true");
    expect(customField()).toHaveFocus();
  });

  it("collapses the field again without resetting the selected preset", () => {
    renderFinder();

    fireEvent.click(preset(8_000));
    revealCustomBudget();
    expect(customField()).toBeInTheDocument();

    fireEvent.click(customToggle());

    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(preset(8_000)).toBeChecked();
    expect(plain(budgetStatus().textContent ?? "")).toBe(plain(formatPrice(8_000, CURRENCY)));
  });

  it("keeps an applied custom amount when the action is used again", () => {
    renderFinder();

    revealCustomBudget();
    fireEvent.change(customField(), { target: { value: "6000" } });
    fireEvent.click(screen.getByRole("radio", { name: /Jeux vidéo/ }));

    expect(cta()).toBeEnabled();

    fireEvent.click(customToggle());

    expect(cta()).toBeEnabled();
    expect(plain(budgetStatus().textContent ?? "")).toBe(plain(formatPrice(6_000, CURRENCY)));

    fireEvent.click(customToggle());
    expect(customField()).toHaveValue(6000);
  });

  it("renders no resolution shortcut and stores none", () => {
    renderFinder();

    expect(screen.queryByText(/1080p|1440p/)).toBeNull();
    expect(useHomepageStore.getState()).not.toHaveProperty("resolution");
  });

  it("enables the CTA only once a budget and a usage are both answered", () => {
    renderFinder();

    fireEvent.click(preset(12_000));
    expect(preset(12_000)).toBeChecked();
    expect(cta()).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: /Jeux vidéo/ }));
    expect(cta()).toBeEnabled();
  });

  it("rejects an out-of-range custom budget and keeps the CTA disabled", () => {
    renderFinder();

    revealCustomBudget();
    fireEvent.change(customField(), { target: { value: "3000" } });

    expect(screen.getByText(plain(RANGE_MESSAGE))).toBeVisible();
    expect(customField()).toHaveAttribute("aria-invalid", "true");
    expect(cta()).toBeDisabled();
  });

  it("holds a single budget answer: typing a custom amount clears the preset", () => {
    renderFinder();

    fireEvent.click(preset(8_000));
    expect(preset(8_000)).toBeChecked();

    revealCustomBudget();
    fireEvent.change(customField(), { target: { value: "6000" } });

    expect(preset(8_000)).not.toBeChecked();
    expect(plain(budgetStatus().textContent ?? "")).toBe(plain(formatPrice(6_000, CURRENCY)));
  });

  it("accepts a custom amount inside the range", () => {
    renderFinder();

    revealCustomBudget();
    fireEvent.change(customField(), { target: { value: "6000" } });
    fireEvent.click(screen.getByRole("radio", { name: /Jeux vidéo/ }));

    expect(cta()).toBeEnabled();
    expect(screen.queryByText(plain(RANGE_MESSAGE))).toBeNull();
  });

  it("hands the two answers to the configurator", () => {
    renderFinder();

    fireEvent.click(preset(12_000));
    fireEvent.click(screen.getByRole("radio", { name: /Études et bureautique/ }));
    fireEvent.click(cta());

    expect(push).toHaveBeenCalledWith("/configurateur?use_case=OFFICE&budget=12000");
    expect(push).toHaveBeenCalledTimes(1);
    expect(useHomepageStore.getState().budgetAmount).toBe(12_000);
    expect(useHomepageStore.getState().useCase).toBe("OFFICE");
  });

  it("never navigates without both answers", () => {
    renderFinder();

    fireEvent.click(preset(12_000));
    expect(cta()).toBeDisabled();

    fireEvent.click(cta());

    expect(push).not.toHaveBeenCalled();
  });
});
