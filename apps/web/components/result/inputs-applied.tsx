import { getTranslations } from "next-intl/server";

import type { AppLocale } from "@/lib/i18n/format";
import type { InputEffectStatus, InputEffectView, InputName } from "@/lib/result/inputs";

/**
 * "Ce que vos choix ont changé" — Decision 52's per-pass facts, on the results
 * page.
 *
 * A server component: the facts are already in the response the page received,
 * so this adds no request, no state and no JavaScript to the client.
 *
 * Three decisions live here.
 *
 * **Silence renders nothing.** `effects === null` means the body came from a
 * server that predates the field (a 1.6 API, a hand-made fixture). Printing
 * "nothing was applied" for a contract that never spoke would be the exact
 * fabricated claim the API work exists to remove — the same rule
 * `lib/wizard/applied.ts` applies to the wizard's caveat.
 *
 * **A reason is mapped, never printed.** The API's codes are a closed list on
 * the writer side, but a client can be older than the server, so an unknown
 * reason falls back to the EFFECT's generic sentence. `GPU_TARGET_SCALED` on
 * screen would be a V5-class failure (the user reading engine vocabulary).
 * *   **The sentences state the mechanism, not a promise.** "a ajusté le budget
 *   visé pour la carte graphique" is what the multiplier did; "votre build serait
 *   meilleur" is not something the persisted rows can support, and the API's
 * contract says so in the same words. The copy is deliberately per REASON, so a
 * `NO_EFFECT` explains WHY it had none instead of leaving the user to guess.
 */
const REASON_KEYS: Record<string, string> = {
  USE_CASE_PROFILE: "reasons.USE_CASE_PROFILE",
  GPU_POLICY_ONLY: "reasons.GPU_POLICY_ONLY",
  VRAM_FLOOR: "reasons.VRAM_FLOOR",
  GPU_TARGET_SCALED: "reasons.GPU_TARGET_SCALED",
  NEUTRAL_MULTIPLIER: "reasons.NEUTRAL_MULTIPLIER",
  NO_GPU_TARGET: "reasons.NO_GPU_TARGET",
  NO_RESOLUTION_POLICY: "reasons.NO_RESOLUTION_POLICY",
  STRATEGY_ORDER: "reasons.STRATEGY_ORDER",
  DEFAULT_ORDER: "reasons.DEFAULT_ORDER",
  NO_BUILDS: "reasons.NO_BUILDS",
  NOT_PROVIDED: "reasons.NOT_PROVIDED",
  NOT_RECORDED: "reasons.NOT_RECORDED",
  UNRECOGNISED_VALUE: "reasons.UNRECOGNISED_VALUE",
};

const EFFECT_KEYS: Record<InputEffectStatus, string> = {
  APPLIED: "effects.applied",
  NO_EFFECT: "effects.noEffect",
  UNKNOWN: "effects.unknown",
};

const INPUT_KEYS: Record<InputName, string> = {
  use_case: "labels.use_case",
  resolution: "labels.resolution",
  priority: "labels.priority",
};

export interface InputsAppliedProps {
  /** Parsed effects, or `null` when the response did not carry the field. */
  effects: InputEffectView[] | null;
  locale: AppLocale;
}

export async function InputsApplied({ effects, locale }: InputsAppliedProps) {
  if (effects === null || effects.length === 0) return null;

  const t = await getTranslations({ locale, namespace: "result.inputs" });

  return (
    <section
      aria-labelledby="inputs-applied-heading"
      className="mt-6 rounded-card border border-border bg-subtle p-4"
    >
      <h2 id="inputs-applied-heading" className="text-subtitle text-ink">
        {t("title")}
      </h2>
      <dl className="mt-3 space-y-2">
        {effects.map((view) => {
          const reasonKey = REASON_KEYS[view.reason];
          return (
            <div key={view.input} data-effect={view.effect} className="text-body leading-relaxed">
              <dt className="inline font-semibold text-ink">{t(INPUT_KEYS[view.input])}</dt>
              <dd className="inline text-muted">
                {" — "}
                {reasonKey === undefined ? t(EFFECT_KEYS[view.effect]) : t(reasonKey)}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
