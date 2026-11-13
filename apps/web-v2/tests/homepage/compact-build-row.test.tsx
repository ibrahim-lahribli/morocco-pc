import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import fr from "@/messages/fr.json";
import type { BuildCardView, HomeUseCase } from "@/lib/homepage/builds";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { CompactBuildRow } from "@/components/home/compact-build-row";

const view: BuildCardView = {
  recommendationId: "rec-OFFICE-12000",
  budgetAmount: 12_000,
  score: 70,
  totalPrice: 11_500,
  badge: "indicative",
  pills: ["Ryzen 5 5600", "RTX 4060", "32 Go DDR4", "NVMe 1 To"],
  componentSummary: "Ryzen 5 5600 · RTX 4060 · 32 Go DDR4 · NVMe 1 To",
  rationale: null,
  hasCompleteBuild: true,
};

function renderRow(overrides: Partial<BuildCardView> = {}) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <CompactBuildRow
        title="PC Bureautique"
        useCase={"OFFICE" as HomeUseCase}
        view={{ ...view, ...overrides }}
      />
    </NextIntlClientProvider>,
  );
}

describe("CompactBuildRow", () => {
  it("renders the title, component summary, price and CTA", () => {
    renderRow();

    expect(screen.getByRole("heading", { name: "PC Bureautique" })).toBeInTheDocument();
    expect(
      screen.getByText("Ryzen 5 5600 · RTX 4060 · 32 Go DDR4 · NVMe 1 To"),
    ).toBeInTheDocument();
    expect(screen.getByText(/11\s?500\s?DH/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Détails/ })).toBeInTheDocument();
  });

  it("links to the configurator with the served tier", () => {
    renderRow();

    expect(screen.getByRole("link", { name: /Détails/ })).toHaveAttribute(
      "href",
      "/configurateur?use_case=OFFICE&budget=12000",
    );
  });

  it("renders the badge when the build has a price status", () => {
    renderRow({ badge: "indicative" });

    expect(screen.getByText(fr.Homepage.builds.badge.indicative)).toBeInTheDocument();
  });

  it("renders no badge when the build has no price status", () => {
    renderRow({ badge: null });

    expect(screen.queryByText(fr.Homepage.builds.badge.verified)).not.toBeInTheDocument();
    expect(screen.queryByText(fr.Homepage.builds.badge.indicative)).not.toBeInTheDocument();
  });

  it("renders no image or media slot", () => {
    const { container } = renderRow();

    expect(container.querySelector("img")).toBeNull();
    // The compact row has no BuildMediaPlaceholder (the decorative gradient
    // block). The ArrowRight icon is aria-hidden, but that is a CTA affordance,
    // not a media slot.
    expect(container.querySelector(".from-surface-sunken")).toBeNull();
  });

  it("renders the component summary as plain text, not a pill list", () => {
    renderRow();

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByText("Ryzen 5 5600 · RTX 4060 · 32 Go DDR4 · NVMe 1 To").tagName).toBe("P");
  });

  it("shows no price when totalPrice is null", () => {
    renderRow({ totalPrice: null });

    expect(screen.queryByText(/11\s?500\s?DH/)).not.toBeInTheDocument();
  });

  it("uses h3 for the title, never h4", () => {
    renderRow();

    expect(screen.getByRole("heading", { level: 3, name: "PC Bureautique" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 4 })).not.toBeInTheDocument();
  });
});
