import { notFound } from "next/navigation";

/**
 * The catch-all that makes a bad URL inside a locale render the LOCALE'S 404.
 *
 * Without it, `/fr/nimportequoi` matches no route at the app level, so Next
 * answers with its root 404 — which is not inside `[locale]`, has no layout, no
 * French copy and no link back to the wizard. Adding a `[...rest]` page under the
 * locale segment moves that miss INTO the segment, where `not-found.tsx` is the
 * boundary and `notFound()` throws where a 404 status is still available.
 *
 * It is deliberately empty: a catch-all that rendered something would be
 * inventing a page for a URL nothing owns. And it cannot shadow a real route —
 * a concrete segment always wins over a dynamic one, so `/fr/config/<id>` and
 * `/fr/configurer` keep their own pages.
 */
export default function CatchAllPage() {
  notFound();
}
