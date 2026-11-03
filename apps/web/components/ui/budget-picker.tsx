/**
 * BudgetPicker — the home screen's quick budget question, in one line.
 *
 * NOT a second budget control for the wizard. The wizard's exact entry is
 * `BudgetStep` (field + curved rail + clamp guidance); this is the "pick a number
 * and go" affordance the design puts above the fold, and the two promise
 * different things: `BudgetStep` accepts ANY integer in range, this offers a
 * short list. Duplicating the rail here would give the app two owners of one
 * rule, which is the failure `BudgetStep`'s own header warns about.
 *
 * Every preset goes through `snapToStep`, so a preset that is off the 500 grid or
 * outside the client-owned bounds (500…1 000 000, `lib/wizard/model.ts`) is
 * corrected rather than rendered as a wrong number — the clamping rule stays in
 * the model and is not restated here.
 *
 * `format` is injected, exactly like `Slider`'s: the unit and the grouping
 * separator are `lib/i18n/format.ts`'s business (a French grouped amount with its unit, versus the Arabic form),
 * and a primitive that formats its own numbers is how a locale bug gets in.
 */
import { snapToStep } from "@/lib/wizard/model";

import { ChoicePills } from "./choice-pills";

export interface BudgetPickerProps {
  /** Shared radio name, unique per page. */
  name: string;
  /** The question, e.g. "Votre budget". */
  label: string;
  legendClassName?: string;
  /** Preset amounts in MAD; snapped into range before rendering. */
  presets: readonly number[];
  value?: number;
  onChange: (amount: number) => void;
  /** Formats a preset for display — pass `formatNumber`/`formatMoney`. */
  format: (amount: number) => string;
  /** Supporting sentence under the row. */
  hint?: string;
  className?: string;
}

export function BudgetPicker({
  name,
  label,
  legendClassName,
  presets,
  value,
  onChange,
  format,
  hint,
  className,
}: BudgetPickerProps) {
  // Snap + de-duplicate: two presets collapsing onto one grid amount would render
  // as two radios with the same value, and the group would highlight both.
  const amounts = [...new Set(presets.map((amount) => snapToStep(amount)))];

  return (
    <div className={className}>
      <ChoicePills
        name={name}
        legend={label}
        legendClassName={legendClassName}
        options={amounts.map((amount) => ({
          value: String(amount),
          label: format(amount),
        }))}
        value={value === undefined ? undefined : String(snapToStep(value))}
        onChange={(next) => onChange(Number(next))}
      />
      {hint === undefined ? null : <p className="mt-1.5 text-caption text-muted">{hint}</p>}
    </div>
  );
}
