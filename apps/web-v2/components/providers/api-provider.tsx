"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { createQueryClient } from "@/lib/api/query-client";

/**
 * One query client per browser session. It is created lazily in state, so a
 * server render never shares a cache between requests and Fast Refresh does not
 * mint a new client on every edit.
 *
 * No queries run in Step 1: this provider is the seam the product screens will
 * use. The shell therefore makes no API request on load.
 */
export function ApiProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
