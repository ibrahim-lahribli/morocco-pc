/**
 * opengraph-image.tsx — the share preview card for one result (S15).
 *
 * It is a FACTORY so the card can carry the pass's own facts: the total and
 * the provenance word the honest og:title already names, drawn with the same
 * `priceProvenance()` the badge uses — never a number the pass did not
 * record, and never the word of a state the pass is not in. A pass the
 * factory cannot read draws the BRAND, not an invented build.
 *
 * Satori (the renderer below) knows NO Tailwind and NO tokens: every colour
 * here is a hexadecimal literal, which is why this file exempts itself in
 * `scripts/check-tokens.mjs` — the palette lives in globals.css, and a card
 * rendered outside CSS may not silently drift from it, but hex literals in
 * THIS file are the values those tokens compile to, with the ones adopted
 * annotated ingredient by ingredient.
 *
 * The `cache()`d loader counts the crawler's image fetch as its OWN request
 * (see load.ts) — correct, because a preview image is requested apart, long
 * after the page render that embedded it has ended.
 *
 * 1200 x 630: the OG image size every major surface crops from. It is
 * declared twice (here, and in the emitted og:image:width/height) so a
 * preview box never has to guess.
 */
import { ImageResponse } from "next/og";

import { orderBuilds, priceProvenance, type PriceProvenance } from "@/lib/result/model";
import { loadRecommendationCached } from "@/lib/result/load";
import { formatMoney, type AppLocale } from "@/lib/i18n/format";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "morocco-pc";

// globals.css token values (see TOKEN_MAP.md): ink, muted, surface, page,
// border, primary, info. The card paints the page pairs it borrows.
const INK = "#0f172a";
const MUTED = "#64748b";
const SURFACE = "#ffffff";
const PAGE = "#f8fafc";
const BORDER = "#e2e8f0";
const PRIMARY = "#1d4ed8";
const INFO_SOFT = "#e6f2fa";

/**
 * The card always shouts the FRENCH honesty word (the badge's vocabulary,
 * capitalised here): an Arabic og:title is text sent by generateMetadata,
 * but the card is drawn by a rasterizer whose default font has no Arabic
 * glyphs, and arabising it means loading a face into Satori - S20's job,
 * not a glyph-box costume for S15.
 */
const WORD: Record<PriceProvenance, string> = {
  demo: "Démo",
  indicative: "Indicatif",
  verified: "Vérifié",
};

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const appLocale: AppLocale = locale === "ar" ? "ar" : "fr";
  const outcome = await loadRecommendationCached(id);
  // The card and the og:title must name the SAME build, so the primary is the
  // one the page draws first: rank order, never the response's array order
  // (lib/result/model.ts rule 1). Two call sites, one rule.
  const primary = outcome.kind === "ok" ? orderBuilds(outcome.recommendation.builds)[0] : undefined;
  const total =
    primary !== undefined && typeof primary.total_price === "number" ? primary.total_price : null;
  const budget =
    outcome.kind === "ok"
      ? outcome.recommendation.budget_amount ?? outcome.recommendation.budget_floor?.budget_amount ?? null
      : null;
  const word = primary !== undefined ? WORD[priceProvenance(primary)] : null;

  const headline =
    total !== null && budget !== null
      ? `${formatMoney(total, appLocale)} / ${formatMoney(budget, appLocale)}`
      : total !== null
        ? formatMoney(total, appLocale)
        : "";

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
          <div
            style={{
              display: "flex",
              fontSize: "36px",
              fontWeight: 600,
              color: INK,
            }}
          >
            morocco-pc
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {headline !== "" ? (
            <div style={{ display: "flex", fontSize: "96px", fontWeight: 700, color: INK }}>
              {headline}
            </div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {word !== null ? (
              <div
                style={{
                  display: "flex",
                  padding: "8px 20px",
                  borderRadius: "999px",
                  backgroundColor: INFO_SOFT,
                  color: PRIMARY,
                  fontSize: "30px",
                }}
              >
                {word}
              </div>
            ) : null}
            <div style={{ display: "flex", fontSize: "30px", color: MUTED }}>
              config / {id.slice(0, 8)}
            </div>
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
          <div style={{ display: "flex" }}>Configurations compatibles, prix en DH</div>
          <div style={{ display: "flex" }}>morocco-pc</div>
        </div>
      </div>
    ),
    size,
  );
}
