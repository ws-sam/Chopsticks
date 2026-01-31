// src/tools/voice/commands.js
import {
  SlashCommandBuilder,
  ChannelType
} from "discord.js";

import {
  addLobby,
  removeLobby,
  resetVoice,
  getStatus
} from "./controller.js";

export const voiceCommand = {
  data: new SlashCommandBuilder()
    .setName("voice")
    .setDescription("Voice management")
    .addSubcommand(sub =>
      sub
        .setName("lobby-add")
        .setDescription("Register a voice lobby")
        .addChannelOption(opt =>
          opt
            .setName("channel")
            .setDescription("Lobby voice channel")
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(true)
        )
        .addChannelOption(opt =>
          opt
            .setName("category")
            .setDescription("Category for temp channels")
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("lobby-remove")
        .setDescription("Remove a voice lobby")
        .addChannelOption(opt =>
          opt
            .setName("channel")
            .setDescription("Lobby voice channel")
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("reset")
        .setDescription("Reset all voice configuration")
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription("Show voice configuration")
    ),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

// SUBCOMMAND HANDLERS

    if (sub === "lobby-add") {
  const channel = interaction.options.getChannel("channel");
  const category = interaction.options.getChannel("category");

  const added = await addLobby(guildId, channel.id, category.id);

  if (!added) {
    return interaction.reply({
      content: "That voice lobby is already registered",
      flags: 64
    });
  }

  return interaction.reply({
    content: "Voice lobby added",
    flags: 64
  });
}

    if (sub === "lobby-remove") {
      const channel = interaction.options.getChannel("channel");

      const removed = await removeLobby(guildId, channel.id);

      if (!removed) {
        return interaction.reply({
          content: "No voice lobby configured",
          flags: 64
        });
      }

      return interaction.reply({
        content: "Voice lobby removed",
        flags: 64
      });
    }

    if (sub === "reset") {
      await resetVoice(guildId);

      return interaction.reply({
        content: "Voice configuration reset",
        flags: 64
      });
    }

    if (sub === "status") {
      const status = await getStatus(guildId);

      return interaction.reply({
        content: "```json\n" + JSON.stringify(status, null, 2) + "\n```",
        flags: 64
      });
    }
  }
};
