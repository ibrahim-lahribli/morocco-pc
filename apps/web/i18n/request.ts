/**
 * Per-request i18n config: which locale this render is for, and its messages.
 *
 * The locale comes from `next/root-params` (Next 16.3+), NOT from a cookie or a
 * header. That is what keeps every route statically renderable: the dynamic
 * `[locale]` segment is a route param, so `generateStaticParams` can enumerate
 * `/fr` and `/ar` at build time and the page has no request-time dependency.
 *
 * The fallback here is the DEFAULT locale, not `notFound()`: throwing from the
 * i18n config during a static export surfaces as an opaque digest with no
 * message. The 404 for an unknown segment is raised where it is legible — in
 * the layout and the page, which both guard with `hasLocale`.
 */
import * as rootParams from "next/root-params";
import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { routing } from "./routing";

export default getRequestConfig(async ({ locale }) => {
  // `locale` is only set when a caller passes one explicitly (e.g. an email
  // sender); a normal page render resolves it from the route.
  if (!locale) {
    const param = await rootParams.locale();
    locale = hasLocale(routing.locales, param) ? param : routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
