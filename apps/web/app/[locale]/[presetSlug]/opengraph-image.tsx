/**
 * opengraph-image.tsx — the share card for one preset page (S18).
 *
 * A FUNCTION OF THE SLUG, and of nothing else. That is the "static" in the
 * sprint's "static, optimized, explicit dimensions": the route reads no API, no
 * translations and no clock, so for every budget `generateStaticParams` names it
 * is generated once at build and served as an image, and a budget that arrives
 * later through ISR produces the same deterministic card on first request. A card
 * that fetched the pass would be a second copy of the page's data and a second
 * place for it to disagree with the og:title.
 *
 * The card therefore shows the BUDGET — the number the page promises in its own
 * title and bar — and never a build total. A share preview that printed a price
 * would have to also print its provenance word, and the S12 badge already owns
 * that decision on the page; omitting the price means the card cannot claim
 * "vérifié" for a demo page, which is the V6 mistake in image form.
 *
 * 1200 x 630 is the size every major surface crops from, declared here (so the
 * emitted `og:image:width`/`height` are exact) and asserted against the real PNG
 * bytes by `e2e/seo.spec.ts` — a preview box must never have to guess.
 *
 * Satori knows NO Tailwind and NO tokens, so the colours below are hexadecimal
 * literals: the values `globals.css` tokens compile to, named one by one. This
 * file is therefore exempt from `check:tokens`' hex rule only — the palette and
 * physical-side rules still read it (see `scripts/check-tokens.mjs`).
 *
 * French-only text, like the result card: an Arabic title would need an Arabic
 * face loaded into Satori, and a glyph-box costume is worse than a card that says
 * the same sentence to both locales. The og:title beside it IS localized.
 */
import { ImageResponse } from "next/og";

import { routing } from "@/i18n/routing";
import { formatMoney } from "@/lib/i18n/format";
import { presetsForBuild } from "@/lib/presets/load";
import { parsePresetSlug } from "@/lib/presets/model";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "morocco-pc — configurations compatibles, prix en DH";

/**
 * The same page set the preset route prerenders, so each card is an IMAGE FILE
 * in the build output rather than a render per preview fetch.
 *
 * Without this list the image route is `ƒ` in the build table — measured — even
 * though the page it belongs to is `●`: a metadata image route is its own route
 * and does not inherit the page's params. The list is `presetsForBuild()`, the
 * same source, so the two cannot drift; `dynamicParams` stays default, so a
 * budget gained through ISR still gets a card on first request.
 */
export async function generateStaticParams() {
  const presets = await presetsForBuild();
  return routing.locales.flatMap((locale) =>
    presets.map((preset) => ({ locale, presetSlug: preset.slug })),
  );
}

// globals.css token values (see TOKEN_MAP.md): ink, muted, surface, page,
// border, primary. Same literals as the result card (S15).
const INK = "#0f172a";
const MUTED = "#64748b";
const SURFACE = "#ffffff";
const PAGE = "#f8fafc";
const BORDER = "#e2e8f0";
const PRIMARY = "#1d4ed8";

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; presetSlug: string }>;
}) {
  const { presetSlug } = await params;
  // A slug the grammar refuses gets the brand card: the page 404s, and an image
  // is not the place to invent a budget a URL did not name.
  const parsed = parsePresetSlug(presetSlug);
  const headline = parsed === null ? "" : formatMoney(parsed.budget, "fr");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px",
          backgroundColor: PAGE,
          backgroundImage: `linear-gradient(180deg, ${SURFACE} 0%, ${PAGE} 100%)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              display: "flex",
              width: "64px",
              height: "64px",
              borderRadius: "16px",
              backgroundColor: PRIMARY,
              color: SURFACE,
              alignItems: "center",
              justifyContent: "center",
              fontSize: "40px",
            }}
          >
            m
          </div>
          <div style={{ display: "flex", fontSize: "36px", fontWeight: 600, color: INK }}>
            morocco-pc
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {headline === "" ? null : (
            <div style={{ display: "flex", fontSize: "104px", fontWeight: 700, color: INK }}>
              {headline}
            </div>
          )}
          <div style={{ display: "flex", fontSize: "38px", color: MUTED }}>
            Configurations compatibles
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: `1px solid ${BORDER}`,
            paddingTop: "20px",
            fontSize: "26px",
            color: MUTED,
          }}
        >
          <div style={{ display: "flex" }}>Prix en DH</div>
          <div style={{ display: "flex" }}>morocco-pc</div>
        </div>
      </div>
    ),
    size,
  );
}
