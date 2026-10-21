/**
 * mdx-components.tsx — the file the `@next/mdx` App Router integration requires
 * (S17). It must exist at this level; without it, an MDX import fails to compile.
 *
 * All it does is point the convention at the one module that owns the classes
 * (`components/guides/mdx-components.tsx`), so the file carrying the styling
 * stays inside `check:tokens`'s scan set instead of sitting at the package root.
 */
export { useMDXComponents } from "./components/guides/mdx-components";
