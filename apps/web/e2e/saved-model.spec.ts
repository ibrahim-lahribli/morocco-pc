/**
 * apps/web/e2e/saved-model.spec.ts — the saved-builds store, without a browser.
 *
 * `lib/saved/builds.ts` is where the shelf's rules live — what a stored string
 * is allowed to mean, what one entry's identity is, what a refused write reports
 * — so it is tested directly, the way `result-model.spec.ts` tests the card's
 * decisions. The browser half (island, hydration, reload) is `saved.spec.ts`.
 *
 * Every storage here is a FAKE: the module takes the two `Storage` methods it
 * needs, so a quota refusal and a blocked getter are one object literal each,
 * and no test has to break a real browser to prove what happens when it breaks.
 */

import { test, expect } from "@playwright/test";

import {
  MAX_SAVED_BUILDS,
  SAVED_BUILDS_KEY,
  isSavedIn,
  parseSaved,
  readSaved,
  savedKey,
  withSaved,
  withoutSaved,
  writeSaved,
  type SavedBuild,
  type StorageLike,
} from "../lib/saved/builds";

/** A `Storage` that holds one string, and can be told to fail. */
function fakeStorage(
  options: { initial?: string | null; failGet?: unknown; failSet?: unknown } = {},
): StorageLike & { value: string | null; writes: number } {
  const store = {
    value: options.initial ?? null,
    writes: 0,
    getItem(key: string): string | null {
      if (options.failGet !== undefined) throw options.failGet;
      return key === SAVED_BUILDS_KEY ? store.value : null;
    },
    setItem(key: string, value: string): void {
      if (options.failSet !== undefined) throw options.failSet;
      if (key !== SAVED_BUILDS_KEY) throw new Error(`unexpected key ${key}`);
      store.writes += 1;
      store.value = value;
    },
  };
  return store;
}

function entry(overrides: Partial<SavedBuild> = {}): SavedBuild {
  return {
    id: "3f5a1c7e-8b2d-4e6f-9a01-5c3d7e9f1a2b",
    rank: 1,
    strategyKey: "BALANCED",
    totalPrice: 7677,
    savedAt: "2026-10-22T18:00:00.000Z",
    ...overrides,
  };
}

const encode = (entries: unknown): string => JSON.stringify(entries);

test("nothing stored is nothing saved — and garbage is not a crash", () => {
  expect(parseSaved(null)).toEqual([]);
  expect(parseSaved("")).toEqual([]);
  expect(parseSaved("not json at all")).toEqual([]);
  // Valid JSON of the wrong SHAPE is still an unreadable shelf.
  expect(parseSaved('{"entries":[]}')).toEqual([]);
  expect(parseSaved('"a string"')).toEqual([]);
});

test("a damaged entry is dropped and its neighbours survive", () => {
  const good = entry();
  const raw = encode([
    good,
    null,
    { id: "", rank: 1, strategyKey: "BALANCED", totalPrice: 1, savedAt: "x" },
    { id: "abc", rank: 0, strategyKey: "BALANCED", totalPrice: 1, savedAt: "x" },
    { id: "abc", rank: 1.5, strategyKey: "BALANCED", totalPrice: 1, savedAt: "x" },
    { id: "abc", rank: 1, strategyKey: "BALANCED", totalPrice: "7677", savedAt: "x" },
    { id: "abc", rank: 1, strategyKey: "BALANCED", totalPrice: 1 },
    entry({ id: "3f5a1c7e-8b2d-4e6f-9a01-5c3d7e9f1a2c", rank: 2 }),
  ]);

  const parsed = parseSaved(raw);
  expect(parsed).toHaveLength(2);
  expect(parsed[0]).toEqual(good);
  expect(parsed[1]!.rank).toBe(2);
});

test("an entry whose date cannot be formatted is dropped, not rendered", () => {
  // The page prints `savedAt` through `formatDate`, which THROWS
  // `RangeError: Invalid time value` on an invalid Date. A stored garbage
  // timestamp must therefore cost that ONE record: keeping it would blank the
  // shelf that per-entry validation exists to protect.
  const raw = encode([
    entry({ rank: 1 }),
    entry({ rank: 2, savedAt: "not-a-date" }),
    entry({ rank: 3, savedAt: "2026-13-45" }),
    entry({ rank: 4, savedAt: "" }),
  ]);
  expect(parseSaved(raw).map((item) => item.rank)).toEqual([1]);
});

test("one build of one result is one entry, and re-saving moves it to the front", () => {
  expect(savedKey(entry())).toBe("3f5a1c7e-8b2d-4e6f-9a01-5c3d7e9f1a2b#1");

  const first = entry({ savedAt: "2026-10-22T18:00:00.000Z" });
  const second = entry({ id: "1d9e4b2c-6a3f-4c5d-8e7f-2b0a9c8d7e6f" });
  const shelf = withSaved(withSaved([], first), second);
  expect(shelf.map(savedKey)).toEqual([savedKey(second), savedKey(first)]);

  const again = entry({ savedAt: "2026-10-23T09:00:00.000Z" });
  const resaved = withSaved(shelf, again);
  expect(resaved).toHaveLength(2);
  expect(resaved[0]).toEqual(again);
  expect(isSavedIn(resaved, first)).toBe(true);
});

test("the shelf is capped, and the cap drops the OLDEST entry", () => {
  let shelf: SavedBuild[] = [];
  for (let rank = 1; rank <= MAX_SAVED_BUILDS + 5; rank += 1) {
    shelf = withSaved(shelf, entry({ rank }));
  }
  expect(shelf).toHaveLength(MAX_SAVED_BUILDS);
  expect(shelf[0]!.rank).toBe(MAX_SAVED_BUILDS + 5);
  expect(shelf.at(-1)!.rank).toBe(6);
});

test("a stored string longer than the cap is capped on READ too", () => {
  const oversized = Array.from({ length: MAX_SAVED_BUILDS + 10 }, (_, index) =>
    entry({ rank: index + 1 }),
  );
  expect(parseSaved(encode(oversized))).toHaveLength(MAX_SAVED_BUILDS);
});

test("removing one entry leaves the others, and removes nothing else", () => {
  const one = entry({ rank: 1 });
  const two = entry({ rank: 2 });
  const other = entry({ id: "another-result", rank: 1 });
  const shelf = [one, two, other];

  const left = withoutSaved(shelf, { id: one.id, rank: one.rank });
  expect(left.map(savedKey)).toEqual([savedKey(two), savedKey(other)]);
  expect(isSavedIn(left, one)).toBe(false);
  // A different rank of the same result is a different entry.
  expect(isSavedIn(left, { id: one.id, rank: 2 })).toBe(true);
});

test("a write that works replaces the stored string and reports what it holds", () => {
  const storage = fakeStorage();
  const shelf = [entry()];
  const outcome = writeSaved(storage, shelf);
  expect(outcome).toEqual({ kind: "ok", entries: shelf });
  expect(storage.writes).toBe(1);
  expect(readSaved(storage)).toEqual({ entries: shelf, unavailable: false });
});

test("a full device is 'full', and the old shelf is left alone", () => {
  const before = encode([entry({ rank: 9 })]);
  const storage = fakeStorage({
    initial: before,
    failSet: { name: "QuotaExceededError", message: "no room" },
  });

  expect(writeSaved(storage, [entry()])).toEqual({ kind: "full" });
  expect(storage.value).toBe(before);
});

test("any other refusal is 'unavailable', not 'full'", () => {
  const storage = fakeStorage({ failSet: new Error("SecurityError: blocked") });
  expect(writeSaved(storage, [entry()])).toEqual({ kind: "unavailable" });
});

test("no store at all is 'unavailable' — never an empty shelf that looks real", () => {
  expect(readSaved(null)).toEqual({ entries: [], unavailable: true });
  expect(writeSaved(null, [entry()])).toEqual({ kind: "unavailable" });
});

test("a getter that throws is 'unavailable' too", () => {
  const storage = fakeStorage({ failGet: new Error("SecurityError: denied") });
  expect(readSaved(storage)).toEqual({ entries: [], unavailable: true });
});
