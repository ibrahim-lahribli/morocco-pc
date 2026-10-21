/**
 * components/guides/mdx-components.tsx — the guide body's typography (S17).
 *
 * A guide is MDX, so its markup comes from prose: `##` becomes an `<h2>`, a
 * bullet list a `<ul>`. Those elements have no classes of their own, and Tailwind
 * has no `prose` here (the typography plugin is deliberately not a dependency —
 * the token scale already names every size this app uses). So the mapping lives
 * in ONE place and the guide layout passes it to the MDX component.
 *
 * Three rules, and they are the same ones the gate checks:
 *
 *   - **token classes only** — `text-subtitle`, `text-body`, `text-compact`,
 *     `text-muted`; no palette utility, no hex. This file is inside
 *     `components/`, which is exactly why it lives here rather than beside the
 *     route: `check:tokens` scans it.
 *   - **logical sides only** — list padding is `ps-5`, a quote's rule is
 *     `border-s-2`. A guide is read in Arabic one day (S20), and a physical
 *     padding or border does not mirror.
 *   - **the page owns the h1.** A body starts at `##`; a stray `#` is rendered at
 *     the h2 level rather than becoming a second page title, so the document
 *     keeps one heading hierarchy even when an author forgets the rule.
 *
 * Links: an internal href goes through `next/link` (client-side navigation, and
 * the link checker in `e2e/guides.spec.ts` can follow it); an external one keeps
 * a plain `<a>` with `rel="noreferrer"`, because nothing here should vouch for
 * another site.
 */
import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";
import type { MDXComponents } from "mdx/types";

const HEADING_2 = "mt-8 text-subtitle text-ink first:mt-0";
const HEADING_3 = "mt-5 text-body font-semibold text-ink";

function Anchor({ href, children, ...rest }: ComponentPropsWithoutRef<"a">) {
  const className = "text-primary underline underline-offset-4 hover:text-primary-hover";
  if (typeof href === "string" && href.startsWith("/")) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className} rel="noreferrer" {...rest}>
      {children}
    </a>
  );
}

/**
 * The one map.
 *
 * Exported as a plain constant because the guide ROUTE needs it directly: an
 * async server component may not call anything named like a hook
 * (`react-hooks/rules-of-hooks` is right about that), and `useMDXComponents` is
 * only the @next/mdx file convention. The wrapper below delegates to this, so
 * the file-based path and the imported path cannot diverge.
 */
export const GUIDE_MDX_COMPONENTS: MDXComponents = {
  // Downgraded on purpose: see the header's third rule.
  h1: ({ children }) => <h2 className={HEADING_2}>{children}</h2>,
  h2: ({ children }) => <h2 className={HEADING_2}>{children}</h2>,
  h3: ({ children }) => <h3 className={HEADING_3}>{children}</h3>,
  p: ({ children }) => <p className="mt-3 text-body text-ink">{children}</p>,
  ul: ({ children }) => <ul className="mt-3 list-disc space-y-1 ps-5 text-body">{children}</ul>,
  ol: ({ children }) => <ol className="mt-3 list-decimal space-y-1 ps-5 text-body">{children}</ol>,
  li: ({ children }) => <li className="text-body text-ink">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="mt-4 border-s-2 border-border ps-3 text-body text-muted">
      {children}
    </blockquote>
  ),
  a: Anchor,
  code: ({ children }) => (
    <code className="rounded-control bg-subtle px-1 font-mono text-compact text-ink">{children}</code>
  ),
};

export function useMDXComponents(overrides: MDXComponents = {}): MDXComponents {
  return { ...GUIDE_MDX_COMPONENTS, ...overrides };
}
