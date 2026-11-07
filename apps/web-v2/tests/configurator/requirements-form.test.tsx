import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { RequirementsForm } from "@/components/configurator/requirements-form";
import fr from "@/messages/fr.json";

const renderForm = (props: Partial<ComponentProps<typeof RequirementsForm>> = {}) => {
  const onSubmit = vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <RequirementsForm
        defaultValues={{ useCase: null, budget: "" }}
        submitted={false}
        onSubmit={onSubmit}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onSubmit };
};

const budgetField = () => screen.getByLabelText(/budget/i);

describe("RequirementsForm", () => {
  it("asks exactly two questions and offers no resolution or priority control", () => {
    renderForm();
    expect(screen.getByRole("group", { name: /usage/i })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: /1080p|1440p/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/priorité/i)).not.toBeInTheDocument();
  });

  it("shows one localized message per unanswered field", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    expect(await screen.findByText("Choisissez un usage pour continuer.")).toBeInTheDocument();
    expect(screen.getByText("Saisissez un budget.")).toBeInTheDocument();
  });

  it("rejects an out-of-range budget and submits valid answers once", async () => {
    const { onSubmit } = renderForm({
      defaultValues: { useCase: "GAMING", budget: "3499" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    expect(await screen.findByText(/entre 3\s?500 et 100\s?000/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(budgetField(), { target: { value: "8000" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ useCase: "GAMING", budgetAmount: 8000 }),
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("marks a URL-invalid field on mount and keeps its raw value", () => {
    renderForm({
      defaultValues: { useCase: "GAMING", budget: "12" },
      initialErrors: { budget: "BUDGET_RANGE" },
    });
    // jest-dom reads a number input's value numerically; 12 is the raw "12".
    expect(budgetField()).toHaveValue(12);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/entre 3\s?500 et 100\s?000/)).toBeInTheDocument();
  });

  it("confirms saved answers and offers an update once submitted", () => {
    renderForm({ submitted: true });
    expect(screen.getByText("Vos réponses sont enregistrées.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mettre à jour" })).toBeInTheDocument();
  });
});
