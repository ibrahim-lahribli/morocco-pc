import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";

import { cn } from "@/lib/utils";

/**
 * A complete text field: label + control + optional hint and error, wired with
 * `htmlFor`, `aria-describedby` and `aria-invalid`. `id` is required because
 * the component renders no hooks, so it works in server components too.
 *
 * `leadingIcon` is decorative; the control keeps its own accessible name from
 * the label.
 */
export interface TextFieldProps extends Omit<React.ComponentProps<"input">, "id"> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  leadingIcon?: React.ReactNode;
  containerClassName?: string;
}

export function TextField({
  id,
  label,
  hint,
  error,
  leadingIcon,
  className,
  containerClassName,
  ...props
}: TextFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div data-slot="text-field" className={cn("flex flex-col gap-1.5", containerClassName)}>
      <LabelPrimitive.Root htmlFor={id} className="text-label-lg text-foreground">
        {label}
      </LabelPrimitive.Root>

      <div className="relative">
        {leadingIcon ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-subtle [&_svg]:size-4"
          >
            {leadingIcon}
          </span>
        ) : null}
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "h-12 w-full rounded-field border bg-surface text-body-md text-foreground transition-colors",
            "placeholder:text-subtle focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:outline-none",
            "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted",
            leadingIcon ? "ps-10 pe-3" : "px-3",
            error ? "border-danger" : "border-outline",
            className,
          )}
          {...props}
        />
      </div>

      {hint ? (
        <p id={hintId} className="text-label-md font-normal text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-label-md font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
