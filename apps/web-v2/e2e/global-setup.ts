import { request, type FullConfig } from "@playwright/test";

/**
 * Warm the two configurator routes before any worker starts.
 *
 * The configurator is the only dynamic route in this suite, and Next's dev
 * server compiles it per locale on first request. Several workers asking for a
 * locale at the same moment makes that first render fail with a truncated JSON
 * read ("Unexpected end of JSON input") and a dev-overlay error page instead of
 * the app. Two sequential GETs pay the compile once, outside any worker, and
 * execute no client JavaScript — so no API call is made and no stub is needed.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (baseURL === undefined) return;

  const context = await request.newContext({ baseURL });
  try {
    for (const locale of ["fr", "ar"]) {
      const response = await context.get(`/${locale}/configurateur`);
      if (!response.ok()) {
        throw new Error(`warm-up /${locale}/configurateur answered ${response.status()}`);
      }
    }
  } finally {
    await context.dispose();
  }
}
