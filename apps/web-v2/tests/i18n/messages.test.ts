import { describe, expect, it } from "vitest";

import ar from "@/messages/ar.json";
import fr from "@/messages/fr.json";

/** Flatten a nested dictionary into dot-separated leaves. */
function flatten(value: unknown, prefix = ""): Map<string, string> {
  const leaves = new Map<string, string>();

  if (typeof value === "string") {
    leaves.set(prefix, value);
    return leaves;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      for (const [childPath, childValue] of flatten(child, path)) {
        leaves.set(childPath, childValue);
      }
    }
  }

  return leaves;
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "").sort();
}

const french = flatten(fr);
const arabic = flatten(ar);

describe("translation dictionaries", () => {
  it("define the same keys in French and Arabic", () => {
    expect([...arabic.keys()].sort()).toEqual([...french.keys()].sort());
  });

  it("never ship an empty message", () => {
    for (const [key, value] of [...french, ...arabic]) {
      expect(value.trim(), `${key} is empty`).not.toBe("");
    }
  });

  it("use the same interpolation placeholders in both locales", () => {
    for (const [key, value] of french) {
      expect(placeholders(arabic.get(key) ?? ""), `${key} placeholders differ`).toEqual(
        placeholders(value),
      );
    }
  });
});
