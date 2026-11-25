import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { GUIDES, TOTAL_GUIDE_COUNT } from "@/lib/homepage/guides";

import { GuideCard } from "./guide-card";
import { SectionHeading } from "./section-heading";

/**
 * The four featured guides.
 *
 * One data array drives both frames: the first two cards are the mobile set and
 * the last two are `max-lg:hidden`, so nothing is duplicated in the markup.
 * Titles live in the dictionary, keyed by `titleKey`; the module holds no copy.
 *
 * The "all guides" link sits below the cards per the frame, count included; it
 * is `aria-disabled` text until guide routes exist.
 */
export async function FeaturedGuides() {
  const t = await getTranslations("Homepage.guides");

  if (GUIDES.length === 0) {
    return null;
  }

  return (
    <section id="guides" aria-labelledby="guides-title" className="scroll-mt-24">
      <SectionHeading
        id="guides-title"
        eyebrow={t("eyebrow")}
        title={t("title")}
        intro={t("intro")}
      />

      <ul className="mt-5 grid gap-3 md:grid-cols-2 lg:mt-8">
        {GUIDES.map((guide, index) => (
          <li key={guide.slug} className={index > 1 ? "max-lg:hidden" : undefined}>
            <GuideCard
              minutes={t("readingTime", { minutes: guide.minutes })}
              title={t(`items.${guide.titleKey}.title`)}
            />
          </li>
        ))}
      </ul>

      <p className="mt-5 text-start lg:text-center">
        <span
          aria-disabled="true"
          className="inline-flex items-center gap-1.5 text-label-lg text-primary"
        >
          {t("allCount", { count: TOTAL_GUIDE_COUNT })}
          <ArrowRight aria-hidden="true" className="size-4 rtl:-scale-x-100" />
        </span>
      </p>
    </section>
  );
}
