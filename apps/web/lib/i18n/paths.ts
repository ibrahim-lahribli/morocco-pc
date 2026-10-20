/**
 * The one place a locale prefix is added to a path.
 *
 * Routing is `localePrefix: "always"` (`/fr/...`, `/ar/...`), so every internal
 * href is `/{locale}{path}`. Keeping that in one function is the difference
 * between a language switch that works and a `/fr/fr/format` that only shows up
 * on the third screen someone builds.
 *
 * Note what this file is NOT: next-intl's `createNavigation`. Its `Link` is a
 * client component that reads `useLocale()`, so using it in a server component
 * requires `NextIntlClientProvider` around the app — and with no client
 * component needing translations yet, that would ship the message catalogue to
 * the browser purely so links can know the locale. S7 can adopt it the moment a
 * client component actually needs translated copy; until then, plain
 * `next/link` + this helper is less machinery for the same URLs.
 */
export function localePath(locale: string, path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `/${locale}${clean === "/" ? "" : clean}`;
}
