import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";
import {
  ensureAssistantAgent,
  getAssistantSessionAgent,
  releaseAssistantSession,
  sendAgentCommand,
  formatAssistantError
} from "../assistant/service.js";
import {
  getAssistantConfig,
  setAssistantConfig,
  addAssistantRole,
  removeAssistantRole,
  clearAssistantRoles,
  addAssistantChannel,
  removeAssistantChannel,
  clearAssistantChannels,
  setAssistantVoicePresets,
  setAssistantChannelVoice,
  clearAssistantChannelVoices,
  setAssistantProfile,
  removeAssistantProfile,
  setAssistantChannelProfile,
  clearAssistantChannelProfiles,
  setAssistantVoicePersonality,
  clearAssistantVoicePersonalities,
  setAssistantRotation
} from "../assistant/config.js";
import { countAssistantSessionsInGuild } from "../assistant/service.js";
import { auditLog } from "../utils/audit.js";
import { replyEmbedWithJson, buildEmbed } from "../utils/discordOutput.js";
import { replyInteraction } from "../utils/interactionReply.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const data = new SlashCommandBuilder()
  .setName("assistant")
  .setDescription("Voice assistant (agent-only)")
  .addSubcommand(s => s.setName("join").setDescription("Join your voice channel"))
  .addSubcommand(s => s.setName("leave").setDescription("Leave the voice channel"))
  .addSubcommand(s => s.setName("status").setDescription("Show assistant status"))
  .addSubcommand(s =>
    s
      .setName("config")
      .setDescription("Configure assistant (Manage Server)")
      .addBooleanOption(o => o.setName("enabled").setDescription("Enable assistant"))
      .addIntegerOption(o =>
        o
          .setName("max_listen_sec")
          .setDescription("Max listen seconds (2-30)")
          .setMinValue(2)
          .setMaxValue(30)
      )
      .addIntegerOption(o =>
        o
          .setName("silence_ms")
          .setDescription("Silence cutoff ms (500-5000)")
          .setMinValue(500)
          .setMaxValue(5000)
      )
      .addIntegerOption(o =>
        o
          .setName("cooldown_sec")
          .setDescription("Per-user cooldown seconds (0-120)")
          .setMinValue(0)
          .setMaxValue(120)
      )
      .addIntegerOption(o =>
        o
          .setName("max_sessions")
          .setDescription("Max concurrent assistant sessions (1-10)")
          .setMinValue(1)
          .setMaxValue(10)
      )
      .addStringOption(o =>
        o
          .setName("voice")
          .setDescription("Voice name (maps to TTS model)")
      )
      .addStringOption(o =>
        o
          .setName("role_action")
          .setDescription("Role access: add/remove/clear")
          .addChoices(
            { name: "add", value: "add" },
            { name: "remove", value: "remove" },
            { name: "clear", value: "clear" }
          )
      )
      .addRoleOption(o => o.setName("role").setDescription("Role for access"))
      .addStringOption(o =>
        o
          .setName("channel_action")
          .setDescription("Channel allowlist: add/remove/clear")
          .addChoices(
            { name: "add", value: "add" },
            { name: "remove", value: "remove" },
            { name: "clear", value: "clear" }
          )
      )
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Voice channel for allowlist")
          .addChannelTypes(ChannelType.GuildVoice)
      )
  )
  .addSubcommand(s =>
    s
      .setName("presets")
      .setDescription("Manage voice presets (Manage Server)")
      .addStringOption(o =>
        o
          .setName("action")
          .setDescription("set/list/clear")
          .setRequired(true)
          .addChoices(
            { name: "set", value: "set" },
            { name: "list", value: "list" },
            { name: "clear", value: "clear" }
          )
      )
      .addStringOption(o =>
        o
          .setName("presets")
          .setDescription("Comma-separated voice names (for set)")
      )
  )
  .addSubcommand(s =>
    s
      .setName("channel-voice")
      .setDescription("Assign voice per channel (Manage Server)")
      .addStringOption(o =>
        o
          .setName("action")
          .setDescription("set/clear/clear-all")
          .setRequired(true)
          .addChoices(
            { name: "set", value: "set" },
            { name: "clear", value: "clear" },
            { name: "clear-all", value: "clear-all" }
          )
      )
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Voice channel")
          .addChannelTypes(ChannelType.GuildVoice)
      )
      .addStringOption(o =>
        o
          .setName("voice")
          .setDescription("Voice name to assign")
      )
  )
  .addSubcommand(s =>
    s
      .setName("profile")
      .setDescription("Manage assistant profiles (Manage Server)")
      .addStringOption(o =>
        o
          .setName("action")
          .setDescription("set/remove/list/clear")
          .setRequired(true)
          .addChoices(
            { name: "set", value: "set" },
            { name: "remove", value: "remove" },
            { name: "list", value: "list" },
            { name: "clear", value: "clear" }
          )
      )
      .addStringOption(o => o.setName("name").setDescription("Profile name"))
      .addStringOption(o => o.setName("voice").setDescription("Voice name"))
      .addStringOption(o => o.setName("prompt").setDescription("System prompt"))
  )
  .addSubcommand(s =>
    s
      .setName("channel-profile")
      .setDescription("Assign profile per channel (Manage Server)")
      .addStringOption(o =>
        o
          .setName("action")
          .setDescription("set/clear/clear-all")
          .setRequired(true)
          .addChoices(
            { name: "set", value: "set" },
            { name: "clear", value: "clear" },
            { name: "clear-all", value: "clear-all" }
          )
      )
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Voice channel")
          .addChannelTypes(ChannelType.GuildVoice)
      )
      .addStringOption(o =>
        o
          .setName("profile")
          .setDescription("Profile name")
      )
  )
  .addSubcommand(s =>
    s
      .setName("voice-personality")
      .setDescription("Set personality per voice (Manage Server)")
      .addStringOption(o =>
        o
          .setName("action")
          .setDescription("set/clear/list/clear-all")
          .setRequired(true)
          .addChoices(
            { name: "set", value: "set" },
            { name: "clear", value: "clear" },
            { name: "list", value: "list" },
            { name: "clear-all", value: "clear-all" }
          )
      )
      .addStringOption(o => o.setName("voice").setDescription("Voice name"))
      .addStringOption(o => o.setName("prompt").setDescription("System prompt"))
  )
  .addSubcommand(s =>
    s
      .setName("rotation")
      .setDescription("Voice rotation per channel (Manage Server)")
      .addStringOption(o =>
        o
          .setName("action")
          .setDescription("set/clear/clear-all")
          .setRequired(true)
          .addChoices(
            { name: "set", value: "set" },
            { name: "clear", value: "clear" },
            { name: "clear-all", value: "clear-all" }
          )
      )
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Voice channel")
          .addChannelTypes(ChannelType.GuildVoice)
      )
      .addStringOption(o =>
        o
          .setName("voices")
          .setDescription("Comma-separated voices for rotation")
      )
      .addIntegerOption(o =>
        o
          .setName("interval_sec")
          .setDescription("Rotate every N seconds (min 5)")
          .setMinValue(5)
          .setMaxValue(3600)
      )
      .addBooleanOption(o =>
        o
          .setName("enabled")
          .setDescription("Enable rotation")
      )
  )
  .addSubcommand(s =>
    s
      .setName("session")
      .setDescription("Session-only tweaks (no save)")
      .addNumberOption(o =>
        o
          .setName("speed")
          .setDescription("Speech speed (0.5 - 2.0)")
          .setMinValue(0.5)
          .setMaxValue(2.0)
      )
      .addNumberOption(o =>
        o
          .setName("pitch")
          .setDescription("Pitch (0.5 - 2.0)")
          .setMinValue(0.5)
          .setMaxValue(2.0)
      )
      .addNumberOption(o =>
        o
          .setName("volume")
          .setDescription("Volume multiplier (0.1 - 2.0)")
          .setMinValue(0.1)
          .setMaxValue(2.0)
      )
  )
  .addSubcommand(s =>
    s
      .setName("start")
      .setDescription("Start free mode (auto listen)")
  )
  .addSubcommand(s =>
    s
      .setName("stop")
      .setDescription("Stop free mode (auto listen)")
  )
  .addSubcommand(s =>
    s
      .setName("listen")
      .setDescription("Listen briefly and reply with voice")
      .addStringOption(o =>
        o
          .setName("mode")
          .setDescription("once = listen once, free = start free mode")
          .addChoices(
            { name: "once", value: "once" },
            { name: "free", value: "free" }
          )
      )
      .addIntegerOption(o =>
        o.setName("seconds").setDescription("Listen duration (2-30)").setMinValue(2).setMaxValue(30)
      )
  )
  .addSubcommand(s =>
    s
      .setName("say")
      .setDescription("Speak a message in voice")
      .addStringOption(o => o.setName("text").setDescription("Message").setRequired(true))
  );
export const meta = {
  guildOnly: true,
  deployGlobal: true,
  category: "ai"
};

function requireVoice(interaction) {
  const member = interaction.member;
  const vc = member?.voice?.channel ?? null;
  if (!vc) return { ok: false, vc: null };
  return { ok: true, vc };
}

function makeMsg(title, body) {
  return { embeds: [{ title, description: body ?? "" }] };
}

function makeListenPrompt(userId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`assistant_listen:once:${userId}`)
      .setLabel("One-shot")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`assistant_listen:free:${userId}`)
      .setLabel("Free mode")
      .setStyle(ButtonStyle.Secondary)
  );
  return {
    content: "Choose listen mode:",
    components: [row]
  };
}

function memberHasRole(member, roleIds) {
  if (!Array.isArray(roleIds) || roleIds.length === 0) return true;
  const memberRoles = new Set(member?.roles?.cache?.keys?.() ?? []);
  for (const r of roleIds) if (memberRoles.has(String(r))) return true;
  return false;
}

async function ensureAssistantAccess(interaction, sub) {
  const guildId = interaction.guildId;
  const vc = interaction.member?.voice?.channel ?? null;
  if (!vc) return { ok: false, reason: "no-voice" };

  const cfg = await getAssistantConfig(guildId);
  if (!cfg.enabled && sub !== "leave" && sub !== "stop") {
    return { ok: false, reason: "assistant-disabled", cfg, vc };
  }
  const isAdmin = Boolean(
    interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator) ||
      interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild)
  );
  if (!isAdmin && cfg.allowChannelIds?.length && !cfg.allowChannelIds.includes(String(vc.id))) {
    return { ok: false, reason: "assistant-channel-not-allowed", cfg, vc };
  }
  if (!isAdmin && !memberHasRole(interaction.member, cfg.allowRoleIds)) {
    return { ok: false, reason: "assistant-no-access", cfg, vc };
  }
  return { ok: true, cfg, vc };
}

async function runListen(interaction, mode) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  const access = await ensureAssistantAccess(interaction, "listen");
  if (!access.ok) {
    const msg =
      access.reason === "no-voice"
        ? "Join a voice channel."
        : access.reason === "assistant-disabled"
          ? "Assistant is disabled for this server."
          : access.reason === "assistant-channel-not-allowed"
            ? "Assistant is not allowed in this channel."
            : "You don't have access to the assistant.";
    await replyInteraction(interaction, makeMsg("Assistant", msg));
    return;
  }

  const { cfg, vc } = access;

  if (mode === "free") {
    const alloc = ensureAssistantAgent(guildId, vc.id, {
      textChannelId: interaction.channelId,
      ownerUserId: userId
    });
    if (!alloc.ok) {
      await replyInteraction(interaction, makeMsg("Assistant", formatAssistantError(alloc.reason)));
      return;
    }
    try {
      await sendAgentCommand(alloc.agent, "assistantStart", {
        guildId,
        voiceChannelId: vc.id,
        textChannelId: interaction.channelId,
        ownerUserId: userId,
        actorUserId: userId,
        config: cfg
      });
    } catch (err) {
      await replyInteraction(interaction, makeMsg("Assistant", formatAssistantError(err)));
      return;
    }
    await replyInteraction(interaction, makeMsg("Assistant", "Free mode started."));
    return;
  }

  const seconds = Math.min(cfg.maxListenSec, interaction.options?.getInteger?.("seconds") ?? cfg.maxListenSec);
  const alloc = ensureAssistantAgent(guildId, vc.id, {
    textChannelId: interaction.channelId,
    ownerUserId: userId
  });
  if (!alloc.ok) {
    await replyInteraction(interaction, makeMsg("Assistant", formatAssistantError(alloc.reason)));
    return;
  }
  let result;
  try {
    const resolvedProfile = cfg.channelProfiles?.[vc.id];
    const resolvedProfileObj = resolvedProfile ? cfg.profiles?.[resolvedProfile] : null;
    const resolvedVoice = resolvedProfileObj?.voice || cfg.channelVoices?.[vc.id] || cfg.voice;
    const resolvedSystem = resolvedProfileObj?.prompt || (resolvedVoice && cfg.voicePersonalities?.[resolvedVoice]) || null;
    result = await sendAgentCommand(alloc.agent, "assistantListen", {
      guildId,
      voiceChannelId: vc.id,
      textChannelId: interaction.channelId,
      ownerUserId: userId,
      actorUserId: userId,
      durationMs: seconds * 1000,
      silenceMs: cfg.silenceMs,
      voice: resolvedVoice,
      system: resolvedSystem
    });
  } catch (err) {
    await replyInteraction(interaction, makeMsg("Assistant", formatAssistantError(err)));
    return;
  }
  await replyInteraction(interaction, 
    makeMsg("Assistant", result?.transcript ? `Heard: ${result.transcript}` : "Done.")
  );
}

export async function execute(interaction) {
  await withTimeout(interaction, async () => {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  if (sub === "status") {
    const vc = interaction.member?.voice?.channel ?? null;
    const sess = vc ? getAssistantSessionAgent(guildId, vc.id) : { ok: false };
    const active = sess.ok;
    await replyInteraction(interaction, 
      makeMsg("Assistant", active ? "Active in your voice channel." : "Not active.")
    );
    return;
  }

  if (sub === "config") {
    if (!interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild)) {
      await replyInteraction(interaction, makeMsg("Assistant", "Manage Server permission required."));
      return;
    }
    const enabled = interaction.options.getBoolean("enabled");
    const maxListenSec = interaction.options.getInteger("max_listen_sec");
    const silenceMs = interaction.options.getInteger("silence_ms");
    const cooldownSec = interaction.options.getInteger("cooldown_sec");
    const maxSessions = interaction.options.getInteger("max_sessions");
    const voice = interaction.options.getString("voice");
    const role = interaction.options.getRole("role");
    const action = interaction.options.getString("role_action");
    const channel = interaction.options.getChannel("channel");
    const channelAction = interaction.options.getString("channel_action");
    if (action === "add" && role) await addAssistantRole(guildId, role.id);
    if (action === "remove" && role) await removeAssistantRole(guildId, role.id);
    if (action === "clear") await clearAssistantRoles(guildId);
    if (channelAction === "add" && channel) await addAssistantChannel(guildId, channel.id);
    if (channelAction === "remove" && channel) await removeAssistantChannel(guildId, channel.id);
    if (channelAction === "clear") await clearAssistantChannels(guildId);

    if (
      enabled !== null ||
      maxListenSec !== null ||
      silenceMs !== null ||
      cooldownSec !== null ||
      maxSessions !== null
    ) {
      await setAssistantConfig(guildId, {
        enabled: enabled ?? undefined,
        maxListenSec: maxListenSec ?? undefined,
        silenceMs: silenceMs ?? undefined,
        cooldownSec: cooldownSec ?? undefined,
        maxSessions: maxSessions ?? undefined,
        voice: voice ?? undefined
      });
    }
    const cfg = await getAssistantConfig(guildId);
    await replyEmbedWithJson(
      interaction,
      "Assistant config",
      "Config exported as attachment.",
      cfg,
      "assistant-config.json"
    );
    return;
  }

  if (sub === "presets") {
    if (!interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild)) {
      await replyInteraction(interaction, makeMsg("Assistant", "Manage Server permission required."));
      return;
    }
    const action = interaction.options.getString("action", true);
    if (action === "list") {
      const cfg = await getAssistantConfig(guildId);
      await replyEmbedWithJson(
        interaction,
        "Assistant presets",
        "Presets exported as attachment.",
        cfg.voicePresets ?? [],
        "assistant-presets.json"
      );
      return;
    }
    if (action === "clear") {
      await setAssistantVoicePresets(guildId, []);
      await replyInteraction(interaction, makeMsg("Assistant", "Cleared voice presets."));
      return;
    }
    const raw = interaction.options.getString("presets") || "";
    const list = raw.split(",").map(x => x.trim()).filter(Boolean);
    await setAssistantVoicePresets(guildId, list);
    await replyInteraction(interaction, makeMsg("Assistant", `Set presets: ${list.join(", ") || "(none)"}`));
    return;
  }

  if (sub === "channel-voice") {
    if (!interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild)) {
      await replyInteraction(interaction, makeMsg("Assistant", "Manage Server permission required."));
      return;
    }
    const action = interaction.options.getString("action", true);
    if (action === "clear-all") {
      await clearAssistantChannelVoices(guildId);
      await replyInteraction(interaction, makeMsg("Assistant", "Cleared all channel voice overrides."));
      return;
    }
    const channel = interaction.options.getChannel("channel");
    if (!channel) {
      await replyInteraction(interaction, makeMsg("Assistant", "Channel is required."));
      return;
    }
    if (action === "clear") {
      await setAssistantChannelVoice(guildId, channel.id, "");
      await replyInteraction(interaction, makeMsg("Assistant", `Cleared voice for <#${channel.id}>.`));
      return;
    }
    const voice = interaction.options.getString("voice");
    if (!voice) {
      await replyInteraction(interaction, makeMsg("Assistant", "Voice is required for set."));
      return;
    }
    await setAssistantChannelVoice(guildId, channel.id, voice);
    await replyInteraction(interaction, makeMsg("Assistant", `Set voice for <#${channel.id}> to ${voice}.`));
    return;
  }

  if (sub === "profile") {
    if (!interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild)) {
      await replyInteraction(interaction, makeMsg("Assistant", "Manage Server permission required."));
      return;
    }
    const action = interaction.options.getString("action", true);
    if (action === "list") {
      const cfg = await getAssistantConfig(guildId);
      await replyEmbedWithJson(
        interaction,
        "Assistant profiles",
        "Profiles exported as attachment.",
        cfg.profiles ?? {},
        "assistant-profiles.json"
      );
      return;
    }
    if (action === "clear") {
      await setAssistantConfig(guildId, { profiles: {} });
      await replyInteraction(interaction, makeMsg("Assistant", "Cleared profiles."));
      return;
    }
    const name = interaction.options.getString("name");
    if (!name) {
      await replyInteraction(interaction, makeMsg("Assistant", "Profile name required."));
      return;
    }
    if (action === "remove") {
      await removeAssistantProfile(guildId, name);
      await replyInteraction(interaction, makeMsg("Assistant", `Removed profile ${name}.`));
      return;
    }
    const voice = interaction.options.getString("voice") || "";
    const prompt = interaction.options.getString("prompt") || "";
    await setAssistantProfile(guildId, name, { voice, prompt });
    await replyInteraction(interaction, makeMsg("Assistant", `Set profile ${name}.`));
    return;
  }

  if (sub === "channel-profile") {
    if (!interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild)) {
      await replyInteraction(interaction, makeMsg("Assistant", "Manage Server permission required."));
      return;
    }
    const action = interaction.options.getString("action", true);
    if (action === "clear-all") {
      await clearAssistantChannelProfiles(guildId);
      await replyInteraction(interaction, makeMsg("Assistant", "Cleared all channel profiles."));
      return;
    }
    const channel = interaction.options.getChannel("channel");
    if (!channel) {
      await replyInteraction(interaction, makeMsg("Assistant", "Channel is required."));
      return;
    }
    if (action === "clear") {
      await setAssistantChannelProfile(guildId, channel.id, "");
      await replyInteraction(interaction, makeMsg("Assistant", `Cleared profile for <#${channel.id}>.`));
      return;
    }
    const profile = interaction.options.getString("profile");
    if (!profile) {
      await replyInteraction(interaction, makeMsg("Assistant", "Profile is required for set."));
      return;
    }
    await setAssistantChannelProfile(guildId, channel.id, profile);
    await replyInteraction(interaction, makeMsg("Assistant", `Set profile for <#${channel.id}> to ${profile}.`));
    return;
  }

  if (sub === "voice-personality") {
    if (!interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild)) {
      await replyInteraction(interaction, makeMsg("Assistant", "Manage Server permission required."));
      return;
    }
    const action = interaction.options.getString("action", true);
    if (action === "list") {
      const cfg = await getAssistantConfig(guildId);
      await replyEmbedWithJson(
        interaction,
        "Voice personalities",
        "Voice personalities exported as attachment.",
        cfg.voicePersonalities ?? {},
        "assistant-voice-personalities.json"
      );
      return;
    }
    if (action === "clear-all") {
      await clearAssistantVoicePersonalities(guildId);
      await replyInteraction(interaction, makeMsg("Assistant", "Cleared all voice personalities."));
      return;
    }
    const voice = interaction.options.getString("voice");
    if (!voice) {
      await replyInteraction(interaction, makeMsg("Assistant", "Voice is required."));
      return;
    }
    if (action === "clear") {
      await setAssistantVoicePersonality(guildId, voice, "");
      await replyInteraction(interaction, makeMsg("Assistant", `Cleared personality for ${voice}.`));
      return;
    }
    const prompt = interaction.options.getString("prompt") || "";
    if (!prompt) {
      await replyInteraction(interaction, makeMsg("Assistant", "Prompt is required for set."));
      return;
    }
    await setAssistantVoicePersonality(guildId, voice, prompt);
    await replyInteraction(interaction, makeMsg("Assistant", `Set personality for ${voice}.`));
    return;
  }

  if (sub === "rotation") {
    if (!interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild)) {
      await replyInteraction(interaction, makeMsg("Assistant", "Manage Server permission required."));
      return;
    }
    const action = interaction.options.getString("action", true);
    const cfg = await getAssistantConfig(guildId);
    const rotation = cfg.rotation || { enabled: false, intervalSec: 60, channelVoices: {} };
    if (action === "clear-all") {
      rotation.channelVoices = {};
      await setAssistantRotation(guildId, rotation);
      await replyInteraction(interaction, makeMsg("Assistant", "Cleared rotation config."));
      return;
    }
    const channel = interaction.options.getChannel("channel");
    if (!channel) {
      await replyInteraction(interaction, makeMsg("Assistant", "Channel is required."));
      return;
    }
    if (action === "clear") {
      delete rotation.channelVoices[channel.id];
      await setAssistantRotation(guildId, rotation);
      await replyInteraction(interaction, makeMsg("Assistant", `Cleared rotation for <#${channel.id}>.`));
      return;
    }
    const voices = (interaction.options.getString("voices") || "")
      .split(",")
      .map(x => x.trim())
      .filter(Boolean);
    if (!voices.length) {
      await replyInteraction(interaction, makeMsg("Assistant", "Voices are required for set."));
      return;
    }
    const intervalSec = interaction.options.getInteger("interval_sec");
    const enabled = interaction.options.getBoolean("enabled");
    rotation.channelVoices[channel.id] = voices;
    if (intervalSec) rotation.intervalSec = intervalSec;
    if (enabled !== null) rotation.enabled = Boolean(enabled);
    await setAssistantRotation(guildId, rotation);
    await replyInteraction(interaction, makeMsg("Assistant", `Set rotation for <#${channel.id}>.`));
    return;
  }

  if (sub === "session") {
    const voiceCheck = requireVoice(interaction);
    if (!voiceCheck.ok) {
      await replyInteraction(interaction, makeMsg("Assistant", "Join a voice channel."));
      return;
    }
    const vc = voiceCheck.vc;
    const speed = interaction.options.getNumber("speed");
    const pitch = interaction.options.getNumber("pitch");
    const volume = interaction.options.getNumber("volume");
    if (speed === null && pitch === null && volume === null) {
      await replyInteraction(interaction, makeMsg("Assistant", "Provide speed, pitch, or volume."));
      return;
    }
    const sess = getAssistantSessionAgent(guildId, vc.id);
    if (!sess.ok) {
      await replyInteraction(interaction, makeMsg("Assistant", "Assistant is not active in this channel."));
      return;
    }
    try {
      const res = await sendAgentCommand(sess.agent, "assistantSettings", {
        guildId,
        voiceChannelId: vc.id,
        actorUserId: userId,
        speed,
        pitch,
        volume
      });
      const settings = res.settings ?? {};
      const embed = buildEmbed(
        "Assistant session settings",
        [
          `speed: ${settings.speed ?? "n/a"}`,
          `pitch: ${settings.pitch ?? "n/a"}`,
          `volume: ${settings.volume ?? "n/a"}`
        ].join("\n")
      );
      await replyInteraction(interaction, { embeds: [embed] });
    } catch (err) {
      await replyInteraction(interaction, makeMsg("Assistant", formatAssistantError(err)));
    }
    return;
  }

  if (sub === "listen") {
    const mode = interaction.options.getString("mode");
    if (!mode) {
      await replyInteraction(interaction, makeListenPrompt(userId));
      return;
    }
    await runListen(interaction, mode);
    return;
  }

  const voiceCheck = requireVoice(interaction);
  if (!voiceCheck.ok) {
    await replyInteraction(interaction, makeMsg("Assistant", "Join a voice channel."));
    return;
  }
  const vc = voiceCheck.vc;

  const cfg = await getAssistantConfig(guildId);
  if (!cfg.enabled && sub !== "leave" && sub !== "stop") {
    await replyInteraction(interaction, makeMsg("Assistant", "Assistant is disabled for this server."));
    return;
  }
  const isAdmin = Boolean(
    interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator) ||
      interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild)
  );
  if (!isAdmin && cfg.allowChannelIds?.length && !cfg.allowChannelIds.includes(String(vc.id))) {
    await replyInteraction(interaction, makeMsg("Assistant", "Assistant is not allowed in this channel."));
    return;
  }
  if (!isAdmin && !memberHasRole(interaction.member, cfg.allowRoleIds)) {
    await replyInteraction(interaction, makeMsg("Assistant", "You don't have access to the assistant."));
    return;
  }
  if (sub === "start" || sub === "join" || sub === "say") {
    const existing = getAssistantSessionAgent(guildId, vc.id);
    const active = countAssistantSessionsInGuild(guildId);
    if (!existing.ok && Number.isFinite(cfg.maxSessions) && active >= cfg.maxSessions) {
      await replyInteraction(interaction, makeMsg("Assistant", "Assistant session limit reached."));
      return;
    }
  }

  const alloc = ensureAssistantAgent(guildId, vc.id, {
    textChannelId: interaction.channelId,
    ownerUserId: userId
  });

  if (!alloc.ok && sub !== "leave") {
    await replyInteraction(interaction, makeMsg("Assistant", formatAssistantError(alloc.reason)));
    return;
  }

  if (sub === "join") {
    try {
      await sendAgentCommand(alloc.agent, "assistantJoin", {
        guildId,
        voiceChannelId: vc.id,
        textChannelId: interaction.channelId,
        ownerUserId: userId,
        actorUserId: userId
      });
    } catch (err) {
      await replyInteraction(interaction, makeMsg("Assistant", formatAssistantError(err)));
      return;
    }
    await auditLog({
      guildId,
      userId,
      action: "assistant.join",
      details: { voiceChannelId: vc.id }
    });
    await replyInteraction(interaction, makeMsg("Assistant", "Joined your voice channel."));
    return;
  }

  if (sub === "start") {
    try {
      await sendAgentCommand(alloc.agent, "assistantStart", {
        guildId,
        voiceChannelId: vc.id,
        textChannelId: interaction.channelId,
        ownerUserId: userId,
        actorUserId: userId,
        config: cfg
      });
    } catch (err) {
      await replyInteraction(interaction, makeMsg("Assistant", formatAssistantError(err)));
      return;
    }
    await auditLog({
      guildId,
      userId,
      action: "assistant.start",
      details: { voiceChannelId: vc.id }
    });
    await replyInteraction(interaction, makeMsg("Assistant", "Free mode started."));
    return;
  }

  if (sub === "stop") {
    const sess = getAssistantSessionAgent(guildId, vc.id);
    if (sess.ok) {
      try {
        await sendAgentCommand(sess.agent, "assistantStop", {
          guildId,
          voiceChannelId: vc.id,
          actorUserId: userId
        });
      } catch {}
      releaseAssistantSession(guildId, vc.id);
    }
    await auditLog({
      guildId,
      userId,
      action: "assistant.stop",
      details: { voiceChannelId: vc.id }
    });
    await replyInteraction(interaction, makeMsg("Assistant", "Free mode stopped."));
    return;
  }

  if (sub === "leave") {
    const sess = getAssistantSessionAgent(guildId, vc.id);
    if (sess.ok) {
      try {
        await sendAgentCommand(sess.agent, "assistantLeave", {
          guildId,
          voiceChannelId: vc.id,
          actorUserId: userId
        });
      } catch {}
      releaseAssistantSession(guildId, vc.id);
    }
    await auditLog({
      guildId,
      userId,
      action: "assistant.leave",
      details: { voiceChannelId: vc.id }
    });
    await replyInteraction(interaction, makeMsg("Assistant", "Left the voice channel."));
    return;
  }

  if (sub === "listen") return;

  if (sub === "say") {
    const text = interaction.options.getString("text", true);
    try {
      await sendAgentCommand(alloc.agent, "assistantSay", {
        guildId,
        voiceChannelId: vc.id,
        text,
        actorUserId: userId,
        voice: cfg.channelVoices?.[vc.id] ?? cfg.voice
      });
    } catch (err) {
      await replyInteraction(interaction, makeMsg("Assistant", formatAssistantError(err)));
      return;
    }
    await replyInteraction(interaction, makeMsg("Assistant", "Speaking."));
  }
  }, { label: "assistant" });
}

export async function handleButton(interaction) {
  const id = String(interaction.customId || "");
  if (!id.startsWith("assistant_listen:")) return false;
  const parts = id.split(":");
  const mode = parts[1];
  const userId = parts[2];
  if (userId && userId !== interaction.user.id) {
    await replyInteraction(interaction, { content: "Not for you." });
    return true;
  }
  await runListen(interaction, mode === "free" ? "free" : "once");
  return true;
}
