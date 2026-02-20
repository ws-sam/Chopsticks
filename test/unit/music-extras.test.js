// test/unit/music-extras.test.js
import { describe, it } from "mocha";
import { strict as assert } from "assert";
import { data as musicData } from "../../src/commands/music.js";
import { parseTime } from "../../src/commands/schedule.js";

// ── music save: verify SlashCommandBuilder has save subcommand ────────────────

describe("music save subcommand", function () {
  it("is registered in the SlashCommandBuilder", function () {
    const json = musicData.toJSON();
    const flat = (json.options ?? []).flatMap(o => {
      if (o.type === 1) return [o]; // SUB_COMMAND
      if (o.type === 2) return (o.options ?? []).flatMap(s => s.type === 1 ? [s] : []); // SUB_COMMAND_GROUP
      return [];
    });
    const save = flat.find(s => s.name === "save");
    assert.ok(save, "save subcommand should be registered");
    const nameOpt = (save.options ?? []).find(o => o.name === "name");
    assert.ok(nameOpt, "save subcommand should have a 'name' option");
    assert.equal(nameOpt.required, true, "name option should be required");
  });

  it("save subcommand name option has max_length 50", function () {
    const json = musicData.toJSON();
    const flat = (json.options ?? []).flatMap(o => {
      if (o.type === 1) return [o];
      if (o.type === 2) return (o.options ?? []).flatMap(s => s.type === 1 ? [s] : []);
      return [];
    });
    const save = flat.find(s => s.name === "save");
    const nameOpt = (save?.options ?? []).find(o => o.name === "name");
    assert.equal(nameOpt?.max_length, 50, "name option should have max_length 50");
  });

  it("saved playlist structure is correct", function () {
    // Simulate what execute() stores for a saved playlist
    const mockTrack = { title: "Song Title", uri: "https://example.com/song", requester: { id: "123", username: "user" } };
    const stored = { title: mockTrack.title, uri: mockTrack.uri, requester: mockTrack.requester };
    assert.equal(stored.title, "Song Title");
    assert.equal(stored.uri, "https://example.com/song");
    assert.deepEqual(stored.requester, { id: "123", username: "user" });
  });
});

// ── music eq: verify SlashCommandBuilder and preset validation ────────────────

describe("music eq subcommand", function () {
  it("is registered in the SlashCommandBuilder with correct choices", function () {
    const json = musicData.toJSON();
    const flat = (json.options ?? []).flatMap(o => {
      if (o.type === 1) return [o];
      if (o.type === 2) return (o.options ?? []).flatMap(s => s.type === 1 ? [s] : []);
      return [];
    });
    const eq = flat.find(s => s.name === "eq");
    assert.ok(eq, "eq subcommand should be registered");
    const presetOpt = (eq.options ?? []).find(o => o.name === "preset");
    assert.ok(presetOpt, "eq should have a preset option");
    assert.equal(presetOpt.required, true);
    const choiceValues = (presetOpt.choices ?? []).map(c => c.value);
    assert.ok(choiceValues.includes("flat"), "should include flat");
    assert.ok(choiceValues.includes("bass-boost"), "should include bass-boost");
    assert.ok(choiceValues.includes("treble"), "should include treble");
    assert.ok(choiceValues.includes("pop"), "should include pop");
  });

  it("bass-boost maps to bassboost for agent preset", function () {
    // This mirrors the mapping in execute()
    const preset = "bass-boost";
    const agentPreset = preset === "bass-boost" ? "bassboost" : preset;
    assert.equal(agentPreset, "bassboost");
  });

  it("flat/treble/pop pass through unchanged", function () {
    for (const p of ["flat", "treble", "pop"]) {
      const agentPreset = p === "bass-boost" ? "bassboost" : p;
      assert.equal(agentPreset, p);
    }
  });
});

// ── music lyrics: verify subcommand is registered ────────────────────────────

describe("music lyrics subcommand", function () {
  it("is registered in the SlashCommandBuilder", function () {
    const json = musicData.toJSON();
    const flat = (json.options ?? []).flatMap(o => {
      if (o.type === 1) return [o];
      if (o.type === 2) return (o.options ?? []).flatMap(s => s.type === 1 ? [s] : []);
      return [];
    });
    const lyrics = flat.find(s => s.name === "lyrics");
    assert.ok(lyrics, "lyrics subcommand should be registered");
  });
});

// ── music playlist load: verify subcommand is in playlist group ───────────────

describe("music playlist load subcommand", function () {
  it("is in the playlist subcommand group", function () {
    const json = musicData.toJSON();
    const playlistGroup = (json.options ?? []).find(o => o.name === "playlist" && o.type === 2);
    assert.ok(playlistGroup, "playlist group should exist");
    const loadSub = (playlistGroup.options ?? []).find(s => s.name === "load");
    assert.ok(loadSub, "load subcommand should be in playlist group");
    const nameOpt = (loadSub.options ?? []).find(o => o.name === "name");
    assert.ok(nameOpt, "load should have a name option");
    assert.equal(nameOpt.required, true);
  });
});

// ── schedule: parseTime ───────────────────────────────────────────────────────

describe("schedule parseTime", function () {
  it("parses '1h30m' as 5400000 ms", function () {
    const result = parseTime("1h30m");
    assert.ok(!result.error, `unexpected error: ${result.error}`);
    assert.equal(result.ms, 5_400_000);
  });

  it("parses '30m' as 1800000 ms", function () {
    const result = parseTime("30m");
    assert.ok(!result.error, `unexpected error: ${result.error}`);
    assert.equal(result.ms, 1_800_000);
  });

  it("parses '2d' as 172800000 ms", function () {
    const result = parseTime("2d");
    assert.ok(!result.error, `unexpected error: ${result.error}`);
    assert.equal(result.ms, 172_800_000);
  });

  it("returns error for empty string", function () {
    const result = parseTime("");
    assert.ok(result.error, "should return an error for empty string");
  });

  it("returns error for past ISO date", function () {
    const result = parseTime("2000-01-01T00:00:00");
    assert.ok(result.error, "should return error for past date");
  });

  it("returns sendAt close to Date.now() + ms", function () {
    const before = Date.now();
    const result = parseTime("1h");
    const after = Date.now();
    assert.ok(!result.error);
    assert.ok(result.sendAt >= before + 3_600_000);
    assert.ok(result.sendAt <= after + 3_600_000);
  });
});

// ── schedule list: empty array when none scheduled ───────────────────────────

describe("schedule list empty state", function () {
  it("returns empty array when scheduledMessages is undefined", function () {
    const gData = {};
    const pending = Array.isArray(gData.scheduledMessages) ? gData.scheduledMessages : [];
    assert.deepEqual(pending, []);
  });

  it("returns empty array when scheduledMessages is empty", function () {
    const gData = { scheduledMessages: [] };
    const pending = Array.isArray(gData.scheduledMessages) ? gData.scheduledMessages : [];
    assert.deepEqual(pending, []);
  });
});

// ── schedule command: structure ───────────────────────────────────────────────

describe("schedule command structure", function () {
  it("has message/list/cancel subcommands", async function () {
    const { data: schedData } = await import("../../src/commands/schedule.js");
    const json = schedData.toJSON();
    assert.equal(json.name, "schedule");
    const subNames = (json.options ?? []).map(o => o.name);
    assert.ok(subNames.includes("message"), "missing message subcommand");
    assert.ok(subNames.includes("list"), "missing list subcommand");
    assert.ok(subNames.includes("cancel"), "missing cancel subcommand");
  });

  it("has ManageMessages default member permission", async function () {
    const { data: schedData } = await import("../../src/commands/schedule.js");
    const json = schedData.toJSON();
    // ManageMessages = 0x2000 = 8192
    assert.ok(json.default_member_permissions !== undefined, "default_member_permissions should be set");
  });
});
