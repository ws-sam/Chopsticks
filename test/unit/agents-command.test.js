import { describe, it } from 'mocha';
import { strict as assert } from 'assert';
import { data as agentsCommand } from '../../src/commands/agents.js';

describe('Agents command definition', function () {
  it('includes idle policy subcommand', function () {
    const json = agentsCommand.toJSON();
    const names = new Set((json.options || []).map(o => o.name));
    assert.ok(names.has('idle_policy'));
  });

  it('idle policy exposes expected options', function () {
    const json = agentsCommand.toJSON();
    const idle = (json.options || []).find(o => o.name === 'idle_policy');
    assert.ok(idle);
    const optionNames = new Set((idle.options || []).map(o => o.name));
    assert.ok(optionNames.has('minutes'));
    assert.ok(optionNames.has('use_default'));
    assert.ok(optionNames.has('disable'));
  });
});
