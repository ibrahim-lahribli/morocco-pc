import { Check, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui";

import { HeroRigPreview } from "./hero-rig-preview";

export interface HomepageHeroProps {
  eyebrow: string;
  titleLead: string;
  titleAccent: string;
  intro: string;
  /** The three promise chips, in frame order. */
  chips: readonly string[];
  previewEyebrow: string;
  previewCaption: string;
  previewDetails: string;
  /** The finder island, rendered in the end column. */
  children: React.ReactNode;
}

/**
 * The hero: one promise and the finder beside it.
 *
 * Server-rendered except the finder it receives as children, so the H1, the
 * chips and the preview shell are present with JavaScript disabled. The chips
 * are hidden below `lg`, matching the phone frame. The single
 * `<h1>` on the page lives here; its two lines are block spans, so the
 * composition does not depend on the browser's wrap.
 */
export function HomepageHero({
  eyebrow,
  titleLead,
  titleAccent,
  intro,
  chips,
  previewEyebrow,
  previewCaption,
  previewDetails,
  children,
}: HomepageHeroProps) {
  return (
    <section id="top" aria-labelledby="hero-title" className="scroll-mt-24 pt-10 lg:pt-16">
      <div className="grid gap-8 lg:grid-cols-2 lg:items-start lg:gap-10">
        <div>
          <Badge tone="primary">
            <Sparkles aria-hidden="true" />
            {eyebrow}
          </Badge>

          <h1 id="hero-title" className="mt-3 text-display text-foreground lg:text-display-lg">
            <span className="block">{titleLead}</span>
            <span className="block bg-linear-to-r from-primary-deep to-primary bg-clip-text text-transparent">
              {titleAccent}
            </span>
          </h1>

          {/* 14/20 on a phone, where the Stitch frame sets the body step; the
              larger desktop step is unchanged from `lg`. */}
          <p className="mt-3 max-w-2xl text-body-md text-muted lg:text-body-lg">{intro}</p>

          {/* The promises are a desktop affordance: the phone frame drops them
              because the finder's own note repeats the same three claims. */}
          <ul className="mt-5 hidden flex-wrap items-center gap-2 lg:flex">
            {chips.map((chip) => (
              <li
                key={chip}
                className="flex items-center gap-1.5 rounded-pill bg-surface px-3 py-1.5 text-label-md text-muted shadow-level-1"
              >
                <Check aria-hidden="true" className="size-3.5 text-verified" />
                {chip}
              </li>
            ))}
          </ul>

          <div className="mt-6 hidden lg:block">
            <HeroRigPreview
              eyebrow={previewEyebrow}
              caption={previewCaption}
              details={previewDetails}
            />
          </div>
        </div>

        {/* `min-w-0` keeps the finder's truncated lines from widening the grid
            track: a nowrap text's intrinsic width would otherwise overflow. */}
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}
