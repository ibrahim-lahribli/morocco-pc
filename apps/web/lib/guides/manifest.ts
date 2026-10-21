/**
 * lib/guides/manifest.ts — the guides this site publishes, as DATA (S17).
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
 *   - **the date is the PROSE's date.** `updated` is written by hand when the text
 *     changes, and the page prints it with `formatDate()`. A build timestamp would
 *     claim every guide changed on every deploy.
 *   - **French only, deliberately.** S17's DoD asks for the MDX pipeline "with fr
 *     locale"; S20 owns the Arabic pass. An `ar` guide URL is a 404 rather than an
 *     Arabic frame around French prose, and the `ar` index says so in Arabic.
 */
export interface GuideEntry {
  /** The URL segment: `/{locale}/guides/{slug}`. */
  slug: string;
  /** The page's h1, and the index's link text. */
  title: string;
  /** One sentence for the index and the meta description. */
  description: string;
  /** When the PROSE last changed (ISO 8601 date, see above). */
  updated: string;
}

export const GUIDE_MANIFEST: readonly GuideEntry[] = [
  {
    slug: "budget-pc-gamer",
    title: "Quel budget pour un PC gamer ?",
    description:
      "Ce que chaque palier de budget change vraiment, ce que les paliers publiés permettent, et ce qu'un prix veut dire ici.",
    updated: "2026-10-21",
  },
  {
    slug: "choisir-un-gpu",
    title: "Bien choisir une carte graphique",
    description:
      "Les quatre dimensions qui décident vraiment — mémoire vidéo, consommation, encombrement, connecteurs — et celles qui ne décident rien.",
    updated: "2026-10-21",
  },
];

/** One guide's metadata by slug, or null — a null is the route's 404. */
export function findGuideEntry(slug: string): GuideEntry | null {
  return GUIDE_MANIFEST.find((guide) => guide.slug === slug) ?? null;
}
