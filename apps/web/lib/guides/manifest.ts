/**
 * lib/guides/manifest.ts — the guides this site publishes, as DATA (S17, S20).
 *
 * Kept separate from `registry.ts` for one concrete reason: the manifest is pure
 * TypeScript, so a spec can import it without pulling an `.mdx` file through a
 * bundler that does not have the MDX loader (Playwright's own transform does
 * not). `registry.ts` adds the compiled bodies and is imported only by the route.
 *
 * Three decisions, and they are the same ones the registry states:
 *
 *   - **the list is committed, not globbed.** A dynamic import with a computed
 *     path makes the build depend on the bundler's path-glob support; a literal
 *     array cannot fail that way, and a missing body is caught at module load.
 *   - **the date is the PROSE's date, and it is PER LOCALE.** `updated` is written
 *     by hand when the text changes, and the page prints it with `formatDate()`.
 *     A build timestamp would claim every guide changed on every deploy, and one
 *     shared date would claim the French text changed the day it was translated.
 *     S20's Arabic bodies are new prose, so their date is the translation's.
 *   - **a locale's copy is the locale's own.** Before S20 the manifest held one
 *     French title and the `ar` routes were 404s; a guide is now `{ fr, ar }` or
 *     it is not a guide, and `registry.ts` fails the build if either body is
 *     missing. That is what makes `pageAlternates()` safe to emit an `ar`
 *     `hreflang` for every guide without a per-page exception list.
 */
import type { AppLocale } from "../i18n/format";

/** The translatable text of one guide, in one locale. */
export interface GuideText {
  /** The page's h1, and the index's link text. */
  title: string;
  /** One sentence for the index and the meta description. */
  description: string;
  /** When THIS locale's prose last changed (ISO 8601 date, see above). */
  updated: string;
}

export interface GuideEntry {
  /** The URL segment, shared by both locales: `/{locale}/guides/{slug}`. */
  slug: string;
  /** The guide's own copy per locale. Both entries are required. */
  copy: Record<AppLocale, GuideText>;
}

export const GUIDE_MANIFEST: readonly GuideEntry[] = [
  {
    slug: "budget-pc-gamer",
    copy: {
      fr: {
        title: "Quel budget pour un PC gamer ?",
        description:
          "Ce que chaque palier de budget change vraiment, ce que les paliers publiés permettent, et ce qu'un prix veut dire ici.",
        updated: "2026-10-21",
      },
      ar: {
        title: "ما الميزانية التي يحتاجها PC للألعاب؟",
        description:
          "ما تغيّره كل مرحلة سعرية فعلاً، وما تتيحه المراحل المنشورة، ومعنى السعر على هذا الموقع.",
        updated: "2026-10-22",
      },
    },
  },
  {
    slug: "choisir-un-gpu",
    copy: {
      fr: {
        title: "Bien choisir une carte graphique",
        description:
          "Les quatre dimensions qui décident vraiment — mémoire vidéo, consommation, encombrement, connecteurs — et celles qui ne décident rien.",
        updated: "2026-10-21",
      },
      ar: {
        title: "كيف تختار بطاقة رسومات؟",
        description:
          "الأبعاد الأربعة التي تحدّد فعلاً — ذاكرة الفيديو، الاستهلاك، الحجم، الموصلات — وتلك التي لا تحدّد شيئًا.",
        updated: "2026-10-22",
      },
    },
  },
];

/** One guide's metadata by slug, or null — a null is the route's 404. */
export function findGuideEntry(slug: string): GuideEntry | null {
  return GUIDE_MANIFEST.find((guide) => guide.slug === slug) ?? null;
}

/** The copy a locale prints for one guide. Every entry carries every locale. */
export function guideText(entry: GuideEntry, locale: AppLocale): GuideText {
  return entry.copy[locale];
}
