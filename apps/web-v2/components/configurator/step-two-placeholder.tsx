import { useTranslations } from "next-intl";

/**
 * Step 2 of the configurator — configuration refinement.
 *
 * Empty by design for this milestone: only the step indicator and the page
 * heading render. Reaching this step requires a complete handoff
 * (`use_case` + `budget` on the URL); the route falls back to Step 1
 * otherwise. The indicator is `aria-hidden` because the heading itself
 * already opens with "Étape 2 —". Future questions mount inside this section.
 */
export function StepTwoPlaceholder() {
  const t = useTranslations("Configurator.steps.two");

  return (
    <section className="flex max-w-3xl flex-col gap-3 pt-2">
      <p
        aria-hidden="true"
        className="w-fit rounded-pill bg-primary-soft px-3 py-1 text-label-md font-semibold text-primary"
      >
        {t("indicator")}
      </p>
      <h1 className="text-display text-balance text-foreground lg:text-display-lg">{t("title")}</h1>
    </section>
  );
}
