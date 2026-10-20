/**
 * The wizard's copy contract (S7).
 *
 * The wizard is a client component, and this app has no `NextIntlClientProvider`
 * (S5: it would ship the whole message catalogue so two links can know the
 * locale). So the SERVER page reads the messages and hands the client one plain,
 * serializable object. That is why this file exists: it is the shape of that
 * hand-off, and it is what stops a sentence a translator needs from being typed
 * into a component.
 *
 * Placeholders are filled at render time by `fill()` — `{current}` / `{total}`
 * for the progress line, `{min}` / `{max}` for the budget bounds. ICU would do
 * this too, but it would mean shipping an ICU runtime to the browser for four
 * placeholders.
 */
import type { WizardStep } from "./model";

export interface StepCopy {
  /** The short name in the step indicator ("Usage", "Budget", …). */
  label: string;
  /** The `<legend>` of the step's control group — the question itself. */
  legend: string;
}

export interface WizardCopy {
  title: string;
  intro: string;
  /** "Étape {current} sur {total}" */
  progress: string;
  next: string;
  back: string;
  /** The last step's primary action. S10 wires the request behind it. */
  finish: string;
  submitNote: string;
  loading: string;
  optionsError: string;
  retry: string;
  budgetLabel: string;
  /** The unit painted inside the field AND announced after the label (S8). */
  budgetSuffix: string;
  /** "{min} to {max}", formatted by the caller. */
  budgetHint: string;
  budgetError: string;
  /** The slider's accessible name — it is the second way to set the one answer. */
  budgetSliderLabel: string;
  /**
   * Shown when the typed amount is not on the slider's grid: "{step}",
   * "{snapped}" and "{exact}", formatted by the caller. Never an error — the
   * typed amount is kept, and saying where the thumb sits is the honest part.
   */
  budgetSnapNote: string;
  /** Guidance after a clamp, naming the bound: "{min}". */
  budgetClampMin: string;
  /** Guidance after a clamp, naming the bound: "{max}". */
  budgetClampMax: string;
  /**
   * Shown with a question whose answer the contract does not say it reads (OD1,
   * CD-1). It is a HINT on the group, not an error: the answer is stored, and saying
   * so is the honest alternative to hiding the question or pretending it matters.
   */
  storedNotApplied: string;
  steps: Record<WizardStep, StepCopy>;
}

/** Replace `{name}` placeholders. Unknown placeholders are left untouched. */
export function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template,
  );
}
