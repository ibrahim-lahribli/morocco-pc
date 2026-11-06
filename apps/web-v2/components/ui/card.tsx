import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Card surfaces: white by default with a 1px border and an ambient shadow,
 * plus a muted variant for inset panels and an elevated variant for hover or
 * drag states. The 16px radius is the design's card module.
 */
export const cardVariants = cva("rounded-card text-foreground", {
  variants: {
    variant: {
      default: "border border-border bg-surface shadow-level-1",
      muted: "border border-transparent bg-surface-muted",
      elevated: "border border-border bg-surface shadow-level-2",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export interface CardProps extends React.ComponentProps<"div">, VariantProps<typeof cardVariants> {}

export function Card({ className, variant, ...props }: CardProps) {
  return <div data-slot="card" className={cn(cardVariants({ variant }), className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-header" className={cn("flex flex-col gap-1 p-4", className)} {...props} />
  );
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="card-title"
      className={cn("text-headline-sm text-foreground", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-body-md text-muted", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("p-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center border-t border-border p-4", className)}
      {...props}
    />
  );
}
