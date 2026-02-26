// src/commands/music.js
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  ChannelType,
  UserSelectMenuBuilder
} from "discord.js";
import {
  ensureSessionAgent,
  getSessionAgent,
  releaseSession,
  sendAgentCommand,
  formatMusicError
} from "../music/service.js";
import { getMusicConfig, setDefaultMusicMode, updateMusicSettings } from "../music/config.js";
import { loadGuildData, saveGuildData, getGuildSelectedPool, incrementPoolStat, evaluatePoolBadges } from "../utils/storage.js";
import { auditLog } from "../utils/audit.js";
import { handleInteractionError, handleSafeError, ErrorCategory } from "../utils/errorHandler.js";
import { getCache, setCache } from "../utils/redis.js";
import { checkRateLimit } from "../utils/ratelimit.js";
import { makeEmbed } from "../utils/discordOutput.js";
import { musicNowPlaying } from "../utils/embedComponents.js";
import { openAdvisorUiHandoff } from "./agents.js";
import { botLogger } from "../utils/modernLogger.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = {
  deployGlobal: true,
  guildOnly: true,
  userPerms: [],
  category: "music"
};

export const data = new SlashCommandBuilder()
  .setName("music")
  .setDescription("Voice-channel music (agent-backed, one session per voice channel)")
  .addSubcommand(s =>
    s
      .setName("play")
      .setDescription("Play or queue a track in your current voice channel")
      .addStringOption(o => o.setName("query").setDescription("Search or URL").setRequired(true))
  )
  .addSubcommand(s => s.setName("skip").setDescription("Skip current track"))
  .addSubcommand(s => s.setName("pause").setDescription("Pause playback"))
  .addSubcommand(s => s.setName("resume").setDescription("Resume playback"))
  .addSubcommand(s => s.setName("stop").setDescription("Stop playback"))
  .addSubcommand(s => s.setName("now").setDescription("Show current track"))
  .addSubcommand(s => s.setName("queue").setDescription("Show the queue for this voice channel"))
  .addSubcommand(s =>
    s
      .setName("remove")
      .setDescription("Remove a track from the queue")
      .addIntegerOption(o => o.setName("index").setDescription("1-based index").setRequired(true).setMinValue(1))
  )
  .addSubcommand(s =>
    s
      .setName("move")
      .setDescription("Move a track to a new position")
      .addIntegerOption(o => o.setName("from").setDescription("1-based index").setRequired(true).setMinValue(1))
      .addIntegerOption(o => o.setName("to").setDescription("1-based index").setRequired(true).setMinValue(1))
  )
  .addSubcommand(s =>
    s
      .setName("swap")
      .setDescription("Swap two tracks in the queue")
      .addIntegerOption(o => o.setName("a").setDescription("1-based index").setRequired(true).setMinValue(1))
      .addIntegerOption(o => o.setName("b").setDescription("1-based index").setRequired(true).setMinValue(1))
  )
  .addSubcommand(s => s.setName("shuffle").setDescription("Shuffle the queue"))
  .addSubcommand(s => s.setName("clear").setDescription("Clear the queue"))
  .addSubcommand(s =>
    s
      .setName("settings")
      .setDescription("View or update music settings (Manage Server)")
      .addStringOption(o =>
        o
          .setName("control_mode")
          .setDescription("Who can control the queue")
          .addChoices(
            { name: "owner", value: "owner" },
            { name: "voice", value: "voice" }
          )
      )
      .addStringOption(o =>
        o
          .setName("default_mode")
          .setDescription("Default session mode")
          .addChoices(
            { name: "open", value: "open" },
            { name: "dj", value: "dj" }
          )
      )
      .addIntegerOption(o =>
        o.setName("default_volume").setDescription("Default volume (0-150)").setMinValue(0).setMaxValue(150)
      )
      .addIntegerOption(o =>
        o.setName("max_queue").setDescription("Max queue length").setMinValue(1).setMaxValue(10000)
      )
      .addIntegerOption(o =>
        o.setName("max_track_minutes").setDescription("Max track length (minutes)").setMinValue(1).setMaxValue(1440)
      )
      .addIntegerOption(o =>
        o.setName("max_queue_minutes").setDescription("Max total queue length (minutes)").setMinValue(1).setMaxValue(1440)
      )
      .addStringOption(o =>
        o.setName("search_providers").setDescription("Comma list (e.g., scsearch,ytmsearch,ytsearch)")
      )
      .addStringOption(o =>
        o.setName("fallback_providers").setDescription("Comma list for playback fallback (e.g., scsearch)")
      )
  )
  .addSubcommand(s =>
    s
      .setName("mode")
      .setDescription("Set session mode (open or DJ)")
      .addStringOption(o =>
        o
          .setName("mode")
          .setDescription("open = anyone can control, dj = owner-only")
          .setRequired(true)
          .addChoices(
            { name: "open", value: "open" },
            { name: "dj", value: "dj" }
          )
      )
  )
  .addSubcommand(s =>
    s
      .setName("default")
      .setDescription("Set default mode for this server (requires Manage Server)")
      .addStringOption(o =>
        o
          .setName("mode")
          .setDescription("Default mode for new sessions")
          .setRequired(true)
          .addChoices(
            { name: "open", value: "open" },
            { name: "dj", value: "dj" }
          )
      )
  )
  .addSubcommand(s =>
    s
      .setName("volume")
      .setDescription("Set volume (0-150)")
      .addIntegerOption(o =>
        o.setName("level").setDescription("0-150").setRequired(true).setMinValue(0).setMaxValue(150)
      )
  )
  .addSubcommand(s => s.setName("status").setDescription("Show session status"));
  // Note: additional subcommand groups appended below.

// "Audio Drops" (opt-in): show a play panel when users upload audio files in configured channels.
data.addSubcommandGroup(g =>
  g
    .setName("drops")
    .setDescription("Configure audio attachment drop-to-play panels (Manage Server)")
    .addSubcommand(s =>
      s
        .setName("enable")
        .setDescription("Enable audio drops in a text channel (default: this channel)")
        .addChannelOption(o =>
          o
            .setName("channel")
            .setDescription("Text channel to enable")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
    )
    .addSubcommand(s =>
      s
        .setName("disable")
        .setDescription("Disable audio drops in a text channel (default: this channel)")
        .addChannelOption(o =>
          o
            .setName("channel")
            .setDescription("Text channel to disable")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o
            .setName("all")
            .setDescription("Disable audio drops in all channels")
            .setRequired(false)
        )
    )
    .addSubcommand(s => s.setName("status").setDescription("Show audio drops status for this server"))
);

data.addSubcommandGroup(g =>
  g
    .setName("playlist")
    .setDescription("Server playlists powered by drop channels")
    .addSubcommand(s => s.setName("panel").setDescription("Admin playlist setup panel (Manage Server)"))
    .addSubcommand(s => s.setName("browse").setDescription("Browse playlists and play from dropdowns"))
    .addSubcommand(s =>
      s.setName("load").setDescription("Load a saved playlist into the queue")
        .addStringOption(o => o.setName("name").setDescription("Playlist name").setRequired(true))
    )
    .addSubcommand(s =>
      s.setName("save").setDescription("Save current queue as a named playlist")
        .addStringOption(o => o.setName("name").setDescription("Playlist name").setRequired(true).setMaxLength(50))
    )
);

data.addSubcommandGroup(g =>
  g
    .setName("social")
    .setDescription("Social music features — dedications, history, trivia, requests")
    .addSubcommand(s =>
      s.setName("dedicate").setDescription("Queue a song with a shout-out to another member")
        .addStringOption(o => o.setName("query").setDescription("Song search or URL").setRequired(true))
        .addUserOption(o => o.setName("to").setDescription("Who to dedicate this song to").setRequired(true))
        .addStringOption(o => o.setName("message").setDescription("Optional personal message").setMaxLength(100))
    )
    .addSubcommand(s => s.setName("history").setDescription("Show the last 10 songs played in this server"))
    .addSubcommand(s =>
      s.setName("request").setDescription("Request a song — your name appears in the now-playing message")
        .addStringOption(o => o.setName("query").setDescription("Song search or URL").setRequired(true))
        .addStringOption(o => o.setName("message").setDescription("Optional request message shown in queue").setMaxLength(80))
    )
    .addSubcommand(s =>
      s.setName("trivia").setDescription("Force a music trivia question about the current song (DJ/admin only)")
    )
);
data.addSubcommand(s =>
  s.setName("eq").setDescription("Set equalizer preset")
    .addStringOption(o =>
      o.setName("preset").setDescription("EQ preset").setRequired(true)
        .addChoices(
          { name: "flat", value: "flat" },
          { name: "bass-boost", value: "bass-boost" },
          { name: "treble", value: "treble" },
          { name: "pop", value: "pop" }
        )
    )
);
data.addSubcommand(s => s.setName("lyrics").setDescription("Show lyrics for the current track"));

data.addSubcommand(s =>
  s.setName("dj").setDescription("Configure or toggle the AI DJ for this server")
    .addStringOption(o =>
      o.setName("action").setDescription("What to do").setRequired(true)
        .addChoices(
          { name: "on — enable AI DJ", value: "on" },
          { name: "off — disable AI DJ", value: "off" },
          { name: "persona — set DJ personality", value: "persona" },
          { name: "test — generate a test announcement", value: "test" }
        )
    )
    .addStringOption(o =>
      o.setName("style").setDescription("Personality style (for persona action)")
        .addChoices(
          { name: "hype — over-the-top hypeman", value: "hype" },
          { name: "smooth — late-night radio host", value: "smooth" },
          { name: "chaotic — unhinged gremlin", value: "chaotic" },
          { name: "chill — lo-fi cafe vibes", value: "chill" },
          { name: "roast — gently roasts your choices", value: "roast" }
        )
    )
    .addStringOption(o =>
      o.setName("name").setDescription("Custom DJ name (optional, for persona action)").setMaxLength(32)
    )
);

data.addSubcommand(s =>
  s.setName("vibe").setDescription("Show or set the server vibe that shapes music suggestions")
    .addStringOption(o =>
      o.setName("mood").setDescription("Set mood override (auto-expires after 1 hour)")
        .addChoices(
          { name: "energetic — upbeat and fast", value: "energetic" },
          { name: "hype — hip-hop banger mode", value: "hype" },
          { name: "chill — lo-fi and relaxed", value: "chill" },
          { name: "focus — ambient and instrumental", value: "focus" },
          { name: "melancholy — sad indie vibes", value: "melancholy" },
          { name: "auto — detect from chat", value: "auto" }
        )
    )
);

data.addSubcommand(s =>
  s.setName("autoplay").setDescription("Toggle smart autoplay — AI picks the next song when queue is empty")
    .addBooleanOption(o => o.setName("enabled").setDescription("Enable or disable autoplay").setRequired(true))
);

function requireVoice(interaction) {
  const member = interaction.member;
  const vc = member?.voice?.channel ?? null;
  if (!vc) return { ok: false, vc: null };
  return { ok: true, vc };
}

async function resolveMemberVoiceId(interaction) {
  const direct = interaction.member?.voice?.channelId ?? null;
  if (direct) return direct;
  const guild = interaction.guild;
  if (!guild) return null;
  try {
    const member = await guild.members.fetch(interaction.user.id);
    return member?.voice?.channelId ?? null;
  } catch {
    return null;
  }
}

function buildRequester(user) {
  return {
    id: user.id,
    username: user.username,
    discriminator: user.discriminator,
    avatar: user.avatar
  };
}

async function safeDefer(interaction, ephemeral = true) {
  try {
    const options = ephemeral ? { flags: MessageFlags.Ephemeral } : {};
    await interaction.deferReply(options);
    return { ok: true };
  } catch (err) {
    const code = err?.code;
    if (code === 10062) return { ok: false, reason: "unknown-interaction" };
    throw err;
  }
}

function safeDeferEphemeral(interaction) {
  return safeDefer(interaction, true);
}

// makeEmbed removed - using imported version

function buildTrackEmbed(action, track, { footer } = {}) {
  if (action === "playing") {
    // Use the canonical musicNowPlaying embed component
    const requester = track?.requester;
    const requestedBy = requester
      ? (requester.username || requester.displayName || requester.tag || null)
      : null;
    const dur = track?.duration ?? track?.length ?? 0;
    return musicNowPlaying({
      title:      track?.title ?? "Unknown title",
      artist:     track?.author ?? null,
      url:        track?.uri ?? null,
      thumbnail:  track?.thumbnail ?? null,
      duration:   dur,
      position:   0,
      requestedBy,
    });
  }

  // "Queued" and other actions: keep existing format
  const fields = [];
  if (track?.author) fields.push({ name: "Artist", value: track.author, inline: true });
  const dur = track?.duration ?? track?.length;
  if (dur) fields.push({ name: "Duration", value: formatDuration(dur), inline: true });
  const requester = track?.requester;
  if (requester && (requester.username || requester.displayName || requester.tag)) {
    const name = requester.username || requester.displayName || requester.tag;
    fields.push({ name: "Requested by", value: name, inline: true });
  }
  return makeEmbed(
    "Queued",
    track?.title ?? "Unknown title",
    fields,
    track?.uri ?? null,
    track?.thumbnail ?? null,
    undefined,
    footer ?? null
  );
}

const QUEUE_PAGE_SIZE = 10;
const QUEUE_COLOR = 0x5865F2;
const SEARCH_TTL_MS = 10 * 60_000;
const SEARCH_TTL_SEC = 10 * 60;
const AUDIO_DROP_TTL_SEC = 15 * 60;
const AUDIO_DROP_MAX_MB = Math.max(1, Math.trunc(Number(process.env.MUSIC_DROP_MAX_MB ?? 25)));
const AUDIO_DROP_MAX_BYTES = AUDIO_DROP_MAX_MB * 1024 * 1024;
const AUDIO_DROP_ALLOWED_EXT = new Set(["mp3", "wav", "ogg", "m4a", "flac", "opus", "webm", "mp4"]);
const PLAYLIST_UI_TTL_SEC = 10 * 60;
const MUSIC_PLAYLIST_MAX_CHANNELS = Math.max(1, Math.trunc(Number(process.env.MUSIC_PLAYLIST_MAX_CHANNELS ?? 10)));
const MUSIC_PLAYLIST_MAX_PERSONAL = Math.max(1, Math.trunc(Number(process.env.MUSIC_PLAYLIST_MAX_PERSONAL ?? 5)));
// Note: searchCache is now backed by Redis for persistence across restarts
// const searchCache = new Map(); (Legacy in-memory cache removed)

// Anti-spam: Track button interactions to prevent double-processing
const buttonProcessing = new Map(); // interactionId -> timestamp
const BUTTON_DEBOUNCE_MS = 2000; // 2 seconds

// Per-user cooldowns for buttons
const userButtonCooldowns = new Map(); // userId:buttonType -> timestamp
const BUTTON_COOLDOWN_MS = 1000; // 1 second between same button presses

// Cleanup old entries every 30 seconds
setInterval(() => {
  const now = Date.now();
  // Clean button processing tracker
  for (const [id, timestamp] of buttonProcessing.entries()) {
    if (now - timestamp > BUTTON_DEBOUNCE_MS) {
      buttonProcessing.delete(id);
    }
  }
  // Clean user cooldowns
  for (const [key, timestamp] of userButtonCooldowns.entries()) {
    if (now - timestamp > BUTTON_COOLDOWN_MS * 2) {
      userButtonCooldowns.delete(key);
    }
  }
}, 30_000).unref?.();

// Periodic cleanup for search cache is handled by Redis TTL now

function randomKey() {
  // Use crypto random for better collision resistance
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 11);
  const random2 = Math.random().toString(36).slice(2, 11);
  return `${timestamp}${random}${random2}`;
}

function humanBytes(bytes) {
  const b = Number(bytes);
  if (!Number.isFinite(b) || b <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let n = b;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  const fixed = i === 0 ? String(Math.trunc(n)) : n.toFixed(n >= 10 ? 1 : 2);
  return `${fixed} ${units[i]}`;
}

function getExt(name) {
  const s = String(name ?? "").toLowerCase();
  const idx = s.lastIndexOf(".");
  if (idx < 0) return "";
  return s.slice(idx + 1);
}

function extractUrls(text) {
  const s = String(text ?? "");
  if (!s) return [];
  // Conservative URL extraction; avoids matching trailing punctuation.
  const re = /https?:\/\/[^\s<>()\[\]]+/gi;
  const out = [];
  for (const m of s.matchAll(re)) {
    const raw = String(m[0] ?? "");
    const trimmed = raw.replace(/[),.;!?]+$/g, "");
    if (/^https?:\/\//i.test(trimmed)) out.push(trimmed);
  }
  return Array.from(new Set(out)).slice(0, 12);
}

function isSupportedAudioAttachment(att) {
  if (!att) return { ok: false, reason: "missing" };
  const ct = String(att.contentType ?? "").toLowerCase();
  const name = String(att.name ?? "");
  const ext = getExt(name);
  const isAudioCt = ct.startsWith("audio/");
  const isAllowedExt = ext && AUDIO_DROP_ALLOWED_EXT.has(ext);
  if (!isAudioCt && !isAllowedExt) return { ok: false, reason: "unsupported" };
  const size = Number(att.size ?? 0);
  if (Number.isFinite(size) && size > AUDIO_DROP_MAX_BYTES) return { ok: false, reason: "too-large" };
  const url = String(att.url ?? "");
  if (!/^https?:\/\//i.test(url)) return { ok: false, reason: "bad-url" };
  return { ok: true };
}

async function setAudioDropCache(entry) {
  const key = randomKey();
  const ok = await setCache(`audiodrop:${key}`, { ...entry, createdAt: Date.now() }, AUDIO_DROP_TTL_SEC);
  if (!ok) botLogger.warn("[music:drops] Redis cache failed; audio drop panel may not work.");
  return key;
}

async function setPlaylistUiCache(entry) {
  const key = randomKey();
  const ok = await setCache(`mplui:${key}`, { ...entry, createdAt: Date.now() }, PLAYLIST_UI_TTL_SEC);
  if (!ok) botLogger.warn("[music:playlists] Redis cache failed; playlist UI may not work.");
  return key;
}

async function getPlaylistUiCache(key) {
  if (!key) return null;
  return getCache(`mplui:${key}`);
}

async function setPlaylistPanelSelected(guildId, userId, playlistId) {
  if (!guildId || !userId) return false;
  return setCache(`mplpanel:${guildId}:${userId}`, { playlistId: String(playlistId || "") }, 30 * 60);
}

async function getPlaylistPanelSelected(guildId, userId) {
  const v = await getCache(`mplpanel:${guildId}:${userId}`);
  const id = String(v?.playlistId || "");
  return id || null;
}

async function getAudioDropCache(key) {
  if (!key) return null;
  return getCache(`audiodrop:${key}`);
}

async function setAudioDropSelection(key, userId, index) {
  const idx = Math.max(0, Math.trunc(Number(index) || 0));
  return setCache(`audiodropSel:${key}:${userId}`, { idx }, AUDIO_DROP_TTL_SEC);
}

async function getAudioDropSelection(key, userId) {
  const v = await getCache(`audiodropSel:${key}:${userId}`);
  const idx = Math.max(0, Math.trunc(Number(v?.idx) || 0));
  return idx;
}

function buildAudioDropPanel(message, dropKey, uploaderId, attachments) {
  const expiresAt = Math.floor((Date.now() + AUDIO_DROP_TTL_SEC * 1000) / 1000);
  const lines = attachments.slice(0, 8).map((a, i) => {
    const label = a.name ? a.name : `Attachment ${i + 1}`;
    const size = Number.isFinite(a.size) ? ` (${humanBytes(a.size)})` : "";
    return `• ${label}${size}`;
  });
  const fields = [
    { name: "Uploaded by", value: `<@${uploaderId}>`, inline: true },
    { name: "Files", value: lines.length ? lines.join("\n") : "(none)", inline: false },
    { name: "Expires", value: `<t:${expiresAt}:R>`, inline: true }
  ];

  const embed = makeEmbed(
    "Audio Drop",
    "Use the buttons below to play an uploaded audio file in voice.",
    fields,
    null,
    null,
    QUEUE_COLOR
  );

  const base = `audiodrop:${dropKey}:${uploaderId}`;
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${base}:play_my_vc`).setLabel("Play In My VC").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${base}:choose_file`).setLabel("Choose File").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${base}:pick_vc`).setLabel("Pick VC").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${base}:deploy_ui`).setLabel("Deploy Agents").setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${base}:add_to_playlist`).setLabel("Add To Playlist").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${base}:dismiss`).setLabel("Dismiss").setStyle(ButtonStyle.Danger)
  );
  return { embeds: [embed], components: [row1, row2] };
}

function normalizePlaylistsConfig(data) {
  data.music ??= {};
  data.music.playlists ??= { maxItemsPerPlaylist: 200, maxPlaylists: 25, maxPersonalPerUser: MUSIC_PLAYLIST_MAX_PERSONAL, playlists: {}, channelBindings: {} };
  const cfg = data.music.playlists;
  if (!Number.isFinite(cfg.maxItemsPerPlaylist)) cfg.maxItemsPerPlaylist = 200;
  cfg.maxItemsPerPlaylist = Math.max(25, Math.min(2000, Math.trunc(cfg.maxItemsPerPlaylist)));
  if (!Number.isFinite(cfg.maxPlaylists)) cfg.maxPlaylists = 25;
  cfg.maxPlaylists = Math.max(1, Math.min(100, Math.trunc(cfg.maxPlaylists)));
  if (!Number.isFinite(cfg.maxPersonalPerUser)) cfg.maxPersonalPerUser = MUSIC_PLAYLIST_MAX_PERSONAL;
  cfg.maxPersonalPerUser = Math.max(1, Math.min(25, Math.trunc(cfg.maxPersonalPerUser)));
  cfg.playlists ??= {};
  cfg.channelBindings ??= {};
  cfg.hub ??= null; // { channelId, messageId }
  // Admin toggle: must be explicitly enabled before users can create personal drop playlists.
  cfg.allowUserCreation = Boolean(cfg.allowUserCreation ?? false);

  // Normalize playlist objects (additive/back-compat).
  for (const [pid, plRaw] of Object.entries(cfg.playlists)) {
    const pl = plRaw || {};
    pl.id = pl.id || pid;
    pl.name = String(pl.name || pl.id || "").trim().slice(0, 40) || pl.id;
    pl.createdBy = String(pl.createdBy || "");
    pl.createdAt = Number(pl.createdAt || 0) || 0;
    pl.updatedAt = Number(pl.updatedAt || 0) || pl.createdAt || 0;
    pl.channelId = pl.channelId ? String(pl.channelId) : null;
    pl.visibility = String(pl.visibility || "guild"); // "guild" | "collaborators"
    pl.collaborators = Array.isArray(pl.collaborators) ? pl.collaborators.map(String) : [];
    pl.collaborators = Array.from(new Set(pl.collaborators.filter(Boolean))).slice(0, 50);
    pl.perms ??= {};
    pl.perms.read = String(pl.perms.read || pl.visibility || "guild"); // mirror visibility
    pl.perms.write = String(pl.perms.write || "guild"); // "guild" | "collaborators" | "owner"
    pl.panel ??= null; // { channelId, messageId, pinned }
    pl.items = Array.isArray(pl.items) ? pl.items : [];
    cfg.playlists[pid] = pl;
  }
  return cfg;
}

function canManagePlaylist(interaction, playlist) {
  if (!interaction || !playlist) return false;
  const userId = interaction.user?.id;
  if (!userId) return false;
  const isAdmin = interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild);
  if (isAdmin) return true;
  if (String(playlist.createdBy || "") === userId) return true;
  const collabs = new Set(Array.isArray(playlist.collaborators) ? playlist.collaborators.map(String) : []);
  return collabs.has(userId);
}

function canReadPlaylist(interaction, playlist) {
  if (!interaction || !playlist) return false;
  const mode = String(playlist?.perms?.read || playlist.visibility || "guild");
  if (mode === "guild") return true;
  return canManagePlaylist(interaction, playlist);
}

function canWritePlaylist(interaction, playlist) {
  if (!interaction || !playlist) return false;
  const mode = String(playlist?.perms?.write || "guild");
  if (mode === "guild") return true;
  if (mode === "owner") return String(playlist.createdBy || "") === interaction.user?.id || interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild);
  // collaborators
  return canManagePlaylist(interaction, playlist);
}

function getPlaylistSummary(cfg) {
  const playlists = Object.values(cfg.playlists || {});
  const bound = Object.keys(cfg.channelBindings || {}).length;
  return { playlistsCount: playlists.length, boundChannels: bound };
}

function buildPlaylistPanelEmbed(cfg) {
  const { playlistsCount, boundChannels } = getPlaylistSummary(cfg);
  const lines = [];
  const items = Object.values(cfg.playlists || {})
    .sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0))
    .slice(0, 10);
  for (const pl of items) {
    const ch = pl.channelId ? `<#${pl.channelId}>` : "(not bound)";
    const n = pl.name ? `**${pl.name}**` : `\`${pl.id}\``;
    const count = Array.isArray(pl.items) ? pl.items.length : 0;
    lines.push(`${n} • ${ch} • ${count} item${count === 1 ? "" : "s"}`);
  }
  if (!lines.length) lines.push("(none yet)");

  const fields = [
    { name: "Playlists", value: `${playlistsCount}/${cfg.maxPlaylists}`, inline: true },
    { name: "Playlist Channels", value: `${boundChannels}/${MUSIC_PLAYLIST_MAX_CHANNELS}`, inline: true },
    { name: "Max Items / Playlist", value: String(cfg.maxItemsPerPlaylist), inline: true },
    { name: "Personal Playlists", value: `Up to ${cfg.maxPersonalPerUser} per user`, inline: true },
    { name: "User Playlist Creation", value: cfg.allowUserCreation ? "✅ Enabled" : "❌ Disabled", inline: true },
    {
      name: "Admin Setup Steps",
      value:
        "1) Deploy agents via `/agents deploy` (required for playback).\n" +
        "2) Toggle **Enable User Playlists** below to let users create drop threads.\n" +
        "3) Set a **Hub Message** channel so users see the Open My Playlist button.\n" +
        "4) Optionally create server-wide playlists and bind drop channels.",
      inline: false
    },
    { name: "Recent Playlists", value: lines.join("\n"), inline: false }
  ];

  return makeEmbed("Music Playlists", "Admin panel for playlist channels + collaboration.", fields, null, null, QUEUE_COLOR);
}

function describePlaylistPerms(pl) {
  const read = String(pl?.perms?.read || pl?.visibility || "guild");
  const write = String(pl?.perms?.write || "guild");
  const readLabel = read === "collaborators" ? "Collaborators" : "Server";
  const writeLabel = write === "owner" ? "Owner/Admin" : (write === "collaborators" ? "Collaborators" : "Server");
  return { read, write, readLabel, writeLabel };
}

function buildPlaylistDetailEmbed(pl) {
  const { readLabel, writeLabel } = describePlaylistPerms(pl);
  const collabs = Array.isArray(pl?.collaborators) ? pl.collaborators : [];
  const fields = [
    { name: "Drop Channel", value: pl?.channelId ? `<#${pl.channelId}>` : "(not bound)", inline: true },
    { name: "Read", value: readLabel, inline: true },
    { name: "Write", value: writeLabel, inline: true },
    { name: "Collaborators", value: collabs.length ? collabs.map(id => `<@${id}>`).join(", ") : "(none)", inline: false },
    { name: "Panel Message", value: pl?.panel?.messageId ? `Enabled in <#${pl.panel.channelId}>` : "(not set)", inline: false }
  ];
  return makeEmbed("Playlist Settings", `**${pl?.name || pl?.id}**`, fields, null, null, QUEUE_COLOR);
}

function buildPlaylistPanelMessageEmbed(pl) {
  const items = Array.isArray(pl?.items) ? pl.items : [];
  const recent = items
    .slice()
    .sort((a, b) => Number(b?.addedAt || 0) - Number(a?.addedAt || 0))
    .slice(0, 6);
  const lines = recent.length
    ? recent.map((it, i) => {
        const title = truncate(playlistItemLabel(it), 64);
        const by = it?.addedBy ? `<@${it.addedBy}>` : "unknown";
        return `${i + 1}. ${title} • ${by}`;
      }).join("\n")
    : "Drop audio files or links in the drop channel to add tracks.";
  const { readLabel, writeLabel } = describePlaylistPerms(pl);
  const fields = [
    { name: "Drop Channel", value: pl?.channelId ? `<#${pl.channelId}>` : "(not bound)", inline: true },
    { name: "Items", value: String(items.length), inline: true },
    { name: "Access", value: `Read: ${readLabel}\nWrite: ${writeLabel}`, inline: true },
    { name: "Recently Added", value: lines, inline: false }
  ];
  const footer = pl?.updatedAt
    ? { text: `Updated <t:${Math.floor(Number(pl.updatedAt) / 1000)}:R>` }
    : null;
  return makeEmbed("Playlist", `**${pl?.name || pl?.id}**`, fields, null, null, QUEUE_COLOR, footer);
}

function buildPlaylistPanelMessageComponents(playlistId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mplpanel:open:${playlistId}`).setLabel("Browse").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`mplpanel:queue_random:${playlistId}`).setLabel("Queue Random").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mplpanel:refresh:${playlistId}`).setLabel("Refresh").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mplpanel:close_drop:${playlistId}`).setLabel("Done / Close").setStyle(ButtonStyle.Danger)
  );
  return [row];
}

function buildPlaylistHubEmbed(cfg) {
  const fields = [
    { name: "What This Is", value: "A self-serve playlist station.\nOpen your personal drop thread, drag in audio files or paste links, then queue tracks into voice.", inline: false },
    { name: "How To Use", value: "1) Press **Open My Playlist** — opens your existing drop thread or creates one\n2) Drop audio files or paste links inside the thread\n3) Press **Done / Close** when finished editing to hide the thread\n4) Press **Browse Playlists** to queue tracks into VC", inline: false }
  ];
  return makeEmbed("Music Playlist Hub", "Build playlists without command spam.", fields, null, null, QUEUE_COLOR);
}

function buildPlaylistHubComponents() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("mplhub:create").setLabel("Open My Playlist").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("mplhub:browse").setLabel("Browse Playlists").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("mplhub:help").setLabel("How It Works").setStyle(ButtonStyle.Secondary)
  );
  return [row];
}

async function tryUpdatePlaylistPanelMessage(guild, guildData, playlistId) {
  try {
    if (!guild || !guildData?.music?.playlists) return;
    const cfg = normalizePlaylistsConfig(guildData);
    const pl = cfg.playlists?.[playlistId] ?? null;
    if (!pl?.panel?.channelId || !pl?.panel?.messageId) return;
    const ch = guild.channels.cache.get(pl.panel.channelId);
    if (!ch?.isTextBased?.()) return;
    // If the panel channel is an archived thread, temporarily unarchive to edit the panel
    if (ch.isThread?.() && ch.archived) {
      await ch.setArchived(false).catch(() => {});
    }
    const msg = await ch.messages.fetch(pl.panel.messageId).catch(() => null);
    if (!msg) return;
    await msg.edit({
      embeds: [buildPlaylistPanelMessageEmbed(pl)],
      components: buildPlaylistPanelMessageComponents(pl.id)
    }).catch(() => {});
  } catch (err) {
    botLogger.error("[music:playlists] update panel failed:", err?.message ?? err);
  }
}

async function tryDisablePlaylistPanelMessage(guild, playlist) {
  try {
    if (!guild || !playlist?.panel?.channelId || !playlist?.panel?.messageId) return;
    const ch = guild.channels.cache.get(playlist.panel.channelId);
    if (!ch?.isTextBased?.()) return;
    const msg = await ch.messages.fetch(playlist.panel.messageId).catch(() => null);
    if (!msg) return;
    await msg.edit({
      embeds: [makeEmbed("Playlist", "This playlist was removed or is no longer available.", [], null, null, 0xFF0000)],
      components: []
    }).catch(() => {});
  } catch {}
}

function buildPlaylistPanelComponents(cfg, userId) {
  const playlists = Object.values(cfg.playlists || {})
    .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")))
    .slice(0, 25);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`musicpl:panel:${userId}:create`).setLabel("Create").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`musicpl:panel:${userId}:bind`).setLabel("Bind Drop Channel").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`musicpl:panel:${userId}:panelmsg`).setLabel("Panel Message").setStyle(ButtonStyle.Secondary).setDisabled(playlists.length === 0),
    new ButtonBuilder().setCustomId(`musicpl:panel:${userId}:collabs`).setLabel("Collaborators").setStyle(ButtonStyle.Secondary).setDisabled(playlists.length === 0),
    new ButtonBuilder().setCustomId(`musicpl:panel:${userId}:perms`).setLabel("Permissions").setStyle(ButtonStyle.Secondary).setDisabled(playlists.length === 0)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`musicpl:panel:${userId}:rename`).setLabel("Rename").setStyle(ButtonStyle.Secondary).setDisabled(playlists.length === 0),
    new ButtonBuilder().setCustomId(`musicpl:panel:${userId}:clear`).setLabel("Clear Items").setStyle(ButtonStyle.Secondary).setDisabled(playlists.length === 0),
    new ButtonBuilder().setCustomId(`musicpl:panel:${userId}:delete`).setLabel("Delete").setStyle(ButtonStyle.Danger).setDisabled(playlists.length === 0),
    new ButtonBuilder().setCustomId(`musicpl:panel:${userId}:refresh`).setLabel("Refresh").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`musicpl:panel:${userId}:hub`).setLabel("Hub Message").setStyle(ButtonStyle.Secondary)
  );

  const toggleLabel = cfg.allowUserCreation ? "Disable User Playlists" : "Enable User Playlists";
  const toggleStyle = cfg.allowUserCreation ? ButtonStyle.Danger : ButtonStyle.Success;
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`musicpl:panel:${userId}:toggle_user_creation`).setLabel(toggleLabel).setStyle(toggleStyle),
    new ButtonBuilder().setCustomId(`musicpl:panel:${userId}:close`).setLabel("Close").setStyle(ButtonStyle.Secondary)
  );

  const rows = [row1, row2, row3];
  if (playlists.length) {
    const opts = playlists.map(pl => ({
      label: truncate(pl.name || pl.id, 100),
      value: pl.id,
      description: truncate(pl.channelId ? "Bound to a channel" : "Not bound", 100)
    }));
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`musicplsel:panel_pl:${userId}`)
      .setPlaceholder("Select a playlist for actions (rename/clear/delete/bind)")
      .addOptions(opts);
    rows.unshift(new ActionRowBuilder().addComponents(menu));
  }
  return rows;
}

function buildPlaylistBrowserEmbed(cfg, state, playlist) {
  const plName = playlist?.name || playlist?.id || "Playlist";
  const chLine = playlist?.channelId ? `<#${playlist.channelId}>` : "(no drop channel)";
  const sortKey = normalizeSortKey(state?.sortKey);
  const query = normalizeQuery(state?.query);
  const view = buildPlaylistViewItems(playlist, { query, sortKey });
  const total = view.length;
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.max(0, Math.min(Number(state?.page || 0) || 0, totalPages - 1));
  const start = page * pageSize;
  const end = Math.min(total, start + pageSize);
  const slice = view.slice(start, Math.min(end, start + 8));
  const lines = slice.map((it, idx) => {
    const title = truncate(playlistItemLabel(it), 64);
    const by = it?.addedBy ? `<@${it.addedBy}>` : "unknown";
    return `${start + idx + 1}. ${title} • ${by}`;
  });
  const fields = [
    { name: "Playlist", value: `**${plName}**`, inline: true },
    { name: "Drop Channel", value: chLine, inline: true },
    { name: "Items", value: String(total), inline: true }
  ];
  const note = state?.voiceChannelId ? `Voice: <#${state.voiceChannelId}>` : "Join a voice channel to play.";
  const sortLabel = ({
    manual: "Manual",
    newest: "Newest",
    oldest: "Oldest",
    title_az: "Title A-Z",
    title_za: "Title Z-A",
    addedby_az: "Added by",
    type: "Type"
  })[sortKey] || "Newest";
  const desc =
    `${note}\n` +
    `Sort: **${sortLabel}**${query ? ` • Search: \`${query}\`` : ""} • Page: **${page + 1}/${totalPages}**\n` +
    "Pick a playlist and track with the dropdowns, then press **Queue**.";
  if (!lines.length) {
    fields.push({
      name: "Tracks",
      value: "This playlist is empty.\nDrop audio files or links in its drop channel to add items.",
      inline: false
    });
  } else {
    fields.push({ name: `Tracks (${start + 1}-${end} of ${total})`, value: lines.join("\n"), inline: false });
  }

  return makeEmbed("Music Playlists", desc, fields, null, null, QUEUE_COLOR);
}

function normalizeSortKey(value) {
  const v = String(value || "newest");
  const allowed = new Set(["manual", "newest", "oldest", "title_az", "title_za", "addedby_az", "type"]);
  return allowed.has(v) ? v : "newest";
}

function normalizeQuery(value) {
  const q = String(value || "").trim();
  if (!q) return "";
  return q.slice(0, 60);
}

function playlistItemLabel(it) {
  const base = String(it?.title || (it?.type === "url" ? "Link" : "Audio"));
  return base.slice(0, 100) || "Item";
}

function buildPlaylistViewItems(playlist, { query, sortKey } = {}) {
  const items = Array.isArray(playlist?.items) ? playlist.items.slice() : [];
  const q = normalizeQuery(query).toLowerCase();
  let filtered = items;
  if (q) {
    filtered = items.filter(it => {
      const t = String(it?.title || "").toLowerCase();
      const u = String(it?.url || "").toLowerCase();
      return t.includes(q) || u.includes(q);
    });
  }

  const sort = normalizeSortKey(sortKey);
  if (sort === "manual") {
    // Manual preserves stored playlist order (filtered only).
    return filtered;
  }
  const safeStr = (s) => String(s || "").toLowerCase();
  filtered.sort((a, b) => {
    const at = Number(a?.addedAt || 0);
    const bt = Number(b?.addedAt || 0);
    if (sort === "newest") return (bt - at) || String(a?.id || "").localeCompare(String(b?.id || ""));
    if (sort === "oldest") return (at - bt) || String(a?.id || "").localeCompare(String(b?.id || ""));
    if (sort === "title_az") return safeStr(a?.title).localeCompare(safeStr(b?.title)) || (bt - at);
    if (sort === "title_za") return safeStr(b?.title).localeCompare(safeStr(a?.title)) || (bt - at);
    if (sort === "addedby_az") return safeStr(a?.addedBy).localeCompare(safeStr(b?.addedBy)) || (bt - at);
    if (sort === "type") return safeStr(a?.type).localeCompare(safeStr(b?.type)) || (bt - at);
    return (bt - at) || String(a?.id || "").localeCompare(String(b?.id || ""));
  });

  return filtered;
}

function buildPlaylistBrowserComponentsV2(cfg, uiKey, state, interaction) {
  const userId = interaction.user.id;
  const playlists = Object.values(cfg.playlists || {})
    .filter(pl => canReadPlaylist(interaction, pl))
    .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")))
    .slice(0, 25);
  const plOpts = playlists.map(pl => ({
    label: truncate(pl.name || pl.id, 100),
    value: pl.id,
    description: truncate(pl.channelId ? "Has drop channel" : "No drop channel", 100)
  }));

  const selectedPlaylistId = String(state?.selectedPlaylistId || playlists[0]?.id || "");
  const selectedPl = cfg.playlists?.[selectedPlaylistId] ?? playlists[0] ?? null;
  const canManage = selectedPl ? canManagePlaylist(interaction, selectedPl) : false;
  const sortKey = normalizeSortKey(state?.sortKey);
  const query = normalizeQuery(state?.query);
  const view = buildPlaylistViewItems(selectedPl, { query, sortKey });
  const total = view.length;
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.max(0, Math.min(Number(state?.page || 0) || 0, totalPages - 1));
  const start = page * pageSize;
  const end = Math.min(total, start + pageSize);
  const pageItems = view.slice(start, end);

  let selectedItemId = String(state?.selectedItemId || "");
  if (selectedItemId && !view.some(it => String(it?.id || "") === selectedItemId)) selectedItemId = "";
  if (!selectedItemId && pageItems[0]?.id) selectedItemId = String(pageItems[0].id);

  const sortMenu = new StringSelectMenuBuilder()
    .setCustomId(`mplsel:sort:${uiKey}:${userId}`)
    .setPlaceholder("Sort")
    .addOptions(
      { label: "Manual", value: "manual" },
      { label: "Newest", value: "newest" },
      { label: "Oldest", value: "oldest" },
      { label: "Title A-Z", value: "title_az" },
      { label: "Title Z-A", value: "title_za" },
      { label: "Added by", value: "addedby_az" },
      { label: "Type", value: "type" }
    );

  const rows = [];
  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`mplsel:pl:${uiKey}:${userId}`)
        .setPlaceholder("Choose a playlist")
        .addOptions(plOpts.length ? plOpts : [{ label: "No accessible playlists", value: "none" }])
    )
  );
  rows.push(new ActionRowBuilder().addComponents(sortMenu));

  if (pageItems.length) {
    const opts = pageItems.map(it => ({
      label: truncate(playlistItemLabel(it), 100),
      value: String(it.id),
      description: truncate(it?.addedBy ? `Added by ${it.addedBy}` : "", 100)
    }));
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`mplsel:item:${uiKey}:${userId}`)
          .setPlaceholder(`Choose a track (${start + 1}-${end} of ${total})`)
          .addOptions(opts)
      )
    );
  }

  const base = `mplbtn:${uiKey}:${userId}`;
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${base}:prev`).setLabel("Prev").setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
      new ButtonBuilder().setCustomId(`${base}:next`).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
      new ButtonBuilder().setCustomId(`${base}:search`).setLabel("Search").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${base}:clear_search`).setLabel("Clear").setStyle(ButtonStyle.Secondary).setDisabled(!query)
    )
  );

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${base}:queue`).setLabel("Queue").setStyle(ButtonStyle.Primary).setDisabled(total === 0),
      new ButtonBuilder().setCustomId(`${base}:remove`).setLabel("Remove").setStyle(ButtonStyle.Secondary).setDisabled(!canManage || total === 0 || !selectedItemId),
      new ButtonBuilder().setCustomId(`${base}:replace`).setLabel("Replace URL").setStyle(ButtonStyle.Secondary).setDisabled(!canManage || total === 0 || !selectedItemId),
      new ButtonBuilder().setCustomId(`${base}:more`).setLabel("More").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${base}:close`).setLabel("Close").setStyle(ButtonStyle.Danger)
    )
  );

  return { rows, derived: { selectedPlaylistId: selectedPl?.id || selectedPlaylistId, selectedItemId, sortKey, query, page, total, totalPages } };
}

async function openPlaylistBrowser(interaction, { voiceChannelId = null, presetPlaylistId = null } = {}) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Server context required.", [], null, null, 0xFF0000)] }).catch(() => {});
    return;
  }

  const data = await loadGuildData(guildId);
  const cfg = normalizePlaylistsConfig(data);
  const playlists = Object.values(cfg.playlists || {});
  if (!playlists.length) {
    await interaction.reply({
      ephemeral: true,
      embeds: [makeEmbed("Music Playlists", "No playlists are set up yet.\nAdmins: use `/music playlist panel` to bind a drop channel.", [], null, null, QUEUE_COLOR)]
    }).catch(() => {});
    return;
  }

  const preset = cfg.playlists?.[presetPlaylistId] ?? null;
  const accessible = playlists.filter(pl => canReadPlaylist(interaction, pl));
  if (!accessible.length) {
    await interaction.reply({
      ephemeral: true,
      embeds: [makeEmbed("Music Playlists", "No accessible playlists.", [], null, null, 0xFF0000)]
    }).catch(() => {});
    return;
  }
  const first = (preset && canReadPlaylist(interaction, preset)) ? preset : accessible[0];

  const uiKey = await setPlaylistUiCache({
    guildId,
    userId: interaction.user.id,
    voiceChannelId,
    selectedPlaylistId: first.id,
    selectedItemId: first.items?.[0]?.id ?? "",
    sortKey: "newest",
    query: "",
    page: 0
  });

  const selectedPl = cfg.playlists?.[first.id] ?? first;
  const embed = buildPlaylistBrowserEmbed(cfg, { voiceChannelId, sortKey: "newest", query: "", page: 0 }, selectedPl);
  const built = buildPlaylistBrowserComponentsV2(cfg, uiKey, { selectedPlaylistId: selectedPl.id, sortKey: "newest", query: "", page: 0 }, interaction);
  const components = built.rows;
  const payload = { ephemeral: true, embeds: [embed], components };
  if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

async function setPlaylistModalState(payload) {
  const key = randomKey();
  const ok = await setCache(`musicplmodal:${key}`, { ...payload, createdAt: Date.now() }, 10 * 60);
  if (!ok) botLogger.warn("[music:playlists] modal cache failed; modal submit may fail.");
  return key;
}

async function getPlaylistModalState(key) {
  if (!key) return null;
  return getCache(`musicplmodal:${key}`);
}

function randomInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "PL-";
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

async function createPlaylistInvite({ guildId, playlistId, createdBy }) {
  // TTL 24h; stored in Redis.
  const code = randomInviteCode();
  const ok = await setCache(`mplinv:${code}`, { guildId, playlistId, createdBy, createdAt: Date.now() }, 24 * 60 * 60);
  if (!ok) return null;
  return code;
}

async function redeemPlaylistInvite(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;
  return getCache(`mplinv:${c}`);
}

async function maybeCreatePersonalDropThread(interaction, name) {
  const parent = interaction.channel;
  if (!interaction.guild || !parent) return null;
  if (parent.type !== ChannelType.GuildText && parent.type !== ChannelType.GuildAnnouncement) return null;
  // Attempt to create a private thread. This may fail due to permissions; caller handles fallback.
  try {
    const thread = await parent.threads.create({
      name: String(name || "playlist-drop").slice(0, 60),
      type: ChannelType.PrivateThread,
      invitable: false,
      reason: "Chopsticks personal playlist drop thread"
    });
    await thread.members.add(interaction.user.id).catch(() => {});
    return thread;
  } catch {
    return null;
  }
}

async function tryCreateDropThread(interaction, name) {
  // Attempt private thread first; fall back to public thread if needed.
  const parent = interaction.channel;
  if (!interaction.guild || !parent) return null;
  if (parent.type !== ChannelType.GuildText && parent.type !== ChannelType.GuildAnnouncement) return null;

  // Check bot permissions in this channel before attempting
  const botMember = interaction.guild.members.me;
  const botPerms = parent.permissionsFor(botMember);
  const hasPrivate = botPerms?.has?.(PermissionFlagsBits.CreatePrivateThreads) && botPerms?.has?.(PermissionFlagsBits.SendMessagesInThreads);
  const hasPublic = botPerms?.has?.(PermissionFlagsBits.CreatePublicThreads) && botPerms?.has?.(PermissionFlagsBits.SendMessagesInThreads);

  if (hasPrivate) {
    try {
      const thread = await parent.threads.create({
        name: String(name || "playlist-drop").slice(0, 60),
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: "Chopsticks playlist drop thread"
      });
      await thread.members.add(interaction.user.id).catch(() => {});
      return thread;
    } catch (err) {
      botLogger.warn("[music:playlists] Private thread creation failed, trying public fallback:", err?.message ?? err);
    }
  }

  if (hasPublic) {
    try {
      const thread = await parent.threads.create({
        name: String(name || "playlist-drop").slice(0, 60),
        type: ChannelType.PublicThread,
        reason: "Chopsticks playlist drop thread (fallback: no private thread perms)"
      });
      await thread.members.add(interaction.user.id).catch(() => {});
      return thread;
    } catch (err) {
      botLogger.warn("[music:playlists] Public thread fallback also failed:", err?.message ?? err);
    }
  }

  return null;
}

async function createPersonalPlaylist(interaction, { parentChannelId = null } = {}) {
  const guildId = interaction.guildId;
  if (!guildId) return { ok: false, reason: "no-guild" };

  const data = await loadGuildData(guildId);
  const cfg = normalizePlaylistsConfig(data);

  const myCount = Object.values(cfg.playlists || {}).filter(p => String(p?.createdBy || "") === interaction.user.id).length;
  if (myCount >= cfg.maxPersonalPerUser) return { ok: false, reason: "personal-limit" };
  if (Object.values(cfg.playlists || {}).length >= cfg.maxPlaylists) return { ok: false, reason: "server-limit" };

  const playlistId = `pl_${randomKey()}`;
  const name = `${interaction.user.username}'s playlist`.slice(0, 40);
  cfg.playlists[playlistId] = {
    id: playlistId,
    name,
    channelId: null,
    visibility: "collaborators",
    createdBy: interaction.user.id,
    collaborators: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    perms: { read: "collaborators", write: "collaborators" },
    panel: null,
    items: []
  };

  // Optionally create + bind a drop thread under the chosen parent channel (defaults to interaction.channel).
  const boundChannels = Object.keys(cfg.channelBindings || {});
  const canBindChannel = boundChannels.length < MUSIC_PLAYLIST_MAX_CHANNELS;

  let thread = null;
  if (canBindChannel) {
    const prevChannel = interaction.channel;
    if (parentChannelId && interaction.guild?.channels?.cache?.get(parentChannelId)) {
      // Temporarily point creation at the chosen channel by creating a shallow wrapper interaction-like.
      // Avoid mutating the actual interaction object; just use the channel directly.
      const ch = interaction.guild.channels.cache.get(parentChannelId);
      if (ch) {
        const fake = { ...interaction, channel: ch };
        thread = await tryCreateDropThread(fake, `${interaction.user.username}-playlist`).catch(() => null);
      }
    } else {
      thread = await tryCreateDropThread(interaction, `${interaction.user.username}-playlist`).catch(() => null);
    }
  }

  if (thread?.id) {
    cfg.channelBindings[thread.id] = playlistId;
    cfg.playlists[playlistId].channelId = thread.id;
  }

  await saveGuildData(guildId, data).catch(() => {});
  await auditLog({ guildId, userId: interaction.user.id, action: "music.playlists.personal_create", details: { playlistId, threadId: thread?.id || null } });
  return { ok: true, playlistId, playlist: cfg.playlists[playlistId], threadId: thread?.id || null };
}

async function ingestPlaylistMessage(message, guildData) {
  if (!message.guildId) return;
  const cfg = normalizePlaylistsConfig(guildData);
  const playlistId = cfg.channelBindings?.[message.channelId] ?? null;
  if (!playlistId) return;
  const pl = cfg.playlists?.[playlistId] ?? null;
  if (!pl) return;

  pl.items ??= [];
  const before = pl.items.length;

  // Write permissions (avoid noisy spam; warn at most once/minute per user).
  const writeMode = String(pl?.perms?.write || "guild");
  if (writeMode !== "guild") {
    const userId = message.author?.id;
    const isAdmin = Boolean(message.member?.permissions?.has?.(PermissionFlagsBits.ManageGuild));
    const isOwner = userId && String(pl.createdBy || "") === userId;
    const collabs = new Set(Array.isArray(pl.collaborators) ? pl.collaborators.map(String) : []);
    const isCollab = userId && collabs.has(userId);
    const allowed =
      writeMode === "owner" ? (isAdmin || isOwner) : (isAdmin || isOwner || isCollab);
    if (!allowed) {
      try {
        const rl = await checkRateLimit(`musicpl:deny:${message.guildId}:${playlistId}:${userId}`, 1, 60);
        if (rl.ok) {
          await message.reply({
            embeds: [makeEmbed("Playlist", "You don't have permission to add to this playlist.", [], null, null, 0xFF0000)]
          }).catch(() => {});
        }
      } catch {}
      return;
    }
  }

  const newItems = [];
  // Attachments (audio files)
  if (message.attachments?.size) {
    for (const a of message.attachments.values()) {
      const ok = isSupportedAudioAttachment(a);
      if (!ok.ok) continue;
      newItems.push({
        id: `mpli_${randomKey()}`,
        type: "attachment",
        title: String(a.name ?? "Audio file"),
        url: String(a.url ?? ""),
        size: Number(a.size ?? 0),
        contentType: String(a.contentType ?? ""),
        addedBy: message.author.id,
        addedAt: Date.now(),
        sourceMessageId: message.id
      });
      if (newItems.length >= 12) break;
    }
  }

  // Links in message content
  const urls = extractUrls(message.content);
  for (const u of urls) {
    newItems.push({
      id: `mpli_${randomKey()}`,
      type: "url",
      title: "Link",
      url: u,
      size: 0,
      contentType: "",
      addedBy: message.author.id,
      addedAt: Date.now(),
      sourceMessageId: message.id
    });
    if (newItems.length >= 12) break;
  }

  // Keyword queries: allow lightweight search terms with "q:" or leading "?".
  if (!newItems.length) {
    const raw = String(message.content || "").trim();
    let q = "";
    if (raw.startsWith("q:")) q = raw.slice(2).trim();
    else if (raw.startsWith("?")) q = raw.slice(1).trim();
    if (q && q.length >= 2 && q.length <= 120) {
      newItems.push({
        id: `mpli_${randomKey()}`,
        type: "query",
        title: q.slice(0, 100),
        url: q, // stored as query string
        size: 0,
        contentType: "",
        addedBy: message.author.id,
        addedAt: Date.now(),
        sourceMessageId: message.id
      });
    }
  }

  if (!newItems.length) {
    // Something was dropped but nothing parseable — show ❓ hint (rate-limited to avoid spam)
    const hintKey = `musicpl:hint:${message.guildId}:${message.author.id}`;
    const rl = await checkRateLimit(hintKey, 1, 300).catch(() => ({ ok: true }));
    if (rl.ok) {
      await message.reply({
        content: `❓ Nothing recognisable was added. Drop **audio files**, paste a **YouTube/SoundCloud link**, or type \`q: search terms\` to add a search query.`
      }).catch(() => {});
    }
    return;
  }

  // Dedupe by URL (within playlist), keep newest first.
  const seen = new Set(pl.items.map(it => String(it?.url ?? "")));
  const toAdd = [];
  for (const it of newItems) {
    const url = String(it.url ?? "");
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    toAdd.push(it);
  }
  if (!toAdd.length) {
    // Everything was a duplicate — signal with a reaction so user knows
    await message.react("🔁").catch(() => {});
    return;
  }

  pl.items = [...toAdd, ...pl.items];
  pl.items = pl.items.slice(0, cfg.maxItemsPerPlaylist);
  pl.updatedAt = Date.now();

  if (pl.items.length !== before) {
    await saveGuildData(message.guildId, guildData).catch(() => {});
    // If a pinned panel exists, update it.
    void tryUpdatePlaylistPanelMessage(message.guild, guildData, playlistId).catch(() => {});

    // ✅ Feedback reaction + optional tip message
    await message.react("✅").catch(() => {});

    // Attachment URL expiry warning (Discord CDN URLs expire in ~24h)
    const hasAttachment = toAdd.some(it => it.type === "attachment");
    if (hasAttachment) {
      const warningKey = `musicpl:att_warn:${message.guildId}:${message.author.id}`;
      const rl = await checkRateLimit(warningKey, 1, 3600).catch(() => ({ ok: true }));
      if (rl.ok) {
        await message.reply({
          content: `✅ Added **${toAdd.length}** track${toAdd.length !== 1 ? "s" : ""} to **${pl.name ?? "your playlist"}**.\n⚠️ **Note:** Audio files are stored by Discord CDN URL, which expires in ~24 hours. Use the **Browse** button and queue your tracks soon, or re-upload later if the URL expires.`
        }).catch(() => {});
      }
    } else if (toAdd.length === 1 && toAdd[0].type === "query") {
      // Confirm query capture
      await message.reply({
        content: `✅ Search query **"${toAdd[0].title}"** added to **${pl.name ?? "your playlist"}**.\nUse **Browse** to queue it.`
      }).catch(() => {});
    }
  }
}

export async function maybeHandlePlaylistIngestMessage(message, guildData) {
  try {
    if (!message?.guildId) return;
    if (!message?.channelId) return;
    // Only ingest in channels that are bound to a playlist.
    const bound = guildData?.music?.playlists?.channelBindings?.[message.channelId];
    if (!bound) return;
    // Throttle ingestion per user/channel to avoid abuse (still saves content).
    const rl = await checkRateLimit(`musicpl:ingest:${message.guildId}:${message.channelId}:${message.author.id}`, 6, 20);
    if (!rl.ok) return;
    await ingestPlaylistMessage(message, guildData);
  } catch (err) {
    botLogger.error("[music:playlists] ingest failed:", err?.stack ?? err?.message ?? err);
  }
}

export async function maybeHandleAudioDropMessage(message, guildData) {
  try {
    if (!message?.guildId) return;
    if (!message?.channelId) return;
    const enabled = guildData?.music?.drops?.channelIds;
    if (!Array.isArray(enabled) || enabled.length === 0) return;
    if (!enabled.includes(message.channelId)) return;
    if (!message.attachments?.size) return;

    // Throttle panels to avoid spam in busy drop channels.
    const rl = await checkRateLimit(`musicdrops:${message.guildId}:${message.channelId}:${message.author.id}`, 2, 15);
    if (!rl.ok) return;

    const atts = Array.from(message.attachments.values());
    const supported = [];
    let sawAudioLike = false;
    let sawTooLarge = false;
    for (const a of atts) {
      const ct = String(a?.contentType ?? "").toLowerCase();
      const ext = getExt(a?.name ?? "");
      if (ct.startsWith("audio/") || (ext && AUDIO_DROP_ALLOWED_EXT.has(ext))) sawAudioLike = true;

      const ok = isSupportedAudioAttachment(a);
      if (!ok.ok) {
        if (ok.reason === "too-large") sawTooLarge = true;
        continue;
      }
      supported.push({
        url: a.url,
        name: String(a.name ?? ""),
        size: Number(a.size ?? 0),
        contentType: String(a.contentType ?? "")
      });
      if (supported.length >= 12) break;
    }
    if (!supported.length) {
      if (sawAudioLike && sawTooLarge) {
        await message.reply({
          embeds: [makeEmbed("Audio Drop", `That file is too large to play here.\nMax upload size: **${AUDIO_DROP_MAX_MB} MB**.`, [], null, null, 0xFF0000)]
        }).catch(() => {});
      }
      return;
    }

    const dropKey = await setAudioDropCache({
      guildId: message.guildId,
      textChannelId: message.channelId,
      messageId: message.id,
      uploaderId: message.author.id,
      attachments: supported
    });

    const payload = buildAudioDropPanel(message, dropKey, message.author.id, supported);
    await message.reply(payload).catch(() => {});
  } catch (err) {
    botLogger.error("[music:drops] message handler failed:", err?.stack ?? err?.message ?? err);
  }
}

async function setSearchCache(entry) {
  const key = randomKey();
  // Store in Redis with TTL
  const ok = await setCache(`search:${key}`, { ...entry, createdAt: Date.now() }, SEARCH_TTL_SEC);
  if (!ok) {
    botLogger.warn("[music] Redis cache failed, search selection may not persist.");
  }
  return key;
}

async function getSearchCache(key) {
  const entry = await getCache(`search:${key}`);
  if (!entry) return null;
  // TTL is handled by Redis, so if we got it, it's valid
  return entry;
}

function truncate(text, max) {
  const s = String(text ?? "");
  if (s.length <= max) return s;
  if (max <= 3) return s.slice(0, Math.max(0, max));
  return s.slice(0, Math.max(0, max - 3)) + "...";
}

function buildSearchMenu(tracks, cacheKey) {
  const options = tracks.slice(0, 25).map((t, idx) => {
    const title = truncate(t?.title ?? "Unknown title", 100);
    const author = truncate(t?.author ?? "", 100);
    const dur = t?.duration ?? t?.length;
    const duration = dur ? ` | ${formatDuration(dur)}` : "";
    return {
      label: title,
      value: String(idx),
      description: truncate(`${author}${duration}`, 100)
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`musicsearch:${cacheKey}`)
    .setPlaceholder("Choose a track to play")
    .addOptions(options);

  return new ActionRowBuilder().addComponents(menu);
}

function formatDuration(ms) {
  const total = Number(ms);
  if (!Number.isFinite(total) || total <= 0) return "0:00";
  const s = Math.floor(total / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function buildQueueEmbed(result, page, pageSize, actionNote) {
  const current = result?.current ?? null;
  const tracks = Array.isArray(result?.tracks) ? result.tracks : [];
  const totalPages = Math.max(1, Math.ceil(tracks.length / pageSize));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * pageSize;
  const end = Math.min(tracks.length, start + pageSize);
  const fields = [];

  if (current?.title) {
    let line = `[${current.title}](${current.uri})`;
    if (current.author) line += ` - ${current.author}`;
    const curDur = current?.duration ?? current?.length;
    if (curDur) line += ` | ${formatDuration(curDur)}`;
    if (current.requester?.username) line += ` | requested by ${current.requester.username}`;
    fields.push({ name: "Now Playing", value: line, inline: false });
  } else {
    fields.push({ name: "Now Playing", value: "Nothing playing in this channel.", inline: false });
  }

  if (tracks.length === 0) {
    fields.push({ name: "Up Next", value: "(empty)", inline: false });
  } else {
    const lines = [];
    for (let i = start; i < end; i++) {
      const t = tracks[i];
      const title = t?.title ?? "Unknown title";
      const durMs = t?.duration ?? t?.length;
      const dur = durMs ? ` | ${formatDuration(durMs)}` : "";
      lines.push(`${i + 1}. [${title}](${t?.uri ?? ""})${dur}`);
    }
    fields.push({ name: `Up Next (${start + 1}-${end} of ${tracks.length})`, value: lines.join("\n"), inline: false });
  }

  const footer = {
    text: `Page ${safePage + 1}/${totalPages}${actionNote ? ` | ${actionNote}` : ""}`
  };

  return { embed: makeEmbed("Music Queue", "Interactive queue controls below.", fields, null, null, QUEUE_COLOR, footer), page: safePage, totalPages };
}

function buildQueueComponents(voiceChannelId, page, totalPages) {
  const base = `musicq:${voiceChannelId}:${page}`;
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${base}:prev`)
      .setLabel("Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`${base}:next`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId(`${base}:refresh`)
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${base}:now`).setLabel("Now").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${base}:pause`).setLabel("Pause").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${base}:resume`).setLabel("Resume").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${base}:skip`).setLabel("Skip").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${base}:stop`).setLabel("Stop").setStyle(ButtonStyle.Danger)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`musicui:playlist:${voiceChannelId}`)
      .setLabel("Playlists")
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2, row3];
}

function buildSettingsEmbed(config, updated) {
  const fields = [
    { name: "Control Mode", value: config?.controlMode ?? "owner", inline: true },
    { name: "Default Mode", value: config?.defaultMode ?? "open", inline: true },
    { name: "Default Volume", value: String(config?.defaultVolume ?? 100), inline: true },
    { name: "Max Queue", value: String(config?.limits?.maxQueue ?? 100), inline: true },
    { name: "Max Track (min)", value: String(config?.limits?.maxTrackMinutes ?? 20), inline: true },
    { name: "Max Queue (min)", value: String(config?.limits?.maxQueueMinutes ?? 120), inline: true },
    { name: "Search Providers", value: (config?.searchProviders?.join(", ") || "default"), inline: false },
    { name: "Fallback Providers", value: (config?.fallbackProviders?.join(", ") || "default"), inline: false }
  ];
  return makeEmbed("Music Settings", updated ? "Settings updated." : "Current settings.", fields, null, null, QUEUE_COLOR);
}

function formatDisconnectField(result) {
  const at = Number(result?.disconnectAt);
  const ms = Number(result?.disconnectInMs);

  if (Number.isFinite(at) && at > 0) {
    return {
      name: "Disconnect",
      value: `<t:${Math.trunc(at)}:R>`,
      inline: true
    };
  }

  if (Number.isFinite(ms) && ms > 0) {
    const at2 = Math.floor((Date.now() + ms) / 1000);
    return {
      name: "Disconnect",
      value: `<t:${at2}:R>`,
      inline: true
    };
  }

  return null;
}

function actionLabel(sub, action) {
  const a = String(action ?? "");

  if (sub === "pause") {
    if (a === "paused") return "Paused";
    if (a === "already-paused") return "Already paused";
    if (a === "nothing-playing") return "Nothing playing";
    if (a === "stopping") return "Stopping";
    return `Pause: ${a || "unknown"}`;
  }

  if (sub === "resume") {
    if (a === "resumed") return "Resumed";
    if (a === "already-playing") return "Already playing";
    if (a === "nothing-playing") return "Nothing playing";
    if (a === "stopping") return "Stopping";
    return `Resume: ${a || "unknown"}`;
  }

  if (sub === "skip") {
    if (a === "skipped") return "Skipped";
    if (a === "stopped") return "Stopped";
    if (a === "nothing-to-skip") return "Nothing to skip";
    if (a === "stopping") return "Stopping";
    return `Skip: ${a || "unknown"}`;
  }

  if (sub === "stop") {
    if (a === "stopped") return "Stopped";
    if (a === "stopping") return "Stopping";
    return `Stop: ${a || "unknown"}`;
  }

  return a || "Done";
}

async function sendAudioDropEphemeral(interaction, payload, { preferFollowUp = false } = {}) {
  const body = { ...payload, ephemeral: true };
  if (preferFollowUp) {
    return interaction.followUp(body).catch(() => {});
  }
  if (interaction.deferred || interaction.replied) {
    // If we deferred a reply, prefer editing the original ephemeral reply.
    if (interaction.deferred) return interaction.editReply(payload).catch(() => {});
    return interaction.followUp(body).catch(() => {});
  }
  return interaction.reply(body).catch(() => {});
}

function buildAudioDropDeployRow(dropKey, uploaderId) {
  const base = `audiodrop:${dropKey}:${uploaderId}`;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${base}:deploy_ui`).setLabel("Deploy Agents").setStyle(ButtonStyle.Secondary)
  );
}

async function playAudioDropToVc(interaction, dropKey, uploaderId, voiceChannelId, { preferFollowUp = false } = {}) {
  const state = await getAudioDropCache(dropKey);
  if (!state) {
    await sendAudioDropEphemeral(interaction, {
      embeds: [makeEmbed("Audio Drop", "This drop panel expired. Upload the file again.", [], null, null, 0xFF0000)]
    }, { preferFollowUp });
    return;
  }

  const guild = interaction.guild;
  if (!guild) {
    await sendAudioDropEphemeral(interaction, {
      embeds: [makeEmbed("Audio Drop", "This action requires a server context.", [], null, null, 0xFF0000)]
    }, { preferFollowUp });
    return;
  }

  const ch = guild.channels.cache.get(voiceChannelId) ?? null;
  if (!ch || (ch.type !== ChannelType.GuildVoice && ch.type !== ChannelType.GuildStageVoice)) {
    await sendAudioDropEphemeral(interaction, {
      embeds: [makeEmbed("Audio Drop", "That voice channel is no longer available.", [], null, null, 0xFF0000)]
    }, { preferFollowUp });
    return;
  }

  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  const botPerms = me ? ch.permissionsFor(me) : null;
  if (!botPerms?.has?.(PermissionsBitField.Flags.Connect)) {
    await sendAudioDropEphemeral(interaction, {
      embeds: [makeEmbed("Audio Drop", `I can't connect to <#${ch.id}>. Check channel permissions.`, [], null, null, 0xFF0000)]
    }, { preferFollowUp });
    return;
  }

  const attachments = Array.isArray(state.attachments) ? state.attachments : [];
  if (!attachments.length) {
    await sendAudioDropEphemeral(interaction, {
      embeds: [makeEmbed("Audio Drop", "No files found for this panel.", [], null, null, 0xFF0000)]
    }, { preferFollowUp });
    return;
  }

  const selIdxRaw = await getAudioDropSelection(dropKey, interaction.user.id);
  const selIdx = Math.max(0, Math.min(attachments.length - 1, selIdxRaw));
  const att = attachments[selIdx];
  const url = String(att?.url ?? "");
  if (!/^https?:\/\//i.test(url)) {
    await sendAudioDropEphemeral(interaction, {
      embeds: [makeEmbed("Audio Drop", "That file URL is invalid.", [], null, null, 0xFF0000)]
    }, { preferFollowUp });
    return;
  }

  const guildId = guild.id;
  let config = null;
  try {
    config = await getMusicConfig(guildId);
  } catch {}

  const alloc = await ensureSessionAgent(guildId, ch.id, {
    textChannelId: state.textChannelId ?? interaction.channelId,
    ownerUserId: interaction.user.id
  });
  if (!alloc.ok) {
    const msg = formatMusicError(alloc.reason);
    const extra = (alloc.reason === "no-agents-in-guild" || alloc.reason === "no-free-agents")
      ? [buildAudioDropDeployRow(dropKey, uploaderId)]
      : [];
    await sendAudioDropEphemeral(interaction, {
      embeds: [makeEmbed("Music Error", msg, [], null, null, 0xFF0000)],
      components: extra
    }, { preferFollowUp });
    return;
  }

  try {
    const result = await sendAgentCommand(alloc.agent, "play", {
      guildId,
      voiceChannelId: ch.id,
      textChannelId: state.textChannelId ?? interaction.channelId,
      ownerUserId: interaction.user.id,
      actorUserId: interaction.user.id,
      query: url,
      defaultMode: config?.defaultMode,
      defaultVolume: config?.defaultVolume,
      limits: config?.limits,
      controlMode: config?.controlMode,
      searchProviders: config?.searchProviders,
      fallbackProviders: config?.fallbackProviders,
      requester: buildRequester(interaction.user)
    });

    const playedTrack = result?.track ?? { title: att?.name || "Audio file", uri: url };
    const action = String(result?.action ?? "queued");
    await sendAudioDropEphemeral(interaction, {
      embeds: [buildTrackEmbed(action, playedTrack)]
    }, { preferFollowUp });
    // Fire-and-forget pool songs_played stat + badge evaluation
    if (guildId) {
      getGuildSelectedPool(guildId).then(poolId => {
        if (poolId) {
          incrementPoolStat(poolId, 'songs_played').catch(() => {});
          evaluatePoolBadges(poolId).catch(() => {});
        }
      }).catch(() => {});

      // Fire-and-forget play history logging
      if (playedTrack?.title) {
        import("../utils/storage_pg.js").then(({ getPool }) => {
          getPool().query(
            `INSERT INTO music_play_history (guild_id, user_id, track_title, track_author, track_uri)
             VALUES ($1, $2, $3, $4, $5)`,
            [guildId, interaction.user.id, playedTrack.title, playedTrack.author ?? null, playedTrack.uri ?? null]
          ).catch(() => {});
        }).catch(() => {});
      }
    }
  } catch (err) {
    const msg = formatMusicError(err);
    await sendAudioDropEphemeral(interaction, {
      embeds: [makeEmbed("Music Error", msg, [], null, null, 0xFF0000)]
    }, { preferFollowUp });
  }
}

async function playPlaylistItem(interaction, agent, guildId, voiceChannelId, item, config, textChannelId) {
  const query = String(item?.url ?? "");
  const isUrl = /^https?:\/\//i.test(query);
  if (isUrl) {
    return sendAgentCommand(agent, "play", {
      guildId,
      voiceChannelId,
      textChannelId,
      ownerUserId: interaction.user.id,
      actorUserId: interaction.user.id,
      query,
      defaultMode: config?.defaultMode,
      defaultVolume: config?.defaultVolume,
      limits: config?.limits,
      controlMode: config?.controlMode,
      searchProviders: config?.searchProviders,
      fallbackProviders: config?.fallbackProviders,
      requester: buildRequester(interaction.user)
    });
  }

  // Query item: search then play the top result deterministically.
  const searchRes = await sendAgentCommand(agent, "search", {
    guildId,
    voiceChannelId,
    textChannelId,
    ownerUserId: interaction.user.id,
    actorUserId: interaction.user.id,
    query,
    defaultMode: config?.defaultMode,
    defaultVolume: config?.defaultVolume,
    limits: config?.limits,
    controlMode: config?.controlMode,
    searchProviders: config?.searchProviders,
    fallbackProviders: config?.fallbackProviders,
    requester: buildRequester(interaction.user)
  });
  const tracks = Array.isArray(searchRes?.tracks) ? searchRes.tracks : [];
  if (!tracks.length) throw new Error("no-results");
  const top = tracks[0];
  return sendAgentCommand(agent, "play", {
    guildId,
    voiceChannelId,
    textChannelId,
    ownerUserId: interaction.user.id,
    actorUserId: interaction.user.id,
    query: top?.uri ?? top?.title ?? query,
    defaultMode: config?.defaultMode,
    defaultVolume: config?.defaultVolume,
    limits: config?.limits,
    controlMode: config?.controlMode,
    searchProviders: config?.searchProviders,
    fallbackProviders: config?.fallbackProviders,
    requester: buildRequester(interaction.user)
  });
}

export async function execute(interaction) {
  await withTimeout(interaction, async () => {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (group === "playlist") {
    if (sub === "panel") {
      const perms = interaction.memberPermissions;
      if (!perms?.has?.(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [makeEmbed("Music Playlists", "Manage Server permission required.", [], null, null, 0xFF0000)] });
        return;
      }
      if (!guildId) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [makeEmbed("Music Playlists", "Server context required.", [], null, null, 0xFF0000)] });
        return;
      }
      const data = await loadGuildData(guildId);
      const cfg = normalizePlaylistsConfig(data);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildPlaylistPanelEmbed(cfg)],
        components: buildPlaylistPanelComponents(cfg, interaction.user.id)
      });
      return;
    }

    if (sub === "browse") {
      const voiceChannelId = await resolveMemberVoiceId(interaction);
      await openPlaylistBrowser(interaction, { voiceChannelId });
      return;
    }

    if (sub === "load") {
      const plName = interaction.options.getString("name", true).trim();
      const gData = await loadGuildData(guildId);
      const savedPls = gData.savedPlaylists ?? {};
      const plTracks = savedPls[plName];
      if (!Array.isArray(plTracks) || !plTracks.length) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [makeEmbed("Music Playlists", `❌ No saved playlist named '${plName}'.`, [], null, null, 0xFF0000)] });
        return;
      }
      const plVcId = await resolveMemberVoiceId(interaction);
      if (!plVcId) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [makeEmbed("Music Playlists", "❌ Join a voice channel first.")] });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const plConfig = await getMusicConfig(guildId);
      const ensureRes = await ensureSessionAgent(guildId, plVcId, { textChannelId: interaction.channelId, ownerUserId: userId });
      if (!ensureRes.ok) {
        await interaction.editReply({ embeds: [makeEmbed("Music Playlists", formatMusicError(ensureRes.reason))] });
        return;
      }
      let plQueued = 0;
      for (const plTrack of plTracks) {
        if (!plTrack?.uri) continue;
        try {
          await sendAgentCommand(ensureRes.agent, "play", {
            guildId, voiceChannelId: plVcId, textChannelId: interaction.channelId,
            ownerUserId: userId, actorUserId: userId,
            controlMode: plConfig.controlMode,
            searchProviders: plConfig.searchProviders,
            fallbackProviders: plConfig.fallbackProviders,
            defaultMode: plConfig.defaultMode,
            defaultVolume: plConfig.defaultVolume,
            query: plTrack.uri,
            requester: buildRequester(interaction.user)
          });
          plQueued++;
        } catch {}
      }
      await interaction.editReply({ embeds: [makeEmbed("Music Playlists", `✅ Queued ${plQueued} tracks from playlist '${plName}'.`)] });
      return;
    }

    if (sub === "save") {
      const plVcIdSave = await resolveMemberVoiceId(interaction);
      if (!plVcIdSave) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [makeEmbed("Music Playlists", "❌ Join a voice channel first.")] });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const plSaveName = interaction.options.getString("name", true).trim();
      const plSaveConfig = await getMusicConfig(guildId);
      const plSaveEnsure = await ensureSessionAgent(guildId, plVcIdSave, { textChannelId: interaction.channelId, ownerUserId: userId });
      if (!plSaveEnsure.ok) {
        await interaction.editReply({ embeds: [makeEmbed("Music Playlists", formatMusicError(plSaveEnsure.reason))] });
        return;
      }
      let plSaveResult;
      try {
        plSaveResult = await sendAgentCommand(plSaveEnsure.agent, "queue", {
          guildId, voiceChannelId: plVcIdSave, textChannelId: interaction.channelId,
          ownerUserId: userId, actorUserId: userId, controlMode: plSaveConfig.controlMode
        });
      } catch (err) {
        await interaction.editReply({ embeds: [makeEmbed("Music Playlists", formatMusicError(err))] });
        return;
      }
      const plSaveCurrent = plSaveResult?.current ?? null;
      const plSaveTracks = Array.isArray(plSaveResult?.tracks) ? plSaveResult.tracks : [];
      const plSaveAll = plSaveCurrent ? [plSaveCurrent, ...plSaveTracks] : plSaveTracks;
      if (!plSaveAll.length) {
        await interaction.editReply({ embeds: [makeEmbed("Music Playlists", "❌ Nothing in queue to save.")] });
        return;
      }
      const plSaveData = await loadGuildData(guildId);
      plSaveData.savedPlaylists ??= {};
      plSaveData.savedPlaylists[plSaveName] = plSaveAll.map(t => ({ title: t.title, uri: t.uri, requester: t.requester }));
      await saveGuildData(guildId, plSaveData);
      await interaction.editReply({ embeds: [makeEmbed("Music Playlists", `✅ Saved playlist '${plSaveName}' with ${plSaveAll.length} tracks.`)] });
      return;
    }

    await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [makeEmbed("Music Playlists", "Unknown action.", [], null, null, 0xFF0000)] });
    return;
  }

  if (group === "drops") {
    const perms = interaction.memberPermissions;
    if (!perms?.has?.(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [makeEmbed("Music", "Manage Server permission required.")]
      });
      return;
    }

    const data = await loadGuildData(guildId);
    data.music ??= {};
    data.music.drops ??= { channelIds: [] };
    if (!Array.isArray(data.music.drops.channelIds)) data.music.drops.channelIds = [];

    const maxMb = Math.max(1, Math.trunc(Number(process.env.MUSIC_DROP_MAX_MB ?? 25)));

    if (sub === "status") {
      const enabled = data.music.drops.channelIds;
      const fields = [
        { name: "Enabled Channels", value: enabled.length ? enabled.map(id => `<#${id}>`).join(", ") : "(none)", inline: false },
        { name: "Max Upload Size", value: `${maxMb} MB`, inline: true }
      ];
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [makeEmbed("Audio Drops", "When a user uploads an audio file in an enabled channel, Chopsticks posts a play panel.", fields, null, null, QUEUE_COLOR)]
      });
      return;
    }

    if (sub === "enable") {
      const ch = interaction.options.getChannel("channel") ?? interaction.channel;
      if (!ch?.id) {
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          embeds: [makeEmbed("Audio Drops", "Choose a text channel.")]
        });
        return;
      }
      if (!data.music.drops.channelIds.includes(ch.id)) data.music.drops.channelIds.push(ch.id);
      await saveGuildData(guildId, data);

      await auditLog({ guildId, userId, action: "music.drops.enable", details: { channelId: ch.id } });
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [makeEmbed("Audio Drops", `Enabled in <#${ch.id}>.\nUpload an audio file there to get a play panel.`, [
          { name: "Max Upload Size", value: `${maxMb} MB`, inline: true }
        ], null, null, QUEUE_COLOR)]
      });
      return;
    }

    if (sub === "disable") {
      const all = Boolean(interaction.options.getBoolean("all") ?? false);
      const ch = interaction.options.getChannel("channel") ?? interaction.channel;

      if (all) {
        data.music.drops.channelIds = [];
        await saveGuildData(guildId, data);
        await auditLog({ guildId, userId, action: "music.drops.disable_all", details: {} });
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          embeds: [makeEmbed("Audio Drops", "Disabled in all channels.", [], null, null, QUEUE_COLOR)]
        });
        return;
      }

      if (!ch?.id) {
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          embeds: [makeEmbed("Audio Drops", "Choose a text channel.")]
        });
        return;
      }

      data.music.drops.channelIds = data.music.drops.channelIds.filter(id => id !== ch.id);
      await saveGuildData(guildId, data);
      await auditLog({ guildId, userId, action: "music.drops.disable", details: { channelId: ch.id } });
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [makeEmbed("Audio Drops", `Disabled in <#${ch.id}>.`, [], null, null, QUEUE_COLOR)]
      });
      return;
    }

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [makeEmbed("Audio Drops", "Unknown action.", [], null, null, 0xFF0000)]
    });
    return;
  }

  // ── social group ─────────────────────────────────────────────────────────
  if (group === "social") {
    if (sub === "history") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const { getPool } = await import("../utils/storage_pg.js");
        const pg = getPool();
        const res = await pg.query(
          `SELECT track_title, track_author, user_id, dedicated_to, played_at
           FROM music_play_history
           WHERE guild_id = $1
           ORDER BY played_at DESC
           LIMIT 10`,
          [guildId]
        );
        if (!res.rows.length) {
          await interaction.editReply({ embeds: [makeEmbed("Recent Songs", "No songs have been played yet.")] });
          return;
        }
        const fields = res.rows.map((r, i) => ({
          name: `${i + 1}. ${r.track_title}`,
          value: `by ${r.track_author ?? "Unknown"} · queued by <@${r.user_id}>${r.dedicated_to ? ` · 💌 for <@${r.dedicated_to}>` : ""} · <t:${Math.floor(new Date(r.played_at).getTime() / 1000)}:R>`,
          inline: false
        }));
        await interaction.editReply({ embeds: [makeEmbed("🎵 Recent Songs", `Last ${res.rows.length} tracks played in this server`, fields, null, null, QUEUE_COLOR)] });
      } catch (err) {
        await interaction.editReply({ embeds: [makeEmbed("Recent Songs", `❌ ${err?.message ?? "Failed to load history."}`)] });
      }
      return;
    }

    if (sub === "trivia") {
      const perms = interaction.memberPermissions;
      if (!perms?.has?.(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [makeEmbed("Music Trivia", "Manage Server permission required.")] });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const vcId = await resolveMemberVoiceId(interaction);
      const ensureRes = vcId ? await ensureSessionAgent(guildId, vcId, { textChannelId: interaction.channelId, ownerUserId: userId }) : { ok: false };
      if (!ensureRes.ok) {
        await interaction.editReply({ embeds: [makeEmbed("Music Trivia", "No active music session. Start playing something first.")] });
        return;
      }
      try {
        let currentTrack = null;
        try {
          const statusRes = await sendAgentCommand(ensureRes.agent, "status", { guildId, voiceChannelId: vcId });
          currentTrack = statusRes?.current ?? null;
        } catch {}
        if (!currentTrack?.title) {
          await interaction.editReply({ embeds: [makeEmbed("Music Trivia", "Nothing is currently playing.")] });
          return;
        }
        const { startTriviaSession } = await import("../music/trivia.js");
        const session = await startTriviaSession(guildId, interaction.channelId, currentTrack);
        if (!session) {
          await interaction.editReply({ embeds: [makeEmbed("Music Trivia", "❌ Could not generate a trivia question right now.")] });
          return;
        }
        const channel = interaction.channel;
        if (channel?.isTextBased?.()) {
          await channel.send({ content: `🎵 **Music Trivia!** First to answer correctly gets **+75 XP** ⏱️ 30 seconds\n\n❓ ${session.question}` }).catch(() => {});
        }
        await interaction.editReply({ embeds: [makeEmbed("Music Trivia", "✅ Trivia question posted!")] });
      } catch (err) {
        await interaction.editReply({ embeds: [makeEmbed("Music Trivia", `❌ ${err?.message ?? "Failed to start trivia."}`)] });
      }
      return;
    }

    if (sub === "dedicate" || sub === "request") {
      const vcId = await resolveMemberVoiceId(interaction);
      if (!vcId) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [makeEmbed("Music", "❌ Join a voice channel first.")] });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const query = interaction.options.getString("query", true).trim();
      const dedicateTo = sub === "dedicate" ? interaction.options.getUser("to") : null;
      const requestMsg = interaction.options.getString("message") ?? null;
      const config = await getMusicConfig(guildId);
      const ensureRes = await ensureSessionAgent(guildId, vcId, { textChannelId: interaction.channelId, ownerUserId: userId });
      if (!ensureRes.ok) {
        await interaction.editReply({ embeds: [makeEmbed("Music", formatMusicError(ensureRes.reason))] });
        return;
      }
      let playRes;
      try {
        playRes = await sendAgentCommand(ensureRes.agent, "play", {
          guildId, voiceChannelId: vcId, textChannelId: interaction.channelId,
          ownerUserId: userId, actorUserId: userId,
          controlMode: config.controlMode,
          searchProviders: config.searchProviders,
          fallbackProviders: config.fallbackProviders,
          defaultMode: config.defaultMode,
          defaultVolume: config.defaultVolume,
          query,
          requester: buildRequester(interaction.user)
        });
      } catch (err) {
        if (String(err?.message ?? err) === "no-session") releaseSession(guildId, vcId);
        await interaction.editReply({ embeds: [makeEmbed("Music", formatMusicError(err))] });
        return;
      }
      const socialTrack = playRes?.track ?? playRes?.tracks?.[0] ?? null;
      let desc = socialTrack ? `✅ **${socialTrack.title ?? "Track"}** queued` : "✅ Track queued";
      if (sub === "dedicate" && dedicateTo) {
        desc += `\n💌 Dedicated to <@${dedicateTo.id}>`;
        // Log to history with dedication
        try {
          const { getPool } = await import("../utils/storage_pg.js");
          const pg = getPool();
          await pg.query(
            `INSERT INTO music_play_history (guild_id, user_id, track_title, track_author, track_uri, dedicated_to)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [guildId, userId, socialTrack?.title ?? query, socialTrack?.author ?? null, socialTrack?.uri ?? null, dedicateTo.id]
          );
        } catch {}
      } else if (requestMsg) {
        desc += `\n💬 "${requestMsg}"`;
      }
      if (ensureRes.isPrimaryMode) desc += `\n\n*🎵 Primary mode (1 VC) · /agents deploy for multi-VC*`;
      await interaction.editReply({ embeds: [makeEmbed("Music", desc)] });
      return;
    }

    await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [makeEmbed("Music", "Unknown social action.", [], null, null, 0xFF0000)] });
    return;
  }

  if (sub === "default") {
    const perms = interaction.memberPermissions;
    if (!perms?.has?.(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [makeEmbed("Music", "Manage Server permission required.")]
      });
      return;
    }

    const mode = interaction.options.getString("mode", true);
    const res = await setDefaultMusicMode(guildId, mode);
    await auditLog({
      guildId,
      userId,
      action: "music.default.set",
      details: { mode: res.defaultMode }
    });
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [makeEmbed("Music", `Default mode set to **${res.defaultMode}**.`)]
    });
    return;
  }

  if (sub === "settings") {
    const perms = interaction.memberPermissions;
    if (!perms?.has?.(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [makeEmbed("Music", "Manage Server permission required.")]
      });
      return;
    }

    const patch = {};
    const limits = {};
    const controlMode = interaction.options.getString("control_mode");
    const defaultMode = interaction.options.getString("default_mode");
    const defaultVolume = interaction.options.getInteger("default_volume");
    const maxQueue = interaction.options.getInteger("max_queue");
    const maxTrackMinutes = interaction.options.getInteger("max_track_minutes");
    const maxQueueMinutes = interaction.options.getInteger("max_queue_minutes");
    const searchProviders = interaction.options.getString("search_providers");
    const fallbackProviders = interaction.options.getString("fallback_providers");

    if (controlMode) patch.controlMode = controlMode;
    if (defaultMode) patch.defaultMode = defaultMode;
    if (Number.isFinite(defaultVolume)) patch.defaultVolume = defaultVolume;
    if (Number.isFinite(maxQueue)) limits.maxQueue = maxQueue;
    if (Number.isFinite(maxTrackMinutes)) limits.maxTrackMinutes = maxTrackMinutes;
    if (Number.isFinite(maxQueueMinutes)) limits.maxQueueMinutes = maxQueueMinutes;
    if (searchProviders) patch.searchProviders = searchProviders;
    if (fallbackProviders) patch.fallbackProviders = fallbackProviders;
    if (Object.keys(limits).length) patch.limits = limits;

    const hasPatch = Object.keys(patch).length > 0;
    const config = hasPatch
      ? await updateMusicSettings(guildId, patch)
      : await getMusicConfig(guildId);

    if (hasPatch) {
      await auditLog({
        guildId,
        userId,
        action: "music.settings.update",
        details: patch
      });
    }

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildSettingsEmbed(config, hasPatch)]
    });
    return;
  }

  const voiceCheck = requireVoice(interaction);
  if (!voiceCheck.ok) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [makeEmbed("Music", "Join a voice channel.")]
    });
    return;
  }
  const vc = voiceCheck.vc;

  try {
    const config = await getMusicConfig(guildId);
    if (sub === "play") {
      const ack = await safeDefer(interaction, false);
      if (!ack.ok) return;

      const query = interaction.options.getString("query", true);
      if (!String(query).trim()) {
        await interaction.editReply({
          embeds: [makeEmbed("Music", "Query is empty.")]
        });
        return;
      }
      if (String(query).length > 200) {
        await interaction.editReply({
          embeds: [makeEmbed("Music", "Query too long.")]
        });
        return;
      }

      await interaction.editReply({
        embeds: [makeEmbed("Music", `Searching for: **${query}**`)]
      });

      const alloc = await ensureSessionAgent(guildId, vc.id, {
        textChannelId: interaction.channelId,
        ownerUserId: userId
      });

      if (!alloc.ok) {
        botLogger.warn("[music:play] alloc failed:", alloc.reason);
        const errorMsg = formatMusicError(alloc.reason);
        const embedFields = [];
        if (alloc.reason === "no-agents-in-guild" || alloc.reason === "no-free-agents") {
          // Silent failure preference - no hint
        }
        await interaction.editReply({
          embeds: [makeEmbed("Music Error", errorMsg, embedFields, null, null, 0xFF0000)] // Red color for error
        });
        return;
      }

      const isUrl = /^https?:\/\//i.test(String(query).trim());

      if (isUrl) {
        let result;
        try {
          result = await sendAgentCommand(alloc.agent, "play", {
            guildId,
            voiceChannelId: vc.id,
            textChannelId: interaction.channelId,
            ownerUserId: userId,
            actorUserId: userId,
            query,
            defaultMode: config.defaultMode,
            defaultVolume: config.defaultVolume,
            limits: config.limits,
            controlMode: config.controlMode,
            searchProviders: config.searchProviders,
            fallbackProviders: config.fallbackProviders,
            requester: buildRequester(interaction.user)
          });
        } catch (err) {
          botLogger.error("[music:play] agent error:", err?.stack ?? err?.message ?? err);
          await interaction.editReply({
            embeds: [makeEmbed("Music Error", formatMusicError(err), [], null, null, 0xFF0000)]
          });
          return;
        }

        const track = result?.track ?? null;
        if (!track) {
          await interaction.editReply({
            embeds: [makeEmbed("Music", "No results found for that URL.")]
          });
          return;
        }

        const action = String(result?.action ?? "queued");
        const primaryFooter = alloc.isPrimaryMode ? "🎵 Primary mode (1 VC) · /agents deploy for multi-VC" : null;
        await interaction.editReply({
          embeds: [buildTrackEmbed(action, track, { footer: primaryFooter })]
        });
        return;
      }

      let searchRes;
      try {
        searchRes = await sendAgentCommand(alloc.agent, "search", {
          guildId,
          voiceChannelId: vc.id,
          textChannelId: interaction.channelId,
          ownerUserId: userId,
          actorUserId: userId,
          query,
          defaultMode: config.defaultMode,
          defaultVolume: config.defaultVolume,
          limits: config.limits,
          controlMode: config.controlMode,
          searchProviders: config.searchProviders,
          fallbackProviders: config.fallbackProviders,
          requester: buildRequester(interaction.user)
        });
      } catch (err) {
        botLogger.error("[music:search] agent error:", err?.stack ?? err?.message ?? err);
        await interaction.editReply({
          embeds: [makeEmbed("Music Error", formatMusicError(err), [], null, null, 0xFF0000)]
        });
        return;
      }

      const tracks = Array.isArray(searchRes?.tracks) ? searchRes.tracks : [];
      if (!tracks.length) {
        await interaction.editReply({
          embeds: [makeEmbed("Music", "No results found for that query.")]
        });
        return;
      }

      const cacheKey = await setSearchCache({
        userId,
        guildId,
        voiceChannelId: vc.id,
        tracks
      });

      const queueAddLabel = "Voice channel";
      const controlLabel = config.defaultMode === "dj"
        ? "DJ only"
        : (config.controlMode === "voice" ? "Voice channel" : "Owner/Admin");
      const row = buildSearchMenu(tracks, cacheKey);
      await interaction.editReply({
        embeds: [makeEmbed("Music Search", `Select a result to play.`, [
          { name: "Results", value: `${tracks.length} found`, inline: true },
          { name: "Queue Add", value: queueAddLabel, inline: true },
          { name: "Skip/Stop", value: controlLabel, inline: true }
        ], null, null, QUEUE_COLOR)],
        components: [row]
      });
      return;
    }

    const sess = getSessionAgent(guildId, vc.id);
    if (!sess.ok) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [makeEmbed("Music", "Nothing playing in this channel.")]
      });
      return;
    }

    // ── save ──────────────────────────────────────────────────────────────────
    if (sub === "save") {
      const ack = await safeDeferEphemeral(interaction);
      if (!ack.ok) return;
      const saveName = interaction.options.getString("name", true).trim();
      let saveResult;
      try {
        saveResult = await sendAgentCommand(sess.agent, "queue", {
          guildId, voiceChannelId: vc.id, textChannelId: interaction.channelId,
          ownerUserId: userId, actorUserId: userId, controlMode: config.controlMode
        });
      } catch (err) {
        if (String(err?.message ?? err) === "no-session") releaseSession(guildId, vc.id);
        await interaction.editReply({ embeds: [makeEmbed("Music", formatMusicError(err))] });
        return;
      }
      const saveCurrent = saveResult?.current ?? null;
      const saveQueue = Array.isArray(saveResult?.tracks) ? saveResult.tracks : [];
      const saveAll = saveCurrent ? [saveCurrent, ...saveQueue] : saveQueue;
      if (!saveAll.length) {
        await interaction.editReply({ embeds: [makeEmbed("Music", "❌ Nothing in queue to save.")] });
        return;
      }
      const saveData = await loadGuildData(guildId);
      saveData.savedPlaylists ??= {};
      saveData.savedPlaylists[saveName] = saveAll.map(t => ({ title: t.title, uri: t.uri, requester: t.requester }));
      await saveGuildData(guildId, saveData);
      await interaction.editReply({ embeds: [makeEmbed("Music", `✅ Saved playlist '${saveName}' with ${saveAll.length} tracks.`)] });
      return;
    }

    // ── eq ────────────────────────────────────────────────────────────────────
    if (sub === "eq") {
      const ack = await safeDeferEphemeral(interaction);
      if (!ack.ok) return;
      const eqPreset = interaction.options.getString("preset", true);
      const agentPreset = eqPreset === "bass-boost" ? "bassboost" : eqPreset;
      try {
        await sendAgentCommand(sess.agent, "preset", {
          guildId, voiceChannelId: vc.id, textChannelId: interaction.channelId,
          ownerUserId: userId, actorUserId: userId, controlMode: config.controlMode,
          preset: agentPreset
        });
      } catch (err) {
        if (String(err?.message ?? err) === "no-session") releaseSession(guildId, vc.id);
        await interaction.editReply({ embeds: [makeEmbed("Music", formatMusicError(err))] });
        return;
      }
      await interaction.editReply({ embeds: [makeEmbed("Music", `✅ Equalizer set to ${eqPreset}.`)] });
      return;
    }

    // ── dj ────────────────────────────────────────────────────────────────────
    if (sub === "dj") {
      const ack = await safeDeferEphemeral(interaction);
      if (!ack.ok) return;

      const action = interaction.options.getString("action") ?? "on";

      try {
        const { setGuildDJSettings, isDJEnabled, DJ_PERSONAS, DEFAULT_PERSONA, generateTestAnnouncement } = await import("../music/dj.js");

        if (action === "test") {
          const text = await generateTestAnnouncement(guildId);
          if (text) {
            await interaction.editReply({ embeds: [makeEmbed("AI DJ Test", `🎙️ ${text}`, [], null, null, QUEUE_COLOR)] });
          } else {
            await interaction.editReply({ embeds: [makeEmbed("AI DJ", "❌ Test failed — check that `GROQ_API_KEY` is set in your environment.", [], null, null, 0xFF0000)] });
          }
          return;
        }

        if (action === "on") {
          const currentEnabled = await isDJEnabled(guildId);
          if (currentEnabled) {
            await interaction.editReply({ embeds: [makeEmbed("AI DJ", "✅ AI DJ is already enabled. Use `/music dj test` to hear it.")] });
            return;
          }
          await setGuildDJSettings(guildId, { enabled: true });
          await interaction.editReply({ embeds: [makeEmbed("AI DJ", "✅ AI DJ enabled!\nI'll make personality-driven announcements between songs.\n\nUse `/music dj persona` to customize the DJ style.", [], null, null, QUEUE_COLOR)] });
          return;
        }

        if (action === "off") {
          await setGuildDJSettings(guildId, { enabled: false });
          await interaction.editReply({ embeds: [makeEmbed("AI DJ", "✅ AI DJ disabled.")] });
          return;
        }

        if (action === "persona") {
          const style = interaction.options.getString("style") ?? DEFAULT_PERSONA;
          const customName = interaction.options.getString("name") ?? null;

          if (!DJ_PERSONAS[style]) {
            await interaction.editReply({ embeds: [makeEmbed("AI DJ", `❌ Unknown style. Choose: ${Object.keys(DJ_PERSONAS).join(", ")}`, [], null, null, 0xFF0000)] });
            return;
          }

          await setGuildDJSettings(guildId, { enabled: true, persona: style, customPersonaName: customName });

          const p = DJ_PERSONAS[style];
          const displayName = customName ?? p.name;
          await interaction.editReply({
            embeds: [makeEmbed(
              `AI DJ — ${displayName}`,
              `${p.description}\n\n*"${p.example}"*`,
              [{ name: "Style", value: style, inline: true }, { name: "Name", value: displayName, inline: true }],
              null, null, QUEUE_COLOR
            )]
          });
          return;
        }
      } catch (err) {
        await interaction.editReply({ embeds: [makeEmbed("AI DJ", `❌ ${err?.message ?? "Failed"}`, [], null, null, 0xFF0000)] });
      }
      return;
    }

    // ── vibe ──────────────────────────────────────────────────────────────────
    if (sub === "vibe") {
      const ack = await safeDeferEphemeral(interaction);
      if (!ack.ok) return;

      const mood = interaction.options.getString("mood") ?? null;
      try {
        const { setVibeOverride, clearVibeOverride, getVibeInfo, getChannelVibe } = await import("../music/vibe.js");

        if (mood && mood !== "auto") {
          setVibeOverride(guildId, mood);
          const VIBE_EMOJIS = { energetic: "⚡", hype: "🔥", chill: "😌", focus: "🎯", melancholy: "💔", neutral: "🎵" };
          await interaction.editReply({
            embeds: [makeEmbed("Vibe Set", `${VIBE_EMOJIS[mood] ?? "🎵"} Server vibe set to **${mood}**\nAuto-expires in 1 hour.`, [], null, null, QUEUE_COLOR)]
          });
        } else if (mood === "auto") {
          clearVibeOverride(guildId);
          await interaction.editReply({ embeds: [makeEmbed("Vibe", "✅ Vibe detection set to **auto** — I'll read the room from chat.", [], null, null, QUEUE_COLOR)] });
        } else {
          // Show current vibe
          const info = getVibeInfo(guildId);
          const currentVibe = info.vibe;
          const VIBE_EMOJIS = { energetic: "⚡", hype: "🔥", chill: "😌", focus: "🎯", melancholy: "💔", neutral: "🎵" };
          const fields = [
            { name: "Current Vibe", value: `${VIBE_EMOJIS[currentVibe] ?? "🎵"} ${currentVibe}`, inline: true },
            { name: "Source", value: info.source, inline: true }
          ];
          if (info.detectedAt) fields.push({ name: "Detected", value: `<t:${Math.floor(new Date(info.detectedAt).getTime()/1000)}:R>`, inline: true });
          await interaction.editReply({ embeds: [makeEmbed("Server Vibe", "The current detected mood shapes AI music suggestions.", fields, null, null, QUEUE_COLOR)] });
        }
      } catch (err) {
        await interaction.editReply({ embeds: [makeEmbed("Vibe", `❌ ${err?.message ?? "Failed"}`, [], null, null, 0xFF0000)] });
      }
      return;
    }

    // ── autoplay ──────────────────────────────────────────────────────────────
    if (sub === "autoplay") {
      const ack = await safeDeferEphemeral(interaction);
      if (!ack.ok) return;

      const enabled = interaction.options.getBoolean("enabled") ?? false;
      try {
        const { setAutoplay } = await import("../music/smartQueue.js");
        setAutoplay(guildId, enabled);
        await interaction.editReply({
          embeds: [makeEmbed(
            "Autoplay",
            enabled
              ? "✅ **Autoplay enabled** — when the queue empties, I'll pick a similar song using Last.fm.\n\n💡 Make sure `LASTFM_API_KEY` is set for best results."
              : "✅ **Autoplay disabled** — music stops when the queue is empty.",
            [], null, null, QUEUE_COLOR
          )]
        });
      } catch (err) {
        await interaction.editReply({ embeds: [makeEmbed("Autoplay", `❌ ${err?.message ?? "Failed"}`, [], null, null, 0xFF0000)] });
      }
      return;
    }

    // ── lyrics ────────────────────────────────────────────────────────────────
    if (sub === "lyrics") {
      const ack = await safeDeferEphemeral(interaction);
      if (!ack.ok) return;
      let lyricsStatus;
      try {
        lyricsStatus = await sendAgentCommand(sess.agent, "status", {
          guildId, voiceChannelId: vc.id, textChannelId: interaction.channelId,
          ownerUserId: userId, actorUserId: userId, controlMode: config.controlMode
        });
      } catch (err) {
        if (String(err?.message ?? err) === "no-session") releaseSession(guildId, vc.id);
        await interaction.editReply({ embeds: [makeEmbed("Music", formatMusicError(err))] });
        return;
      }
      const lyricsCurrent = lyricsStatus?.current ?? null;
      if (!lyricsCurrent) {
        await interaction.editReply({ embeds: [makeEmbed("Music", "❌ Nothing is playing.")] });
        return;
      }
      const rawTitle = String(lyricsCurrent.title ?? "");
      const rawAuthor = String(lyricsCurrent.author ?? "");
      let lyricsArtist = rawAuthor;
      let lyricsSong = rawTitle;
      if (!lyricsArtist && rawTitle.includes(" - ")) {
        const sep = rawTitle.indexOf(" - ");
        lyricsArtist = rawTitle.slice(0, sep).trim();
        lyricsSong = rawTitle.slice(sep + 3).trim();
      }
      if (!lyricsArtist) {
        await interaction.editReply({ embeds: [makeEmbed("Music", "❌ Cannot determine artist for lyrics lookup.")] });
        return;
      }
      let lyricsText = null;
      try {
        const { fetch: lFetch } = await import("undici");
        const lUrl = `https://api.lyrics.ovh/v1/${encodeURIComponent(lyricsArtist)}/${encodeURIComponent(lyricsSong)}`;
        const lRes = await lFetch(lUrl, { signal: AbortSignal.timeout(8000) });
        if (lRes.ok) {
          const lJson = await lRes.json();
          if (typeof lJson?.lyrics === "string" && lJson.lyrics.trim()) lyricsText = lJson.lyrics.trim();
        }
      } catch {}
      if (!lyricsText) {
        await interaction.editReply({ embeds: [makeEmbed("Music", "❌ Lyrics not found for this track.")] });
        return;
      }
      const lyricsTrunc = lyricsText.length > 4000 ? lyricsText.slice(0, 3997) + "..." : lyricsText;
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle(`Lyrics: ${rawTitle}`).setDescription(lyricsTrunc).setColor(QUEUE_COLOR)]
      });
      return;
    }

    const opMap = {
      skip: "skip",
      pause: "pause",
      resume: "resume",
      stop: "stop",
      now: "status",
      queue: "queue",
      remove: "remove",
      move: "move",
      swap: "swap",
      shuffle: "shuffle",
      clear: "clear",
      status: "status",
      mode: "setMode",
      volume: "volume"
    };

    const op = opMap[sub];
    if (!op) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [makeEmbed("Music", "Unknown action.")]
      });
      return;
    }

    const ack = await safeDeferEphemeral(interaction);
    if (!ack.ok) return;

    const index =
      sub === "remove"
        ? Math.max(0, Math.trunc(interaction.options.getInteger("index", true)) - 1)
        : null;
    const moveFrom =
      sub === "move"
        ? Math.max(0, Math.trunc(interaction.options.getInteger("from", true)) - 1)
        : null;
    const moveTo =
      sub === "move"
        ? Math.max(0, Math.trunc(interaction.options.getInteger("to", true)) - 1)
        : null;
    const swapA =
      sub === "swap"
        ? Math.max(0, Math.trunc(interaction.options.getInteger("a", true)) - 1)
        : null;
    const swapB =
      sub === "swap"
        ? Math.max(0, Math.trunc(interaction.options.getInteger("b", true)) - 1)
        : null;

    let result;
    try {
      result = await sendAgentCommand(sess.agent, op, {
        guildId,
        voiceChannelId: vc.id,
        textChannelId: interaction.channelId,
        ownerUserId: userId,
        actorUserId: userId,
        mode: sub === "mode" ? interaction.options.getString("mode", true) : undefined,
        volume: sub === "volume" ? interaction.options.getInteger("level", true) : undefined,
        controlMode: config.controlMode,
        searchProviders: config.searchProviders,
        fallbackProviders: config.fallbackProviders,
        index,
        from: moveFrom,
        to: moveTo,
        a: swapA,
        b: swapB
      });
    } catch (err) {
      if (String(err?.message ?? err) === "no-session") releaseSession(guildId, vc.id);
      await interaction.editReply({
        embeds: [makeEmbed("Music", formatMusicError(err))]
      });
      return;
    }

    if (sub === "now") {
      const current = result?.current ?? null;
      if (!current) {
        await interaction.editReply({
          embeds: [makeEmbed("Now Playing", "Nothing playing in this channel.")]
        });
        return;
      }

      const fields = [];
      if (current.author) fields.push({ name: "Artist", value: current.author, inline: true });
      const curDur = current?.duration ?? current?.length;
      if (curDur) fields.push({ name: "Duration", value: formatDuration(curDur), inline: true });
      if (current.requester?.username) fields.push({ name: "Requested by", value: current.requester.username, inline: true });

      // Last.fm enrichment — optional, non-blocking, zero regression if unavailable
      if (process.env.LASTFM_API_KEY && current.author && current.title) {
        try {
          const [{ getTrackInfo }, { getSimilarTracks }] = await Promise.all([
            import("../utils/lastfm.js"),
            import("../utils/lastfm.js")
          ]);
          const [info, similar] = await Promise.allSettled([
            getTrackInfo(current.author, current.title),
            getSimilarTracks(current.author, current.title, 1)
          ]);
          if (info.status === "fulfilled" && info.value) {
            const ti = info.value;
            if (ti.playcount) fields.push({ name: "🌍 Global Plays", value: Number(ti.playcount).toLocaleString(), inline: true });
            if (ti.tags?.length) fields.push({ name: "🏷️ Tags", value: ti.tags.slice(0, 3).join(", "), inline: true });
          }
          if (similar.status === "fulfilled" && similar.value?.length) {
            const s = similar.value[0];
            fields.push({ name: "🎵 You might also like", value: `[${s.title} — ${s.artist}](${s.url ?? "https://last.fm"})`, inline: false });
          }
        } catch {}
      }

      await interaction.editReply({
        embeds: [makeEmbed(
          "Now Playing",
          current.title ?? "Unknown title",
          fields,
          current.uri, // URL for the embed
          current.thumbnail // Thumbnail URL
        )]
      });
      return;
    }

    if (sub === "status") {
      const fields = [];
      fields.push({
        name: "Playing",
        value: result?.playing ? "Yes" : "No",
        inline: true
      });
      fields.push({
        name: "Paused",
        value: result?.paused ? "Yes" : "No",
        inline: true
      });
      fields.push({
        name: "Mode",
        value: String(result?.mode ?? "open"),
        inline: true
      });
      if (result?.ownerId) {
        fields.push({
          name: "Owner",
          value: `<@${result.ownerId}>`,
          inline: true
        });
      }
      if (Number.isFinite(result?.queueLength)) {
        fields.push({
          name: "Queue",
          value: String(result.queueLength),
          inline: true
        });
      }
      if (Number.isFinite(result?.volume)) {
        fields.push({
          name: "Volume",
          value: String(result.volume),
          inline: true
        });
      }

      await interaction.editReply({
        embeds: [makeEmbed("Status", "Session status.", fields)]
      });
      return;
    }

    if (sub === "mode") {
      await interaction.editReply({
        embeds: [makeEmbed("Music", `Mode set to **${result?.mode ?? "open"}**.`)]
      });
      return;
    }

    if (sub === "volume") {
      await interaction.editReply({
        embeds: [makeEmbed("Music", `Volume set to **${result?.volume ?? "?"}**.`)]
      });
      return;
    }

    if (sub === "queue") {
      const current = result?.current ?? null;
      const tracks = Array.isArray(result?.tracks) ? result.tracks : [];

      const built = buildQueueEmbed({ current, tracks }, 0, QUEUE_PAGE_SIZE, null);
      await interaction.editReply({
        embeds: [built.embed],
        components: buildQueueComponents(vc.id, built.page, built.totalPages)
      });
      return;
    }

    if (sub === "remove") {
      await interaction.editReply({
        embeds: [makeEmbed("Music", "Removed track from queue.")]
      });
      return;
    }

    if (sub === "move") {
      await interaction.editReply({
        embeds: [makeEmbed("Music", "Moved track in queue.")]
      });
      return;
    }

    if (sub === "swap") {
      await interaction.editReply({
        embeds: [makeEmbed("Music", "Swapped tracks in queue.")]
      });
      return;
    }

    if (sub === "shuffle") {
      await interaction.editReply({
        embeds: [makeEmbed("Music", "Queue shuffled.")]
      });
      return;
    }

    if (sub === "clear") {
      await interaction.editReply({
        embeds: [makeEmbed("Music", "Queue cleared.")]
      });
      return;
    }

    // stop/skip can return grace timer info
    if (sub === "stop" || sub === "skip" || sub === "pause" || sub === "resume") {
      const label = actionLabel(sub, result?.action);
      const fields = [];
      const disconnectField = formatDisconnectField(result);
      if (disconnectField) fields.push(disconnectField);

      // Warn about auto-disconnect after stop/grace
      if ((sub === "stop" || (sub === "skip" && String(result?.action) === "stopped")) && disconnectField) {
        fields.push({
          name: "Note",
          value: "Agent will leave in ~30 seconds unless a new song is queued.",
          inline: false
        });
      }

      if (sub === "stop") {
        // do NOT release session immediately; it is released on grace-expired event
        await interaction.editReply({
          embeds: [makeEmbed("Music", label, fields)]
        });
        return;
      }

      await interaction.editReply({
        embeds: [makeEmbed("Music", label, fields)]
      });
      return;
    }

    await interaction.editReply({
      embeds: [makeEmbed("Music", actionLabel(sub, result?.action))]
    });
  } catch (err) {
    const msg = formatMusicError(err);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          embeds: [makeEmbed("Music Error", msg, [], null, null, 0xFF0000)] // Red color for error
        });
      } else {
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          embeds: [makeEmbed("Music Error", msg, [], null, null, 0xFF0000)] // Red color for error
        });
      }
    } catch {}

    throw err;
  }
  }, { label: "music" });
}

export async function handleButton(interaction) {
  if (!interaction.isButton?.()) return false;
  const id = String(interaction.customId || "");

  if (id.startsWith("mplhub:")) {
    const action = id.split(":")[1] || "";
    const guildId = interaction.guildId;
    if (!guildId) return true;

    if (action === "help") {
      await interaction.reply({
        ephemeral: true,
        embeds: [makeEmbed("Playlist Hub", "Press **Open My Playlist** to open your personal drop thread (or create one if you don't have one yet).\n\nInside your drop thread you can:\n- upload audio files\n- paste links\n- type `q: keywords` to add a search term\n\nPress **Done / Close** in the thread when you're done editing to hide it.\nThen press **Browse Playlists** to queue tracks into your voice channel.", [], null, null, QUEUE_COLOR)]
      }).catch(() => {});
      return true;
    }

    if (action === "browse") {
      const voiceChannelId = await resolveMemberVoiceId(interaction);
      await openPlaylistBrowser(interaction, { voiceChannelId });
      return true;
    }

    if (action === "create") {
      const rl = await checkRateLimit(`mplhub:create:${guildId}:${interaction.user.id}`, 3, 30).catch(() => ({ ok: true }));
      if (!rl.ok) {
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Playlist Hub", "You're doing this too fast. Try again in a moment.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }

      await interaction.deferReply({ ephemeral: true }).catch(() => {});

      const data = await loadGuildData(guildId);
      const cfg = normalizePlaylistsConfig(data);

      // Gate behind admin-controlled feature flag.
      if (!cfg.allowUserCreation) {
        await interaction.editReply({
          embeds: [makeEmbed("Playlist Hub", "User playlists are not enabled on this server.\nAsk an admin to enable them via `/music playlist panel`.", [], null, null, 0xFF0000)]
        }).catch(() => {});
        return true;
      }

      const userId = interaction.user.id;
      const existingPl = Object.values(cfg.playlists || {}).find(p => String(p?.createdBy || "") === userId) ?? null;

      // --- Re-open existing playlist drop thread ---
      if (existingPl) {
        let threadId = existingPl.channelId;
        let thread = threadId ? interaction.guild?.channels?.cache?.get(threadId) : null;

        // Thread exists: re-add user and unarchive.
        if (thread?.isThread?.()) {
          await thread.members.add(userId).catch(() => {});
          if (thread.archived) await thread.setArchived(false).catch(() => {});
          const itemCount = Array.isArray(existingPl.items) ? existingPl.items.length : 0;
          const components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("mplhub:browse").setLabel("Browse Playlists").setStyle(ButtonStyle.Primary)
          )];
          await interaction.editReply({
            embeds: [makeEmbed(
              "Playlist Drop Reopened",
              `Your drop thread is open: <#${thread.id}>\nDrop audio files or links there to add tracks.`,
              [
                { name: "Tracks Saved", value: String(itemCount), inline: true },
                { name: "Tip", value: "Press **Done / Close** in the thread when you're done editing.", inline: false }
              ],
              null, null, QUEUE_COLOR
            )],
            components
          }).catch(() => {});
          return true;
        }

        // Playlist exists but no thread (or thread deleted): create + bind a new thread.
        const newThread = await tryCreateDropThread(interaction, `${interaction.user.username}-playlist`).catch(() => null);
        if (newThread?.id) {
          existingPl.channelId = newThread.id;
          existingPl.updatedAt = Date.now();
          cfg.channelBindings[newThread.id] = existingPl.id;
          // Remove any stale binding for the old missing thread.
          if (threadId && threadId !== newThread.id) delete cfg.channelBindings[threadId];
          data.music.drops ??= { channelIds: [] };
          if (!Array.isArray(data.music.drops.channelIds)) data.music.drops.channelIds = [];
          if (!data.music.drops.channelIds.includes(newThread.id)) data.music.drops.channelIds.push(newThread.id);
          await saveGuildData(guildId, data).catch(() => {});
          threadId = newThread.id;
          thread = newThread;
          // Pin a panel message in the new thread.
          if (thread.isTextBased?.()) {
            const msg = await thread.send({
              embeds: [buildPlaylistPanelMessageEmbed(existingPl)],
              components: buildPlaylistPanelMessageComponents(existingPl.id)
            }).catch(() => null);
            if (msg) {
              await msg.pin().catch(() => {});
              existingPl.panel = { channelId: thread.id, messageId: msg.id };
              existingPl.updatedAt = Date.now();
              await saveGuildData(guildId, data).catch(() => {});
            }
          }
        }

        const components = [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("mplhub:browse").setLabel("Browse Playlists").setStyle(ButtonStyle.Primary)
        )];
        await interaction.editReply({
          embeds: [makeEmbed(
            "Playlist Drop Ready",
            threadId
              ? `Your drop thread is open: <#${threadId}>\nDrop audio files or links there to add tracks.`
              : `Your playlist **${existingPl.name}** is ready but has no drop thread.\nAsk an admin to bind a drop channel via \`/music playlist panel\`.`,
            [{ name: "Tip", value: "Type `q: keywords` in the drop thread to add a search query.", inline: false }],
            null, null, QUEUE_COLOR
          )],
          components
        }).catch(() => {});
        return true;
      }

      // --- Create new playlist ---
      const res = await createPersonalPlaylist(interaction, { parentChannelId: interaction.channelId });
      if (!res.ok) {
        const msg =
          res.reason === "personal-limit"
            ? "You reached your personal playlist limit."
            : (res.reason === "server-limit" ? "This server reached its playlist limit." : "Could not create a playlist.");
        await interaction.editReply({ embeds: [makeEmbed("Personal Playlist", msg, [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }

      // Re-read cfg after createPersonalPlaylist saved it.
      const freshData = await loadGuildData(guildId);
      const freshCfg = normalizePlaylistsConfig(freshData);
      const pl = freshCfg.playlists?.[res.playlistId] ?? res.playlist;

      // If we created a thread, drop a panel message inside it.
      if (res.threadId && interaction.guild) {
        const thread = interaction.guild.channels.cache.get(res.threadId);
        if (thread?.isTextBased?.()) {
          const msg = await thread.send({
            embeds: [buildPlaylistPanelMessageEmbed(pl)],
            components: buildPlaylistPanelMessageComponents(pl.id)
          }).catch(() => null);
          if (msg) {
            await msg.pin().catch(() => {});
            pl.panel = { channelId: thread.id, messageId: msg.id };
            pl.updatedAt = Date.now();
            await saveGuildData(guildId, freshData).catch(() => {});
          }
        }
      }

      const components = [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("mplhub:browse").setLabel("Browse Playlists").setStyle(ButtonStyle.Primary)
      )];

      await interaction.editReply({
        embeds: [makeEmbed(
          "Playlist Drop Created",
          res.threadId
            ? `Your drop thread is ready: <#${res.threadId}>\nDrop audio files or links there to build your playlist.`
            : "✅ Playlist created! However, a drop thread couldn't be created automatically.\n\nThis usually means the bot is missing **Create Private Threads** permission in this channel, or you're not in a text channel.\n\nAsk an admin to:\n1. Give the bot `Create Private Threads` permission, or\n2. Bind a drop channel via `/music playlist panel`.",
          [
            { name: "Tip", value: "Type `q: keywords` in the drop thread to add a search query.\nPress **Done / Close** in the thread when you're done editing.", inline: false }
          ],
          null, null, QUEUE_COLOR
        )],
        components
      }).catch(() => {});
      return true;
    }
  }

  if (id.startsWith("mplbulk:")) {
    const parts = id.split(":");
    const action = parts[1]; // confirm|cancel
    const uiKey = parts[2];
    const ownerId = parts[3];
    if (ownerId && interaction.user.id !== ownerId) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Playlist", "This panel belongs to another user.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    await interaction.deferUpdate().catch(() => {});
    if (action === "cancel") {
      await interaction.editReply({ embeds: [makeEmbed("Bulk Remove", "Cancelled.", [], null, null, QUEUE_COLOR)], components: [] }).catch(() => {});
      return true;
    }
    const bulk = await getCache(`mplbulk:${uiKey}:${interaction.user.id}`);
    const ids = Array.isArray(bulk?.ids) ? bulk.ids.map(String) : [];
    if (!ids.length) {
      await interaction.editReply({ embeds: [makeEmbed("Bulk Remove", "Selection expired.", [], null, null, 0xFF0000)], components: [] }).catch(() => {});
      return true;
    }

    const ui = await getPlaylistUiCache(uiKey);
    if (!ui || String(ui.userId) !== interaction.user.id) {
      await interaction.editReply({ embeds: [makeEmbed("Bulk Remove", "Playlist session expired. Re-open playlists.", [], null, null, 0xFF0000)], components: [] }).catch(() => {});
      return true;
    }

    const guildId = ui.guildId || interaction.guildId;
    if (!guildId) return true;
    const data = await loadGuildData(guildId);
    const cfg = normalizePlaylistsConfig(data);
    const pl = cfg.playlists?.[ui.selectedPlaylistId] ?? null;
    if (!pl) return true;
    if (!canManagePlaylist(interaction, pl)) {
      await interaction.editReply({ embeds: [makeEmbed("Bulk Remove", "No permission.", [], null, null, 0xFF0000)], components: [] }).catch(() => {});
      return true;
    }

    const before = pl.items?.length || 0;
    pl.items = (pl.items || []).filter(it => !ids.includes(String(it?.id || "")));
    const removed = Math.max(0, before - (pl.items?.length || 0));
    pl.updatedAt = Date.now();
    await saveGuildData(guildId, data).catch(() => {});
    await auditLog({ guildId, userId: interaction.user.id, action: "music.playlists.bulk_remove", details: { playlistId: pl.id, removed } });
    void tryUpdatePlaylistPanelMessage(interaction.guild, data, pl.id).catch(() => {});

    await interaction.editReply({
      embeds: [makeEmbed("Bulk Remove", `Removed **${removed}** item(s).`, [], null, null, QUEUE_COLOR)],
      components: []
    }).catch(() => {});
    return true;
  }

  if (id.startsWith("mpldedupe:")) {
    const parts = id.split(":");
    const uiKey = parts[1];
    const ownerId = parts[2];
    const action = parts[3] || "";
    if (ownerId && interaction.user.id !== ownerId) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Playlist", "This panel belongs to another user.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    await interaction.deferUpdate().catch(() => {});
    if (action === "cancel") {
      await interaction.editReply({ embeds: [makeEmbed("Dedupe", "Cancelled.", [], null, null, QUEUE_COLOR)], components: [] }).catch(() => {});
      return true;
    }

    const ui = await getPlaylistUiCache(uiKey);
    if (!ui || String(ui.userId) !== interaction.user.id) {
      await interaction.editReply({ embeds: [makeEmbed("Dedupe", "Playlist session expired. Re-open playlists.", [], null, null, 0xFF0000)], components: [] }).catch(() => {});
      return true;
    }
    const guildId = ui.guildId || interaction.guildId;
    if (!guildId) return true;
    const data = await loadGuildData(guildId);
    const cfg = normalizePlaylistsConfig(data);
    const pl = cfg.playlists?.[ui.selectedPlaylistId] ?? null;
    if (!pl) return true;
    if (!canManagePlaylist(interaction, pl)) {
      await interaction.editReply({ embeds: [makeEmbed("Dedupe", "No permission.", [], null, null, 0xFF0000)], components: [] }).catch(() => {});
      return true;
    }

    const seen = new Set();
    const kept = [];
    let removed = 0;
    for (const it of (pl.items || [])) {
      const url = String(it?.url || "");
      if (!url) {
        kept.push(it);
        continue;
      }
      if (seen.has(url)) {
        removed += 1;
        continue;
      }
      seen.add(url);
      kept.push(it);
    }
    pl.items = kept;
    pl.updatedAt = Date.now();
    await saveGuildData(guildId, data).catch(() => {});
    await auditLog({ guildId, userId: interaction.user.id, action: "music.playlists.dedupe", details: { playlistId: pl.id, removed } });
    void tryUpdatePlaylistPanelMessage(interaction.guild, data, pl.id).catch(() => {});

    await interaction.editReply({ embeds: [makeEmbed("Dedupe", `Removed **${removed}** duplicate item(s).`, [], null, null, QUEUE_COLOR)], components: [] }).catch(() => {});
    return true;
  }

  if (id.startsWith("mplmore:")) {
    const parts = id.split(":");
    const uiKey = parts[1];
    const ownerId = parts[2];
    const action = parts[3] || "";
    if (ownerId && interaction.user.id !== ownerId) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Playlist", "This panel belongs to another user.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    const ui = await getPlaylistUiCache(uiKey);
    if (!ui || String(ui.userId) !== interaction.user.id) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Playlist", "This playlist session expired. Re-open playlists.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    const guildId = ui.guildId || interaction.guildId;
    if (!guildId) return true;
    const data = await loadGuildData(guildId);
    const cfg = normalizePlaylistsConfig(data);
    const pl = cfg.playlists?.[ui.selectedPlaylistId] ?? null;
    if (!pl) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Playlist", "Playlist not found.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    const canManage = canManagePlaylist(interaction, pl);

    if (action === "close") {
      await interaction.deferUpdate().catch(() => {});
      await interaction.editReply({ embeds: [makeEmbed("Playlist Actions", "Closed.", [], null, null, QUEUE_COLOR)], components: [] }).catch(() => {});
      return true;
    }

    if (action === "queue_ui") {
      await interaction.deferUpdate().catch(() => {});
      const vcId = await resolveMemberVoiceId(interaction);
      if (!vcId) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music", "Join a voice channel to view its queue.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const sess = getSessionAgent(guildId, vcId);
      if (!sess.ok) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music", "Nothing playing in this voice channel.", [], null, null, QUEUE_COLOR)] }).catch(() => {});
        return true;
      }
      let config = null;
      try { config = await getMusicConfig(guildId); } catch {}
      try {
        const result = await sendAgentCommand(sess.agent, "queue", {
          guildId,
          voiceChannelId: vcId,
          textChannelId: interaction.channelId,
          ownerUserId: interaction.user.id,
          actorUserId: interaction.user.id,
          controlMode: config?.controlMode,
          searchProviders: config?.searchProviders,
          fallbackProviders: config?.fallbackProviders
        });
        const built = buildQueueEmbed(result, 0, QUEUE_PAGE_SIZE, null);
        await interaction.followUp({
          ephemeral: true,
          embeds: [built.embed],
          components: buildQueueComponents(vcId, built.page, built.totalPages)
        }).catch(() => {});
      } catch (err) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music Error", formatMusicError(err), [], null, null, 0xFF0000)] }).catch(() => {});
      }
      return true;
    }

    if (action === "invite") {
      await interaction.deferUpdate().catch(() => {});
      if (!canManage) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Invite Code", "You don't have permission to invite collaborators for this playlist.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const code = await createPlaylistInvite({ guildId, playlistId: pl.id, createdBy: interaction.user.id });
      if (!code) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Invite Code", "Failed to create invite. Try again.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      await interaction.followUp({
        ephemeral: true,
        embeds: [makeEmbed("Invite Code", `Share this code to add someone as a collaborator:\n\`${code}\`\n\nThey can redeem it via the playlist **More** menu: **Join Code**.`, [], null, null, QUEUE_COLOR)]
      }).catch(() => {});
      return true;
    }

    if (action === "join") {
      const modalKey = await setPlaylistModalState({ action: "join_invite", guildId, userId: interaction.user.id, uiKey });
      const modal = new ModalBuilder().setCustomId(`musicplmodal:${modalKey}`).setTitle("Join Playlist");
      const input = new TextInputBuilder()
        .setCustomId("code")
        .setLabel("Invite code (e.g., PL-XXXXXXX)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(32);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal).catch(() => {});
      return true;
    }

    if (action === "new_personal") {
      await interaction.deferUpdate().catch(() => {});
      const myCount = Object.values(cfg.playlists || {}).filter(p => String(p?.createdBy || "") === interaction.user.id).length;
      if (myCount >= cfg.maxPersonalPerUser) {
        await interaction.followUp({
          ephemeral: true,
          embeds: [makeEmbed("Personal Playlist", `You reached your personal playlist limit (${cfg.maxPersonalPerUser}).`, [], null, null, 0xFF0000)]
        }).catch(() => {});
        return true;
      }
      if (Object.values(cfg.playlists || {}).length >= cfg.maxPlaylists) {
        await interaction.followUp({
          ephemeral: true,
          embeds: [makeEmbed("Personal Playlist", `Server playlist limit reached (${cfg.maxPlaylists}).`, [], null, null, 0xFF0000)]
        }).catch(() => {});
        return true;
      }

      const playlistId = `pl_${randomKey()}`;
      const name = `${interaction.user.username}'s playlist`.slice(0, 40);
      cfg.playlists[playlistId] = {
        id: playlistId,
        name,
        channelId: null,
        visibility: "collaborators",
        createdBy: interaction.user.id,
        collaborators: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        perms: { read: "collaborators", write: "collaborators" },
        panel: null,
        items: []
      };

      // Best-effort: create a private drop thread under current channel.
      const boundChannels = Object.keys(cfg.channelBindings || {});
      const canBindChannel = boundChannels.length < MUSIC_PLAYLIST_MAX_CHANNELS;
      const thread = canBindChannel
        ? await maybeCreatePersonalDropThread(interaction, `${interaction.user.username}-playlist`).catch(() => null)
        : null;
      if (thread?.id) {
        cfg.channelBindings[thread.id] = playlistId;
        cfg.playlists[playlistId].channelId = thread.id;
        // Enable Audio Drops panel in the thread for a clean UX.
        data.music ??= {};
        data.music.drops ??= { channelIds: [] };
        if (!Array.isArray(data.music.drops.channelIds)) data.music.drops.channelIds = [];
        if (!data.music.drops.channelIds.includes(thread.id)) data.music.drops.channelIds.push(thread.id);
      }

      await saveGuildData(guildId, data).catch(() => {});
      await auditLog({ guildId, userId: interaction.user.id, action: "music.playlists.personal_create", details: { playlistId, threadId: thread?.id || null } });

      await setCache(`mplui:${uiKey}`, { ...ui, selectedPlaylistId: playlistId, selectedItemId: "", sortKey: "manual", query: "", page: 0 }, PLAYLIST_UI_TTL_SEC).catch(() => {});
      await interaction.followUp({
        ephemeral: true,
        embeds: [makeEmbed("Personal Playlist", thread?.id
          ? `Created **${name}**.\nDrop files/links here: <#${thread.id}>`
          : (canBindChannel
              ? `Created **${name}**.\nTo add tracks, bind a drop channel from the admin panel or ask an admin to allow threads.`
              : `Created **${name}**.\nThis server has reached its playlist-channel cap (${MUSIC_PLAYLIST_MAX_CHANNELS}). Ask an admin to increase it or clean up unused playlist channels.`), [], null, null, QUEUE_COLOR)]
      }).catch(() => {});
      return true;
    }

    if (action === "dedupe") {
      await interaction.deferUpdate().catch(() => {});
      if (!canManage) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Dedupe", "You don't have permission to dedupe this playlist.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const items = Array.isArray(pl.items) ? pl.items : [];
      const seen = new Set();
      let dupes = 0;
      for (const it of items) {
        const url = String(it?.url || "");
        if (!url) continue;
        if (seen.has(url)) dupes += 1;
        else seen.add(url);
      }
      if (!dupes) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Dedupe", "No duplicates found (by URL).", [], null, null, QUEUE_COLOR)] }).catch(() => {});
        return true;
      }
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`mpldedupe:${uiKey}:${interaction.user.id}:confirm`).setLabel(`Remove ${dupes} duplicate${dupes === 1 ? "" : "s"}`).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`mpldedupe:${uiKey}:${interaction.user.id}:cancel`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      );
      await interaction.followUp({
        ephemeral: true,
        embeds: [makeEmbed("Dedupe", `Found **${dupes}** duplicate item(s) by URL.\nConfirm to remove duplicates (keeps the first occurrence).`, [], null, null, 0xFF0000)],
        components: [row]
      }).catch(() => {});
      return true;
    }

    if (action === "bulk_remove") {
      await interaction.deferUpdate().catch(() => {});
      if (!canManage) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Bulk Remove", "You don't have permission to bulk edit this playlist.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const sortKey = normalizeSortKey(ui.sortKey);
      const query = normalizeQuery(ui.query);
      const view = buildPlaylistViewItems(pl, { query, sortKey });
      const pageSize = 25;
      const totalPages = Math.max(1, Math.ceil(view.length / pageSize));
      const page = Math.max(0, Math.min(Number(ui.page || 0) || 0, totalPages - 1));
      const start = page * pageSize;
      const end = Math.min(view.length, start + pageSize);
      const pageItems = view.slice(start, end).slice(0, 25);
      if (!pageItems.length) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Bulk Remove", "No items on this page.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`mplbulk:pick:${uiKey}:${interaction.user.id}`)
        .setPlaceholder("Select tracks to remove")
        .setMinValues(1)
        .setMaxValues(Math.min(25, pageItems.length))
        .addOptions(pageItems.map(it => ({ label: truncate(playlistItemLabel(it), 100), value: String(it.id) })));
      await interaction.followUp({
        ephemeral: true,
        embeds: [makeEmbed("Bulk Remove", "Pick one or more tracks, then confirm.", [], null, null, QUEUE_COLOR)],
        components: [new ActionRowBuilder().addComponents(menu)]
      }).catch(() => {});
      return true;
    }

    if (action === "move") {
      if (!canManage) {
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Move Track", "You don't have permission to edit this playlist.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const sortKey = normalizeSortKey(ui.sortKey);
      if (sortKey !== "manual") {
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Move Track", "Switch sort to **Manual** first.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const selectedItemId = String(ui.selectedItemId || "");
      if (!selectedItemId) {
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Move Track", "Pick a track first.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const max = Array.isArray(pl.items) ? pl.items.length : 0;
      const modalKey = await setPlaylistModalState({ action: "move", guildId, userId: interaction.user.id, uiKey, playlistId: pl.id, itemId: selectedItemId, max });
      const modal = new ModalBuilder().setCustomId(`musicplmodal:${modalKey}`).setTitle("Move Track");
      const input = new TextInputBuilder()
        .setCustomId("pos")
        .setLabel(`New position (1-${Math.max(1, max)})`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(5);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal).catch(() => {});
      return true;
    }

    await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Playlist Actions", "Unknown action.", [], null, null, 0xFF0000)] }).catch(() => {});
    return true;
  }

  if (id.startsWith("mplpanel:")) {
    const parts = id.split(":");
    const action = parts[1] || "";
    const playlistId = parts[2] || "";
    const guildId = interaction.guildId;
    if (!guildId) return true;
    const data = await loadGuildData(guildId);
    const cfg = normalizePlaylistsConfig(data);
    const pl = cfg.playlists?.[playlistId] ?? null;
    if (!pl) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Playlist", "Playlist not found.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    if (!canReadPlaylist(interaction, pl)) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Playlist", "This playlist is private.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    if (action === "open") {
      const voiceChannelId = await resolveMemberVoiceId(interaction);
      await openPlaylistBrowser(interaction, { voiceChannelId, presetPlaylistId: pl.id });
      return true;
    }

    if (action === "refresh") {
      await interaction.deferUpdate().catch(() => {});
      await interaction.message?.edit?.({
        embeds: [buildPlaylistPanelMessageEmbed(pl)],
        components: buildPlaylistPanelMessageComponents(pl.id)
      }).catch(() => {});
      return true;
    }

    if (action === "queue_random") {
      const items = buildPlaylistViewItems(pl, { query: "", sortKey: "newest" });
      if (!items.length) {
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Playlist", "This playlist is empty.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const pick = items[Math.floor(Math.random() * items.length)];
      const vcId = await resolveMemberVoiceId(interaction);
      if (!vcId) {
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music", "Join a voice channel, then press Queue Random again.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      let config = null;
      try { config = await getMusicConfig(guildId); } catch {}
      const alloc = await ensureSessionAgent(guildId, vcId, { textChannelId: interaction.channelId, ownerUserId: interaction.user.id });
      if (!alloc.ok) {
        const deployRow = (alloc.reason === "no-agents-in-guild" || alloc.reason === "no-free-agents")
          ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`mplpanel:deploy_agents:${playlistId}`).setLabel("Deploy Agents").setStyle(ButtonStyle.Secondary))]
          : [];
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Error", formatMusicError(alloc.reason), [], null, null, 0xFF0000)], components: deployRow }).catch(() => {});
        return true;
      }
      try {
        const result = await playPlaylistItem(interaction, alloc.agent, guildId, vcId, pick, config, interaction.channelId);
        const track = result?.track ?? { title: pick?.title || "Playlist item" };
        await interaction.reply({ ephemeral: true, embeds: [buildTrackEmbed(String(result?.action ?? "queued"), track)] }).catch(() => {});
      } catch (err) {
        if (String(err?.message ?? err) === "no-results") {
          await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music", "No results found for that query.", [], null, null, 0xFF0000)] }).catch(() => {});
          return true;
        }
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Error", formatMusicError(err), [], null, null, 0xFF0000)] }).catch(() => {});
      }
      return true;
    }

    if (action === "close_drop") {
      const rl = await checkRateLimit(`mplpanel:close_drop:${guildId}:${interaction.user.id}`, 5, 60).catch(() => ({ ok: true }));
      if (!rl.ok) {
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Playlist", "Slow down — try again in a moment.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      // Everyone can close (remove themselves); only owner/admin can archive for all.
      const thread = interaction.channel;
      const isAdmin = Boolean(interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild));
      const isOwner = String(pl?.createdBy || "") === interaction.user.id;
      const collabs = new Set(Array.isArray(pl?.collaborators) ? pl.collaborators.map(String) : []);
      const isCollab = collabs.has(interaction.user.id);
      const canClose = isAdmin || isOwner || isCollab;

      if (!canClose) {
        // Any non-collab can still remove themselves from the thread
        if (thread?.isThread?.()) {
          await thread.members.remove(interaction.user.id).catch(() => {});
        }
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Playlist Drop", "You've been removed from this thread.", [], null, null, QUEUE_COLOR)] }).catch(() => {});
        return true;
      }

      if (thread?.isThread?.()) {
        await thread.members.remove(interaction.user.id).catch(() => {});
        // Only archive (hide for everyone) if owner/admin. Collaborators just remove themselves.
        if ((isOwner || isAdmin) && !thread.archived) {
          try { await thread.setArchived(true); } catch {}
        }
      }
      await interaction.reply({
        ephemeral: true,
        embeds: [makeEmbed(
          "Playlist Drop Closed",
          "Your drop thread is now hidden from your channel list.\nPress **Open My Playlist** in the hub anytime to reopen it.",
          [], null, null, QUEUE_COLOR
        )]
      }).catch(() => {});
      return true;
    }

    if (action === "deploy_agents") {
      await openAdvisorUiHandoff(interaction, { desiredTotal: 10 }).catch(() => {});
      return true;
    }
  }

  if (id.startsWith("mplbtn:")) {
    const parts = id.split(":");
    const uiKey = parts[1];
    const ownerId = parts[2];
    const action = parts[3] || "";
    if (ownerId && interaction.user.id !== ownerId) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Not for you.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    const state = await getPlaylistUiCache(uiKey);
    if (!state) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "This playlist panel expired. Re-open it.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    if (String(state.userId) !== interaction.user.id) return true;

    const data = await loadGuildData(state.guildId);
    const cfg = normalizePlaylistsConfig(data);
    const playlist = cfg.playlists?.[state.selectedPlaylistId] ?? Object.values(cfg.playlists || {})[0] ?? null;
    if (!playlist) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Playlist not found.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    // Ensure state defaults
    const sortKey = normalizeSortKey(state.sortKey);
    const query = normalizeQuery(state.query);
    const view = buildPlaylistViewItems(playlist, { query, sortKey });
    const total = view.length;
    const pageSize = 25;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    let page = Math.max(0, Math.min(Number(state.page || 0) || 0, totalPages - 1));
    let selectedItemId = String(state.selectedItemId || "");
    if (selectedItemId && !view.some(it => String(it?.id || "") === selectedItemId)) selectedItemId = "";
    if (!selectedItemId && view[0]?.id) selectedItemId = String(view[0].id);

    // Modal actions must not acknowledge the interaction first.
    if (action === "search") {
      const modalKey = await setPlaylistModalState({ action: "search", guildId: state.guildId, userId: interaction.user.id, uiKey });
      const modal = new ModalBuilder().setCustomId(`musicplmodal:${modalKey}`).setTitle("Search Playlist");
      const qInput = new TextInputBuilder()
        .setCustomId("query")
        .setLabel("Search (title or URL)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(60)
        .setValue(String(query || ""));
      modal.addComponents(new ActionRowBuilder().addComponents(qInput));
      await interaction.showModal(modal).catch(() => {});
      return true;
    }

    if (action === "replace") {
      const canManage = canManagePlaylist(interaction, playlist);
      if (!canManage) {
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "You don't have permission to edit this playlist.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      if (!selectedItemId) {
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Pick a track first.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const idx = playlist.items.findIndex(it => String(it?.id || "") === String(selectedItemId));
      if (idx < 0) {
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "That track no longer exists.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const modalKey = await setPlaylistModalState({
        action: "replace",
        guildId: state.guildId,
        userId: interaction.user.id,
        playlistId: playlist.id,
        itemId: selectedItemId,
        uiKey
      });
      const modal = new ModalBuilder().setCustomId(`musicplmodal:${modalKey}`).setTitle("Replace Track URL");
      const urlInput = new TextInputBuilder()
        .setCustomId("url")
        .setLabel("New URL (http/https)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(200);
      modal.addComponents(new ActionRowBuilder().addComponents(urlInput));
      await interaction.showModal(modal).catch(() => {});
      return true;
    }

    await interaction.deferUpdate().catch(() => {});

    if (action === "close") {
      await interaction.editReply({ embeds: [makeEmbed("Music Playlists", "Closed.", [], null, null, QUEUE_COLOR)], components: [] }).catch(() => {});
      return true;
    }

    if (action === "refresh") {
      const embed = buildPlaylistBrowserEmbed(cfg, state, playlist);
      const built = buildPlaylistBrowserComponentsV2(cfg, uiKey, state, interaction);
      await setCache(`mplui:${uiKey}`, { ...state, ...built.derived }, PLAYLIST_UI_TTL_SEC).catch(() => {});
      await interaction.editReply({ embeds: [embed], components: built.rows }).catch(() => {});
      return true;
    }

    if (action === "prev" || action === "next") {
      page = action === "prev" ? Math.max(0, page - 1) : Math.min(totalPages - 1, page + 1);
      const nextState = { ...state, page, sortKey, query, selectedItemId };
      const embed = buildPlaylistBrowserEmbed(cfg, nextState, playlist);
      const built = buildPlaylistBrowserComponentsV2(cfg, uiKey, nextState, interaction);
      await setCache(`mplui:${uiKey}`, { ...nextState, ...built.derived }, PLAYLIST_UI_TTL_SEC).catch(() => {});
      await interaction.editReply({ embeds: [embed], components: built.rows }).catch(() => {});
      return true;
    }

    if (action === "clear_search") {
      const nextState = { ...state, query: "", page: 0 };
      const embed = buildPlaylistBrowserEmbed(cfg, nextState, playlist);
      const built = buildPlaylistBrowserComponentsV2(cfg, uiKey, nextState, interaction);
      await setCache(`mplui:${uiKey}`, { ...nextState, ...built.derived }, PLAYLIST_UI_TTL_SEC).catch(() => {});
      await interaction.editReply({ embeds: [embed], components: built.rows }).catch(() => {});
      return true;
    }

    if (action === "open_queue") {
      const vcId = await resolveMemberVoiceId(interaction);
      if (!vcId) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music", "Join a voice channel to view its queue.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const sess = getSessionAgent(state.guildId, vcId);
      if (!sess.ok) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music", "Nothing playing in this voice channel.", [], null, null, QUEUE_COLOR)] }).catch(() => {});
        return true;
      }
      let config = null;
      try { config = await getMusicConfig(state.guildId); } catch {}
      try {
        const result = await sendAgentCommand(sess.agent, "queue", {
          guildId: state.guildId,
          voiceChannelId: vcId,
          textChannelId: interaction.channelId,
          ownerUserId: interaction.user.id,
          actorUserId: interaction.user.id,
          controlMode: config?.controlMode,
          searchProviders: config?.searchProviders,
          fallbackProviders: config?.fallbackProviders
        });
        const built = buildQueueEmbed(result, 0, QUEUE_PAGE_SIZE, null);
        await interaction.followUp({
          ephemeral: true,
          embeds: [built.embed],
          components: buildQueueComponents(vcId, built.page, built.totalPages)
        }).catch(() => {});
      } catch (err) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music Error", formatMusicError(err), [], null, null, 0xFF0000)] }).catch(() => {});
      }
      return true;
    }

    if (action === "more") {
      const canManage = canManagePlaylist(interaction, playlist);
      const sortNow = normalizeSortKey(state.sortKey);
      const moveEnabled = canManage && sortNow === "manual" && Boolean(selectedItemId);

      const embed = makeEmbed(
        "Playlist Actions",
        `**${playlist.name || playlist.id}**\nUse these tools to manage, share, and maintain your playlist.`,
        [
          { name: "Sort Tip", value: "Switch sort to **Manual** to enable moving tracks.", inline: false }
        ],
        null,
        null,
        QUEUE_COLOR
      );

      const base2 = `mplmore:${uiKey}:${interaction.user.id}`;
      const rowA = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${base2}:move`).setLabel("Move Track").setStyle(ButtonStyle.Secondary).setDisabled(!moveEnabled),
        new ButtonBuilder().setCustomId(`${base2}:bulk_remove`).setLabel("Bulk Remove").setStyle(ButtonStyle.Secondary).setDisabled(!canManage || total === 0),
        new ButtonBuilder().setCustomId(`${base2}:dedupe`).setLabel("Dedupe").setStyle(ButtonStyle.Secondary).setDisabled(!canManage || total === 0),
        new ButtonBuilder().setCustomId(`${base2}:invite`).setLabel("Invite Code").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${base2}:join`).setLabel("Join Code").setStyle(ButtonStyle.Secondary)
      );
      const rowB = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${base2}:new_personal`).setLabel("New Personal").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${base2}:queue_ui`).setLabel("Open Queue UI").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${base2}:close`).setLabel("Close").setStyle(ButtonStyle.Danger)
      );

      await interaction.followUp({ ephemeral: true, embeds: [embed], components: [rowA, rowB] }).catch(() => {});
      return true;
    }

    if (action === "queue") {
      if (!total) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "This playlist is empty.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }

      const it = view.find(v => String(v?.id || "") === String(selectedItemId || "")) ?? view[0];
      const vcId = await resolveMemberVoiceId(interaction);
      if (!vcId) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music", "Join a voice channel, then press Queue again.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }

      let config = null;
      try { config = await getMusicConfig(state.guildId); } catch {}
      const alloc = await ensureSessionAgent(state.guildId, vcId, {
        textChannelId: interaction.channelId,
        ownerUserId: interaction.user.id
      });
      if (!alloc.ok) {
        await interaction.followUp({
          ephemeral: true,
          embeds: [makeEmbed("Music Error", formatMusicError(alloc.reason), [], null, null, 0xFF0000)],
          components: (alloc.reason === "no-agents-in-guild" || alloc.reason === "no-free-agents")
            ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`mplbtn:${uiKey}:${ownerId}:deploy`).setLabel("Deploy Agents").setStyle(ButtonStyle.Secondary))]
            : []
        }).catch(() => {});
        return true;
      }

      try {
        const result = await playPlaylistItem(interaction, alloc.agent, state.guildId, vcId, it, config, interaction.channelId);
        const q = String(it?.url ?? "");
        const track = result?.track ?? { title: it?.title || "Playlist item", uri: /^https?:\/\//i.test(q) ? q : null };
        const action2 = String(result?.action ?? "queued");
        await interaction.followUp({ ephemeral: true, embeds: [buildTrackEmbed(action2, track)] }).catch(() => {});
      } catch (err) {
        if (String(err?.message ?? err) === "no-results") {
          await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music", "No results found for that query.", [], null, null, 0xFF0000)] }).catch(() => {});
          return true;
        }
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music Error", formatMusicError(err), [], null, null, 0xFF0000)] }).catch(() => {});
      }
      return true;
    }

    if (action === "remove") {
      const canManage = canManagePlaylist(interaction, playlist);
      if (!canManage) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "You don't have permission to edit this playlist.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      if (!selectedItemId) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Pick a track first.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const idx = playlist.items.findIndex(it => String(it?.id || "") === String(selectedItemId));
      if (idx < 0) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "That track no longer exists.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }

      const removed = playlist.items.splice(idx, 1)[0];
      playlist.updatedAt = Date.now();
      await saveGuildData(state.guildId, data).catch(() => {});
      await auditLog({ guildId: state.guildId, userId: interaction.user.id, action: "music.playlists.item_remove", details: { playlistId: playlist.id, itemId: selectedItemId } });
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Playlist Updated", `Removed **${playlistItemLabel(removed)}**.`, [], null, null, QUEUE_COLOR)] }).catch(() => {});
      void tryUpdatePlaylistPanelMessage(interaction.guild, data, playlist.id).catch(() => {});

      // Refresh browser UI.
      const nextState = { ...state, selectedItemId: "", page: 0 };
      const embed = buildPlaylistBrowserEmbed(cfg, nextState, playlist);
      const built = buildPlaylistBrowserComponentsV2(cfg, uiKey, nextState, interaction);
      await setCache(`mplui:${uiKey}`, { ...nextState, ...built.derived }, PLAYLIST_UI_TTL_SEC).catch(() => {});
      await interaction.editReply({ embeds: [embed], components: built.rows }).catch(() => {});
      return true;
    }

    if (action === "deploy") {
      const isAdmin = interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild);
      if (isAdmin) {
        await openAdvisorUiHandoff(interaction, { desiredTotal: 10 }).catch(() => {});
      } else {
        await interaction.reply({
          ephemeral: true,
          embeds: [makeEmbed(
            "No Music Agents Available",
            "⏳ No music agents are deployed in this server.\n\nAsk a server admin to run `/agents deploy` or use the agent advisor panel to get agents set up.",
            [], null, null, 0xFF0000
          )]
        }).catch(() => {});
      }
      return true;
    }

    await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Unknown action.", [], null, null, 0xFF0000)] }).catch(() => {});
    return true;
  }

  if (id.startsWith("musicui:playlist:")) {
    const voiceChannelId = id.split(":")[2] || null;
    await openPlaylistBrowser(interaction, { voiceChannelId });
    return true;
  }

  if (id.startsWith("musicpl:panel:")) {
    const parts = id.split(":");
    const ownerId = parts[2];
    const action = parts[3] || "";
    if (ownerId && interaction.user.id !== ownerId) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Playlist", "This panel belongs to another user.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    const perms = interaction.memberPermissions;
    if (!perms?.has?.(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Manage Server permission required.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    const guildId = interaction.guildId;
    if (!guildId) return true;

    if (action === "close") {
      await interaction.deferUpdate().catch(() => {});
      await interaction.editReply({ embeds: [makeEmbed("Music Playlists", "Closed.", [], null, null, QUEUE_COLOR)], components: [] }).catch(() => {});
      return true;
    }

    if (action === "refresh") {
      await interaction.deferUpdate().catch(() => {});
      const data = await loadGuildData(guildId);
      const cfg = normalizePlaylistsConfig(data);
      await interaction.editReply({
        embeds: [buildPlaylistPanelEmbed(cfg)],
        components: buildPlaylistPanelComponents(cfg, interaction.user.id)
      }).catch(() => {});
      return true;
    }

    if (action === "toggle_user_creation") {
      await interaction.deferUpdate().catch(() => {});
      const data = await loadGuildData(guildId);
      const cfg = normalizePlaylistsConfig(data);
      cfg.allowUserCreation = !cfg.allowUserCreation;
      await saveGuildData(guildId, data).catch(() => {});
      await auditLog({ guildId, userId: interaction.user.id, action: "music.playlists.toggle_user_creation", details: { allowUserCreation: cfg.allowUserCreation } });
      await interaction.editReply({
        embeds: [buildPlaylistPanelEmbed(cfg)],
        components: buildPlaylistPanelComponents(cfg, interaction.user.id)
      }).catch(() => {});
      return true;
    }

    if (action === "create") {
      const modalKey = await setPlaylistModalState({ action: "create", guildId, userId: interaction.user.id });
      const modal = new ModalBuilder()
        .setCustomId(`musicplmodal:${modalKey}`)
        .setTitle("Create Playlist");
      const nameInput = new TextInputBuilder()
        .setCustomId("name")
        .setLabel("Playlist name")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(40);
      modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
      await interaction.showModal(modal).catch(() => {});
      return true;
    }

    const selectedId = await getPlaylistPanelSelected(guildId, interaction.user.id);
    if (!selectedId) {
      await interaction.reply({
        ephemeral: true,
        embeds: [makeEmbed("Music Playlists", "Select a playlist from the dropdown first.", [], null, null, 0xFF0000)]
      }).catch(() => {});
      return true;
    }

    const data = await loadGuildData(guildId);
    const cfg = normalizePlaylistsConfig(data);
    const pl = cfg.playlists?.[selectedId] ?? null;
    if (!pl) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Selected playlist no longer exists.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    if (action === "collabs") {
      const collabs = Array.isArray(pl.collaborators) ? pl.collaborators : [];
      const embed = buildPlaylistDetailEmbed(pl);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`musicpl:collab:${interaction.user.id}:add:${pl.id}`).setLabel("Add").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`musicpl:collab:${interaction.user.id}:remove:${pl.id}`).setLabel("Remove").setStyle(ButtonStyle.Secondary).setDisabled(collabs.length === 0),
        new ButtonBuilder().setCustomId(`musicpl:collab:${interaction.user.id}:close:${pl.id}`).setLabel("Close").setStyle(ButtonStyle.Secondary)
      );
      await interaction.reply({ ephemeral: true, embeds: [embed], components: [row] }).catch(() => {});
      return true;
    }

    if (action === "perms") {
      const { read, write } = describePlaylistPerms(pl);
      const readMenu = new StringSelectMenuBuilder()
        .setCustomId(`musicplsel:perm_read:${interaction.user.id}:${pl.id}`)
        .setPlaceholder("Who can browse this playlist?")
        .addOptions(
          { label: "Server (default)", value: "guild", description: "Anyone in the server can browse" },
          { label: "Collaborators only", value: "collaborators", description: "Only owner/collabs/admins can browse" }
        );
      const writeMenu = new StringSelectMenuBuilder()
        .setCustomId(`musicplsel:perm_write:${interaction.user.id}:${pl.id}`)
        .setPlaceholder("Who can add/remove items?")
        .addOptions(
          { label: "Server (default)", value: "guild", description: "Anyone can add by dropping in the channel" },
          { label: "Collaborators", value: "collaborators", description: "Only owner/collabs/admins can add/remove" },
          { label: "Owner/Admin only", value: "owner", description: "Locked down edits" }
        );
      const embed = buildPlaylistDetailEmbed(pl);
      await interaction.reply({
        ephemeral: true,
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(readMenu), new ActionRowBuilder().addComponents(writeMenu)]
      }).catch(() => {});
      return true;
    }

    if (action === "panelmsg") {
      const channels = interaction.guild?.channels?.cache
        ? Array.from(interaction.guild.channels.cache.values())
            .filter(ch => ch && (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement))
            .slice(0, 25)
        : [];
      if (!channels.length) {
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Playlist Panel", "No text channels available.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const opts = channels.map(ch => ({ label: truncate(ch.name, 100), value: ch.id }));
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`musicplsel:panel_channel:${interaction.user.id}:${pl.id}`)
        .setPlaceholder("Choose where to post the playlist panel message")
        .addOptions(opts);
      const embed = makeEmbed("Playlist Panel Message", `Post a pinned playlist panel for **${pl.name || pl.id}**.\nUsers will be able to browse and queue tracks from it.`, [
        { name: "Tip", value: "Post it in your playlist drop channel for the best UX.", inline: false }
      ], null, null, QUEUE_COLOR);
      await interaction.reply({ ephemeral: true, embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] }).catch(() => {});
      return true;
    }

    if (action === "hub") {
      const channels = interaction.guild?.channels?.cache
        ? Array.from(interaction.guild.channels.cache.values())
            .filter(ch => ch && (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement))
            .slice(0, 25)
        : [];
      if (!channels.length) {
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Playlist Hub", "No text channels available.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const opts = channels.map(ch => ({ label: truncate(ch.name, 100), value: ch.id }));
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`musicplsel:hub_channel:${interaction.user.id}`)
        .setPlaceholder("Choose where to post the Playlist Hub message")
        .addOptions(opts);
      const embed = makeEmbed("Playlist Hub", "Post a single hub message where users can create personal drop threads and browse playlists.\nThis prevents chat clutter from setup commands.", [], null, null, QUEUE_COLOR);
      await interaction.reply({ ephemeral: true, embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] }).catch(() => {});
      return true;
    }

    if (action === "rename") {
      const modalKey = await setPlaylistModalState({ action: "rename", guildId, userId: interaction.user.id, playlistId: pl.id });
      const modal = new ModalBuilder()
        .setCustomId(`musicplmodal:${modalKey}`)
        .setTitle("Rename Playlist");
      const nameInput = new TextInputBuilder()
        .setCustomId("name")
        .setLabel("New playlist name")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(40)
        .setValue(String(pl.name || ""));
      modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
      await interaction.showModal(modal).catch(() => {});
      return true;
    }

    if (action === "bind") {
      // Offer channel choices in an ephemeral picker.
      const guild = interaction.guild;
      if (!guild) return true;
      const member = interaction.member;
      const channels = Array.from(guild.channels.cache.values())
        .filter(ch => ch && (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement))
        .filter(ch => {
          const perms2 = ch.permissionsFor?.(member);
          return perms2?.has?.(PermissionsBitField.Flags.ViewChannel) && perms2?.has?.(PermissionsBitField.Flags.SendMessages);
        })
        .slice(0, 25);
      if (!channels.length) {
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "No text channels available to bind.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const opts = channels.map(ch => ({ label: truncate(ch.name, 100), value: ch.id }));
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`musicplsel:bind_channel:${interaction.user.id}:${pl.id}`)
        .setPlaceholder("Choose a text channel to bind as the drop channel")
        .addOptions(opts);
      await interaction.reply({
        ephemeral: true,
        embeds: [makeEmbed("Bind Playlist Channel", `Bind **${pl.name || pl.id}** to a drop channel.\nDropping audio files or links in that channel will add items to the playlist.`, [
          { name: "Note", value: "We will also enable Audio Drops (play panel) in the bound channel.", inline: false }
        ], null, null, QUEUE_COLOR)],
        components: [new ActionRowBuilder().addComponents(menu)]
      }).catch(() => {});
      return true;
    }

    if (action === "clear" || action === "delete") {
      const confirmId = `musicpl:confirm:${interaction.user.id}:${action}:${pl.id}`;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(confirmId).setLabel(`Confirm ${action === "clear" ? "Clear" : "Delete"}`).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`musicpl:confirm:${interaction.user.id}:cancel:${pl.id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      );
      await interaction.reply({
        ephemeral: true,
        embeds: [makeEmbed("Confirm", `${action === "clear" ? "Clear all items" : "Delete this playlist"}: **${pl.name || pl.id}**`, [], null, null, 0xFF0000)],
        components: [row]
      }).catch(() => {});
      return true;
    }

    await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Unknown action.", [], null, null, 0xFF0000)] }).catch(() => {});
    return true;
  }

  if (id.startsWith("musicpl:confirm:")) {
    const parts = id.split(":");
    const ownerId = parts[2];
    const action = parts[3] || "";
    const playlistId = parts[4] || "";
    if (ownerId && interaction.user.id !== ownerId) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Playlist", "This panel belongs to another user.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    const guildId = interaction.guildId;
    if (!guildId) return true;
    const perms = interaction.memberPermissions;
    if (!perms?.has?.(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Playlist", "Manage Server permission required.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    if (action === "cancel") {
      await interaction.deferUpdate().catch(() => {});
      await interaction.editReply({ embeds: [makeEmbed("Cancelled", "No changes made.", [], null, null, QUEUE_COLOR)], components: [] }).catch(() => {});
      return true;
    }

    const data = await loadGuildData(guildId);
    const cfg = normalizePlaylistsConfig(data);
    const pl = cfg.playlists?.[playlistId] ?? null;
    if (!pl) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Playlist not found.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    if (action === "clear") {
      pl.items = [];
      pl.updatedAt = Date.now();
      await saveGuildData(guildId, data).catch(() => {});
      void tryUpdatePlaylistPanelMessage(interaction.guild, data, pl.id).catch(() => {});
      await interaction.deferUpdate().catch(() => {});
      await interaction.editReply({ embeds: [makeEmbed("Playlist Cleared", `Cleared items for **${pl.name || pl.id}**.`, [], null, null, QUEUE_COLOR)], components: [] }).catch(() => {});
      return true;
    }

    if (action === "delete") {
      // Disable panel message first (best-effort).
      void tryDisablePlaylistPanelMessage(interaction.guild, pl).catch(() => {});
      // Remove bindings to this playlist.
      for (const [chId, pid] of Object.entries(cfg.channelBindings || {})) {
        if (pid === playlistId) delete cfg.channelBindings[chId];
      }
      delete cfg.playlists[playlistId];
      await saveGuildData(guildId, data).catch(() => {});
      await interaction.deferUpdate().catch(() => {});
      await interaction.editReply({ embeds: [makeEmbed("Playlist Deleted", "Deleted.", [], null, null, QUEUE_COLOR)], components: [] }).catch(() => {});
      return true;
    }
    return true;
  }

  if (id.startsWith("musicpl:collab:")) {
    const parts = id.split(":");
    const ownerId = parts[2];
    const op = parts[3] || "";
    const playlistId = parts[4] || "";
    if (ownerId && interaction.user.id !== ownerId) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Playlist", "This panel belongs to another user.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    const guildId = interaction.guildId;
    if (!guildId) return true;
    const data = await loadGuildData(guildId);
    const cfg = normalizePlaylistsConfig(data);
    const pl = cfg.playlists?.[playlistId] ?? null;
    if (!pl) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Collaborators", "Playlist not found.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    if (!canManagePlaylist(interaction, pl)) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Collaborators", "You don't have permission to edit collaborators.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    if (op === "close") {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Collaborators", "Closed.", [], null, null, QUEUE_COLOR)] }).catch(() => {});
      return true;
    }

    if (op === "add") {
      const menu = new UserSelectMenuBuilder()
        .setCustomId(`musicpluser:add:${interaction.user.id}:${playlistId}`)
        .setPlaceholder("Select users to add as collaborators")
        .setMinValues(1)
        .setMaxValues(5);
      await interaction.reply({
        ephemeral: true,
        embeds: [makeEmbed("Collaborators", `Add collaborators to **${pl.name || pl.id}**.`, [], null, null, QUEUE_COLOR)],
        components: [new ActionRowBuilder().addComponents(menu)]
      }).catch(() => {});
      return true;
    }

    if (op === "remove") {
      const collabs = Array.isArray(pl.collaborators) ? pl.collaborators : [];
      if (!collabs.length) {
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Collaborators", "No collaborators to remove.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const opts = collabs.slice(0, 25).map(uid => ({ label: truncate(uid, 100), value: uid }));
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`musicplsel:collab_rm:${interaction.user.id}:${playlistId}`)
        .setPlaceholder("Select a collaborator to remove")
        .addOptions(opts);
      await interaction.reply({
        ephemeral: true,
        embeds: [makeEmbed("Collaborators", `Remove a collaborator from **${pl.name || pl.id}**.`, [], null, null, QUEUE_COLOR)],
        components: [new ActionRowBuilder().addComponents(menu)]
      }).catch(() => {});
      return true;
    }
  }

  if (id.startsWith("audiodrop:")) {
    const parts = id.split(":");
    const key = parts[1];
    const uploaderId = parts[2];
    const action = parts[3] || "";

    const state = await getAudioDropCache(key);
    if (!state) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "This drop panel expired. Upload the file again.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    // Common permission: allow anyone to play into their own VC; restrict arbitrary-VC actions.
    const isUploader = interaction.user.id === uploaderId;
    const canAdmin = interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild);
    const canArbitrary = isUploader || canAdmin;

    if (action === "dismiss") {
      if (!canArbitrary) {
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "Only the uploader or an admin can dismiss this panel.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      await interaction.deferUpdate().catch(() => {});
      const embed = makeEmbed("Audio Drop", "Panel dismissed.", [], null, null, QUEUE_COLOR);
      await interaction.message?.edit?.({ embeds: [embed], components: [] }).catch(() => {});
      return true;
    }

    if (action === "deploy_ui") {
      // Advisor UI is the lowest-typing path to get music agents available.
      await openAdvisorUiHandoff(interaction, { desiredTotal: 10 }).catch(() => {});
      return true;
    }

    if (action === "choose_file") {
      const attachments = Array.isArray(state.attachments) ? state.attachments : [];
      if (!attachments.length) {
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "No files found for this panel.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const options = attachments.slice(0, 25).map((a, idx) => ({
        label: truncate(a?.name || `Attachment ${idx + 1}`, 100),
        value: String(idx),
        description: truncate(humanBytes(a?.size || 0), 100)
      }));
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`audiodropfile:${key}:${uploaderId}`)
        .setPlaceholder("Pick which file to play")
        .addOptions(options);
      const row = new ActionRowBuilder().addComponents(menu);
      await interaction.reply({
        ephemeral: true,
        embeds: [makeEmbed("Audio Drop", "Choose which uploaded file you want to play.", [
          { name: "Tip", value: "Your selection is saved for this panel for ~15 minutes.", inline: false }
        ], null, null, QUEUE_COLOR)],
        components: [row]
      }).catch(() => {});
      return true;
    }

    if (action === "add_to_playlist") {
      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "Server context required.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const data = await loadGuildData(guildId);
      const cfg = normalizePlaylistsConfig(data);
      const playlists = Object.values(cfg.playlists || {}).slice(0, 25);
      if (!playlists.length) {
        await interaction.reply({
          ephemeral: true,
          embeds: [makeEmbed("Audio Drop", "No playlists exist yet.\nAdmins: use `/music playlist panel` to create one.", [], null, null, QUEUE_COLOR)]
        }).catch(() => {});
        return true;
      }
      const opts = playlists.map(pl => ({
        label: truncate(pl.name || pl.id, 100),
        value: pl.id,
        description: truncate(pl.channelId ? `Drop: #${pl.channelId}` : "No drop channel", 100)
      }));
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`audiodroppl:${key}:${uploaderId}:${interaction.user.id}`)
        .setPlaceholder("Choose a playlist to add this file to")
        .addOptions(opts);
      await interaction.reply({
        ephemeral: true,
        embeds: [makeEmbed("Audio Drop", "Pick a playlist to save this file into.", [], null, null, QUEUE_COLOR)],
        components: [new ActionRowBuilder().addComponents(menu)]
      }).catch(() => {});
      return true;
    }

    if (action === "pick_vc") {
      if (!canArbitrary) {
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "Only the uploader or an admin can pick an arbitrary voice channel.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const guild = interaction.guild;
      if (!guild) {
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "This action requires a server context.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const all = Array.from(guild.channels.cache.values());
      const member = interaction.member;
      const vcOptions = [];
      for (const ch of all) {
        if (vcOptions.length >= 25) break;
        if (!ch || (ch.type !== ChannelType.GuildVoice && ch.type !== ChannelType.GuildStageVoice)) continue;
        const perms = ch.permissionsFor?.(member);
        if (!perms?.has?.(PermissionsBitField.Flags.ViewChannel)) continue;
        if (!perms?.has?.(PermissionsBitField.Flags.Connect)) continue;
        vcOptions.push({ label: truncate(ch.name, 100), value: ch.id });
      }
      if (!vcOptions.length) {
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "No voice channels available.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`audiodropvc:${key}:${uploaderId}`)
        .setPlaceholder("Choose a voice channel")
        .addOptions(vcOptions);
      const row = new ActionRowBuilder().addComponents(menu);
      await interaction.reply({
        ephemeral: true,
        embeds: [makeEmbed("Audio Drop", "Choose where to play this file.", [], null, null, QUEUE_COLOR)],
        components: [row]
      }).catch(() => {});
      return true;
    }

    if (action === "play_my_vc") {
      const memberVcId = await resolveMemberVoiceId(interaction);
      if (!memberVcId) {
        await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "Join a voice channel first, then press Play.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      await playAudioDropToVc(interaction, key, uploaderId, memberVcId);
      return true;
    }

    await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "Unknown action.", [], null, null, 0xFF0000)] }).catch(() => {});
    return true;
  }

  if (!id.startsWith("musicq:")) return false;

  // Anti-spam: Check if already processing this interaction
  if (buttonProcessing.has(interaction.id)) {
    return true; // Silently ignore duplicate
  }
  buttonProcessing.set(interaction.id, Date.now());

  const parts = id.split(":");
  const voiceChannelId = parts[1];
  const page = Math.max(0, Number.parseInt(parts[2] || "0", 10) || 0);
  const action = parts[3] || "refresh";

  // Check user cooldown for this button type
  const cooldownKey = `${interaction.user.id}:${action}`;
  const lastPressed = userButtonCooldowns.get(cooldownKey);
  if (lastPressed && (Date.now() - lastPressed) < BUTTON_COOLDOWN_MS) {
    // Too soon, silently ignore
    buttonProcessing.delete(interaction.id);
    return true;
  }
  userButtonCooldowns.set(cooldownKey, Date.now());

  const memberVcId = await resolveMemberVoiceId(interaction);
  if (!memberVcId || memberVcId !== voiceChannelId) {
    buttonProcessing.delete(interaction.id);
    await interaction.reply({
      content: "Join the same voice channel to control this queue.",
      ephemeral: true
    }).catch(err => {
      handleInteractionError(err, {
        operation: 'music_button_vc_check',
        guildId: interaction.guildId
      });
    });
    return true;
  }

  await interaction.deferUpdate().catch(err => {
    buttonProcessing.delete(interaction.id);
    handleInteractionError(err, {
      operation: 'music_button_defer',
      guildId: interaction.guildId
    });
  });

  const guildId = interaction.guildId;
  if (!guildId || !voiceChannelId) return true;

  const sess = getSessionAgent(guildId, voiceChannelId);
  if (!sess.ok) {
    await interaction.editReply({
      embeds: [makeEmbed("Music", formatMusicError(sess.reason), [], null, null, 0xFF0000)],
      components: []
    }).catch(err => {
      handleInteractionError(err, {
        operation: 'music_button_error_reply',
        guildId: interaction.guildId
      });
    });
    return true;
  }

  let actionNote = null;
  let nextPage = page;

  if (action === "prev") nextPage = Math.max(0, page - 1);
  if (action === "next") nextPage = page + 1;

  let config = null;
  try {
    config = await getMusicConfig(guildId);
  } catch {}

  if (!["prev", "next", "refresh", "now"].includes(action)) {
    const opMap = { pause: "pause", resume: "resume", skip: "skip", stop: "stop" };
    const op = opMap[action];
    if (op) {
      try {
        const res = await sendAgentCommand(sess.agent, op, {
          guildId,
          voiceChannelId,
          textChannelId: interaction.channelId,
          ownerUserId: interaction.user.id,
          actorUserId: interaction.user.id,
          controlMode: config?.controlMode,
          searchProviders: config?.searchProviders,
          fallbackProviders: config?.fallbackProviders
        });
        actionNote = actionLabel(action, res?.action);
      } catch (err) {
        if (String(err?.message ?? err) === "no-session") releaseSession(guildId, voiceChannelId);
        actionNote = formatMusicError(err);
      }
    }
  }

  if (action === "now") nextPage = 0;

  try {
    const result = await sendAgentCommand(sess.agent, "queue", {
      guildId,
      voiceChannelId,
      textChannelId: interaction.channelId,
      ownerUserId: interaction.user.id,
      actorUserId: interaction.user.id,
      controlMode: config?.controlMode,
      searchProviders: config?.searchProviders,
      fallbackProviders: config?.fallbackProviders
    });
    const built = buildQueueEmbed(result, nextPage, QUEUE_PAGE_SIZE, actionNote);
    await interaction.editReply({
      embeds: [built.embed],
      components: buildQueueComponents(voiceChannelId, built.page, built.totalPages)
    }).catch(() => {});
  } catch (err) {
    if (String(err?.message ?? err) === "no-session") releaseSession(guildId, voiceChannelId);
    await interaction.editReply({
      embeds: [makeEmbed("Music Error", formatMusicError(err), [], null, null, 0xFF0000)],
      components: []
    }).catch(() => {});
  }

  // Clean up processing tracker
  buttonProcessing.delete(interaction.id);
  
  return true;
}

export async function handleSelect(interaction) {
  if (!interaction.isStringSelectMenu?.() && !interaction.isUserSelectMenu?.()) return false;
  const id = String(interaction.customId || "");

  if (id.startsWith("mplbulk:pick:")) {
    await interaction.deferUpdate().catch(() => {});
    const parts = id.split(":");
    const uiKey = parts[2];
    const ownerId = parts[3];
    if (ownerId && interaction.user.id !== ownerId) return true;
    const ids = Array.isArray(interaction.values) ? interaction.values.map(String).filter(Boolean).slice(0, 25) : [];
    if (!ids.length) return true;
    await setCache(`mplbulk:${uiKey}:${interaction.user.id}`, { ids, createdAt: Date.now() }, 10 * 60).catch(() => {});
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`mplbulk:confirm:${uiKey}:${interaction.user.id}`).setLabel(`Confirm Remove (${ids.length})`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`mplbulk:cancel:${uiKey}:${interaction.user.id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    );
    await interaction.followUp({
      ephemeral: true,
      embeds: [makeEmbed("Bulk Remove", `Selected **${ids.length}** item(s). Confirm to remove them from the playlist.`, [], null, null, 0xFF0000)],
      components: [row]
    }).catch(() => {});
    return true;
  }

  if (interaction.isUserSelectMenu?.() && id.startsWith("musicpluser:")) {
    await interaction.deferUpdate().catch(() => {});
    const parts = id.split(":");
    const op = parts[1]; // add
    const ownerId = parts[2];
    const playlistId = parts[3];
    if (ownerId && interaction.user.id !== ownerId) return true;
    const guildId = interaction.guildId;
    if (!guildId) return true;

    const data = await loadGuildData(guildId);
    const cfg = normalizePlaylistsConfig(data);
    const pl = cfg.playlists?.[playlistId] ?? null;
    if (!pl) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Collaborators", "Playlist not found.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    if (!canManagePlaylist(interaction, pl)) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Collaborators", "You don't have permission to edit collaborators.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    const selected = Array.isArray(interaction.values) ? interaction.values.map(String) : [];
    const toAdd = selected.filter(Boolean).slice(0, 10);
    if (!toAdd.length) return true;
    pl.collaborators = Array.from(new Set([...(pl.collaborators || []).map(String), ...toAdd]));
    pl.updatedAt = Date.now();
    await saveGuildData(guildId, data).catch(() => {});
    await auditLog({ guildId, userId: interaction.user.id, action: "music.playlists.collab_add", details: { playlistId, added: toAdd } });
    await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Collaborators", "Added.", [
      { name: "Added", value: toAdd.map(id2 => `<@${id2}>`).join(", "), inline: false }
    ], null, null, QUEUE_COLOR)] }).catch(() => {});
    void tryUpdatePlaylistPanelMessage(interaction.guild, data, playlistId).catch(() => {});
    return true;
  }
  if (id.startsWith("audiodroppl:")) {
    await interaction.deferUpdate().catch(() => {});
    const parts = id.split(":");
    const dropKey = parts[1];
    const uploaderId = parts[2];
    const clickerId = parts[3];
    if (clickerId && interaction.user.id !== clickerId) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "Not for you.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "Server context required.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    const state = await getAudioDropCache(dropKey);
    if (!state) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "This drop panel expired. Upload the file again.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    const data = await loadGuildData(guildId);
    const cfg = normalizePlaylistsConfig(data);
    const playlistId = String(interaction.values?.[0] ?? "");
    const pl = cfg.playlists?.[playlistId] ?? null;
    if (!pl) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "Playlist not found.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    if (!canWritePlaylist(interaction, pl)) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "You don't have permission to add to this playlist.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    // Add the currently-selected attachment for this user.
    const attachments = Array.isArray(state.attachments) ? state.attachments : [];
    if (!attachments.length) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "No files found for this panel.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    const selIdxRaw = await getAudioDropSelection(dropKey, interaction.user.id);
    const selIdx = Math.max(0, Math.min(attachments.length - 1, selIdxRaw));
    const att = attachments[selIdx];
    const url = String(att?.url ?? "");
    if (!/^https?:\/\//i.test(url)) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "That file URL is invalid.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    pl.items ??= [];
    const seen = new Set(pl.items.map(it => String(it?.url ?? "")));
    if (!seen.has(url)) {
      pl.items.unshift({
        id: `mpli_${randomKey()}`,
        type: "attachment",
        title: String(att?.name ?? "Audio file"),
        url,
        size: Number(att?.size ?? 0),
        contentType: String(att?.contentType ?? ""),
        addedBy: interaction.user.id,
        addedAt: Date.now(),
        sourceMessageId: state.messageId
      });
      const cfg2 = normalizePlaylistsConfig(data);
      pl.items = pl.items.slice(0, cfg2.maxItemsPerPlaylist);
      pl.updatedAt = Date.now();
      await saveGuildData(guildId, data).catch(() => {});
      void tryUpdatePlaylistPanelMessage(interaction.guild, data, pl.id).catch(() => {});
    }

    await interaction.followUp({
      ephemeral: true,
      embeds: [makeEmbed("Playlist", `Saved to **${pl.name || pl.id}**.`, [
        { name: "Item", value: att?.name ? `**${att.name}**` : "Audio file", inline: false }
      ], null, null, QUEUE_COLOR)]
    }).catch(() => {});
    return true;
  }

  if (id.startsWith("mplsel:")) {
    await interaction.deferUpdate().catch(() => {});
    const parts = id.split(":");
    const kind = parts[1]; // pl | tr
    const uiKey = parts[2];
    const ownerId = parts[3];
    if (ownerId && interaction.user.id !== ownerId) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Not for you.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    const state = await getPlaylistUiCache(uiKey);
    if (!state) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "This playlist panel expired. Re-open it.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    if (String(state.userId) !== interaction.user.id) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Not for you.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    const data = await loadGuildData(state.guildId);
    const cfg = normalizePlaylistsConfig(data);
    let next = {
      ...state,
      selectedPlaylistId: String(state.selectedPlaylistId || ""),
      selectedItemId: String(state.selectedItemId || ""),
      sortKey: normalizeSortKey(state.sortKey),
      query: normalizeQuery(state.query),
      page: Math.max(0, Math.trunc(Number(state.page) || 0))
    };

    if (kind === "pl") {
      const picked = String(interaction.values?.[0] ?? "");
      if (picked === "none") return true;
      next.selectedPlaylistId = picked;
      next.selectedItemId = "";
      next.page = 0;
    } else if (kind === "sort") {
      next.sortKey = normalizeSortKey(String(interaction.values?.[0] ?? "newest"));
      next.page = 0;
      next.selectedItemId = "";
    } else if (kind === "item") {
      next.selectedItemId = String(interaction.values?.[0] ?? "");
    } else if (kind === "tr") {
      // Back-compat: old menu used index values
      const idx = Math.max(0, Math.trunc(Number(interaction.values?.[0] ?? 0)));
      const playlistTmp = cfg.playlists?.[next.selectedPlaylistId] ?? Object.values(cfg.playlists || {})[0] ?? null;
      const view = buildPlaylistViewItems(playlistTmp, { query: next.query, sortKey: next.sortKey });
      if (view[idx]?.id) next.selectedItemId = String(view[idx].id);
    }

    const playlist = cfg.playlists?.[next.selectedPlaylistId] ?? Object.values(cfg.playlists || {})[0] ?? null;
    if (!playlist) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Playlist not found.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    if (!canReadPlaylist(interaction, playlist)) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "This playlist is private.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    const embed = buildPlaylistBrowserEmbed(cfg, next, playlist);
    const built = buildPlaylistBrowserComponentsV2(cfg, uiKey, next, interaction);
    await setCache(`mplui:${uiKey}`, { ...next, ...built.derived }, PLAYLIST_UI_TTL_SEC).catch(() => {});
    await interaction.editReply({ embeds: [embed], components: built.rows }).catch(() => {});
    return true;
  }

  if (id.startsWith("musicplsel:")) {
    await interaction.deferUpdate().catch(() => {});
    const parts = id.split(":");
    const kind = parts[1]; // panel_pl | bind_channel
    const ownerId = parts[2];
    if (ownerId && interaction.user.id !== ownerId) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Playlist", "This panel belongs to another user.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    const guildId = interaction.guildId;
    if (!guildId) return true;

    if (kind === "panel_pl") {
      const playlistId = String(interaction.values?.[0] ?? "");
      await setPlaylistPanelSelected(guildId, interaction.user.id, playlistId).catch(() => {});
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Selected playlist updated.", [], null, null, QUEUE_COLOR)] }).catch(() => {});
      return true;
    }

    if (kind === "collab_rm") {
      const playlistId = parts[3] || "";
      const targetUserId = String(interaction.values?.[0] ?? "");
      const data = await loadGuildData(guildId);
      const cfg = normalizePlaylistsConfig(data);
      const pl = cfg.playlists?.[playlistId] ?? null;
      if (!pl) return true;
      if (!canManagePlaylist(interaction, pl)) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Collaborators", "You don't have permission to edit collaborators.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      pl.collaborators = (pl.collaborators || []).filter(id2 => String(id2) !== targetUserId);
      pl.updatedAt = Date.now();
      await saveGuildData(guildId, data).catch(() => {});
      await auditLog({ guildId, userId: interaction.user.id, action: "music.playlists.collab_remove", details: { playlistId, removed: targetUserId } });
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Collaborators", "Removed.", [], null, null, QUEUE_COLOR)] }).catch(() => {});
      void tryUpdatePlaylistPanelMessage(interaction.guild, data, playlistId).catch(() => {});
      return true;
    }

    if (kind === "perm_read" || kind === "perm_write") {
      const playlistId = parts[3] || "";
      const value = String(interaction.values?.[0] ?? "");
      const data = await loadGuildData(guildId);
      const cfg = normalizePlaylistsConfig(data);
      const pl = cfg.playlists?.[playlistId] ?? null;
      if (!pl) return true;
      if (!canManagePlaylist(interaction, pl)) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Permissions", "You don't have permission to edit permissions.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      pl.perms ??= {};
      if (kind === "perm_read") pl.perms.read = value === "collaborators" ? "collaborators" : "guild";
      if (kind === "perm_write") pl.perms.write = value === "owner" ? "owner" : (value === "collaborators" ? "collaborators" : "guild");
      pl.updatedAt = Date.now();
      await saveGuildData(guildId, data).catch(() => {});
      await auditLog({ guildId, userId: interaction.user.id, action: "music.playlists.perms_update", details: { playlistId, kind, value } });
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Permissions", "Updated.", [], null, null, QUEUE_COLOR)] }).catch(() => {});
      void tryUpdatePlaylistPanelMessage(interaction.guild, data, playlistId).catch(() => {});
      return true;
    }

    if (kind === "panel_channel") {
      const playlistId = parts[3] || "";
      const channelId = String(interaction.values?.[0] ?? "");
      const data = await loadGuildData(guildId);
      const cfg = normalizePlaylistsConfig(data);
      const pl = cfg.playlists?.[playlistId] ?? null;
      if (!pl) return true;
      if (!canManagePlaylist(interaction, pl)) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Playlist Panel", "You don't have permission to set panel messages.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const guild = interaction.guild;
      const ch = guild?.channels?.cache?.get(channelId) ?? null;
      if (!ch?.isTextBased?.()) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Playlist Panel", "Invalid channel.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      const embed = buildPlaylistPanelMessageEmbed(pl);
      const msg = await ch.send({ embeds: [embed], components: buildPlaylistPanelMessageComponents(pl.id) }).catch(() => null);
      if (!msg) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Playlist Panel", "Failed to post panel message. Check bot permissions.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }
      // Pin if possible
      await msg.pin().catch(() => {});
      pl.panel = { channelId, messageId: msg.id };
      pl.updatedAt = Date.now();
      await saveGuildData(guildId, data).catch(() => {});
      await auditLog({ guildId, userId: interaction.user.id, action: "music.playlists.panel_set", details: { playlistId, channelId, messageId: msg.id } });
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Playlist Panel", `Panel posted in <#${channelId}>.`, [], null, null, QUEUE_COLOR)] }).catch(() => {});
      return true;
    }

    if (kind === "hub_channel") {
      const channelId = String(interaction.values?.[0] ?? "");
      const data = await loadGuildData(guildId);
      const cfg = normalizePlaylistsConfig(data);
      const guild = interaction.guild;
      const ch = guild?.channels?.cache?.get(channelId) ?? null;
      if (!ch?.isTextBased?.()) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Playlist Hub", "Invalid channel.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }

      const embed = buildPlaylistHubEmbed(cfg);
      // Update existing hub if present.
      let msg = null;
      if (cfg.hub?.channelId && cfg.hub?.messageId) {
        const prevCh = guild.channels.cache.get(cfg.hub.channelId);
        if (prevCh?.isTextBased?.()) {
          const prevMsg = await prevCh.messages.fetch(cfg.hub.messageId).catch(() => null);
          if (prevMsg) {
            await prevMsg.edit({ embeds: [embed], components: buildPlaylistHubComponents() }).catch(() => {});
            msg = prevMsg;
          }
        }
      }

      if (!msg) {
        msg = await ch.send({ embeds: [embed], components: buildPlaylistHubComponents() }).catch(() => null);
      }

      if (!msg) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Playlist Hub", "Failed to post hub message. Check bot permissions.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }

      cfg.hub = { channelId: ch.id, messageId: msg.id };
      await saveGuildData(guildId, data).catch(() => {});
      await auditLog({ guildId, userId: interaction.user.id, action: "music.playlists.hub_set", details: { channelId: ch.id, messageId: msg.id } });
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Playlist Hub", `Hub posted in <#${ch.id}>.`, [], null, null, QUEUE_COLOR)] }).catch(() => {});
      return true;
    }

    if (kind === "bind_channel") {
      const playlistId = parts[3] || "";
      const channelId = String(interaction.values?.[0] ?? "");
      if (!playlistId || !channelId) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Choose a channel.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }

      const data = await loadGuildData(guildId);
      const cfg = normalizePlaylistsConfig(data);
      const pl = cfg.playlists?.[playlistId] ?? null;
      if (!pl) {
        await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Playlist not found.", [], null, null, 0xFF0000)] }).catch(() => {});
        return true;
      }

      const existingBinding = cfg.channelBindings?.[channelId];
      if (existingBinding && existingBinding !== playlistId) {
        await interaction.followUp({
          ephemeral: true,
          embeds: [makeEmbed("Music Playlists", "That channel is already bound to a different playlist.\nUnbind it first (delete/retarget the other playlist).", [], null, null, 0xFF0000)]
        }).catch(() => {});
        return true;
      }

      // Enforce a conservative cap on number of bound playlist channels.
      const boundChannels = Object.keys(cfg.channelBindings || {});
      const alreadyBoundHere = boundChannels.includes(channelId);
      if (!alreadyBoundHere && boundChannels.length >= MUSIC_PLAYLIST_MAX_CHANNELS) {
        await interaction.followUp({
          ephemeral: true,
          embeds: [makeEmbed("Music Playlists", `Playlist channel limit reached (${MUSIC_PLAYLIST_MAX_CHANNELS}).`, [], null, null, 0xFF0000)]
        }).catch(() => {});
        return true;
      }

      // Remove old binding for this playlist (move binding).
      for (const [chId, pid] of Object.entries(cfg.channelBindings || {})) {
        if (pid === playlistId && chId !== channelId) delete cfg.channelBindings[chId];
      }
      cfg.channelBindings[channelId] = playlistId;
      pl.channelId = channelId;
      pl.updatedAt = Date.now();

      // Also enable Audio Drops in this channel so users get the play panel.
      data.music ??= {};
      data.music.drops ??= { channelIds: [] };
      if (!Array.isArray(data.music.drops.channelIds)) data.music.drops.channelIds = [];
      if (!data.music.drops.channelIds.includes(channelId)) data.music.drops.channelIds.push(channelId);

      await saveGuildData(guildId, data).catch(() => {});
      await auditLog({ guildId, userId: interaction.user.id, action: "music.playlists.bind_channel", details: { playlistId, channelId } });

      await interaction.followUp({
        ephemeral: true,
        embeds: [makeEmbed("Playlist Channel Bound", `**${pl.name || pl.id}** is now bound to <#${channelId}>.\nDrop audio files or links in that channel to build the playlist.`, [], null, null, QUEUE_COLOR)]
      }).catch(() => {});
      return true;
    }
  }

  if (id.startsWith("audiodropfile:")) {
    await interaction.deferUpdate().catch(() => {});
    const parts = id.split(":");
    const key = parts[1];
    const uploaderId = parts[2];

    const state = await getAudioDropCache(key);
    if (!state) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "This drop panel expired. Upload the file again.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    const idx = Math.max(0, Math.trunc(Number(interaction.values?.[0] ?? 0)));
    const attachments = Array.isArray(state.attachments) ? state.attachments : [];
    const selected = attachments[idx];
    if (!selected) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "Invalid selection.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    await setAudioDropSelection(key, interaction.user.id, idx).catch(() => {});
    const label = selected.name ? `**${selected.name}**` : `Attachment ${idx + 1}`;
    await interaction.followUp({
      ephemeral: true,
      embeds: [makeEmbed("Audio Drop", `Selected ${label}.\nUse **Play In My VC** on the panel to start playback.`, [
        { name: "Size", value: humanBytes(selected.size), inline: true }
      ], null, null, QUEUE_COLOR)]
    }).catch(() => {});
    return true;
  }

  if (id.startsWith("audiodropvc:")) {
    await interaction.deferUpdate().catch(() => {});
    const parts = id.split(":");
    const key = parts[1];
    const uploaderId = parts[2];

    const state = await getAudioDropCache(key);
    if (!state) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "This drop panel expired. Upload the file again.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    const isUploader = interaction.user.id === uploaderId;
    const canAdmin = interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild);
    if (!isUploader && !canAdmin) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "Only the uploader or an admin can pick an arbitrary voice channel.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    const vcId = String(interaction.values?.[0] ?? "");
    if (!vcId) {
      await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "Choose a voice channel.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }

    await interaction.followUp({ ephemeral: true, embeds: [makeEmbed("Audio Drop", "Starting playback...", [], null, null, QUEUE_COLOR)] }).catch(() => {});
    // Use followUp context: run playback and then send a final result embed.
    await playAudioDropToVc(interaction, key, uploaderId, vcId, { preferFollowUp: true });
    return true;
  }

  if (!id.startsWith("musicsearch:")) return false;

  // Defer immediately to prevent interaction timeout
  await interaction.deferUpdate().catch(() => {});

  const key = id.split(":")[1];
  const entry = await getSearchCache(key);
  if (!entry) {
    await interaction.followUp({ content: "Search selection expired. Run /music play again.", ephemeral: true }).catch(() => {});
    return true;
  }

  if (entry.userId !== interaction.user.id) {
    await interaction.followUp({ content: "Not for you.", ephemeral: true }).catch(() => {});
    return true;
  }

  const memberVcId = await resolveMemberVoiceId(interaction);
  if (!memberVcId || memberVcId !== entry.voiceChannelId) {
    await interaction.followUp({ content: "Join the same voice channel to select this result.", ephemeral: true }).catch(() => {});
    return true;
  }

  const idx = Math.max(0, Math.trunc(Number(interaction.values?.[0] ?? 0)));
  const track = entry.tracks?.[idx];
  if (!track) {
    await interaction.followUp({ content: "Invalid selection.", ephemeral: true }).catch(() => {});
    return true;
  }

  const sess = getSessionAgent(entry.guildId, entry.voiceChannelId);
  if (!sess.ok) {
    await interaction.followUp({ content: formatMusicError(sess.reason), ephemeral: true }).catch(() => {});
    return true;
  }

  let config = null;
  try {
    config = await getMusicConfig(entry.guildId);
  } catch {}

  try {
    botLogger.debug(`[music:select] Sending play command for track: ${track.title || track.uri} to agent ${sess.agent?.agentId}`);
    const result = await sendAgentCommand(sess.agent, "play", {
      guildId: entry.guildId,
      voiceChannelId: entry.voiceChannelId,
      textChannelId: interaction.channelId,
      ownerUserId: interaction.user.id,
      actorUserId: interaction.user.id,
      query: track.uri ?? track.title ?? "",
      controlMode: config?.controlMode,
      searchProviders: config?.searchProviders,
      fallbackProviders: config?.fallbackProviders,
      requester: buildRequester(interaction.user)
    });
    botLogger.debug(`[music:select] Play command result:`, result);
    const playedTrack = result?.track ?? track;
    const action = String(result?.action ?? "queued");
    await interaction.editReply({
      embeds: [buildTrackEmbed(action, playedTrack)],
      components: []
    }).catch(() => {});
  } catch (err) {
    botLogger.error(`[music:select] Error sending play command:`, err?.stack ?? err?.message ?? err);
    await interaction.editReply({
      embeds: [makeEmbed("Music Error", formatMusicError(err), [], null, null, 0xFF0000)],
      components: []
    }).catch(() => {});
  }

  // Do NOT delete the cache entry immediately. 
  // Allow multiple people (or the same person) to select from the same search result if they want?
  // Or at least prevent the race condition where "Search selection expired" appears because it was deleted too fast.
  // Redis TTL handles cleanup.
  // searchCache.delete(key); 
  return true;
}

export async function handleModal(interaction) {
  if (!interaction.isModalSubmit?.()) return false;
  const id = String(interaction.customId || "");
  if (!id.startsWith("musicplmodal:")) return false;

  const key = id.split(":")[1] || "";
  const state = await getPlaylistModalState(key);
  if (!state) {
    await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "This form expired. Re-open the panel.", [], null, null, 0xFF0000)] }).catch(() => {});
    return true;
  }
  if (String(state.userId) !== interaction.user.id) {
    await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Not for you.", [], null, null, 0xFF0000)] }).catch(() => {});
    return true;
  }

  const guildId = state.guildId || interaction.guildId;
  if (!guildId) {
    await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Server context required.", [], null, null, 0xFF0000)] }).catch(() => {});
    return true;
  }

  const data = await loadGuildData(guildId);
  const cfg = normalizePlaylistsConfig(data);

  if (state.action === "create") {
    const name = String(interaction.fields?.getTextInputValue?.("name") ?? "").trim();
    if (!name) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Name is required.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    if (name.length > 40) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Name is too long (max 40).", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    const existing = Object.values(cfg.playlists || {});
    if (existing.length >= cfg.maxPlaylists) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", `Playlist limit reached (${cfg.maxPlaylists}).`, [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    const playlistId = `pl_${randomKey()}`;
    cfg.playlists[playlistId] = {
      id: playlistId,
      name,
      channelId: null,
      visibility: "guild",
      createdBy: interaction.user.id,
      collaborators: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      items: []
    };
    await saveGuildData(guildId, data).catch(() => {});
    await setPlaylistPanelSelected(guildId, interaction.user.id, playlistId).catch(() => {});
    await auditLog({ guildId, userId: interaction.user.id, action: "music.playlists.create", details: { playlistId, name } });

    const embed = buildPlaylistPanelEmbed(cfg);
    const components = buildPlaylistPanelComponents(cfg, interaction.user.id);
    await interaction.reply({
      ephemeral: true,
      embeds: [embed],
      components
    }).catch(() => {});
    return true;
  }

  if (state.action === "rename") {
    const name = String(interaction.fields?.getTextInputValue?.("name") ?? "").trim();
    if (!name) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Name is required.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    if (name.length > 40) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Name is too long (max 40).", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    const playlistId = String(state.playlistId || "");
    const pl = cfg.playlists?.[playlistId] ?? null;
    if (!pl) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Playlist not found.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    pl.name = name;
    pl.updatedAt = Date.now();
    await saveGuildData(guildId, data).catch(() => {});
    await auditLog({ guildId, userId: interaction.user.id, action: "music.playlists.rename", details: { playlistId, name } });

    const embed = buildPlaylistPanelEmbed(cfg);
    const components = buildPlaylistPanelComponents(cfg, interaction.user.id);
    await interaction.reply({ ephemeral: true, embeds: [embed], components }).catch(() => {});
    return true;
  }

  if (state.action === "search") {
    const uiKey = String(state.uiKey || "");
    const ui = await getPlaylistUiCache(uiKey);
    if (!ui || String(ui.userId) !== interaction.user.id) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "This search expired. Re-open playlists.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    const query = normalizeQuery(String(interaction.fields?.getTextInputValue?.("query") ?? ""));
    const next = { ...ui, query, page: 0, selectedItemId: "" };
    await setCache(`mplui:${uiKey}`, next, PLAYLIST_UI_TTL_SEC).catch(() => {});
    await interaction.reply({
      ephemeral: true,
      embeds: [makeEmbed("Music Playlists", "Search saved.\nGo back to your playlist panel and press **Refresh**.", [], null, null, QUEUE_COLOR)]
    }).catch(() => {});
    return true;
  }

  if (state.action === "replace") {
    const playlistId = String(state.playlistId || "");
    const itemId = String(state.itemId || "");
    const uiKey = String(state.uiKey || "");
    const url = String(interaction.fields?.getTextInputValue?.("url") ?? "").trim();
    if (!/^https?:\/\//i.test(url)) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "URL must start with http:// or https://", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    const pl = cfg.playlists?.[playlistId] ?? null;
    if (!pl) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Playlist not found.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    // Permission check
    if (!(interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild) || String(pl.createdBy) === interaction.user.id || (pl.collaborators || []).includes(interaction.user.id))) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "You don't have permission to edit this playlist.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    const idx = (pl.items || []).findIndex(it => String(it?.id || "") === itemId);
    if (idx < 0) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Track not found.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    pl.items[idx].url = url;
    pl.items[idx].type = "url";
    pl.items[idx].updatedAt = Date.now();
    pl.updatedAt = Date.now();
    await saveGuildData(guildId, data).catch(() => {});
    await auditLog({ guildId, userId: interaction.user.id, action: "music.playlists.item_replace", details: { playlistId, itemId } });
    void tryUpdatePlaylistPanelMessage(interaction.guild, data, playlistId).catch(() => {});
    // Update cached browser state (best-effort). Users can press Refresh in their open panel.
    const ui = await getPlaylistUiCache(uiKey);
    if (ui && String(ui.userId) === interaction.user.id) {
      await setCache(`mplui:${uiKey}`, { ...ui, selectedPlaylistId: playlistId, selectedItemId: itemId }, PLAYLIST_UI_TTL_SEC).catch(() => {});
    }
    await interaction.reply({
      ephemeral: true,
      embeds: [makeEmbed("Playlist Updated", "Replaced URL.\nGo back to your playlist panel and press **Refresh**.", [], null, null, QUEUE_COLOR)]
    }).catch(() => {});
    return true;
  }

  if (state.action === "join_invite") {
    const uiKey = String(state.uiKey || "");
    const code = String(interaction.fields?.getTextInputValue?.("code") ?? "").trim().toUpperCase();
    const inv = await redeemPlaylistInvite(code);
    if (!inv?.guildId || !inv?.playlistId) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Join Playlist", "Invalid or expired invite code.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    if (String(inv.guildId) !== String(guildId)) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Join Playlist", "That invite is for a different server.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    const data = await loadGuildData(guildId);
    const cfg = normalizePlaylistsConfig(data);
    const pl = cfg.playlists?.[String(inv.playlistId)] ?? null;
    if (!pl) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Join Playlist", "Playlist not found.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    // Add as collaborator
    pl.collaborators = Array.from(new Set([...(pl.collaborators || []).map(String), interaction.user.id]));
    pl.updatedAt = Date.now();
    await saveGuildData(guildId, data).catch(() => {});
    await auditLog({ guildId, userId: interaction.user.id, action: "music.playlists.invite_join", details: { playlistId: pl.id } });
    // If playlist has a private thread, try to add user to it.
    const guild = interaction.guild;
    if (guild && pl.channelId) {
      const ch = guild.channels.cache.get(pl.channelId);
      if (ch?.isThread?.()) {
        await ch.members.add(interaction.user.id).catch(() => {});
      }
    }
    void tryUpdatePlaylistPanelMessage(interaction.guild, data, pl.id).catch(() => {});

    // Set browser state to this playlist if the UI exists.
    const ui = uiKey ? await getPlaylistUiCache(uiKey) : null;
    if (ui && String(ui.userId) === interaction.user.id) {
      await setCache(`mplui:${uiKey}`, { ...ui, selectedPlaylistId: pl.id, selectedItemId: "", sortKey: "manual", query: "", page: 0 }, PLAYLIST_UI_TTL_SEC).catch(() => {});
    }

    await interaction.reply({
      ephemeral: true,
      embeds: [makeEmbed("Join Playlist", `You joined **${pl.name || pl.id}**.`, [
        { name: "Tip", value: "Open playlists and press Refresh to see it.", inline: false }
      ], null, null, QUEUE_COLOR)]
    }).catch(() => {});
    return true;
  }

  if (state.action === "move") {
    const uiKey = String(state.uiKey || "");
    const playlistId = String(state.playlistId || "");
    const itemId = String(state.itemId || "");
    const max = Math.max(1, Math.trunc(Number(state.max) || 1));
    const raw = String(interaction.fields?.getTextInputValue?.("pos") ?? "").trim();
    const pos = Math.max(1, Math.min(max, Math.trunc(Number(raw) || 0)));
    if (!pos) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Move Track", "Enter a valid position number.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    const data = await loadGuildData(guildId);
    const cfg = normalizePlaylistsConfig(data);
    const pl = cfg.playlists?.[playlistId] ?? null;
    if (!pl) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Move Track", "Playlist not found.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    if (!canManagePlaylist(interaction, pl)) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Move Track", "No permission.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    const idx = (pl.items || []).findIndex(it => String(it?.id || "") === itemId);
    if (idx < 0) {
      await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Move Track", "Track not found.", [], null, null, 0xFF0000)] }).catch(() => {});
      return true;
    }
    const [it] = pl.items.splice(idx, 1);
    const newIdx = Math.max(0, Math.min(pl.items.length, pos - 1));
    pl.items.splice(newIdx, 0, it);
    pl.updatedAt = Date.now();
    await saveGuildData(guildId, data).catch(() => {});
    await auditLog({ guildId, userId: interaction.user.id, action: "music.playlists.move", details: { playlistId, itemId, pos } });
    void tryUpdatePlaylistPanelMessage(interaction.guild, data, playlistId).catch(() => {});
    // Update UI state
    if (uiKey) {
      const ui = await getPlaylistUiCache(uiKey);
      if (ui && String(ui.userId) === interaction.user.id) {
        await setCache(`mplui:${uiKey}`, { ...ui, selectedPlaylistId: playlistId, selectedItemId: itemId, sortKey: "manual", page: 0 }, PLAYLIST_UI_TTL_SEC).catch(() => {});
      }
    }
    await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Move Track", `Moved to position **${pos}**.`, [], null, null, QUEUE_COLOR)] }).catch(() => {});
    return true;
  }

  await interaction.reply({ ephemeral: true, embeds: [makeEmbed("Music Playlists", "Unknown form action.", [], null, null, 0xFF0000)] }).catch(() => {});
  return true;
}
