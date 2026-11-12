<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — web frontend

Scope: `apps/web/**`. This is a standalone package with its own `package.json`, lockfile and workflow
(`.github/workflows/web.yml`); the root manifest does not build it. It consumes the API through
generated contract types and owns no engine logic.

Authoritative onboarding is `apps/web/README.md`; commands live in `apps/web/package.json`.

## Non-negotiables

- **No secrets, no database.** The app is static/SSR over the API; it never holds a credential.
- **Contract drift is a gate, not a review note.** `check:api-types` compares against the shared
  authoritative `contract/openapi-1.10.0.json`; a contract change must update that document and both
  consumers deliberately. Never copy the contract into `apps/web`.
- **Design tokens, not ad-hoc values.** `check:tokens` fails raw values that bypass the token layer.
- **Locales stay in parity.** `check:i18n` enforces key and placeholder parity across `fr`/`ar`.
- **Accessibility and budgets are enforced** by the Playwright/axe suite and the Lighthouse budgets
  (`error` level, median of three). Do not relax a budget to land a change.

## Commands (run inside `apps/web`)

```bash
npm run typecheck
npm run lint
npm run check:tokens
npm run check:i18n
npm run check:api-types
npm run build
npm test          # Playwright; starts the app on 3210 and the fixture mock on 3211
npm run test:lighthouse
```

A real-engine Playwright spec is deliberately excluded from CI and must be run alone; see its header.
