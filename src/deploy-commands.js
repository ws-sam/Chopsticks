// scripts/deployCommands.js
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REST, Routes, PermissionFlagsBits } from "discord.js";

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN) throw new Error("DISCORD_TOKEN missing");
if (!CLIENT_ID) throw new Error("CLIENT_ID missing");

const MODE = (process.env.DEPLOY_MODE || "guild").toLowerCase(); // "guild" | "global"
const GUILD_ID = process.env.GUILD_ID || process.env.DEV_GUILD_ID || "";

if (MODE !== "global" && MODE !== "guild") {
  throw new Error('DEPLOY_MODE must be "global" or "guild"');
}
if (MODE === "guild" && !GUILD_ID) {
  throw new Error("GUILD_ID missing for guild deploy (set GUILD_ID or DEV_GUILD_ID)");
}

const commandsDir = path.join(process.cwd(), "src", "commands");
if (!fs.existsSync(commandsDir)) throw new Error(`Missing commands dir: ${commandsDir}`);

const files = fs
  .readdirSync(commandsDir, { withFileTypes: true })
  .filter(d => d.isFile() && d.name.endsWith(".js"))
  .map(d => d.name)
  .sort();

const payload = [];

/** Resolve a permission entry to a BigInt flag. Accepts BigInt or string key. */
function resolvePermFlag(perm) {
  if (typeof perm === "bigint") return perm;
  if (typeof perm === "number") return BigInt(perm);
  if (typeof perm === "string" && perm in PermissionFlagsBits) return PermissionFlagsBits[perm];
  console.warn(`[deploy] unknown permission: ${perm} — skipping`);
  return 0n;
}

for (const file of files) {
  const fullPath = path.join(commandsDir, file);

  let mod;
  try {
    mod = await import(pathToFileURL(fullPath).href);
  } catch (err) {
    console.error(`[deploy] failed to import ${file}`);
    throw err;
  }

  const cmd =
    mod.default ??
    (mod.data && mod.execute ? { data: mod.data, execute: mod.execute, meta: mod.meta } : null);

  if (!cmd?.data?.toJSON) continue;

  // Global deploy: only include commands explicitly opted in via meta.deployGlobal.
  // Discord enforces a hard 100-command limit; keeping the global set small and intentional.
  if (MODE === "global" && !cmd.meta?.deployGlobal) continue;

  try {
    if (cmd.meta?.userPerms && Array.isArray(cmd.meta.userPerms) && cmd.meta.userPerms.length > 0) {
      const combinedPerms = cmd.meta.userPerms.reduce((acc, perm) => acc | resolvePermFlag(perm), 0n);
      cmd.data.setDefaultMemberPermissions(combinedPerms);
    }

    payload.push(cmd.data.toJSON());
  } catch (err) {
    console.error(`[deploy] command builder failed: ${file}`);
    throw err;
  }
}

const rest = new REST({ version: "10" }).setToken(TOKEN);

if (MODE === "global") {
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: payload });
  console.log(`[deploy] global: ${payload.length} commands`);
} else {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: payload });
  console.log(`[deploy] guild(${GUILD_ID}): ${payload.length} commands`);
}
