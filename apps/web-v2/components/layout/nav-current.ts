/**
 * Which nav item is "current", derived from the locale-stripped pathname
 * (`usePathname()` from `@/i18n/navigation`).
 *
 * Route hrefs (`/configurateur?step=1`) match on the path alone, so the
 * Configurer item is current on every step of the configurator. Homepage
 * anchors stand for the page itself only on the homepage, and only the
 * `#top` item does — section anchors like `#guides` never claim currency.
 */
export function isNavItemCurrent(href: string, pathname: string): boolean {
  if (href.startsWith("/")) {
    return href.split("?")[0] === pathname;
  }
  return pathname === "/" && href === "#top";
}
