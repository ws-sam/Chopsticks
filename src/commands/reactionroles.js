import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags
} from "discord.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";
import {
  normalizeEmojiInput,
  reactionRoleBindingKey,
  normalizeReactionRoleConfig,
  listReactionRoleBindings,
  formatEmojiLabel
} from "../utils/reactionRoles.js";
import { Colors } from "../utils/discordOutput.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = {
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageRoles],
  category: "admin"
};

function createEmbed(title, description, color = Colors.INFO) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(String(description || ""))
    .setColor(color)
    .setTimestamp();
}

function messageLink(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

async function ensureMessageExists(channel, messageId) {
  try {
    await channel.messages.fetch(messageId);
    return true;
  } catch {
    return false;
  }
}

function getBotRoleCheck(interaction, role) {
  const me = interaction.guild?.members?.me;
  if (!me) return { ok: false, reason: "Could not resolve bot member state in this guild." };
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, reason: "Bot is missing `Manage Roles` permission." };
  }
  if (role.managed) {
    return { ok: false, reason: "Managed/integration roles cannot be assigned." };
  }
  if (me.roles.highest.comparePositionTo(role) <= 0) {
    return { ok: false, reason: "That role is above the bot's highest role." };
  }
  return { ok: true };
}

export const data = new SlashCommandBuilder()
  .setName("reactionroles")
  .setDescription("Configure reaction role automations")
  .addSubcommand(sub =>
    sub
      .setName("add")
      .setDescription("Bind one emoji reaction on a message to a role")
      .addChannelOption(o => o.setName("channel").setDescription("Channel containing the message").setRequired(true))
      .addStringOption(o => o.setName("message_id").setDescription("Target message ID").setRequired(true))
      .addStringOption(o => o.setName("emoji").setDescription("Emoji (unicode, <:name:id>, or emoji id)").setRequired(true))
      .addRoleOption(o => o.setName("role").setDescription("Role to grant/remove with this reaction").setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName("remove")
      .setDescription("Remove one reaction role binding")
      .addChannelOption(o => o.setName("channel").setDescription("Channel containing the message").setRequired(true))
      .addStringOption(o => o.setName("message_id").setDescription("Target message ID").setRequired(true))
      .addStringOption(o => o.setName("emoji").setDescription("Emoji used in the binding").setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName("list")
      .setDescription("List reaction role bindings for this server")
      .addChannelOption(o => o.setName("channel").setDescription("Optional channel filter").setRequired(false))
      .addStringOption(o => o.setName("message_id").setDescription("Optional message filter").setRequired(false))
  )
  .addSubcommand(sub =>
    sub
      .setName("clear_message")
      .setDescription("Remove all reaction role bindings for one message")
      .addChannelOption(o => o.setName("channel").setDescription("Channel containing the message").setRequired(true))
      .addStringOption(o => o.setName("message_id").setDescription("Target message ID").setRequired(true))
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand(true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await withTimeout(interaction, async () => {

    const guildId = interaction.guildId;
    const guildData = normalizeReactionRoleConfig(await loadGuildData(guildId));
    const bindings = guildData.reactionRoles.bindings;

    if (sub === "add") {
      const channel = interaction.options.getChannel("channel", true);
      const messageId = interaction.options.getString("message_id", true).trim();
      const emojiRaw = interaction.options.getString("emoji", true);
      const role = interaction.options.getRole("role", true);

      if (!channel?.isTextBased?.()) {
        await interaction.editReply({
          embeds: [createEmbed("Invalid Channel", "Choose a text channel that contains the message.", Colors.ERROR)]
        });
        return;
      }

      const emojiKey = normalizeEmojiInput(emojiRaw);
      if (!emojiKey) {
        await interaction.editReply({
          embeds: [createEmbed("Invalid Emoji", "Provide a valid emoji (unicode or custom emoji id).", Colors.ERROR)]
        });
        return;
      }

      const roleCheck = getBotRoleCheck(interaction, role);
      if (!roleCheck.ok) {
        await interaction.editReply({
          embeds: [createEmbed("Role Assignment Blocked", roleCheck.reason, Colors.ERROR)]
        });
        return;
      }

      const messageOk = await ensureMessageExists(channel, messageId);
      if (!messageOk) {
        await interaction.editReply({
          embeds: [createEmbed("Message Not Found", "Could not fetch that message in the selected channel.", Colors.ERROR)]
        });
        return;
      }

      const key = reactionRoleBindingKey(channel.id, messageId, emojiKey);
      bindings[key] = {
        channelId: channel.id,
        messageId,
        emojiKey,
        roleId: role.id,
        createdBy: interaction.user.id,
        createdAt: Date.now()
      };

      await saveGuildData(guildId, guildData);

      await interaction.editReply({
        embeds: [
          createEmbed(
            "Reaction Role Added",
            `Emoji: ${formatEmojiLabel(emojiKey)}\nRole: <@&${role.id}>\nMessage: [Jump to message](${messageLink(guildId, channel.id, messageId)})`,
            Colors.SUCCESS
          )
        ]
      });
      return;
    }

    if (sub === "remove") {
      const channel = interaction.options.getChannel("channel", true);
      const messageId = interaction.options.getString("message_id", true).trim();
      const emojiRaw = interaction.options.getString("emoji", true);
      const emojiKey = normalizeEmojiInput(emojiRaw);
      const key = reactionRoleBindingKey(channel.id, messageId, emojiKey);

      if (!emojiKey || !key || !bindings[key]) {
        await interaction.editReply({
          embeds: [createEmbed("Binding Not Found", "No matching reaction role binding exists.", Colors.WARNING)]
        });
        return;
      }

      const removed = bindings[key];
      delete bindings[key];
      await saveGuildData(guildId, guildData);

      await interaction.editReply({
        embeds: [
          createEmbed(
            "Reaction Role Removed",
            `Removed ${formatEmojiLabel(removed.emojiKey)} -> <@&${removed.roleId}> on [message](${messageLink(guildId, removed.channelId, removed.messageId)}).`,
            Colors.SUCCESS
          )
        ]
      });
      return;
    }

    if (sub === "clear_message") {
      const channel = interaction.options.getChannel("channel", true);
      const messageId = interaction.options.getString("message_id", true).trim();
      const all = Object.entries(bindings);
      const removeKeys = all
        .filter(([, v]) => String(v?.channelId) === String(channel.id) && String(v?.messageId) === messageId)
        .map(([k]) => k);

      if (!removeKeys.length) {
        await interaction.editReply({
          embeds: [createEmbed("Nothing To Clear", "No bindings found for that message.", Colors.WARNING)]
        });
        return;
      }

      for (const k of removeKeys) delete bindings[k];
      await saveGuildData(guildId, guildData);

      await interaction.editReply({
        embeds: [
          createEmbed(
            "Bindings Cleared",
            `Removed **${removeKeys.length}** binding(s) for [message](${messageLink(guildId, channel.id, messageId)}).`,
            Colors.SUCCESS
          )
        ]
      });
      return;
    }

    const channelFilter = interaction.options.getChannel("channel", false);
    const messageFilter = interaction.options.getString("message_id", false)?.trim() || null;
    const items = listReactionRoleBindings(guildData)
      .filter(v => (channelFilter ? String(v.channelId) === String(channelFilter.id) : true))
      .filter(v => (messageFilter ? String(v.messageId) === messageFilter : true))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

    if (!items.length) {
      await interaction.editReply({
        embeds: [createEmbed("No Reaction Roles", "No reaction role bindings configured for this filter.", Colors.INFO)]
      });
      return;
    }

    const lines = items.slice(0, 20).map((v, idx) => {
      const link = messageLink(guildId, v.channelId, v.messageId);
      return `${idx + 1}. ${formatEmojiLabel(v.emojiKey)} -> <@&${v.roleId}> • [message](${link})`;
    });

    await interaction.editReply({
      embeds: [
        createEmbed("Reaction Role Bindings", lines.join("\n"), Colors.INFO).setFooter({
          text: items.length > 20
            ? `Showing 20 of ${items.length} bindings`
            : `${items.length} binding${items.length === 1 ? "" : "s"}`
        })
      ]
    });
  }, { label: "reactionroles" });
}

export default { data, execute, meta };
