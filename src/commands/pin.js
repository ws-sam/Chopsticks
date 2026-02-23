import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { replySuccess, replyError } from "../utils/discordOutput.js";

export const meta = {
  category: "tools",
  userPerms: ["ManageMessages"],
  guildOnly: true,
  deployGlobal: false,
};

/**
 * Validate a Discord message snowflake ID.
 * @returns {boolean}
 */
export function validateMessageId(id) {
  return typeof id === "string" && /^\d{17,20}$/.test(id);
}

export const data = new SlashCommandBuilder()
  .setName("pin")
  .setDescription("Pin or unpin a message in the current channel")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addSubcommand(sub =>
    sub.setName("add")
      .setDescription("Pin a message by its ID")
      .addStringOption(o =>
        o.setName("message_id").setDescription("The ID of the message to pin").setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName("remove")
      .setDescription("Unpin a message by its ID")
      .addStringOption(o =>
        o.setName("message_id").setDescription("The ID of the message to unpin").setRequired(true)
      )
  );

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const messageId = interaction.options.getString("message_id", true);

  if (!validateMessageId(messageId)) {
    return replyError(interaction, "Invalid message ID. Provide a valid Discord message snowflake ID.");
  }

  try {
    const message = await interaction.channel.messages.fetch(messageId);

    if (sub === "add") {
      await message.pin();
      return replySuccess(interaction, "📌 Message pinned successfully.");
    }

    if (sub === "remove") {
      await message.unpin();
      return replySuccess(interaction, "📌 Message unpinned successfully.");
    }
  } catch (err) {
    // Unknown Message (10008) — invalid or not-found message ID
    if (err?.code === 10008 || err?.message?.includes("Unknown Message")) {
      return replyError(interaction, "Message not found. Check the ID and make sure it belongs to this channel.");
    }
    // Discord 400 / code 30003 — maximum pins reached (50)
    if (err?.status === 400 || err?.code === 30003) {
      return replyError(interaction, "Pin limit reached. This channel already has 50 pinned messages. Remove a pin first.");
    }
    return replyError(interaction, `Could not ${sub} message: ${err?.message ?? "Unknown error"}`);
  }
}
