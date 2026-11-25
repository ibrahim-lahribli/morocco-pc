import { useTranslations } from "next-intl";

/**
 * Step 1 of the configurator — needs definition.
 *
 * Empty by design for this milestone: only the step indicator and the page
 * heading render. The indicator is `aria-hidden` because the heading itself
 * already opens with "Étape 1 —", so a visible indicator would be announced
 * twice. Future questions mount inside this section.
 */
export function StepOnePlaceholder() {
  const t = useTranslations("Configurator.steps.one");

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
