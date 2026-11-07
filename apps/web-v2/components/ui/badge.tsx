import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Status pills. `verified` and `indicative` are the two price states the
 * supplied designs use; `estimated` is the third state the DESIGN.md palette
 * defines. The wording always comes from the caller, so a badge cannot invent
 * a fourth label locally. A pill is one line by construction (its height is
 * fixed), so in a flex row it neither wraps nor shrinks below its label.
 */
export const badgeVariants = cva(
  "inline-flex h-[26px] shrink-0 items-center gap-1 rounded-pill border px-2.5 text-label-sm font-semibold whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        verified: "border-verified-border bg-verified-soft text-verified",
        indicative: "border-indicative-border bg-indicative-soft text-indicative",
        estimated: "border-estimated-border bg-estimated-soft text-estimated",
        primary: "border-primary/15 bg-primary-soft text-primary",
        neutral: "border-border bg-surface-muted text-muted",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export interface BadgeProps
  extends React.ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />;
}
