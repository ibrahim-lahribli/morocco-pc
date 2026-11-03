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
 * `header-nav.tsx` documents the same guard — `pathname === href ||
 * pathname.startsWith(href + "/")` — and the two navigations must agree about
 * which page is current, or the header and the bar disagree on screen.
 */

/**
 * Does `rest` (the pathname with the locale prefix removed) belong to the section
 * at `path`? `/` matches the root only and never anything else, which is why it is
 * its own case rather than a `startsWith`.
 */
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
