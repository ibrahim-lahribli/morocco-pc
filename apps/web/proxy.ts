/**
 * Locale proxy — Next 16's `proxy.ts` (the file `middleware.ts` was renamed to;
 * the old name still works but is deprecated, and Next reports it).
 *
 * Its only job is routing text to a URL: `/` becomes `/fr`, and `/ar/...` stays
 * as it is. No auth, no headers, no data access — which is why it can be a
 * default export of next-intl's factory with no body of its own.
 *
 * The matcher skips API routes, Next internals, and anything with a dot (a file
 * request). A path that legitimately contains a dot needs its own matcher
 * entry; there is none today, and inventing one "just in case" would disable
 * this redirect for that path.
 */
import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  matcher: "/((?!api|trpc|_next|_vercel|.*\\..*).*)",
};
