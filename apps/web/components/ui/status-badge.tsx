/**
 * StatusBadge — the build's own verdict, which is exactly two values.
 *
 * The engine persists a build as `PASS` or `UNKNOWN` and rejects the rest
 * (`validate-selected.js`), so a four-state compatibility vocabulary
 * (`PASS/FAIL/UNKNOWN/CONDITIONAL`) cannot be rendered — three of those values
 * do not exist on the read path. This badge therefore states what is known, and
 * `UNKNOWN` is drawn as a question mark rather than a failure: unknown is not
 * "won't work", and dressing it as a warning would be a lie the data does not
 * support.
 *
 * Deliberately NOT a new `tone` on `Badge`: `Badge`'s union is the three PRICE
 * states, and widening it would mix two vocabularies in one prop — a caller
 * reading `tone="PASS"` would have no way to know which axis it is on. Two
 * components, two closed vocabularies.
 *
 * The label is a prop, never a literal: the words come from `messages/`.
 */
import type { ReactNode } from "react";

import { cn } from "./cn";
import { CheckIcon, QuestionCircleIcon } from "./icons";

export type BuildState = "PASS" | "UNKNOWN";

export interface StatusBadgeProps {
  state: BuildState;
  /** The localized label, e.g. "Compatible" / "À vérifier". */
  children: ReactNode;
  className?: string;
}

const TONES: Record<BuildState, { pill: string; icon: string }> = {
  PASS: {
    pill: "border-success/30 bg-success-soft text-success",
    icon: "text-success",
  },
  UNKNOWN: {
    // Dashed, like the price badge's "démo": the shape says "not established"
    // before the word does, so the two are distinguishable in greyscale.
    pill: "border-dashed border-muted/60 bg-subtle text-muted",
    icon: "text-muted",
  },
};

export function StatusBadge({ state, children, className }: StatusBadgeProps) {
  const tone = TONES[state];
  const Icon = state === "PASS" ? CheckIcon : QuestionCircleIcon;

  return (
    <span
      data-build-state={state}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 py-1 text-caption font-medium",
        tone.pill,
        className,
      )}
    >
      <Icon size="badge" className={tone.icon} />
      {children}
    </span>
  );
}
