## 2.5 Out-of-scope gap discovered during review: Tailwind v4 PostCSS in the current scaffold

This task was review-only. I did not change any code, but a real defect is in the scaffolded
tree and must be fixed before any CSS surface ship. It is recorded here so it is not lost.

**What exists today in `apps/web/` (verified):**

- `tailwindcss` 4.3.3 installed, `app/globals.css` uses `@import "tailwindcss";` and the
  Tailwind-native `@theme inline {...}` directive.
- `@tailwindcss/turbopack` installed (Turbopack/Turbopack-loader only),
  `@tailwindcss/node`, `@tailwindcss/oxide`, `@tailwindcss/oxide-win32-x64-msvc`.
- No `@tailwindcss/postcss`, no `postcss.config.*`, and `postcss` itself is **not** installed
  at `apps/web/node_modules` (confirmed: `require.resolve('postcss')` from `apps/web` throws
  `MODULE_NOT_FOUND`).

**What the build does today (and why it warns):**

- `next build` / `next start` on this package use the default webpack pipeline. Next 16.4.2 has
  `turbopack: false`, and the installed `next build` tree does not find a First-class PostCSS host
  for Tailwind v4 without one.
- Because there is no Tailwind PostCSS plugin wired, the CSS parser sees `@theme inline {...}`
  and PostCSS reports `Unknown at rule: @theme` — so the directive is never processed by Tailwind.
- The scaffold installed a Turbopack loader (`@tailwindcss/turbopack`), but Turbopack is not active
  for the default webpack build, so that loader is not the path for these commands either.

**Primary source proof (verbatim):**

`node_modules/tailwindcss/dist/lib.js` exports a function and, at module scope, sets every export
to a throw:

```
function mt(){throw new Error("It looks like you're trying to use `tailwindcss` directly as a
PostCSS plugin. The PostCSS plugin has moved to a separate package, so to continue using Tailwind
CSS with PostCSS you'll need to install `@tailwindcss/postcss` and update your PostCSS
configuration.")}
```

**Intended path (the one team members will reach for).**

Tailwind CSS v4 changed this once: the PostCSS plugin is no longer bundled into `tailwindcss` for
postcss-based usage in the same shape. The team path for a webpack build is:

1. install the separate PostCSS plugin package for Tailwind v4, i.e. `@tailwindcss/postcss` (the
   package name the error message points to);
2. add a PostCSS configuration at the package root (`apps/web/postcss.config.*`) that registers the
   Tailwind v4 PostCSS plugin for CSS files, so `@import "tailwindcss";` and `@theme` directives
   are processed by Tailwind, not by plain PostCSS;
3. keep `app/globals.css` as the Tailwind entry point (current shape) only once PostCSS is wired;
4. confirm `next build` still emits no `Parsing CSS source code failed` warning and that
   `@theme` tokens are usable.

**Optionally, the Turbopack route instead:** if the team wants to use Turbopack for dev and/or
build, then the Tailwind integration is via the Turbopack loader, and `next.config.ts` must be
configured for Turbopack with the `@tailwindcss/turbopack` loader rule the README documents. That
is the other legit Tailwind v4 path, but it is a different integration than the webpack PostCSS
plugin path, and the choice between them is the acceptance decision the team makes.

**Acceptance criteria before CSS work ships (file this against whoever owns `apps/web`):**

- One of the two Tailwind v4 integration paths is wired and documented at `apps/web` root
  (PostCSS plugin via `postcss.config.*`, **or** Turbopack loader via `next.config.ts`);
- `npm run build` emits no `Parsing CSS source code failed` / `Unknown at rule: @theme` warning;
- a minimal `@theme` token is used in CSS and the rendered page actually reflects it (not just
  parses); and
- the chosen path is the one the team commits to (PostCSS or Turbopack), not both left ambiguous.

This is the only issue I found in the surfaced artifacts. Everything else on this branch is the
scaffold plus the `/fr` shell plus the CI workflow; none of those are CSS-functional yet.

