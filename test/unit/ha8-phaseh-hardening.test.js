// test/unit/ha8-phaseh-hardening.test.js
// HA-8: Phase H audit — timing-safe auth, antinuke admin-exempt, WS malformed JSON,
//       mod-command guild-only, capacity checks

import { describe, it } from "mocha";
import { strict as assert } from "assert";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
function src(relPath) {
  return readFileSync(resolve(__dirname, `../../${relPath}`), "utf8");
}

// ── Timing-safe secret comparison — agentManager.js ──────────────────────────

describe("HA-8: agentManager — timing-safe runnerSecret comparison", function () {
  it("agentManager.js imports timingSafeEqual from node:crypto", function () {
    const code = src("src/agents/agentManager.js");
    assert.ok(
      code.includes("timingSafeEqual") && code.includes("node:crypto"),
      "timingSafeEqual not imported from node:crypto"
    );
  });

  it("runnerSecret validation uses timingSafeEqual (not !==)", function () {
    const code = src("src/agents/agentManager.js");
    // Find the actual handleHello method definition (not the call site)
    const handleHelloIdx = code.indexOf("handleHello(ws, msg) {");
    assert.notEqual(handleHelloIdx, -1, "handleHello method not found");
    const handleHello = code.slice(handleHelloIdx, handleHelloIdx + 2500);
    assert.ok(
      handleHello.includes("timingSafeEqual"),
      "runnerSecret comparison does not use timingSafeEqual"
    );
    // Must NOT fall back to direct !== comparison
    const directCompare = /presented\s*!==\s*this\.runnerSecret/.test(handleHello);
    assert.ok(!directCompare, "direct !== comparison still present for runnerSecret");
  });

  it("runnerSecret validation checks length equality before timingSafeEqual", function () {
    const code = src("src/agents/agentManager.js");
    // Length check prevents panic from unequal-length Buffers
    assert.ok(
      code.includes("bPresented.length === bExpected.length"),
      "no length equality check before timingSafeEqual (could throw)"
    );
  });
});

// ── Timing-safe adminToken comparison — agentRunner.js ───────────────────────

describe("HA-8: agentRunner — timing-safe adminToken comparison", function () {
  it("agentRunner.js imports timingSafeEqual from node:crypto", function () {
    const code = src("src/agents/agentRunner.js");
    assert.ok(
      code.includes("timingSafeEqual") && code.includes("node:crypto"),
      "timingSafeEqual not imported from node:crypto in agentRunner"
    );
  });

  it("isAdminOverride uses timingSafeEqual (not ===)", function () {
    const code = src("src/agents/agentRunner.js");
    const fnStart = code.indexOf("function isAdminOverride");
    assert.notEqual(fnStart, -1, "isAdminOverride function not found");
    const fnBody = code.slice(fnStart, fnStart + 400);
    assert.ok(
      fnBody.includes("timingSafeEqual"),
      "isAdminOverride does not use timingSafeEqual"
    );
    // Must NOT fall back to direct === comparison
    const directCompare = /\)\s*===\s*token/.test(fnBody);
    assert.ok(!directCompare, "direct === comparison still present for adminToken");
  });

  it("isAdminOverride checks buffer length before comparing", function () {
    const code = src("src/agents/agentRunner.js");
    const fnStart = code.indexOf("function isAdminOverride");
    const fnBody = code.slice(fnStart, fnStart + 400);
    assert.ok(
      fnBody.includes(".length === ") || fnBody.includes("bPresented.length"),
      "no length check in isAdminOverride before timingSafeEqual"
    );
  });
});

// ── Malformed WebSocket JSON — explicit error response ────────────────────────

describe("HA-8: agentManager — malformed JSON sends error response", function () {
  it("invalid JSON parse catch block sends an error message back to agent", function () {
    const code = src("src/agents/agentManager.js");
    const catchStart = code.indexOf("Invalid JSON received from agent");
    assert.notEqual(catchStart, -1, "missing 'Invalid JSON' log message");
    const catchBlock = code.slice(catchStart - 20, catchStart + 200);
    assert.ok(
      catchBlock.includes('ws.send') && catchBlock.includes('"error"'),
      "malformed JSON catch does not send ws error response"
    );
  });
});

// ── Antinuke — Administrator auto-exemption ───────────────────────────────────

describe("HA-8: antinuke engine — Administrator permission auto-exemption", function () {
  it("engine.js imports PermissionFlagsBits from discord.js", function () {
    const code = src("src/tools/antinuke/engine.js");
    assert.ok(
      code.includes("PermissionFlagsBits"),
      "engine.js does not import PermissionFlagsBits"
    );
  });

  it("punishExecutor auto-exempts members with Administrator permission", function () {
    const code = src("src/tools/antinuke/engine.js");
    assert.ok(
      code.includes("PermissionFlagsBits.Administrator"),
      "no Administrator exemption in punishExecutor"
    );
    assert.ok(
      code.includes("member.permissions?.has(PermissionFlagsBits.Administrator)"),
      "Administrator check uses wrong API"
    );
  });

  it("Administrator exemption is applied AFTER owner check (owner takes priority)", function () {
    const code = src("src/tools/antinuke/engine.js");
    const ownerIdx = code.indexOf("guild.ownerId === userId");
    const adminIdx = code.indexOf("PermissionFlagsBits.Administrator");
    assert.ok(ownerIdx < adminIdx, "Administrator check appears before owner check");
  });

  it("Administrator exemption is applied BEFORE whitelist check (short-circuit)", function () {
    const code = src("src/tools/antinuke/engine.js");
    const adminIdx  = code.indexOf("PermissionFlagsBits.Administrator");
    const wlIdx     = code.indexOf("whitelistUserIds?.includes");
    assert.ok(adminIdx < wlIdx, "Administrator exemption should precede whitelist check");
  });

  it("guild owner is still exempt (pre-existing safety guard intact)", function () {
    const code = src("src/tools/antinuke/engine.js");
    assert.ok(
      code.includes("guild.ownerId === userId"),
      "guild owner exemption removed from punishExecutor"
    );
  });
});

// ── Mod commands — guildOnly flag ─────────────────────────────────────────────

describe("HA-8: mod commands — guild-only enforcement", function () {
  it("mod.js meta has guildOnly: true", function () {
    const code = src("src/commands/mod.js");
    assert.ok(code.includes("guildOnly: true"), "mod.js missing guildOnly: true");
  });

  it("purge.js meta has guildOnly: true", function () {
    const code = src("src/commands/purge.js");
    assert.ok(code.includes("guildOnly: true"), "purge.js missing guildOnly: true");
  });

  it("antinuke.js command requires Administrator permission (setDefaultMemberPermissions)", function () {
    const code = src("src/commands/antinuke.js");
    assert.ok(
      code.includes("setDefaultMemberPermissions") && code.includes("Administrator"),
      "antinuke.js does not restrict to Administrator permission"
    );
  });

  it("antispam.js or automod.js restricts to guild context", function () {
    // At least one of these should have guildOnly or setDefaultMemberPermissions
    const antispamCode = (() => { try { return src("src/commands/antispam.js"); } catch { return ""; } })();
    const automodCode  = (() => { try { return src("src/commands/automod.js");  } catch { return ""; } })();
    const combined = antispamCode + automodCode;
    assert.ok(
      combined.includes("guildOnly") || combined.includes("setDefaultMemberPermissions"),
      "antispam/automod missing guild restriction"
    );
  });
});

// ── Agent capacity — MAX_AGENTS_PER_GUILD ────────────────────────────────────

describe("HA-8: agent capacity — 49-agent-per-guild limit", function () {
  it("MAX_AGENTS_PER_GUILD is defined as 49", function () {
    const code = src("src/agents/agentManager.js");
    assert.ok(
      code.includes("MAX_AGENTS_PER_GUILD") && code.includes("49"),
      "MAX_AGENTS_PER_GUILD constant missing or wrong value"
    );
  });

  it("buildDeployPlan returns an error when desired > MAX_AGENTS_PER_GUILD", function () {
    const code = src("src/agents/agentManager.js");
    const planStart = code.indexOf("async buildDeployPlan(");
    assert.notEqual(planStart, -1, "buildDeployPlan function not found");
    const planBody = code.slice(planStart, planStart + 500);
    assert.ok(
      planBody.includes("MAX_AGENTS_PER_GUILD"),
      "buildDeployPlan does not check MAX_AGENTS_PER_GUILD"
    );
    assert.ok(
      planBody.includes("error:") || planBody.includes("Agent limit exceeded"),
      "buildDeployPlan does not return an error when limit exceeded"
    );
  });
});
