/**
 * apps/web/e2e/cls.ts — the layout-shift observer that `i18n.spec.ts` and
 * `tokens.spec.ts` both need.
 *
 * It lives here rather than in one spec because the `declare global` block does
 * not survive being written twice: a second `Window.__shifts` declaration with a
 * different element type is a typecheck error, and copying it verbatim invites
 * the two copies to drift. One owner, two importers.
 *
 * The observer is installed with `addInitScript`, so it is subscribed BEFORE any
 * app code runs and cannot miss the first paint — the property that makes the
 * measurement worth anything. `buffered: true` additionally picks up shifts the
 * browser recorded before the observer existed.
 */

import type { Page } from "@playwright/test";

declare global {
  interface Window {
    __cls?: number;
    __shifts?: Array<{ value: number; node: string }>;
  }
}

export async function trackCls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__cls = 0;
    window.__shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<
        PerformanceEntry & { value: number; hadRecentInput: boolean }
      >) {
        if (entry.hadRecentInput) continue;
        window.__cls = (window.__cls ?? 0) + entry.value;
        if (entry.value > 0) {
          const source = (entry as unknown as { sources?: Array<{ node?: Node }> }).sources?.[0]
            ?.node;
          window.__shifts?.push({
            value: entry.value,
            node: source instanceof Element ? source.outerHTML.slice(0, 80) : "unknown",
          });
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}
