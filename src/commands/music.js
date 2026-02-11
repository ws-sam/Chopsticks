// src/commands/music.js
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
  PermissionFlagsBits
} from "discord.js";
import {
  ensureSessionAgent,
  getSessionAgent,
  releaseSession,
  sendAgentCommand,
  formatMusicError
} from "../music/service.js";
import { getMusicConfig, setDefaultMusicMode, updateMusicSettings } from "../music/config.js";
import { auditLog } from "../utils/audit.js";

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

function requireVoice(interaction) {
  const member = interaction.member;
  const vc = member?.voice?.channel ?? null;
  if (!vc) return { ok: false, vc: null };
  return { ok: true, vc };
}

function buildRequester(user) {
  return {
    id: user.id,
    username: user.username,
    discriminator: user.discriminator,
    avatar: user.avatar
  };
}

async function safeDeferEphemeral(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return { ok: true };
  } catch (err) {
    const code = err?.code;
    if (code === 10062) return { ok: false, reason: "unknown-interaction" };
    throw err;
  }
}

function makeEmbed(title, description, fields = [], url = null, thumbnail_url = null, color = null, footer = null) {
  const e = new EmbedBuilder().setTitle(title).setDescription(description ?? "");
  if (Array.isArray(fields) && fields.length) e.addFields(fields);
  if (url) e.setURL(url);
  if (thumbnail_url) e.setThumbnail(thumbnail_url);
  if (color) e.setColor(color);
  if (footer) e.setFooter(footer);
  return e;
}

function buildTrackEmbed(action, track) {
  const title = action === "playing" ? "Now Playing" : "Queued";
  const fields = [];
  if (track?.author) fields.push({ name: "Artist", value: track.author, inline: true });
  const dur = track?.duration ?? track?.length;
  if (dur) fields.push({ name: "Duration", value: formatDuration(dur), inline: true });
  if (track?.requester?.username) fields.push({ name: "Requested by", value: track.requester.username, inline: true });
  return makeEmbed(
    title,
    track?.title ?? "Unknown title",
    fields,
    track?.uri ?? null,
    track?.thumbnail ?? null
  );
}

const QUEUE_PAGE_SIZE = 10;
const QUEUE_COLOR = 0x5865F2;
const SEARCH_TTL_MS = 10 * 60_000;
const searchCache = new Map(); // key -> { userId, guildId, voiceChannelId, tracks, createdAt }

function randomKey() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function setSearchCache(entry) {
  const key = randomKey();
  searchCache.set(key, { ...entry, createdAt: Date.now() });
  setTimeout(() => searchCache.delete(key), SEARCH_TTL_MS).unref?.();
  return key;
}

function getSearchCache(key) {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > SEARCH_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return entry;
}

function truncate(text, max) {
  const s = String(text ?? "");
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

function buildSearchMenu(tracks, cacheKey) {
  const options = tracks.slice(0, 25).map((t, idx) => {
    const title = truncate(t?.title ?? "Unknown title", 100);
    const author = truncate(t?.author ?? "", 100);
    const dur = t?.duration ?? t?.length;
    const duration = dur ? ` • ${formatDuration(dur)}` : "";
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
    if (current.author) line += ` — ${current.author}`;
    const curDur = current?.duration ?? current?.length;
    if (curDur) line += ` • ${formatDuration(curDur)}`;
    if (current.requester?.username) line += ` • requested by ${current.requester.username}`;
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
      const dur = durMs ? ` • ${formatDuration(durMs)}` : "";
      lines.push(`${i + 1}. [${title}](${t?.uri ?? ""})${dur}`);
    }
    fields.push({ name: `Up Next (${start + 1}-${end} of ${tracks.length})`, value: lines.join("\n"), inline: false });
  }

  const footer = {
    text: `Page ${safePage + 1}/${totalPages}${actionNote ? ` • ${actionNote}` : ""}`
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

  return [row1, row2];
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

export async function execute(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const sub = interaction.options.getSubcommand();

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
      const ack = await safeDeferEphemeral(interaction);
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
        console.warn("[music:play] alloc failed:", alloc.reason);
        const errorMsg = formatMusicError(alloc.reason);
        const embedFields = [];
        if (alloc.reason === "no-agents-in-guild" || alloc.reason === "no-free-agents") {
          embedFields.push({ name: "Hint", value: "You might need to deploy more music agents. Use `/agents deploy` to get invite links.", inline: false });
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
          console.error("[music:play] agent error:", err?.stack ?? err?.message ?? err);
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
        await interaction.editReply({
          embeds: [buildTrackEmbed(action, track)]
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
        console.error("[music:search] agent error:", err?.stack ?? err?.message ?? err);
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

      const cacheKey = setSearchCache({
        userId,
        guildId,
        voiceChannelId: vc.id,
        tracks
      });

      const controlLabel = config.controlMode === "voice" ? "Voice channel" : "Owner/Admin";
      const row = buildSearchMenu(tracks, cacheKey);
      await interaction.editReply({
        embeds: [makeEmbed("Music Search", `Select a result to play.`, [
          { name: "Results", value: `${tracks.length} found`, inline: true },
          { name: "Queue Control", value: controlLabel, inline: true }
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
}

export async function handleButton(interaction) {
  if (!interaction.isButton?.()) return false;
  const id = String(interaction.customId || "");
  if (!id.startsWith("musicq:")) return false;

  const parts = id.split(":");
  const voiceChannelId = parts[1];
  const page = Math.max(0, Number.parseInt(parts[2] || "0", 10) || 0);
  const action = parts[3] || "refresh";

  const memberVcId = interaction.member?.voice?.channelId ?? null;
  if (memberVcId !== voiceChannelId) {
    await interaction.reply({
      content: "Join the same voice channel to control this queue.",
      ephemeral: true
    }).catch(() => {});
    return true;
  }

  await interaction.deferUpdate().catch(() => {});

  const guildId = interaction.guildId;
  if (!guildId || !voiceChannelId) return true;

  const sess = getSessionAgent(guildId, voiceChannelId);
  if (!sess.ok) {
    await interaction.editReply({
      embeds: [makeEmbed("Music", formatMusicError(sess.reason), [], null, null, 0xFF0000)],
      components: []
    }).catch(() => {});
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

  return true;
}

export async function handleSelect(interaction) {
  if (!interaction.isStringSelectMenu?.()) return false;
  const id = String(interaction.customId || "");
  if (!id.startsWith("musicsearch:")) return false;

  const key = id.split(":")[1];
  const entry = getSearchCache(key);
  if (!entry) {
    await interaction.reply({ content: "Search selection expired. Run /music play again.", ephemeral: true }).catch(() => {});
    return true;
  }

  if (entry.userId !== interaction.user.id) {
    await interaction.reply({ content: "Not for you.", ephemeral: true }).catch(() => {});
    return true;
  }

  const memberVcId = interaction.member?.voice?.channelId ?? null;
  if (memberVcId !== entry.voiceChannelId) {
    await interaction.reply({ content: "Join the same voice channel to select this result.", ephemeral: true }).catch(() => {});
    return true;
  }

  const idx = Math.max(0, Math.trunc(Number(interaction.values?.[0] ?? 0)));
  const track = entry.tracks?.[idx];
  if (!track) {
    await interaction.reply({ content: "Invalid selection.", ephemeral: true }).catch(() => {});
    return true;
  }

  const sess = getSessionAgent(entry.guildId, entry.voiceChannelId);
  if (!sess.ok) {
    await interaction.reply({ content: formatMusicError(sess.reason), ephemeral: true }).catch(() => {});
    return true;
  }

  let config = null;
  try {
    config = await getMusicConfig(entry.guildId);
  } catch {}

  try {
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
    const playedTrack = result?.track ?? track;
    const action = String(result?.action ?? "queued");
    await interaction.update({
      embeds: [buildTrackEmbed(action, playedTrack)],
      components: []
    }).catch(() => {});
  } catch (err) {
    await interaction.update({
      embeds: [makeEmbed("Music Error", formatMusicError(err), [], null, null, 0xFF0000)],
      components: []
    }).catch(() => {});
  }

  searchCache.delete(key);
  return true;
}
