/**
 * The four featured guides, as metadata only.
 *
 * There is no guides endpoint in the contract and no guides content in the
 * repository, so this is a static typed module: slug (for the future route),
 * category key, reading time and a title key. The TITLES live in the dictionary
 * — Arabic is translatable copy, and a literal here would be an untranslatable
 * string in the tree.
 *
 * The frame shows "Tous les guides (14)"; only four exist, so no count is
 * rendered and this module is never extended to match a number in a mockup.
 */

export const GUIDE_CATEGORIES = ["practical", "comparison", "advice", "special"] as const;
export type GuideCategory = (typeof GUIDE_CATEGORIES)[number];

/** Selects `Homepage.guides.items.<key>.title`. */
export const GUIDE_TITLE_KEYS = ["budget", "gpu", "ram", "portable"] as const;
export type GuideTitleKey = (typeof GUIDE_TITLE_KEYS)[number];

export interface GuideEntry {
  /** The address the guide will have once its route exists. */
  slug: string;
  /** Selects `Homepage.guides.categories.<category>`. */
  category: GuideCategory;
  minutes: number;
  /** Selects `Homepage.guides.items.<titleKey>.title`. */
  titleKey: GuideTitleKey;
}

/** Frame order: the mobile variant renders the first two, desktop renders all four. */
export const GUIDES: readonly GuideEntry[] = [
  {
    slug: "quel-budget-pc-gamer-maroc",
    category: "practical",
    minutes: 4,
    titleKey: "budget",
  },
  {
    slug: "choisir-carte-graphique-nvidia-amd",
    category: "comparison",
    minutes: 6,
    titleKey: "gpu",
  },
  {
    slug: "combien-de-ram-16-ou-32-go",
    category: "advice",
    minutes: 3,
    titleKey: "ram",
  },
  {
    slug: "pc-fixe-vs-pc-portable-maroc",
    category: "special",
    minutes: 5,
    titleKey: "portable",
  },
];
