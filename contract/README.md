# contract/ — the API's published contract

`openapi.json` is the OpenAPI 3.0.3 document the API serves at `/v1/docs/json`,
committed byte-for-byte. The version lives INSIDE the file (`info.version` =
`1.10.0`), never in the filename, so the path is stable across releases.

## Who owns it

`apps/api` does. `apps/api/test/unit/openapi-snapshot.test.js` fails when the
served document and this file differ by one byte (one trailing newline ignored),
which is what makes the published surface a claim rather than a description.
`apps/api/test/unit/openapi-coverage.test.js` is the other half: every served
route must be documented, with its `429`/`500`.

## Who consumes it

- `apps/web` — `lib/api/schema.d.ts` is generated from this file and compared
  byte-for-byte by `npm run check:api-types`.
- `apps/web-v2` — the same, once it lands.

A consumer copies nothing; it generates types from this file and pins what it
expects. `apps/web/scripts/check-api-types.mjs` pins `EXPECTED_VERSION` and the
ten paths, so a contract change that the client was not revisited for fails the
web gate instead of shipping silently.

## How it changes

Deliberate contract change only, in ONE pull request:

1. change the route/contract in `apps/api/src`;
2. regenerate this file (command in the snapshot test's header);
3. bump `info.version` and add the changelog entry to `docs/API.md`;
4. regenerate the consumers' types (`cd apps/web && npm run gen:api-types`).

There is exactly one snapshot on purpose: never keep a superseded copy.
