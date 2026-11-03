"use client";

/**
 * TabNav — the client island that gives `BottomTabBar` its current item.
 *
 * `BottomTabBar` is deliberately hook-free: it draws five cells and takes
 * `current` as a prop, so the gallery can show every state without navigating.
 * Which cell is current is *request-path* knowledge, and that is exactly what a
 * server layout cannot answer — the same reason `header-nav.tsx` exists. One hook
 * lives here, in one small component, instead of inside the primitive.
 *
 * THREE THINGS THIS FILE OWNS:
 *
 *   - **The mapping from URL to tab.** Each item carries a locale-less `path`;
 *     the current one is the LONGEST path the URL starts with, so `/fr/composants`
 *     and `/fr/composants/comparer` both light "Pièces". A URL that matches none
 *     (a result page, a guide) lights nothing rather than defaulting to home — a
 *     bar that always claims a tab is lying about where you are.
 *   - **`md:hidden`.** The tab bar is the phone's navigation. From 768 px the
 *     header's own nav is on screen, and two navigations with the same
 *     destinations is one too many. Its reserved space is released at the same
 *     breakpoint, in `layout.tsx`, so nothing is padded twice.
 *   - **Navigation only.** No `onClick`, no `router.push`: every cell is a
 *     `next/link`, so open-in-new-tab, the context menu and the status bar all
 *     behave like the links they are.
 *
 * NAMING — the decision Phase 3 had to make (2026-11-03): the header's page links
 * keep "Navigation principale" (`shell.navLabel`) and this bar is named
 * separately (`shell.tabNav`). Two landmarks with one accessible name cannot be
 * told apart in a screen reader's landmark list, and axe will not flag it
 * (`landmark-unique` is best-practice; the suite runs WCAG tags only) — so
 * `e2e/shell.spec.ts` asserts the names differ instead.
 *
 * The labels arrive already translated: the layout reads `messages/` and passes
 * strings, so this component holds no copy and needs no client-side catalogue.
 */
import { usePathname } from "next/navigation";

import { BottomTabBar, type TabBarIcon } from "@/components/ui/bottom-tab-bar";
import { localePath } from "@/lib/i18n/paths";

export interface TabNavItem {
  /** Stable key; the same value `BottomTabBar` compares against `current`. */
  key: string;
  /** Locale-less path, matched as a prefix against the current URL. */
  path: string;
  /** Already-translated short label — five of them share 360 px. */
  label: string;
  icon: TabBarIcon;
  /** The centre cell, drawn raised. */
  raised?: boolean;
}

export interface TabNavProps {
  /** Current locale, used to build every href and to strip the prefix. */
  locale: string;
  /** The bar's accessible name (`shell.tabNav`), distinct from the header nav's. */
  label: string;
  items: readonly TabNavItem[];
}

export function TabNav({ locale, label, items }: TabNavProps) {
  const pathname = usePathname() ?? "";
  const root = `/${locale}`;
  const rest = pathname.startsWith(root) ? pathname.slice(root.length) : pathname;

  // Longest match wins, so a nested route lights its section rather than home.
  const current = items
    .filter((item) => (item.path === "/" ? rest === "" || rest === "/" : rest.startsWith(item.path)))
    .sort((a, b) => b.path.length - a.path.length)[0]?.key;

  return (
    <BottomTabBar
      label={label}
      current={current}
      className="md:hidden"
      items={items.map((item) => ({
        key: item.key,
        href: localePath(locale, item.path),
        label: item.label,
        icon: item.icon,
        raised: item.raised,
      }))}
    />
  );
}
