// test/unit/ha1-timeout-coverage.test.js
// HA-1: Verify withTimeout is applied to the 6 high-priority commands
// and that pool name/description is sanitized in pools.js

import { describe, it } from "mocha";
import { strict as assert } from "assert";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../src/commands");

function src(name) {
  return readFileSync(resolve(root, `${name}.js`), "utf8");
}

// ── withTimeout coverage ──────────────────────────────────────────────────────

describe("HA-1: withTimeout coverage — 6 high-priority commands", function () {
  const targets = ["ai", "music", "agents", "giveaway", "mod", "assistant"];

  for (const cmd of targets) {
    it(`${cmd}.js imports withTimeout`, function () {
      const code = src(cmd);
      assert.ok(
        code.includes('from "../utils/interactionTimeout.js"'),
        `${cmd}.js missing withTimeout import`
      );
    });

    it(`${cmd}.js calls withTimeout inside execute`, function () {
      const code = src(cmd);
      const execIdx = code.indexOf("export async function execute(");
      assert.ok(execIdx >= 0, `${cmd}.js has no execute export`);
      const bodyAfterExec = code.slice(execIdx);
      assert.ok(
        bodyAfterExec.includes("withTimeout(interaction"),
        `${cmd}.js execute does not call withTimeout`
      );
    });
  }
});

// ── pool name / description sanitization ──────────────────────────────────────

describe("HA-1: pools.js — name and description sanitization", function () {
  it("pools.js imports sanitizeString", function () {
    const code = src("pools");
    assert.ok(
      code.includes("sanitizeString"),
      "pools.js does not import or use sanitizeString"
    );
  });

  it("pools.js applies sanitizeString to pool name", function () {
    const code = src("pools");
    assert.ok(
      code.includes("sanitizeString(interaction.options.getString("),
      "pools.js poolName is not passed through sanitizeString"
    );
  });

  it("pools.js caps pool name at 50 characters", function () {
    const code = src("pools");
    assert.ok(code.includes(".slice(0, 50)"), "pool name not capped at 50 chars");
  });

  it("pools.js sanitizes description before storing", function () {
    const code = src("pools");
    // The sanitizeString call wrapping initDescription
    assert.ok(
      code.includes("sanitizeString(initDescription)"),
      "pool description not passed through sanitizeString"
    );
  });
});

// ── sanitizeString purity checks (inline) ────────────────────────────────────

import { sanitizeString } from "../../src/utils/validation.js";

describe("HA-1: sanitizeString — pool-name edge cases", function () {
  it("strips < and > from pool names (XSS protection)", function () {
    const result = sanitizeString("<script>alert(1)</script>");
    assert.ok(!result.includes("<"), "< not stripped");
    assert.ok(!result.includes(">"), "> not stripped");
  });

  it("returns empty string for all-control-char input", function () {
    const result = sanitizeString("\x00\x01\x02\x03");
    assert.equal(result.trim(), "");
  });

  it("caps pool name at 50 chars when sliced", function () {
    const long = "a".repeat(80);
    const result = sanitizeString(long).slice(0, 50);
    assert.equal(result.length, 50);
  });

  it("passes through normal pool name unchanged", function () {
    const name = "WokSpec's Official Pool";
    const result = sanitizeString(name);
    assert.equal(result, name);
  });
});
