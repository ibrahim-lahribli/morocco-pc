/**
 * BuildSummaryCard — the results-list card, board `vos_configurations`.
 *
 * The board's list card: a 120 px media slot with the price badge floating on it,
 * then an eyebrow (why this build), the strategy name, the part line, the total,
 * what is left of the budget, and a CTA paired with a square save control.
 *
 * FOUR DECISIONS, all of which the data forced:
 *
 *   - **The media slot is DRAWN, never an image (D-01 / D-08).** No image reaches
 *     the API: migration 020 marks `image_url`/`image_source` documentation-only
 *     and `apps/web/lib/api` never reads them, so a photo here would be a stock
 *     picture of different hardware standing next to a specific SKU — a false
 *     claim, not a placeholder. `BuildFallback` draws the role and the category
 *     from tokens instead. It is a fixed 120 px block with no async content, so a
 *     missing image cannot shift layout (the CLS budget is 0, not 0.1 of room).
 *   - **The eyebrow is a claim, not a label.** "Meilleur rapport qualité/prix" is
 *     a judgement the ENGINE made (`strategy_key`); the caller passes the
 *     translated word, and anything the engine did not say must not appear here.
 *   - **The card is not the link; the CTA is.** The board wraps the whole card in
 *     a link. That makes the save button a control inside a link — invalid HTML
 *     and a coin-flip for a screen reader. So the card is a plain `<article>`, the
 *     CTA is a `LinkButton`, and the save control is a sibling slot.
 *   - **Nothing is invented.** `priceLabel`, `remainingLabel` and `partLine` take
 *     `null`/omitted and the card simply omits the line: a total the pass did not
 *     record is absent, never `0 DH`, and a build with no "left over" fact does
 *     not get a green sentence.
 *
 * The card is a SERVER component: it has no state and ships nothing. Its one
 * interactive slot (`action`) is a client island the caller owns, which keeps the
 * card itself out of every client bundle on the page.
 *
 * Not in the `@/components/ui` barrel (Phase 2 T6's measured 1 410 B rule).
 */
import type { ReactNode } from "react";

import { buttonClasses } from "./button";
import { cn } from "./cn";

/** The drawn media slot's vocabulary: a role, or the category when the role is unknown. */
export type FallbackKey =
  | "CPU"
  | "GPU"
  | "RAM"
  | "MOTHERBOARD"
  | "STORAGE"
  | "PSU"
  | "CASE"
  | "COOLER"
  | "BUILD";

export interface BuildSummaryCardProps {
  /** Why this build — the engine's strategy, translated. */
  eyebrow: string;
  /** The strategy's short name, e.g. "Équilibré". */
  title: string;
  /** The part line, pre-composed, e.g. "Ryzen 5 5600 · RTX 4060 · 16 Go". */
  partLine: string | null;
  /** The build's total, pre-formatted; `null` renders no number. */
  priceLabel: string | null;
  /** What is left of the budget, pre-formatted; `null` omits the line. */
  remainingLabel: string | null;
  /** The provenance badge — pass `Badge`, so the vocabulary stays one set. */
  status?: ReactNode;
  /** The CTA's destination and words. */
  href: string;
  ctaLabel: string;
  /** Rank 1: the border and ring the results page draws, no layout shift. */
  primary?: boolean;
  /** The save control, and any other in-card action. */
  action?: ReactNode;
  /** Which drawing the fallback slot shows. */
  fallback?: FallbackKey;
  className?: string;
}

/**
 * The drawn media slot (D-01). Deliberately quiet: a tinted block, a hairline
 * grid and the role's initial, so eight cards in a list read as a rhythm rather
 * than eight empty boxes. `aria-hidden` because the title and part line already
 * say what the build is — an announcement of "image" adds nothing.
 */
function BuildFallback({ kind }: { kind: FallbackKey }) {
  const label = kind === "BUILD" ? "PC" : kind;
  return (
    <div
      aria-hidden="true"
      data-drawn-fallback={kind}
      className="relative flex h-30 items-center justify-center overflow-hidden bg-subtle"
    >
      {/* Two hairlines, token-coloured: the "technical drawing" cue without a
          single literal colour, and without an image request. */}
      <span className="absolute inset-x-0 top-1/3 border-t border-border" />
      <span className="absolute inset-y-0 start-1/3 border-s border-border" />
      <span className="relative font-mono text-caption tracking-widest text-muted uppercase">
        {label}
      </span>
    </div>
  );
}

export function BuildSummaryCard({
  eyebrow,
  title,
  partLine,
  priceLabel,
  remainingLabel,
  status,
  href,
  ctaLabel,
  primary = false,
  action,
  fallback = "BUILD",
  className,
}: BuildSummaryCardProps) {
  return (
    <article
      data-primary={primary ? "true" : "false"}
      className={cn(
        "overflow-hidden rounded-card border bg-surface",
        primary ? "border-primary shadow-card-2 ring-1 ring-primary" : "border-border",
        className,
      )}
    >
      <div className="relative">
        <BuildFallback kind={fallback} />
        {/* The badge floats ON the media slot, as the board draws it. It is a
            sibling, not a child, of the drawn block so `aria-hidden` there stays
            true — a status inside an aria-hidden container is unreadable. */}
        {status === undefined ? null : <div className="absolute top-3 start-3">{status}</div>}
      </div>

      <div className="p-4">
        <p className="text-caption font-medium text-primary">{eyebrow}</p>
        <h3 className="mt-1 text-title text-ink">{title}</h3>
        {partLine === null ? null : (
          <p className="mt-1 text-caption text-muted">{partLine}</p>
        )}

        {priceLabel === null ? null : (
          <p className="num-tabular mt-3 text-price text-ink">{priceLabel}</p>
        )}
        {remainingLabel === null ? null : (
          <p className="mt-0.5 text-caption font-medium text-success">{remainingLabel}</p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <a href={href} className={cn(buttonClasses("primary"), "flex-1")}>
            {ctaLabel}
          </a>
          {action}
        </div>
      </div>
    </article>
  );
}
