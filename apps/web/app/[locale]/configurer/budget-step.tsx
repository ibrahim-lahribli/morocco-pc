"use client";

/**
 * The budget step (S8) — one answer, two controls.
 *
 * The field is exact and the slider is coarse. They are not two answers, so they
 * cannot be two states: the field keeps the draft the user is typing into, the
 * slider renders the SAME draft snapped onto its 500 MAD grid, and a slider move
 * writes back into both. The URL answer is the typed amount, never the snapped
 * one — typing 7 300 keeps 7 300 — so the note under the slider exists to say so
 * rather than to let the thumb quietly lie.
 *
 * Where each rule comes from:
 *
 *   - CLAMPING happens on blur, and it moves the amount to the nearest bound
 *     while saying which bound (S8 scenario 2/3: guidance, not a silent reset).
 *     While the field has focus nothing is rewritten under the caret: an
 *     in-progress "2" on the way to "20000" must not become 500.
 *   - ENTER still submits, because the step is a `<form>`; an out-of-range
 *     amount is settled first and the submit is refused on that press, so the
 *     guidance appears instead of a jump to the next step.
 *   - The slider reaches the TRUE maximum: `BUDGET_MAX` is on the grid
 *     (500 + 1999 × 500), so End lands on 1 000 000 and not 999 500.
 *
 * `aria-valuetext` on the slider comes from `formatMoney`, so a screen reader
 * hears the amount with its currency rather than a bare number, in either
 * language (V11/V12).
 */
import { useState } from "react";

import { Slider, TextField } from "@/components/ui";
import { formatMoney, formatNumber, type AppLocale } from "@/lib/i18n/format";
import { fill, type WizardCopy } from "@/lib/wizard/copy";
import {
  BUDGET_MAX,
  BUDGET_MIN,
  BUDGET_STEP,
  clampBudget,
  parseAmount,
  snapToStep,
  type BudgetClamp,
} from "@/lib/wizard/model";

export interface BudgetStepProps {
  /** The committed answer, or undefined while the step is unanswered. */
  saved: number | undefined;
  copy: WizardCopy;
  locale: AppLocale;
  onCommit: (value: number | undefined) => void;
}

export function BudgetStep({ saved, copy, locale, onCommit }: BudgetStepProps) {
  // The draft is the only local state: what the user has typed, which may be a
  // half-finished number or out of range. It becomes an answer only through
  // `onCommit`, and only when it is an integer inside the range.
  const [draft, setDraft] = useState(() =>
    saved === undefined ? "" : formatNumber(saved, locale),
  );
  const [touched, setTouched] = useState(false);
  const [clamped, setClamped] = useState<BudgetClamp>(null);

  const parsed = parseAmount(draft);
  const inRange = parsed !== null && parsed >= BUDGET_MIN && parsed <= BUDGET_MAX;
  const thumb = snapToStep(parsed ?? saved ?? BUDGET_MIN);
  const bounds = { min: formatMoney(BUDGET_MIN, locale), max: formatMoney(BUDGET_MAX, locale) };

  const snapNote =
    parsed !== null && inRange && parsed !== thumb
      ? fill(copy.budgetSnapNote, {
          step: formatNumber(BUDGET_STEP, locale),
          snapped: formatMoney(thumb, locale),
          exact: formatMoney(parsed, locale),
        })
      : null;

  const clampNotice =
    clamped === null
      ? null
      : clamped === "min"
        ? fill(copy.budgetClampMin, bounds)
        : fill(copy.budgetClampMax, bounds);

  function commitIfValid(raw: string) {
    const value = parseAmount(raw);
    onCommit(value !== null && value >= BUDGET_MIN && value <= BUDGET_MAX ? value : undefined);
  }

  /**
   * Blur, and Enter on an out-of-range amount: bring the draft into the range and
   * say which bound did it. Returns nothing — the caller only needs the state to
   * be true afterwards, and the form's own submit decides whether to advance.
   */
  function settle() {
    setTouched(true);
    const value = parseAmount(draft);
    if (value === null) {
      onCommit(undefined);
      return;
    }
    const next = clampBudget(value);
    if (next.clamped !== null) {
      setDraft(formatNumber(next.amount, locale));
      setClamped(next.clamped);
    }
    onCommit(next.amount);
  }

  return (
    <fieldset className="mt-6">
      <legend className="text-body font-semibold text-ink">{copy.steps.budget.legend}</legend>

      <div className="mt-3">
        <TextField
          id="wizard-budget"
          label={copy.budgetLabel}
          suffix={copy.budgetSuffix}
          inputMode="numeric"
          autoComplete="off"
          value={draft}
          hint={fill(copy.budgetHint, bounds)}
          error={touched && parsed === null ? fill(copy.budgetError, bounds) : undefined}
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            setClamped(null);
            commitIfValid(raw);
          }}
          onBlur={settle}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            // Enter is the form's, not ours — but a draft outside the range is
            // settled first, so the press explains itself instead of doing
            // nothing at all.
            if (!inRange) settle();
          }}
        />
      </div>

      {clampNotice === null ? null : (
        <p role="status" className="mt-1.5 text-caption text-warning">
          {clampNotice}
        </p>
      )}

      <div className="mt-5">
        <Slider
          id="wizard-budget-slider"
          label={copy.budgetSliderLabel}
          min={BUDGET_MIN}
          max={BUDGET_MAX}
          step={BUDGET_STEP}
          value={thumb}
          aria-describedby={snapNote === null ? undefined : "wizard-budget-snap"}
          format={(value) => formatMoney(value, locale)}
          onChange={(event) => {
            const next = Number(event.target.value);
            setDraft(formatNumber(next, locale));
            setTouched(false);
            setClamped(null);
            onCommit(next);
          }}
        />
      </div>

      {snapNote === null ? null : (
        <p id="wizard-budget-snap" className="mt-2 text-caption text-muted">
          {snapNote}
        </p>
      )}
    </fieldset>
  );
}
