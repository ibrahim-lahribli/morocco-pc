import { cn } from "@/lib/utils";

export interface PrimaryNavItem {
  /** A same-page anchor; the homepage has no child routes yet. */
  href: string;
  label: string;
  current?: boolean;
}

/**
 * Desktop anchor navigation. Anchors only: the destinations it names are
 * sections of this page, so every link resolves without a new route.
 */
export function PrimaryNav({ label, items }: { label: string; items: readonly PrimaryNavItem[] }) {
  return (
    <nav aria-label={label} className="hidden items-center gap-1 lg:flex">
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          aria-current={item.current ? "page" : undefined}
          className={cn(
            "inline-flex h-11 items-center rounded-control px-3 text-label-lg transition-colors",
            item.current ? "text-primary" : "text-muted hover:bg-primary-soft hover:text-primary",
          )}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
