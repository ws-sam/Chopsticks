// test/unit/prefix-parity.test.js
import { describe, it, after } from "mocha";
import assert from "assert";
import { checkMetaPerms, clearMetaCache } from "../../src/prefix/applyMetaPerms.js";
import { PermissionFlagsBits } from "discord.js";

describe("Prefix Parity — applyMetaPerms", () => {
  after(() => clearMetaCache());

  function makeMember(perms) {
    return {
      permissions: {
        has: (p) => perms.includes(p),
      },
    };
  }

  function makeMessage({ guildId = "123", member = null, guild = true } = {}) {
    return {
      guild: guild ? { id: guildId } : null,
      member: member,
    };
  }

  it("allows command with no userPerms", async () => {
    // ping has no userPerms
    const result = await checkMetaPerms(makeMessage({ member: makeMember([]) }), "ping");
    assert.strictEqual(result.ok, true);
  });

  it("blocks guild-only command in DM", async () => {
    // mod is guildOnly: true
    const result = await checkMetaPerms(makeMessage({ guild: false }), "mod");
    assert.strictEqual(result.ok, false);
    assert.ok(result.reason.includes("server"));
  });

  it("allows user with correct permission", async () => {
    // lockdown requires ManageChannels
    const msg = makeMessage({ member: makeMember([PermissionFlagsBits.ManageChannels]) });
    const result = await checkMetaPerms(msg, "lockdown");
    assert.strictEqual(result.ok, true);
  });

  it("blocks user missing required permission", async () => {
    // lockdown requires ManageChannels, member has none
    const msg = makeMessage({ member: makeMember([]) });
    const result = await checkMetaPerms(msg, "lockdown");
    assert.strictEqual(result.ok, false);
    assert.ok(result.missingPerms.length > 0);
  });

  it("caches meta on second call (no re-import)", async () => {
    // lockdown requires ManageChannels — member has BanMembers only, should block
    const msg = makeMessage({ member: makeMember([PermissionFlagsBits.BanMembers]) });
    await checkMetaPerms(msg, "lockdown"); // prime cache
    const result = await checkMetaPerms(msg, "lockdown");
    assert.strictEqual(result.ok, false); // ManageChannels not in perms
  });

  it("allows command for nonexistent command file (graceful)", async () => {
    const msg = makeMessage({ member: makeMember([]) });
    const result = await checkMetaPerms(msg, "nonexistent-command-xyz");
    assert.strictEqual(result.ok, true); // no meta = no restriction
  });
});
