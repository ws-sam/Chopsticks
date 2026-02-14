import { describe, it } from 'mocha';
import { strict as assert } from 'assert';
import { data as voiceCommand } from '../../src/tools/voice/commands.js';

describe('Voice command definition', function () {
  it('exposes expected core subcommands', function () {
    const json = voiceCommand.toJSON();
    const names = new Set((json.options || []).map(o => o.name));

    assert.ok(names.has('add'));
    assert.ok(names.has('setup'));
    assert.ok(names.has('status'));
    assert.ok(names.has('room_status'));
  });

  it('includes ownership lifecycle room controls', function () {
    const json = voiceCommand.toJSON();
    const names = new Set((json.options || []).map(o => o.name));

    assert.ok(names.has('room_panel'));
    assert.ok(names.has('room_claim'));
    assert.ok(names.has('room_transfer'));
  });

  it('includes panel delivery commands', function () {
    const json = voiceCommand.toJSON();
    const names = new Set((json.options || []).map(o => o.name));

    assert.ok(names.has('console'));
    assert.ok(names.has('panel'));
    assert.ok(names.has('panel_user_default'));
    assert.ok(names.has('panel_guild_default'));
  });

  it('includes owner permission toggles on lobby setup commands', function () {
    const json = voiceCommand.toJSON();
    const addSub = (json.options || []).find(o => o.name === 'add');
    assert.ok(addSub);
    const optionNames = new Set((addSub.options || []).map(o => o.name));
    assert.ok(optionNames.has('owner_manage_channels'));
    assert.ok(optionNames.has('owner_move_members'));
    assert.ok(optionNames.has('owner_mute_members'));
    assert.ok(optionNames.has('owner_deafen_members'));
    assert.ok(optionNames.has('owner_priority_speaker'));
  });
});
