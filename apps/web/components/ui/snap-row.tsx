/**
 * SnapRow — the horizontal scroll-snap scroller, board `composants` / detail.
 *
 * The board uses it for "Utilisée dans ces configurations" and the related-guides
 * strip: a row of cards that bleeds past the page gutter and snaps one card at a
 * time. Native `overflow-x-auto` + `scroll-snap-type` does the work, so the
 * momentum, the rubber-banding and the keyboard scrolling are the platform's.
 *
 * Three rules from PLAN.md, and where each one lives:
 *
 *   - **Never the only path.** A horizontal strip that hides half its items from
 *     a keyboard user is a dead end, so the scroller itself is focusable
 *     (`tabIndex={0}`) with the row's own `label` as its accessible name — arrows
 *     then scroll it, and every card inside is still a real link in the tab order.
 *     The screen must ALSO offer the same destinations in a non-scrolling form
 *     (a plain list further down the page, or the index it links to); this
 *     component cannot enforce that, so it is written in the header instead.
 *   - **RTL mirrors for free.** The bleed is symmetric (`-mx-4 px-4`) and the
 *     scroll container follows `dir` on its own, so there is no direction class to
 *     get wrong.
 *   - **No `overflow: hidden` on an ancestor.** It would clip the snap row's
 *     shadow; sheets and cards use `rounded-*` + `overflow-hidden` themselves.
 *
 * `children` are the `<li>`s: the row owns the scroller, the caller owns the
 * cards, because the cards differ per screen and the scrolling does not.
 *
 * Server-safe: no hooks, no state.
 */
import type { ReactNode } from "react";

import { cn } from "./cn";

export interface SnapRowProps {
  /** The row's accessible name — it is announced when the scroller takes focus. */
  label: string;
  children: ReactNode;
  className?: string;
}

export function SnapRow({ label, children, className }: SnapRowProps) {
  return (
    <ul
      data-snap-row=""
      aria-label={label}
      tabIndex={0}
      className={cn(
        // `-mx-4 px-4` bleeds to the page edge and still lines the first card up
        // with the content above it; symmetric, so `dir="rtl"` mirrors it.
        "-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2",
        // A visible focus ring on the scroller itself: it is a control here.
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      {children}
    </ul>
  );
}

/** The wrapper every child of a `SnapRow` needs, so the snapping cannot drift. */
export function SnapRowItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <li className={cn("w-56 shrink-0 snap-start", className)}>{children}</li>;
}
