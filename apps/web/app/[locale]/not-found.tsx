import { hasLocale } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import { LinkButton } from "@/components/ui";
import { routing } from "@/i18n/routing";
import { localePath } from "@/lib/i18n/paths";

/**
 * The 404 inside a locale segment (S11).
 *
 * It exists because `notFound()` is now reachable from a DATA path: an unknown
 * result id. Next's default 404 is an unstyled English page with no way forward,
 * which would be the last thing a user saw after following a shared link — a
 * dead end dressed as an error, in the wrong language.
 *
 * Two mechanics worth knowing:
 *
 *   - **`not-found.tsx` takes no props**, so the locale is read with `getLocale()`
 *     (next-intl resolves it from the route's `[locale]` param) rather than from
 *     `params`. The `hasLocale` guard is the same one every page carries, and its
 *     fallback is the default locale — by the time this renders the layout has
 *     already refused an unknown segment.
 *   - **The status code is real.** `notFound()` thrown during a render, before
 *     streaming starts, answers HTTP 404 (pinned by `e2e/result.spec.ts`). After
 *     streaming starts the status would stay 200, which is why the results page
 *     checks existence BEFORE it renders any card.
 *
 * `noindex` is injected by Next for a not-found render; nothing here adds a
 * second robots tag.
 */
export default async function LocaleNotFound() {
  const requested = await getLocale();
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "notFound" });

  return (
    <section>
      <p className="text-micro tracking-wide text-muted uppercase">{t("eyebrow")}</p>
      <h1 className="mt-1 text-heading text-ink">{t("title")}</h1>
      <p className="mt-3 max-w-prose text-body text-muted">{t("body")}</p>
      <div className="mt-6">
        <LinkButton href={localePath(locale, "/configurer")}>{t("cta")}</LinkButton>
      </div>
    </section>
  );
}
