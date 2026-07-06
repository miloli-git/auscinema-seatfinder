import { describe, expect, it } from "vitest";
import { BLOCK_PALETTE, blockTextColor, blockTokenFor } from "./palette";

describe("blockTokenFor", () => {
  it("is deterministic for the same key", () => {
    expect(blockTokenFor("dune: part two")).toBe(blockTokenFor("dune: part two"));
  });

  it("always returns one of the 8 SOH block tokens", () => {
    for (const key of ["a", "the odyssey", "dune: part two", "", "zzz"]) {
      expect(BLOCK_PALETTE).toContain(blockTokenFor(key));
    }
  });

  it("distributes across different keys (not a constant)", () => {
    const tokens = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map(blockTokenFor));
    expect(tokens.size).toBeGreaterThan(1);
  });
});

describe("blockTextColor", () => {
  it("is ink on mustard, white on every other block colour (design brief's explicit exception)", () => {
    expect(blockTextColor("--block-mustard")).toBe("ink");
    for (const token of BLOCK_PALETTE) {
      if (token === "--block-mustard") continue;
      expect(blockTextColor(token)).toBe("white");
    }
  });
});
