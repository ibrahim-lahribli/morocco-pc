/**
 * Compact component specifications for the homepage cards.
 *
 * A card has one line for four components, so the marketing name the catalog
 * carries is too long: `CORSAIR VENGEANCE LPX DDR4 3600MHz 16GB 2x8 CL18` says
 * nothing a shopper compares at a glance that `16 Go DDR4` does not. This module
 * rewrites a name into the few tokens that ARE comparable, and nothing else.
 *
 * Two rules hold it together:
 *
 * - **Never invent.** Every token in the result is present in the input. A name
 *   whose capacity, generation or type is not stated loses that token rather
 *   than gaining a guess, and a name that yields no token at all is returned
 *   trimmed — the real string beats a placeholder.
 * - **No locale strings.** Units arrive in `SpecUnits`, so the caller decides
 *   `Go`/`To` or `GB`/`TB` exactly like `formatPrice` takes its currency symbol
 *   from messages. `Price.currency` is the precedent.
 */

/** The two capacity units a compact spec can print, already localized. */
export interface SpecUnits {
  gb: string;
  tb: string;
}

/** `16GB`, `16 GB`, `1 To`, `1,5 TB` -> the number and its unit family. */
const CAPACITY = /(\d+(?:[.,]\d+)?)\s*(gb|go|tb|to)\b/i;

/**
 * Brands that carry no comparison value on a card line. A model identifier is
 * what a shopper compares (`990 Pro`, `RTX 4060`), the brand is not.
 */
const VENDORS = [
  "amd",
  "intel",
  "nvidia",
  "asus",
  "msi",
  "gigabyte",
  "corsair",
  "kingston",
  "crucial",
  "samsung",
  "western digital",
  "wd",
  "seagate",
  "toshiba",
  "lexar",
  "adata",
  "teamgroup",
  "team",
  "sandisk",
  "patriot",
  "g.skill",
  "be quiet!",
  "coolermaster",
  "deepcool",
] as const;

/** Drop a vendor prefix and a trailing parenthetical spec sheet. */
function core(name: string): string {
  const cleaned = name
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const lower = cleaned.toLowerCase();

  for (const vendor of VENDORS) {
    const next = cleaned.charAt(vendor.length);
    if (lower.startsWith(vendor) && (next === "" || /\s/.test(next))) {
      return cleaned.slice(vendor.length).trim();
    }
  }
  return cleaned;
}

/** `16 GB`, `16GB`, `1 To` -> `16 Go` / `1 To` in the caller's units. */
function formatCapacity(name: string, units: SpecUnits): string | null {
  const match = CAPACITY.exec(name);
  const number = match?.[1];
  const token = match?.[2];
  if (number === undefined || token === undefined) return null;
  return `${number} ${/tb|to/i.test(token) ? units.tb : units.gb}`;
}

/**
 * CPU: the family and model identifier, vendor and spec sheet removed.
 * `AMD Ryzen 5 5600` -> `Ryzen 5 5600`, `Intel Core i7-12700KF` -> `Core i7-12700KF`.
 */
export function compactCpu(name: string): string {
  return core(name);
}

/** The suffix spellings the market uses. */
const SUFFIX: Record<string, string> = { ti: "Ti", super: "Super", xt: "XT" };

/**
 * GPU: the board family, its model number and — only when the name states it —
 * the VRAM. Vendor and product-line marketing (`PRIME`, `TUF`, `GAMING OC`) are
 * not comparable across brands, so they go.
 */
export function compactGpu(name: string, units: SpecUnits): string {
  const nvidiaAmd =
    /\b(?:geforce\s+)?(rtx|gtx)\s*(\d{3,4})\s*(ti|super)?\b/i.exec(name) ??
    /\b(?:radeon\s+)?(rx|gx)\s*(\d{3,4})\s*(xt)?\b/i.exec(name);
  const arc = /\barc\s+(a\d{3}|b\d{3})\b/i.exec(name);

  let model: string;
  if (nvidiaAmd !== null && nvidiaAmd[1] !== undefined && nvidiaAmd[2] !== undefined) {
    const suffix = nvidiaAmd[3] === undefined ? "" : (SUFFIX[nvidiaAmd[3].toLowerCase()] ?? "");
    model = `${nvidiaAmd[1].toUpperCase()} ${nvidiaAmd[2]}${suffix === "" ? "" : ` ${suffix}`}`;
  } else if (arc?.[1] !== undefined) {
    model = `Arc ${arc[1].toUpperCase()}`;
  } else {
    return core(name);
  }

  const vram = formatCapacity(name, units);
  return vram === null ? model : `${model} ${vram}`;
}

/**
 * RAM: capacity and DDR generation. Frequency, timings, kit size and the product
 * line are left for the full configuration view.
 */
export function compactRam(name: string, units: SpecUnits): string {
  const capacity = formatCapacity(name, units);
  const ddr = /\b(ddr\d(?:x\d?)?)\b/i.exec(name)?.[1]?.toUpperCase() ?? null;

  if (capacity === null) return ddr ?? core(name);
  return ddr === null ? capacity : `${capacity} ${ddr}`;
}

/** The interface spellings the market uses. */
const STORAGE_TYPE: Record<string, string> = {
  nvme: "NVMe",
  m2: "M.2",
  sata: "SATA",
  ssd: "SSD",
  hdd: "HDD",
};

/**
 * Storage: capacity and, when the name states one, the interface. A name that
 * states no interface keeps its model so the line still says what the drive is
 * (`Samsung 990 Pro 2TB` -> `990 Pro 2 To`).
 */
export function compactStorage(name: string, units: SpecUnits): string {
  const capacity = formatCapacity(name, units);
  if (capacity === null) return core(name);

  const token = /\b(nvme|m\.?2|sata|ssd|hdd)\b/i.exec(name)?.[1]?.toLowerCase().replace(".", "");
  const type = token === undefined ? undefined : STORAGE_TYPE[token];
  if (type === undefined) {
    const model = core(name).replace(CAPACITY, "").replace(/\s+/g, " ").trim();
    return model === "" ? capacity : `${model} ${capacity}`;
  }
  return `${capacity} ${type}`;
}

/**
 * The compact form of one component, or `""` when there is nothing honest to
 * say. Roles outside the four the card shows are ignored by its caller.
 */
export function compactSpec(role: string, name: string, units: SpecUnits): string {
  const trimmed = name.trim();
  if (trimmed === "") return "";

  switch (role) {
    case "CPU":
      return compactCpu(trimmed);
    case "GPU":
      return compactGpu(trimmed, units);
    case "RAM":
      return compactRam(trimmed, units);
    case "SSD_BOOT":
    case "SSD_STORAGE":
    case "HDD":
      return compactStorage(trimmed, units);
    default:
      return core(trimmed);
  }
}
