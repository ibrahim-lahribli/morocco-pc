import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("@/lib/api/client", () => ({
  getBrowserApiClient: () => ({ GET: get }),
}));

import { useMetaOptions } from "@/lib/api/meta";
import { useConfiguratorCurrency } from "@/lib/configurator/queries";

/**
 * The vocabulary read used to exist twice, once per surface. Two copies of the
 * query function are not automatically two requests — the shared
 * `["meta", "options"]` key dedupes them — but two copies of the stale time, the
 * fallback and the mapping could disagree without any test noticing. This pins
 * the half that is observable: one read, whoever asks first.
 */
function HomepageProbe() {
  useMetaOptions();
  return null;
}

function ConfiguratorProbe() {
  useConfiguratorCurrency();
  return null;
}

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({
    data: {
      use_cases: [{ value: "GAMING" }, { value: "OFFICE" }, { value: "WORKSTATION" }],
      currencies: [{ value: "EUR" }],
    },
    response: { ok: true },
  });
});

describe("shared meta read", () => {
  it("serves the homepage and the configurator from one request", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <HomepageProbe />
        <ConfiguratorProbe />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(get).toHaveBeenCalled());

    const metaCalls = get.mock.calls.filter(([path]) => path === "/v1/meta/options");
    expect(metaCalls).toHaveLength(1);
  });
});
