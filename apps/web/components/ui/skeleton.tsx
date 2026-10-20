/**
 * Skeleton — board §15.
 *
 * The board's placeholder is a set of `stone-200` blocks with `animate-pulse`;
 * `stone-200` becomes `track`, so the skeleton and the progress rail share one
 * neutral. The first block is 16 px to match the heading it replaces, then 12,
 * then an 8 px rail, then two 24 px pills — that ordering is why a loading
 * screen reads as "text, text, bar, badge row" instead of five grey rectangles.
 *
 * `aria-hidden` and no text: a loading placeholder is decoration. Progress is
 * announced by the live region the screen owns (`aria-busy`), not by every
 * shimmering rectangle. The global `prefers-reduced-motion` block in
 * `app/globals.css` already collapses the pulse, so this needs no variant.
 */
import { cn } from "./cn";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse bg-track", className)} />;
}

/** The board's full card placeholder, for a list of builds arriving. */
export function SkeletonCard() {
  return (
    <div className="space-y-3 rounded-card border border-border bg-surface p-3.5">
      <Skeleton className="h-4 w-1/3 rounded" />
      <Skeleton className="h-3 w-3/4 rounded" />
      <Skeleton className="h-2 w-full rounded-pill" />
      <div className="flex items-center justify-between pt-2">
        <Skeleton className="h-6 w-24 rounded" />
        <Skeleton className="h-6 w-20 rounded-pill" />
      </div>
    </div>
  );
}
