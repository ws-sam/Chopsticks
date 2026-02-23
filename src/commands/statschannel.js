/**
 * /statschannel — Configure voice channels that auto-display server statistics.
 * The channel name updates every 10 minutes (Discord rate-limits channel renames to 2/10min).
 * Stats are stored in guild data under data.statsChannels.
 */
import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } from "discord.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";
import { botLogger } from "../utils/modernLogger.js";

export const meta = {
  category: "utility",
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageGuild],
};

const STAT_TYPES = {
  members:  { label: "Members",      icon: "👥", fn: g => g.memberCount },
  online:   { label: "Online",       icon: "🟢", fn: g => g.members.cache.filter(m => m.presence?.status === "online").size },
  bots:     { label: "Bots",         icon: "🤖", fn: g => g.members.cache.filter(m => m.user.bot).size },
  channels: { label: "Channels",     icon: "📢", fn: g => g.channels.cache.filter(c => c.type !== ChannelType.GuildCategory).size },
  roles:    { label: "Roles",        icon: "🏷️",  fn: g => g.roles.cache.size - 1 }, // minus @everyone
  boosts:   { label: "Boosts",       icon: "💎", fn: g => g.premiumSubscriptionCount ?? 0 },
};

export const data = new SlashCommandBuilder()
  .setName("statschannel")
  .setDescription("Configure auto-updating stats voice channels")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(sub =>
    sub.setName("set")
      .setDescription("Set a voice channel to display a specific stat")
      .addStringOption(opt =>
        opt.setName("type")
          .setDescription("Which stat to display")
          .setRequired(true)
          .addChoices(...Object.entries(STAT_TYPES).map(([k, v]) => ({ name: `${v.icon} ${v.label}`, value: k })))
      )
      .addChannelOption(opt =>
        opt.setName("channel")
          .setDescription("Voice channel to use (must be a voice channel)")
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName("clear")
      .setDescription("Remove a stats channel configuration")
      .addStringOption(opt =>
        opt.setName("type")
          .setDescription("Which stat to remove")
          .setRequired(true)
          .addChoices(...Object.entries(STAT_TYPES).map(([k, v]) => ({ name: `${v.icon} ${v.label}`, value: k })))
      )
  )
  .addSubcommand(sub =>
    sub.setName("list")
      .setDescription("Show all configured stats channels")
  );

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const { guild } = interaction;

  const data = await loadGuildData(guild.id);
  data.statsChannels = data.statsChannels || {};

  if (sub === "list") {
    const entries = Object.entries(data.statsChannels);
    if (!entries.length) {
      return interaction.reply({ content: "No stats channels configured yet. Use `/statschannel set` to add one.", ephemeral: true });
    }
    const embed = new EmbedBuilder()
      .setTitle("📊 Stats Channels")
      .setColor(0x5865f2)
      .setDescription(
        entries.map(([type, channelId]) => {
          const def = STAT_TYPES[type];
          return `${def?.icon ?? "📊"} **${def?.label ?? type}** → <#${channelId}>`;
        }).join("\n")
      )
      .setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === "clear") {
    const type = interaction.options.getString("type", true);
    if (!data.statsChannels[type]) {
      return interaction.reply({ content: `No **${STAT_TYPES[type]?.label ?? type}** stat channel is configured.`, ephemeral: true });
    }
    delete data.statsChannels[type];
    await saveGuildData(guild.id, data);
    return interaction.reply({ content: `✅ Removed **${STAT_TYPES[type]?.label ?? type}** stats channel.`, ephemeral: true });
  }

  // sub === "set"
  const type = interaction.options.getString("type", true);
  const channel = interaction.options.getChannel("channel", true);
  const def = STAT_TYPES[type];

  const me = guild.members.me;
  if (!me?.permissionsIn(channel).has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({ content: `❌ I need **Manage Channels** permission in ${channel} to rename it.`, ephemeral: true });
  }

  data.statsChannels[type] = channel.id;
  await saveGuildData(guild.id, data);

  // Do an immediate update
  try {
    const value = def.fn(guild);
    await channel.setName(`${def.icon} ${def.label}: ${value}`, "statschannel set").catch(() => {});
  } catch {}

  const embed = new EmbedBuilder()
    .setTitle("✅ Stats Channel Set")
    .setDescription(`${def.icon} **${def.label}** will auto-update in ${channel}\nUpdates every ~10 minutes (Discord rate limit).`)
    .setColor(0x57f287)
    .setTimestamp();

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * Called by the main bot on a 10-minute interval to refresh all stats channels.
 * @param {import('discord.js').Client} client
 */
export async function refreshStatsChannels(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const data = await loadGuildData(guild.id);
      const entries = Object.entries(data.statsChannels || {});
      if (!entries.length) continue;

      // Fetch member list for accurate presence data
      await guild.members.fetch().catch(() => {});

      for (const [type, channelId] of entries) {
        const def = STAT_TYPES[type];
        if (!def) continue;
        const channel = guild.channels.cache.get(channelId);
        if (!channel || channel.type !== ChannelType.GuildVoice) continue;
        try {
          const value = def.fn(guild);
          const newName = `${def.icon} ${def.label}: ${value}`;
          if (channel.name !== newName) {
            await channel.setName(newName, "statschannel refresh").catch(() => {});
          }
        } catch {}
      }
    } catch (err) {
      botLogger.debug({ err, guildId: guild.id }, "[statschannel] refresh error");
    }
  }
}
