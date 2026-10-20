/**
 * Button — board §4, five states across four variants.
 *
 * Geometry is the board's, verbatim: 48 px tall (`h-control`), 8 px radius,
 * 16 px/500, 16 px inline padding. The secondary and disabled fills each carry
 * a 1 px border, as drawn — the disabled state is not simply 60 % opacity,
 * because a disabled control must still be legible (measured 4.5:1 in
 * `docs/design/TOKEN_MAP.md` §5: `muted` on `track`).
 *
 * `ghost` is the board's "Bouton Lien / Texte": 48 px tall so it keeps a real
 * touch target, but no fill and no border, with an underline on hover.
 *
 * `compact` exists for in-card actions (S11's component rows): 44 px, the
 * accessibility floor rather than the board's 48, and it is only for secondary
 * controls. Primary actions stay 48 px.
 */
import type { ButtonHTMLAttributes } from "react";

import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "whatsapp";
export type ButtonSize = "default" | "compact";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:cursor-not-allowed";

const SIZES: Record<ButtonSize, string> = {
  default: "h-control px-4 text-body",
  compact: "h-tap px-3 text-compact",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-surface active:bg-primary-hover disabled:border disabled:border-border disabled:bg-track disabled:text-muted/70",
  secondary:
    "border border-border bg-surface text-ink active:bg-page disabled:bg-subtle disabled:text-muted/70",
  ghost: "bg-transparent text-primary hover:underline disabled:text-muted/70",
  whatsapp: "bg-whatsapp text-surface active:bg-whatsapp/90",
};

export function Button({
  variant = "primary",
  size = "default",
  type = "button",
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(BASE, SIZES[size], VARIANTS[variant], className)}
      {...rest}
    />
  );
}
