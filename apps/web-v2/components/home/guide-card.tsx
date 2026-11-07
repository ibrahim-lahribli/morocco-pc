import { ArrowRight, BookOpen } from "lucide-react";

export interface GuideCardProps {
  category: string;
  /** Already interpolated, e.g. "4 min de lecture". */
  minutes: string;
  title: string;
  cta: string;
}

/**
 * One guide preview: token-gradient media, category + reading time, title and
 * the call to action.
 *
 * A plain `<article data-disabled="true">` rather than a link: the guide routes
 * and their bodies belong to a later step, so the card states what it is without
 * pointing at a 404. `aria-disabled` used to sit here and was wrong — the
 * attribute is only supported on widget roles, and `article` is not one, so it
 * announced nothing while failing `jsx-a11y/role-supports-aria-props`. The card
 * holds no interactive element for it to disable: the CTA is text, so the hook
 * is a data attribute for styling and tests only.
 */
export function GuideCard({ category, minutes, title, cta }: GuideCardProps) {
  return (
    <article
      data-disabled="true"
      className="flex h-full flex-col gap-3 rounded-card border border-border bg-surface p-4 shadow-level-1"
    >
      <div
        aria-hidden="true"
        className="flex h-24 items-center justify-center rounded-field bg-linear-to-br from-primary-soft via-surface-muted to-surface-sunken text-primary/30 lg:h-40"
      >
        <BookOpen className="size-8" />
      </div>

      <p className="flex items-center gap-1.5 text-label-md text-muted">
        <span className="rounded-pill bg-accent-soft px-2 py-0.5 text-accent-ink">{category}</span>
        <span aria-hidden="true">·</span>
        {minutes}
      </p>

      <h3 className="text-headline-sm text-balance text-foreground">{title}</h3>

      <p className="mt-auto flex items-center gap-1.5 text-label-lg text-primary">
        {cta}
        <ArrowRight aria-hidden="true" className="size-4 rtl:-scale-x-100" />
      </p>
    </article>
  );
}
