/**
 * components/saved/saved-builds.tsx — the shelf, as the browser knows it (S25).
 *
 * The page around this island is a server component and stays one; what cannot
 * be server-rendered is "what this browser has saved", so it is a client island
 * whose SERVER snapshot is the empty shelf. That is not a placeholder: with no
 * JavaScript, the empty state plus its call to action is a true statement about a
 * page that cannot read storage at all.
 *
 * An entry is a POINTER, not a copy (see `lib/saved/builds.ts`): the row shows
 * the strategy, the total the page recorded and when this device saved it, and
 * "Ouvrir le résultat" goes back to `/config/[id]` where the build is rendered
 * from the API. A saved total can therefore never disagree with the card it
 * links to, because the card does not read it.
 *
 * Two accessibility details:
 *
 *   - every row's two controls repeat the same words ("Ouvrir le résultat",
 *     "Retirer"), so each carries the strategy and date in an `sr-only` suffix —
 *     the same fix the compare page's "Retirer" links use;
 *   - a removal is announced through a live region that exists from the first
 *     render, because the row simply disappearing is not a sentence.
 *
 * A refused removal is REPORTED, never swallowed: the row stays where it was,
 * and a warning says the write did not happen. A removal that SUCCEEDS gives
 * focus somewhere to go — the shelf, not `<body>` — because the row that owned it
 * is gone.
 */
"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Alert, Button, LinkButton } from "@/components/ui";
import { formatDate, formatMoney, type AppLocale } from "@/lib/i18n/format";
import { localePath } from "@/lib/i18n/paths";
import { OTHER_KEY, strategyLabel } from "@/lib/result/model";
import {
  removeSaved,
  savedKey,
  savedServerSnapshot,
  savedSnapshot,
  subscribeSaved,
  type SavedBuild,
} from "@/lib/saved/builds";

export interface SavedBuildsLabels {
  emptyTitle: string;
  emptyBody: string;
  emptyCta: string;
  /** The store could not be READ: say so instead of claiming an empty shelf. */
  readUnavailable: string;
  /** A removal was refused: the list still holds what it held. */
  removeUnavailable: string;
  open: string;
  remove: string;
  /** Announced after a removal. */
  removed: string;
  /** "Enregistré le" — the date follows it, formatted for the locale. */
  savedOnLabel: string;
  /** A total the pass did not record: NULL is not 0. */
  noTotal: string;
}

export interface SavedBuildsProps {
  labels: SavedBuildsLabels;
  /** One word per strategy key, resolved in the reader's locale by the page. */
  strategies: Record<string, string>;
  /** Where an empty shelf sends the reader. */
  wizardHref: string;
  locale: AppLocale;
}

export function SavedBuilds({ labels, strategies, wizardHref, locale }: SavedBuildsProps) {
  const shelf = useSyncExternalStore(subscribeSaved, savedSnapshot, savedServerSnapshot);
  const [removeFailed, setRemoveFailed] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [focusToken, setFocusToken] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  /**
   * The removed row owned the focus, so without this the click leaves a
   * keyboard user on `<body>` and the next Tab starts at the top of the page.
   * Focus moves to the shelf ITSELF — the list, or the empty card — once React
   * has rendered it: not to the next row's "Retirer", because a held-down Enter
   * would then delete the shelf one item per keypress.
   */
  useEffect(() => {
    if (focusToken === 0) return;
    rootRef.current?.querySelector<HTMLElement>("[data-shelf-focus]")?.focus();
  }, [focusToken]);

  function onRemove(entry: SavedBuild): void {
    const outcome = removeSaved(entry);
    if (outcome.kind === "ok") {
      setRemoveFailed(false);
      setAnnounce(labels.removed);
      setFocusToken((token) => token + 1);
      return;
    }
    setRemoveFailed(true);
  }

  const strategyName = (entry: SavedBuild): string =>
    strategies[strategyLabel(entry.strategyKey)] ?? strategies[OTHER_KEY];

  return (
    <div ref={rootRef}>
      {/* Present from the first render, so the removal is spoken into a region
          that already exists (share-bar's rule). */}
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>

      {removeFailed ? (
        <div className="mt-4 max-w-prose">
          <Alert tone="warning">{labels.removeUnavailable}</Alert>
        </div>
      ) : null}

      {shelf.unavailable ? (
        /* The store refused to be READ, so "rien n'a été enregistré" is not a
           fact this page holds — an empty state here would be a guess dressed as
           a sentence. Say what happened, and keep the way forward. */
        <div data-shelf-focus tabIndex={-1} className="mt-6 max-w-prose">
          <Alert tone="warning">{labels.readUnavailable}</Alert>
          <div className="mt-4">
            <LinkButton href={wizardHref}>{labels.emptyCta}</LinkButton>
          </div>
        </div>
      ) : shelf.entries.length === 0 ? (
        <div
          data-shelf-focus
          tabIndex={-1}
          className="mt-6 rounded-card border border-border bg-subtle p-4"
        >
          <h2 className="text-subtitle text-ink">{labels.emptyTitle}</h2>
          <p className="mt-2 max-w-prose text-compact text-ink">{labels.emptyBody}</p>
          <div className="mt-4">
            <LinkButton href={wizardHref}>{labels.emptyCta}</LinkButton>
          </div>
        </div>
      ) : (
        <ul
          data-shelf-focus
          tabIndex={-1}
          className="mt-6 divide-y divide-border rounded-card border border-border"
        >
          {shelf.entries.map((entry) => {
            const name = strategyName(entry);
            const date = formatDate(entry.savedAt, locale);
            return (
              <li
                key={savedKey(entry)}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-compact font-medium text-ink">{name}</p>
                  <p className="mt-0.5 text-micro text-muted">
                    {labels.savedOnLabel}{" "}
                    <time dateTime={entry.savedAt}>{date}</time>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="num-tabular text-compact text-ink">
                    {entry.totalPrice === null
                      ? labels.noTotal
                      : formatMoney(entry.totalPrice, locale)}
                  </span>
                  <Link
                    href={localePath(locale, `/config/${encodeURIComponent(entry.id)}`)}
                    className="text-compact text-primary underline-offset-4 hover:underline"
                  >
                    {labels.open}
                    <span className="sr-only">
                      {" — "}
                      {name}, {date}
                    </span>
                  </Link>
                  <Button variant="ghost" size="compact" onClick={() => onRemove(entry)}>
                    {labels.remove}
                    <span className="sr-only">
                      {" — "}
                      {name}, {date}
                    </span>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
