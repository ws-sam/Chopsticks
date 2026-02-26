import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } from "discord.js";
import { schedule } from "../utils/scheduler.js";
import { maybeBuildGuildFunLine } from "../fun/integrations.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = {
  deployGlobal: true,
  category: "community",
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageGuild]
};

export const data = new SlashCommandBuilder()
  .setName("giveaway")
  .setDescription("Run and manage giveaways")
  .addSubcommand(s =>
    s.setName("start")
      .setDescription("Start a giveaway")
      .addIntegerOption(o => o.setName("minutes").setDescription("Duration").setRequired(true).setMinValue(1).setMaxValue(10080))
      .addIntegerOption(o => o.setName("winners").setDescription("Winners").setRequired(true).setMinValue(1).setMaxValue(10))
      .addStringOption(o => o.setName("prize").setDescription("Prize").setRequired(true))
      .addRoleOption(o => o.setName("required_role").setDescription("Role required to enter"))
  )
  .addSubcommand(s =>
    s.setName("end")
      .setDescription("End a giveaway early")
      .addStringOption(o => o.setName("message_id").setDescription("Giveaway message ID").setRequired(true))
  )
  .addSubcommand(s =>
    s.setName("reroll")
      .setDescription("Reroll winners for an ended giveaway")
      .addStringOption(o => o.setName("message_id").setDescription("Giveaway message ID").setRequired(true))
      .addIntegerOption(o => o.setName("winners").setDescription("Number of winners to reroll").setMinValue(1).setMaxValue(10))
  )
  .addSubcommand(s => s.setName("list").setDescription("List active giveaways in this server"))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

// In-memory giveaway registry per guild: Map<guildId, Map<messageId, { prize, winners, endsAt, channelId, requiredRoleId }>>
const activeGiveaways = new Map();

function getGuildGiveaways(guildId) {
  if (!activeGiveaways.has(guildId)) activeGiveaways.set(guildId, new Map());
  return activeGiveaways.get(guildId);
}

async function pickWinners(msg, count, requiredRoleId) {
  const reaction = msg.reactions.cache.get("🎉");
  if (!reaction) return { winners: [], entrants: 0 };
  const users = await reaction.users.fetch();
  let pool = users.filter(u => !u.bot).map(u => u.id);
  // Filter by required role if set
  if (requiredRoleId) {
    const guild = msg.guild;
    pool = (await Promise.all(pool.map(async uid => {
      const m = await guild.members.fetch(uid).catch(() => null);
      return m?.roles.cache.has(requiredRoleId) ? uid : null;
    }))).filter(Boolean);
  }
  const entrants = pool.length;
  const winners = [];
  const remaining = [...pool];
  while (remaining.length && winners.length < count) {
    const i = Math.floor(Math.random() * remaining.length);
    winners.push(remaining.splice(i, 1)[0]);
  }
  return { winners, entrants };
}

export async function execute(interaction) {
  await withTimeout(interaction, async () => {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (sub === "start") {
    const minutes = interaction.options.getInteger("minutes", true);
    const winnersCount = interaction.options.getInteger("winners", true);
    const prize = interaction.options.getString("prize", true);
    const requiredRole = interaction.options.getRole("required_role");
    const endsAt = Date.now() + minutes * 60 * 1000;

    const embed = new EmbedBuilder()
      .setTitle("🎉 GIVEAWAY")
      .setDescription(`**Prize:** ${prize}\n\nReact with 🎉 to enter!${requiredRole ? `\n\n**Required role:** ${requiredRole.name}` : ""}`)
      .addFields(
        { name: "Ends", value: `<t:${Math.floor(endsAt / 1000)}:R>`, inline: true },
        { name: "Winners", value: String(winnersCount), inline: true },
        ...(requiredRole ? [{ name: "Required role", value: requiredRole.name, inline: true }] : [])
      )
      .setColor(0xF1C40F)
      .setFooter({ text: "Hosted by " + interaction.user.tag });

    await interaction.reply({ embeds: [embed] });
    const msg = await interaction.fetchReply();
    await msg.react("🎉").catch(() => {});

    // Register in memory
    getGuildGiveaways(guildId).set(msg.id, {
      prize, winners: winnersCount, endsAt,
      channelId: interaction.channelId,
      requiredRoleId: requiredRole?.id ?? null,
      active: true,
    });

    schedule(`giveaway:${msg.id}`, minutes * 60 * 1000, async () => {
      const m = await interaction.channel.messages.fetch(msg.id).catch(() => null);
      if (!m) return;
      const record = getGuildGiveaways(guildId).get(msg.id);
      const { winners, entrants } = await pickWinners(m, winnersCount, record?.requiredRoleId);
      const text = winners.length ? winners.map(id => `<@${id}>`).join(", ") : "No eligible entries.";
      const flavor = await maybeBuildGuildFunLine({
        guildId,
        feature: "giveaway",
        actorTag: interaction.user.username,
        target: text,
        intensity: 4,
        maxLength: 160,
        context: { phase: "end", entrants, winnerCount: winners.length }
      }).catch(() => null);
      await m.reply((`🎉 Winner(s): ${text}` + (flavor ? `\n${flavor}` : "")).slice(0, 1900));
      if (record) record.active = false;
    });
    return;
  }

  if (sub === "end") {
    const messageId = interaction.options.getString("message_id", true);
    const msg = await interaction.channel.messages.fetch(messageId).catch(() => null);
    if (!msg) return interaction.reply({ flags: MessageFlags.Ephemeral, content: "> Message not found." });
    const record = getGuildGiveaways(guildId).get(messageId);
    const { winners, entrants } = await pickWinners(msg, record?.winners ?? 1, record?.requiredRoleId);
    const text = winners.length ? winners.map(id => `<@${id}>`).join(", ") : "No eligible entries.";
    const flavor = await maybeBuildGuildFunLine({ guildId, feature: "giveaway", actorTag: interaction.user.username, target: text, intensity: 4, maxLength: 160, context: { phase: "end", entrants, winnerCount: winners.length } }).catch(() => null);
    await interaction.reply({ content: (`🎉 Winner(s): ${text}` + (flavor ? `\n${flavor}` : "")).slice(0, 1900) });
    if (record) record.active = false;
    return;
  }

  if (sub === "reroll") {
    const messageId = interaction.options.getString("message_id", true);
    const count = interaction.options.getInteger("winners") ?? 1;
    const msg = await interaction.channel.messages.fetch(messageId).catch(() => null);
    if (!msg) return interaction.reply({ flags: MessageFlags.Ephemeral, content: "> Message not found." });
    const record = getGuildGiveaways(guildId).get(messageId);
    const { winners } = await pickWinners(msg, count, record?.requiredRoleId);
    const text = winners.length ? winners.map(id => `<@${id}>`).join(", ") : "No eligible entries.";
    return interaction.reply({ content: `🎲 Reroll result: ${text}` });
  }

  if (sub === "list") {
    const giveaways = getGuildGiveaways(guildId);
    const active = [...giveaways.entries()].filter(([, r]) => r.active);
    if (!active.length) return interaction.reply({ content: "> No active giveaways.", flags: MessageFlags.Ephemeral });
    const lines = active.map(([mid, r]) =>
      `• **${r.prize}** — <t:${Math.floor(r.endsAt / 1000)}:R> — ${r.winners} winner(s) — [Jump](https://discord.com/channels/${guildId}/${r.channelId}/${mid})`
    );
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle("Active Giveaways").setDescription(lines.join("\n")).setColor(0xF1C40F)], flags: MessageFlags.Ephemeral });
  }
  }, { label: "giveaway" });
}

