/**
 * ChoiceGroup — the fieldset/legend wrapper `ChoiceCard` cannot be (S7).
 *
 * A radio is a choice; the GROUP is the question. Only a `<fieldset>` with a
 * `<legend>` gives a screen reader that question — a heading or a paragraph
 * above the cards is visible text, not an accessible name, so without this
 * wrapper a user hears "Jeu, radio button, 1 of 3" and never learns what is
 * being chosen. `/fr/kit` and `/fr/tokens` show the pattern by hand; the wizard
 * needs eleven of these, so it is a component.
 *
 * The component is still stateless and still has no `"use client"`: it renders a
 * native radio group, and the caller owns `value` / `onChange`. Arrow-key
 * selection, the roving focus and the "n of m" announcement are the platform's.
 *
 * `options` is deliberately a plain array of `{ value, label }` — exactly the
 * shape `GET /v1/meta/options` returns, so the wizard can map a list straight in
 * and a screen never re-derives labels from enum values (V5).
 */
import { useId } from "react";

import { ChoiceCard } from "./choice-card";
import { cn } from "./cn";

export interface ChoiceGroupOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface ChoiceGroupProps {
  /** Shared radio `name` — one per group, and it must be unique per page. */
  name: string;
  /** The question, as the group's accessible name. */
  legend: string;
  options: readonly ChoiceGroupOption[];
  /** The selected option's value, when the caller controls the group. */
  value?: string;
  onChange: (value: string) => void;
  /** Optional supporting sentence, announced with the group. */
  hint?: string;
  /**
   * Optional error sentence (S10). ERROR BEATS HINT, like `TextField`: while a
   * field is refused, `aria-describedby` points at the fix rather than at two
   * competing sentences. The group's own options stay untouched, so an error
   * never clears a selection.
   */
  error?: string;
  /**
   * Extra classes for the `<legend>` (S28). The wizard passes `sr-only` because
   * its own `<h2>` is the visible question AND the step's focus target: the
   * heading must be the thing read when focus arrives, and painting the same
   * sentence twice on screen would be a duplicate, not a heading. The legend
   * still NAMES the group either way — which is why it is hidden, not removed.
   */
  legendClassName?: string;
}

export function ChoiceGroup({
  name,
  legend,
  options,
  value,
  onChange,
  hint,
  error,
  legendClassName,
}: ChoiceGroupProps) {
  const hintId = useId();
  const errorId = useId();
  const describedBy = error !== undefined ? errorId : hint === undefined ? undefined : hintId;

  return (
    <fieldset aria-describedby={describedBy}>
      <legend className={cn("text-body font-semibold text-ink", legendClassName)}>{legend}</legend>
      {error !== undefined ? (
        <p id={errorId} className="mt-1 text-caption text-error">
          {error}
        </p>
      ) : hint === undefined ? null : (
        <p id={hintId} className="mt-1 text-caption text-muted">
          {hint}
        </p>
      )}
      <div className="mt-3 space-y-2.5">
        {options.map((option) => (
          <ChoiceCard
            key={option.value}
            name={name}
            value={option.value}
            title={option.label}
            description={option.description}
            disabled={option.disabled}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
        ))}
      </div>
    </fieldset>
  );
}
