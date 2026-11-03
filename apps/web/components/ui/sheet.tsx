"use client";

/**
 * Sheet — the mobile bottom sheet, on Radix Dialog.
 *
 * Chosen at T2 (Phase 2) because Radix buys the parts a hand-rolled sheet gets
 * wrong: a focus trap that returns focus to the trigger, Escape handling, an
 * `aria-modal` dialog that hides the background from assistive tech, and body
 * scroll locking. The primitive carries **no copy of its own** — `title`,
 * `description` and `closeLabel` are props, so every string still comes from the
 * caller's `messages/` lookups, and this file stays locale-free.
 *
 * Deliberately NOT animated. A slide-up transition is a CSS animation on an
 * element that mounts late, which is the cheapest way to add a layout shift to a
 * route whose CLS budget is 0; the design's motion can be added at Phase 5 as a
 * `prefers-reduced-motion`-aware transition once it can be measured.
 *
 * The panel is bottom-anchored at every width for now: mobile is the product,
 * and Phase 5 owns the desktop adaptation (a centred dialog from `md:` up).
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

import { cn } from "./cn";

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required by Radix: a dialog with no accessible name is a bug, not a style. */
  title: string;
  /** Announced as the dialog's description; omit only when the body says it. */
  description?: string;
  /** Accessible name of the close control (the visible glyph is decoration). */
  closeLabel: string;
  children: ReactNode;
  /** Pinned action row, e.g. the sticky confirm/cancel pair. */
  footer?: ReactNode;
  className?: string;
}

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  children,
  footer,
  className,
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* The overlay is decoration: Radix already hides the background from the
            accessibility tree, so it carries no role and no text. */}
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto",
            "rounded-t-xl border-t border-border bg-surface px-4 pt-4 pb-6 shadow-card-2",
            className,
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="text-title text-ink">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-compact text-muted">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            {/* 44 px target, and the glyph is not the accessible name. */}
            <Dialog.Close
              aria-label={closeLabel}
              className={cn(
                "inline-flex h-tap w-tap shrink-0 items-center justify-center",
                "rounded-control text-subtitle text-muted",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              )}
            >
              <span aria-hidden="true">×</span>
            </Dialog.Close>
          </div>

          <div className="mt-4">{children}</div>

          {footer ? <div className="mt-4 flex flex-col gap-2">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
