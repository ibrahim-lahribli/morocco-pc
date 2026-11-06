import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

/** Translated 404 for unknown routes and locale segments. */
export default async function NotFound() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "NotFound" });

  return (
    <div className="flex min-h-[60vh] flex-col items-start justify-center gap-3 py-12">
      <p className="text-label-lg font-semibold text-primary">404</p>
      <h1 className="text-headline-lg text-foreground">{t("title")}</h1>
      <p className="text-body-md text-muted">{t("description")}</p>
      <Link
        href={`/${locale}`}
        className="mt-2 text-label-lg font-semibold text-primary underline-offset-4 hover:underline"
      >
        {t("back")}
      </Link>
    </div>
  );
}
