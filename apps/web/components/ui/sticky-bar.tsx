/**
 * StickyBar — the bottom action bar, board `d_tail_configuration_quilibr`.
 *
 * The design's pinned bar: a small uppercase label over the figure, a status
 * slot beside it, and ONE primary action to the end of the row. It exists so a
 * decision made at the top of a long screen (save this build, go to the
 * retailer) does not require scrolling back.
 *
 * Why it is not `BottomTabBar` with children: they answer different questions.
 * The tab bar is navigation and belongs to the shell; this is a decision about
 * the CURRENT screen and owns no links. Sharing one component would give the
 * same row two owners.
 *
 * It is `fixed`, so it covers content: the screen that renders it must reserve
 * `STICKY_BAR_OFFSET` below its last block, or the footer of the page disappears
 * behind the bar — the exact "fixed bars never hide content" rule from PLAN.md.
 * The offset is exported here so the bar and the padding cannot drift.
 *
 * `env(safe-area-inset-bottom)` is physical on purpose: the home indicator is at
 * the bottom edge in both reading directions, so it must not mirror under
 * `dir="rtl"`. It is non-zero only with `viewport-fit=cover` (the layout's
 * viewport export).
 *
 * Server-safe: no hooks, no client state. The action arrives as a node, so the
 * bar can never grow its own button variant list.
 */
import type { ReactNode } from "react";

import { cn } from "./cn";

export interface StickyBarProps {
  /** The small uppercase caption above the figure, e.g. "Total". */
  label: string;
  /** The figure, already formatted by `lib/i18n/format.ts`. */
  value: string;
  /** The status slot beside the figure — usually a `Badge`. */
  status?: ReactNode;
  /** The one primary action (a `Button` or a `LinkButton`). */
  action: ReactNode;
  className?: string;
}

/** The room a screen must leave under its content: 76 px of bar plus the inset. */
export const STICKY_BAR_OFFSET = "pb-[calc(4.75rem+1px+env(safe-area-inset-bottom,0px))]";

export function StickyBar({ label, value, status, action, className }: StickyBarProps) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-md",
        "pb-[env(safe-area-inset-bottom,0px)] shadow-bar",
        className,
      )}
    >
      <div className="mx-auto flex min-h-19 w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <p className="text-micro font-semibold tracking-wider text-muted uppercase">{label}</p>
          <p className="mt-0.5 flex items-center gap-1.5">
            <span className="num-tabular text-price text-ink">{value}</span>
            {status}
          </p>
        </div>
        <div className="shrink-0">{action}</div>
      </div>
    </div>
  );
}
