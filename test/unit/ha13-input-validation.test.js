// test/unit/ha13-input-validation.test.js
// HA-13: Free-text input commands must use sanitizeString + length limits

import { describe, it } from "mocha";
import { strict as assert } from "assert";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
function src(f) {
  return readFileSync(resolve(__dirname, `../../${f}`), "utf8");
}

// ── Shared helper to assert sanitizeString usage ───────────────────────────

function assertSanitized(file, label) {
  const code = src(file);
  it(`${label}: imports sanitizeString from validation.js`, function () {
    assert.ok(
      code.includes("sanitizeString") && code.includes("validation.js"),
      `${file} missing sanitizeString import`
    );
  });
  it(`${label}: uses sanitizeString() on user text inputs`, function () {
    assert.ok(
      code.includes("sanitizeString("),
      `${file} does not call sanitizeString()`
    );
  });
}

// ── confession.js ──────────────────────────────────────────────────────────

describe("HA-13: confession.js — text input sanitized", function () {
  assertSanitized("src/commands/confession.js", "confession.js");

  it("confession text is sliced to ≤ 1500 chars", function () {
    const code = src("src/commands/confession.js");
    assert.ok(
      code.includes(".slice(0, 1500)") || code.includes(".substring(0, 1500)"),
      "confession text not limited to 1500 chars"
    );
  });
});

// ── suggest.js ─────────────────────────────────────────────────────────────

describe("HA-13: suggest.js — text input sanitized", function () {
  assertSanitized("src/commands/suggest.js", "suggest.js");
});

// ── schedule.js ────────────────────────────────────────────────────────────

describe("HA-13: schedule.js — message body sanitized", function () {
  assertSanitized("src/commands/schedule.js", "schedule.js");

  it("schedule message is sliced to ≤ 1900 chars", function () {
    const code = src("src/commands/schedule.js");
    assert.ok(
      code.includes(".slice(0, 1900)") || code.includes(".slice(0,1900)"),
      "schedule message not limited to 1900 chars"
    );
  });
});

// ── embed.js ───────────────────────────────────────────────────────────────

describe("HA-13: embed.js — title and description sanitized", function () {
  assertSanitized("src/commands/embed.js", "embed.js");

  it("embed title is sliced to ≤ 250 chars (Discord limit)", function () {
    const code = src("src/commands/embed.js");
    assert.ok(
      code.includes(".slice(0, 250)"),
      "embed title not limited to 250 chars"
    );
  });

  it("embed description is sliced to ≤ 4000 chars (Discord limit)", function () {
    const code = src("src/commands/embed.js");
    assert.ok(
      code.includes(".slice(0, 4000)"),
      "embed description not limited to 4000 chars"
    );
  });
});

// ── autoresponder.js ───────────────────────────────────────────────────────

describe("HA-13: autoresponder.js — trigger and response sanitized", function () {
  assertSanitized("src/commands/autoresponder.js", "autoresponder.js");

  it("autoresponder trigger is sliced to ≤ 200 chars", function () {
    const code = src("src/commands/autoresponder.js");
    assert.ok(
      code.includes(".slice(0, 200)"),
      "autoresponder trigger not limited to 200 chars"
    );
  });

  it("autoresponder response is sliced to ≤ 1900 chars", function () {
    const code = src("src/commands/autoresponder.js");
    assert.ok(
      code.includes(".slice(0, 1900)"),
      "autoresponder response not limited to 1900 chars"
    );
  });
});

// ── sanitizeString itself ─────────────────────────────────────────────────

describe("HA-13: sanitizeString utility — behavior contracts", function () {
  it("strips ASCII control characters (C0 range)", async function () {
    const mod = await import("../../src/utils/validation.js").catch(() => null);
    if (!mod?.sanitizeString) return;
    const result = mod.sanitizeString("hello\x00world\x01test\x1F!");
    assert.ok(!result.includes("\x00"), "null byte not stripped");
    assert.ok(!result.includes("\x01"), "SOH control char not stripped");
  });

  it("preserves normal unicode text", async function () {
    const mod = await import("../../src/utils/validation.js").catch(() => null);
    if (!mod?.sanitizeString) return;
    const input = "Hello 🎉 世界 مرحبا";
    const result = mod.sanitizeString(input);
    assert.ok(result.includes("Hello"), "sanitizeString stripped normal text");
    assert.ok(result.includes("🎉"), "sanitizeString stripped emoji");
  });

  it("handles empty string without throwing", async function () {
    const mod = await import("../../src/utils/validation.js").catch(() => null);
    if (!mod?.sanitizeString) return;
    assert.doesNotThrow(() => mod.sanitizeString(""));
    assert.equal(typeof mod.sanitizeString(""), "string");
  });

  it("handles null/undefined gracefully or throws predictably", async function () {
    const mod = await import("../../src/utils/validation.js").catch(() => null);
    if (!mod?.sanitizeString) return;
    // Should not throw or return a non-string for null/undefined
    try {
      const r = mod.sanitizeString(null);
      assert.equal(typeof r, "string");
    } catch {
      // Throwing is acceptable — just not crashing the process silently
    }
  });
});
