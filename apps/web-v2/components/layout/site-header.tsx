import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";

import { LocaleSwitcher } from "./locale-switcher";
import { Logo } from "./logo";
import { PrimaryNav, type PrimaryNavItem } from "./primary-nav";

export interface SiteHeaderProps {
  locale: AppLocale;
  brand: string;
  navLabel: string;
  languageLabel: string;
  labels: Record<AppLocale, string>;
  ariaLabels: Record<AppLocale, string>;
  /** Desktop anchors; the header renders no nav at all when this is empty. */
  navItems?: readonly PrimaryNavItem[];
}

/**
 * Sticky application header: brand, the desktop anchors, then the locale
 * switcher. 56 px on mobile and 64 px from `lg`, per the frames.
 */
export function SiteHeader({
  locale,
  brand,
  navLabel,
  languageLabel,
  labels,
  ariaLabels,
  navItems,
}: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-page items-center justify-between gap-3 px-margin-mobile md:px-margin lg:h-16">
        <Link
          href="/"
          className="flex h-11 items-center gap-2.5 rounded-control px-1 font-semibold text-foreground"
        >
          <Logo label={brand} />
          <span className="text-headline-sm tracking-tight">{brand}</span>
        </Link>

        {navItems?.length ? <PrimaryNav label={navLabel} items={navItems} /> : null}

        <LocaleSwitcher
          label={languageLabel}
          labels={labels}
          ariaLabels={ariaLabels}
          active={locale}
        />
      </div>
    </header>
  );
}
