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
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

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

export interface LinkButtonProps {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /**
   * Render a plain `<a>` instead of `next/link`, so following it re-runs the
   * SERVER render (S11's retry). A `Link` to the URL already in the address bar
   * is a router no-op: it would leave an error state on screen while looking
   * like a retry. Use it only where a document navigation is the point.
   */
  reload?: boolean;
  children: ReactNode;
}

/**
 * The classes for one (variant, size) pair, exported so a composition may put
 * the button's geometry on an element button.tsx does not own — an external
 * anchor with a target attribute, for instance (S15's WhatsApp link). The two
 * components call it, so two owners of the styles stay one owner.
 */
export function buttonClasses(variant: ButtonVariant, size: ButtonSize = "default"): string {
  return cn(BASE, SIZES[size], VARIANTS[variant]);
}

/**
 * LinkButton — the same geometry and variants, on an `<a>` (S7).
 *
 * A link that navigates must BE a link: a `<button onClick={router.push}>` loses
 * open-in-new-tab, the context menu, and the status-bar preview, and it lies to
 * a screen reader about what will happen. So the wizard's entry point on the
 * home page is a `next/link` that borrows the button's classes instead of the
 * button itself — one owner of the styles, two elements.
 *
 * `disabled` has no meaning here and is therefore not in the props: a link that
 * cannot be followed should not be rendered as one.
 */

export function LinkButton({
  href,
  variant = "primary",
  size = "default",
  className,
  reload = false,
  children,
}: LinkButtonProps) {
  const classes = cn(buttonClasses(variant, size), className);
  if (reload) {
    return (
      <a href={href} className={classes}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}

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
      className={cn(buttonClasses(variant, size), className)}
      {...rest}
    />
  );
}
