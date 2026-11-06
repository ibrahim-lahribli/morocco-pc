import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";

/**
 * Locale proxy (Next 16's `proxy.ts`, formerly `middleware.ts`). It only routes
 * text to a URL: `/` becomes `/fr`, and `/ar/...` stays as it is.
 *
 * The matcher skips API routes, Next internals and file requests.
 */
export default createMiddleware(routing);

export const config = {
  matcher: "/((?!api|trpc|_next|_vercel|.*\\..*).*)",
};
