"use client";

import { BookOpen, Heart, Home, LayoutGrid, Sparkles, type LucideIcon } from "lucide-react";

import { Link, usePathname } from "@/i18n/navigation";

import { cn } from "@/lib/utils";
import { isNavItemCurrent } from "./nav-current";

export interface MobileNavItem {
  /** Stable key, also selects the icon. */
  key: "home" | "components" | "configure" | "guides" | "saved";
  /**
   * A homepage section anchor (`#top`, `#guides`) or a locale-aware route
   * (`/configurateur?step=1`). Omitted when the destination has no route yet:
   * the item keeps its geometry and label but renders as an `aria-disabled`
   * span — not focusable, no href, and never pointed at an unrelated homepage
   * anchor.
   */
  href?: string;
  label: string;
}

const ICONS: Record<MobileNavItem["key"], LucideIcon> = {
  home: Home,
  components: LayoutGrid,
  configure: Sparkles,
  guides: BookOpen,
  saved: Heart,
};

const ITEM_CLASSES =
  "mx-auto flex h-14 min-w-12 flex-col items-center justify-center gap-0.5 rounded-control px-1 text-label-sm font-medium tracking-tight transition-colors";

const FAB_CLASSES =
  "flex size-14 items-center justify-center rounded-pill transition-transform active:scale-95";

/**
 * Bottom navigation for mobile, matching the supplied direction: four sections
 * plus a raised central action, with the label under each icon. Hidden from
 * `lg` up, where the header carries navigation.
 *
 * A destination whose route does not exist yet ships without an `href`, so
 * nothing here pretends to navigate to a page that 404s. Currency is derived
 * from the pathname — the Configurer action stays highlighted on every step
 * of the configurator.
 */
export function MobileNav({ label, items }: { label: string; items: readonly MobileNavItem[] }) {
  const pathname = usePathname();

  const renderNavItem = (item: MobileNavItem, className: string, withLabel: boolean) => {
    const Icon = ICONS[item.key];
    const content = withLabel ? (
      <>
        <Icon aria-hidden="true" className="size-6" />
        <span>{item.label}</span>
      </>
    ) : (
      <Icon aria-hidden="true" className="size-6" />
    );

    if (item.href === undefined) {
      return (
        <span aria-disabled="true" className={className}>
          {content}
        </span>
      );
    }

    const current = isNavItemCurrent(item.href, pathname);
    const ariaCurrent = current ? ("page" as const) : undefined;
    const ariaLabel = withLabel ? undefined : item.label;

    return item.href.startsWith("/") ? (
      <Link
        href={item.href}
        aria-current={ariaCurrent}
        aria-label={ariaLabel}
        className={className}
      >
        {content}
      </Link>
    ) : (
      <a href={item.href} aria-current={ariaCurrent} aria-label={ariaLabel} className={className}>
        {content}
      </a>
    );
  };

  return (
    <nav
      aria-label={label}
      data-slot="mobile-nav"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-level-3 backdrop-blur-xl lg:hidden"
    >
      <ul className="mx-auto flex h-20 w-full max-w-page items-center justify-around px-space-xs">
        {items.map((item) => {
          const isCenter = item.key === "configure";

          if (isCenter) {
            const fabClassName = cn(
              FAB_CLASSES,
              item.href === undefined
                ? "bg-surface-sunken text-subtle"
                : "bg-primary text-accent shadow-fab ring-4 ring-background",
            );

            return (
              <li key={item.key} className="-mt-5 flex flex-col items-center">
                {renderNavItem(item, fabClassName, false)}
                <span
                  className={cn(
                    "mt-1 text-label-sm font-semibold tracking-tight",
                    item.href === undefined ? "text-subtle" : "text-primary",
                  )}
                >
                  {item.label}
                </span>
              </li>
            );
          }

          const itemClassName = cn(
            ITEM_CLASSES,
            item.href === undefined
              ? "text-subtle opacity-70"
              : isNavItemCurrent(item.href, pathname)
                ? "text-primary"
                : "text-muted hover:text-primary",
          );

          return (
            <li key={item.key} className="flex-1">
              {renderNavItem(item, itemClassName, true)}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
