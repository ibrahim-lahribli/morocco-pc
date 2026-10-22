/**
 * GET /api/analytics/config — what the browser is allowed to load (S22).
 *
 * The one dynamic route in this app, and it exists for a reason the sprint
 * states as a requirement: analytics must be switchable per DEPLOYMENT. Every
 * page here is prerendered, so a `NEXT_PUBLIC_*` value would be frozen into the
 * HTML at build time; this handler reads the server's environment per request,
 * which is what lets the same build serve a deployment with analytics on and
 * another with it off.
 *
 * The body is public by nature (a script URL and a domain are visible in the
 * page source the moment they load), so nothing secret lives here. It is
 * deliberately small and cacheable for five minutes: it is fetched once per
 * page view by the loader, and a minute of staleness in which provider a
 * deployment uses costs nothing.
 *
 * A malformed configuration answers 500 and logs the reason, rather than
 * pretending analytics is off. `resolveAnalyticsConfig()` throws on a misspelt
 * provider or a missing domain precisely so this cannot pass silently; the
 * loader treats any non-2xx as "no analytics", so a user never sees it.
 */
import { resolveAnalyticsConfig } from "@/lib/analytics";

// A route handler is static by default when it reads no request data. This one
// reads `process.env` at request time on purpose, so it must be dynamic.
export const dynamic = "force-dynamic";

export function GET(): Response {
  let config;
  try {
    config = resolveAnalyticsConfig(process.env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("analytics: invalid configuration —", message);
    return Response.json({ provider: null }, { status: 500 });
  }

  return Response.json(config ?? { provider: null }, {
    headers: {
      // A configuration, not a document: never sniffed into anything executable
      // and never cached by a shared proxy for longer than a deployment needs.
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
