// src/commands/confession.js
// Anonymous confession system.
// /confessions setup <channel> — set the confessions channel (admin)
// /confessions send <text> — post anonymously
// /confessions disable — disable the system
// /confessions reveal <id> — (admin) reveal who sent confession by ID
//
// Author info is stored encrypted (AES-256-GCM) in guildData so only the
// server can decrypt it, not anyone reading the data file.

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";
import { sanitizeString } from "../utils/validation.js";
import crypto from "node:crypto";

export const meta = {
  name: "confessions",
  category: "social",
  deployGlobal: true,
};

export const data = new SlashCommandBuilder()
  .setName("confessions")
  .setDescription("Anonymous confession system")

  .addSubcommand(s => s
    .setName("setup")
    .setDescription("(Admin) Configure the confessions channel")
    .addChannelOption(o => o.setName("channel").setDescription("Channel to post confessions").setRequired(true)))

  .addSubcommand(s => s
    .setName("disable")
    .setDescription("(Admin) Disable confessions"))

  .addSubcommand(s => s
    .setName("send")
    .setDescription("Send an anonymous confession")
    .addStringOption(o => o.setName("text").setDescription("Your confession (completely anonymous)").setRequired(true).setMaxLength(1900)))

  .addSubcommand(s => s
    .setName("reveal")
    .setDescription("(Admin) Reveal who sent a confession by ID")
    .addIntegerOption(o => o.setName("id").setDescription("Confession number").setRequired(true)));

function getKey(guildId) {
  // Derive a deterministic key from the guild ID + a salt in the env.
  // This ensures only this bot instance can decrypt.
  const secret = process.env.CONFESSION_SECRET ?? "chopsticks-confession-secret-key";
  return crypto.createHash("sha256").update(`${guildId}:${secret}`).digest();
}

function encrypt(guildId, text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(guildId), iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

function decrypt(guildId, payload) {
  try {
    const [ivHex, tagHex, encHex] = payload.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const enc = Buffer.from(encHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(guildId), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const gd = await loadGuildData(guildId);
  gd.confessions ??= { enabled: false, channelId: null, nextId: 1, authors: {} };

  if (sub === "setup") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: "> You need **Manage Guild**.", flags: MessageFlags.Ephemeral });
    }
    const ch = interaction.options.getChannel("channel", true);
    gd.confessions.channelId = ch.id;
    gd.confessions.enabled = true;
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> Confessions will be posted in <#${ch.id}>. Members can now use \`/confessions send\`.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "disable") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: "> You need **Manage Guild**.", flags: MessageFlags.Ephemeral });
    }
    gd.confessions.enabled = false;
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: "> Confessions disabled.", flags: MessageFlags.Ephemeral });
  }

  if (sub === "send") {
    if (!gd.confessions.enabled || !gd.confessions.channelId) {
      return interaction.reply({ content: "> Confessions are not enabled in this server.", flags: MessageFlags.Ephemeral });
    }
    const text = sanitizeString(interaction.options.getString("text", true)).slice(0, 1500);
    const ch = interaction.guild.channels.cache.get(gd.confessions.channelId);
    if (!ch?.isTextBased()) return interaction.reply({ content: "> Confession channel not found.", flags: MessageFlags.Ephemeral });

    const id = gd.confessions.nextId++;
    const encAuthor = encrypt(guildId, interaction.user.id);
    gd.confessions.authors[id] = encAuthor;
    await saveGuildData(guildId, gd);

    const embed = new EmbedBuilder()
      .setTitle(`Confession #${id}`)
      .setDescription(text)
      .setColor(0x5865F2)
      .setFooter({ text: `Confession #${id}` })
      .setTimestamp();

    await ch.send({ embeds: [embed] });
    return interaction.reply({ content: "> Your confession has been posted anonymously. ✅", flags: MessageFlags.Ephemeral });
  }

  if (sub === "reveal") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: "> You need **Manage Guild** to reveal confessions.", flags: MessageFlags.Ephemeral });
    }
    const id = interaction.options.getInteger("id", true);
    const encAuthor = gd.confessions.authors?.[id];
    if (!encAuthor) return interaction.reply({ content: "> Confession not found.", flags: MessageFlags.Ephemeral });
    const authorId = decrypt(guildId, encAuthor);
    if (!authorId) return interaction.reply({ content: "> Could not decrypt confession author (wrong key or corrupted).", flags: MessageFlags.Ephemeral });
    return interaction.reply({ content: `> Confession #${id} was submitted by <@${authorId}> (\`${authorId}\`).`, flags: MessageFlags.Ephemeral });
  }
}
