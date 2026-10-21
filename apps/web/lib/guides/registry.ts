/**
 * lib/guides/registry.ts — the manifest plus each guide's compiled MDX body (S17).
 *
 * This is the only module that imports `content/guides/*.mdx`, which is why the
 * metadata lives in `manifest.ts` instead: a spec can read the slugs and titles
 * without dragging an MDX file through Playwright's TypeScript transform.
 *
 * The join is explicit and checked. A manifest entry with no body is a build-time
 * mistake, not a runtime possibility, so it fails HERE with the slug in the
 * message rather than rendering an empty `<article>`.
 *
 * The body's `components` map is passed by the route (`GUIDE_MDX_COMPONENTS` from
 * `components/guides/mdx-components.tsx`) — MDX imported into a page does not
 * inherit the file-based convention, so the styling is explicit at the one call
 * site that renders prose.
 */
import type { MDXComponents } from "mdx/types";
import type { ComponentType } from "react";

import BudgetGuide from "../../content/guides/budget-pc-gamer.mdx";
import GpuGuide from "../../content/guides/choisir-un-gpu.mdx";

import { GUIDE_MANIFEST, findGuideEntry, type GuideEntry } from "./manifest";

export type { GuideEntry };
export { findGuideEntry };

type GuideBody = ComponentType<{ components?: MDXComponents }>;

/** Slug -> compiled body. Every manifest entry must appear here. */
const BODIES: Record<string, GuideBody> = {
  "budget-pc-gamer": BudgetGuide,
  "choisir-un-gpu": GpuGuide,
};

export interface Guide extends GuideEntry {
  Body: GuideBody;
}

export const GUIDES: readonly Guide[] = GUIDE_MANIFEST.map((entry) => {
  const Body = BODIES[entry.slug];
  if (Body === undefined) {
    throw new Error(`guide "${entry.slug}" is in the manifest but has no MDX body`);
  }
  return { ...entry, Body };
});

/** One guide (metadata AND body) by slug, or null. */
export function findGuide(slug: string): Guide | null {
  const entry = findGuideEntry(slug);
  if (entry === null) return null;
  return GUIDES.find((guide) => guide.slug === entry.slug) ?? null;
}
