/**
 * TextField — board §8's budget field, generalised.
 *
 * The board's field is 48 px tall, 8 px radius, `page` fill, 16 px bold tabular
 * figures, with the unit inside the field at 14 px/600 (`MAD`). The suffix is
 * `aria-hidden` and `pointer-events-none`: it is a visual unit, and a screen
 * reader gets the same fact from the label ("Votre enveloppe cible (MAD)") —
 * duplicated, it reads as the unit twice.
 *
 * Error beats hint: while `error` is set, the hint is not rendered at all, so
 * `aria-describedby` never points at two competing sentences. The input keeps
 * its value in both states; an error must not clear what the user typed.
 */
import type { InputHTMLAttributes } from "react";

import { cn } from "./cn";

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "size"> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  suffix?: string;
}

export function TextField({
  id,
  label,
  hint,
  error,
  suffix,
  className,
  ...rest
}: TextFieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div>
      <label
        htmlFor={id}
        className="block text-caption font-semibold uppercase tracking-wider text-muted"
      >
        {label}
      </label>

      <div className="relative mt-1.5 flex items-center">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "num-tabular h-control w-full rounded-control border bg-page px-3.5 text-body font-bold text-ink",
            "placeholder:font-normal placeholder:text-placeholder",
            suffix ? "pe-14" : undefined,
            error ? "border-error" : "border-border",
            className,
          )}
          {...rest}
        />
        {suffix ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute end-3.5 text-compact font-semibold text-muted"
          >
            {suffix}
          </span>
        ) : null}
      </div>

      {error ? (
        <p id={errorId} className="mt-1.5 text-caption text-error">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-caption text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
