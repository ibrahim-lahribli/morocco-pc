import { Logo } from "./logo";

export interface SiteFooterProps {
  brand: string;
  tagline: string;
  copyright: string;
}

/** Minimal footer: brand, one-line promise, copyright. */
export function SiteFooter({ brand, tagline, copyright }: SiteFooterProps) {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-page flex-col items-center gap-2 px-margin-mobile py-8 text-center md:px-margin lg:flex-row lg:justify-between lg:text-start">
        <div className="flex items-center gap-2.5">
          <Logo label={brand} size="sm" />
          <span className="text-label-lg font-bold text-primary">{brand}</span>
        </div>
        <p className="text-body-sm text-muted">{tagline}</p>
        <p className="text-body-sm text-subtle">{copyright}</p>
      </div>
    </footer>
  );
}
