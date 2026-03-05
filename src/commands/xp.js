// src/commands/xp.js
// /xp config — admin leveling configuration for per-guild XP system

import {
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
  PermissionFlagsBits,
} from 'discord.js';
import { withTimeout } from '../utils/interactionTimeout.js';

export const meta = {
  deployGlobal: true,
  guildOnly: true,
  name: 'xp',
  description: 'Configure per-guild XP and leveling system',
  category: "social",
};

const XP_SOURCES = [
  { name: 'message', value: 'xp_per_message' },
  { name: 'vc_minute', value: 'xp_per_vc_minute' },
  { name: 'work', value: 'xp_per_work' },
  { name: 'gather', value: 'xp_per_gather' },
  { name: 'fight_win', value: 'xp_per_fight_win' },
  { name: 'trivia_win', value: 'xp_per_trivia_win' },
  { name: 'daily', value: 'xp_per_daily' },
  { name: 'command', value: 'xp_per_command' },
  { name: 'agent_action', value: 'xp_per_agent_action' },
];

export const data = new SlashCommandBuilder()
  .setName('xp')
  .setDescription('⚡ Configure the XP and leveling system for this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommandGroup(g => g
    .setName('config')
    .setDescription('Manage XP configuration')
    .addSubcommand(s => s
      .setName('view')
      .setDescription('View the current XP configuration for this server'))
    .addSubcommand(s => s
      .setName('set')
      .setDescription('Set XP amount for a specific activity')
      .addStringOption(o => o.setName('source').setDescription('Activity type').setRequired(true)
        .addChoices(...XP_SOURCES.map(x => ({ name: x.name, value: x.value }))))
      .addIntegerOption(o => o.setName('amount').setDescription('XP amount (0 to disable)').setRequired(true).setMinValue(0).setMaxValue(500)))
    .addSubcommand(s => s
      .setName('multiplier')
      .setDescription('Set a global XP multiplier for this server')
      .addNumberOption(o => o.setName('value').setDescription('Multiplier (0.5–5.0)').setRequired(true).setMinValue(0.1).setMaxValue(5.0)))
    .addSubcommand(s => s
      .setName('toggle')
      .setDescription('Enable or disable the leveling system entirely')
      .addStringOption(o => o.setName('state').setDescription('on or off').setRequired(true)
        .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })))
    .addSubcommand(s => s
      .setName('sync')
      .setDescription('Sync global economy XP into guild XP')
      .addStringOption(o => o.setName('state').setDescription('on or off').setRequired(true)
        .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })))
    .addSubcommand(s => s
      .setName('levelup_channel')
      .setDescription('Set where level-up announcements are sent')
      .addChannelOption(o => o.setName('channel').setDescription('Announcement channel (leave empty to disable)').setRequired(false)))
    .addSubcommand(s => s
      .setName('levelup_message')
      .setDescription('Set the level-up announcement message')
      .addStringOption(o => o.setName('template').setDescription('Use {user} {level} {xp} as placeholders').setRequired(true).setMaxLength(200)))
    .addSubcommand(s => s
      .setName('preset')
      .setDescription('Apply a preset XP configuration')
      .addStringOption(o => o.setName('preset').setDescription('Preset name').setRequired(true)
        .addChoices(
          { name: 'Relaxed (easy leveling)', value: 'relaxed' },
          { name: 'Balanced (default)', value: 'balanced' },
          { name: 'Grind (slow, competitive)', value: 'grind' },
        )))
    .addSubcommand(s => s
      .setName('levelup_dm')
      .setDescription('Toggle DM notifications when a user levels up')
      .addStringOption(o => o.setName('state').setDescription('on or off').setRequired(true)
        .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })))
    .addSubcommand(s => s
      .setName('cooldown')
      .setDescription('Set the message XP cooldown to prevent spam')
      .addIntegerOption(o => o.setName('seconds').setDescription('Seconds between message XP awards (default: 60)').setRequired(true).setMinValue(10).setMaxValue(3600)))
  );

const PRESETS = {
  relaxed: {
    xp_per_message: 10, xp_per_vc_minute: 5, xp_per_work: 60, xp_per_gather: 45,
    xp_per_fight_win: 80, xp_per_trivia_win: 100, xp_per_daily: 150, xp_per_command: 2, xp_per_agent_action: 30,
  },
  balanced: {
    xp_per_message: 5, xp_per_vc_minute: 2, xp_per_work: 40, xp_per_gather: 30,
    xp_per_fight_win: 50, xp_per_trivia_win: 60, xp_per_daily: 80, xp_per_command: 1, xp_per_agent_action: 20,
  },
  grind: {
    xp_per_message: 2, xp_per_vc_minute: 1, xp_per_work: 20, xp_per_gather: 15,
    xp_per_fight_win: 25, xp_per_trivia_win: 30, xp_per_daily: 40, xp_per_command: 0, xp_per_agent_action: 10,
  },
};

const SOURCE_LABEL = {
  xp_per_message: '💬 Per Message',
  xp_per_vc_minute: '🎙️ Per VC Minute',
  xp_per_work: '💼 Work',
  xp_per_gather: '⛏️ Gather',
  xp_per_fight_win: '⚔️ Fight Win',
  xp_per_trivia_win: '🧠 Trivia Win',
  xp_per_daily: '📅 Daily Streak',
  xp_per_command: '🤖 Per Command',
  xp_per_agent_action: '🎭 Agent Action',
};

export async function execute(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
    return;
  }

  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (group === 'config') {
    await interaction.deferReply({ ephemeral: true });

    await withTimeout(interaction, async () => {
      const { getGuildXpConfig, upsertGuildXpConfig } = await import('../utils/storage.js');
      const guildId = interaction.guildId;

      if (sub === 'view') {
        const cfg = await getGuildXpConfig(guildId) || {};
        const embed = new EmbedBuilder()
          .setTitle('⚡ XP Configuration')
          .setColor(cfg.enabled === false ? Colors.Red : Colors.Blue)
          .setDescription(`**Leveling:** ${cfg.enabled === false ? '❌ Disabled' : '✅ Enabled'} | **Multiplier:** ${Number(cfg.xp_multiplier || 1).toFixed(1)}x | **Global XP Sync:** ${cfg.sync_global_xp === false ? 'off' : 'on'}`);

        const xpFields = XP_SOURCES.map(x => ({
          name: SOURCE_LABEL[x.value] || x.name,
          value: `**${cfg[x.value] ?? PRESETS.balanced[x.value]}** XP`,
          inline: true,
        }));
        embed.addFields(xpFields);
        embed.addFields(
          { name: '⏱️ Msg Cooldown', value: `${cfg.message_xp_cooldown_s ?? 60}s`, inline: true },
          { name: '📢 Level-up Channel', value: cfg.levelup_channel_id ? `<#${cfg.levelup_channel_id}>` : 'None', inline: true },
          { name: '📬 Level-up DMs', value: cfg.levelup_dm ? '✅ Enabled' : '❌ Disabled', inline: true },
          { name: '💬 Level-up Message', value: cfg.levelup_message || 'GG {user}, you hit **level {level}**! 🎉', inline: false },
        );
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (sub === 'set') {
        const field = interaction.options.getString('source');
        const amount = interaction.options.getInteger('amount');
        await upsertGuildXpConfig(guildId, { [field]: amount });
        const label = SOURCE_LABEL[field] || field;
        await interaction.editReply({ content: `✅ Set **${label}** to **${amount} XP**.` });
        return;
      }

      if (sub === 'multiplier') {
        const value = interaction.options.getNumber('value');
        await upsertGuildXpConfig(guildId, { xp_multiplier: value });
        await interaction.editReply({ content: `✅ XP multiplier set to **${value.toFixed(1)}x**.` });
        return;
      }

      if (sub === 'toggle') {
        const state = interaction.options.getString('state') === 'on';
        await upsertGuildXpConfig(guildId, { enabled: state });
        await interaction.editReply({ content: `✅ Leveling system is now **${state ? 'enabled' : 'disabled'}**.` });
        return;
      }

      if (sub === 'sync') {
        const state = interaction.options.getString('state') === 'on';
        await upsertGuildXpConfig(guildId, { sync_global_xp: state });
        await interaction.editReply({ content: `✅ Global XP sync is now **${state ? 'on' : 'off'}**.` });
        return;
      }

      if (sub === 'levelup_channel') {
        const channel = interaction.options.getChannel('channel');
        await upsertGuildXpConfig(guildId, { levelup_channel_id: channel?.id || null });
        await interaction.editReply({ content: channel ? `✅ Level-up announcements will be sent to ${channel}.` : '✅ Level-up channel cleared.' });
        return;
      }

      if (sub === 'levelup_message') {
        const template = interaction.options.getString('template');
        await upsertGuildXpConfig(guildId, { levelup_message: template });
        await interaction.editReply({ content: `✅ Level-up message set to:\n> ${template}` });
        return;
      }

      if (sub === 'levelup_dm') {
        const state = interaction.options.getString('state') === 'on';
        await upsertGuildXpConfig(guildId, { levelup_dm: state });
        await interaction.editReply({ content: `✅ Level-up DM notifications are now **${state ? 'enabled' : 'disabled'}**. Users will ${state ? '' : 'not '}receive a DM when they level up.` });
        return;
      }

      if (sub === 'preset') {
        const presetName = interaction.options.getString('preset');
        const preset = PRESETS[presetName];
        if (!preset) {
          await interaction.editReply({ content: '❌ Unknown preset.' });
          return;
        }
        await upsertGuildXpConfig(guildId, preset);
        const embed = new EmbedBuilder()
          .setTitle(`✅ Preset Applied: ${presetName.charAt(0).toUpperCase() + presetName.slice(1)}`)
          .setColor(Colors.Green)
          .setDescription('XP rates updated:')
          .addFields(Object.entries(preset).map(([k, v]) => ({
            name: SOURCE_LABEL[k] || k,
            value: `**${v}** XP`,
            inline: true,
          })));
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (sub === 'cooldown') {
        const seconds = interaction.options.getInteger('seconds');
        await upsertGuildXpConfig(guildId, { message_xp_cooldown_s: seconds });
        await interaction.editReply({ content: `✅ Message XP cooldown set to **${seconds}s**.` });
        return;
      }

      await interaction.editReply({ content: '❌ Unknown subcommand.' });
    }, { label: 'xp' });
  }
}
