import { PermissionsBitField } from "discord.js";
import { loadGuildData, saveGuildData } from "./storage.js";

const CATEGORY_MAP = {
  mod: new Set(["ban","unban","kick","timeout","purge","slowmode","warn","warnings","clearwarns","lock","unlock","nick","softban","role"]),
  util: new Set(["ping","uptime","help","serverinfo","userinfo","avatar","roleinfo","botinfo","invite","echo"]),
  fun: new Set(["8ball","coinflip","roll","choose","fun"]),
  admin: new Set(["config","prefix","alias","agents","reactionroles","levels","automations","setup","modlogs","logs","model","scripts","custom","macro"]),
  music: new Set(["music"]),
  voice: new Set(["voice","welcome","autorole"]),
  tools: new Set(["poll","giveaway","remind","starboard","tickets"]),
  assistant: new Set(["assistant"])
};

function inferCategory(commandName, meta) {
  if (meta?.category) return meta.category;
  const name = String(commandName || "").toLowerCase();
  for (const [cat, set] of Object.entries(CATEGORY_MAP)) {
    if (set.has(name)) return cat;
  }
  return "general";
}

export async function canRunCommand(interaction, commandName, meta = {}) {
  if (meta.guildOnly && !interaction.inGuild()) {
    return { ok: false, reason: "guild-only" };
  }

  if (!interaction.inGuild()) return { ok: true };

  const data = await loadGuildData(interaction.guildId);
  const disabled = data.commandSettings?.disabled ?? {};
  const catDisabled = data.commandSettings?.categoriesDisabled ?? [];
  const category = inferCategory(commandName, meta);
  if (disabled?.[commandName]) return { ok: false, reason: "disabled" };
  if (catDisabled.includes(category)) return { ok: false, reason: "disabled-category" };

  const member = interaction.member;
  const perms = member?.permissions;
  if (!perms) return { ok: false, reason: "no-perms" };

  if (perms.has(PermissionsBitField.Flags.Administrator)) return { ok: true };

  if (Array.isArray(meta.userPerms) && meta.userPerms.length) {
    const has = meta.userPerms.every(p => perms.has(p));
    if (!has) return { ok: false, reason: "missing-perms" };
  }

  const roleIds = data.commandPerms?.[commandName]?.roleIds ?? [];
  if (roleIds.length) {
    const memberRoles = new Set(member?.roles?.cache?.keys?.() ?? []);
    for (const r of roleIds) {
      if (memberRoles.has(r)) return { ok: true };
    }
    return { ok: false, reason: "missing-role" };
  }

  return { ok: true };
}

export async function canRunPrefixCommand(message, commandName, meta = {}) {
  if (meta.guildOnly && !message.guild) return { ok: false, reason: "guild-only" };
  if (!message.guild) return { ok: true };

  const data = await loadGuildData(message.guildId);
  const disabled = data.commandSettings?.disabled ?? {};
  const catDisabled = data.commandSettings?.categoriesDisabled ?? [];
  const category = inferCategory(commandName, meta);
  if (disabled?.[commandName]) return { ok: false, reason: "disabled" };
  if (catDisabled.includes(category)) return { ok: false, reason: "disabled-category" };

  const member = message.member;
  const perms = member?.permissions;
  if (!perms) return { ok: false, reason: "no-perms" };

  if (perms.has(PermissionsBitField.Flags.Administrator)) return { ok: true };

  if (Array.isArray(meta.userPerms) && meta.userPerms.length) {
    const has = meta.userPerms.every(p => perms.has(p));
    if (!has) return { ok: false, reason: "missing-perms" };
  }

  const roleIds = data.commandPerms?.[commandName]?.roleIds ?? [];
  if (roleIds.length) {
    const memberRoles = new Set(member?.roles?.cache?.keys?.() ?? []);
    for (const r of roleIds) if (memberRoles.has(r)) return { ok: true };
    return { ok: false, reason: "missing-role" };
  }

  return { ok: true };
}

export async function setCommandEnabled(guildId, commandName, enabled) {
  const data = await loadGuildData(guildId);
  data.commandSettings ??= { disabled: {}, categoriesDisabled: [] };
  data.commandSettings.disabled ??= {};
  if (enabled) delete data.commandSettings.disabled[commandName];
  else data.commandSettings.disabled[commandName] = true;
  await saveGuildData(guildId, data);
  return { ok: true, commandName, enabled };
}

export async function setCategoryEnabled(guildId, category, enabled) {
  const data = await loadGuildData(guildId);
  data.commandSettings ??= { disabled: {}, categoriesDisabled: [] };
  data.commandSettings.categoriesDisabled ??= [];
  const arr = data.commandSettings.categoriesDisabled;
  if (enabled) {
    data.commandSettings.categoriesDisabled = arr.filter(c => c !== category);
  } else if (!arr.includes(category)) {
    arr.push(category);
  }
  await saveGuildData(guildId, data);
  return { ok: true, category, enabled };
}

export async function listCommandSettings(guildId) {
  const data = await loadGuildData(guildId);
  return {
    ok: true,
    disabled: data.commandSettings?.disabled ?? {},
    categoriesDisabled: data.commandSettings?.categoriesDisabled ?? []
  };
}

export async function setCommandRoles(guildId, commandName, roleIds) {
  const data = await loadGuildData(guildId);
  data.commandPerms ??= {};
  data.commandPerms[commandName] = {
    roleIds: Array.isArray(roleIds) ? roleIds.map(String).filter(Boolean) : []
  };
  await saveGuildData(guildId, data);
  return { ok: true, commandName, roleIds: data.commandPerms[commandName].roleIds };
}

export async function clearCommandRoles(guildId, commandName) {
  const data = await loadGuildData(guildId);
  if (data.commandPerms?.[commandName]) delete data.commandPerms[commandName];
  await saveGuildData(guildId, data);
  return { ok: true, commandName };
}

export async function listCommandRoles(guildId) {
  const data = await loadGuildData(guildId);
  return { ok: true, commandPerms: data.commandPerms ?? {} };
}
