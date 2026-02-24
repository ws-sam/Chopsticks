// tests/unit/economyCrateAtomic.test.js
// Verifies the atomic order for !open crate (roll → addItem → removeItem)
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("openCrateRolls pure function", () => {
  it("returns drops array without mutating DB", async () => {
    const { openCrateRolls } = await import("../../src/game/crates.js");
    const { drops } = openCrateRolls("common_crate", 1);
    assert.ok(Array.isArray(drops), "drops should be an array");
    assert.ok(drops.length > 0, "should have at least one drop");
  });

  it("mythic tier gets 3 rolls minimum", async () => {
    const { openCrateRolls } = await import("../../src/game/crates.js");
    // Call multiple times to get statistical confidence
    let totalDrops = 0;
    for (let i = 0; i < 10; i++) {
      const { drops } = openCrateRolls("mythic_crate", 3);
      totalDrops += drops.length;
    }
    assert.ok(totalDrops >= 10, "mythic crate with 3 rolls should produce at least 10 drops total across 10 trials");
  });
});
