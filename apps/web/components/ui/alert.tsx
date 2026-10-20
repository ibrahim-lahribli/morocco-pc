/**
 * Alert — board §16, three banners.
 *
 * 12 px copy on a soft fill with a 20 % border, 20 px icon, 12 px padding, 8 px
 * radius. The tones map to the semantic pairs (`info-soft`/`info`,
 * `warning-soft`/`warning`, `error-soft`/`error`); the icon is `aria-hidden`
 * because the sentence already says what happened.
 *
 * Roles are a decision, not a default. `error` is `role="alert"` — it interrupts,
 * because the user's next click may be wrong. `info` and `warning` are NOT live
 * regions: they are usually present on load, and a `role="status"` there makes a
 * screen reader announce a static sentence as if it had just appeared. When one
 * of them IS the result of an action, pass `role="status"` explicitly and mount
 * it then — the message, not the colour, is what tells the user what to do.
 */
import type { ReactNode } from "react";

import { cn } from "./cn";
import { ErrorCircleIcon, InfoCircleIcon, WarningTriangleIcon } from "./icons";

export type AlertTone = "info" | "warning" | "error";

export interface AlertProps {
  tone: AlertTone;
  children: ReactNode;
  /** Override the tone's default live-region role. */
  role?: "alert" | "status";
  className?: string;
}

const TONES: Record<AlertTone, { box: string; icon: string }> = {
  info: { box: "border-info/20 bg-info-soft", icon: "text-info" },
  warning: { box: "border-warning/20 bg-warning-soft", icon: "text-warning" },
  error: { box: "border-error/20 bg-error-soft", icon: "text-error" },
};

export function Alert({ tone, children, role, className }: AlertProps) {
  const style = TONES[tone];
  const Icon =
    tone === "error" ? ErrorCircleIcon : tone === "warning" ? WarningTriangleIcon : InfoCircleIcon;

  return (
    <div
      data-tone={tone}
      role={role ?? (tone === "error" ? "alert" : undefined)}
      className={cn(
        "flex items-start gap-2.5 rounded-control border p-3 text-caption text-ink",
        style.box,
        className,
      )}
    >
      <Icon className={cn("mt-0.5", style.icon)} />
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}
