import { render, screen } from "@testing-library/react";
import { useQueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { ApiProvider } from "@/components/providers/api-provider";
import { QUERY_STALE_TIME_MS } from "@/lib/api/query-client";

function Probe() {
  const client = useQueryClient();
  return <span data-testid="stale">{String(client.getDefaultOptions().queries?.staleTime)}</span>;
}

describe("ApiProvider", () => {
  it("provides the shared query client defaults", () => {
    render(
      <ApiProvider>
        <Probe />
      </ApiProvider>,
    );

    expect(screen.getByTestId("stale")).toHaveTextContent(String(QUERY_STALE_TIME_MS));
  });
});
