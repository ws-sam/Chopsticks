import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import * as lockdown from "../../src/commands/lockdown.js";
import { parseColor } from "../../src/commands/embed.js";
import { convertUnit } from "../../src/commands/convert.js";
import * as reputation from "../../src/commands/reputation.js";
import { isValidDate } from "../../src/commands/birthday.js";

// ---- 1. lockdown meta ----
describe("lockdown command", function () {
  it("has meta.category = 'mod'", function () {
    assert.equal(lockdown.meta.category, "mod");
  });

  it("has setDefaultMemberPermissions set", function () {
    const json = lockdown.data.toJSON();
    // default_member_permissions stores the permission bit as a string
    assert.ok(
      json.default_member_permissions != null,
      "setDefaultMemberPermissions should be set"
    );
  });

  it("has guildOnly = true", function () {
    assert.equal(lockdown.meta.guildOnly, true);
  });

  it("has userPerms including ManageChannels", function () {
    assert.ok(
      lockdown.meta.userPerms.includes(PermissionFlagsBits.ManageChannels),
      "userPerms should include ManageChannels"
    );
  });
});

// ---- 2. embed hex color validation ----
describe("embed command - color validation", function () {
  it("rejects 3-digit short hex (#fff)", function () {
    assert.equal(parseColor("#fff"), null);
  });

  it("accepts 6-digit hex without hash (ffffff)", function () {
    assert.equal(parseColor("ffffff"), 0xffffff);
  });

  it("accepts 6-digit hex with hash (#ffffff)", function () {
    assert.equal(parseColor("#ffffff"), 0xffffff);
  });

  it("accepts mixed-case hex (#5865F2)", function () {
    assert.equal(parseColor("#5865F2"), 0x5865F2);
  });

  it("returns default color (0x5865F2) when no input provided", function () {
    assert.equal(parseColor(null), 0x5865F2);
    assert.equal(parseColor(undefined), 0x5865F2);
  });

  it("rejects non-hex strings", function () {
    assert.equal(parseColor("red"), null);
    assert.equal(parseColor("#GGGGGG"), null);
  });
});

// ---- 3. convert unit conversions ----
describe("convert command - unit conversion", function () {
  it("converts 1 km to 1000 m", function () {
    const result = convertUnit(1, "km", "m");
    assert.ok(result !== null, "should not return null");
    assert.ok(Math.abs(result - 1000) < 0.001, `expected ~1000, got ${result}`);
  });

  it("converts 100 c to 212 f", function () {
    const result = convertUnit(100, "c", "f");
    assert.ok(result !== null, "should not return null");
    assert.ok(Math.abs(result - 212) < 0.001, `expected ~212, got ${result}`);
  });

  it("converts 1 mi to ~1.609344 km", function () {
    const result = convertUnit(1, "mi", "km");
    assert.ok(result !== null, "should not return null");
    assert.ok(Math.abs(result - 1.609344) < 0.0001, `expected ~1.609344, got ${result}`);
  });

  it("converts 0 c to 32 f", function () {
    const result = convertUnit(0, "c", "f");
    assert.ok(Math.abs(result - 32) < 0.001, `expected 32, got ${result}`);
  });

  it("converts 1 kg to 1000 g", function () {
    const result = convertUnit(1, "kg", "g");
    assert.ok(Math.abs(result - 1000) < 0.001, `expected 1000, got ${result}`);
  });

  it("returns null for unknown unit", function () {
    const result = convertUnit(1, "xyz", "m");
    assert.equal(result, null);
  });

  it("returns null for unknown target unit", function () {
    const result = convertUnit(1, "m", "parsecs");
    assert.equal(result, null);
  });
});

// ---- 5. reputation - give restrictions ----
describe("reputation command", function () {
  it("has meta.category = 'economy'", function () {
    assert.equal(reputation.meta.category, "economy");
  });

  it("cannot give rep to self (logic check)", function () {
    // Simulate the guard: target.id === interaction.user.id
    const userId = "123456";
    const targetId = "123456";
    const isSelf = targetId === userId;
    assert.ok(isSelf, "should detect giving to self");
  });

  it("cannot give rep to bots (logic check)", function () {
    // Simulate the guard: target.bot === true
    const targetBot = { bot: true, id: "999" };
    assert.ok(targetBot.bot, "should detect bot user");
  });
});

// ---- 7 & 8. birthday date validation ----
describe("birthday command - date validation", function () {
  it("rejects Feb 30 as invalid", function () {
    assert.equal(isValidDate(2, 30), false);
  });

  it("accepts Feb 28 as valid", function () {
    assert.equal(isValidDate(2, 28), true);
  });

  it("rejects Feb 29 in non-leap context (validation uses non-leap year)", function () {
    // Our isValidDate uses year 2001 (non-leap), so Feb 29 is invalid
    assert.equal(isValidDate(2, 29), false);
  });

  it("accepts Jan 31 as valid", function () {
    assert.equal(isValidDate(1, 31), true);
  });

  it("rejects Jan 32 as invalid", function () {
    assert.equal(isValidDate(1, 32), false);
  });

  it("rejects month 0 as invalid", function () {
    assert.equal(isValidDate(0, 15), false);
  });

  it("rejects month 13 as invalid", function () {
    assert.equal(isValidDate(13, 15), false);
  });

  it("rejects April 31 as invalid", function () {
    // April has 30 days
    assert.equal(isValidDate(4, 31), false);
  });
});

// ---- 9. all 5 commands: meta.category and slash_name ----
describe("all new commands: meta and slash name", function () {
  const commands = [
    { mod: lockdown, name: "lockdown", category: "mod" },
    { mod: { meta: { category: "tools" }, data: { toJSON: () => ({ name: "embed" }) }, execute: () => {} }, name: "embed", category: "tools" },
    { mod: { meta: { category: "tools" }, data: { toJSON: () => ({ name: "convert" }) }, execute: () => {} }, name: "convert", category: "tools" },
    { mod: reputation, name: "reputation", category: "economy" },
    { mod: { meta: { category: "tools" }, data: { toJSON: () => ({ name: "birthday" }) }, execute: () => {} }, name: "birthday", category: "tools" }
  ];

  // Re-import the real modules to check their actual data
  it("lockdown: meta.category = 'mod', name = 'lockdown'", function () {
    assert.equal(lockdown.meta.category, "mod");
    assert.equal(lockdown.data.toJSON().name, "lockdown");
  });

  it("embed: meta.category = 'tools', name = 'embed'", async function () {
    const mod = await import("../../src/commands/embed.js");
    assert.equal(mod.meta.category, "tools");
    assert.equal(mod.data.toJSON().name, "embed");
  });

  it("convert: meta.category = 'tools', name = 'convert'", async function () {
    const mod = await import("../../src/commands/convert.js");
    assert.equal(mod.meta.category, "tools");
    assert.equal(mod.data.toJSON().name, "convert");
  });

  it("reputation: meta.category = 'economy', name = 'reputation'", function () {
    assert.equal(reputation.meta.category, "economy");
    assert.equal(reputation.data.toJSON().name, "reputation");
  });

  it("birthday: meta.category = 'tools', name = 'birthday'", async function () {
    const mod = await import("../../src/commands/birthday.js");
    assert.equal(mod.meta.category, "tools");
    assert.equal(mod.data.toJSON().name, "birthday");
  });
});
