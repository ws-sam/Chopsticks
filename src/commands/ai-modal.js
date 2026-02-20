// src/commands/ai-modal.js
// Provides the handleAiModal export for modal dispatch (see index.js).
// Also exposes a minimal admin-only slash command as required by the command module contract.

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

export const meta = {
  guildOnly: true,
  category: "ai",
  description: "Internal handler — use /ai token link to link your API key.",
};

// Minimal command so the module satisfies the command-module audit.
// Hidden from regular users; the real user-facing flow is /ai token link.
export const data = new SlashCommandBuilder()
  .setName("ai-modal")
  .setDescription("(Internal) AI token-link modal handler — use /ai token link instead")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  return interaction.reply({
    content: "This command is not intended for direct use. Please use `/ai token link` instead.",
    ephemeral: true,
  });
}

// Re-export the real modal handler from ai.js for backward-compat imports.
export { handleAiModal } from "./ai.js";
