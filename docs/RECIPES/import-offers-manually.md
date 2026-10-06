# Recipe: import offers manually

Ingest operator-collected prices from a CSV/JSON file. No scraper contacts any
retailer; the operator supplies the file. Interface and format:
`docs/IMPORT_OFFERS.md`. Requires migration 017 (offer natural key + provenance)
on the target database.

1. `git status` first — shared checkout.
2. Prepare the file from `scripts/templates/manual-offers.example.csv`. Every
   row needs a `source_note` saying where and when the price was collected.
3. Dry-run against the test branch (read-only):
   `node scripts/ingest-offers.js --adapter=manual --file=<path> --test-db`
   Check the counts and the per-row detail; fix any `REJECTED` lines.
4. Commit to the test branch:
   `node scripts/ingest-offers.js --adapter=manual --file=<path> --commit --test-db`
5. Re-run step 4 unchanged — expect `unchanged: N`, `inserted 0`. That is the
   idempotency proof.
6. Confirm the engine still runs on the branch:
   `node scripts/test-orchestrator-full-run.js` and
   `node scripts/measure-orchestrator.js`.
7. Clean up any probe rows (delete `price_history`, `spec_provenance`,
   `product_candidate`, `store_offer`, `ingestion_record` for your identifiers)
   and confirm residue is 0.
8. Shared DB: `--commit` against `DATABASE_URL` is REFUSED unless
   `--confirm-shared` is passed, and should only be run once the operator has
   approved the write. Show the dry-run diff first.

Verify:

```bash
node scripts/ingest-offers.js --adapter=manual --file=<path> --test-db
npm run test:unit
npm run test:scripts
node scripts/verify-docs.js --offline
```

Never edit an existing migration; the offer key lives in migration 017. Never
write to the shared `DATABASE_URL` without the operator's explicit approval.
