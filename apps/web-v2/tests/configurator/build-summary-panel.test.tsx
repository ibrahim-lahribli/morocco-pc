import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { BuildSummaryPanel } from "@/components/configurator/build-summary-panel";
import fr from "@/messages/fr.json";

const detail = {
  id: "id-1",
  budget_amount: 12000,
  currency: "MAD",
  use_case: "GAMING",
  generated_at: null,
  budget_floor: null,
  engine_version: "test",
  catalog_version: "v1",
  reused: false,
  reason: null,
  disclaimer: "Prix indicatifs, non actualisés.",
  input_effects: [],
  served_by: { engine_version: "test" },
  builds: [
    {
      rank: 1,
      engine_version: "test",
      total_price: 11946,
      build_score: 56.88,
      compatibility_status: "PASS",
      price_status: "indicative",
      explanation: null,
      strategy_key: "BALANCED",
      swapped: null,
      components: [
        {
          role: "CPU",
          product_id: "cpu",
          name: "AMD Ryzen 5 5600G",
          slug: "cpu",
          variant: null,
          price_used: 1200,
          offer_class: "SEED_UNVERIFIED",
          store_offer_id: null,
        },
        {
          role: "GPU",
          product_id: "gpu",
          name: "RTX 4060",
          slug: "gpu",
          variant: null,
          price_used: 3200,
          offer_class: "SEED_UNVERIFIED",
          store_offer_id: null,
        },
      ],
    },
    {
      rank: 2,
      engine_version: "test",
      total_price: null,
      build_score: 50,
      compatibility_status: "UNKNOWN",
      price_status: "indicative",
      explanation: null,
      strategy_key: "CHEAP",
      swapped: null,
      components: [],
    },
  ],
} as never;

/** The same pass, loaded successfully, with no assembled build and a priced floor. */
const zeroBuildDetail = {
  ...(detail as unknown as Record<string, unknown>),
  builds: [],
  budget_floor: {
    cheapest_total: 8450,
    currency: "MAD",
    budget_amount: 12000,
    within_budget: false,
    cheapest_by_role: {},
    missing_roles: [],
  },
} as never;

const asRecord = (value: unknown) => value as unknown as Record<string, unknown>;

const renderPanel = (props: Partial<ComponentProps<typeof BuildSummaryPanel>> = {}) =>
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <BuildSummaryPanel
        detail={detail}
        currency="MAD"
        isPending={false}
        errorStatus={null}
        activeBuildRank={1}
        requirements={{ useCase: "GAMING", budgetAmount: 12_000 }}
        submitted={false}
        onSelectRank={vi.fn()}
        onRetry={vi.fn()}
        {...props}
      />
    </NextIntlClientProvider>,
  );

describe("BuildSummaryPanel", () => {
  it("renders real components, the total, the badge and the API disclaimer", () => {
    renderPanel();

    expect(screen.getByRole("heading", { name: "Votre configuration" })).toHaveAttribute(
      "id",
      "build-summary-title",
    );
    expect(screen.getByText("AMD Ryzen 5 5600G")).toBeInTheDocument();
    expect(screen.getByText(/11\s?946/)).toBeInTheDocument();
    expect(screen.getByText("Prix indicatif")).toBeInTheDocument();
    expect(screen.getByText("Prix indicatifs, non actualisés.")).toBeInTheDocument();
  });

  it("shows the pass's own use case and budget, not the form's", () => {
    renderPanel({
      detail: {
        ...(detail as unknown as Record<string, unknown>),
        use_case: "OFFICE",
        budget_amount: 15_000,
      } as never,
    });

    expect(screen.getByText(/Études et bureautique/)).toBeInTheDocument();
    expect(screen.getByText(/15\s?000/)).toBeInTheDocument();
    expect(screen.queryByText("Jeux vidéo & Gaming")).toBeNull();
  });

  it("keeps a missing total absent instead of showing zero", () => {
    renderPanel({ activeBuildRank: 2 });

    expect(screen.queryByText(/^0/)).not.toBeInTheDocument();
    expect(screen.getByText("Prix non disponible")).toBeInTheDocument();
  });

  it("shows the empty state when no link supplied one", () => {
    renderPanel({ detail: undefined });

    expect(screen.getByText("Aucune configuration chargée")).toBeInTheDocument();
  });

  it("explains the empty panel before any submit", () => {
    renderPanel({ detail: undefined });

    expect(screen.getByText(fr.Configurator.summary.emptyBody)).toBeInTheDocument();
    expect(screen.queryByText(/Vos réponses/)).toBeNull();
  });

  it("recaps the answers after a submit and claims no build", () => {
    renderPanel({
      detail: undefined,
      submitted: true,
      requirements: { useCase: "OFFICE", budgetAmount: 8_000 },
    });

    expect(screen.getByText(fr.Configurator.summary.reviewBody)).toBeInTheDocument();
    expect(
      screen.getByText(/Vos réponses : Études et bureautique · 8\s?000\s?DH/),
    ).toBeInTheDocument();
  });

  it("never recaps under a loaded pass", () => {
    renderPanel({
      submitted: true,
      requirements: { useCase: "OFFICE", budgetAmount: 8_000 },
    });

    expect(screen.queryByText(/Vos réponses/)).toBeNull();
  });

  it("announces a pending detail and keeps the total absent", () => {
    renderPanel({ detail: undefined, isPending: true });

    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Prix non disponible")).toBeNull();
  });

  it("names a deleted build and offers no retry", () => {
    renderPanel({ detail: undefined, errorStatus: 404 });

    expect(screen.getByText("Configuration introuvable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /réessayer/i })).toBeNull();
  });

  it("offers one retry on a generic failure", () => {
    const onRetry = vi.fn();
    renderPanel({ detail: undefined, errorStatus: 500, onRetry });

    fireEvent.click(screen.getByRole("button", { name: /réessayer/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("expands the mobile summary from one 48 px control", () => {
    renderPanel();

    const toggle = screen.getByRole("button", { name: /afficher|détail/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("selects another returned rank through the callback", () => {
    const onSelectRank = vi.fn();
    renderPanel({ onSelectRank });

    fireEvent.click(screen.getByRole("button", { name: "Configuration 2" }));
    expect(onSelectRank).toHaveBeenCalledWith(2);
  });

  it("treats a loaded pass with zero builds as loaded, not as empty", () => {
    renderPanel({ detail: zeroBuildDetail });

    expect(screen.getByText("Aucun assemblage pour cette configuration")).toBeInTheDocument();
    expect(screen.getByText(/Cette configuration a bien été chargée/)).toBeInTheDocument();
    // The pass is recognised: its own use case and budget are named.
    expect(screen.getByText(/Jeux vidéo & Gaming/)).toBeInTheDocument();
    expect(screen.getByText(/12\s?000\s?DH/)).toBeInTheDocument();
    // …and it is not the unloaded state, whose copy claims nothing is loaded.
    expect(screen.queryByText("Aucune configuration chargée")).toBeNull();
    expect(screen.queryByText(fr.Configurator.summary.emptyBody)).toBeNull();
  });

  it("shows the engine's budget floor, never as a build price", () => {
    renderPanel({ detail: zeroBuildDetail });

    expect(screen.getByText("Budget minimum estimé")).toBeInTheDocument();
    expect(screen.getByText(/8\s?450\s?DH/)).toBeInTheDocument();
    // The floor is a diagnostic: no total, no badge, no components.
    expect(screen.queryByText("Total indicatif")).toBeNull();
    expect(screen.queryByText("Prix indicatif")).toBeNull();
  });

  it("omits the floor when the engine could not price one", () => {
    renderPanel({
      detail: {
        ...asRecord(zeroBuildDetail),
        budget_floor: {
          cheapest_total: null,
          currency: "MAD",
          budget_amount: 12000,
          within_budget: null,
          cheapest_by_role: {},
          missing_roles: ["GPU"],
        },
      } as never,
    });

    expect(screen.getByText("Aucun assemblage pour cette configuration")).toBeInTheDocument();
    expect(screen.queryByText("Budget minimum estimé")).toBeNull();
    expect(screen.queryByText(/^0/)).toBeNull();
  });

  it("omits the floor when the pass has none at all", () => {
    renderPanel({
      detail: { ...asRecord(zeroBuildDetail), budget_floor: null } as never,
    });

    expect(screen.getByText("Aucun assemblage pour cette configuration")).toBeInTheDocument();
    expect(screen.queryByText("Budget minimum estimé")).toBeNull();
  });

  it("keeps a zero-build pass out of the generic empty state after a submit", () => {
    renderPanel({
      detail: zeroBuildDetail,
      submitted: true,
      requirements: { useCase: "OFFICE", budgetAmount: 8_000 },
    });

    expect(screen.getByText("Aucun assemblage pour cette configuration")).toBeInTheDocument();
    expect(screen.queryByText(fr.Configurator.summary.reviewBody)).toBeNull();
    expect(screen.queryByText(/Vos réponses/)).toBeNull();
  });

  it("renders a single-build pass as ready", () => {
    const [firstBuild] = (detail as unknown as { builds: Record<string, unknown>[] }).builds;

    renderPanel({
      detail: { ...asRecord(detail), builds: [firstBuild] } as never,
    });

    expect(screen.getByText("AMD Ryzen 5 5600G")).toBeInTheDocument();
    expect(screen.getByText(/11\s?946/)).toBeInTheDocument();
    expect(screen.queryByText("Aucun assemblage pour cette configuration")).toBeNull();
  });

  it("closes the expanded summary on Escape and returns focus", () => {
    renderPanel();

    const toggle = screen.getByRole("button", { name: /afficher|détail/i });
    fireEvent.click(toggle);
    fireEvent.keyDown(toggle, { key: "Escape" });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });
});
