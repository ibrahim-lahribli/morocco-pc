"use client";

import { useSyncExternalStore } from "react";

import { Link, usePathname } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

// The search string only changes on navigation, which re-renders anyway.
const subscribeToLocation = () => () => undefined;
const getSearch = () => window.location.search;
const getServerSearch = () => "";

export interface LocaleSwitcherProps {
  /** Accessible name for the switcher's landmark. */
  label: string;
  /** Visible short labels, one per locale. */
  labels: Record<AppLocale, string>;
  /** Per-link accessible labels, e.g. "Afficher en العربية". */
  ariaLabels: Record<AppLocale, string>;
  active: AppLocale;
}

/**
 * Two locale links, not a select: each language has its own URL, so the choice
 * is a navigation. `usePathname` is locale-free, so switching keeps the reader
 * on the same page.
 */
export function LocaleSwitcher({ label, labels, ariaLabels, active }: LocaleSwitcherProps) {
  const pathname = usePathname();

  // The query is client-only state: `useSearchParams` would need a Suspense
  // boundary and would drop the switcher from the server-rendered HTML, so the
  // server snapshot is empty and the search string arrives after hydration.
  const search = useSyncExternalStore(subscribeToLocation, getSearch, getServerSearch);

  const href = search === "" ? pathname : `${pathname}${search}`;

  return (
    <nav
      aria-label={label}
      className="flex items-center gap-0.5 rounded-pill border border-border bg-surface p-1 shadow-level-1"
    >
      {routing.locales.map((locale) => {
        const isActive = locale === active;
        return (
          <Link
            key={locale}
            href={href}
            locale={locale}
            hrefLang={locale}
            aria-label={ariaLabels[locale]}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "inline-flex h-11 min-w-11 items-center justify-center rounded-pill px-3 text-label-md font-semibold transition-colors",
              isActive
                ? "bg-primary text-on-primary"
                : "text-muted hover:bg-primary-soft hover:text-primary",
            )}
          >
            {labels[locale]}
          </Link>
        );
      })}
    </nav>
  );
}
