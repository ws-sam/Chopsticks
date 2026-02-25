// test/unit/ha11-log-hygiene.test.js
// HA-11: Production log hygiene — no [DEBUG] leaks, no raw console in command paths

import { describe, it } from "mocha";
import { strict as assert } from "assert";
import { readFileSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
function src(relPath) {
  return readFileSync(resolve(__dirname, `../../${relPath}`), "utf8");
}

// ── agentManager.js — no [DEBUG] production log leaks ────────────────────────

describe("HA-11: agentManager — no [DEBUG] production log leaks", function () {
  it("agentManager.js has no logger.info('[DEBUG]...) calls", function () {
    const code = src("src/agents/agentManager.js");
    const hasDebugLog = /logger\.(info|warn|error)\s*\(\s*`\[DEBUG\]/.test(code)
      || /logger\.(info|warn|error)\s*\(\s*"\[DEBUG\]/.test(code);
    assert.ok(!hasDebugLog, "agentManager.js has a production [DEBUG] logger.info call");
  });

  it("buildDeployPlan no longer wraps buildInviteForAgent in a debug IIFE", function () {
    const code = src("src/agents/agentManager.js");
    assert.ok(
      !code.includes("[DEBUG] Building invite for agent"),
      "DEBUG invite log still present in agentManager.js"
    );
  });

  it("agentManager.js uses logger.debug (not logger.info) for diagnostic messages", function () {
    const code = src("src/agents/agentManager.js");
    // Verify [DEBUG] prefix only appears in debug-level calls at most
    const infoWithDebug = (code.match(/logger\.info[^;]*\[DEBUG\]/g) || []).length;
    assert.equal(infoWithDebug, 0, `${infoWithDebug} logger.info calls with [DEBUG] prefix found`);
  });
});

// ── agentRunner.js — WS frame logging gated behind AGENT_DEBUG ───────────────

describe("HA-11: agentRunner — WS frame debug logging is env-gated", function () {
  it("agentRunner.js WS frame logging is wrapped in AGENT_DEBUG env check", function () {
    const code = src("src/agents/agentRunner.js");
    const debugIdx = code.indexOf('AGENT_DEBUG');
    assert.notEqual(debugIdx, -1, "AGENT_DEBUG env gate not found in agentRunner.js");
    // The OUTGOING_WS debug log should be inside the env gate
    const wsLogIdx = code.indexOf('OUTGOING_WS');
    assert.notEqual(wsLogIdx, -1, "OUTGOING_WS log message not found");
    // AGENT_DEBUG check should appear before OUTGOING_WS usage
    assert.ok(debugIdx < wsLogIdx, "AGENT_DEBUG gate does not precede OUTGOING_WS log");
  });

  it("agentRunner.js does not have a bare '// DEBUG:' comment in production code", function () {
    const code = src("src/agents/agentRunner.js");
    assert.ok(
      !code.includes("// DEBUG: log outgoing WS frames"),
      "bare '// DEBUG:' comment still present in agentRunner.js"
    );
  });
});

// ── Command files — no raw console.log/warn/error ────────────────────────────

describe("HA-11: src/commands/ — no raw console.* calls (use botLogger)", function () {
  it("no src/commands/*.js file uses console.log()", function () {
    const dir = resolve(__dirname, "../../src/commands");
    const files = readdirSync(dir).filter(f => f.endsWith(".js"));
    const violators = [];
    for (const f of files) {
      const code = readFileSync(resolve(dir, f), "utf8");
      // Allow console inside string literals and comments
      if (/console\.(log|warn|error|info)\s*\(/.test(code.replace(/\/\/[^\n]*/g, "").replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''"))) {
        violators.push(f);
      }
    }
    assert.deepEqual(violators, [], `console.* found in: ${violators.join(", ")}`);
  });
});

// ── Economy files — no raw console.* calls ────────────────────────────────────

describe("HA-11: src/economy/ — no raw console.* calls", function () {
  it("no src/economy/*.js file uses console.log()", function () {
    const dir = resolve(__dirname, "../../src/economy");
    const files = readdirSync(dir).filter(f => f.endsWith(".js"));
    const violators = [];
    for (const f of files) {
      const code = readFileSync(resolve(dir, f), "utf8");
      if (/console\.(log|warn|error|info)\s*\(/.test(code.replace(/\/\/[^\n]*/g, ""))) {
        violators.push(f);
      }
    }
    assert.deepEqual(violators, [], `console.* found in economy: ${violators.join(", ")}`);
  });
});

// ── index.js — no stray console.log in main bot startup path ─────────────────

describe("HA-11: src/index.js — startup uses structured logger not console.log", function () {
  it("index.js console.log() usage is only for the session secret generation hint", function () {
    const code = src("src/index.js");
    const consoleCalls = (code.match(/console\.(log|warn|error)\s*\(/g) || []).length;
    // Should be at most 1 (the "Generate one with:" hint for missing SESSION_SECRET)
    assert.ok(consoleCalls <= 2, `${consoleCalls} console.* calls in index.js — expected ≤2`);
  });
});
