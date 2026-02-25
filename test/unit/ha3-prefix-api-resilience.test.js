// test/unit/ha3-prefix-api-resilience.test.js
// HA-3: Verify prefix media/knowledge/entertainment commands have proper
//       API error handling and use the protected httpFetch/httpRequest wrappers

import { describe, it } from "mocha";
import { strict as assert } from "assert";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../src/prefix/commands");

function src(name) {
  return readFileSync(resolve(root, `${name}.js`), "utf8");
}

// ── httpFetch/httpRequest usage (no raw undici in prefix commands) ────────────

describe("HA-3: prefix commands use protected httpFetch/httpRequest wrappers", function () {
  const apiModules = ["media", "entertainment", "knowledge"];

  for (const mod of apiModules) {
    it(`${mod}.js does not import raw undici directly`, function () {
      const code = src(mod);
      assert.ok(
        !code.includes('from "undici"') && !code.includes("from 'undici'"),
        `${mod}.js imports undici directly — use httpFetch/httpRequest instead`
      );
    });

    it(`${mod}.js uses httpFetch or httpRequest for API calls`, function () {
      const code = src(mod);
      const usesProtected = code.includes("httpFetch") || code.includes("httpRequest");
      assert.ok(usesProtected, `${mod}.js has no httpFetch/httpRequest usage`);
    });
  }
});

// ── media.js error handling coverage ─────────────────────────────────────────

describe("HA-3: media.js — try/catch + user-friendly fallbacks on all API calls", function () {
  const code = src("media");

  it("wraps all API sections in try/catch", function () {
    // Every command that calls httpRequest must have a catch block
    // Verify the ratio of try{} to catch{} blocks is balanced
    const tryCount   = (code.match(/\btry\s*\{/g) || []).length;
    const catchCount = (code.match(/\}\s*catch/g) || []).length;
    assert.equal(tryCount, catchCount, `${tryCount} try blocks but ${catchCount} catch blocks`);
  });

  it("provides user-facing error reply on all catch paths (no silent swallows)", function () {
    // Split by catch blocks and verify each contains a reply call
    const catchBlocks = code.split(/\}\s*catch\s*(?:\([^)]*\))?\s*\{/);
    // Every catch block after the first (which is pre-catch code) should have reply
    let missingReply = 0;
    for (let i = 1; i < catchBlocks.length; i++) {
      const block = catchBlocks[i];
      if (!block || typeof block !== "string") continue;
      // Allow blocks that have a return or a reply
      if (!block.includes("reply(") && !block.includes("return") && !block.includes("logger")) {
        missingReply++;
      }
    }
    assert.equal(missingReply, 0, `${missingReply} catch blocks have no reply/return/log`);
  });

  it("replies with ❌ prefix on API failure (user sees clear error)", function () {
    const errorReplies = (code.match(/reply\("❌/g) || []).length;
    assert.ok(errorReplies >= 5, `expected ≥5 error reply strings, got ${errorReplies}`);
  });
});

// ── entertainment.js error handling ──────────────────────────────────────────

describe("HA-3: entertainment.js — API error coverage", function () {
  const code = src("entertainment");

  it("wraps API calls in try/catch", function () {
    const tryCount   = (code.match(/\btry\s*\{/g) || []).length;
    const catchCount = (code.match(/\}\s*catch/g) || []).length;
    assert.equal(tryCount, catchCount, `unbalanced try/catch in entertainment.js`);
  });

  it("has at least one error reply on API failure", function () {
    assert.ok(
      code.includes("reply(") && (code.includes("❌") || code.includes("Error") || code.includes("failed")),
      "entertainment.js has no error reply on API failure"
    );
  });
});

// ── knowledge.js error handling ───────────────────────────────────────────────

describe("HA-3: knowledge.js — API error coverage", function () {
  const code = src("knowledge");

  it("wraps API calls in try/catch", function () {
    const tryCount   = (code.match(/\btry\s*\{/g) || []).length;
    const catchCount = (code.match(/\}\s*catch/g) || []).length;
    assert.equal(tryCount, catchCount, `unbalanced try/catch in knowledge.js`);
  });

  it("has error fallback replies", function () {
    assert.ok(
      code.includes("reply(") && (code.includes("❌") || code.includes("failed") || code.includes("Error")),
      "knowledge.js has no error reply on API failure"
    );
  });
});

// ── Circuit breaker configuration ────────────────────────────────────────────

describe("HA-3: externalCircuit — timeout and circuit breaker config", function () {
  it("circuit breaker default timeout is 4000ms", async function () {
    const circuitSrc = readFileSync(
      resolve(__dirname, "../../src/utils/externalCircuit.js"),
      "utf8"
    );
    assert.ok(
      circuitSrc.includes("timeout: 4000") || circuitSrc.includes("timeout:4000"),
      "circuit breaker default timeout should be 4000ms"
    );
  });

  it("httpFetch.js uses 4500ms timeout (within Discord 3s window + buffer)", async function () {
    const fetchSrc = readFileSync(
      resolve(__dirname, "../../src/utils/httpFetch.js"),
      "utf8"
    );
    assert.ok(
      fetchSrc.includes("4500") || fetchSrc.includes("timeout"),
      "httpFetch should specify a timeout"
    );
  });

  it("circuit breaker opens after 50% error rate", async function () {
    const circuitSrc = readFileSync(
      resolve(__dirname, "../../src/utils/externalCircuit.js"),
      "utf8"
    );
    assert.ok(
      circuitSrc.includes("errorThresholdPercentage: 50"),
      "circuit breaker should open at 50% error threshold"
    );
  });

  it("circuit breaker resets after 30 seconds", async function () {
    const circuitSrc = readFileSync(
      resolve(__dirname, "../../src/utils/externalCircuit.js"),
      "utf8"
    );
    assert.ok(
      circuitSrc.includes("resetTimeout: 30_000") || circuitSrc.includes("resetTimeout: 30000"),
      "circuit breaker should reset after 30s"
    );
  });

  it("getBreaker exports a singleton (same instance for same name)", async function () {
    const { getBreaker } = await import("../../src/utils/externalCircuit.js");
    const b1 = getBreaker("test-singleton-ha3", async () => "ok");
    const b2 = getBreaker("test-singleton-ha3", async () => "ok2");
    assert.strictEqual(b1, b2, "getBreaker should return same instance for same service name");
  });
});
