#!/usr/bin/env node
/**
 * fetch-media.mjs — CC0 cover images for guides and presets, with provenance.
 *
 * WHY THIS EXISTS, AND WHAT IT REFUSES TO DO
 * ------------------------------------------
 * The design's build cards show photographs. Those cards assert a PRODUCT
 * IDENTITY (this is the RTX 4060 you get), and no openly licensed photo of a
 * specific SKU exists — the CC0 pool holds GT 1030s and circuit boards. Putting
 * one of those on an RTX 4060 card would be a false claim, so build and component
 * cards keep the drawn fallback. The images fetched here are for the GUIDES and
 * PRESET covers, where a photo is atmosphere and the heading carries the meaning.
 *
 * Licence: `license=cc0` ONLY. CC0 needs no attribution, which is the one licence
 * that is safe to commit without a per-use obligation. Provenance is still
 * recorded, because "we do not need to credit this" is a weaker position than
 * "here is where it came from".
 *
 * No hotlinking: every file is downloaded, resized and committed. A remote URL in
 * a `<img>` would put a third-party request in the critical path and make the
 * LCP budget depend on someone else's server.
 *
 * Usage:
 *   node scripts/fetch-media.mjs [--force] [--only=<key>]
 *
 * Output:
 *   public/media/<key>-<width>.avif|webp   the assets
 *   ../media/credits.json + CREDITS.md      provenance (outside public/)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "..");
const OUT_DIR = path.join(WEB, "public", "media");
const CREDITS_DIR = path.join(WEB, "media");

/** Two widths only: a 360 px card and the same card at 2x. Nothing else is used. */
const WIDTHS = [360, 720];

/**
 * A curated set, not a search box. Each entry is a slot the design draws, so a
 * future screen cannot silently add an unbudgeted image.
 */
const TARGETS = [
  { key: "guide-gpu", query: "graphics card", kind: "guide" },
  { key: "guide-motherboard", query: "motherboard", kind: "guide" },
  { key: "preset-desk", query: "computer desk", kind: "preset" },
  { key: "preset-monitor", query: "computer monitor", kind: "preset" },
];

const args = new Set(process.argv.slice(2));
const FORCE = args.has("--force");
const ONLY = [...args].find((a) => a.startsWith("--only="))?.slice("--only=".length);

const UA = "morocco-pc/1.0 (design covers; contact: project owner)";

async function json(url, attempt = 1) {
  const response = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(45_000),
  });
  // Anonymous Openverse is rate limited, and the limit is not announced: the
  // first queries of a session succeed and later ones stall or 429. Retry with a
  // widening pause, then fail soft - a cover image is never worth a red gate.
  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    const wait = attempt * 6_000;
    console.log(`  ${response.status} from Openverse; retry ${attempt}/2 in ${wait / 1000}s`);
    await new Promise((resolve) => setTimeout(resolve, wait));
    return json(url, attempt + 1);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

/** CC0, landscape, and big enough that 720 px is a downscale rather than a guess. */
function pick(results) {
  return results.find(
    (item) =>
      item.license === "cc0" &&
      Number(item.width) >= 1100 &&
      Number(item.height) >= 600 &&
      item.url,
  );
}

async function fetchOne(target) {
  const search =
    "https://api.openverse.org/v1/images/?q=" +
    encodeURIComponent(target.query) +
    "&license=cc0&extension=jpg&page_size=12";
  const payload = await json(search);
  const chosen = pick(payload.results ?? []);
  if (!chosen) {
    return { ...target, skipped: `no CC0 landscape result (${payload.result_count ?? 0} total)` };
  }

  const image = await fetch(chosen.url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(45_000),
  });
  if (!image.ok) return { ...target, skipped: `download HTTP ${image.status}` };
  const buffer = Buffer.from(await image.arrayBuffer());

  const written = [];
  for (const width of WIDTHS) {
    const base = sharp(buffer).resize({ width, withoutEnlargement: true });
    const avif = path.join(OUT_DIR, `${target.key}-${width}.avif`);
    const webp = path.join(OUT_DIR, `${target.key}-${width}.webp`);
    await base.clone().avif({ quality: 52 }).toFile(avif);
    await base.clone().webp({ quality: 74 }).toFile(webp);
    written.push(avif, webp);
  }

  const bytes = written.reduce((total, file) => total + fs.statSync(file).size, 0);
  return {
    ...target,
    title: chosen.title,
    creator: chosen.creator,
    license: `${chosen.license} ${chosen.license_version}`.trim(),
    source: chosen.foreign_landing_url ?? chosen.detail_url,
    original: `${chosen.width}x${chosen.height}`,
    files: written.map((file) => path.relative(WEB, file).split(path.sep).join("/")),
    bytes,
  };
}

function writeCredits(entries) {
  fs.mkdirSync(CREDITS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(CREDITS_DIR, "credits.json"),
    `${JSON.stringify(entries, null, 2)}\n`,
  );

  const rows = entries
    .map((entry) =>
      entry.skipped
        ? `| \`${entry.key}\` | — | — | — | skipped: ${entry.skipped} |`
        : `| \`${entry.key}\` | ${entry.title ?? ""} | ${entry.creator ?? "?"} | ${entry.license} | ${entry.source} |`,
    )
    .join("\n");

  fs.writeFileSync(
    path.join(CREDITS_DIR, "CREDITS.md"),
    `# CREDITS — cover media

Every file under \`public/media/\` is **CC0 1.0** (public domain dedication): no
attribution is legally required, and this table records provenance anyway.
Generated by \`npm run media:fetch\` — never edit by hand, and never add an image
that did not come through that script with a CC0 result.

Product and build cards are deliberately NOT illustrated: a CC0 photo of
different hardware next to a specific SKU would be a false claim about what the
buyer receives (see DEVIATIONS.md D-01).

| Slot | Title | Creator | Licence | Source |
|---|---|---|---|---|
${rows}
`,
  );
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const entries = [];
  const targets = ONLY ? TARGETS.filter((t) => t.key === ONLY) : TARGETS;

  for (const target of targets) {
    const expected = path.join(OUT_DIR, `${target.key}-${WIDTHS[0]}.avif`);
    if (!FORCE && fs.existsSync(expected)) {
      console.log(`skip ${target.key} (exists; --force to refetch)`);
      continue;
    }
    try {
      const entry = await fetchOne(target);
      entries.push(entry);
      console.log(
        entry.skipped
          ? `SKIP ${target.key}: ${entry.skipped}`
          : `ok   ${target.key}: ${entry.files.length} files, ${entry.bytes} B, ${entry.license}, by ${entry.creator}`,
      );
    } catch (error) {
      entries.push({ ...target, skipped: error.message });
      console.log(`FAIL ${target.key}: ${error.message}`);
    }
  }

  // Merge with what is already recorded, so a partial run never erases provenance.
  const creditsPath = path.join(CREDITS_DIR, "credits.json");
  const previous = fs.existsSync(creditsPath)
    ? JSON.parse(fs.readFileSync(creditsPath, "utf8"))
    : [];
  const merged = [
    ...previous.filter((old) => !entries.some((entry) => entry.key === old.key)),
    ...entries,
  ];
  writeCredits(merged);

  const total = merged.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);
  console.log(`\ntotal committed media: ${total} B across ${merged.filter((e) => !e.skipped).length} slots`);
}

await main();
