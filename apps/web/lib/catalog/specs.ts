/**
 * lib/catalog/specs.ts — a catalogue spec row, as rows a reader can read (S17).
 *
 * `specs` is an OPEN object in the contract: its keys are the spec table's
 * columns, minus the ids and timestamps the API strips. Openness is the point —
 * the API may serve a column this module has never heard of — so the rules here
 * are about what may be PRINTED, not about what may arrive.
 *
 * Four rules, each one a way a spec page lies:
 *
 * 1. **NULL is not a value.** `height_mm: null` means UNKNOWN (NULL is never 0),
 *    so the row is OMITTED rather than drawn as "—" or "0 mm". The repo's
 *    standing NULL rule reaches the catalogue too.
 * 2. **An id is not a spec.** `socket_id`, `memory_type_id`, `chipset_id` name
 *    OTHER rows; printing a UUID is the raw-vocabulary failure V5 forbids, and
 *    this page has no name to resolve it to. Every `*_id` key is skipped, as are
 *    the timestamps (which the API already strips — the guard is defensive).
 * 3. **Order is a decision, not insertion order.** Each category has a curated
 *    list — the facts a buyer asks about first — and anything unmapped follows in
 *    the object's own order, so nothing truthful is hidden behind a list.
 * 4. **An unmapped key is SHOWN with its own name.** A fact that arrives before
 *    its translation is a visible copy gap, not a silently missing specification.
 *
 * Labels live in `messages/*.json` under `catalog.specs.*` and are passed in as
 * `SpecCopy`: this module stays pure, and the page's own test can prove that
 * every key a fixture serves has a word. Units are SYMBOLS (W, mm, MT/s, V,
 * MHz) except the two that are words in a language (slots, Go), which are also
 * translated.
 */
import type { CatalogProductResponse } from "../api/client";
import { formatNumber, type AppLocale } from "../i18n/format";

/** The facts each category shows first; every key here must have a label. */
const ORDER: Record<string, readonly string[]> = {
  CPU: [
    "cores",
    "threads",
    "base_clock_mhz",
    "boost_clock_mhz",
    "tdp_watts",
    "pbp_mtp_watts",
    "memory_channels",
    "max_official_memory_speed_mtps",
    "pcie_generation",
    "integrated_gpu_present",
    "integrated_gpu_model",
    "package_note",
  ],
  GPU: [
    "board_tgp_watts",
    "length_mm",
    "width_slots",
    "height_mm",
    "recommended_psu_watts",
    "required_power_connectors",
  ],
  MEMORY: ["module_count", "capacity_per_module_gb", "rated_speed_mtps", "voltage_v"],
  MOTHERBOARD: [
    "form_factor",
    "dimm_slots",
    "max_memory_capacity_gb",
    "official_memory_speed_min_mtps",
    "official_memory_speed_max_mtps",
    "pcie_x16_slots",
    "pcie_slot_generation",
    "m2_slots",
    "sata_ports",
    "wifi_present",
    "bios_notes",
  ],
  STORAGE: ["capacity_gb", "form_factor", "interface", "protocol", "pcie_generation"],
  PSU: [
    "rated_wattage",
    "efficiency_certification",
    "atx_standard_version",
    "form_factor",
    "length_mm",
    "connector_24pin_atx",
    "connector_eps_count",
    "connector_pcie_8pin",
    "connector_12vhpwr",
    "connector_sata",
    "modularity",
  ],
  CASE: [
    "max_gpu_length_mm",
    "max_gpu_thickness_slots",
    "max_cpu_cooler_height_mm",
    "psu_form_factor",
    "max_psu_length_mm",
  ],
  COOLER: [
    "cooling_type",
    "max_tdp_watts",
    "height_mm",
    "length_mm",
    "width_mm",
    "radiator_size_mm",
  ],
};

/**
 * Every key that has a label, derived FROM `ORDER` so a new fact cannot be
 * added to the display order and forgotten by the copy. The page turns this list
 * into a label map in one pass.
 */
export const SPEC_LABEL_KEYS: readonly string[] = Array.from(
  new Set(Object.values(ORDER).flat()),
);

/** The words this module needs that are not symbols. */
export interface SpecCopy {
  /** `specs.<key>` for every `SPEC_LABEL_KEYS` entry. */
  labels: Record<string, string>;
  units: { slots: string; gb: string };
  yes: string;
  no: string;
}

export interface SpecRow {
  key: string;
  label: string;
  value: string;
}

/** Keys that name another row or a moment, never a property of this product. */
function isReference(key: string): boolean {
  return key.endsWith("_id") || key === "created_at" || key === "updated_at";
}

/**
 * The unit a key's number is expressed in, as a suffix — or null when the number
 * is a count (modules, slots, ports, channels).
 *
 * Suffix rules rather than a per-key table: every column in the eight spec tables
 * is already named for its unit, so the rule is the data's own naming, and a new
 * `..._mm` column lands formatted without touching this module.
 */
function unitOf(key: string, copy: SpecCopy): string | null {
  if (key.endsWith("_watts") || key === "rated_wattage") return "W";
  if (key.endsWith("_mm")) return "mm";
  if (key.endsWith("_mtps")) return "MT/s";
  if (key.endsWith("_mhz")) return "MHz";
  if (key === "voltage_v") return "V";
  if (key === "width_slots" || key === "max_gpu_thickness_slots") return copy.units.slots;
  if (key.endsWith("_gb")) return copy.units.gb;
  return null;
}

/** `board_tgp_watts` -> `Board tgp watts`: the copy gap, said out loud. */
function humanize(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * One value as text, or null when there is nothing truthful to draw.
 *
 * Objects and arrays are flattened into `key value` pairs: `required_power_connectors`
 * is a jsonb map, and dropping it because it is not a scalar would hide a fact
 * the compatibility rules actually use.
 */
function renderValue(value: unknown, key: string, locale: AppLocale, copy: SpecCopy): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const unit = unitOf(key, copy);
    // `formatNumber` rounds to whole numbers by default, which is right for
    // watts and cores and WRONG for a slot width of 3.5 — a specification that
    // silently becomes 4 is the rounding bug this module exists to avoid.
    const number = Number.isInteger(value)
      ? formatNumber(value, locale)
      : formatNumber(value, locale, { maximumFractionDigits: 2 });
    return unit === null ? number : `${number} ${unit}`;
  }
  if (typeof value === "boolean") return value ? copy.yes : copy.no;
  if (typeof value === "string") return value.trim() === "" ? null : value;

  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => renderValue(entry, key, locale, copy))
      .filter((part): part is string => part !== null);
    return parts.length === 0 ? null : parts.join(", ");
  }
  if (typeof value === "object") {
    const parts: string[] = [];
    for (const [innerKey, innerValue] of Object.entries(value as Record<string, unknown>)) {
      if (isReference(innerKey)) continue;
      const rendered = renderValue(innerValue, innerKey, locale, copy);
      if (rendered !== null) parts.push(`${humanize(innerKey)} ${rendered}`);
    }
    return parts.length === 0 ? null : parts.join(" · ");
  }
  return null;
}

/**
 * The rows for one product's spec object, in display order.
 *
 * `category` decides the curated order; a category this module does not know
 * falls back to the data's own key order, so a new category still renders.
 */
export function presentSpecs(
  product: Pick<CatalogProductResponse, "category" | "specs">,
  locale: AppLocale,
  copy: SpecCopy,
): SpecRow[] {
  const specs = product.specs;
  const ordered = ORDER[product.category] ?? [];
  const seen = new Set<string>();
  const rows: SpecRow[] = [];

  const push = (key: string) => {
    if (seen.has(key) || isReference(key)) return;
    seen.add(key);
    const value = renderValue(specs[key], key, locale, copy);
    if (value === null) return;
    rows.push({ key, label: copy.labels[key] ?? humanize(key), value });
  };

  for (const key of ordered) push(key);
  // Anything the curated list did not name, in the object's own order.
  for (const key of Object.keys(specs)) push(key);

  return rows;
}
