"use client";

import { Link, usePathname } from "@/i18n/navigation";

import { cn } from "@/lib/utils";
import { isNavItemCurrent } from "./nav-current";

export interface PrimaryNavItem {
  /**
   * A homepage section anchor (`#top`, `#guides`) or a locale-aware route
   * (`/configurateur?step=1`); rendered as a plain `<a>` or a next-intl
   * `Link` accordingly.
   */
  href: string;
  label: string;
}

/**
 * Desktop navigation. Anchor items resolve within the current page; route
 * items go through next-intl's `Link`, which prefixes the locale and keeps
 * the query string. Currency is derived from the pathname, so an item is
 * highlighted wherever its route is — the Configurer link on every step of
 * the configurator.
 */
export function PrimaryNav({ label, items }: { label: string; items: readonly PrimaryNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="hidden items-center gap-1 lg:flex">
      {items.map((item) => {
        const current = isNavItemCurrent(item.href, pathname);
        const className = cn(
          "inline-flex h-11 items-center rounded-control px-3 text-label-lg transition-colors",
          current ? "text-primary" : "text-muted hover:bg-primary-soft hover:text-primary",
        );

        return item.href.startsWith("/") ? (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={className}
          >
            {item.label}
          </Link>
        ) : (
          <a
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={className}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
