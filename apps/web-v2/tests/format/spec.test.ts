import { describe, expect, it } from "vitest";

import {
  compactCpu,
  compactGpu,
  compactRam,
  compactSpec,
  compactStorage,
  type SpecUnits,
} from "@/lib/format/spec";

/** The French units the homepage cards pass in. */
const UNITS: SpecUnits = { gb: "Go", tb: "To" };

describe("compactCpu", () => {
  it("drops the vendor and keeps the family and model identifier", () => {
    expect(compactCpu("AMD Ryzen 5 5600")).toBe("Ryzen 5 5600");
    expect(compactCpu("Intel Core i7-12700KF")).toBe("Core i7-12700KF");
  });

  it("leaves a name that carries no vendor prefix alone", () => {
    expect(compactCpu("Ryzen 5 7500F")).toBe("Ryzen 5 7500F");
  });

  it("drops a trailing spec sheet in parentheses", () => {
    expect(compactCpu("AMD Ryzen 5 5600G (6 cœurs, 12 threads, 3,9 GHz)")).toBe("Ryzen 5 5600G");
  });
});

describe("compactGpu", () => {
  it("keeps the family and model and drops vendor marketing", () => {
    expect(compactGpu("NVIDIA GeForce RTX 4060", UNITS)).toBe("RTX 4060");
    expect(compactGpu("RTX 4060 8GB", UNITS)).toBe("RTX 4060 8 Go");
    expect(compactGpu("NVIDIA GeForce RTX 4060 Ti", UNITS)).toBe("RTX 4060 Ti");
  });

  it("keeps a VRAM the name states and never invents one it does not", () => {
    expect(compactGpu("ASUS GeForce RTX 5070 Ti 16 GB PRIME", UNITS)).toBe("RTX 5070 Ti 16 Go");
    expect(compactGpu("Intel Arc B580 12 GB", UNITS)).toBe("Arc B580 12 Go");
  });

  it("normalizes an already-compact name to the caller's units", () => {
    expect(compactGpu("RTX 4060 8 To", UNITS)).toBe("RTX 4060 8 To");
  });

  it("falls back to the real name when no known family is present", () => {
    expect(compactGpu("Some Board 8GB", UNITS)).toBe("Some Board 8GB");
  });
});

describe("compactRam", () => {
  it("keeps capacity and DDR generation only", () => {
    expect(compactRam("CORSAIR VENGEANCE LPX DDR4 3600MHz 16GB 2x8 CL18", UNITS)).toBe(
      "16 Go DDR4",
    );
    expect(compactRam("G.Skill Flare X5 32GB DDR5-6000", UNITS)).toBe("32 Go DDR5");
  });

  it("accepts a name already written in the display units", () => {
    expect(compactRam("32 Go DDR4", UNITS)).toBe("32 Go DDR4");
  });

  it("omits the generation, and the capacity, when the name does not state them", () => {
    expect(compactRam("Corsair Vengeance 16 Go", UNITS)).toBe("16 Go");
    expect(compactRam("DDR5 Memory Kit", UNITS)).toBe("DDR5");
  });
});

describe("compactStorage", () => {
  it("pairs capacity with the interface the name states", () => {
    expect(compactStorage("KINGSTON NV3 1TB NVMe PCIe 4.0", UNITS)).toBe("1 To NVMe");
    expect(compactStorage("NVMe 1 To", UNITS)).toBe("1 To NVMe");
  });

  it("keeps the model when the name states no interface", () => {
    expect(compactStorage("Samsung 990 Pro 2TB", UNITS)).toBe("990 Pro 2 To");
    expect(compactStorage("WD Blue SN580 1TB", UNITS)).toBe("Blue SN580 1 To");
  });

  it("never guesses an interface for a bare capacity", () => {
    expect(compactStorage("2TB", UNITS)).toBe("2 To");
  });
});

describe("compactSpec", () => {
  it("routes by role and returns nothing for a blank name", () => {
    expect(compactSpec("CPU", "AMD Ryzen 5 5600", UNITS)).toBe("Ryzen 5 5600");
    expect(compactSpec("GPU", "NVIDIA GeForce RTX 4060", UNITS)).toBe("RTX 4060");
    expect(compactSpec("RAM", "32 Go DDR4", UNITS)).toBe("32 Go DDR4");
    expect(compactSpec("SSD_BOOT", "NVMe 1 To", UNITS)).toBe("1 To NVMe");
    expect(compactSpec("CPU", "   ", UNITS)).toBe("");
  });

  it("prints the Arabic units when the caller asks for them", () => {
    const arabic: SpecUnits = { gb: "GB", tb: "TB" };
    expect(compactRam("CORSAIR VENGEANCE LPX DDR4 3600MHz 16GB 2x8 CL18", arabic)).toBe(
      "16 GB DDR4",
    );
    expect(compactStorage("Samsung 990 Pro 2TB", arabic)).toBe("990 Pro 2 TB");
  });
});
