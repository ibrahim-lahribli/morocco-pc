/**
 * lib/result/share.ts — the share surface's URLs, decided once (S15).
 *
 * Three routes carry a result out of the app — a wa.me link, the Web Share
 * API, and the clipboard — and all three name the SAME canonical URL and the
 * SAME text. Keeping only the URL math here, with the formatting decision
 * split off, means a link built for WhatsApp is provably the link the meta
 * tags advertise: both come from `absoluteResultUrl()`.
 */
import type { AppLocale } from "@/lib/i18n/format";

/**
 * The absolute, canonical URL of one result: scheme, host, locale prefix and
 * the id, percent-encoded in the path. It RE-ENCODES the id on purpose —
 * a caller that passes it raw cannot manufacture a URL with a slash or a
 * `?` in it, because a result id is data, never a locator.
 */
export function absoluteResultUrl(origin: string, locale: string, id: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/${locale}/config/${encodeURIComponent(id)}`;
}

/**
 * The origin THIS render was addressed by, from the request headers.
 *
 * A share preview must point at the big URL the recipient will actually be
 * taken to, and on localhost the preview is a different box from the API, so
 * `NEXT_PUBLIC_API_BASE_URL` is not it — the origin of the REQUEST is.
 * Behind one clean hop, `x-forwarded-host`/`x-forwarded-proto` name the
 * original address; with no proxy, `host` is the truth. Locally (no proxy at
 * all) the scheme falls back to `http` so the mock-run URL is a working link
 * rather than a port-suffixed lie. A comma-separated forwarded first hop is
 * the one that reached the browser, so the FIRST value wins.
 */
export function originFromHeaders(headers: Headers): string {
  const forwardedHost = headers.get("x-forwarded-host");
  const host = (forwardedHost !== null ? forwardedHost.split(",")[0] : null) ?? headers.get("host") ?? "localhost:3000";
  const forwardedProto = headers.get("x-forwarded-proto");
  const proto =
    forwardedProto !== null
      ? forwardedProto.split(",")[0].trim()
      : /^localhost(:|$)|^127\.0\.0\.1(:|$)|^\[::1\]/.test(host)
        ? "http"
        : "https";
  return `${proto}://${host}`;
}

/**
 * The wa.me intent URL for a pre-filled text. The text (which carries the
 * canonical URL inside it) is encoded once, here: a WhatsApp link built
 * elsewhere would have to re-derive this format.
 */
export function waMeHref(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
