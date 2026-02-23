// src/commands/actions.js
// /actions — agent economy actions (spend credits to have agents do things)

import {
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} from 'discord.js';
import { getPool } from '../utils/storage_pg.js';
import { withTimeout } from '../utils/interactionTimeout.js';

export const meta = {
  name: 'actions',
  description: 'Agent economy actions — spend credits to have agents do things',
  category: 'economy',
};

export const data = new SlashCommandBuilder()
  .setName('actions')
  .setDescription('🤖 Spend credits to have agents perform actions in your server')
  .addSubcommand(s => s
    .setName('list')
    .setDescription('View available agent actions and their costs'))
  .addSubcommand(s => s
    .setName('use')
    .setDescription('Use an agent action')
    .addStringOption(o => o.setName('type').setDescription('Action type').setRequired(true)
      .addChoices(
        { name: '🔊 Play Sound', value: 'play_sound' },
        { name: '🗣️ Say Message (TTS)', value: 'say_message' },
        { name: '🎵 Summon DJ', value: 'summon_dj' },
        { name: '📯 Air Horn', value: 'air_horn' },
        { name: '🎵 Rickroll', value: 'rickroll' },
      ))
    .addChannelOption(o => o.setName('channel').setDescription('Target voice channel').setRequired(false))
    .addStringOption(o => o.setName('message').setDescription('Message to speak (for say_message action)').setRequired(false).setMaxLength(200)))
  .addSubcommandGroup(g => g
    .setName('admin')
    .setDescription('Admin: configure agent actions for this server')
    .addSubcommand(s => s
      .setName('enable')
      .setDescription('Enable a default action type')
      .addStringOption(o => o.setName('type').setDescription('Action type').setRequired(true)
        .addChoices(
          { name: '🔊 Play Sound', value: 'play_sound' },
          { name: '🗣️ Say Message (TTS)', value: 'say_message' },
          { name: '🎵 Summon DJ', value: 'summon_dj' },
          { name: '📯 Air Horn', value: 'air_horn' },
          { name: '🎵 Rickroll', value: 'rickroll' },
        ))
      .addIntegerOption(o => o.setName('cost').setDescription('Credit cost (0 = free)').setRequired(true).setMinValue(0).setMaxValue(100000))
      .addIntegerOption(o => o.setName('cooldown').setDescription('Per-user cooldown in seconds').setRequired(false).setMinValue(0).setMaxValue(86400)))
    .addSubcommand(s => s
      .setName('disable')
      .setDescription('Disable an action type')
      .addStringOption(o => o.setName('type').setDescription('Action type').setRequired(true)
        .addChoices(
          { name: '🔊 Play Sound', value: 'play_sound' },
          { name: '🗣️ Say Message (TTS)', value: 'say_message' },
          { name: '🎵 Summon DJ', value: 'summon_dj' },
          { name: '📯 Air Horn', value: 'air_horn' },
          { name: '🎵 Rickroll', value: 'rickroll' },
        )))
    .addSubcommand(s => s.setName('list').setDescription('View all configured actions'))
  );

const ACTION_DEFAULTS = {
  play_sound:  { name: 'Play Sound',    emoji: '🔊', description: 'Agent joins VC and plays a sound clip', cost: 150, cooldown_s: 300 },
  say_message: { name: 'Say Message',   emoji: '🗣️', description: 'Agent joins VC and speaks your text via TTS', cost: 75, cooldown_s: 120 },
  summon_dj:   { name: 'Summon DJ',     emoji: '🎵', description: 'Agent joins your VC as a music DJ', cost: 200, cooldown_s: 600 },
  air_horn:    { name: 'Air Horn',      emoji: '📯', description: 'Agent plays an air horn in VC', cost: 50, cooldown_s: 60 },
  rickroll:    { name: 'Rickroll',      emoji: '🎵', description: 'Never gonna give you up', cost: 100, cooldown_s: 180 },
};

async function getGuildActions(guildId) {
  const p = getPool();
  const res = await p.query(
    `SELECT * FROM guild_agent_actions WHERE guild_id = $1 ORDER BY action_type`,
    [guildId]
  ).catch(() => ({ rows: [] }));
  return res.rows;
}

async function getUserCooldownFor(guildId, userId, actionType, cooldownSecs) {
  if (!cooldownSecs) return null;
  const p = getPool();
  const res = await p.query(
    `SELECT used_at FROM agent_action_uses
     WHERE guild_id = $1 AND user_id = $2 AND action_type = $3
     ORDER BY used_at DESC LIMIT 1`,
    [guildId, userId, actionType]
  ).catch(() => ({ rows: [] }));
  if (!res.rows.length) return null;
  const usedAt = Number(res.rows[0].used_at);
  const elapsed = Date.now() - usedAt;
  const remaining = cooldownSecs * 1000 - elapsed;
  return remaining > 0 ? Math.ceil(remaining / 1000) : null;
}

async function logActionUse(guildId, userId, actionType, channelId, costPaid) {
  const p = getPool();
  await p.query(
    `INSERT INTO agent_action_uses (guild_id, user_id, action_type, target_channel_id, cost_paid, used_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [guildId, userId, actionType, channelId || null, costPaid, Date.now()]
  ).catch(() => {});
}

export async function execute(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
    return;
  }

  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  // ── Admin subcommands ─────────────────────────────────────────────────────
  if (group === 'admin') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: '❌ You need **Manage Server** to configure actions.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });

    await withTimeout(interaction, async () => {
      if (sub === 'enable') {
        const type = interaction.options.getString('type');
        const cost = interaction.options.getInteger('cost');
        const cooldown = interaction.options.getInteger('cooldown') ?? ACTION_DEFAULTS[type]?.cooldown_s ?? 300;
        const def = ACTION_DEFAULTS[type];
        if (!def) { await interaction.editReply({ content: '❌ Unknown action type.' }); return; }

        const p = getPool();
        await p.query(
          `INSERT INTO guild_agent_actions (guild_id, action_type, name, description, cost, cooldown_s, enabled, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, true, $7)
           ON CONFLICT DO NOTHING`,
          [interaction.guildId, type, def.name, def.description, cost, cooldown, Date.now()]
        ).catch(() => {});
        // Also update if already exists
        await p.query(
          `UPDATE guild_agent_actions SET enabled = true, cost = $1, cooldown_s = $2
           WHERE guild_id = $3 AND action_type = $4`,
          [cost, cooldown, interaction.guildId, type]
        ).catch(() => {});

        await interaction.editReply({ content: `✅ **${def.emoji} ${def.name}** enabled — costs **${cost} credits**, **${cooldown}s** cooldown.` });
        return;
      }

      if (sub === 'disable') {
        const type = interaction.options.getString('type');
        const p = getPool();
        await p.query(`UPDATE guild_agent_actions SET enabled = false WHERE guild_id = $1 AND action_type = $2`, [interaction.guildId, type]).catch(() => {});
        await interaction.editReply({ content: `✅ **${type}** action disabled.` });
        return;
      }

      if (sub === 'list') {
        const actions = await getGuildActions(interaction.guildId);
        if (!actions.length) {
          await interaction.editReply({ content: 'No actions configured yet. Use `/actions admin enable` to set one up.' });
          return;
        }
        const lines = actions.map(a => `${a.enabled ? '✅' : '❌'} **${a.name}** — ${a.cost}cr, ${a.cooldown_s}s cooldown`);
        await interaction.editReply({ content: lines.join('\n') });
        return;
      }
    }, { label: "actions" });
    return;
  }

  // ── Public subcommands ────────────────────────────────────────────────────

  if (sub === 'list') {
    await interaction.deferReply({ ephemeral: true });
    await withTimeout(interaction, async () => {
      const actions = await getGuildActions(interaction.guildId);
      if (!actions.length) {
        await interaction.editReply({ content: 'No agent actions are enabled in this server yet.\nAsk an admin to set them up with `/actions admin enable`.' });
        return;
      }
      const enabled = actions.filter(a => a.enabled);
      if (!enabled.length) {
        await interaction.editReply({ content: 'All actions are currently disabled. Ask an admin to re-enable them.' });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('🤖 Agent Actions')
        .setDescription('Spend credits to have agents perform actions in voice channels.')
        .setColor(Colors.Blurple);

      for (const a of enabled) {
        const def = ACTION_DEFAULTS[a.action_type] || {};
        embed.addFields({
          name: `${def.emoji || '⚡'} ${a.name}`,
          value: `${a.description || def.description || ''}\n**Cost:** ${a.cost} credits  •  **Cooldown:** ${a.cooldown_s}s`,
          inline: false,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    }, { label: "actions" });
    return;
  }

  if (sub === 'use') {
    const actionType = interaction.options.getString('type');
    const targetChannel = interaction.options.getChannel('channel');
    const messageText = interaction.options.getString('message');

    await interaction.deferReply({ ephemeral: true });

    await withTimeout(interaction, async () => {
      // Find action config
      const p = getPool();
      const actionRes = await p.query(
        `SELECT * FROM guild_agent_actions WHERE guild_id = $1 AND action_type = $2 AND enabled = true LIMIT 1`,
        [interaction.guildId, actionType]
      ).catch(() => ({ rows: [] }));

      const action = actionRes.rows[0];
      if (!action) {
        await interaction.editReply({ content: `❌ **${actionType}** is not enabled in this server. Ask an admin to enable it.` });
        return;
      }

      // Cooldown check
      const remaining = await getUserCooldownFor(interaction.guildId, interaction.user.id, actionType, action.cooldown_s);
      if (remaining) {
        await interaction.editReply({ content: `⏳ This action is on cooldown for **${remaining}s**.` });
        return;
      }

      // Credit check
      if (action.cost > 0) {
        try {
          const { getWallet, removeCredits } = await import('../economy/wallet.js');
          const wallet = await getWallet(interaction.user.id);
          if (!wallet || Number(wallet.balance) < action.cost) {
            await interaction.editReply({ content: `❌ You need **${action.cost} credits** to use this action (you have ${wallet ? Number(wallet.balance).toLocaleString() : 0}).` });
            return;
          }
          await removeCredits(interaction.user.id, action.cost, `agent_action:${actionType}`);
        } catch (e) {
          await interaction.editReply({ content: `❌ Failed to process payment: ${e.message}` });
          return;
        }
      }

      // Determine target VC
      const memberVoice = interaction.member?.voice?.channel;
      const vc = targetChannel?.type === ChannelType.GuildVoice ? targetChannel : memberVoice;
      if (!vc) {
        await interaction.editReply({ content: '❌ You need to be in a voice channel (or specify one) to use this action.' });
        return;
      }

      // Log the use
      await logActionUse(interaction.guildId, interaction.user.id, actionType, vc.id, action.cost);

      // Stats + XP
      void (async () => {
        try {
          const { addStat } = await import('../game/activityStats.js');
          const { addGuildXp } = await import('../game/guildXp.js');
          addStat(interaction.user.id, interaction.guildId, 'agent_actions_used', 1);
          await addGuildXp(interaction.user.id, interaction.guildId, 'agent_action', { client: interaction.client }).catch(() => {});
        } catch {}
      })();

      // Dispatch action via AgentManager
      await dispatchAgentAction(interaction, actionType, vc, messageText, action);
    }, { label: "actions" });
    return;
  }
}

async function dispatchAgentAction(interaction, actionType, vc, messageText, action) {
  try {
    const agentManager = global.agentManager;
    if (!agentManager) {
      await interaction.editReply({ content: '⚠️ Agent system is not available right now. Your credits were still spent.' });
      return;
    }

    // Get an available agent for this guild
    const liveAgents = agentManager.liveAgents;
    const guildAgents = [...liveAgents.entries()]
      .filter(([, a]) => a.guildIds?.includes?.(interaction.guildId) || a.guild === interaction.guildId)
      .map(([id, a]) => ({ ...a, agentId: id }));

    if (!guildAgents.length) {
      await interaction.editReply({ content: '⚠️ No agents are online in this server right now. Try again when agents are deployed.' });
      return;
    }

    const agent = guildAgents[0];
    const task = {
      type: actionType,
      guildId: interaction.guildId,
      channelId: vc.id,
      userId: interaction.user.id,
      message: messageText || null,
    };

    // Send task to agent via WS
    if (agent.ws?.readyState === 1 /* OPEN */) {
      agent.ws.send(JSON.stringify({ type: 'task', task }));
    }

    const def = ACTION_DEFAULTS[actionType] || {};
    await interaction.editReply({
      content: `✅ ${def.emoji || '🤖'} **${action.name}** dispatched to ${vc.name}! (${action.cost > 0 ? action.cost + ' credits spent' : 'free'})`,
    });
  } catch (err) {
    await interaction.editReply({ content: `❌ Failed to dispatch action: ${err.message}` });
  }
}
