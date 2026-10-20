/**
 * Slider — board §8's range control, as a native `<input type="range">`.
 *
 * Native on purpose: it already has arrow / Home / End / PageUp keyboard
 * support, a `role="slider"` with `aria-valuemin|max|now`, and touch behaviour
 * that a div-and-drag reimplementation gets wrong on iOS. The only work done
 * here is visual — `app/globals.css` styles the track and thumb with tokens —
 * plus the accessible NAME and VALUE TEXT, which native alone does not supply.
 *
 * `aria-valuetext` is what makes the number mean something: without it a screen
 * reader announces a bare number, with it the amount in the user's currency and
 * separator convention. `format` is injected rather than baked in so the caller
 * — and the Arabic pass (S20) — supplies its own formatter.
 *
 * `onChange` makes the consumer a client component; the component itself holds
 * no state, so an uncontrolled slider (`defaultValue`) still works in a server
 * component.
 */
import type { InputHTMLAttributes } from "react";

import { cn } from "./cn";

export interface SliderProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "id" | "min" | "max"> {
  id: string;
  label: string;
  min: number;
  max: number;
  format: (value: number) => string;
  /** Current value, when the consumer controls the slider. */
  value?: number;
  defaultValue?: number;
}

export function Slider({
  id,
  label,
  min,
  max,
  format,
  value,
  defaultValue,
  className,
  ...rest
}: SliderProps) {
  // A native range with no `value` and no `defaultValue` sits at the MIDPOINT of
  // min/max, not at min — so an uncontrolled slider that falls back to `min` here
  // would announce a value the thumb is not on. Pin the DOM's own default.
  const current = value ?? defaultValue ?? min;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-compact font-medium text-ink">
          {label}
        </label>
        <span className="num-tabular text-compact font-semibold text-ink">
          {format(current)}
        </span>
      </div>

      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        defaultValue={value === undefined ? (defaultValue ?? min) : undefined}
        aria-valuetext={format(current)}
        className={cn("range-input mt-1", className)}
        {...rest}
      />

      <div className="flex justify-between text-caption font-medium text-muted">
        <span className="num-tabular">{format(min)}</span>
        <span className="num-tabular">{format(max)}</span>
      </div>
    </div>
  );
}
