export interface AnnouncementBannerProps {
  label: string;
  /** Rendered only when the Arabic experience is live; omit to hide the chip. */
  arabicBadge?: string;
}

/**
 * Full-bleed announcement strip above the header.
 *
 * Desktop only (`md` up), per the frames. `role="note"` and not a live region:
 * the text is static, so announcing it on every visit would be noise. No
 * freshness date is shown, because no verified timestamp backs one.
 */
export function AnnouncementBanner({ label, arabicBadge }: AnnouncementBannerProps) {
  return (
    <div role="note" className="hidden border-b border-border/60 bg-surface-muted md:block">
      <div className="mx-auto flex w-full max-w-page items-center justify-between gap-3 px-margin-mobile py-2.5 md:px-margin">
        <p className="flex items-center gap-2 text-label-md text-muted">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-pill bg-accent" />
          {label}
        </p>
        {arabicBadge ? (
          <span className="rounded-pill bg-surface-sunken px-3 py-1 text-label-md text-primary">
            {arabicBadge}
          </span>
        ) : null}
      </div>
    </div>
  );
}
