import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from "discord.js";
import { replyModError, replyModSuccess } from "../moderation/output.js";
import { dispatchModerationLog } from "../utils/modLogs.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";

export const meta = {
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageChannels],
  category: "mod"
};

export const data = new SlashCommandBuilder()
  .setName("lockdown")
  .setDescription("Lock or unlock channel(s)")
  .addSubcommand(sub =>
    sub
      .setName("start")
      .setDescription("Lock channel(s)")
      .addChannelOption(o =>
        o.setName("category").setDescription("Category to lock all text channels in").setRequired(false)
      )
      .addStringOption(o =>
        o.setName("reason").setDescription("Reason for lockdown").setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName("end")
      .setDescription("Unlock previously locked channel(s)")
      .addChannelOption(o =>
        o.setName("category").setDescription("Category to unlock (optional)").setRequired(false)
      )
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildData = await loadGuildData(interaction.guildId);
  if (!Array.isArray(guildData.lockedChannels)) guildData.lockedChannels = [];

  if (sub === "start") {
    const categoryChannel = interaction.options.getChannel("category");
    const reason = interaction.options.getString("reason") || "Lockdown initiated";

    let channelsToLock = [];

    if (categoryChannel && categoryChannel.type === ChannelType.GuildCategory) {
      channelsToLock = interaction.guild.channels.cache
        .filter(c => c.parentId === categoryChannel.id && c.isTextBased?.())
        .map(c => c);
    } else {
      if (interaction.channel?.isTextBased?.()) {
        channelsToLock = [interaction.channel];
      }
    }

    if (channelsToLock.length === 0) {
      await replyModError(interaction, {
        title: "Lockdown Failed",
        summary: "No text channels found to lock."
      });
      return;
    }

    const locked = [];
    for (const ch of channelsToLock) {
      try {
        await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
        if (!guildData.lockedChannels.includes(ch.id)) {
          guildData.lockedChannels.push(ch.id);
        }
        locked.push(ch.id);
      } catch {
        // skip channels we cannot lock
      }
    }

    await saveGuildData(interaction.guildId, guildData);

    await replyModSuccess(interaction, {
      title: "Lockdown Started",
      summary: `🔒 Locked ${locked.length} channel(s). Use \`/lockdown end\` to restore.`,
      fields: [{ name: "Reason", value: reason }]
    });

    await dispatchModerationLog(interaction.guild, {
      action: "lock",
      ok: true,
      actorId: interaction.user.id,
      actorTag: interaction.user.tag,
      reason,
      summary: `Lockdown started: ${locked.length} channel(s) locked.`,
      commandName: "lockdown",
      channelId: interaction.channelId,
      details: { channels: locked.join(", ") }
    });
  } else if (sub === "end") {
    const toRestore = [...guildData.lockedChannels];
    let count = 0;

    for (const channelId of toRestore) {
      try {
        const ch = await interaction.guild.channels.fetch(channelId).catch(() => null);
        if (ch?.permissionOverwrites) {
          await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
          count++;
        }
      } catch {
        // skip channels no longer accessible
      }
    }

    guildData.lockedChannels = [];
    await saveGuildData(interaction.guildId, guildData);

    await replyModSuccess(interaction, {
      title: "Lockdown Ended",
      summary: `🔓 ${count} channel(s) unlocked.`
    });

    await dispatchModerationLog(interaction.guild, {
      action: "unlock",
      ok: true,
      actorId: interaction.user.id,
      actorTag: interaction.user.tag,
      reason: "Lockdown ended",
      summary: `Lockdown ended: ${count} channel(s) unlocked.`,
      commandName: "lockdown",
      channelId: interaction.channelId
    });
  }
}
