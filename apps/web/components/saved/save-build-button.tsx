/**
 * components/saved/save-build-button.tsx — "Enregistrer", on a build card (S25).
 *
 * A toggle, and its state is kept in `localStorage` rather than in the page: the
 * result page is a server component that renders the same HTML for everyone, so
 * "is this build already on the shelf" can only be answered in the browser. That
 * is what `useSyncExternalStore` is for — the SERVER snapshot is the empty shelf
 * (the truthful server-rendered answer), and React reconciles to the real one
 * after hydration with no mismatch and no set-state-in-an-effect.
 *
 * Three decisions worth naming:
 *
 * 1. **The button's name is the ACTION, and its state is a WORD.** `aria-pressed`
 *    carries saved/not-saved, the label stays "Enregistrer", and the sentence
 *    under it says "Enregistré sur cet appareil." — a pressed toggle whose name
 *    changes is the classic ambiguous control, and a colour-only state would be
 *    a fact nobody using a screen reader receives.
 * 2. **The live region exists from the first render.** The paragraph is rendered
 *    empty and then filled (share-bar makes the same point): creating a live
 *    region at the moment you speak into it is how the announcement gets lost.
 * 3. **A refused write is said out loud, differently per cause.** "Full" asks the
 *    reader to remove one; "unavailable" says nothing was saved. Neither pretends
 *    the save happened — the store keeps its previous value in both cases.
 *
 * The strings arrive as props from the server page: this app ships no client
 * message catalogue (design/I18N.md), and a click handler is not a reason to
 * start.
 */
"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui";
import {
  isSavedIn,
  removeSaved,
  saveBuild,
  savedServerSnapshot,
  savedSnapshot,
  subscribeSaved,
  type SavedBuild,
} from "@/lib/saved/builds";

export interface SaveBuildLabels {
  /** The toggle's name, constant: the ACTION, not the state. */
  save: string;
  /** The word that says the build is on the shelf. */
  saved: string;
  /** Said after a removal, so the change is not silent. */
  removed: string;
  /** `QuotaExceededError`: the device has no room for one more. */
  full: string;
  /** The store refused access: nothing was written. */
  unavailable: string;
  /** The way to the shelf, offered at the moment of saving. */
  openShelf: string;
}

export interface SaveBuildProps {
  /** Everything the shelf needs except the moment it is saved. */
  entry: Omit<SavedBuild, "savedAt">;
  /** Where the list lives, so saving leads somewhere in the same breath. */
  shelfHref: string;
  labels: SaveBuildLabels;
}

/** Only the FAILURES and the removal need remembering; "saved" is derived. */
type Status = "idle" | "removed" | "full" | "unavailable";

export function SaveBuildButton({ entry, shelfHref, labels }: SaveBuildProps) {
  const shelf = useSyncExternalStore(subscribeSaved, savedSnapshot, savedServerSnapshot);
  const saved = isSavedIn(shelf.entries, entry);
  const [status, setStatus] = useState<Status>("idle");

  function toggle(): void {
    if (saved) {
      const outcome = removeSaved(entry);
      setStatus(outcome.kind === "ok" ? "removed" : outcome.kind);
      return;
    }
    // The moment belongs to the click, not to a render: nothing here reads the
    // clock while drawing, so a page can never be diffed against "now".
    const outcome = saveBuild({ ...entry, savedAt: new Date().toISOString() });
    setStatus(outcome.kind === "ok" ? "idle" : outcome.kind);
  }

  const message =
    status === "full"
      ? labels.full
      : status === "unavailable"
        ? labels.unavailable
        : saved
          ? labels.saved
          : status === "removed"
            ? labels.removed
            : "";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button variant="secondary" size="compact" aria-pressed={saved} onClick={toggle}>
          {labels.save}
        </Button>
        {/* Outside the live region on purpose: the announcement is the state, and
            a link read out mid-sentence is not a sentence. */}
        {saved ? (
          <Link
            href={shelfHref}
            className="text-compact text-primary underline-offset-4 hover:underline"
          >
            {labels.openShelf}
          </Link>
        ) : null}
      </div>
      {/* Reserved height: the sentence appears after a click, and a card that
          grows under the reader's finger is a worse answer than a gap. */}
      <p aria-live="polite" className="mt-1.5 min-h-6 text-compact text-muted">
        {message}
      </p>
    </div>
  );
}
