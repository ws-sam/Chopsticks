import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { botLogger } from "../utils/modernLogger.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = {
  category: "utility",
  guildOnly: true,
  userPerms: [],
};

export const data = new SlashCommandBuilder()
  .setName("colorrole")
  .setDescription("Manage your personal color role")
  .addSubcommand(sub =>
    sub.setName("set")
      .setDescription("Set your color role to a hex color (creates it if needed)")
      .addStringOption(opt =>
        opt.setName("hex")
          .setDescription("Hex color code (e.g. #5865F2 or 5865F2)")
          .setRequired(true)
          .setMaxLength(7)
      )
  )
  .addSubcommand(sub =>
    sub.setName("clear")
      .setDescription("Remove your color role")
  );

const COLOR_ROLE_PREFIX = "🎨color:";

function parseHex(raw) {
  const hex = raw.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return `#${hex.toUpperCase()}`;
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  const member = interaction.member;

  const me = guild.members.me;
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return interaction.reply({ content: "❌ I need the **Manage Roles** permission to do that.", ephemeral: true });
  }

  const roleName = `${COLOR_ROLE_PREFIX}${interaction.user.id}`;

  if (sub === "clear") {
    const existing = guild.roles.cache.find(r => r.name === roleName);
    if (existing) {
      try {
        await member.roles.remove(existing);
        // Delete role if no one else has it
        if (existing.members.size === 0) await existing.delete("colorrole clear").catch(() => {});
      } catch (err) {
        botLogger.warn({ err }, "[colorrole] clear failed");
        return interaction.reply({ content: "❌ Failed to remove color role. Check my role hierarchy.", ephemeral: true });
      }
    }
    return interaction.reply({
      embeds: [new EmbedBuilder().setDescription("✅ Color role removed.").setColor(0x57f287)],
      ephemeral: true
    });
  }

  // sub === "set"
  const raw = interaction.options.getString("hex", true);
  const hex = parseHex(raw);
  if (!hex) {
    return interaction.reply({ content: "❌ Invalid hex color. Use `#RRGGBB` format (e.g. `#5865F2`).", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  await withTimeout(interaction, async () => {
    const colorInt = parseInt(hex.slice(1), 16);

    try {
      let role = guild.roles.cache.find(r => r.name === roleName);

      if (role) {
        // Update existing role color
        await role.edit({ color: colorInt, reason: "colorrole set" });
      } else {
        // Create new color role below the bot's highest role
        const botHighestPos = me.roles.highest.position;
        role = await guild.roles.create({
          name: roleName,
          color: colorInt,
          reason: `colorrole for ${interaction.user.tag}`,
          position: Math.max(1, botHighestPos - 1),
          hoist: false,
          mentionable: false,
        });
      }

      // Assign to member if not already present
      if (!member.roles.cache.has(role.id)) {
        await member.roles.add(role);
      }

      const embed = new EmbedBuilder()
        .setTitle("🎨 Color Role Set")
        .setDescription(`Your color is now **${hex}**`)
        .setColor(colorInt)
        .setFooter({ text: "Use /colorrole clear to remove it" })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      botLogger.warn({ err }, "[colorrole] set failed");
      return interaction.editReply({ content: "❌ Failed to set color role. Check my role position and permissions." });
    }
  }, { label: "colorrole" });
}
