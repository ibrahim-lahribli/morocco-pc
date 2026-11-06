/**
 * i18n routing: two locales, French by default, and a locale prefix on every
 * URL (`/fr`, `/ar`). One URL per language keeps canonical links and hreflang
 * exact, and makes the rendered language part of the address rather than a
 * header guess.
 */
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["fr", "ar"],
  defaultLocale: "fr",
  localePrefix: "always",
  // The URL is the preference; no cookie is written or read.
  localeCookie: false,
});

export type AppLocale = (typeof routing.locales)[number];
