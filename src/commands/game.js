import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder
} from "discord.js";
import itemsData from "../economy/items.json" with { type: "json" };
import { loadGuildData, saveGuildData } from "../utils/storage.js";
import { Colors, replyEmbed, replyError } from "../utils/discordOutput.js";
import { getCache, setCache } from "../utils/redis.js";
import { getWallet, depositToBank, withdrawFromBank, upgradeBankCapacity, removeCredits, addCredits } from "../economy/wallet.js";
import { getGameProfile, addGameXp } from "../game/profile.js";
import { progressToNextLevel } from "../game/progression.js";
import { getCooldown, setCooldown, formatCooldown } from "../economy/cooldowns.js";
import { performGather, addToCollection } from "../economy/collections.js";
import { hasItem, addItem } from "../economy/inventory.js";
import { listShopItems, findShopItem } from "../economy/shop.js";
import { getMultiplier, getBuff } from "../game/buffs.js";
import { JOBS, WORK_COOLDOWN } from "./work.js";
import { DIFFICULTIES, BATTLE_COOLDOWN } from "./fight.js";

const THEMES = [
  { name: "Neo (Default)", value: "neo" },
  { name: "Ember", value: "ember" },
  { name: "Arcane", value: "arcane" }
];

const GAME_UI_PREFIX = "gameui";
const PANEL_TTL_SEC = 60 * 60; // 1 hour

function themeLabel(theme) {
  const t = String(theme || "neo").toLowerCase();
  const hit = THEMES.find(x => x.value === t);
  return hit ? hit.name : "Neo (Default)";
}

function panelKey(panelId) {
  return `gameui:panel:${panelId}`;
}

function defaultPanelState({ userId, guildId }) {
  return {
    userId,
    guildId: guildId || null,
    createdAt: Date.now(),
    view: "overview",
    work: { job: "programmer" },
    gather: { tool: null, zone: "any" },
    fight: { difficulty: "easy" },
    shop: { category: "tools", item: "basic_scanner" }
  };
}

async function loadPanelState(panelId) {
  const state = await getCache(panelKey(panelId));
  return state || null;
}

async function savePanelState(panelId, state) {
  await setCache(panelKey(panelId), state, PANEL_TTL_SEC);
}

function parseCustomId(customId) {
  const parts = String(customId || "").split(":");
  if (parts.length < 4) return null;
  if (parts[0] !== GAME_UI_PREFIX) return null;
  return { kind: parts[1], userId: parts[2], panelId: parts[3] };
}

function progressBar(pct, len = 12) {
  const p = Math.max(0, Math.min(1, Number(pct) || 0));
  const filled = Math.floor(p * len);
  const empty = Math.max(0, len - filled);
  return "█".repeat(filled) + "░".repeat(empty);
}

async function buildOverview(state) {
  const [wallet, profile] = await Promise.all([
    getWallet(state.userId),
    getGameProfile(state.userId)
  ]);
  const prog = progressToNextLevel(profile.xp);

  const cdDaily = await getCooldown(state.userId, "daily");
  const cdWork = await getCooldown(state.userId, "work");
  const cdGather = await getCooldown(state.userId, "gather");
  const cdBattle = await getCooldown(state.userId, "battle");

  const cdLine = (cd, label) => (cd?.ok === false ? `- ${label}: **${formatCooldown(cd.remaining)}**` : `- ${label}: **Ready**`);

  const embed = new EmbedBuilder()
    .setTitle("Chopsticks Game Console")
    .setColor(Colors.PRIMARY)
    .setDescription(
      "Use the dropdown to switch panels. Most actions are runnable directly from this UI.\n\n" +
      "**Loop:** `/work` -> Credits + XP, `/gather` -> Loot, `/use` -> Sell, `/shop` -> Tools/Boosts, `/fight` -> Risk/Reward."
    )
    .addFields(
      { name: "Level", value: `**${prog.level}**`, inline: true },
      { name: "XP", value: `${profile.xp.toLocaleString()} XP`, inline: true },
      { name: "Next", value: `${Math.max(0, Math.trunc(prog.next - profile.xp)).toLocaleString()} XP`, inline: true },
      { name: "Progress", value: `${progressBar(prog.pct)} ${Math.round(prog.pct * 100)}%`, inline: false },
      { name: "Wallet", value: `${wallet.balance.toLocaleString()} Credits`, inline: true },
      { name: "Bank", value: `${wallet.bank.toLocaleString()} / ${wallet.bank_capacity.toLocaleString()}`, inline: true },
      { name: "Cooldowns", value: [cdLine(cdDaily, "Daily"), cdLine(cdWork, "Work"), cdLine(cdGather, "Gather"), cdLine(cdBattle, "Fight")].join("\n"), inline: false }
    )
    .setFooter({ text: "Tip: buy Luck Charm / XP Booster in /shop and manage boosts via /use." })
    .setTimestamp();

  return { embed };
}

function buildNavRow(state) {
  const options = [
    { label: "Overview", value: "overview", description: "Your level, XP, credits, and cooldowns", default: state.view === "overview" },
    { label: "Work", value: "work", description: "Earn credits and XP", default: state.view === "work" },
    { label: "Gather", value: "gather", description: "Find loot and collectibles", default: state.view === "gather" },
    { label: "Fight", value: "fight", description: "Risk/reward encounters", default: state.view === "fight" },
    { label: "Shop", value: "shop", description: "Buy tools and boosts", default: state.view === "shop" },
    { label: "Bank", value: "bank", description: "Deposit/withdraw/upgrade", default: state.view === "bank" },
    { label: "Settings", value: "settings", description: "Theme + panel settings", default: state.view === "settings" }
  ];

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${GAME_UI_PREFIX}:nav:${state.userId}:PANEL`)
    .setPlaceholder("Select a panel")
    .addOptions(options);

  return new ActionRowBuilder().addComponents(select);
}

function buildButtonRow(state, { canRun = false } = {}) {
  const refresh = new ButtonBuilder()
    .setCustomId(`${GAME_UI_PREFIX}:refresh:${state.userId}:PANEL`)
    .setLabel("Refresh")
    .setStyle(ButtonStyle.Secondary);

  const run = new ButtonBuilder()
    .setCustomId(`${GAME_UI_PREFIX}:run:${state.userId}:PANEL`)
    .setLabel("Run")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(!canRun);

  const back = new ButtonBuilder()
    .setCustomId(`${GAME_UI_PREFIX}:back:${state.userId}:PANEL`)
    .setLabel("Overview")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(state.view === "overview");

  return new ActionRowBuilder().addComponents(run, back, refresh);
}

function buildWorkComponents(state) {
  const jobOptions = JOBS.slice(0, 25).map(j => ({
    label: `${j.emoji} ${j.name}`,
    value: j.id,
    description: j.description.slice(0, 90),
    default: state.work.job === j.id
  }));

  const jobSelect = new StringSelectMenuBuilder()
    .setCustomId(`${GAME_UI_PREFIX}:workjob:${state.userId}:PANEL`)
    .setPlaceholder("Select a job")
    .addOptions(jobOptions);

  return [new ActionRowBuilder().addComponents(jobSelect)];
}

function buildGatherComponents(state) {
  const toolOptions = [
    { label: "No Tool", value: "__none__", description: "Run a standard gather", default: !state.gather.tool }
  ];
  for (const toolId of Object.keys(itemsData.tools || {})) {
    const t = itemsData.tools[toolId];
    toolOptions.push({
      label: `${t.emoji || "🧰"} ${t.name}`,
      value: toolId,
      description: String(t.description || "").slice(0, 90),
      default: state.gather.tool === toolId
    });
    if (toolOptions.length >= 25) break;
  }

  const zoneOptions = [
    { label: "Any Zone", value: "any", description: "Balanced loot", default: state.gather.zone === "any" },
    { label: "Loot", value: "loot", description: "More collectibles and badges", default: state.gather.zone === "loot" },
    { label: "Food", value: "food", description: "More boosts and consumables", default: state.gather.zone === "food" },
    { label: "Skills", value: "skills", description: "More tools and power items", default: state.gather.zone === "skills" },
    { label: "Misc", value: "misc", description: "Mixed utility drops", default: state.gather.zone === "misc" }
  ];

  const toolSelect = new StringSelectMenuBuilder()
    .setCustomId(`${GAME_UI_PREFIX}:gathertool:${state.userId}:PANEL`)
    .setPlaceholder("Select a tool")
    .addOptions(toolOptions);

  const zoneSelect = new StringSelectMenuBuilder()
    .setCustomId(`${GAME_UI_PREFIX}:gatherzone:${state.userId}:PANEL`)
    .setPlaceholder("Select a zone")
    .addOptions(zoneOptions);

  return [
    new ActionRowBuilder().addComponents(toolSelect),
    new ActionRowBuilder().addComponents(zoneSelect)
  ];
}

function buildFightComponents(state) {
  const opts = DIFFICULTIES.slice(0, 25).map(d => ({
    label: `${d.emoji} ${d.name}`,
    value: d.id,
    description: `Min Lv ${d.minLevel}`,
    default: state.fight.difficulty === d.id
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${GAME_UI_PREFIX}:fightdiff:${state.userId}:PANEL`)
    .setPlaceholder("Select difficulty")
    .addOptions(opts);

  return [new ActionRowBuilder().addComponents(select)];
}

function buildShopComponents(state) {
  const categoryOptions = [
    { label: "Tools", value: "tools", default: state.shop.category === "tools" },
    { label: "Consumables", value: "consumables", default: state.shop.category === "consumables" }
  ];
  const catSelect = new StringSelectMenuBuilder()
    .setCustomId(`${GAME_UI_PREFIX}:shopcat:${state.userId}:PANEL`)
    .setPlaceholder("Select category")
    .addOptions(categoryOptions);

  const items = listShopItems(state.shop.category).slice(0, 25);
  const itemOptions = items.map(it => ({
    label: `${it.emoji || "🧾"} ${it.name}`,
    value: it.id,
    description: `${Math.max(0, Number(it.price) || 0).toLocaleString()} Credits`,
    default: state.shop.item === it.id
  }));
  if (!itemOptions.length) {
    itemOptions.push({ label: "No items", value: "__none__", default: true });
  }
  const itemSelect = new StringSelectMenuBuilder()
    .setCustomId(`${GAME_UI_PREFIX}:shopitem:${state.userId}:PANEL`)
    .setPlaceholder("Select item")
    .addOptions(itemOptions)
    .setDisabled(itemOptions[0]?.value === "__none__");

  const buy1 = new ButtonBuilder()
    .setCustomId(`${GAME_UI_PREFIX}:buy1:${state.userId}:PANEL`)
    .setLabel("Buy x1")
    .setStyle(ButtonStyle.Primary);
  const buy5 = new ButtonBuilder()
    .setCustomId(`${GAME_UI_PREFIX}:buy5:${state.userId}:PANEL`)
    .setLabel("Buy x5")
    .setStyle(ButtonStyle.Secondary);
  const buy10 = new ButtonBuilder()
    .setCustomId(`${GAME_UI_PREFIX}:buy10:${state.userId}:PANEL`)
    .setLabel("Buy x10")
    .setStyle(ButtonStyle.Secondary);

  return [
    new ActionRowBuilder().addComponents(catSelect),
    new ActionRowBuilder().addComponents(itemSelect),
    new ActionRowBuilder().addComponents(buy1, buy5, buy10)
  ];
}

function buildBankComponents(state) {
  const depAll = new ButtonBuilder()
    .setCustomId(`${GAME_UI_PREFIX}:depall:${state.userId}:PANEL`)
    .setLabel("Deposit All")
    .setStyle(ButtonStyle.Primary);
  const wdAll = new ButtonBuilder()
    .setCustomId(`${GAME_UI_PREFIX}:wdall:${state.userId}:PANEL`)
    .setLabel("Withdraw All")
    .setStyle(ButtonStyle.Secondary);
  const up1 = new ButtonBuilder()
    .setCustomId(`${GAME_UI_PREFIX}:bankup:${state.userId}:PANEL`)
    .setLabel("Upgrade +5k")
    .setStyle(ButtonStyle.Secondary);

  return [new ActionRowBuilder().addComponents(depAll, wdAll, up1)];
}

async function buildSettingsEmbed(state) {
  let theme = "neo";
  if (state.guildId) {
    try {
      const data = await loadGuildData(state.guildId);
      theme = data?.game?.theme || "neo";
    } catch {}
  }

  const embed = new EmbedBuilder()
    .setTitle("Game Settings")
    .setColor(Colors.INFO)
    .setDescription(
      `Theme affects **/gather** card visuals.\n\n` +
      `Current theme: **${themeLabel(theme)}** (\`${theme}\`)\n\n` +
      `Set with: \`/game theme name:<theme>\``
    )
    .setTimestamp();

  return { embed };
}

async function buildViewEmbed(state) {
  if (state.view === "settings") return buildSettingsEmbed(state);

  if (state.view === "work") {
    const job = JOBS.find(j => j.id === state.work.job) || JOBS[0];
    const embed = new EmbedBuilder()
      .setTitle("Work")
      .setColor(Colors.PRIMARY)
      .setDescription(`Selected: ${job.emoji} **${job.name}**\n${job.description}`)
      .addFields(
        { name: "Cooldown", value: "30 minutes (can be reduced by Energy Drink)", inline: false },
        { name: "Tip", value: "Buy `energy_drink` and `xp_booster` in `/shop` to speed up.", inline: false }
      )
      .setTimestamp();
    return { embed };
  }

  if (state.view === "gather") {
    const toolId = state.gather.tool;
    const tool = toolId ? itemsData.tools?.[toolId] : null;
    const embed = new EmbedBuilder()
      .setTitle("Gather")
      .setColor(Colors.PRIMARY)
      .setDescription(
        `Tool: ${tool ? `${tool.emoji} **${tool.name}**` : "**None**"}\n` +
        `Zone: **${String(state.gather.zone || "any")}**\n\n` +
        "Gather finds loot for your collection. Luck Charm boosts rarity."
      )
      .setTimestamp();
    return { embed };
  }

  if (state.view === "fight") {
    const diff = DIFFICULTIES.find(d => d.id === state.fight.difficulty) || DIFFICULTIES[0];
    const embed = new EmbedBuilder()
      .setTitle("Fight")
      .setColor(Colors.PRIMARY)
      .setDescription(`Selected: ${diff.emoji} **${diff.name}** (Min Lv ${diff.minLevel})\nCooldown: 10 minutes`)
      .setFooter({ text: "Winning grants credits, XP, and drops. Losing may cost a small fee." })
      .setTimestamp();
    return { embed };
  }

  if (state.view === "shop") {
    const it = findShopItem(state.shop.item) || findShopItem(state.shop.category);
    const embed = new EmbedBuilder()
      .setTitle("Shop")
      .setColor(Colors.PRIMARY)
      .setDescription("Select a category and item, then use buy buttons.\n\nTip: `luck_charm` and `xp_booster` directly improve progression.")
      .setTimestamp();
    if (it) {
      embed.addFields(
        { name: "Selected", value: `${it.emoji || "🧾"} **${it.name}** (\`${it.id}\`)`, inline: false },
        { name: "Price", value: `${Math.max(0, Number(it.price) || 0).toLocaleString()} Credits`, inline: true },
        { name: "Sell", value: `${Math.max(0, Number(it.sellPrice) || 0).toLocaleString()} Credits`, inline: true }
      );
    }
    return { embed };
  }

  if (state.view === "bank") {
    const wallet = await getWallet(state.userId);
    const embed = new EmbedBuilder()
      .setTitle("Bank")
      .setColor(Colors.PRIMARY)
      .setDescription("Deposit, withdraw, and upgrade capacity.")
      .addFields(
        { name: "Wallet", value: `${wallet.balance.toLocaleString()} Credits`, inline: true },
        { name: "Bank", value: `${wallet.bank.toLocaleString()} / ${wallet.bank_capacity.toLocaleString()}`, inline: true }
      )
      .setTimestamp();
    return { embed };
  }

  return buildOverview(state);
}

function patchComponentsWithPanelId(components, panelId) {
  const token = `:${panelId}`;
  return components.map(row => {
    const json = row.toJSON();
    for (const c of json.components || []) {
      if (typeof c.custom_id === "string") {
        c.custom_id = c.custom_id.replace(":PANEL", token);
      }
    }
    return ActionRowBuilder.from(json);
  });
}

async function buildPanelPayload(state, panelId) {
  const view = await buildViewEmbed(state);

  const navRow = buildNavRow(state);
  const actionRow = buildButtonRow(state, { canRun: state.view !== "overview" && state.view !== "settings" });

  let extra = [];
  if (state.view === "work") extra = buildWorkComponents(state);
  if (state.view === "gather") extra = buildGatherComponents(state);
  if (state.view === "fight") extra = buildFightComponents(state);
  if (state.view === "shop") extra = buildShopComponents(state);
  if (state.view === "bank") extra = buildBankComponents(state);

  const components = patchComponentsWithPanelId([navRow, ...extra, actionRow], panelId);
  return { embeds: [view.embed], components };
}

async function renderPanelUpdate(interaction, state, panelId, method = "update") {
  const payload = await buildPanelPayload(state, panelId);
  if (method === "editReply") {
    await interaction.editReply(payload);
    return;
  }
  if (method === "messageEdit") {
    await interaction.message.edit(payload);
    return;
  }
  await interaction.update(payload);
}

async function runWorkAction(userId, jobId) {
  const job = JOBS.find(j => j.id === jobId) || JOBS[0];

  const cd = await getCooldown(userId, "work");
  if (cd && cd.ok === false) {
    return { ok: false, title: "On Break", description: `Come back in **${formatCooldown(cd.remaining)}**.` };
  }

  const variance = Math.floor(Math.random() * (job.variance * 2)) - job.variance;
  const reward = Math.max(50, job.baseReward + variance);
  await addCredits(userId, reward, `Work: ${job.name}`);

  const xpMult = await getMultiplier(userId, "xp:mult", 1);
  const cdMult = await getMultiplier(userId, "cd:work", 1);
  const xpBase = Math.max(10, Math.trunc(reward / 12));
  const xpRes = await addGameXp(userId, xpBase, { reason: `work:${job.id}`, multiplier: xpMult });

  const effectiveCooldown = Math.max(60 * 1000, Math.trunc(WORK_COOLDOWN * cdMult));
  await setCooldown(userId, "work", effectiveCooldown);

  let itemDropped = null;
  if (Math.random() < job.itemChance) {
    const randomItem = job.possibleItems[Math.floor(Math.random() * job.possibleItems.length)];
    await addItem(userId, randomItem, 1);
    itemDropped = randomItem;
  }

  const wallet = await getWallet(userId);
  return {
    ok: true,
    title: `${job.emoji} ${job.name}`,
    description: job.description,
    fields: [
      { name: "Earned", value: `${reward.toLocaleString()} Credits`, inline: true },
      { name: "Balance", value: `${wallet.balance.toLocaleString()} Credits`, inline: true },
      { name: "XP", value: `${xpRes.applied.toLocaleString()} XP${xpRes.leveledUp ? ` • ${xpRes.fromLevel} -> ${xpRes.toLevel}` : ""}`, inline: false }
    ],
    footer: `Cooldown: ${formatCooldown(effectiveCooldown)}${itemDropped ? ` • Drop: ${itemDropped}` : ""}`
  };
}

async function runGatherAction(userId, { toolId, zone }) {
  const cd = await getCooldown(userId, "gather");
  if (cd && cd.ok === false) {
    return { ok: false, title: "Scanner Recharging", description: `Try again in **${formatCooldown(cd.remaining)}**.` };
  }

  let toolBonus = 0;
  let toolLabel = "None";
  if (toolId) {
    const ok = await hasItem(userId, toolId);
    if (!ok) return { ok: false, title: "Tool Not Found", description: "You don't own that tool. Buy it in `/shop`." };
    const t = itemsData.tools?.[toolId];
    toolBonus = Number(t?.gatherBonus || 0);
    toolLabel = `${t?.emoji || "🧰"} ${t?.name || toolId}`;
  }

  const luck = await getBuff(userId, "luck:gather");
  const luckBoostPct = Math.max(0, Math.trunc((Number(luck) || 0) * 100));
  const results = performGather(toolBonus, luckBoostPct, zone || "any").map(r => ({ ...r, category: zone || "any" }));
  if (!results.length) return { ok: false, title: "Gather Failed", description: "No loot could be generated. Try again." };

  for (const r of results) {
    await addItem(userId, r.itemId, 1);
    await addToCollection(userId, zone || "any", r.itemId, r.rarity);
  }

  await setCooldown(userId, "gather", 5 * 60 * 1000);

  const rarityXp = { common: 12, rare: 20, epic: 35, legendary: 55, mythic: 120 };
  const xpBase = results.reduce((sum, r) => sum + (rarityXp[r.rarity] || 12), 0);
  const xpMult = await getMultiplier(userId, "xp:mult", 1);
  const xpRes = await addGameXp(userId, xpBase, { reason: "gather", multiplier: xpMult });

  const rarityEmojis = { mythic: "✨", legendary: "💎", epic: "🔮", rare: "💠", common: "⚪" };
  const lines = results.slice(0, 6).map(r => `${rarityEmojis[r.rarity] || "❓"} \`${r.itemId}\``);
  const extra = results.length > lines.length ? `\n...and ${results.length - lines.length} more.` : "";

  return {
    ok: true,
    title: "⚡ Gather Complete",
    description: `Tool: **${toolLabel}**\nZone: **${String(zone || "any")}**\n\nDrops:\n${lines.join("\n")}${extra}`,
    fields: [{ name: "XP", value: `${xpRes.applied.toLocaleString()} XP${xpRes.leveledUp ? ` • ${xpRes.fromLevel} -> ${xpRes.toLevel}` : ""}`, inline: false }],
    footer: "Cooldown: 5 minutes"
  };
}

async function runFightAction(userId, diffId) {
  const cd = await getCooldown(userId, "battle");
  if (cd && cd.ok === false) {
    return { ok: false, title: "Recovering", description: `Try again in **${formatCooldown(cd.remaining)}**.` };
  }

  const diff = DIFFICULTIES.find(d => d.id === diffId) || DIFFICULTIES[0];
  const profile = await getGameProfile(userId);
  if (profile.level < diff.minLevel) {
    return { ok: false, title: "Locked", description: `Requires **Level ${diff.minLevel}**. You are **Level ${profile.level}**.` };
  }

  const advantage = Math.max(0, profile.level - diff.minLevel);
  const winChance = Math.max(0.15, Math.min(0.95, diff.baseWin + advantage * 0.02));
  const won = Math.random() < winChance;

  const xpMult = await getMultiplier(userId, "xp:mult", 1);
  await setCooldown(userId, "battle", BATTLE_COOLDOWN);

  if (!won) {
    const penalty = 50 + Math.min(250, profile.level * 10);
    const debit = await removeCredits(userId, penalty, `fight_loss:${diff.id}`);
    const wallet = await getWallet(userId);
    return {
      ok: true,
      title: `${diff.emoji} Fight Lost`,
      description: `You were overwhelmed in an **${diff.name}** encounter.`,
      fields: [
        { name: "Penalty", value: debit.ok ? `-${penalty.toLocaleString()} Credits` : "No credits lost (insufficient).", inline: true },
        { name: "Balance", value: `${wallet.balance.toLocaleString()} Credits`, inline: true }
      ],
      footer: `Cooldown: ${formatCooldown(BATTLE_COOLDOWN)}`
    };
  }

  const credits = Math.min(diff.creditMax, Math.max(diff.creditMin, Math.floor(diff.creditMin + Math.random() * (diff.creditMax - diff.creditMin + 1))));
  await addCredits(userId, credits, `fight_win:${diff.id}`);
  const xpRes = await addGameXp(userId, diff.xp, { reason: `fight:${diff.id}`, multiplier: xpMult });

  const drop1 = diff.drops[Math.floor(Math.random() * diff.drops.length)];
  await addItem(userId, drop1, 1);
  let drop2 = null;
  if ((diff.id === "hard" || diff.id === "elite") && Math.random() < (diff.id === "elite" ? 0.35 : 0.2)) {
    drop2 = diff.drops[Math.floor(Math.random() * diff.drops.length)];
    await addItem(userId, drop2, 1);
  }

  const wallet = await getWallet(userId);
  return {
    ok: true,
    title: `${diff.emoji} Victory`,
    description: `You cleared an **${diff.name}** encounter.`,
    fields: [
      { name: "Rewards", value: `+${credits.toLocaleString()} Credits\n+${xpRes.applied.toLocaleString()} XP`, inline: true },
      { name: "Balance", value: `${wallet.balance.toLocaleString()} Credits`, inline: true },
      { name: "Drops", value: drop2 ? `\`${drop1}\`, \`${drop2}\`` : `\`${drop1}\``, inline: false }
    ],
    footer: xpRes.leveledUp ? `Level Up: ${xpRes.fromLevel} -> ${xpRes.toLevel}` : `Cooldown: ${formatCooldown(BATTLE_COOLDOWN)}`
  };
}

async function runShopBuy(userId, itemId, qty) {
  const it = findShopItem(itemId);
  if (!it || Number(it.price) <= 0) return { ok: false, title: "Item Not Found", description: "That item isn't sold in the shop." };
  if (String(it.group) === "collectibles") return { ok: false, title: "Not For Sale", description: "Collectibles are found via `/gather` and `/work` drops." };
  const q = Math.max(1, Math.min(99, Math.trunc(Number(qty) || 1)));
  const unit = Math.max(0, Math.trunc(Number(it.price) || 0));
  const total = unit * q;

  const debit = await removeCredits(userId, total, `shop:${it.id}`);
  if (!debit.ok) {
    const w = await getWallet(userId);
    return { ok: false, title: "Insufficient Funds", description: `Need **${total.toLocaleString()}** Credits, you have **${w.balance.toLocaleString()}**.` };
  }

  await addItem(userId, it.id, q);
  const w = await getWallet(userId);
  return {
    ok: true,
    title: "Purchase Complete",
    description: `Bought **${q}x** ${it.emoji || "🧾"} **${it.name}** for **${total.toLocaleString()} Credits**.`,
    fields: [{ name: "Wallet", value: `${w.balance.toLocaleString()} Credits`, inline: true }]
  };
}

async function runBankAction(userId, kind) {
  const wallet = await getWallet(userId);
  if (kind === "depall") {
    const amount = wallet.balance;
    if (amount <= 0) return { ok: false, title: "Nothing To Deposit", description: "Your wallet is empty." };
    const res = await depositToBank(userId, amount);
    if (!res.ok) return { ok: false, title: "Deposit Failed", description: res.reason === "capacity" ? "Bank at capacity." : "Insufficient funds." };
    return { ok: true, title: "Deposit Successful", description: `Deposited **${amount.toLocaleString()} Credits**.` };
  }
  if (kind === "wdall") {
    const amount = wallet.bank;
    if (amount <= 0) return { ok: false, title: "Nothing To Withdraw", description: "Your bank is empty." };
    const res = await withdrawFromBank(userId, amount);
    if (!res.ok) return { ok: false, title: "Withdraw Failed", description: "Insufficient bank funds." };
    return { ok: true, title: "Withdrawal Successful", description: `Withdrew **${amount.toLocaleString()} Credits**.` };
  }
  if (kind === "bankup") {
    const res = await upgradeBankCapacity(userId, 1);
    if (!res.ok) return { ok: false, title: "Upgrade Failed", description: "Insufficient funds to upgrade." };
    return { ok: true, title: "Bank Upgraded", description: `Applied **${res.applied}** upgrade for **${res.totalCost.toLocaleString()} Credits**.` };
  }
  return { ok: false, title: "Unknown Bank Action", description: "Unsupported action." };
}

async function showActionResult(interaction, result) {
  const embed = new EmbedBuilder()
    .setTitle(result.title || (result.ok ? "Done" : "Failed"))
    .setDescription(result.description || "")
    .setColor(result.ok ? Colors.SUCCESS : Colors.ERROR)
    .setTimestamp();
  if (Array.isArray(result.fields) && result.fields.length) embed.addFields(result.fields);
  if (result.footer) embed.setFooter({ text: String(result.footer).slice(0, 1900) });

  // Always ephemeral so we don't spam channels even if panel is public.
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

export const data = new SlashCommandBuilder()
  .setName("game")
  .setDescription("Game settings and utilities")
  .addSubcommand(sub =>
    sub
      .setName("panel")
      .setDescription("Open the interactive game console (dropdowns + buttons)")
      .addStringOption(o =>
        o
          .setName("delivery")
          .setDescription("Where to post the panel")
          .setRequired(false)
          .addChoices(
            { name: "Ephemeral (Recommended)", value: "ephemeral" },
            { name: "This Channel", value: "channel" },
            { name: "DM Me", value: "dm" }
          )
      )
  )
  .addSubcommand(sub =>
    sub
      .setName("theme")
      .setDescription("View or set the server theme for game outputs")
      .addStringOption(o =>
        o
          .setName("name")
          .setDescription("Theme name (leave empty to view)")
          .setRequired(false)
          .addChoices(...THEMES)
      )
  );

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === "panel") {
    const delivery = interaction.options.getString("delivery") || "ephemeral";
    const state = defaultPanelState({ userId: interaction.user.id, guildId: interaction.guildId });

    try {
      if (delivery === "dm") {
        const loading = await interaction.user.send({ content: "Opening game panel..." });
        const panelId = loading.id;
        await savePanelState(panelId, state);
        const payload = await buildPanelPayload(state, panelId);
        await loading.edit(payload);
        await replyEmbed(interaction, "Game Panel Sent", "I sent the game panel to your DMs.", true);
        return;
      }

      if (delivery === "channel") {
        if (!interaction.inGuild() || !interaction.channel) {
          await replyError(interaction, "Guild Only", "Channel delivery requires a server channel.", true);
          return;
        }
        const msg = await interaction.channel.send({ content: "Opening game panel..." });
        const panelId = msg.id;
        await savePanelState(panelId, state);
        const payload = await buildPanelPayload(state, panelId);
        await msg.edit(payload);
        await replyEmbed(interaction, "Game Panel Posted", "Panel posted to this channel. Only you can control it.", true);
        return;
      }

      // default: ephemeral
      const msg = await interaction.reply({ content: "Opening game panel...", flags: MessageFlags.Ephemeral, fetchReply: true });
      const panelId = msg.id;
      await savePanelState(panelId, state);
      const payload = await buildPanelPayload(state, panelId);
      await interaction.editReply(payload);
      return;
    } catch (err) {
      console.error("[game:panel] failed:", err);
      await replyError(interaction, "Panel Failed", "Couldn't open the game panel. Check bot logs.", true);
      return;
    }
  }

  if (sub !== "theme") {
    await replyError(interaction, "Unknown Action", "This game action is not available.", true);
    return;
  }

  const requested = interaction.options.getString("name", false);

  // View (works in DMs too).
  if (!requested) {
    if (!interaction.inGuild()) {
      await replyEmbed(
        interaction,
        "Game Theme",
        `Default theme: **${themeLabel("neo")}** (\`neo\`)`,
        Colors.PRIMARY,
        true
      );
      return;
    }

    const d = await loadGuildData(interaction.guildId);
    const current = d?.game?.theme || "neo";
    await replyEmbed(
      interaction,
      "Game Theme",
      `Server theme: **${themeLabel(current)}** (\`${String(current)}\`)\n\nSet: \`/game theme name:<theme>\``,
      Colors.PRIMARY,
      true
    );
    return;
  }

  // Set (guild only, requires Manage Guild).
  if (!interaction.inGuild()) {
    await replyError(interaction, "Guild Only", "You can only set the game theme inside a server.", true);
    return;
  }

  const canManage = interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild)
    || interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator);

  if (!canManage) {
    await replyError(interaction, "Missing Permissions", "You need **Manage Server** to set the game theme.", true);
    return;
  }

  const next = String(requested).toLowerCase();
  if (!["neo", "ember", "arcane"].includes(next)) {
    await replyError(interaction, "Invalid Theme", "Choose one of: `neo`, `ember`, `arcane`.", true);
    return;
  }

  const d = await loadGuildData(interaction.guildId);
  const updated = { ...d, game: { ...(d?.game || {}), theme: next } };
  await saveGuildData(interaction.guildId, updated);

  await replyEmbed(
    interaction,
    "Game Theme Updated",
    `Server theme is now **${themeLabel(next)}** (\`${next}\`).\n\nTry: \`/gather\``,
    Colors.SUCCESS,
    true
  );
}

export default { data, execute };

export async function handleSelect(interaction) {
  if (!interaction.isStringSelectMenu?.()) return false;
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  if (parsed.userId !== interaction.user.id) {
    await interaction.reply({ content: "This panel belongs to another user.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const state = await loadPanelState(parsed.panelId);
  if (!state) {
    await interaction.reply({ content: "This game panel expired. Run `/game panel` again.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (parsed.kind === "nav") {
    const view = interaction.values?.[0] || "overview";
    state.view = view;
    await savePanelState(parsed.panelId, state);
    await renderPanelUpdate(interaction, state, parsed.panelId, "update");
    return true;
  }

  if (parsed.kind === "workjob") {
    const job = interaction.values?.[0] || "programmer";
    state.work.job = job;
    state.view = "work";
    await savePanelState(parsed.panelId, state);
    await renderPanelUpdate(interaction, state, parsed.panelId, "update");
    return true;
  }

  if (parsed.kind === "gathertool") {
    const v = interaction.values?.[0] || "__none__";
    state.gather.tool = v === "__none__" ? null : v;
    state.view = "gather";
    await savePanelState(parsed.panelId, state);
    await renderPanelUpdate(interaction, state, parsed.panelId, "update");
    return true;
  }

  if (parsed.kind === "gatherzone") {
    const v = interaction.values?.[0] || "any";
    state.gather.zone = v;
    state.view = "gather";
    await savePanelState(parsed.panelId, state);
    await renderPanelUpdate(interaction, state, parsed.panelId, "update");
    return true;
  }

  if (parsed.kind === "fightdiff") {
    const v = interaction.values?.[0] || "easy";
    state.fight.difficulty = v;
    state.view = "fight";
    await savePanelState(parsed.panelId, state);
    await renderPanelUpdate(interaction, state, parsed.panelId, "update");
    return true;
  }

  if (parsed.kind === "shopcat") {
    const v = interaction.values?.[0] || "tools";
    state.shop.category = v;
    const items = listShopItems(v).slice(0, 25);
    state.shop.item = items[0]?.id || state.shop.item;
    state.view = "shop";
    await savePanelState(parsed.panelId, state);
    await renderPanelUpdate(interaction, state, parsed.panelId, "update");
    return true;
  }

  if (parsed.kind === "shopitem") {
    const v = interaction.values?.[0] || state.shop.item;
    if (v !== "__none__") state.shop.item = v;
    state.view = "shop";
    await savePanelState(parsed.panelId, state);
    await renderPanelUpdate(interaction, state, parsed.panelId, "update");
    return true;
  }

  return false;
}

export async function handleButton(interaction) {
  if (!interaction.isButton?.()) return false;
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  if (parsed.userId !== interaction.user.id) {
    await interaction.reply({ content: "This panel belongs to another user.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const state = await loadPanelState(parsed.panelId);
  if (!state) {
    await interaction.reply({ content: "This game panel expired. Run `/game panel` again.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (parsed.kind === "refresh") {
    await interaction.deferUpdate();
    await savePanelState(parsed.panelId, state);
    await renderPanelUpdate(interaction, state, parsed.panelId, "editReply");
    return true;
  }

  if (parsed.kind === "back") {
    await interaction.deferUpdate();
    state.view = "overview";
    await savePanelState(parsed.panelId, state);
    await renderPanelUpdate(interaction, state, parsed.panelId, "editReply");
    return true;
  }

  if (parsed.kind === "run") {
    // Run the current view action.
    try {
      await interaction.deferUpdate();
      let result = { ok: false, title: "Nothing To Run", description: "Select a panel first." };
      if (state.view === "work") result = await runWorkAction(state.userId, state.work.job);
      if (state.view === "gather") result = await runGatherAction(state.userId, { toolId: state.gather.tool, zone: state.gather.zone });
      if (state.view === "fight") result = await runFightAction(state.userId, state.fight.difficulty);
      if (state.view === "bank") result = await runBankAction(state.userId, "depall");
      await showActionResult(interaction, result);
    } catch (err) {
      console.error("[gameui:run] error:", err);
      try {
        await interaction.followUp({ content: "Action failed. Check logs.", flags: MessageFlags.Ephemeral });
      } catch {}
    }
    await renderPanelUpdate(interaction, state, parsed.panelId, "editReply");
    return true;
  }

  // Shop buy buttons
  if (parsed.kind === "buy1" || parsed.kind === "buy5" || parsed.kind === "buy10") {
    await interaction.deferUpdate();
    const qty = parsed.kind === "buy10" ? 10 : (parsed.kind === "buy5" ? 5 : 1);
    const result = await runShopBuy(state.userId, state.shop.item, qty);
    await showActionResult(interaction, result);
    await renderPanelUpdate(interaction, state, parsed.panelId, "editReply");
    return true;
  }

  // Bank buttons
  if (parsed.kind === "depall" || parsed.kind === "wdall" || parsed.kind === "bankup") {
    await interaction.deferUpdate();
    const result = await runBankAction(state.userId, parsed.kind);
    await showActionResult(interaction, result);
    await renderPanelUpdate(interaction, state, parsed.panelId, "editReply");
    return true;
  }

  return false;
}
