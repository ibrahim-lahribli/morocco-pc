/**
 * tab-match — which tab a locale-less path belongs to.
 *
 * Extracted from `tab-nav.tsx` so the RULE can be pinned without a browser. The
 * case that matters is a section BOUNDARY: `/composants` owns `/composants` and
 * `/composants/comparer`, but not `/composants-x`. That cannot be proved by
 * visiting a URL — an unknown slug renders Next's bare 404, and that response
 * carries no `nav` element at all (measured 2026-11-03), so a navigation-based
 * assertion there would pass for the wrong reason.
 *
 * Both navigations call THIS module: `tab-nav.tsx` asks `currentTabKey`, and
 * `header-nav.tsx` asks `isTabPath` per item, so the header and the bar cannot
 * disagree about which page is current. The locale prefix is stripped here too
 * (`localeRest`), because two spellings of one strip is how the two of them
 * drift apart.
 */

/**
 * Does `rest` (the pathname with the locale prefix removed) belong to the section
 * at `path`? `/` matches the root only and never anything else, which is why it is
 * its own case rather than a `startsWith`.
 */
/**
 * The pathname with the locale prefix removed, e.g. `/fr/composants` →
 * `/composants` and `/fr` → `""`.
 *
 * Segment-bounded on purpose, the same way `isTabPath` is: a bare `startsWith`
 * would turn `/frx` into `"x"`. `/frx` is not a routable path today, so this is
 * hardening rather than a user-visible change — but a strip that slices a
 * prefix it did not match is the bug this module exists to stop repeating.
 */
export function localeRest(pathname: string, locale: string): string {
  const root = `/${locale}`;
  if (pathname === root) return "";
  return pathname.startsWith(`${root}/`) ? pathname.slice(root.length) : pathname;
}

export function isTabPath(rest: string, path: string): boolean {
  if (path === "/") return rest === "" || rest === "/";
  return rest === path || rest.startsWith(`${path}/`);
}

/**
 * The key of the tab that owns `rest`, or `undefined` when none does — a result
 * page or a guide lights nothing rather than defaulting to home, because a bar
 * that always claims a tab is lying about where you are. Longest match wins, so a
 * nested route lights its section.
 */
export function currentTabKey<T extends { key: string; path: string }>(
  rest: string,
  items: readonly T[],
): string | undefined {
  return items
    .filter((item) => isTabPath(rest, item.path))
    .sort((a, b) => b.path.length - a.path.length)[0]?.key;
}
