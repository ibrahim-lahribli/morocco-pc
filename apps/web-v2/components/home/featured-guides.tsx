import { getTranslations } from "next-intl/server";

import { GUIDES } from "@/lib/homepage/guides";

import { GuideCard } from "./guide-card";

/**
 * The four featured guides.
 *
 * One data array drives both frames: the first two cards are the mobile set and
 * the last two are `max-lg:hidden`, so nothing is duplicated in the markup.
 * Titles live in the dictionary, keyed by `titleKey`; the module holds no copy.
 *
 * The "all guides" link is `aria-disabled` text until guide routes exist, and
 * no count is rendered because only four guides are authored.
 */
export async function FeaturedGuides() {
  const t = await getTranslations("Homepage.guides");

  if (GUIDES.length === 0) {
    return null;
  }

  return (
    <section id="guides" aria-labelledby="guides-title" className="scroll-mt-24">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="hidden text-label-md font-semibold tracking-wide text-primary uppercase md:block">
            {t("eyebrow")}
          </p>
          <h2
            id="guides-title"
            className="mt-1 text-headline-md text-balance text-foreground lg:text-headline-lg"
          >
            {t("title")}
          </h2>
          <p className="mt-1.5 hidden max-w-prose text-body-md text-muted md:block">{t("intro")}</p>
        </div>
        <p className="text-start lg:text-end">
          <span aria-disabled="true" className="text-label-lg text-primary">
            {t("all")}
          </span>
        </p>
      </div>

      <ul className="mt-5 grid gap-4 md:grid-cols-2 lg:mt-8 lg:grid-cols-4">
        {GUIDES.map((guide, index) => (
          <li key={guide.slug} className={index > 1 ? "max-lg:hidden" : undefined}>
            <GuideCard
              category={t(`categories.${guide.category}`)}
              minutes={t("readingTime", { minutes: guide.minutes })}
              title={t(`items.${guide.titleKey}.title`)}
              cta={t("cta")}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
