import { BookOpen, Heart, Home, LayoutGrid, Sparkles, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface MobileNavItem {
  /** Stable key, also selects the icon. */
  key: "home" | "components" | "configure" | "guides" | "saved";
  href: string;
  label: string;
  current?: boolean;
}

const ICONS: Record<MobileNavItem["key"], LucideIcon> = {
  home: Home,
  components: LayoutGrid,
  configure: Sparkles,
  guides: BookOpen,
  saved: Heart,
};

/**
 * Bottom navigation for mobile, matching the supplied direction: four sections
 * plus a raised central action, with the label under each icon. Hidden from
 * `lg` up, where the header carries navigation.
 *
 * The links are same-page anchors for Step 0 — the routes they name do not
 * exist yet — so nothing here pretends to navigate to a page that 404s.
 */
export function MobileNav({ label, items }: { label: string; items: readonly MobileNavItem[] }) {
  return (
    <nav
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-level-3 backdrop-blur-xl lg:hidden"
    >
      <ul className="mx-auto flex h-20 w-full max-w-page items-center justify-around px-space-xs">
        {items.map((item) => {
          const Icon = ICONS[item.key];
          const isCenter = item.key === "configure";

          if (isCenter) {
            return (
              <li key={item.key} className="-mt-5 flex flex-col items-center">
                <a
                  href={item.href}
                  className="flex size-14 items-center justify-center rounded-pill bg-primary text-accent shadow-fab ring-4 ring-background transition-transform active:scale-95"
                  aria-label={item.label}
                >
                  <Icon aria-hidden="true" className="size-6" />
                </a>
                <span className="mt-1 text-label-sm font-semibold tracking-tight text-primary">
                  {item.label}
                </span>
              </li>
            );
          }

          return (
            <li key={item.key} className="flex-1">
              <a
                href={item.href}
                aria-current={item.current ? "page" : undefined}
                className={cn(
                  "mx-auto flex h-14 min-w-12 flex-col items-center justify-center gap-0.5 rounded-control px-1 text-label-sm font-medium tracking-tight transition-colors",
                  item.current ? "text-primary" : "text-muted hover:text-primary",
                )}
              >
                <Icon aria-hidden="true" className="size-6" />
                <span>{item.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
