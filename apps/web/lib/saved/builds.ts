/**
 * lib/saved/builds.ts — saved builds, in this browser and nowhere else (S25).
 *
 * ## What an "enregistrement" IS
 *
 * A REFERENCE plus the few facts the list needs to be readable: which result the
 * build came from, its engine rank, its strategy key, the total the page showed,
 * and when this device saved it. It is deliberately NOT a copy of the build —
 * components, prices and explanation stay on the result page, which is the one
 * place they are rendered from the API. A second copy here would be a second
 * source of truth for a price, and the first stale one would be a lie the badge
 * cannot correct.
 *
 * The consequence is stated in the copy: opening an entry is a LINK to
 * `/config/[id]`, and a result the API no longer serves is answered by that
 * page's own error state rather than by an invented list of components.
 *
 * ## No account, no server, no migration
 *
 * `localStorage` is the whole store. It is per browser profile and per origin,
 * it is readable by this page alone, and nothing about it leaves the device. The
 * key carries a `:v1` suffix so a future shape can be told apart from this one
 * instead of being guessed at; `parseSaved()` is already tolerant, so an older
 * entry is dropped rather than crashing the page.
 *
 * ## Three ways the store can refuse, and why each has its own outcome
 *
 *   - **unavailable** — this browser denies access entirely (private mode, a
 *     blocked-cookie policy, a `window.localStorage` getter that throws). Nothing
 *     is stored and nothing is claimed to be.
 *   - **full** — `setItem` raised `QuotaExceededError`. The device has no room
 *     for one more entry; the copy tells the reader to remove one instead of
 *     pretending the save worked.
 *   - **corrupt** — the stored string is not the array this module writes. The
 *     parse drops what it cannot validate (per entry, not wholesale) and the list
 *     renders what survived.
 *
 * A failed `setItem` leaves the PREVIOUS value in place, so an outcome of
 * `full` / `unavailable` means "the store still holds what it held before".
 *
 * ## Why the snapshot is cached
 *
 * `useSyncExternalStore` compares snapshots by identity, so a getter that
 * `JSON.parse`s on every read would re-render forever. `savedSnapshot()` keeps
 * the last parsed result keyed by the RAW string it came from: a write changes
 * the string, and only then is the parse repeated. The server snapshot is a
 * frozen constant, which is what makes the first client render match the SSR'd
 * one (the empty state) instead of hydrating a mismatch.
 *
 * The clock is NOT read here: `savedAt` arrives from the click handler, so this
 * module stays deterministic and testable, and no render ever depends on "now".
 */

/** The one key this app writes. Versioned: a future shape gets a new one. */
export const SAVED_BUILDS_KEY = "morocco-pc:saved-builds:v1";

/**
 * The cap. Entries are the newest first, so the cap only ever drops the oldest —
 * and it is small on purpose: this is a shelf, not an archive, and it keeps the
 * stored string far below any quota.
 */
export const MAX_SAVED_BUILDS = 20;

/** One saved build. Everything here is a fact the page showed, or an address. */
export interface SavedBuild {
  /** The recommendation id — the result page this entry opens. */
  id: string;
  /** The engine's rank for that build (Decision 41), never a position. */
  rank: number;
  /** The strategy key as `strategyLabel()` normalises it (PERFORMANCE | ...). */
  strategyKey: string;
  /** The total the page showed, or null: NULL is not 0, and 0 is not unknown. */
  totalPrice: number | null;
  /** ISO timestamp of the moment this device saved it. */
  savedAt: string;
}

/** The slice of `Storage` this module needs, so a spec can pass a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The identity of an entry: one build of one result. A re-save updates that
 * entry (and moves it to the front) rather than adding a duplicate, which is
 * what keeps the shelf readable when the same card is saved twice.
 */
export function savedKey(entry: Pick<SavedBuild, "id" | "rank">): string {
  return `${entry.id}#${entry.rank}`;
}

function isSavedBuild(value: unknown): value is SavedBuild {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    typeof entry.rank === "number" &&
    Number.isInteger(entry.rank) &&
    entry.rank >= 1 &&
    typeof entry.strategyKey === "string" &&
    (entry.totalPrice === null ||
      (typeof entry.totalPrice === "number" && Number.isFinite(entry.totalPrice))) &&
    // A timestamp the page cannot FORMAT is not an entry. `formatDate` throws
    // `RangeError: Invalid time value` on an invalid `Date`, so a stored
    // "savedAt": "x" would take the whole shelf down instead of costing one
    // record — the per-entry validation exists precisely to make that impossible.
    typeof entry.savedAt === "string" &&
    Number.isFinite(Date.parse(entry.savedAt))
  );
}

/**
 * The stored string, as entries. Never throws: a corrupt value is an empty (or
 * partially filled) shelf, and the page says what it can.
 *
 * Validation is per ENTRY, so one damaged record does not cost the others.
 * Duplicates are collapsed and the cap is applied on read as well as on write,
 * because the string may have been written by another tab or an older build.
 */
export function parseSaved(raw: string | null): SavedBuild[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const entries: SavedBuild[] = [];
  for (const item of parsed) {
    if (!isSavedBuild(item)) continue;
    const key = savedKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(item);
    if (entries.length >= MAX_SAVED_BUILDS) break;
  }
  return entries;
}

/** Is this build already on the shelf? */
export function isSavedIn(
  entries: readonly SavedBuild[],
  entry: Pick<SavedBuild, "id" | "rank">,
): boolean {
  const key = savedKey(entry);
  return entries.some((candidate) => savedKey(candidate) === key);
}

/** The shelf without this build. */
export function withoutSaved(
  entries: readonly SavedBuild[],
  entry: Pick<SavedBuild, "id" | "rank">,
): SavedBuild[] {
  const key = savedKey(entry);
  return entries.filter((candidate) => savedKey(candidate) !== key);
}

/**
 * The shelf with this build at the front. Newest first, one entry per
 * (result, rank), and never longer than the cap.
 */
export function withSaved(entries: readonly SavedBuild[], entry: SavedBuild): SavedBuild[] {
  return [entry, ...withoutSaved(entries, entry)].slice(0, MAX_SAVED_BUILDS);
}

/** What a read found, and whether the store could be read at all. */
export interface SavedRead {
  entries: SavedBuild[];
  /** The store refused access (private mode, blocked storage). Not "empty". */
  unavailable: boolean;
}

/** What a write did. `ok` carries the list the store now holds. */
export type SavedWrite =
  | { kind: "ok"; entries: SavedBuild[] }
  | { kind: "full" }
  | { kind: "unavailable" };

function isQuotaError(error: unknown): boolean {
  // Browsers disagree on the name across engines and eras, and a `DOMException`
  // is not always an `instanceof` the global one (an iframe's realm has its own).
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED";
}

/** The shelf as stored, or `unavailable` when the store cannot be read. */
export function readSaved(storage: StorageLike | null): SavedRead {
  if (storage === null) return { entries: [], unavailable: true };
  let raw: string | null;
  try {
    raw = storage.getItem(SAVED_BUILDS_KEY);
  } catch {
    return { entries: [], unavailable: true };
  }
  return { entries: parseSaved(raw), unavailable: false };
}

/**
 * Replace the shelf. Returns what happened rather than throwing, because every
 * caller is a click handler that has to say something to the reader.
 */
export function writeSaved(
  storage: StorageLike | null,
  entries: readonly SavedBuild[],
): SavedWrite {
  if (storage === null) return { kind: "unavailable" };
  const list = entries.slice(0, MAX_SAVED_BUILDS);
  try {
    storage.setItem(SAVED_BUILDS_KEY, JSON.stringify(list));
  } catch (error) {
    return isQuotaError(error) ? { kind: "full" } : { kind: "unavailable" };
  }
  return { kind: "ok", entries: list };
}

/* ---------------------------------------------------------------- browser -- */

/**
 * `window.localStorage`, or null when this browser will not give it to us.
 *
 * The GETTER itself can throw (a blocked-cookie policy does exactly that), so the
 * access is inside the try — a `typeof window.localStorage !== "undefined"` check
 * would have thrown before it could answer.
 */
export function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The frozen server snapshot: the empty shelf, which is a true statement. */
const EMPTY_READ: SavedRead = { entries: [], unavailable: false };
const UNAVAILABLE_READ: SavedRead = { entries: [], unavailable: true };

let cachedRaw: string | null | undefined;
let cachedRead: SavedRead = EMPTY_READ;

/**
 * The client snapshot, cached by raw string so its IDENTITY is stable between
 * writes — the requirement `useSyncExternalStore` puts on a getter.
 */
export function savedSnapshot(): SavedRead {
  const storage = browserStorage();
  if (storage === null) return UNAVAILABLE_READ;
  let raw: string | null;
  try {
    raw = storage.getItem(SAVED_BUILDS_KEY);
  } catch {
    return UNAVAILABLE_READ;
  }
  if (cachedRaw === raw) return cachedRead;
  cachedRaw = raw;
  cachedRead = { entries: parseSaved(raw), unavailable: false };
  return cachedRead;
}

/** The server snapshot MUST be the same object every render, or React loops. */
export function savedServerSnapshot(): SavedRead {
  return EMPTY_READ;
}

const listeners = new Set<() => void>();

/**
 * Re-render every island on a change. The `storage` event covers the OTHER
 * tabs; `notifySaved` covers this one, where no event is emitted by spec.
 * The key is not filtered: the snapshot compares raw strings, so an unrelated
 * write re-reads once and yields the same object.
 */
export function subscribeSaved(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function notifySaved(): void {
  for (const listener of listeners) listener();
}

/** Put one build on the shelf (or move it to the front), and tell the page. */
export function saveBuild(entry: SavedBuild): SavedWrite {
  const read = readSaved(browserStorage());
  const outcome = writeSaved(browserStorage(), withSaved(read.entries, entry));
  if (outcome.kind === "ok") notifySaved();
  return outcome;
}

/** Take one build off the shelf, and tell the page. */
export function removeSaved(entry: Pick<SavedBuild, "id" | "rank">): SavedWrite {
  const read = readSaved(browserStorage());
  const outcome = writeSaved(browserStorage(), withoutSaved(read.entries, entry));
  if (outcome.kind === "ok") notifySaved();
  return outcome;
}
