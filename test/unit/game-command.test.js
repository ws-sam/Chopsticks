import { describe, it } from "mocha";
import { strict as assert } from "assert";
import { data as gameCommand, handleSelect, handleButton } from "../../src/commands/game.js";

describe("Game command definition", function () {
  it("exposes /game with theme + panel subcommands", function () {
    const json = gameCommand.toJSON();
    assert.equal(json.name, "game");
    const options = json.options || [];
    const subs = options.filter(o => o.type === 1).map(o => o.name);
    assert.ok(subs.includes("theme"));
    assert.ok(subs.includes("panel"));
  });

  it("exports component handlers", function () {
    assert.equal(typeof handleSelect, "function");
    assert.equal(typeof handleButton, "function");
  });
});

