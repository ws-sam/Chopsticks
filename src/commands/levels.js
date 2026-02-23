import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags
} from "discord.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";
import { Colors } from "../utils/discordOutput.js";
import {
  listLevelRoleRewards,
  setLevelRoleReward,
  removeLevelRoleReward,
  syncMemberLevelRoleRewards
} from "../game/levelRewards.js";
import { getGameProfile } from "../game/profile.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = {
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageRoles],
  category: "admin"
};

function buildEmbed(title, description, color = Colors.INFO) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(String(description || ""))
    .setColor(color)
    .setTimestamp();
}

export const data = new SlashCommandBuilder()
  .setName("levels")
  .setDescription("Level rewards and progression tools")
  .addSubcommandGroup(group =>
    group
      .setName("rewards")
      .setDescription("Manage level role rewards")
      .addSubcommand(sub =>
        sub
          .setName("add")
          .setDescription("Assign a role reward to a level")
          .addIntegerOption(o => o.setName("level").setDescription("Level threshold (1-1000)").setRequired(true).setMinValue(1).setMaxValue(1000))
          .addRoleOption(o => o.setName("role").setDescription("Role to grant at this level").setRequired(true))
      )
      .addSubcommand(sub =>
        sub
          .setName("remove")
          .setDescription("Remove role reward for a level")
          .addIntegerOption(o => o.setName("level").setDescription("Level threshold to remove").setRequired(true).setMinValue(1).setMaxValue(1000))
      )
      .addSubcommand(sub =>
        sub
          .setName("list")
          .setDescription("List configured level rewards")
      )
      .addSubcommand(sub =>
        sub
          .setName("sync")
          .setDescription("Force role reward sync for a member")
          .addUserOption(o => o.setName("user").setDescription("Member to sync (default: you)").setRequired(false))
      )
  )
  .addSubcommandGroup(group =>
    group
      .setName("config")
      .setDescription("Configure level-up notifications")
      .addSubcommand(sub =>
        sub
          .setName("levelup_channel")
          .setDescription("Set the channel for level-up embeds")
          .addChannelOption(o => o.setName("channel").setDescription("Text channel to send embeds").setRequired(true))
      )
      .addSubcommand(sub =>
        sub
          .setName("levelup_message")
          .setDescription("Set the level-up message template (use {user}, {fromLevel}, {toLevel})")
          .addStringOption(o => o.setName("message").setDescription("Message template").setRequired(true))
      )
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

export async function execute(interaction) {
  const group = interaction.options.getSubcommandGroup(true);
  const sub = interaction.options.getSubcommand(true);
  if (group !== "rewards" && group !== "config") {
    await interaction.reply({
      embeds: [buildEmbed("Unsupported Action", "Supported actions: `rewards`, `config`.", Colors.WARNING)],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await withTimeout(interaction, async () => {
    const guildId = interaction.guildId;
    const guildData = await loadGuildData(guildId);
    guildData.levels ??= {};
    guildData.levels.roleRewards ??= {};

    if (group === "config") {
      if (sub === "levelup_channel") {
        const channel = interaction.options.getChannel("channel", true);
        guildData.levels.levelupChannelId = channel?.id || null;
        await saveGuildData(guildId, guildData);
        await interaction.editReply({ embeds: [buildEmbed("Level Up Channel Set", `Level-up embeds will be posted in ${channel}.`, Colors.SUCCESS)] });
        return;
      }
      if (sub === "levelup_message") {
        const msg = interaction.options.getString("message", true);
        guildData.levels.levelupMessage = String(msg || "");
        await saveGuildData(guildId, guildData);
        await interaction.editReply({ embeds: [buildEmbed("Level Up Message Set", `Custom level-up message template saved. Use {user}, {fromLevel}, {toLevel}.`, Colors.SUCCESS)] });
        return;
      }
    }

    if (sub === "add") {
      const level = interaction.options.getInteger("level", true);
      const role = interaction.options.getRole("role", true);
      const me = interaction.guild?.members?.me;

      if (!me || !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        await interaction.editReply({
          embeds: [buildEmbed("Missing Bot Permission", "Bot needs `Manage Roles` to apply level rewards.", Colors.ERROR)]
        });
        return;
      }
      if (role.managed || me.roles.highest.comparePositionTo(role) <= 0) {
        await interaction.editReply({
          embeds: [buildEmbed("Role Not Assignable", "That role is managed or above the bot's highest role.", Colors.ERROR)]
        });
        return;
      }

      setLevelRoleReward(guildData, level, role.id);
      await saveGuildData(guildId, guildData);
      await interaction.editReply({
        embeds: [
          buildEmbed(
            "Level Reward Added",
            `Level **${level}** now grants ${role}.`,
            Colors.SUCCESS
          )
        ]
      });
      return;
    }

    if (sub === "remove") {
      const level = interaction.options.getInteger("level", true);
      const removed = removeLevelRoleReward(guildData, level);
      if (!removed) {
        await interaction.editReply({
          embeds: [buildEmbed("Nothing Removed", `No reward is configured at level **${level}**.`, Colors.WARNING)]
        });
        return;
      }
      await saveGuildData(guildId, guildData);
      await interaction.editReply({
        embeds: [buildEmbed("Level Reward Removed", `Removed reward mapping for level **${level}**.`, Colors.SUCCESS)]
      });
      return;
    }

    if (sub === "list") {
      const rewards = listLevelRoleRewards(guildData);
      if (!rewards.length) {
        await interaction.editReply({
          embeds: [
            buildEmbed(
              "No Level Rewards",
              "No level role rewards configured.\nUse `/levels rewards add` to add one.",
              Colors.INFO
            )
          ]
        });
        return;
      }

      const lines = rewards.map(r => {
        const exists = interaction.guild.roles.cache.has(r.roleId);
        return `• Level **${r.level}** -> <@&${r.roleId}>${exists ? "" : " (missing role)"}`;
      });

      await interaction.editReply({
        embeds: [
          buildEmbed("Level Role Rewards", lines.join("\n"), Colors.INFO).setFooter({
            text: `${rewards.length} reward mapping${rewards.length === 1 ? "" : "s"}`
          })
        ]
      });
      return;
    }

    const user = interaction.options.getUser("user", false) || interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      await interaction.editReply({
        embeds: [buildEmbed("Member Not Found", "Could not find that member in this server.", Colors.ERROR)]
      });
      return;
    }

    const profile = await getGameProfile(member.id);
    const res = await syncMemberLevelRoleRewards(member, { guildData, level: profile.level });
    await interaction.editReply({
      embeds: [
        buildEmbed(
          "Level Rewards Synced",
          `Member: <@${member.id}>\nLevel: **${profile.level}**\nAdded: **${res.added || 0}**\nRemoved: **${res.removed || 0}**\nSkipped: **${res.skipped || 0}**`,
          Colors.SUCCESS
        )
      ]
    });
  }, { label: "levels" });
}

export default { data, execute, meta };
