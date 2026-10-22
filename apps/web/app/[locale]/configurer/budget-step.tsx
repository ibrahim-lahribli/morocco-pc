"use client";

/**
 * The budget step (S8, S27) — one answer, two controls, one curved rail.
 *
 * The field is exact and the rail is coarse. They are not two answers, so they
 * cannot be two states: the field keeps the draft the user is typing into, the
 * rail renders the SAME draft snapped onto its 500 MAD grid, and a rail move
 * writes back into both. The URL answer is the typed amount, never the snapped
 * one — typing 7 300 keeps 7 300 — so the note under the rail exists to say so
 * rather than to let the thumb quietly lie.
 *
 * S27 changed what the rail's VALUE is. A native `<input type="range">` lays its
 * thumb out linearly in its own value, so a rail over 500..1 000 000 put a 7 000 budget
 * at 0.7 % of a 360 px track — every realistic budget inside the first
 * thumb-width. The rail therefore speaks POSITIONS (0..`BUDGET_SLIDER_POSITIONS`)
 * and `budgetAtPosition` maps a position to a 500 MAD amount on an exponential
 * curve, which gives the low end the room it needs: a 7 000 budget is now about a third
 * of the track. `format` is passed position → money, so the header, the
 * `aria-valuetext` and the min/max labels all announce AMOUNTS; only the native
 * `aria-valuenow|min|max` stay in positions, which is the documented trade-off of
 * curving a native control rather than replacing it with a div.
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
 *   - KEYS move in AMOUNTS, not positions (S27): an arrow is 500 DH, PageUp /
 *     PageDown move ten arrows, Home and End are the bounds. The rail's own
 *     positions are uneven, so the browser's "+1 position" would mean about 2 at the
 *     bottom and 8 000 at the top; `budgetForSliderKey` states the rule
 *     instead, and mirrors only the horizontal arrows in an RTL page so
 *     ArrowRight moves the thumb the way it points.
 *   - The rail reaches the TRUE maximum: `BUDGET_MAX` is on the grid
 *     (500 + 1999 × 500), so End lands on 1 000 000 and not 999 500.
 *
 * `aria-valuetext` on the rail comes from `formatMoney`, so a screen reader hears
 * the amount with its currency rather than a bare number, in either language
 * (V11/V12).
 */
import { useState } from "react";

import { Alert, Slider, TextField } from "@/components/ui";
import { formatMoney, formatNumber, type AppLocale } from "@/lib/i18n/format";
import { fill, type WizardCopy } from "@/lib/wizard/copy";
import {
  BUDGET_MAX,
  BUDGET_MIN,
  BUDGET_SLIDER_POSITIONS,
  BUDGET_STEP,
  budgetAtPosition,
  budgetForSliderKey,
  clampBudget,
  parseAmount,
  positionForBudget,
  snapToStep,
  type BudgetClamp,
} from "@/lib/wizard/model";

export interface BudgetStepProps {
  /** The committed answer, or undefined while the step is unanswered. */
  saved: number | undefined;
  copy: WizardCopy;
  locale: AppLocale;
  onCommit: (value: number | undefined) => void;
  /** A sentence the service sent back about this field (S10's 422). */
  serverError?: string;
}

export function BudgetStep({ saved, copy, locale, onCommit, serverError }: BudgetStepProps) {
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
  // The rail has no position for 7 300, so the thumb is the SNAPPED amount's
  // position — and `thumbAmount` is the amount the thumb is actually on, which is
  // what the note below has to name (S27: above the curve's crossover that is a
  // neighbour of the snapped figure, never a number the thumb is not on).
  const thumb = positionForBudget(snapToStep(parsed ?? saved ?? BUDGET_MIN));
  const thumbAmount = budgetAtPosition(thumb);
  const bounds = { min: formatMoney(BUDGET_MIN, locale), max: formatMoney(BUDGET_MAX, locale) };

  const snapNote =
    parsed !== null && inRange && parsed !== thumbAmount
      ? fill(copy.budgetSnapNote, {
          step: formatNumber(BUDGET_STEP, locale),
          snapped: formatMoney(thumbAmount, locale),
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

  /** A rail move and a key press are the same event: an amount, already chosen. */
  function choose(amount: number) {
    setDraft(formatNumber(amount, locale));
    setTouched(false);
    setClamped(null);
    onCommit(amount);
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
          // The service's refusal wins over the local message: it is the newer
          // fact, and `TextField` shows one sentence rather than two.
          error={
            serverError ??
            (touched && parsed === null ? fill(copy.budgetError, bounds) : undefined)
          }
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
        // S22 unified this: a clamp is the result of an ACTION (the reader left
        // the field outside the range), so it is announced, and it is drawn by
        // the same `Alert` primitive every other state in the app uses — the last
        // notice that had grown its own markup. `role="status"` is explicit
        // because a warning is not a live region by default (alert.tsx).
        <Alert tone="warning" role="status" className="mt-2">
          {clampNotice}
        </Alert>
      )}

      <div className="mt-5">
        <Slider
          id="wizard-budget-slider"
          label={copy.budgetSliderLabel}
          // POSITIONS, not amounts (S27): the thumb's geometry is linear in what
          // the browser is given, and the curve lives in the mapping.
          min={0}
          max={BUDGET_SLIDER_POSITIONS}
          step={1}
          value={thumb}
          aria-describedby={snapNote === null ? undefined : "wizard-budget-snap"}
          format={(position) => formatMoney(budgetAtPosition(position), locale)}
          onChange={(event) => choose(budgetAtPosition(Number(event.target.value)))}
          onKeyDown={(event) => {
            // The direction comes from the rendered element, not from the locale
            // list: if a direction is ever changed in CSS, the keys follow it.
            const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
            const next = budgetForSliderKey(event.key, thumbAmount, rtl);
            if (next === null) return;
            // Only the keys the rail owns are taken; Tab, Enter and everything
            // else still belong to the page.
            event.preventDefault();
            choose(next);
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
