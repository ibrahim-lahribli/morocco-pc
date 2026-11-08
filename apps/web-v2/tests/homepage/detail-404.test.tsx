import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useHomepageStore } from "@/lib/homepage/store";
import fr from "@/messages/fr.json";

const get = vi.fn();

vi.mock("@/lib/api/client", () => ({
  getBrowserApiClient: () => ({ GET: get }),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
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

/** A real 404 response: `unwrapApiResult` reads its status, headers and body. */
function notFound() {
  const body = { error: "not_found", message: "No such recommendation", request_id: "req-1" };

  return {
    error: body,
    response: new Response(JSON.stringify(body), {
      status: 404,
      statusText: "Not Found",
      headers: { "content-type": "application/json" },
    }),
  };
}

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a preset whose detail does not exist", () => {
  it("keeps the budget line, offers no retry and writes nothing to the console", async () => {
    const warn = vi.spyOn(console, "warn");

    get.mockImplementation(async (path: string, init?: Init) => {
      if (path === "/v1/meta/options") return meta;
      if (path === "/v1/presets") {
        return init?.params?.query?.use_case === "GAMING"
          ? presets([[12_000, "rec-g12"]])
          : presets([]);
      }
      return notFound();
    });

    renderSection();

    // The card keeps the served budget line: a missing detail is not a missing preset.
    await waitFor(() => expect(screen.getByText(/12\s000/)).toBeInTheDocument());

    // A 404 is not a network failure, so it renders no failure line and no retry —
    // and, since it is an expected state rather than a fault, nothing is logged.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: fr.Homepage.builds.error.retry }),
    ).not.toBeInTheDocument();
    expect(warn).not.toHaveBeenCalled();
  });
});
