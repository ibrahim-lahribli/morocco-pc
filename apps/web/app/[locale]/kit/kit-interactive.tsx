"use client";

import { useId, useState } from "react";

import { ProgressBar, Slider, TextField } from "@/components/ui";
import { formatMoney, formatNumber, formatPercent } from "@/lib/i18n/format";

/**
 * The one stateful block on the story route: board §8's field ↔ slider sync,
 * plus a budget bar that follows both.
 *
 * The state lives here, not in the components, which is the kit's contract:
 * Slider and TextField are controlled or uncontrolled, never stateful. `600`
 * step is a clamping decision — the board allows 3 000 to 40 000 in 500 steps,
 * and typing is clamped on blur rather than on every keystroke, so a user who
 * types "4" on the way to "4000" is not yanked back to 3 000.
 */

const MIN = 3000;
const MAX = 40000;
const STEP = 500;

const formatMad = (value: number): string => formatMoney(value, "fr");

function clamp(value: number): number {
  if (!Number.isFinite(value)) return MIN;
  return Math.min(MAX, Math.max(MIN, value));
}

/**
 * Snap to the board's 500 MAD step. Clamping alone left the two controls
 * disagreeing: `<input type="range">` snaps its own DOM value to the nearest
 * step (4 123 → 4 000) while the slider's `aria-valuetext` kept announcing the
 * typed 4 123, i.e. it described a thumb position it was not on. Snapping where
 * free text is accepted keeps both controls on one number.
 */
function snap(value: number): number {
  return clamp(MIN + Math.round((value - MIN) / STEP) * STEP);
}

export function KitInteractive() {
  const [budget, setBudget] = useState(8500);
  const [draft, setDraft] = useState(formatNumber(8500, "fr"));
  const fieldId = useId();
  const sliderId = useId();

  const engaged = 7900;
  const ratio = (engaged / budget) * 100;
  const tone = ratio > 100 ? "over" : ratio >= 95 ? "warning" : "normal";
  const detail =
    ratio > 100
      ? `Dépasse de ${formatMad(engaged - budget)}`
      : `Reste ${formatMad(budget - engaged)}`;

  function commitDraft(): void {
    const digits = draft.replace(/[^\d]/g, "");
    const next = snap(Number(digits));
    setBudget(next);
    setDraft(formatNumber(next, "fr"));
  }

  return (
    <div className="space-y-5 rounded-card border border-border bg-surface p-3.5">
      <TextField
        id={fieldId}
        label="Votre enveloppe cible"
        suffix="MAD"
        inputMode="numeric"
        value={draft}
        hint={`De ${formatMad(MIN)} à ${formatMad(MAX)}, par paliers de ${STEP} MAD.`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitDraft();
        }}
      />

      <Slider
        id={sliderId}
        label="Ajuster"
        min={MIN}
        max={MAX}
        step={STEP}
        value={budget}
        format={formatMad}
        onChange={(event) => {
          const next = Number(event.target.value);
          setBudget(next);
          setDraft(formatNumber(next, "fr"));
        }}
      />

      <ProgressBar
        label={`Budget engagé (${formatMad(engaged)})`}
        value={engaged}
        max={budget}
        tone={tone}
        valueText={formatPercent(engaged / budget, "fr")}
        detail={detail}
        caption={`${formatMad(budget)} disponibles · paliers de ${STEP} MAD`}
      />
    </div>
  );
}
