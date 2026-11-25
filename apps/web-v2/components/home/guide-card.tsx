import { BookOpen, Clock } from "lucide-react";

export interface GuideCardProps {
  /** Already interpolated, e.g. "4 min de lecture". */
  minutes: string;
  title: string;
}

/**
 * One guide preview: token-gradient thumbnail in its own column, reading time
 * and title beside it.
 *
 * A plain `<article data-disabled="true">` rather than a link: the guide routes
 * and their bodies belong to a later step, so the card states what it is without
 * pointing at a 404. The hover/active classes give it the approved clickable
 * feel until an href can land — they are presentation only, the element stays
 * non-interactive (`aria-disabled` is not set here because `article` does not
 * support it).
 */
export function GuideCard({ minutes, title }: GuideCardProps) {
  return (
    <article
      data-disabled="true"
      className="group flex h-full items-center gap-4 rounded-card border border-border bg-surface p-3.5 shadow-level-1 transition duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-level-2 active:translate-y-0"
    >
      <div
        aria-hidden="true"
        className="flex size-16 shrink-0 items-center justify-center rounded-field bg-linear-to-br from-primary-soft via-surface-muted to-surface-sunken text-primary/30 transition duration-200 group-hover:text-primary/50"
      >
        <BookOpen className="size-6" />
      </div>

      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-label-md text-muted">
          <Clock aria-hidden="true" className="size-3.5" />
          {minutes}
        </p>
        <h3 className="mt-1 text-headline-sm text-balance text-foreground">{title}</h3>
      </div>
    </article>
  );
}
