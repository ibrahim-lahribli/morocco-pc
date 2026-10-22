/**
 * components/analytics.tsx — the only component that starts analytics (S22).
 *
 * It renders NOTHING: analytics is behaviour, not markup, so the layout can mount
 * it in one place and no page has to know it exists. The work itself lives in
 * `lib/analytics.ts` (the one module the sprint asks for); this island exists
 * because the loader needs `window`, and the layout is a server component.
 *
 * A `useEffect` rather than a `<Script>` tag on purpose: `next/script` can only
 * inject a script whose URL was known when the page was built, and this app
 * resolves its provider per request (see the module header). The effect runs
 * after hydration, and `bootstrapAnalytics()` itself waits for the window's
 * `load` event, so the ordering the brief demands is explicit here instead of
 * inherited from a strategy prop.
 */
"use client";

import { useEffect } from "react";

import { bootstrapAnalytics } from "@/lib/analytics";

export function Analytics() {
  useEffect(() => {
    bootstrapAnalytics();
  }, []);

  return null;
}
