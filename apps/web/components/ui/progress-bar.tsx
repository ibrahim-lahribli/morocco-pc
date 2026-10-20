/**
 * ProgressBar — board §10, the budget bar.
 *
 * Three tones, and the tone is a SEMANTIC decision the caller makes from the
 * data (`normal` under budget, `warning` near it, `over` past it), never a
 * colour name. The `warning` token is the dark amber, NOT the board's saffron:
 * saffron measures 1.71:1 against the rail and a graphical object needs 3:1, so
 * the board's own value would have shipped an almost-invisible bar. The reason
 * and the tested alternatives are in `docs/design/TOKEN_MAP.md` §6.
 *
 * Out-of-range values are a two-part problem, and the review that added this
 * comment found the first part measured rather than assumed: ARIA requires
 * `aria-valuenow` to sit inside `[valuemin, valuemax]`, and a browser CLAMPS a
 * value past the maximum in the accessibility tree — 104 % of 10 000 was
 * announced as 10 000, not 10 400. So the number is clamped (keeping the
 * attribute legal) and the TRUTH travels in `aria-valuetext`, which assistive
 * technology reads instead of the raw number; the fill width is clamped too, so
 * CSS never paints outside the rail. `label` becomes the accessible name, so
 * the bar is never "progress bar, 99 %" with no subject.
 */
import { cn } from "./cn";

export type ProgressTone = "normal" | "warning" | "over";

export interface ProgressBarProps {
  label: string;
  value: number;
  max?: number;
  tone?: ProgressTone;
  /** Right-aligned amount, e.g. the remaining budget — format it with `formatMoney`. */
  detail?: string;
  /** Small print under the bar, e.g. the engaged total — also `formatMoney` output. */
  caption?: string;
  /**
   * What a screen reader reads instead of the raw number. Pass a localized
   * string (`formatPercent`) once the screen knows its locale; the default is the
   * percentage as the bar computes it.
   */
  valueText?: string;
}

const FILL: Record<ProgressTone, string> = {
  normal: "bg-primary",
  warning: "bg-warning",
  over: "bg-error",
};

const DETAIL: Record<ProgressTone, string> = {
  normal: "text-success",
  warning: "text-warning",
  over: "text-error",
};

export function ProgressBar({
  label,
  value,
  max = 100,
  tone = "normal",
  detail,
  caption,
  valueText,
}: ProgressBarProps) {
  const ratio = max > 0 ? (value / max) * 100 : 0;
  const width = Math.max(0, Math.min(100, ratio));
  // The attribute must stay legal (see the header comment); the truth is in
  // `aria-valuetext`.
  const now = Math.max(0, Math.min(max, value));
  const readOut = valueText ?? `${Math.round(ratio)} %`;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-caption">
        <span className="font-medium text-ink">{label}</span>
        {detail ? (
          <span className={cn("num-tabular font-semibold", DETAIL[tone])}>{detail}</span>
        ) : null}
      </div>

      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={now}
        aria-valuetext={readOut}
        className="mt-1.5 h-2.5 w-full overflow-hidden rounded-pill bg-track"
      >
        <div
          className={cn("h-full rounded-pill transition-[width]", FILL[tone])}
          style={{ width: `${width}%` }}
        />
      </div>

      {caption ? (
        <p className="mt-1 text-micro text-muted num-tabular">{caption}</p>
      ) : null}
    </div>
  );
}
