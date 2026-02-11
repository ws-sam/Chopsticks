// src/tools/voice/commands.js
// UI-ONLY COMMAND DEFINITION

import {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits
} from "discord.js";

import * as VoiceDomain from "./domain.js";
import { auditLog } from "../../utils/audit.js";

export const data = new SlashCommandBuilder()
  .setName("voice")
  .setDescription("Join-to-create voice channel configuration")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

  .addSubcommand(sub =>
    sub
      .setName("add")
      .setDescription("Register a lobby channel")
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Voice channel users join")
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true)
      )
      .addChannelOption(o =>
        o
          .setName("category")
          .setDescription("Category to create temp channels in")
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true)
      )
      .addStringOption(o =>
        o
          .setName("template")
          .setDescription("Channel name template (use {user})")
      )
      .addIntegerOption(o =>
        o
          .setName("user_limit")
          .setDescription("User limit for temp channels (0 = unlimited)")
          .setMinValue(0)
          .setMaxValue(99)
      )
      .addIntegerOption(o =>
        o
          .setName("bitrate_kbps")
          .setDescription("Bitrate for temp channels (kbps)")
          .setMinValue(8)
          .setMaxValue(512)
      )
  )

  .addSubcommand(sub =>
    sub
      .setName("remove")
      .setDescription("Remove a lobby channel")
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Lobby channel to remove")
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true)
      )
  )

  .addSubcommand(sub =>
    sub
      .setName("enable")
      .setDescription("Enable a lobby channel")
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Lobby channel to enable")
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true)
      )
  )

  .addSubcommand(sub =>
    sub
      .setName("disable")
      .setDescription("Disable a lobby channel")
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Lobby channel to disable")
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true)
      )
  )

  .addSubcommand(sub =>
    sub
      .setName("update")
      .setDescription("Update lobby settings")
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Lobby channel to update")
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true)
      )
      .addStringOption(o =>
        o
          .setName("template")
          .setDescription("Channel name template (use {user})")
      )
      .addIntegerOption(o =>
        o
          .setName("user_limit")
          .setDescription("User limit for temp channels (0 = unlimited)")
          .setMinValue(0)
          .setMaxValue(99)
      )
      .addIntegerOption(o =>
        o
          .setName("bitrate_kbps")
          .setDescription("Bitrate for temp channels (kbps)")
          .setMinValue(8)
          .setMaxValue(512)
      )
  )

  .addSubcommand(sub =>
    sub
      .setName("status")
      .setDescription("Show current voice configuration")
  )

  .addSubcommand(sub =>
    sub
      .setName("reset")
      .setDescription("Reset all voice configuration")
  );

export async function execute(interaction) {
  if (!interaction.inGuild()) return;

  const guildId = interaction.guildId;
  const sub = interaction.options.getSubcommand();

  if (sub === "add") {
    const category = interaction.options.getChannel("category");
    const me = interaction.guild?.members?.me ?? (await interaction.guild?.members?.fetchMe().catch(() => null));
    if (me) {
      const perms = category.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.ManageChannels) || !perms?.has(PermissionFlagsBits.MoveMembers)) {
        await interaction.reply({
          content: "❌ Missing permissions in that category (Manage Channels + Move Members required).",
          ephemeral: true
        });
        return;
      }
    }
    const res = await VoiceDomain.addLobby(
      guildId,
      interaction.options.getChannel("channel").id,
      category.id,
      interaction.options.getString("template") ?? "{user}'s room",
      {
        userLimit: interaction.options.getInteger("user_limit"),
        bitrateKbps: interaction.options.getInteger("bitrate_kbps")
      }
    );
    await auditLog({
      guildId,
      userId: interaction.user.id,
      action: "voice.lobby.add",
      details: res
    });
    await interaction.reply({ content: JSON.stringify(res), ephemeral: true });
    return;
  }

  if (sub === "remove") {
    const res = await VoiceDomain.removeLobby(
      guildId,
      interaction.options.getChannel("channel").id
    );
    await auditLog({
      guildId,
      userId: interaction.user.id,
      action: "voice.lobby.remove",
      details: res
    });
    await interaction.reply({ content: JSON.stringify(res), ephemeral: true });
    return;
  }

  if (sub === "enable" || sub === "disable") {
    const res = await VoiceDomain.setLobbyEnabled(
      guildId,
      interaction.options.getChannel("channel").id,
      sub === "enable"
    );
    await auditLog({
      guildId,
      userId: interaction.user.id,
      action: `voice.lobby.${sub}`,
      details: res
    });
    await interaction.reply({ content: JSON.stringify(res), ephemeral: true });
    return;
  }

  if (sub === "update") {
    const res = await VoiceDomain.updateLobby(
      guildId,
      interaction.options.getChannel("channel").id,
      {
        template: interaction.options.getString("template") ?? undefined,
        userLimit: interaction.options.getInteger("user_limit"),
        bitrateKbps: interaction.options.getInteger("bitrate_kbps")
      }
    );
    await auditLog({
      guildId,
      userId: interaction.user.id,
      action: "voice.lobby.update",
      details: res
    });
    await interaction.reply({ content: JSON.stringify(res), ephemeral: true });
    return;
  }

  if (sub === "status") {
    const res = await VoiceDomain.getStatus(guildId);
    await interaction.reply({
      content: "```json\n" + JSON.stringify(res, null, 2) + "\n```",
      ephemeral: true
    });
    return;
  }

  if (sub === "reset") {
    const res = await VoiceDomain.resetVoice(guildId);
    await interaction.reply({ content: JSON.stringify(res), ephemeral: true });
  }
}
