/**
 * TrustItem — one promise on the home screen's trust strip, board `accueil`.
 *
 * The home page makes three claims before it shows a number: the builds are
 * compatibility-checked, a price says how trustworthy it is, and no account is
 * needed. Each is an icon, a short title and a sentence — the SAME shape, so the
 * three read as a set rather than as one admonition and two asides.
 *
 * The icon is decorative (`aria-hidden` in `icons.tsx`) because the title always
 * says the same thing in words: an announcement that begins "icon: shield" is
 * noise. The title is a real heading level only when the caller wraps it; here it
 * is a `<p>` with `font-semibold`, since a strip of three `<h3>`s under an `<h2>`
 * would enter the document outline as three sections that are not sections.
 *
 * `tone` is closed to three values on purpose: it is the price-provenance axis
 * (`verified` / `indicative` / `demo`) that the Badge already owns, plus a neutral
 * for the two claims that are not about price. Anything wider would be decoration.
 *
 * Server-safe: no hooks. Not in the barrel (measured cost, Phase 2 T6).
 */
import type { ReactNode } from "react";

import { cn } from "./cn";

export type TrustTone = "neutral" | "verified" | "indicative";

export interface TrustItemProps {
  /** The claim in a few words. */
  title: string;
  /** The sentence that supports it. */
  children: ReactNode;
  /** A glyph from `icons.tsx`; decorative. */
  icon: ReactNode;
  tone?: TrustTone;
  className?: string;
}

const TONES: Record<TrustTone, string> = {
  neutral: "bg-subtle text-primary",
  verified: "bg-price-verified-bg text-price-verified-text",
  indicative: "bg-price-indicative-bg text-price-indicative-text",
};

export function TrustItem({ title, children, icon, tone = "neutral", className }: TrustItemProps) {
  return (
    <li data-trust-item="" className={cn("flex items-start gap-3", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-pill",
          TONES[tone],
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-compact font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-compact text-muted">{children}</p>
      </div>
    </li>
  );
}
