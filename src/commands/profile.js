import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { getWallet } from "../economy/wallet.js";
import { getCollectionStats } from "../economy/collections.js";
import { getGameProfile } from "../game/profile.js";
import { progressToNextLevel } from "../game/progression.js";
import { Colors, replyError } from "../utils/discordOutput.js";
import { getGlobalCommandUsage, getInventorySummary, getRecentEconomyActivity, getUserCommandUsage } from "../profile/usage.js";
import { getUserProfilePrivacy, updateUserProfilePrivacy } from "../profile/privacy.js";
import { getUserAchievements } from "../utils/storage_pg.js";
import { botLogger } from "../utils/modernLogger.js";
import { withTimeout } from "../utils/interactionTimeout.js";

function bar(pct, len = 12) {
  const p = Number.isFinite(Number(pct)) ? Number(pct) : 0;
  const clamped = Math.max(0, Math.min(1, p));
  const filled = Math.floor(clamped * len);
  const empty = Math.max(0, len - filled);
  return "█".repeat(filled) + "░".repeat(empty);
}

function ts(ms) {
  const n = Math.trunc(Number(ms) || 0);
  if (!Number.isFinite(n) || n <= 0) return "Never";
  return `<t:${Math.floor(n / 1000)}:R>`;
}

function parsePrivacyPatch(interaction) {
  const patch = {};
  const showProgress = interaction.options.getBoolean("show_progress");
  const showEconomy = interaction.options.getBoolean("show_economy");
  const showInventory = interaction.options.getBoolean("show_inventory");
  const showUsage = interaction.options.getBoolean("show_usage");
  const showActivity = interaction.options.getBoolean("show_activity");

  if (showProgress !== null) patch.showProgress = showProgress;
  if (showEconomy !== null) patch.showEconomy = showEconomy;
  if (showInventory !== null) patch.showInventory = showInventory;
  if (showUsage !== null) patch.showUsage = showUsage;
  if (showActivity !== null) patch.showActivity = showActivity;
  return patch;
}

function boolWord(v) {
  return v ? "Visible" : "Hidden";
}

export const meta = {
  category: "economy",
  guildOnly: true,
};

export default {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("View your profile and manage profile privacy")
    .addUserOption(o =>
      o.setName("user").setDescription("View another user's profile").setRequired(false)
    )
    .addBooleanOption(o =>
      o.setName("private").setDescription("Show output only to you").setRequired(false)
    )
    .addStringOption(o =>
      o
        .setName("privacy_preset")
        .setDescription("Apply a privacy preset (for your profile)")
        .setRequired(false)
        .addChoices(
          { name: "Show All (Default)", value: "show_all" },
          { name: "Hide Sensitive", value: "hide_sensitive" }
        )
    )
    .addBooleanOption(o => o.setName("show_progress").setDescription("Show level/xp progress section").setRequired(false))
    .addBooleanOption(o => o.setName("show_economy").setDescription("Show credits/bank/net worth section").setRequired(false))
    .addBooleanOption(o => o.setName("show_inventory").setDescription("Show inventory/collection section").setRequired(false))
    .addBooleanOption(o => o.setName("show_usage").setDescription("Show command usage section").setRequired(false))
    .addBooleanOption(o => o.setName("show_activity").setDescription("Show recent activity section").setRequired(false)),

  async execute(interaction) {
    const targetUser = interaction.options.getUser("user") || interaction.user;
    const ephemeral = Boolean(interaction.options.getBoolean("private"));
    await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : undefined);

    await withTimeout(interaction, async () => {
      const preset = interaction.options.getString("privacy_preset");
      const patch = parsePrivacyPatch(interaction);
      const isPrivacyUpdate = Boolean(preset) || Object.keys(patch).length > 0;

      try {
        // Privacy updates are self-only by design.
        if (isPrivacyUpdate) {
          if (targetUser.id !== interaction.user.id) {
            return await replyError(
              interaction,
              "Privacy Update Denied",
              "You can only update privacy settings for your own profile.",
              true
            );
          }

          const next = await updateUserProfilePrivacy(interaction.user.id, { preset, patch });
          const embed = new EmbedBuilder()
            .setTitle("Profile Privacy Updated")
            .setColor(Colors.SUCCESS)
            .setDescription("Your profile visibility preferences have been saved.")
            .addFields(
              { name: "Progress", value: boolWord(next.showProgress), inline: true },
              { name: "Economy", value: boolWord(next.showEconomy), inline: true },
              { name: "Inventory", value: boolWord(next.showInventory), inline: true },
              { name: "Usage", value: boolWord(next.showUsage), inline: true },
              { name: "Activity", value: boolWord(next.showActivity), inline: true }
            )
            .setFooter({ text: "Default is show-all. Run /profile again with options to adjust." })
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });
          return;
        }

        const isSelfView = targetUser.id === interaction.user.id;
        const privacy = await getUserProfilePrivacy(targetUser.id);

        const allowProgress = isSelfView || privacy.showProgress;
        const allowEconomy = isSelfView || privacy.showEconomy;
        const allowInventory = isSelfView || privacy.showInventory;
        const allowUsage = isSelfView || privacy.showUsage;
        const allowActivity = isSelfView || privacy.showActivity;

        const tasks = [];
        const keys = [];

        if (allowProgress) {
          tasks.push(getGameProfile(targetUser.id));
          keys.push("profile");
        }
        if (allowEconomy) {
          tasks.push(getWallet(targetUser.id));
          keys.push("wallet");
        }
        if (allowInventory) {
          tasks.push(getInventorySummary(targetUser.id));
          keys.push("inventorySummary");
          tasks.push(getCollectionStats(targetUser.id));
          keys.push("collectionStats");
        }
        if (allowUsage) {
          tasks.push(getUserCommandUsage(targetUser.id, 3));
          keys.push("usage");
          tasks.push(getGlobalCommandUsage(3));
          keys.push("globalUsage");
        }
        if (allowActivity) {
          tasks.push(getRecentEconomyActivity(targetUser.id));
          keys.push("lastEconomy");
        }

        // Achievements — guild-scoped, always load when in a guild
        if (interaction.guildId) {
          tasks.push(getUserAchievements(targetUser.id, interaction.guildId).catch(() => []));
          keys.push("achievements");
        }

        const values = await Promise.all(tasks);
        const data = {};
        for (let i = 0; i < keys.length; i += 1) {
          data[keys[i]] = values[i];
        }

        const embed = new EmbedBuilder()
          .setTitle(`${targetUser.username}'s Profile`)
          .setColor(Colors.PRIMARY)
          .setThumbnail(targetUser.displayAvatarURL())
          .setTimestamp();

        if (allowProgress) {
          const profile = data.profile;
          const prog = progressToNextLevel(profile.xp);
          const pct = prog.pct;
          embed.addFields(
            { name: "Level", value: `**${prog.level}**`, inline: true },
            { name: "XP", value: `${profile.xp.toLocaleString()} XP`, inline: true },
            { name: "Next Level", value: `${Math.max(0, Math.trunc(prog.next - profile.xp)).toLocaleString()} XP`, inline: true },
            { name: "Progress", value: `${bar(pct)} ${Math.round(pct * 100)}%`, inline: false }
          );
        } else {
          embed.addFields({ name: "Progress", value: "Hidden by user preference.", inline: false });
        }

        if (allowEconomy) {
          const wallet = data.wallet;
          embed.addFields(
            { name: "Wallet", value: `${wallet.balance.toLocaleString()} Credits`, inline: true },
            { name: "Bank", value: `${wallet.bank.toLocaleString()} / ${wallet.bank_capacity.toLocaleString()}`, inline: true },
            { name: "Net Worth", value: `${(wallet.balance + wallet.bank).toLocaleString()} Credits`, inline: true }
          );
        } else {
          embed.addFields({ name: "Economy", value: "Hidden by user preference.", inline: false });
        }

        if (allowInventory) {
          const inv = data.inventorySummary;
          const col = data.collectionStats;
          embed.addFields(
            {
              name: "Inventory",
              value: `Stacks: **${inv.uniqueItems.toLocaleString()}**\nTotal items: **${inv.totalItems.toLocaleString()}**`,
              inline: true
            },
            {
              name: "Collection",
              value: `Unique: **${Number(col.unique_items || 0).toLocaleString()}**\nCaught: **${Number(col.total_caught || 0).toLocaleString()}**`,
              inline: true
            },
            {
              name: "Rarity Mix",
              value: `✨ ${Number(col.mythic_count || 0)} | 💎 ${Number(col.legendary_count || 0)} | 🔮 ${Number(col.epic_count || 0)} | 💠 ${Number(col.rare_count || 0)} | ⚪ ${Number(col.common_count || 0)}`,
              inline: false
            }
          );
        } else {
          embed.addFields({ name: "Inventory", value: "Hidden by user preference.", inline: false });
        }

        if (allowUsage) {
          const usage = data.usage;
          const totals = usage.totals;
          const totalRuns = Number(totals.runs || 0);
          const successRate = totalRuns > 0
            ? ((Number(totals.ok || 0) / totalRuns) * 100).toFixed(1)
            : "0.0";
          const topUser = usage.top.length
            ? usage.top
                .map(r => `\`${r.command}\` (${r.runs})`)
                .join(", ")
            : "No command history yet.";
          const global = (data.globalUsage || []).length
            ? data.globalUsage.map(r => `\`${r.command}\` (${r.runs})`).join(", ")
            : "Collecting global stats...";

          embed.addFields(
            {
              name: "Command Usage",
              value:
                `Runs: **${totalRuns.toLocaleString()}**\n` +
                `Success: **${successRate}%**\n` +
                `Avg Latency: **${Number(totals.avgMs || 0)}ms**`,
              inline: true
            },
            { name: "Top Commands", value: topUser, inline: false },
            { name: "Bot-Wide Trends", value: global, inline: false }
          );
        } else {
          embed.addFields({ name: "Usage", value: "Hidden by user preference.", inline: false });
        }

        if (allowActivity) {
          const usage = data.usage || { lastAt: null };
          const lastCmdAt = usage.lastAt || null;
          const lastEconomyAt = data.lastEconomy || null;
          embed.addFields({
            name: "Recent Activity",
            value:
              `Last Command: ${ts(lastCmdAt)}\n` +
              `Last Economy Tx: ${ts(lastEconomyAt)}`,
            inline: false
          });
        } else {
          embed.addFields({ name: "Activity", value: "Hidden by user preference.", inline: false });
        }

        // Achievements section
        if (interaction.guildId && Array.isArray(data.achievements) && data.achievements.length > 0) {
          const achList = data.achievements.slice(0, 8); // show up to 8 most recent
          const achText = achList.map(a => `${a.emoji || "🏅"} **${a.name}** — ${a.description ?? ""}`).join("\n");
          const moreCount = data.achievements.length - achList.length;
          embed.addFields({
            name: `🏆 Achievements (${data.achievements.length})`,
            value: achText + (moreCount > 0 ? `\n*… and ${moreCount} more*` : ""),
            inline: false,
          });
        }

        if (!isSelfView) {
          const hidden = [];
          if (!allowProgress) hidden.push("progress");
          if (!allowEconomy) hidden.push("economy");
          if (!allowInventory) hidden.push("inventory");
          if (!allowUsage) hidden.push("usage");
          if (!allowActivity) hidden.push("activity");
          if (hidden.length) {
            embed.setFooter({ text: `Some sections hidden: ${hidden.join(", ")}` });
          }
        } else {
          embed.setFooter({ text: "Use /profile privacy options to customize what others can see." });
        }

        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        botLogger.error({ err: err }, "[profile] error:");
        await replyError(interaction, "Profile Failed", "Could not load profile right now. Try again.", true);
      }
    }, { label: "profile" });
  }
};

