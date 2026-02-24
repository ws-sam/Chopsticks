// tests/unit/prefixBurstLimit.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("checkRateLimit utility", () => {
  it("exports checkRateLimit function", async () => {
    // Just verify the module loads — actual Redis needed for integration test
    const mod = await import("../../src/utils/ratelimit.js");
    assert.equal(typeof mod.checkRateLimit, "function", "checkRateLimit should be a function");
  });
});
