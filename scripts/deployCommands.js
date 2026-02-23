import { REST, Routes } from "discord.js";
import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

config();

const DEPLOY_MODE = (process.env.DEPLOY_MODE || "guild").toLowerCase(); // "guild" | "global"
const TARGET = (process.env.DEPLOY_TARGET || "dev").toLowerCase(); // "dev" | "prod"

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!DISCORD_TOKEN) throw new Error("DISCORD_TOKEN missing");
if (!CLIENT_ID) throw new Error("CLIENT_ID missing");

const DEV_GUILD_ID = process.env.DEV_GUILD_ID || process.env.GUILD_ID || "";
const PROD_GUILD_ID = process.env.PROD_GUILD_ID || "";

function resolveGuildId() {
  if (TARGET === "prod") {
    if (!PROD_GUILD_ID) throw new Error("PROD_GUILD_ID missing");
    return PROD_GUILD_ID;
  }
  if (!DEV_GUILD_ID) throw new Error("DEV_GUILD_ID (or GUILD_ID) missing");
  return DEV_GUILD_ID;
}

const commandsPath = path.join(process.cwd(), "src", "commands");
const commandFiles = fs
  .readdirSync(commandsPath, { withFileTypes: true })
  .filter(d => d.isFile() && d.name.endsWith(".js"))
  .map(d => d.name)
  .sort();

const commands = [];

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);

  let mod;
  try {
    mod = await import(pathToFileURL(filePath).href);
  } catch (err) {
    console.error(`[deploy] failed to import ${file}`, err);
    continue;
  }

  const cmd =
    mod.default ??
    (mod.data && mod.execute ? { data: mod.data, execute: mod.execute } : null);

  if (!cmd?.data?.toJSON) continue;

  // Skip commands marked deployGlobal: false when doing global deploy
  const cmdMeta = mod.meta ?? mod.default?.meta ?? null;
  if (DEPLOY_MODE === "global" && cmdMeta?.deployGlobal === false) {
    console.log(`⏭️  Skipping global deploy: ${cmd.data.name} (deployGlobal: false)`);
    continue;
  }

  commands.push(cmd.data.toJSON());
  console.log(`✅ Loaded command: ${cmd.data.name}`);
}

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

console.log(`📤 Deploying ${commands.length} commands...`);
try {
  if (DEPLOY_MODE === "global") {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Commands deployed globally");
  } else {
    const guildId = resolveGuildId();
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: commands });
    console.log(`✅ Commands deployed to guild ${guildId} (${commands.length})`);
  }
} catch (err) {
  console.error("❌ Deployment failed:", err);
  process.exitCode = 1;
} finally {
  // Ensure open sockets do not keep the process alive in containers/scripts.
  try {
    rest.destroy();
  } catch {
    // ignore
  }
}

// Force-exit so keep-alive handles inside HTTP clients don't hang one-click ops flows.
process.exit(process.exitCode || 0);
