import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";

import { LocaleSwitcher } from "./locale-switcher";
import { Logo } from "./logo";

export interface SiteHeaderProps {
  locale: AppLocale;
  brand: string;
  navLabel: string;
  languageLabel: string;
  labels: Record<AppLocale, string>;
  ariaLabels: Record<AppLocale, string>;
}

/** Sticky application header: brand placeholder, then the locale switcher. */
export function SiteHeader({
  locale,
  brand,
  navLabel,
  languageLabel,
  labels,
  ariaLabels,
}: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur">
      <nav
        aria-label={navLabel}
        className="mx-auto flex h-16 w-full max-w-page items-center justify-between gap-3 px-margin-mobile md:px-margin"
      >
        <Link
          href="/"
          className="flex h-11 items-center gap-2.5 rounded-control px-1 font-semibold text-foreground"
        >
          <Logo label={brand} />
          <span className="text-headline-sm tracking-tight">{brand}</span>
        </Link>

        <LocaleSwitcher
          label={languageLabel}
          labels={labels}
          ariaLabels={ariaLabels}
          active={locale}
        />
      </nav>
    </header>
  );
}
