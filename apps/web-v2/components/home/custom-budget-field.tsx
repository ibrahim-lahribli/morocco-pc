"use client";

import { useTranslations } from "next-intl";

import { TextField } from "@/components/ui/text-field";
import { groupNumber } from "@/lib/format/price";
import { BUDGET_MAX, BUDGET_MIN, BUDGET_STEP } from "@/lib/homepage/finder-schema";

/**
 * The custom budget: a numeric field on every width, plus the desktop frame's
 * range control from `lg`. The finder mounts it only once the visitor reveals
 * it with `finder.budget.customToggle`, so a first visit never shows it.
 *
 * Both share one value and only the raw text is held — parsing and range checks
 * live in `finder-schema.ts`, so a half-typed amount is a string here rather
 * than an error state. The range input is a mouse convenience that mirrors the
 * labelled field (`aria-hidden`, not tabbable): two controls with the same
 * accessible name would make the labelled one ambiguous to assistive tech.
 *
 * The message is rendered here rather than through `TextField`'s `error` prop so
 * it can carry `role="alert"`, while the input still gets `aria-invalid` and
 * `aria-describedby` pointing at it. One message, announced once, on screen once.
 */
export interface CustomBudgetFieldProps {
  /** The field's DOM id, also the prefix of its hint and error ids. */
  id: string;
  /** The raw text, exactly as typed. */
  value: string;
  /** The dictionary's range message, when the amount is invalid. */
  error?: string;
  onChange: (raw: string) => void;
}

export function CustomBudgetField({ id, value, error, onChange }: CustomBudgetFieldProps) {
  const t = useTranslations("Homepage.finder.budget");
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? `${hintId} ${errorId}` : hintId;

  return (
    <div className="flex flex-col gap-2">
      <TextField
        id={id}
        label={t("customLabel")}
        hint={t("customHint", { min: groupNumber(BUDGET_MIN), max: groupNumber(BUDGET_MAX) })}
        type="number"
        inputMode="numeric"
        min={BUDGET_MIN}
        max={BUDGET_MAX}
        step={BUDGET_STEP}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />

      {error ? (
        <p id={errorId} role="alert" className="text-label-md font-medium text-danger">
          {error}
        </p>
      ) : null}

      <input
        type="range"
        aria-hidden="true"
        tabIndex={-1}
        min={BUDGET_MIN}
        max={BUDGET_MAX}
        step={BUDGET_STEP}
        value={Number(value) || BUDGET_MIN}
        onChange={(event) => onChange(event.target.value)}
        className="hidden h-11 w-full accent-primary lg:block"
      />
    </div>
  );
}
