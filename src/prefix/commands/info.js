import { EmbedBuilder } from "discord.js";
import { reply } from "../helpers.js";
import COLORS from "../../utils/colors.js";

export default [
  {
    name: "serverinfo",
    aliases: ["si", "server", "guildinfo"],
    guildOnly: true,
    rateLimit: 5000,
    async execute(message) {
      const g = message.guild;
      const owner = await g.fetchOwner().catch(() => null);
      const embed = new EmbedBuilder()
        .setTitle(`📋 ${g.name}`)
        .setThumbnail(g.iconURL({ size: 128 }) || null)
        .setColor(COLORS.INFO)
        .addFields(
          { name: "👑 Owner", value: owner?.user.tag ?? "Unknown", inline: true },
          { name: "👥 Members", value: String(g.memberCount), inline: true },
          { name: "💬 Channels", value: String(g.channels.cache.size), inline: true },
          { name: "🏷️ Roles", value: String(g.roles.cache.size), inline: true },
          { name: "✨ Boost Level", value: String(g.premiumTier), inline: true },
          { name: "🆔 ID", value: g.id, inline: true },
        )
        .setFooter({ text: `Created ${g.createdAt.toDateString()}` });
      await message.reply({ embeds: [embed] });
    }
  },
  {
    name: "userinfo",
    aliases: ["ui", "whois", "user"],
    rateLimit: 3000,
    async execute(message, args) {
      const id = args[0]?.replace(/[<@!>]/g, "") || message.author.id;
      const user = await message.client.users.fetch(id).catch(() => null);
      if (!user) return reply(message, "❌ User not found.");
      const member = message.guild?.members.cache.get(id) ?? null;
      const embed = new EmbedBuilder()
        .setTitle(user.tag)
        .setThumbnail(user.displayAvatarURL({ size: 128 }))
        .setColor(COLORS.INFO)
        .addFields(
          { name: "🆔 ID", value: user.id, inline: true },
          { name: "🤖 Bot", value: user.bot ? "Yes" : "No", inline: true },
          { name: "📅 Created", value: user.createdAt.toDateString(), inline: true },
          ...(member ? [
            { name: "📅 Joined", value: member.joinedAt?.toDateString() ?? "Unknown", inline: true },
            { name: "🏷️ Roles", value: String(member.roles.cache.size - 1), inline: true },
          ] : []),
        )
        .setFooter({ text: "Chopsticks • !userinfo" });
      await message.reply({ embeds: [embed] });
    }
  },
  {
    name: "avatar",
    aliases: ["av", "pfp", "icon"],
    rateLimit: 3000,
    async execute(message, args) {
      const id = args[0]?.replace(/[<@!>]/g, "") || message.author.id;
      const user = await message.client.users.fetch(id).catch(() => null);
      if (!user) return reply(message, "❌ User not found.");
      const url = user.displayAvatarURL({ size: 512, extension: "png" });
      const embed = new EmbedBuilder()
        .setTitle(`🖼️ ${user.username}'s Avatar`)
        .setImage(url)
        .setColor(COLORS.INFO)
        .setFooter({ text: "Chopsticks • !avatar" });
      await message.reply({ embeds: [embed] });
    }
  },
  {
    name: "roleinfo",
    aliases: ["ri", "role"],
    guildOnly: true,
    rateLimit: 3000,
    async execute(message, args) {
      const id = args[0]?.replace(/[<@&>]/g, "");
      if (!id) return reply(message, "❌ Provide a role ID or @mention.");
      const role = message.guild.roles.cache.get(id);
      if (!role) return reply(message, "❌ Role not found.");
      const embed = new EmbedBuilder()
        .setTitle(`🏷️ ${role.name}`)
        .setColor(role.color || 0x99AAB5)
        .addFields(
          { name: "🆔 ID", value: role.id, inline: true },
          { name: "👥 Members", value: String(role.members.size), inline: true },
          { name: "🎨 Color", value: role.hexColor, inline: true },
          { name: "📌 Hoisted", value: role.hoist ? "Yes" : "No", inline: true },
          { name: "🔔 Mentionable", value: role.mentionable ? "Yes" : "No", inline: true },
        )
        .setFooter({ text: `Created ${role.createdAt.toDateString()}` });
      await message.reply({ embeds: [embed] });
    }
  },
  {
    name: "botinfo",
    aliases: ["bi", "about"],
    rateLimit: 5000,
    async execute(message) {
      const upSec = Math.floor(process.uptime());
      const h = Math.floor(upSec / 3600);
      const m = Math.floor((upSec % 3600) / 60);
      const s = upSec % 60;
      const memMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      const embed = new EmbedBuilder()
        .setTitle(`🤖 ${message.client.user.username}`)
        .setThumbnail(message.client.user.displayAvatarURL({ size: 128 }))
        .setColor(COLORS.INFO)
        .addFields(
          { name: "🌐 Guilds", value: String(message.client.guilds.cache.size), inline: true },
          { name: "👥 Users", value: String(message.client.users.cache.size), inline: true },
          { name: "📡 Ping", value: `${Math.round(message.client.ws.ping)}ms`, inline: true },
          { name: "⏱️ Uptime", value: `${h}h ${m}m ${s}s`, inline: true },
          { name: "💾 Memory", value: `${memMb}MB`, inline: true },
        )
        .setFooter({ text: "Chopsticks by WokSpec" });
      await message.reply({ embeds: [embed] });
    }
  }
];
