/**
 * ChoicePills — a compact single-select row, as native radios.
 *
 * The design's home screen asks two questions above the fold (budget and usage)
 * and cannot afford a full card per option: `ChoiceCard` is the wizard's form
 * with a description per choice, this is the same decision in one line. Both are
 * a real `<input type="radio">`, so arrow keys, the roving focus and the "n of m"
 * announcement are the platform's rather than re-implemented.
 *
 * The pill is the `<label>`'s styled span, so the touch target is the whole pill
 * (44 px tall, `h-tap`) rather than the hidden dot. Selection is drawn as fill
 * plus text colour, and the focus ring is drawn on the pill because the input is
 * `sr-only` — a ring on a hidden element is not a focus indicator.
 *
 * No copy: `legend` names the group and `options` carry their own labels.
 */
import { cn } from "./cn";

export interface ChoicePillOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ChoicePillsProps {
  /** Shared radio name, unique per page. */
  name: string;
  /** The question, as the group's accessible name. */
  legend: string;
  /** Hide the legend visually, keeping it as the group's name (wizard pattern). */
  legendClassName?: string;
  options: readonly ChoicePillOption[];
  /** Selected value, when the caller controls the group. */
  value?: string;
  onChange: (value: string) => void;
  className?: string;
}

export function ChoicePills({
  name,
  legend,
  legendClassName,
  options,
  value,
  onChange,
  className,
}: ChoicePillsProps) {
  return (
    <fieldset className={className}>
      <legend className={cn("text-caption font-semibold text-ink", legendClassName)}>
        {legend}
      </legend>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.value} className="group relative inline-flex cursor-pointer has-[:disabled]:cursor-not-allowed">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "inline-flex h-tap items-center justify-center rounded-control border px-3.5",
                "text-compact font-medium transition-colors",
                "border-border bg-surface text-ink",
                "group-has-[:checked]:border-primary group-has-[:checked]:bg-primary group-has-[:checked]:text-surface",
                "group-has-[:focus-visible]:outline-2 group-has-[:focus-visible]:outline-offset-2 group-has-[:focus-visible]:outline-ring",
                "group-has-[:disabled]:border-dashed group-has-[:disabled]:bg-subtle group-has-[:disabled]:text-muted",
              )}
            >
              <span className="num-tabular">{option.label}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
