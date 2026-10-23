// default open-next.config.ts file created by @opennextjs/cloudflare
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";

// KV rather than R2: R2 cannot be enabled on this account without a payment
// method on file, and KV needs neither a card nor a dashboard step. The trade is
// the free KV write budget (1,000/day) and up to 60 s of cross-colo staleness —
// fine for ISR at development volume. Revisit R2 when revalidations outgrow it.
export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
});
