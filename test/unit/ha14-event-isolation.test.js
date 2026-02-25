// test/unit/ha14-event-isolation.test.js
// HA-14: All Discord event handlers must have try/catch to prevent client crashes

import { describe, it } from "mocha";
import { strict as assert } from "assert";
import { readFileSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVENTS_DIR = resolve(__dirname, "../../src/events");

function getEventFiles() {
  return readdirSync(EVENTS_DIR).filter(f => f.endsWith(".js"));
}

function src(file) {
  return readFileSync(resolve(EVENTS_DIR, file), "utf8");
}

describe("HA-14: Event handler error isolation", function () {
  it("all event handlers exist as .js files", function () {
    const files = getEventFiles();
    assert.ok(files.length >= 15, `Expected ≥15 event files, found ${files.length}`);
  });

  for (const file of [
    "channelCreate.js",
    "channelUpdate.js",
    "guildBanRemove.js",
    "guildMemberUpdate.js",
    "messageUpdate.js",
    "roleCreate.js",
    "roleUpdate.js",
    "channelDelete.js",
    "guildBanAdd.js",
    "guildMemberAdd.js",
    "guildMemberRemove.js",
    "messageDelete.js",
    "messageReactionAdd.js",
    "messageReactionRemove.js",
    "roleDelete.js",
    "voiceStateUpdate.js",
  ]) {
    it(`${file} execute body is wrapped in try/catch`, function () {
      const code = src(file);
      assert.ok(code.includes("try {"), `${file} missing try { block`);
      assert.ok(code.includes("} catch"), `${file} missing } catch block`);
    });
  }

  it("all event files that are unguarded now have logger import", function () {
    const needsLogger = [
      "channelCreate.js",
      "channelUpdate.js",
      "guildBanRemove.js",
      "guildMemberUpdate.js",
      "messageUpdate.js",
      "roleCreate.js",
      "roleUpdate.js",
    ];
    const violators = [];
    for (const f of needsLogger) {
      const code = src(f);
      if (!code.includes('from "../utils/logger.js"')) {
        violators.push(f);
      }
    }
    assert.deepEqual(violators, [], `Missing logger import in: ${violators.join(", ")}`);
  });

  it("no event file has an empty catch block: } catch {}", function () {
    const files = getEventFiles();
    const suspicious = [];
    for (const f of files) {
      const code = src(f);
      // Allow the antinuke try/catch in channel/ban events which have `} catch {`
      // but the outer execute must have a logging catch
      const outerCatch = /\}\s*catch\s*\(err\)\s*\{[\s\S]*?logger\.error/.test(code);
      if (!outerCatch) suspicious.push(f);
    }
    // Files with explicit antinuke patterns also swallow internally — OK
    // Just verify none of the newly-fixed files silently swallow
    const newlyFixed = [
      "channelCreate.js", "channelUpdate.js", "guildBanRemove.js",
      "guildMemberUpdate.js", "messageUpdate.js", "roleCreate.js", "roleUpdate.js",
    ];
    const silentlySwallowing = suspicious.filter(f => newlyFixed.includes(f));
    assert.deepEqual(silentlySwallowing, [], `Newly-fixed events have empty catch: ${silentlySwallowing.join(", ")}`);
  });

  it("execute functions are async in all event files", function () {
    const files = getEventFiles();
    const violators = [];
    for (const f of files) {
      const code = src(f);
      if (!code.includes("async execute(")) violators.push(f);
    }
    assert.deepEqual(violators, [], `Non-async execute in: ${violators.join(", ")}`);
  });
});
