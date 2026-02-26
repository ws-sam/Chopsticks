// src/prefix/commands/music.js
// Full prefix music control — mirrors /music slash command depth.
// Routes through the same music/service.js + agent ops as the slash command.

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} from "discord.js";
import {
  ensureSessionAgent,
  getSessionAgent,
  releaseSession,
  sendAgentCommand,
  formatMusicError,
} from "../../music/service.js";
import COLORS from "../../utils/colors.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(ms) {
  if (!ms || ms < 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function progressBar(pos, dur, width = 20) {
  if (!dur) return "▬".repeat(width);
  const filled = Math.round((pos / dur) * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

function nowPlayingEmbed(track, pos = 0, paused = false) {
  const bar = progressBar(pos, track.duration);
  const elapsed = fmt(pos);
  const total = fmt(track.duration);
  const bar2 = `${elapsed} ${bar} ${total}`;
  return new EmbedBuilder()
    .setTitle(`${paused ? "⏸" : "🎵"} Now Playing`)
    .setDescription(`**[${track.title}](${track.uri ?? "https://discord.com"})**\n${bar2}`)
    .setThumbnail(track.artworkUrl ?? track.thumbnail ?? null)
    .addFields(
      { name: "Duration", value: total, inline: true },
      { name: "Author",   value: track.author ?? "Unknown", inline: true },
      { name: "Source",   value: track.sourceName ?? "unknown", inline: true },
    )
    .setColor(paused ? COLORS.WARNING : COLORS.MUSIC ?? 0x1DB954)
    .setFooter({ text: "Chopsticks Music • !queue | !skip | !stop" });
}

function npButtons(guildId, vcId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mpl:pause:${guildId}:${vcId}`).setLabel("⏸ Pause").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mpl:skip:${guildId}:${vcId}`).setLabel("⏭ Skip").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`mpl:stop:${guildId}:${vcId}`).setLabel("⏹ Stop").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`mpl:queue:${guildId}:${vcId}`).setLabel("📋 Queue").setStyle(ButtonStyle.Secondary),
  );
}

function getVoiceChannel(message) {
  return message.member?.voice?.channel ?? null;
}

async function requireSession(message) {
  const vc = getVoiceChannel(message);
  if (!vc) {
    await message.reply({ content: "❌ You must be in a voice channel.", allowedMentions: { repliedUser: false } });
    return null;
  }
  const sess = getSessionAgent(message.guildId, vc.id);
  if (!sess.ok) {
    await message.reply({ content: "❌ No active music session. Use `!play <song>` to start.", allowedMentions: { repliedUser: false } });
    return null;
  }
  return { vc, agent: sess.agent };
}

// ── Commands ─────────────────────────────────────────────────────────────────

export default [
  // ── play ──────────────────────────────────────────────────────────────────
  {
    name: "play",
    aliases: ["p", "music"],
    description: "Play or queue a track — !play <search | URL>",
    rateLimit: 3000,
    async execute(message, args) {
      const query = args.join(" ").trim();
      if (!query) return message.reply("Usage: `!play <song name or URL>`");

      const vc = getVoiceChannel(message);
      if (!vc) return message.reply("❌ Join a voice channel first.");

      const loading = await message.reply({ content: "🔍 Searching…", allowedMentions: { repliedUser: false } });

      try {
        const alloc = await ensureSessionAgent(message.guildId, vc.id, {
          textChannelId: message.channelId,
          ownerUserId: message.author.id,
        });
        if (!alloc.ok) {
          return loading.edit(formatMusicError(alloc.reason));
        }

        const result = await sendAgentCommand(alloc.agent, "play", {
          guildId: message.guildId,
          voiceChannelId: vc.id,
          textChannelId: message.channelId,
          actorUserId: message.author.id,
          query,
        });

        if (!result?.track && !result?.queued) {
          return loading.edit("❌ Nothing found for that query. Try a different search.");
        }

        const track = result.track ?? result.queued;
        const isQueued = !!result.queued;
        const embed = new EmbedBuilder()
          .setColor(isQueued ? COLORS.INFO : COLORS.MUSIC ?? 0x1DB954)
          .setTitle(isQueued ? "📋 Added to Queue" : "🎵 Now Playing")
          .setDescription(`**[${track.title}](${track.uri ?? "https://discord.com"})**`)
          .setThumbnail(track.artworkUrl ?? track.thumbnail ?? null)
          .addFields(
            { name: "Duration", value: fmt(track.duration), inline: true },
            { name: "Author",   value: track.author ?? "Unknown", inline: true },
            ...(isQueued ? [{ name: "Position", value: `#${result.position ?? "?"}`, inline: true }] : []),
          )
          .setFooter({ text: `Requested by ${message.author.username} • !queue | !skip | !stop` });

        return loading.edit({ content: null, embeds: [embed], components: [npButtons(message.guildId, vc.id)] });
      } catch (err) {
        return loading.edit(formatMusicError(err));
      }
    },
  },

  // ── search ─────────────────────────────────────────────────────────────────
  {
    name: "search",
    aliases: ["find"],
    description: "Search for tracks — !search <query>",
    rateLimit: 5000,
    async execute(message, args) {
      const query = args.join(" ").trim();
      if (!query) return message.reply("Usage: `!search <query>`");

      const vc = getVoiceChannel(message);
      if (!vc) return message.reply("❌ Join a voice channel first.");

      const loading = await message.reply({ content: "🔍 Searching…", allowedMentions: { repliedUser: false } });

      try {
        const alloc = await ensureSessionAgent(message.guildId, vc.id, {
          textChannelId: message.channelId,
          ownerUserId: message.author.id,
        });
        if (!alloc.ok) return loading.edit(formatMusicError(alloc.reason));

        const result = await sendAgentCommand(alloc.agent, "search", {
          guildId: message.guildId,
          voiceChannelId: vc.id,
          actorUserId: message.author.id,
          query,
        });

        const tracks = result?.tracks ?? [];
        if (!tracks.length) return loading.edit("❌ No results found.");

        const lines = tracks.slice(0, 10).map((t, i) =>
          `\`${i + 1}.\` **[${t.title}](${t.uri ?? "https://discord.com"})** — ${fmt(t.duration)}`
        );

        const embed = new EmbedBuilder()
          .setTitle(`🔍 Search Results for "${query}"`)
          .setDescription(lines.join("\n"))
          .setColor(COLORS.INFO)
          .setFooter({ text: "Reply with !play <number> or !play <url> to queue a track" });

        return loading.edit({ content: null, embeds: [embed] });
      } catch (err) {
        return loading.edit(formatMusicError(err));
      }
    },
  },

  // ── nowplaying ─────────────────────────────────────────────────────────────
  {
    name: "nowplaying",
    aliases: ["np", "current", "song"],
    description: "Show the current track — !np",
    rateLimit: 3000,
    async execute(message) {
      const sess = await requireSession(message);
      if (!sess) return;
      try {
        const result = await sendAgentCommand(sess.agent, "status", {
          guildId: message.guildId,
          voiceChannelId: sess.vc.id,
          actorUserId: message.author.id,
        });
        if (!result?.track) return message.reply("❌ Nothing is playing right now.");
        const embed = nowPlayingEmbed(result.track, result.position ?? 0, result.paused);
        return message.reply({ embeds: [embed], components: [npButtons(message.guildId, sess.vc.id)] });
      } catch (err) {
        return message.reply(formatMusicError(err));
      }
    },
  },

  // ── queue ──────────────────────────────────────────────────────────────────
  {
    name: "queue",
    aliases: ["q", "playlist"],
    description: "Show the current queue — !queue [page]",
    rateLimit: 3000,
    async execute(message, args) {
      const sess = await requireSession(message);
      if (!sess) return;
      const page = Math.max(1, parseInt(args[0]) || 1);
      try {
        const result = await sendAgentCommand(sess.agent, "queue", {
          guildId: message.guildId,
          voiceChannelId: sess.vc.id,
          actorUserId: message.author.id,
        });
        const tracks = result?.tracks ?? [];
        const current = result?.current;
        if (!current && !tracks.length) return message.reply("📋 The queue is empty.");

        const PAGE_SIZE = 15;
        const totalPages = Math.max(1, Math.ceil(tracks.length / PAGE_SIZE));
        const pg = Math.min(page, totalPages);
        const slice = tracks.slice((pg - 1) * PAGE_SIZE, pg * PAGE_SIZE);

        const lines = slice.map((t, i) =>
          `\`${(pg - 1) * PAGE_SIZE + i + 1}.\` **${t.title}** — ${fmt(t.duration)}`
        );

        const totalDur = tracks.reduce((acc, t) => acc + (t.duration ?? 0), 0);

        const embed = new EmbedBuilder()
          .setTitle("📋 Music Queue")
          .setColor(COLORS.MUSIC ?? 0x1DB954)
          .setDescription([
            current ? `🎵 **Now:** ${current.title} — ${fmt(current.duration)}` : "",
            "",
            lines.length ? lines.join("\n") : "*(end of queue)*",
          ].join("\n").trim().slice(0, 4000))
          .addFields({ name: "Total", value: `${tracks.length} tracks — ${fmt(totalDur)}`, inline: true })
          .setFooter({ text: `Page ${pg}/${totalPages} • !remove <#> | !shuffle | !clear` });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`mpl:queue_prev:${message.guildId}:${sess.vc.id}:${pg}`)
            .setLabel("◀ Prev")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pg <= 1),
          new ButtonBuilder()
            .setCustomId(`mpl:queue_next:${message.guildId}:${sess.vc.id}:${pg}`)
            .setLabel("Next ▶")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pg >= totalPages),
          new ButtonBuilder()
            .setCustomId(`mpl:shuffle:${message.guildId}:${sess.vc.id}`)
            .setLabel("🔀 Shuffle")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`mpl:clear:${message.guildId}:${sess.vc.id}`)
            .setLabel("🗑 Clear")
            .setStyle(ButtonStyle.Danger),
        );

        return message.reply({ embeds: [embed], components: [row] });
      } catch (err) {
        return message.reply(formatMusicError(err));
      }
    },
  },

  // ── skip ───────────────────────────────────────────────────────────────────
  {
    name: "skip",
    aliases: ["s", "next"],
    description: "Skip the current track — !skip",
    rateLimit: 2000,
    async execute(message) {
      const sess = await requireSession(message);
      if (!sess) return;
      try {
        await sendAgentCommand(sess.agent, "skip", {
          guildId: message.guildId,
          voiceChannelId: sess.vc.id,
          actorUserId: message.author.id,
        });
        return message.react("⏭");
      } catch (err) {
        return message.reply(formatMusicError(err));
      }
    },
  },

  // ── pause ──────────────────────────────────────────────────────────────────
  {
    name: "pause",
    aliases: ["pa"],
    description: "Pause playback — !pause",
    rateLimit: 2000,
    async execute(message) {
      const sess = await requireSession(message);
      if (!sess) return;
      try {
        await sendAgentCommand(sess.agent, "pause", {
          guildId: message.guildId,
          voiceChannelId: sess.vc.id,
          actorUserId: message.author.id,
        });
        return message.react("⏸");
      } catch (err) {
        return message.reply(formatMusicError(err));
      }
    },
  },

  // ── resume ─────────────────────────────────────────────────────────────────
  {
    name: "resume",
    aliases: ["r", "unpause"],
    description: "Resume playback — !resume",
    rateLimit: 2000,
    async execute(message) {
      const sess = await requireSession(message);
      if (!sess) return;
      try {
        await sendAgentCommand(sess.agent, "resume", {
          guildId: message.guildId,
          voiceChannelId: sess.vc.id,
          actorUserId: message.author.id,
        });
        return message.react("▶️");
      } catch (err) {
        return message.reply(formatMusicError(err));
      }
    },
  },

  // ── stop ───────────────────────────────────────────────────────────────────
  {
    name: "stop",
    aliases: ["disconnect", "dc", "leave"],
    description: "Stop playback and disconnect — !stop",
    rateLimit: 3000,
    async execute(message) {
      const sess = await requireSession(message);
      if (!sess) return;
      try {
        await sendAgentCommand(sess.agent, "stop", {
          guildId: message.guildId,
          voiceChannelId: sess.vc.id,
          actorUserId: message.author.id,
        });
        releaseSession(message.guildId, sess.vc.id);
        return message.react("⏹");
      } catch (err) {
        return message.reply(formatMusicError(err));
      }
    },
  },

  // ── volume ─────────────────────────────────────────────────────────────────
  {
    name: "volume",
    aliases: ["vol", "v"],
    description: "Set playback volume (0–200) — !volume <0-200>",
    rateLimit: 2000,
    async execute(message, args) {
      const sess = await requireSession(message);
      if (!sess) return;
      const vol = parseInt(args[0]);
      if (isNaN(vol) || vol < 0 || vol > 200) return message.reply("Usage: `!volume <0-200>`");
      try {
        await sendAgentCommand(sess.agent, "volume", {
          guildId: message.guildId,
          voiceChannelId: sess.vc.id,
          actorUserId: message.author.id,
          volume: vol,
        });
        const bar = "█".repeat(Math.round(vol / 10)) + "░".repeat(20 - Math.round(vol / 10));
        return message.reply(`🔊 Volume: **${vol}%**\n\`${bar}\``);
      } catch (err) {
        return message.reply(formatMusicError(err));
      }
    },
  },

  // ── shuffle ────────────────────────────────────────────────────────────────
  {
    name: "shuffle",
    aliases: ["mix"],
    description: "Shuffle the queue — !shuffle",
    rateLimit: 3000,
    async execute(message) {
      const sess = await requireSession(message);
      if (!sess) return;
      try {
        await sendAgentCommand(sess.agent, "shuffle", {
          guildId: message.guildId,
          voiceChannelId: sess.vc.id,
          actorUserId: message.author.id,
        });
        return message.react("🔀");
      } catch (err) {
        return message.reply(formatMusicError(err));
      }
    },
  },

  // ── remove ─────────────────────────────────────────────────────────────────
  {
    name: "remove",
    aliases: ["rm", "dequeue"],
    description: "Remove a track from the queue by position — !remove <#>",
    rateLimit: 2000,
    async execute(message, args) {
      const sess = await requireSession(message);
      if (!sess) return;
      const idx = parseInt(args[0]);
      if (isNaN(idx) || idx < 1) return message.reply("Usage: `!remove <position>` (use `!queue` to see positions)");
      try {
        const result = await sendAgentCommand(sess.agent, "remove", {
          guildId: message.guildId,
          voiceChannelId: sess.vc.id,
          actorUserId: message.author.id,
          index: idx,
        });
        const title = result?.removed?.title ?? `track #${idx}`;
        return message.reply(`🗑 Removed **${title}** from the queue.`);
      } catch (err) {
        return message.reply(formatMusicError(err));
      }
    },
  },

  // ── move ───────────────────────────────────────────────────────────────────
  {
    name: "move",
    aliases: ["mv"],
    description: "Move a track to a new position — !move <from> <to>",
    rateLimit: 2000,
    async execute(message, args) {
      const sess = await requireSession(message);
      if (!sess) return;
      const from = parseInt(args[0]);
      const to   = parseInt(args[1]);
      if (isNaN(from) || isNaN(to) || from < 1 || to < 1) return message.reply("Usage: `!move <from> <to>`");
      try {
        await sendAgentCommand(sess.agent, "move", {
          guildId: message.guildId,
          voiceChannelId: sess.vc.id,
          actorUserId: message.author.id,
          from,
          to,
        });
        return message.reply(`✅ Moved track from position **${from}** → **${to}**.`);
      } catch (err) {
        return message.reply(formatMusicError(err));
      }
    },
  },

  // ── clear ──────────────────────────────────────────────────────────────────
  {
    name: "clearqueue",
    aliases: ["cq", "emptyqueue"],
    description: "Clear the entire queue — !clearqueue",
    rateLimit: 3000,
    async execute(message) {
      const sess = await requireSession(message);
      if (!sess) return;
      try {
        await sendAgentCommand(sess.agent, "clear", {
          guildId: message.guildId,
          voiceChannelId: sess.vc.id,
          actorUserId: message.author.id,
        });
        return message.reply("🗑 Queue cleared.");
      } catch (err) {
        return message.reply(formatMusicError(err));
      }
    },
  },

  // ── loop ───────────────────────────────────────────────────────────────────
  {
    name: "loop",
    aliases: ["repeat", "lp"],
    description: "Set loop mode — !loop <off|track|queue>",
    rateLimit: 2000,
    async execute(message, args) {
      const sess = await requireSession(message);
      if (!sess) return;
      const mode = (args[0] || "track").toLowerCase();
      const valid = ["off", "none", "track", "queue", "all"];
      if (!valid.includes(mode)) return message.reply("Usage: `!loop <off | track | queue>`");
      const preset = mode === "off" || mode === "none" ? "off" : mode === "track" ? "single" : "queue";
      try {
        await sendAgentCommand(sess.agent, "preset", {
          guildId: message.guildId,
          voiceChannelId: sess.vc.id,
          actorUserId: message.author.id,
          preset,
        });
        const label = { off: "🔁 Loop Off", single: "🔂 Track Loop", queue: "🔁 Queue Loop" }[preset] ?? preset;
        return message.reply(`${label} — ${mode}`);
      } catch (err) {
        return message.reply(formatMusicError(err));
      }
    },
  },
];
