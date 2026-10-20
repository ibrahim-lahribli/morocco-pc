/**
 * ChoiceCard — board §6, the wizard's option card.
 *
 * A native radio underneath, visually hidden but still in the tab order: arrow
 * keys move between options, the group is announced as "1 sur 3", and keyboard
 * users get the same behaviour as every other radio group on the web. Only the
 * styling is custom.
 *
 * One thing this component CANNOT do for its caller: name the group. That is a
 * `<fieldset>` with a `<legend>` around the cards — the element a screen reader
 * announces before "1 sur 3" — and it belongs to the screen, because only the
 * screen knows what the options are about. `/fr/kit` and `/fr/tokens` show the
 * pattern; without it the wizard's first question is three unlabelled options.
 *
 * The label is a `group` and every styled descendant reads the input's state
 * through `group-has-[:checked|:focus-visible|:disabled]`. `peer-*` would only
 * reach the card, not the dot and the title inside it, because peer variants
 * are sibling selectors.
 *
 * Selection is drawn as a 1 px border plus a 1 px ring rather than the board's
 * literal 2 px border: same 2 px edge, but no 1 px layout shift when a card is
 * selected, which would nudge every card below it. The radio dot is filled only
 * when checked, and the whole card is the label, so the touch target is the
 * full width rather than the 20 px dot.
 *
 * Uncontrolled by default (`defaultChecked`), like the native element it wraps.
 * S7 added the controlled pair (`checked` + `onChange`) because a wizard's
 * answers live in the URL: the screen passes the selected value down and writes
 * the new one back, and the component still holds no state of its own.
 */
import type { ChangeEventHandler, ReactNode } from "react";

import { cn } from "./cn";

export interface ChoiceCardProps {
  name: string;
  value: string;
  title: string;
  description?: string;
  defaultChecked?: boolean;
  /** Controlled selection. Pass with `onChange`; do not mix with `defaultChecked`. */
  checked?: boolean;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  disabled?: boolean;
  /** Renders inside the card, under the description (e.g. a price badge). */
  children?: ReactNode;
}

export function ChoiceCard({
  name,
  value,
  title,
  description,
  defaultChecked,
  checked,
  onChange,
  disabled,
  children,
}: ChoiceCardProps) {
  return (
    <label className="group relative block cursor-pointer has-[:disabled]:cursor-not-allowed">
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="peer sr-only"
      />
      <span
        className={cn(
          "flex min-h-control items-start gap-3 rounded-card border border-border bg-surface p-3.5",
          "transition-colors",
          "group-has-[:checked]:border-primary group-has-[:checked]:bg-primary-soft group-has-[:checked]:ring-1 group-has-[:checked]:ring-primary",
          "group-has-[:focus-visible]:outline-2 group-has-[:focus-visible]:outline-offset-2 group-has-[:focus-visible]:outline-ring",
          "group-has-[:disabled]:border-dashed group-has-[:disabled]:bg-subtle group-has-[:disabled]:opacity-60",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-border",
            "group-has-[:checked]:border-primary group-has-[:checked]:bg-primary",
          )}
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full bg-surface",
              "group-has-[:checked]:opacity-100",
              "opacity-0",
            )}
          />
        </span>

        <span className="space-y-0.5">
          <span
            className={cn(
              "block text-body font-medium leading-tight text-ink",
              "group-has-[:checked]:font-semibold group-has-[:checked]:text-primary",
            )}
          >
            {title}
          </span>
          {description ? (
            <span className="block text-caption leading-normal text-muted">{description}</span>
          ) : null}
          {children}
        </span>
      </span>
    </label>
  );
}
