/**
 * /audiobook — Text-to-speech reading in voice channels.
 * Supports .txt, .md, .pdf, .docx, .epub files via private drop thread.
 * Uses msedge-tts (free, no API key) or falls back to VOICE_ASSIST_TTS_URL.
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  Colors,
} from 'discord.js';
import { joinVoiceChannel } from '@discordjs/voice';
import { loadGuildData } from '../utils/storage.js';
import { parseFile, SUPPORTED_EXTS, MAX_FILE_SIZE } from '../audiobook/parser.js';
import { VOICE_PRESETS, PRESET_KEYS, getVoices, generateChunk, splitIntoChunks, resolveVoice } from '../audiobook/tts.js';
import { getOrCreatePlayer, getPlayer, destroyPlayer, PlayerState } from '../audiobook/player.js';
import {
  createBook, insertChapters, getBook, listBooks, deleteBook, getChapters,
  getOrCreateSession, updateSession, getSession,
  getVoicePrefs, saveVoicePrefs,
  addBookmark, getBookmarks,
} from '../audiobook/session.js';
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = {
  name: 'audiobook',
  description: 'Read books aloud in your voice channel',
  category: 'entertainment',
};

export const data = new SlashCommandBuilder()
  .setName('audiobook')
  .setDescription('📖 Read books aloud in your voice channel via AI text-to-speech')
  .addSubcommand(s => s
    .setName('start')
    .setDescription('Open a private book-drop thread — drag & drop files to add books'))
  .addSubcommand(s => s
    .setName('play')
    .setDescription('Start or resume reading in your current voice channel'))
  .addSubcommand(s => s
    .setName('pause')
    .setDescription('Pause reading'))
  .addSubcommand(s => s
    .setName('resume')
    .setDescription('Resume reading'))
  .addSubcommand(s => s
    .setName('skip')
    .setDescription('Skip to the next chapter'))
  .addSubcommand(s => s
    .setName('stop')
    .setDescription('Stop reading and close the session'))
  .addSubcommand(s => s
    .setName('speed')
    .setDescription('Change reading speed')
    .addStringOption(o => o
      .setName('rate')
      .setDescription('Reading speed')
      .setRequired(true)
      .addChoices(
        { name: '0.5× (Slow)', value: '0.5' },
        { name: '0.75×', value: '0.75' },
        { name: '1× (Normal)', value: '1.0' },
        { name: '1.25×', value: '1.25' },
        { name: '1.5×', value: '1.5' },
        { name: '2× (Fast)', value: '2.0' },
      )))
  .addSubcommand(s => s
    .setName('voice')
    .setDescription('Choose a reading voice and style'))
  .addSubcommand(s => s
    .setName('library')
    .setDescription('View and manage your uploaded books'))
  .addSubcommand(s => s
    .setName('bookmark')
    .setDescription('Save your current reading position')
    .addStringOption(o => o
      .setName('note')
      .setDescription('Optional bookmark note')
      .setMaxLength(100)))
  .addSubcommand(s => s
    .setName('bookmarks')
    .setDescription('View your saved bookmarks'));

// ── Thread binding map: threadId → { userId, bookId } ────────────────────────
const audiobookThreads = new Map();

// ── Execute ───────────────────────────────────────────────────────────────────

export async function execute(interaction) {
  if (!interaction.guildId) {
    return interaction.reply({ content: '📖 Audiobook requires a server.', ephemeral: true });
  }

  const sub = interaction.options.getSubcommand();
  const db  = await getDb();

  switch (sub) {
    case 'start':    return handleStart(interaction, db);
    case 'play':     return handlePlay(interaction, db);
    case 'pause':    return handlePause(interaction, db);
    case 'resume':   return handleResume(interaction, db);
    case 'skip':     return handleSkip(interaction, db);
    case 'stop':     return handleStop(interaction, db);
    case 'speed':    return handleSpeed(interaction, db);
    case 'voice':    return handleVoice(interaction, db);
    case 'library':  return handleLibrary(interaction, db);
    case 'bookmark': return handleBookmark(interaction, db);
    case 'bookmarks':return handleBookmarks(interaction, db);
    default:
      return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  }
}

// ── /audiobook start ──────────────────────────────────────────────────────────

async function handleStart(interaction, db) {
  await interaction.deferReply({ ephemeral: true });
  await withTimeout(interaction, async () => {
    const { user, guild, channel } = interaction;

    // Check for existing open thread
    for (const [tid, info] of audiobookThreads) {
      if (info.userId === user.id && info.guildId === guild.id) {
        const existing = guild.channels.cache.get(tid);
        if (existing) {
          return interaction.editReply({
            content: `📖 You already have a book-drop thread open: <#${tid}>\nDrop files there or use **/audiobook library** to manage your books.`,
          });
        }
        audiobookThreads.delete(tid);
      }
    }

    const thread = await tryCreateAudiobookThread(interaction);
    if (!thread) {
      return interaction.editReply({
        content: '❌ Could not create a private thread. Make sure I have **Create Private Threads** permission in this channel.',
      });
    }

    audiobookThreads.set(thread.id, { userId: user.id, guildId: guild.id, bookId: null });

    // Pin welcome panel in thread
    const panel = await thread.send({ embeds: [buildDropPanelEmbed(user)], components: [buildDropPanelRow()] });
    await panel.pin().catch(() => {});

    return interaction.editReply({
      content: `📖 Your book-drop thread is ready: <#${thread.id}>\n\n**Drop any supported file in there to upload it.**\nSupported: ${SUPPORTED_EXTS.join(' · ')} (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`,
    });
  }, { label: "audiobook" });
}

// ── /audiobook play ───────────────────────────────────────────────────────────

async function handlePlay(interaction, db) {
  await interaction.deferReply({ ephemeral: true });
  await withTimeout(interaction, async () => {
    const { user, guild } = interaction;

    const vcChannel = interaction.member?.voice?.channel;
    if (!vcChannel) return interaction.editReply({ content: '🔊 Join a voice channel first.' });

    const session = await getOrCreateSession(db, user.id, guild.id);
    if (!session.book_id) {
      return interaction.editReply({
        content: `📚 No book selected. Use **/audiobook start** to upload a book, or **/audiobook library** to pick one.`,
      });
    }

    const [book, chapters] = await Promise.all([
      getBook(db, session.book_id),
      getChapters(db, session.book_id),
    ]);
    if (!book || !chapters.length) {
      return interaction.editReply({ content: '❌ Book not found or has no chapters.' });
    }

    const prefs = await getVoicePrefs(db, user.id);
    session.voice_id = prefs.voice_id;
    session.speed    = parseFloat(prefs.speed ?? 1.0);

    const connection = joinVoiceChannel({
      channelId:      vcChannel.id,
      guildId:        guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf:       true,
    });

    const player = getOrCreatePlayer(guild.id, db);
    await player.load(session, book, chapters);
    await player.play(connection);

    await updateSession(db, session.id, { state: PlayerState.PLAYING, book_id: session.book_id });

    const progress = player.getProgress();
    return interaction.editReply({
      embeds: [buildNowReadingEmbed(progress)],
      components: [buildControlRow(guild.id)],
    });
  }, { label: "audiobook" });
}

// ── /audiobook pause ──────────────────────────────────────────────────────────

async function handlePause(interaction, db) {
  const player = getPlayer(interaction.guildId);
  if (!player || player.state !== PlayerState.PLAYING) {
    return interaction.reply({ content: '⏸ Nothing is currently playing.', ephemeral: true });
  }
  player.pause();
  await updateSession(db, (await getSession(db, interaction.user.id, interaction.guildId))?.id, { state: PlayerState.PAUSED });
  return interaction.reply({ content: '⏸ Paused.', ephemeral: true });
}

// ── /audiobook resume ─────────────────────────────────────────────────────────

async function handleResume(interaction, db) {
  const player = getPlayer(interaction.guildId);
  if (!player || player.state !== PlayerState.PAUSED) {
    return interaction.reply({ content: '▶️ Nothing is paused.', ephemeral: true });
  }
  player.resume();
  await updateSession(db, (await getSession(db, interaction.user.id, interaction.guildId))?.id, { state: PlayerState.PLAYING });
  return interaction.reply({ content: '▶️ Resumed.', ephemeral: true });
}

// ── /audiobook skip ───────────────────────────────────────────────────────────

async function handleSkip(interaction, db) {
  const player = getPlayer(interaction.guildId);
  if (!player || player.state === PlayerState.IDLE) {
    return interaction.reply({ content: '⏭ Nothing is playing.', ephemeral: true });
  }
  const advanced = await player.skipChapter();
  return interaction.reply({
    content: advanced ? `⏭ Skipped to **${player.chapters[player.session?.current_chapter ?? 0]?.title}**.` : '📖 End of book.',
    ephemeral: true,
  });
}

// ── /audiobook stop ───────────────────────────────────────────────────────────

async function handleStop(interaction, db) {
  const player = getPlayer(interaction.guildId);
  if (player) {
    player.destroy();
    destroyPlayer(interaction.guildId);
  }
  const session = await getSession(db, interaction.user.id, interaction.guildId);
  if (session) await updateSession(db, session.id, { state: PlayerState.IDLE });
  return interaction.reply({ content: '🏁 Stopped.', ephemeral: true });
}

// ── /audiobook speed ──────────────────────────────────────────────────────────

async function handleSpeed(interaction, db) {
  const rate  = parseFloat(interaction.options.getString('rate'));
  const prefs = await getVoicePrefs(db, interaction.user.id);
  await saveVoicePrefs(db, interaction.user.id, { voiceId: prefs.voice_id, speed: rate, preset: prefs.preset });

  const player = getPlayer(interaction.guildId);
  if (player?.session) player.session.speed = rate;

  return interaction.reply({ content: `⚡ Reading speed set to **${rate}×**`, ephemeral: true });
}

// ── /audiobook voice ──────────────────────────────────────────────────────────

async function handleVoice(interaction, db) {
  const embed = new EmbedBuilder()
    .setTitle('🎭 Choose a Reading Voice')
    .setDescription('Pick a **preset** for a curated voice, or choose from the **full catalog** for 400+ voices.')
    .setColor(Colors.Purple)
    .addFields(
      PRESET_KEYS.map(k => ({
        name: VOICE_PRESETS[k].label,
        value: `\`${k}\` · ${VOICE_PRESETS[k].desc}`,
        inline: true,
      }))
    )
    .setFooter({ text: 'Your choice is saved and used for all future reading sessions.' });

  const presetRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`audiobook:voicepreset:${interaction.guildId}`)
      .setPlaceholder('🎙️ Select a voice preset...')
      .addOptions(
        PRESET_KEYS.map(k => ({
          label: VOICE_PRESETS[k].label,
          description: VOICE_PRESETS[k].desc.slice(0, 50),
          value: k,
          emoji: VOICE_PRESETS[k].label.split(' ')[0],
        }))
      )
  );

  const catalogBtn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`audiobook:voicecatalog:${interaction.guildId}:0`)
      .setLabel('Browse Full Voice Catalog')
      .setEmoji('🌍')
      .setStyle(ButtonStyle.Secondary),
  );

  return interaction.reply({ embeds: [embed], components: [presetRow, catalogBtn], ephemeral: true });
}

// ── /audiobook library ────────────────────────────────────────────────────────

async function handleLibrary(interaction, db) {
  await interaction.deferReply({ ephemeral: true });
  await withTimeout(interaction, async () => {
    const books = await listBooks(db, interaction.user.id, interaction.guildId);

    if (!books.length) {
      return interaction.editReply({
        content: '📚 Your library is empty.\nUse **/audiobook start** to open a drop thread and upload a book.',
      });
    }

    const session = await getSession(db, interaction.user.id, interaction.guildId);

    const embed = new EmbedBuilder()
      .setTitle(`📚 ${interaction.user.displayName}'s Library`)
      .setColor(Colors.DarkGold)
      .setDescription(`${books.length} book${books.length !== 1 ? 's' : ''} in your collection`)
      .addFields(
        books.slice(0, 10).map((b, i) => {
          const isCurrent = session?.book_id === b.id;
          const prog = isCurrent && session?.current_chapter
            ? `\`${buildMiniBar(Math.round(session.current_chapter / b.total_chapters * 100))}\``
            : '`░░░░░░░░░░ 0%`';
          return {
            name: `${isCurrent ? '▶️ ' : `${i + 1}. `}${b.title}${b.author ? ` — ${b.author}` : ''}`,
            value: `${formatIcon(b.format)} ${b.total_chapters} chapters · ${Math.round(b.total_words / 1000)}k words\n${prog}`,
            inline: false,
          };
        })
      );

    const selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`audiobook:selectbook:${interaction.guildId}`)
        .setPlaceholder('📖 Switch to a book...')
        .addOptions(
          books.slice(0, 25).map(b => ({
            label: b.title.slice(0, 50),
            description: `${b.total_chapters} chapters · ${b.author ?? 'Unknown author'}`.slice(0, 50),
            value: b.id,
            emoji: formatIcon(b.format),
          }))
        )
    );

    return interaction.editReply({ embeds: [embed], components: [selectRow] });
  }, { label: "audiobook" });
}

// ── /audiobook bookmark ───────────────────────────────────────────────────────

async function handleBookmark(interaction, db) {
  const note    = interaction.options.getString('note');
  const session = await getSession(db, interaction.user.id, interaction.guildId);
  if (!session?.book_id) {
    return interaction.reply({ content: '📖 No active book to bookmark.', ephemeral: true });
  }
  const player  = getPlayer(interaction.guildId);
  const chapter = player?.session?.current_chapter ?? session.current_chapter ?? 0;
  await addBookmark(db, interaction.user.id, session.book_id, chapter, 0, note);
  return interaction.reply({
    content: `🔖 Bookmark saved at chapter ${chapter + 1}${note ? ` — *${note}*` : ''}.`,
    ephemeral: true,
  });
}

// ── /audiobook bookmarks ──────────────────────────────────────────────────────

async function handleBookmarks(interaction, db) {
  await interaction.deferReply({ ephemeral: true });
  await withTimeout(interaction, async () => {
    const session = await getSession(db, interaction.user.id, interaction.guildId);
    if (!session?.book_id) {
      return interaction.editReply({ content: '📖 No active book.' });
    }
    const [book, marks] = await Promise.all([
      getBook(db, session.book_id),
      getBookmarks(db, interaction.user.id, session.book_id),
    ]);
    if (!marks.length) {
      return interaction.editReply({ content: '🔖 No bookmarks saved yet.' });
    }

    const embed = new EmbedBuilder()
      .setTitle(`🔖 Bookmarks — ${book?.title ?? 'Unknown'}`)
      .setColor(Colors.Gold)
      .addFields(
        marks.slice(0, 10).map((m, i) => ({
          name: `#${i + 1} — Chapter ${m.chapter_index + 1}`,
          value: `${m.note ? `*${m.note}*\n` : ''}${new Date(m.created_at).toLocaleDateString()}`,
          inline: true,
        }))
      );

    const jumpRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`audiobook:jumpbookmark:${interaction.guildId}`)
        .setPlaceholder('Jump to bookmark...')
        .addOptions(
          marks.slice(0, 25).map((m, i) => ({
            label: `#${i + 1} — Chapter ${m.chapter_index + 1}`,
            description: m.note?.slice(0, 50) ?? `Saved ${new Date(m.created_at).toLocaleDateString()}`,
            value: String(m.chapter_index),
          }))
        )
    );

    return interaction.editReply({ embeds: [embed], components: [jumpRow] });
  }, { label: "audiobook" });
}

// ── Button handler ─────────────────────────────────────────────────────────────

export async function handleButton(interaction) {
  const id = interaction.customId;
  if (!id.startsWith('audiobook:')) return false;

  const db = await getDb();
  const [, action, ...rest] = id.split(':');

  switch (action) {
    case 'pause': {
      await interaction.deferUpdate();
      const player = getPlayer(interaction.guildId);
      if (player?.state === PlayerState.PLAYING) {
        player.pause();
        await updateSession(db, (await getSession(db, interaction.user.id, interaction.guildId))?.id, { state: PlayerState.PAUSED });
      }
      const progress = player?.getProgress();
      await interaction.editReply({
        embeds: [buildNowReadingEmbed(progress)],
        components: [buildControlRow(interaction.guildId)],
      }).catch(() => {});
      return true;
    }
    case 'resume': {
      await interaction.deferUpdate();
      const player = getPlayer(interaction.guildId);
      if (player?.state === PlayerState.PAUSED) {
        player.resume();
        await updateSession(db, (await getSession(db, interaction.user.id, interaction.guildId))?.id, { state: PlayerState.PLAYING });
      }
      const progress = player?.getProgress();
      await interaction.editReply({
        embeds: [buildNowReadingEmbed(progress)],
        components: [buildControlRow(interaction.guildId)],
      }).catch(() => {});
      return true;
    }
    case 'skip': {
      await interaction.deferUpdate();
      const player = getPlayer(interaction.guildId);
      if (player) await player.skipChapter();
      const progress = player?.getProgress();
      await interaction.editReply({
        embeds: [buildNowReadingEmbed(progress)],
        components: [buildControlRow(interaction.guildId)],
      }).catch(() => {});
      return true;
    }
    case 'restart': {
      await interaction.deferUpdate();
      const player = getPlayer(interaction.guildId);
      if (player) await player.restartChapter();
      return true;
    }
    case 'stop': {
      await interaction.deferUpdate();
      const player = getPlayer(interaction.guildId);
      player?.destroy();
      destroyPlayer(interaction.guildId);
      const session = await getSession(db, interaction.user.id, interaction.guildId);
      if (session) await updateSession(db, session.id, { state: PlayerState.IDLE });
      await interaction.editReply({ content: '🏁 Stopped.', embeds: [], components: [] }).catch(() => {});
      return true;
    }
    case 'closedrop': {
      // Close the drop thread
      await interaction.deferUpdate();
      const thread = interaction.channel;
      if (thread?.isThread()) {
        audiobookThreads.delete(thread.id);
        await thread.setArchived(true, 'User closed audiobook drop thread').catch(() => {});
      }
      return true;
    }
    case 'voicecatalog': {
      // Browse full voice catalog paginated
      await interaction.deferUpdate();
      const page = parseInt(rest[1] ?? '0', 10);
      await sendVoiceCatalogPage(interaction, db, page);
      return true;
    }
    case 'deletebook': {
      await interaction.deferUpdate();
      const bookId = rest[0];
      await deleteBook(db, bookId, interaction.user.id);
      const session = await getSession(db, interaction.user.id, interaction.guildId);
      if (session?.book_id === bookId) {
        await updateSession(db, session.id, { book_id: null, state: PlayerState.IDLE });
      }
      await interaction.followUp({ content: '🗑️ Book deleted.', ephemeral: true }).catch(() => {});
      return true;
    }
    default:
      return false;
  }
}

// ── Select handler ─────────────────────────────────────────────────────────────

export async function handleSelect(interaction) {
  const id = interaction.customId;
  if (!id.startsWith('audiobook:')) return false;

  const db = await getDb();
  const [, action, guildId] = id.split(':');

  switch (action) {
    case 'voicepreset': {
      await interaction.deferUpdate();
      const preset  = interaction.values[0];
      const voice   = VOICE_PRESETS[preset];
      if (!voice) return true;
      await saveVoicePrefs(db, interaction.user.id, { voiceId: voice.id, speed: 1.0, preset });
      // Update live player if running
      const player = getPlayer(interaction.guildId);
      if (player?.session) player.session.voice_id = preset;
      await interaction.followUp({
        content: `${voice.label} voice selected — **${voice.id}**\n> ${voice.desc}`,
        ephemeral: true,
      }).catch(() => {});
      return true;
    }
    case 'selectbook': {
      await interaction.deferUpdate();
      const bookId  = interaction.values[0];
      const session = await getOrCreateSession(db, interaction.user.id, interaction.guildId);
      await updateSession(db, session.id, { book_id: bookId, current_chapter: 0, state: PlayerState.IDLE });
      const book = await getBook(db, bookId);
      await interaction.followUp({
        content: `📖 Switched to **${book?.title ?? bookId}** — use **/audiobook play** to start reading.`,
        ephemeral: true,
      }).catch(() => {});
      return true;
    }
    case 'jumpbookmark': {
      await interaction.deferUpdate();
      const chapterIndex = parseInt(interaction.values[0], 10);
      const player = getPlayer(interaction.guildId);
      if (player) {
        await player.seekChapter(chapterIndex);
      } else {
        const session = await getSession(db, interaction.user.id, interaction.guildId);
        if (session) await updateSession(db, session.id, { current_chapter: chapterIndex });
      }
      await interaction.followUp({ content: `🔖 Jumped to chapter ${chapterIndex + 1}.`, ephemeral: true }).catch(() => {});
      return true;
    }
    default:
      return false;
  }
}

// ── Message ingest (drop in private thread) ───────────────────────────────────

export async function maybeHandleAudiobookMessage(message) {
  const binding = audiobookThreads.get(message.channelId);
  if (!binding) return;
  if (message.author.id !== binding.userId) return; // only owner can drop files
  if (!message.attachments?.size) return;

  const db = await getDb();

  for (const att of message.attachments.values()) {
    const ext = att.name?.toLowerCase().match(/\.(txt|md|pdf|docx|epub)$/)?.[0];
    if (!ext) {
      await message.react('❓').catch(() => {});
      continue;
    }
    if (att.size > MAX_FILE_SIZE) {
      await message.react('🚫').catch(() => {});
      await message.reply({ content: `❌ **${att.name}** exceeds the ${MAX_FILE_SIZE / 1024 / 1024}MB limit.` }).catch(() => {});
      continue;
    }

    await message.react('⏳').catch(() => {});
    try {
      const buf      = Buffer.from(await (await fetch(att.url)).arrayBuffer());
      const parsed   = await parseFile(buf, att.name);
      const totalWords = parsed.chapters.reduce((s, c) => s + c.wordCount, 0);

      const bookId = await createBook(db, {
        userId:        message.author.id,
        guildId:       message.guildId,
        title:         parsed.title,
        author:        parsed.author,
        format:        ext.slice(1),
        totalChapters: parsed.chapters.length,
        totalWords,
        fileSize:      att.size,
      });
      await insertChapters(db, bookId, parsed.chapters);

      // Auto-select this book for the session
      const session = await getOrCreateSession(db, message.author.id, message.guildId);
      await updateSession(db, session.id, { book_id: bookId, current_chapter: 0, state: PlayerState.IDLE });
      binding.bookId = bookId;

      await message.reactions.cache.get('⏳')?.remove().catch(() => {});
      await message.react('✅').catch(() => {});
      await message.reply({
        embeds: [buildIngestionEmbed(parsed, bookId, totalWords, att.name)],
        components: [buildPlayNowRow(message.guildId)],
      }).catch(() => {});
    } catch (err) {
      await message.reactions.cache.get('⏳')?.remove().catch(() => {});
      await message.react('❌').catch(() => {});
      await message.reply({ content: `❌ Could not parse **${att.name}**: ${err.message}` }).catch(() => {});
    }
  }
}

// ── Voice catalog pagination ──────────────────────────────────────────────────

async function sendVoiceCatalogPage(interaction, db, page = 0) {
  const allVoices = await getVoices();
  const enVoices  = allVoices.filter(v => v.Locale?.startsWith('en'));
  const PAGE_SIZE = 10;
  const total     = enVoices.length;
  const start     = page * PAGE_SIZE;
  const slice     = enVoices.slice(start, start + PAGE_SIZE);

  if (!slice.length) return;

  const embed = new EmbedBuilder()
    .setTitle('🌍 Voice Catalog (English)')
    .setDescription(`Showing ${start + 1}–${Math.min(start + PAGE_SIZE, total)} of ${total} voices`)
    .setColor(Colors.Blurple)
    .addFields(
      slice.map(v => ({
        name: v.FriendlyName ?? v.ShortName,
        value: `\`${v.ShortName}\` · ${v.Gender} · ${v.Locale}`,
        inline: true,
      }))
    );

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`audiobook:voicepreset:${interaction.guildId}`)
      .setPlaceholder('Select a voice from this page...')
      .addOptions(
        slice.map(v => ({
          label: (v.FriendlyName ?? v.ShortName).slice(0, 50),
          description: `${v.Gender} · ${v.Locale}`,
          value: v.ShortName,
        }))
      )
  );

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`audiobook:voicecatalog:${interaction.guildId}:${Math.max(0, page - 1)}`)
      .setLabel('◀ Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`audiobook:voicecatalog:${interaction.guildId}:${page + 1}`)
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(start + PAGE_SIZE >= total),
  );

  await interaction.editReply({ embeds: [embed], components: [selectRow, navRow] }).catch(() => {});
}

// ── Embed builders ─────────────────────────────────────────────────────────────

function buildDropPanelEmbed(user) {
  return new EmbedBuilder()
    .setTitle('📖 Audiobook Drop Zone')
    .setDescription(
      `**Welcome, ${user.displayName}!**\n\n` +
      'Drop your book files directly into this thread and I\'ll parse them automatically.\n\n' +
      `**Supported formats:**\n${SUPPORTED_EXTS.map(e => `\`${e}\``).join(' · ')}\n\n` +
      `**Max file size:** ${MAX_FILE_SIZE / 1024 / 1024} MB\n\n` +
      '> Once uploaded, use **/audiobook play** in any channel to start listening in your voice channel.\n\n' +
      '> Close this thread with the button below when you\'re done.'
    )
    .setColor(Colors.DarkGold)
    .setFooter({ text: 'Chopsticks Audiobook · Powered by Microsoft Edge TTS' });
}

function buildDropPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('audiobook:closedrop')
      .setLabel('Close Thread')
      .setEmoji('🏁')
      .setStyle(ButtonStyle.Danger),
  );
}

function buildIngestionEmbed(parsed, bookId, totalWords, filename) {
  const eta = Math.ceil(totalWords / 150); // 150 WPM
  return new EmbedBuilder()
    .setTitle(`📚 ${parsed.title}`)
    .setDescription(parsed.author ? `*by ${parsed.author}*` : `Uploaded from \`${filename}\``)
    .setColor(Colors.Green)
    .addFields(
      { name: 'Chapters', value: String(parsed.chapters.length), inline: true },
      { name: 'Words', value: `~${Math.round(totalWords / 1000)}k`, inline: true },
      { name: 'Est. Listen Time', value: `~${Math.round(eta / 60)}h ${eta % 60}m @ 1×`, inline: true },
      { name: 'Chapter Preview', value: parsed.chapters.slice(0, 3).map((c, i) => `${i + 1}. ${c.title}`).join('\n'), inline: false },
    )
    .setFooter({ text: `Book ID: ${bookId}` });
}

function buildNowReadingEmbed(progress) {
  if (!progress) {
    return new EmbedBuilder()
      .setTitle('📖 No book loaded')
      .setDescription('Use **/audiobook library** to select a book.')
      .setColor(Colors.Grey);
  }
  const stateEmoji = { playing: '▶️', paused: '⏸', loading: '⏳', done: '✅', idle: '💤' }[progress.state] ?? '❓';
  return new EmbedBuilder()
    .setTitle(`${stateEmoji} ${progress.bookTitle}`)
    .setDescription(`**${progress.chapterTitle}**\nChapter ${progress.chapterIndex + 1} of ${progress.totalChapters}`)
    .setColor(Colors.DarkGold)
    .addFields(
      { name: 'Progress', value: `\`${progress.bar}\``, inline: false },
      { name: 'ETA', value: progress.etaMin > 0 ? `~${progress.etaMin}m remaining` : 'Almost done!', inline: true },
    );
}

function buildControlRow(guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`audiobook:pause:${guildId}`).setEmoji('⏸').setStyle(ButtonStyle.Secondary).setLabel('Pause'),
    new ButtonBuilder().setCustomId(`audiobook:resume:${guildId}`).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setLabel('Resume'),
    new ButtonBuilder().setCustomId(`audiobook:skip:${guildId}`).setEmoji('⏭').setStyle(ButtonStyle.Secondary).setLabel('Skip Chapter'),
    new ButtonBuilder().setCustomId(`audiobook:restart:${guildId}`).setEmoji('🔁').setStyle(ButtonStyle.Secondary).setLabel('Restart'),
    new ButtonBuilder().setCustomId(`audiobook:stop:${guildId}`).setEmoji('🏁').setStyle(ButtonStyle.Danger).setLabel('Stop'),
  );
}

function buildPlayNowRow(guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`audiobook:playnow:${guildId}`)
      .setLabel('Play Now')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`audiobook:closedrop`)
      .setLabel('Close Thread')
      .setEmoji('🏁')
      .setStyle(ButtonStyle.Secondary),
  );
}

// ── Thread creation ───────────────────────────────────────────────────────────

async function tryCreateAudiobookThread(interaction) {
  const { channel, guild, user } = interaction;
  if (!channel || !guild) return null;
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) return null;

  const botPerms = channel.permissionsFor(guild.members.me);
  if (botPerms?.has(PermissionFlagsBits.CreatePrivateThreads) && botPerms?.has(PermissionFlagsBits.SendMessagesInThreads)) {
    try {
      const thread = await channel.threads.create({
        name: `${user.username}-audiobook`.slice(0, 60),
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: 'Chopsticks audiobook drop thread',
      });
      await thread.members.add(user.id).catch(() => {});
      return thread;
    } catch {}
  }
  // Fallback to public thread
  if (botPerms?.has(PermissionFlagsBits.CreatePublicThreads) && botPerms?.has(PermissionFlagsBits.SendMessagesInThreads)) {
    try {
      const thread = await channel.threads.create({
        name: `${user.username}-audiobook`.slice(0, 60),
        type: ChannelType.PublicThread,
        reason: 'Chopsticks audiobook drop thread (public fallback)',
      });
      await thread.members.add(user.id).catch(() => {});
      return thread;
    } catch {}
  }
  return null;
}

// ── DB helper ─────────────────────────────────────────────────────────────────

async function getDb() {
  const { getPool } = await import('../utils/storage_pg.js');
  return getPool();
}

// ── Misc helpers ──────────────────────────────────────────────────────────────

function formatIcon(fmt) {
  const icons = { txt: '📄', md: '📝', pdf: '📕', docx: '📘', epub: '📗' };
  return icons[fmt] ?? '📄';
}

function buildMiniBar(pct) {
  const f = Math.round(pct / 10);
  return '▓'.repeat(f) + '░'.repeat(10 - f) + ` ${pct}%`;
}
