"use client";

/**
 * ExplainerSheet — a bottom sheet that explains one thing, board
 * `remplacer_la_carte_graphique_quilibr` / `filtre_marque_cartes_graphiques`.
 *
 * `Sheet` is the mechanism (trap, Escape, scroll lock, focus return); this is the
 * SHAPE the design gives an explanation: a drag handle, a category eyebrow, a
 * title, and prose. Kept separate because five screens will open an explainer and
 * none of them should re-invent the handle or the eyebrow.
 *
 * What it deliberately does NOT do:
 *
 *   - **It does not animate.** `Sheet` is unanimated for a measured reason (CLS
 *     budget 0), and a child cannot opt out of a parent's transition.
 *   - **It does not fetch.** An explainer that loads its own text would be a
 *     second data path for copy; the caller passes `children`, which is already
 *     server-rendered prose from `messages/` or MDX.
 *   - **It carries no close button of its own.** `Sheet` already renders one with
 *     a `closeLabel` from `messages/`; a second close control in the same dialog
 *     would give the trap two exits with different names.
 *
 * The footer is the confirm/cancel pair a decision sheet needs; the explainer
 * usually passes none, in which case the sheet is read-only prose.
 */
import type { ReactNode, RefObject } from "react";

import { Sheet } from "./sheet";

export interface ExplainerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The category line above the title, e.g. "Prix" — the design's eyebrow. */
  eyebrow: string;
  title: string;
  /** The accessible name of the close control. */
  closeLabel: string;
  description?: string;
  /** The opener. Preferred over `returnFocusTo`: Radix owns the whole cycle. */
  trigger?: ReactNode;
  /** The opener when it is not a single stable element. */
  returnFocusTo?: RefObject<HTMLElement | null>;
  /** The prose. Server-rendered by the caller. */
  children: ReactNode;
  footer?: ReactNode;
}

export function ExplainerSheet({
  open,
  onOpenChange,
  eyebrow,
  title,
  closeLabel,
  description,
  trigger,
  returnFocusTo,
  children,
  footer,
}: ExplainerSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      closeLabel={closeLabel}
      trigger={trigger}
      returnFocusTo={returnFocusTo}
      footer={footer}
    >
      {/* The handle is decoration: it hints at the bottom sheet on iOS and is
          hidden from the accessibility tree, which already knows it is a dialog. */}
      <div aria-hidden="true" className="mx-auto -mt-1 mb-3 h-1 w-12 rounded-pill bg-border" />
      <p className="text-micro font-bold tracking-wider text-primary uppercase">{eyebrow}</p>
      <div className="mt-2 text-compact text-ink">{children}</div>
    </Sheet>
  );
}
