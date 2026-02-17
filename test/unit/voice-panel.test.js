import { describe, it } from 'mocha';
import { strict as assert } from 'assert';
import {
  ensurePanelConfig,
  resolvePanelDelivery,
  buildVoiceRoomDashboardComponents
} from '../../src/tools/voice/panel.js';

describe('Voice panel delivery defaults', function () {
  it('initializes panel config when missing', function () {
    const voice = {};
    ensurePanelConfig(voice);
    assert.ok(voice.panel);
    assert.ok(voice.panel.guildDefault);
    assert.equal(voice.panel.guildDefault.mode, 'temp');
  });

  it('resolves guild default when user has no override', function () {
    const voice = {
      panel: {
        guildDefault: { mode: 'dm', channelId: null, autoSendOnCreate: true },
        userDefaults: {}
      }
    };
    const resolved = resolvePanelDelivery(voice, 'u1');
    assert.equal(resolved.mode, 'dm');
    assert.equal(resolved.autoSendOnCreate, true);
  });

  it('prefers user override when present', function () {
    const voice = {
      panel: {
        guildDefault: { mode: 'temp', channelId: 'c1', autoSendOnCreate: true },
        userDefaults: {
          u1: { mode: 'both', channelId: 'c2', autoSendOnCreate: false }
        }
      }
    };
    const resolved = resolvePanelDelivery(voice, 'u1');
    assert.equal(resolved.mode, 'both');
    assert.equal(resolved.channelId, 'c2');
    assert.equal(resolved.autoSendOnCreate, false);
  });

  it('builds room dashboard action buttons', function () {
    const rows = buildVoiceRoomDashboardComponents('123');
    assert.ok(Array.isArray(rows));
    assert.ok(rows.length >= 2);
    const ids = rows.flatMap(row => row.components.map(c => c.data.custom_id));
    assert.ok(ids.includes('voiceroom:refresh:123'));
    assert.ok(ids.includes('voiceroom:dm:123'));
    assert.ok(ids.includes('voiceroom:release:123'));
    assert.ok(ids.includes('voiceroom:lock:123'));
    assert.ok(ids.includes('voiceroom:unlock:123'));
    assert.ok(ids.includes('voiceroom:rename:123'));
    assert.ok(ids.includes('voiceroom:limit:123'));
    assert.ok(ids.includes('voiceroom:music:123'));
    assert.ok(ids.includes('voiceroom:game:123'));
  });
});
