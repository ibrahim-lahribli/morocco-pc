# Recipe: refresh offer freshness (OG-30)

Stage 1 hard-filters `store_offer.last_checked_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'`
(`src/recommendation/offers/select.js:70`, Decision 7). Seeds 001/002 wrote
`last_checked_at = NOW()` once; nothing refreshes it. Unrenewed, queries fail
with `EMPTY_CANDIDATE_POOL` once all rows are stale. Seed 006 re-stamps the
timestamp without touching prices (OG-06 stays open by design).

1. `git status` first. Check the cliff: `node scripts/check-offer-freshness.js`
   (read-only; exit 1 when offers are expired or the first expiry is near).
2. Dry-run: `node scripts/run-seeds.js --dry-run` (006 must appear; the naive
   `split(';')` count is approximate when comments hold semicolons).
3. Branch-first (original workflow): apply 006 to `TEST_DATABASE_URL`, then
   `node scripts/test-orchestrator-full-run.js` green before touching shared.
4. Apply to the shared DB (`npm run seed` applies all seeds in order; 006 only
   touches `Seed %` rows older than 7 days, so it is a no-op for fresh rows).
   Never UPDATE price/currency/availability here — a price correction INSERTs
   a second offer (002 header; `store_offer` has no unique key). Never append
   `price_history` rows on a no-change refresh (append-only, no retention — K15).
5. `npm run gen:schema` (`DATA_STATE.md` checked-range moves), then
   `node scripts/verify-docs.js --live` and `node scripts/check-offer-freshness.js`
   (expect PASS, blackout ~+30d).

Verify:

```bash
node scripts/check-offer-freshness.js
node scripts/run-seeds.js --dry-run
npm run test:unit
node scripts/verify-docs.js --offline
```
