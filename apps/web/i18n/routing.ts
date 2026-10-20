/**
 * i18n routing (S5): two locales, French default, and a locale PREFIX on every
 * URL (`/fr`, `/ar`) — never a bare `/` that guesses from the Accept-Language
 * header. Two reasons, both practical:
 *
 *   - SEO: one URL per language, so hreflang and canonical tags are exact, and
 *     a shared link always shows the language the sender saw;
 *   - tests and cacheability: a URL fully identifies the document.
 *
 * `proxy.ts` (Next 16's rename of `middleware.ts`) turns `/` into `/fr` and
 * keeps an unknown locale from becoming a 404 inside a valid route.
 */
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["fr", "ar"],
  defaultLocale: "fr",
  localePrefix: "always",
  // No cookie. next-intl writes NEXT_LOCALE on a redirect by default, but with a
  // prefix on every URL nothing ever reads it: the URL IS the preference
  // (I18N.md §7). A cookie the app does not use is state with no owner.
  localeCookie: false,
});

export type AppLocale = (typeof routing.locales)[number];
