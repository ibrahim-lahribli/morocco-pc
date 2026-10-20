/**
 * Badge — board §9, the three price-status pills.
 *
 * The three tones are a hierarchy of trust, not decoration: `demo` is dashed and
 * muted (nothing is known), `indicative` is the warning pair (a price exists but
 * is stale), `verified` is the success pair and is the ONLY tone allowed to
 * carry a date. Colour is never the only signal — each pill has its own word,
 * and its own icon shape, so the three are distinguishable in greyscale and to a
 * screen reader.
 *
 * `whitespace-nowrap` is the board's rule and it is load-bearing: a pill that
 * wraps stops reading as one status.
 */
import type { ReactNode } from "react";

import { cn } from "./cn";
import { CheckIcon, ClockIcon, QuestionCircleIcon } from "./icons";

export type BadgeTone = "demo" | "indicative" | "verified";

export interface BadgeProps {
  tone: BadgeTone;
  children: ReactNode;
  className?: string;
}

const TONES: Record<BadgeTone, { pill: string; icon: string }> = {
  demo: {
    pill: "border-dashed border-muted/60 bg-subtle text-muted",
    icon: "text-muted",
  },
  indicative: {
    pill: "border-warning/30 bg-warning-soft text-warning",
    icon: "text-warning",
  },
  verified: {
    pill: "border-success/30 bg-success-soft text-success",
    icon: "text-success",
  },
};

export function Badge({ tone, children, className }: BadgeProps) {
  const style = TONES[tone];
  const Icon =
    tone === "verified" ? CheckIcon : tone === "indicative" ? ClockIcon : QuestionCircleIcon;

  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 py-1 text-caption font-medium",
        style.pill,
        className,
      )}
    >
      <Icon size="badge" className={style.icon} />
      {children}
    </span>
  );
}
