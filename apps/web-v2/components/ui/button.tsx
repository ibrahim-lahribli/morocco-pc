import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Button geometry and colour, as the design board fixes them: 10px radius,
 * 48px on mobile / 44px on desktop, a primary indigo fill, a soft saffron
 * secondary, an outline and a ghost.
 *
 * `asChild` renders the same geometry on the child element (a link), so a
 * navigation action is an `<a>` rather than a button with a click handler.
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control font-semibold transition-[background-color,border-color,box-shadow,transform] duration-150 active:scale-[0.99] disabled:pointer-events-none disabled:border-transparent disabled:bg-surface-sunken disabled:text-subtle disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-on-primary shadow-level-1 hover:bg-primary-hover",
        secondary:
          "border border-indicative-border bg-accent-soft text-accent-ink hover:bg-indicative-border",
        outline: "border border-outline bg-surface text-foreground hover:bg-surface-muted",
        ghost: "text-primary hover:bg-primary-soft",
        cta: "bg-accent text-on-accent shadow-level-1 hover:bg-accent-strong",
      },
      size: {
        sm: "h-10 px-3 text-label-md",
        md: "h-12 px-4 text-label-lg sm:h-11",
        lg: "h-12 px-5 text-body-lg",
        icon: "size-11",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      data-slot="button"
      // A native button defaults to submit; most buttons in this app are
      // actions, so the safe default is explicit.
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;
