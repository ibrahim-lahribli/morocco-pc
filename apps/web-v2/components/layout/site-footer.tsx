import { cn } from "@/lib/utils";

import { Logo } from "./logo";

export interface SiteFooterProps {
  brand: string;
  tagline: string;
  copyright: string;
  /** The served market, e.g. "Casablanca · Rabat · Maroc". Mobile row only. */
  location?: string;
  /**
   * Placeholder destinations. None of them has a route yet, so each renders as
   * `aria-disabled` text — never a link to nowhere, and never a link to an
   * unrelated homepage anchor.
   */
  links?: readonly string[];
}

/**
 * Footer: brand, promise and the legal line.
 *
 * Below `lg` it follows the mobile frame — a brand row carrying the served
 * market, a wrapped row of link labels, then the copyright. From `lg` the Step
 * 0 single row is unchanged, because the design's desktop frame has no footer.
 */
export function SiteFooter({ brand, tagline, copyright, location, links }: SiteFooterProps) {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-page flex-col gap-4 px-margin-mobile py-8 md:px-margin lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <div className="flex items-center justify-between gap-3 lg:justify-start">
          <div className="flex items-center gap-2.5">
            <Logo label={brand} size="sm" />
            <span className="text-label-lg font-bold text-primary">{brand}</span>
          </div>
          {location ? <p className="text-body-sm text-muted lg:hidden">{location}</p> : null}
        </div>

        <p
          className={cn(
            "text-body-sm text-muted",
            links?.length ? "hidden lg:block" : "text-center",
          )}
        >
          {tagline}
        </p>

        {links?.length ? (
          <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 lg:hidden">
            {links.map((link) => (
              <li key={link}>
                <span aria-disabled="true" className="text-body-sm text-muted">
                  {link}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="text-center text-body-sm text-subtle lg:text-end">{copyright}</p>
      </div>
    </footer>
  );
}
