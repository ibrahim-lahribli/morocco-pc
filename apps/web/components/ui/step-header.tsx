/**
 * StepHeader — the progress line, the step list and the question, as one unit.
 *
 * Extracted from the wizard, where these three pieces were rendered inline and
 * had to agree about a length that is derived rather than fixed (`stepsFor()`
 * narrows the flow per profile). Keeping them together is what stops the
 * indicator saying "Étape 2 sur 4" above a list of three.
 *
 * The heading is the FOCUS TARGET: a step change used to leave focus on `<body>`,
 * so a keyboard user restarted at the skip link before reaching the new question
 * (UI audit F3, 2026-10-25). `titleRef` and `tabIndex={-1}` therefore live here,
 * not at each call site. The heading is the QUESTION, not the step's short name,
 * because that is what someone navigating by headings wants to land on.
 *
 * No copy lives in this file: `progressLabel` arrives already formatted
 * ("Étape 2 sur 4" / "الخطوة ٢ من ٤"), because the number must go through
 * `lib/i18n/format.ts` in the caller's locale.
 */
import type { Ref } from "react";

import { cn } from "./cn";

export interface StepHeaderStep {
  /** Stable key, used for React and never rendered. */
  key: string;
  /** The step's short visible name. */
  label: string;
}

export interface StepHeaderProps {
  /** 1-based position of the current step; marks the list with `aria-current`. */
  current: number;
  /** The profile's actual flow length. Defaults to `steps.length`. */
  total?: number;
  steps: readonly StepHeaderStep[];
  /** The question: the heading, and where focus goes after a step change. */
  title: string;
  /** Pre-formatted progress sentence. */
  progressLabel: string;
  titleRef?: Ref<HTMLHeadingElement>;
  className?: string;
}

export function StepHeader({
  current,
  total,
  steps,
  title,
  progressLabel,
  titleRef,
  className,
}: StepHeaderProps) {
  const length = total ?? steps.length;

  return (
    <div className={cn("mt-6", className)}>
      <p className="font-mono text-caption uppercase tracking-wider text-primary">
        {progressLabel}
      </p>

      <ol className="mt-3 flex flex-wrap gap-x-1.5 gap-y-1 text-caption text-muted">
        {steps.map((step, index) => (
          <li
            key={step.key}
            aria-current={index + 1 === current ? "step" : undefined}
            className={index + 1 === current ? "font-semibold text-ink" : undefined}
          >
            {step.label}
            {index < length - 1 ? <span aria-hidden="true"> ·</span> : null}
          </li>
        ))}
      </ol>

      <h2 ref={titleRef} tabIndex={-1} className="mt-4 w-fit text-heading text-ink">
        {title}
      </h2>
    </div>
  );
}
