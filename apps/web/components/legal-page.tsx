/**
 * components/legal-page.tsx — the shape all three legal pages share (S22).
 *
 * The three pages differ only in their copy: an eyebrow, a title, one intro
 * sentence, a "last updated" line and a list of headed sections. Writing that
 * markup once means the pages cannot drift into three typographic systems, and
 * adding a fourth (a cookies policy, say) is a messages edit plus a route.
 *
 * The date is a CONSTANT passed in by each page and rendered through
 * `formatDate()`: a legal page's "last updated" is the day its prose changed,
 * not the day it was rendered, and reading the clock here would make an
 * unchanged page claim to be newer than it is.
 */
import type { ReactNode } from "react";

export interface LegalSection {
  heading: string;
  /** One paragraph, or several — the analytics rule is two (see the privacy page). */
  body: string | readonly string[];
}

export interface LegalPageProps {
  eyebrow: string;
  title: string;
  intro: string;
  /** The human label for the constant date, e.g. "Dernière mise à jour : …". */
  updated: string;
  sections: readonly LegalSection[];
  /** An optional closing line in the muted voice — usually a link elsewhere. */
  note?: ReactNode;
}

export function LegalPage({ eyebrow, title, intro, updated, sections, note }: LegalPageProps) {
  return (
    <article>
      <p className="font-mono text-caption uppercase tracking-wider text-primary">{eyebrow}</p>
      <h1 className="mt-1 text-heading text-ink">{title}</h1>
      <p className="mt-3 max-w-prose text-body text-muted">{intro}</p>
      <p className="mt-2 text-caption text-muted">{updated}</p>

      <div className="mt-6 max-w-prose space-y-5">
        {sections.map((section) => (
          <section key={section.heading}>
            <h2 className="text-subtitle text-ink">{section.heading}</h2>
            {(typeof section.body === "string" ? [section.body] : section.body).map((paragraph) => (
              <p key={paragraph} className="mt-1 text-body text-ink">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>

      {note === undefined ? null : (
        <p className="mt-6 max-w-prose text-caption text-muted">{note}</p>
      )}
    </article>
  );
}

/**
 * The one date all three pages print, and the reason they print the same one:
 * a reader comparing Confidentialité and Mentions légales must not find two
 * "last updated" claims that disagree.
 */
export const LEGAL_UPDATED_AT = "2026-10-22T00:00:00.000Z";
