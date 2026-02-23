// src/commands/xp.js
// /xp config — guild leveling configuration (ManageGuild)
// /xp leaderboard — shorthand for leaderboard by XP

import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  Colors,
} from 'discord.js';
import { upsertGuildXpConfig, getGuildXpConfig } from '../utils/storage.js';
import { withTimeout } from '../utils/interactionTimeout.js';

export const meta = {
  name: 'xp',
  description: 'Per-guild XP configuration and leaderboard',
  category: 'admin',
};

export const data = new SlashCommandBuilder()
  .setName('xp')
  .setDescription('⚡ Configure per-guild XP leveling or view the leaderboard')
  .addSubcommandGroup(g => g
    .setName('config')
    .setDescription('Admin: configure XP settings for this server')
    .addSubcommand(s => s.setName('view').setDescription('View current XP configuration'))
    .addSubcommand(s => s
      .setName('toggle')
      .setDescription('Enable or disable per-guild leveling')
      .addStringOption(o => o.setName('state').setDescription('on or off').setRequired(true)
        .addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' })))
    .addSubcommand(s => s
      .setName('preset')
      .setDescription('Apply a leveling preset')
      .addStringOption(o => o.setName('preset').setDescription('Preset difficulty').setRequired(true)
        .addChoices(
          { name: '🌿 Relaxed (slow, low pressure)', value: 'relaxed' },
          { name: '⚖️ Balanced (default)', value: 'balanced' },
          { name: '🔥 Grind (fast, high engagement)', value: 'grind' },
        )))
    .addSubcommand(s => s
      .setName('set')
      .setDescription('Set XP gained per activity')
      .addStringOption(o => o.setName('source').setDescription('Activity source').setRequired(true)
        .addChoices(
          { name: 'Message', value: 'message' },
          { name: 'VC minute', value: 'vc_minute' },
          { name: 'Work', value: 'work' },
          { name: 'Gather', value: 'gather' },
          { name: 'Fight win', value: 'fight_win' },
          { name: 'Trivia win', value: 'trivia_win' },
          { name: 'Daily claim', value: 'daily' },
          { name: 'Command', value: 'command' },
          { name: 'Agent action', value: 'agent_action' },
        ))
      .addIntegerOption(o => o.setName('amount').setDescription('XP amount (0 = disabled)').setRequired(true).setMinValue(0).setMaxValue(10000)))
    .addSubcommand(s => s
      .setName('multiplier')
      .setDescription('Set a global XP multiplier for this server')
      .addNumberOption(o => o.setName('value').setDescription('Multiplier (0.1–10.0)').setRequired(true).setMinValue(0.1).setMaxValue(10.0)))
    .addSubcommand(s => s
      .setName('cooldown')
      .setDescription('Set message XP cooldown in seconds (prevents spam)')
      .addIntegerOption(o => o.setName('seconds').setDescription('Seconds between message XP awards (0–3600)').setRequired(true).setMinValue(0).setMaxValue(3600)))
    .addSubcommand(s => s
      .setName('levelup_channel')
      .setDescription('Set the channel to announce level-ups')
      .addChannelOption(o => o.setName('channel').setDescription('Channel (leave empty to disable)').setRequired(false)))
    .addSubcommand(s => s
      .setName('levelup_message')
      .setDescription('Customize the level-up announcement message')
      .addStringOption(o => o.setName('message').setDescription('Use {user} and {level} as placeholders').setRequired(true).setMaxLength(200)))
    .addSubcommand(s => s
      .setName('sync')
      .setDescription('Toggle whether global economy XP syncs into guild XP')
      .addStringOption(o => o.setName('state').setDescription('on or off').setRequired(true)
        .addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' })))
  );

const PRESETS = {
  relaxed: {
    xp_per_message: 3, xp_per_vc_minute: 1, xp_per_work: 20, xp_per_gather: 15,
    xp_per_fight_win: 25, xp_per_trivia_win: 30, xp_per_daily: 50,
    xp_per_command: 0, xp_per_agent_action: 10, message_xp_cooldown_s: 120, xp_multiplier: 1.0,
  },
  balanced: {
    xp_per_message: 5, xp_per_vc_minute: 2, xp_per_work: 40, xp_per_gather: 30,
    xp_per_fight_win: 50, xp_per_trivia_win: 60, xp_per_daily: 80,
    xp_per_command: 1, xp_per_agent_action: 20, message_xp_cooldown_s: 60, xp_multiplier: 1.0,
  },
  grind: {
    xp_per_message: 10, xp_per_vc_minute: 5, xp_per_work: 80, xp_per_gather: 60,
    xp_per_fight_win: 100, xp_per_trivia_win: 120, xp_per_daily: 160,
    xp_per_command: 2, xp_per_agent_action: 40, message_xp_cooldown_s: 30, xp_multiplier: 1.5,
  },
};

const SOURCE_FIELD_MAP = {
  message: 'xp_per_message',
  vc_minute: 'xp_per_vc_minute',
  work: 'xp_per_work',
  gather: 'xp_per_gather',
  fight_win: 'xp_per_fight_win',
  trivia_win: 'xp_per_trivia_win',
  daily: 'xp_per_daily',
  command: 'xp_per_command',
  agent_action: 'xp_per_agent_action',
};

export async function execute(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
    return;
  }

  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (group === 'config') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: '❌ You need **Manage Server** permission to configure XP.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    await withTimeout(interaction, async () => {
      if (sub === 'view') {
        const cfg = await getGuildXpConfig(interaction.guildId) || {};
        const def = { xp_per_message: 5, xp_per_vc_minute: 2, xp_per_work: 40, xp_per_gather: 30, xp_per_fight_win: 50, xp_per_trivia_win: 60, xp_per_daily: 80, xp_per_command: 1, xp_per_agent_action: 20, message_xp_cooldown_s: 60, xp_multiplier: 1.0 };
        const c = { ...def, ...cfg };
        const embed = new EmbedBuilder()
          .setTitle('⚡ Guild XP Configuration')
          .setColor(c.enabled === false ? Colors.Red : Colors.Yellow)
          .addFields(
            { name: 'Status', value: c.enabled === false ? '🔴 Disabled' : '🟢 Enabled', inline: true },
            { name: 'Multiplier', value: `${Number(c.xp_multiplier || 1.0).toFixed(1)}×`, inline: true },
            { name: 'Msg Cooldown', value: `${c.message_xp_cooldown_s}s`, inline: true },
            { name: '💬 Message XP', value: String(c.xp_per_message), inline: true },
            { name: '🎙️ VC/min XP', value: String(c.xp_per_vc_minute), inline: true },
            { name: '💼 Work XP', value: String(c.xp_per_work), inline: true },
            { name: '⛏️ Gather XP', value: String(c.xp_per_gather), inline: true },
            { name: '⚔️ Fight Win XP', value: String(c.xp_per_fight_win), inline: true },
            { name: '🧠 Trivia Win XP', value: String(c.xp_per_trivia_win), inline: true },
            { name: '📅 Daily XP', value: String(c.xp_per_daily), inline: true },
            { name: '⌨️ Command XP', value: String(c.xp_per_command), inline: true },
            { name: '🤖 Agent Action XP', value: String(c.xp_per_agent_action), inline: true },
            { name: '📢 Levelup Channel', value: c.levelup_channel_id ? `<#${c.levelup_channel_id}>` : 'Not set', inline: true },
            { name: '🔄 Sync Global XP', value: c.sync_global_xp === false ? 'Off' : 'On', inline: true },
          )
          .setFooter({ text: 'Use /xp config set to adjust individual values, or /xp config preset for quick setup.' });
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (sub === 'toggle') {
        const on = interaction.options.getString('state') === 'on';
        await upsertGuildXpConfig(interaction.guildId, { enabled: on });
        await interaction.editReply({ content: `✅ Guild leveling is now **${on ? 'enabled' : 'disabled'}**.` });
        return;
      }

      if (sub === 'preset') {
        const preset = interaction.options.getString('preset');
        const vals = PRESETS[preset];
        if (!vals) { await interaction.editReply({ content: '❌ Unknown preset.' }); return; }
        await upsertGuildXpConfig(interaction.guildId, vals);
        const labels = { relaxed: '🌿 Relaxed', balanced: '⚖️ Balanced', grind: '🔥 Grind' };
        await interaction.editReply({ content: `✅ Applied **${labels[preset]}** XP preset.` });
        return;
      }

      if (sub === 'set') {
        const source = interaction.options.getString('source');
        const amount = interaction.options.getInteger('amount');
        const field = SOURCE_FIELD_MAP[source];
        if (!field) { await interaction.editReply({ content: '❌ Unknown source.' }); return; }
        await upsertGuildXpConfig(interaction.guildId, { [field]: amount });
        await interaction.editReply({ content: `✅ Set **${source}** XP to **${amount}**.` });
        return;
      }

      if (sub === 'multiplier') {
        const val = Math.round(interaction.options.getNumber('value') * 10) / 10;
        await upsertGuildXpConfig(interaction.guildId, { xp_multiplier: val });
        await interaction.editReply({ content: `✅ Global XP multiplier set to **${val.toFixed(1)}×**.` });
        return;
      }

      if (sub === 'cooldown') {
        const secs = interaction.options.getInteger('seconds');
        await upsertGuildXpConfig(interaction.guildId, { message_xp_cooldown_s: secs });
        await interaction.editReply({ content: `✅ Message XP cooldown set to **${secs}s**.` });
        return;
      }

      if (sub === 'levelup_channel') {
        const ch = interaction.options.getChannel('channel');
        await upsertGuildXpConfig(interaction.guildId, { levelup_channel_id: ch?.id || null });
        await interaction.editReply({ content: ch ? `✅ Level-up announcements will go to ${ch}.` : '✅ Level-up channel cleared.' });
        return;
      }

      if (sub === 'levelup_message') {
        const msg = interaction.options.getString('message');
        await upsertGuildXpConfig(interaction.guildId, { levelup_message: msg });
        await interaction.editReply({ content: `✅ Level-up message set to:\n> ${msg}` });
        return;
      }

      if (sub === 'sync') {
        const on = interaction.options.getString('state') === 'on';
        await upsertGuildXpConfig(interaction.guildId, { sync_global_xp: on });
        await interaction.editReply({ content: `✅ Global XP sync is now **${on ? 'on' : 'off'}**.` });
        return;
      }
    }, { label: "xp" });
  }

  await interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
}
