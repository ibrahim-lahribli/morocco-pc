import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import fr from "@/messages/fr.json";
import { useHomepageStore } from "@/lib/homepage/store";

const get = vi.fn();

vi.mock("@/lib/api/client", () => ({
  getBrowserApiClient: () => ({ GET: get }),
}));

import { RecommendedBuildSection } from "@/components/home/recommended-build-section";

const ok = (data: unknown) => ({ data, response: { ok: true } });

const meta = ok({
  use_cases: [],
  currencies: [],
  resolutions: [],
  priorities: [],
  inputs_applied: [],
});

const presets = (rows: readonly [number, string][]) =>
  ok({
    catalog_version: "v1",
    generated_at: null,
    presets: rows.map(([budget_amount, recommendation_id]) => ({
      budget_amount,
      recommendation_id,
      build_score: 60,
      price_status: "verified",
    })),
  });

const detail = (name: string, status: "verified" | "indicative" | null) =>
  ok({
    currency: "MAD",
    builds: [
      {
        total_price: 11_500,
        build_score: 70,
        price_status: status,
        explanation: null,
        components: [{ role: "CPU", name }],
      },
    ],
  });

type Init = {
  params?: { query?: { use_case?: string }; path?: { id?: string } };
};

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <QueryClientProvider client={client}>
        <RecommendedBuildSection />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  useHomepageStore.setState({ budgetAmount: null, useCase: null });
});

describe("RecommendedBuildSection", () => {
  it("clears the previous selection's specs as soon as the selection changes", async () => {
    let releaseOffice: (value: unknown) => void = () => {};
    const pendingOffice = new Promise((resolve) => {
      releaseOffice = resolve;
    });

    get.mockImplementation(async (path: string, init?: Init) => {
      if (path === "/v1/meta/options") return meta;
      if (path === "/v1/presets") {
        const useCase = init?.params?.query?.use_case;
        if (useCase === "GAMING") {
          return presets([
            [5_000, "rec-g5"],
            [12_000, "rec-g12"],
          ]);
        }
        if (useCase === "OFFICE") {
          return presets([
            [5_000, "rec-o5"],
            [8_000, "rec-o8"],
          ]);
        }
        return presets([]);
      }
      if (path === "/v1/recommendations/{id}") {
        const id = init?.params?.path?.id;
        if (id === "rec-g12") return detail("Ryzen 9 7950X", "verified");
        if (id === "rec-o8") return pendingOffice;
        return detail(`spec-${id ?? "unknown"}`, "indicative");
      }
      throw new Error(`unexpected path ${path}`);
    });

    renderSection();

    await waitFor(() => expect(screen.getByText("Ryzen 9 7950X")).toBeInTheDocument());

    useHomepageStore.setState({ budgetAmount: 8_000, useCase: "OFFICE" });

    await waitFor(() => expect(screen.queryByText("Ryzen 9 7950X")).not.toBeInTheDocument());

    releaseOffice(detail("Ryzen 3 3200G", "indicative"));
    await waitFor(() => expect(screen.getByText("Ryzen 3 3200G")).toBeInTheDocument());
  });

  it("shows no badge when the build list is empty, even if the preset claims verified", async () => {
    get.mockImplementation(async (path: string, init?: Init) => {
      if (path === "/v1/meta/options") return meta;
      if (path === "/v1/presets") {
        const useCase = init?.params?.query?.use_case ?? "GAMING";
        return presets([[12_000, `rec-${useCase}-12`]]);
      }
      return ok({ currency: "MAD", builds: [] });
    });

    renderSection();

    await waitFor(() => expect(screen.getByText("PC Gaming")).toBeInTheDocument());

    expect(screen.queryByText(fr.Homepage.builds.badge.verified)).not.toBeInTheDocument();
    expect(screen.queryByText(fr.Homepage.builds.badge.indicative)).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows the cap note when the budget is above the highest served tier", async () => {
    get.mockImplementation(async (path: string) => {
      if (path === "/v1/meta/options") return meta;
      if (path === "/v1/presets") return presets([[12_000, "rec-g12"]]);
      return detail("Ryzen 5 5600", "verified");
    });

    renderSection();

    useHomepageStore.setState({ budgetAmount: 20_000, useCase: "GAMING" });

    await waitFor(() =>
      expect(screen.getByText(/Configuration pré-générée la plus élevée/)).toBeVisible(),
    );
  });
});
