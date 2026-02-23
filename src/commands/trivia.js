import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} from "discord.js";

import { Colors, replyError } from "../utils/discordOutput.js";
import { pickTriviaQuestion, listTriviaCategories } from "../game/trivia/bank.js";
import { makeTriviaSessionId, shuffleChoices, pickAgentAnswer, agentDelayRangeMs, computeReward, formatDifficulty } from "../game/trivia/engine.js";
import { pickDmIntro, pickAgentThinkingLine, pickAgentResultLine } from "../game/trivia/narration.js";
import {
  getActiveTriviaSessionId,
  setActiveTriviaSessionId,
  clearActiveTriviaSessionId,
  loadTriviaSession,
  saveTriviaSession,
  deleteTriviaSession
} from "../game/trivia/session.js";
import { addCredits } from "../economy/wallet.js";
import { addGameXp } from "../game/profile.js";
import { recordQuestEvent } from "../game/quests.js";
import { withTimeout } from "../utils/interactionTimeout.js";

const SESSION_TTL_SECONDS = 15 * 60;
const QUESTION_TIME_LIMIT_MS = 30_000;
const LOBBY_TIMEOUT_MS = 2 * 60 * 1000;
const COUNTDOWN_SECONDS = 3;
const AGENT_MIN_THINK_MS = 3_000;
const MAX_FLEET_OPPONENTS = 6;
const MIN_FLEET_OPPONENTS = 2;
const LETTERS = ["A", "B", "C", "D", "E", "F"];
const DIFFICULTY_CHOICES = ["easy", "normal", "hard", "nightmare"];
const MODE_SOLO = "solo";
const MODE_PVP = "pvp";
const MODE_DUEL = "duel";
const MODE_FLEET = "fleet";

function isSolo(session) {
  return String(session?.mode || "").toLowerCase() === MODE_SOLO;
}

function isPvp(session) {
  return String(session?.mode || "").toLowerCase() === MODE_PVP && Boolean(session?.opponentUserId);
}

function isAgentMatch(session) {
  const m = String(session?.mode || "").toLowerCase();
  return m === MODE_DUEL || m === MODE_FLEET;
}

function canUseMatchUi(session, userId) {
  const uid = String(userId || "");
  if (!uid) return false;
  if (uid === String(session?.userId || "")) return true;
  if (isPvp(session) && uid === String(session?.opponentUserId || "")) return true;
  return false;
}

function formatAgentTextError(reasonOrErr) {
  const msg = String(reasonOrErr?.message ?? reasonOrErr);
  if (msg === "no-agents-in-guild") {
    return "❌ No agents deployed in this guild.\n💡 Fix: `/agents deploy 5`";
  }
  if (msg === "no-free-agents") {
    return "⏳ All agents are currently busy.\n💡 Try again in a few seconds or deploy more agents with `/agents deploy <count>`.";
  }
  if (msg === "agents-not-ready") return "⏳ Agents are starting up. Try again in 10-15 seconds.";
  if (msg === "agent-offline") return "❌ Agent disconnected. Try again.";
  if (msg === "agent-timeout") return "⏱️ Agent timed out. Try again.";
  return "❌ Trivia failed.";
}

function clampOpponents(value, fallback = 1) {
  const direct = Number(value);
  const fb = Number(fallback);
  const raw = Number.isFinite(direct) ? direct : (Number.isFinite(fb) ? fb : 1);
  return Math.max(1, Math.min(MAX_FLEET_OPPONENTS, Math.trunc(raw)));
}

function normalizeAgentTag(tag, agentId, slot) {
  const clean = String(tag || "").trim();
  if (clean) return clean;
  if (agentId) return `Agent ${agentId}`;
  return `Agent ${slot}`;
}

function normalizeSession(session) {
  if (!session || typeof session !== "object") return null;
  if (!Array.isArray(session.agents) || !session.agents.length) {
    const hasLegacyAgent =
      Boolean(session.agentId || session.agentTag || session.agentKind || session.agentUserId) ||
      session.agentPick !== undefined ||
      session.agentLockedAt !== undefined ||
      session.agentDueAt !== undefined;
    if (hasLegacyAgent) {
      const legacyAgent = {
        slot: 1,
        kind: String(session.agentKind || "trivia"),
        agentId: session.agentId || null,
        agentTag: normalizeAgentTag(session.agentTag, session.agentId, 1),
        agentUserId: String(session.agentUserId || "").trim() || null,
        pick: session.agentPick === null || session.agentPick === undefined ? null : Math.max(0, Math.min(5, Math.trunc(Number(session.agentPick)))),
        lockedAt: session.agentLockedAt ? Number(session.agentLockedAt) : null,
        dueAt: session.agentDueAt ? Number(session.agentDueAt) : null
      };
      session.agents = [legacyAgent];
      if (!Array.isArray(session.agentLeases) || !session.agentLeases.length) {
        session.agentLeases = [{ kind: legacyAgent.kind, agentId: legacyAgent.agentId }];
      }
    } else {
      session.agents = [];
      if (!Array.isArray(session.agentLeases)) session.agentLeases = [];
    }
  } else {
    session.agents = session.agents.map((a, idx) => ({
      slot: idx + 1,
      kind: String(a?.kind || `trivia:${idx + 1}`),
      agentId: a?.agentId || null,
      agentTag: normalizeAgentTag(a?.agentTag, a?.agentId, idx + 1),
      agentUserId: String(a?.agentUserId || "").trim() || null,
      pick: a?.pick === null || a?.pick === undefined ? null : Math.max(0, Math.min(5, Math.trunc(Number(a.pick)))),
      lockedAt: a?.lockedAt ? Number(a.lockedAt) : null,
      dueAt: a?.dueAt ? Number(a.dueAt) : null
    }));
  }

  const modeRaw = String(session.mode || "").toLowerCase();
  const knownModes = new Set(["duel", "fleet", "solo", "pvp"]);
  session.mode = knownModes.has(modeRaw)
    ? modeRaw
    : String(session.agents.length > 1 ? "fleet" : "duel");
  session.opponents = clampOpponents(session.opponents, session.agents.length);
  session.opponents = Math.max(session.opponents, session.agents.length);

  // PvP/Solo fields (harmless for agent matches).
  session.opponentUserId = String(session.opponentUserId || "").trim() || null;
  session.opponentPick = Number.isFinite(Number(session.opponentPick)) ? Math.max(0, Math.min(5, Math.trunc(Number(session.opponentPick)))) : null;
  session.opponentLockedAt = session.opponentLockedAt ? Number(session.opponentLockedAt) : null;
  session.acceptedAt = session.acceptedAt ? Number(session.acceptedAt) : null;
  session.forfeitedBy = String(session.forfeitedBy || "").trim() || null;

  const first = session.agents[0] || null;
  session.agentId = first?.agentId ?? null;
  session.agentTag = first?.agentTag ?? "Agent";
  session.agentUserId = first?.agentUserId ?? null;
  session.agentPick = first?.pick ?? null;
  session.agentLockedAt = first?.lockedAt ?? null;
  session.agentDueAt = first?.dueAt ?? null;
  session.agentKind = first?.kind ?? "trivia";

  if (!Array.isArray(session.agentLeases)) {
    session.agentLeases = first ? [{ kind: first.kind, agentId: first.agentId }] : [];
  }
  return session;
}

function allAgentsAnswered(session) {
  return (session.agents || []).every(a => a.pick !== null && a.pick !== undefined);
}

function earliestLockedAt(entries) {
  const vals = (entries || [])
    .map(e => Number(e?.lockedAt || 0))
    .filter(v => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  return vals[0] || 0;
}

function buildOpponentSummary(session) {
  if (isSolo(session)) return "None (solo)";
  if (isPvp(session)) return `<@${session.opponentUserId}>`;
  const agents = session.agents || [];
  if (!agents.length) {
    const planned = clampOpponents(session.opponents, 1);
    return `Planned opponents: ${planned} agent${planned === 1 ? "" : "s"} (assigned on Start)`;
  }
  if (agents.length === 1) return agents[0].agentTag;
  const lines = agents.slice(0, 6).map((a, idx) => `#${idx + 1} ${a.agentTag}`);
  if (agents.length > 6) lines.push(`…and ${agents.length - 6} more`);
  return lines.join("\n").slice(0, 1024);
}

function buildPicksSummary(session) {
  const lines = [];
  const yourPick = Number.isFinite(Number(session.userPick)) ? LETTERS[Number(session.userPick)] : null;
  const youLabel = isPvp(session) ? `<@${session.userId}>` : "You";
  lines.push(yourPick ? `${youLabel}: **${yourPick}**` : `${youLabel}: _not locked_`);

  if (isPvp(session)) {
    const oppPick = Number.isFinite(Number(session.opponentPick)) ? LETTERS[Number(session.opponentPick)] : null;
    lines.push(oppPick ? `<@${session.opponentUserId}>: **${oppPick}**` : `<@${session.opponentUserId}>: _not locked_`);
    return lines.join("\n").slice(0, 1024);
  }

  for (const a of session.agents || []) {
    const pick = Number.isFinite(Number(a.pick)) ? LETTERS[Number(a.pick)] : null;
    lines.push(pick ? `${a.agentTag}: **${pick}**` : `${a.agentTag}: _thinking_`);
    if (lines.join("\n").length > 900) {
      lines.push("…");
      break;
    }
  }
  return lines.join("\n").slice(0, 1024);
}

function buildQuestionEmbed({ session }) {
  const lines = (session.choices || []).map((c, idx) => `**${LETTERS[idx] || String(idx + 1)}.** ${c}`);
  const remainingSec = Math.max(0, Math.ceil((Number(session.expiresAt || 0) - Date.now()) / 1000));

  const modeText = isSolo(session)
    ? "Solo"
    : isPvp(session)
      ? "Versus"
      : session.agents.length > 1
        ? `Fleet (${session.agents.length})`
        : "Duel";

  const title = isSolo(session)
    ? "🧩 Trivia Solo"
    : isPvp(session)
      ? "🧩 Trivia Versus"
      : session.agents.length > 1
        ? "🧩 Trivia Fleet Match"
        : "🧩 Trivia Duel";

  const footerText = (() => {
    if (isPvp(session)) {
      const hostLocked = Boolean(session.userLockedAt);
      const oppLocked = Boolean(session.opponentLockedAt);
      if (hostLocked && oppLocked) return "Locked in. Revealing results…";
      if (hostLocked && !oppLocked) return `Waiting for <@${session.opponentUserId}> to lock in… Time left: ${remainingSec}s`;
      if (!hostLocked && oppLocked) return `Waiting for <@${session.userId}> to lock in… Time left: ${remainingSec}s`;
      return `Pick an answer, then Lock In. Time left: ${remainingSec}s`;
    }

    const locked = Boolean(session.userLockedAt);
    if (locked) {
      return isSolo(session)
        ? "Locked in. Revealing results…"
        : "Locked in. Waiting for opponent responses…";
    }
    return `Pick an answer, then Lock In. Time left: ${remainingSec}s`;
  })();

  const e = new EmbedBuilder()
    .setTitle(title)
    .setColor(Colors.INFO)
    .setDescription(pickDmIntro())
    .addFields(
      { name: "Category", value: String(session.category || "Any"), inline: true },
      { name: "Difficulty", value: formatDifficulty(session.difficulty), inline: true },
      { name: "Mode", value: modeText, inline: true },
      { name: "Opponents", value: buildOpponentSummary(session), inline: false },
      { name: "Question", value: String(session.prompt || "…"), inline: false },
      { name: "Choices", value: lines.join("\n").slice(0, 1024), inline: false }
    )
    .setFooter({
      text: footerText
    })
    .setTimestamp();

  e.addFields({
    name: "Picks",
    value: buildPicksSummary(session),
    inline: false
  });

  return e;
}

function buildAnswerComponents(sessionId, choicesLen, { disabled = false } = {}) {
  const options = LETTERS
    .slice(0, Math.max(2, Math.min(6, Math.trunc(Number(choicesLen) || 4))))
    .map((l, idx) => ({ label: l, value: String(idx) }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`trivia:sel:${sessionId}`)
    .setPlaceholder("Choose your answer…")
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(Boolean(disabled))
    .addOptions(options);

  const row1 = new ActionRowBuilder().addComponents(menu);

  const lockBtn = new ButtonBuilder()
    .setCustomId(`trivia:btn:${sessionId}:lock`)
    .setLabel("Lock In")
    .setStyle(ButtonStyle.Success)
    .setDisabled(Boolean(disabled));

  const statusBtn = new ButtonBuilder()
    .setCustomId(`trivia:btn:${sessionId}:status`)
    .setLabel("Status")
    .setStyle(ButtonStyle.Secondary);

  const forfeitBtn = new ButtonBuilder()
    .setCustomId(`trivia:btn:${sessionId}:forfeit`)
    .setLabel("Forfeit")
    .setStyle(ButtonStyle.Danger);

  const row2 = new ActionRowBuilder().addComponents(lockBtn, statusBtn, forfeitBtn);
  return [row1, row2];
}

function buildLobbyEmbed(session) {
  if (isSolo(session)) {
    const note = session.startNote ? `\n\n${session.startNote}` : "";
    return new EmbedBuilder()
      .setTitle("🧩 Trivia: Solo Ready")
      .setColor(Colors.INFO)
      .setDescription(
        `${pickDmIntro()}\n\n` +
        `**Mode:** Solo\n` +
        `**Difficulty:** ${formatDifficulty(session.difficulty)}\n` +
        `**Category:** ${String(session.category || "Any")}\n\n` +
        `Select options below, then press **Start**.${note}`
      )
      .addFields({ name: "Opponents", value: "None", inline: false })
      .setFooter({ text: "This lobby expires if you don't start." })
      .setTimestamp();
  }

  if (isPvp(session)) {
    const accepted = Boolean(session.acceptedAt);
    const note = session.startNote ? `\n\n${session.startNote}` : "";
    return new EmbedBuilder()
      .setTitle("🧩 Trivia: Challenge")
      .setColor(Colors.INFO)
      .setDescription(
        `${pickDmIntro()}\n\n` +
        `**Mode:** Versus\n` +
        `**Host:** <@${session.userId}>\n` +
        `**Opponent:** <@${session.opponentUserId}>\n` +
        `**Status:** ${accepted ? "✅ Accepted" : "⏳ Waiting for opponent"}\n\n` +
        `Host can configure options below.${note}`
      )
      .addFields(
        { name: "Difficulty", value: formatDifficulty(session.difficulty), inline: true },
        { name: "Category", value: String(session.category || "Any"), inline: true }
      )
      .setFooter({ text: "This lobby expires if you don't start." })
      .setTimestamp();
  }

  const configuredOpponents = clampOpponents(session.opponents, 1);
  const modeLine = configuredOpponents > 1 ? `Fleet (${configuredOpponents} agents)` : "Duel (1 agent)";
  const note = session.startNote ? `\n\n${session.startNote}` : "";
  return new EmbedBuilder()
    .setTitle("🧩 Trivia: Ready Check")
    .setColor(Colors.INFO)
    .setDescription(
      `${pickDmIntro()}\n\n` +
      `**Mode:** ${modeLine}\n` +
      `**Difficulty:** ${formatDifficulty(session.difficulty)}\n` +
      `**Category:** ${String(session.category || "Any")}\n\n` +
      `Select options below, then press **Start**.${note}`
    )
    .addFields({ name: "Opponents", value: buildOpponentSummary(session), inline: false })
    .setFooter({ text: "This lobby expires if you don't start." })
    .setTimestamp();
}

function buildDifficultyMenuOptions(selected) {
  const current = String(selected || "normal").toLowerCase();
  return DIFFICULTY_CHOICES.map(v => ({
    label: formatDifficulty(v),
    value: v,
    default: v === current
  }));
}

function buildOpponentsMenuOptions(selected) {
  const current = clampOpponents(selected, 1);
  const out = [];
  for (let i = 1; i <= MAX_FLEET_OPPONENTS; i += 1) {
    out.push({
      label: i === 1 ? "1 (Duel)" : `${i} (Fleet)`,
      value: String(i),
      default: i === current
    });
  }
  return out;
}

function buildCategoryMenuOptions(selected) {
  const selectedVal = String(selected || "Any");
  const categoriesRaw = listTriviaCategories()
    .filter(Boolean)
    .map(c => String(c).trim())
    .filter(c => c.length)
    .filter(c => c.toLowerCase() !== "any")
    .sort((a, b) => a.localeCompare(b));

  const categories = [];
  const seen = new Set();
  for (const c of categoriesRaw) {
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    categories.push(c);
    if (categories.length >= 24) break;
  }

  const base = [{ label: "Any", value: "Any", default: selectedVal === "Any" }];
  for (const c of categories) {
    base.push({ label: c.slice(0, 100), value: c, default: c === selectedVal });
  }
  if (!base.some(o => o.value === selectedVal) && selectedVal !== "Any") {
    if (base.length >= 25) base.pop();
    base.push({ label: selectedVal.slice(0, 100), value: selectedVal, default: true });
  }
  if (!base.some(o => o.default)) {
    const any = base.find(o => o.value === "Any");
    if (any) any.default = true;
  }
  return base.slice(0, 25);
}

function buildLobbyComponents(sessionId, session, { disabled = false } = {}) {
  const difficultyMenu = new StringSelectMenuBuilder()
    .setCustomId(`trivia:cfg:${sessionId}:difficulty`)
    .setPlaceholder("Difficulty")
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(Boolean(disabled))
    .addOptions(buildDifficultyMenuOptions(session?.difficulty));

  const categoryMenu = new StringSelectMenuBuilder()
    .setCustomId(`trivia:cfg:${sessionId}:category`)
    .setPlaceholder("Category")
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(Boolean(disabled))
    .addOptions(buildCategoryMenuOptions(session?.category));

  const includeOpponentsMenu = !(isSolo(session) || isPvp(session));
  const opponentsMenu = includeOpponentsMenu
    ? new StringSelectMenuBuilder()
      .setCustomId(`trivia:cfg:${sessionId}:opponents`)
      .setPlaceholder("Opponents")
      .setMinValues(1)
      .setMaxValues(1)
      .setDisabled(Boolean(disabled))
      .addOptions(buildOpponentsMenuOptions(session?.opponents))
    : null;

  const startBtn = new ButtonBuilder()
    .setCustomId(`trivia:btn:${sessionId}:start`)
    .setLabel("Start")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(Boolean(disabled) || (isPvp(session) && !session?.acceptedAt));

  const rulesBtn = new ButtonBuilder()
    .setCustomId(`trivia:btn:${sessionId}:rules`)
    .setLabel("Rules")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(Boolean(disabled));

  const statusBtn = new ButtonBuilder()
    .setCustomId(`trivia:btn:${sessionId}:status`)
    .setLabel("Status")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(Boolean(disabled));

  const forfeitBtn = new ButtonBuilder()
    .setCustomId(`trivia:btn:${sessionId}:forfeit`)
    .setLabel(isPvp(session) ? "Cancel / Forfeit" : "Cancel")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(Boolean(disabled));

  const rows = [
    new ActionRowBuilder().addComponents(difficultyMenu),
    new ActionRowBuilder().addComponents(categoryMenu)
  ];

  if (opponentsMenu) rows.push(new ActionRowBuilder().addComponents(opponentsMenu));

  if (isPvp(session)) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`trivia:btn:${sessionId}:accept`)
          .setLabel("Accept")
          .setStyle(ButtonStyle.Success)
          .setDisabled(Boolean(disabled) || Boolean(session?.acceptedAt)),
        new ButtonBuilder()
          .setCustomId(`trivia:btn:${sessionId}:decline`)
          .setLabel("Decline")
          .setStyle(ButtonStyle.Danger)
          .setDisabled(Boolean(disabled) || Boolean(session?.acceptedAt))
      )
    );
  }

  rows.push(new ActionRowBuilder().addComponents(startBtn, rulesBtn, statusBtn, forfeitBtn));
  return rows;
}

async function sendViaAgent({ agent, guildId, channelId, actorUserId, content, embeds }) {
  const mgr = global.agentManager;
  if (!mgr) throw new Error("agents-not-ready");
  return await mgr.request(agent, "discordSend", {
    guildId,
    textChannelId: channelId,
    actorUserId,
    content,
    embeds
  });
}

async function getSessionMessage(client, session) {
  const channel = await client.channels.fetch(session.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return { channel: null, msg: null };
  const msg = session.messageId ? await channel.messages.fetch(session.messageId).catch(() => null) : null;
  return { channel, msg };
}

function buildStatusEmbed(session) {
  const configuredOpponents = getConfiguredOpponents(session);
  const modeText = isSolo(session)
    ? "Solo"
    : isPvp(session)
      ? "Versus"
      : configuredOpponents > 1
        ? `Fleet (${configuredOpponents})`
        : "Duel";
  const stage = String(session.stage || "lobby");
  const picks = [];
  if (isPvp(session)) {
    const hostPick = Number.isFinite(Number(session.userPick)) ? LETTERS[Number(session.userPick)] : "not selected";
    const oppPick = Number.isFinite(Number(session.opponentPick)) ? LETTERS[Number(session.opponentPick)] : "not selected";
    picks.push(`<@${session.userId}>: ${hostPick}`);
    picks.push(`<@${session.opponentUserId}>: ${oppPick}`);
  } else {
    picks.push(Number.isFinite(Number(session.userPick)) ? `You: ${LETTERS[Number(session.userPick)]}` : "You: not selected");
    if (isSolo(session)) {
      // no-op
    } else if (!(session.agents || []).length) {
      picks.push("Opponents: assigned on Start");
    } else {
      for (const a of session.agents.slice(0, 8)) {
        const pick = Number.isFinite(Number(a.pick)) ? LETTERS[Number(a.pick)] : "thinking";
        picks.push(`${a.agentTag}: ${pick}`);
      }
      if ((session.agents || []).length > 8) picks.push(`...and ${(session.agents || []).length - 8} more`);
    }
  }

  const e = new EmbedBuilder()
    .setTitle("Trivia Status")
    .setColor(Colors.INFO)
    .addFields(
      { name: "Mode", value: modeText, inline: true },
      { name: "Stage", value: stage, inline: true },
      { name: "Difficulty", value: formatDifficulty(session.difficulty), inline: true },
      { name: "Category", value: String(session.category || "Any"), inline: true },
      { name: "Opponents", value: isSolo(session) ? "0" : isPvp(session) ? "1" : String(configuredOpponents), inline: true },
      { name: "Session", value: String(session.sessionId || "unknown"), inline: true },
      { name: "Picks", value: picks.join("\n").slice(0, 1024), inline: false }
    )
    .setTimestamp();

  if (stage === "question") {
    const left = Math.max(0, Math.ceil((Number(session.expiresAt || 0) - Date.now()) / 1000));
    e.addFields({ name: "Time Left", value: `${left}s`, inline: true });
  }
  return e;
}

function buildRulesEmbed() {
  return new EmbedBuilder()
    .setTitle("Trivia Guide")
    .setColor(Colors.INFO)
    .setDescription("Quick setup and flow for this match.")
    .addFields(
      {
        name: "Start Match",
        value: [
          "1. Choose Difficulty, Category, and Opponents.",
          "2. Press Start.",
          "3. Wait for the question to appear."
        ].join("\n"),
        inline: false
      },
      {
        name: "During Question",
        value: [
          "1. Pick an answer from the dropdown.",
          "2. Press Lock In before time runs out.",
          "3. Use Status anytime to check progress."
        ].join("\n"),
        inline: false
      },
      {
        name: "Modes",
        value: [
          "Solo: practice (no opponents).",
          "Versus: challenge another player.",
          "Duel: 1 agent opponent.",
          "Fleet: 2-6 agent opponents."
        ].join("\n"),
        inline: true
      },
      {
        name: "Rewards",
        value: [
          "Wins give higher rewards.",
          "Losses still grant some XP."
        ].join("\n"),
        inline: true
      }
    )
    .setFooter({ text: "Tip: Tune category + difficulty before starting." })
    .setTimestamp();
}

function getConfiguredOpponents(session) {
  if (isSolo(session)) return 0;
  if (isPvp(session)) return 1;
  const base = clampOpponents(session?.opponents, 1);
  if (String(session?.mode || "").toLowerCase() === "fleet") return Math.max(MIN_FLEET_OPPONENTS, base);
  return base;
}

function releaseTriviaLeases(mgr, session) {
  if (!mgr || !session) return;
  const kinds = new Set();
  for (const l of session.agentLeases || []) {
    if (l?.kind) kinds.add(String(l.kind));
  }
  if (session.agentKind) kinds.add(String(session.agentKind));
  if (!kinds.size) return;
  for (const kind of kinds) {
    try {
      mgr.releaseTextSession(session.guildId, session.channelId, { ownerUserId: session.userId, kind });
    } catch {}
  }
}

async function prepareSessionForMatch(session) {
  const mgr = global.agentManager;
  if (!mgr) return { ok: false, reason: "agents-not-ready" };

  const requestedOpponents = getConfiguredOpponents(session);
  const q = pickTriviaQuestion({ difficulty: session.difficulty, category: session.category });
  if (!q) return { ok: false, reason: "no-questions" };
  const { shuffled, correctIndex } = shuffleChoices(q.choices, q.answerIndex);

  const acquired = await acquireTriviaAgents(mgr, {
    guildId: session.guildId,
    channelId: session.channelId,
    userId: session.userId,
    requestedOpponents,
    sessionId: session.sessionId
  });
  if (!acquired.ok) return { ok: false, reason: acquired.reason };

  const agents = acquired.leases.map((l, idx) => ({
    slot: idx + 1,
    kind: l.kind,
    agentId: l.agent.agentId,
    agentTag: normalizeAgentTag(l.agent.tag, l.agent.agentId, idx + 1),
    agentUserId: String(l.agent.botUserId || "").trim() || null,
    pick: null,
    lockedAt: null,
    dueAt: null
  }));

  session.prompt = q.prompt;
  session.explanation = q.explanation || null;
  session.category = q.category || session.category || "Any";
  session.choices = shuffled.slice(0, 4);
  session.correctIndex = correctIndex;
  session.mode = agents.length > 1 ? "fleet" : "duel";
  session.opponents = requestedOpponents;
  session.agents = agents;
  session.agentLeases = acquired.leases.map(l => ({ kind: l.kind, agentId: l.agent.agentId }));
  session.startNote = acquired.partial
    ? `⚠️ Requested ${acquired.requested} opponents, started with ${acquired.actual} (available now).`
    : null;

  normalizeSession(session);
  return { ok: true };
}

function prepareSessionForNonAgentMatch(session) {
  const q = pickTriviaQuestion({ difficulty: session.difficulty, category: session.category });
  if (!q) return { ok: false, reason: "no-questions" };
  const { shuffled, correctIndex } = shuffleChoices(q.choices, q.answerIndex);

  session.prompt = q.prompt;
  session.explanation = q.explanation || null;
  session.category = q.category || session.category || "Any";
  session.choices = shuffled.slice(0, 4);
  session.correctIndex = correctIndex;

  // Ensure agent-related state can't leak into solo/pvp sessions.
  session.agents = [];
  session.agentLeases = [];
  session.agentPick = null;
  session.agentLockedAt = null;
  session.agentDueAt = null;

  // Ensure player picks are reset.
  session.userPick = null;
  session.userLockedAt = null;
  if (isPvp(session)) {
    session.opponentPick = null;
    session.opponentLockedAt = null;
  }

  normalizeSession(session);
  return { ok: true };
}

async function showQuestion(client, sessionId) {
  const rawSession = await loadTriviaSession(sessionId);
  const session = normalizeSession(rawSession);
  if (!session || session.endedAt) return false;

  const revealedAt = Date.now();
  session.stage = "question";
  session.revealedAt = revealedAt;
  session.expiresAt = revealedAt + QUESTION_TIME_LIMIT_MS;

  if (isAgentMatch(session)) {
    const [minDelay, maxDelay] = agentDelayRangeMs(session.difficulty);
    for (const a of session.agents || []) {
      const rnd = Math.floor(minDelay + Math.random() * Math.max(1, maxDelay - minDelay));
      a.dueAt = revealedAt + Math.max(AGENT_MIN_THINK_MS, rnd);
    }
  }
  normalizeSession(session);
  await saveTriviaSession(sessionId, session, SESSION_TTL_SECONDS);

  const embed = buildQuestionEmbed({ session });
  const { msg } = await getSessionMessage(client, session);
  if (msg) {
    await msg.edit({
      embeds: [embed],
      components: buildAnswerComponents(sessionId, session.choices?.length || 4, { disabled: false })
    }).catch(() => {});
  }

  if (isAgentMatch(session)) {
    // Best-effort: first few agents publish a thinking line.
    for (const a of (session.agents || []).slice(0, 3)) {
      try {
        const mgr = global.agentManager;
        const agent = mgr?.liveAgents?.get?.(a.agentId) || null;
        if (agent?.ready) {
          await sendViaAgent({
            agent,
            guildId: session.guildId,
            channelId: session.channelId,
            actorUserId: session.userId,
            content: pickAgentThinkingLine(a.agentTag)
          });
        }
      } catch {}
    }

    for (const a of session.agents || []) {
      const dueAt = Number(a.dueAt || 0);
      setTimeout(() => {
        maybeRunAgentAnswer(client, sessionId, { slot: a.slot }).catch(() => {});
      }, Math.max(50, dueAt - Date.now()));
    }
  }

  setTimeout(() => {
    (async () => {
      const s = normalizeSession(await loadTriviaSession(sessionId));
      if (!s || s.endedAt) return;
      if (isPvp(s)) {
        if (!s.userLockedAt) {
          s.userLockedAt = Date.now();
          if (s.userPick === undefined) s.userPick = null;
        }
        if (!s.opponentLockedAt) {
          s.opponentLockedAt = Date.now();
          if (s.opponentPick === undefined) s.opponentPick = null;
        }
        await saveTriviaSession(sessionId, s, SESSION_TTL_SECONDS);
        await finalizeSession(client, sessionId, { reason: "timeout" });
        return;
      }

      if (isSolo(s)) {
        if (!s.userLockedAt) {
          s.userLockedAt = Date.now();
          s.userPick = s.userPick ?? null;
          await saveTriviaSession(sessionId, s, SESSION_TTL_SECONDS);
        }
        await finalizeSession(client, sessionId, { reason: "timeout" });
        return;
      }

      // Agent match timeout.
      if (!s.userLockedAt) {
        s.userLockedAt = Date.now();
        s.userPick = null;
        await saveTriviaSession(sessionId, s, SESSION_TTL_SECONDS);
      }
      await maybeRunAgentAnswer(client, sessionId, { force: true });
      await finalizeSession(client, sessionId, { reason: "timeout" });
    })().catch(() => {});
  }, Math.max(1_000, session.expiresAt - Date.now() + 250));

  return true;
}

async function runCountdown(client, sessionId) {
  for (let i = COUNTDOWN_SECONDS; i >= 1; i -= 1) {
    const session = normalizeSession(await loadTriviaSession(sessionId));
    if (!session || session.endedAt) return false;

    const e = new EmbedBuilder()
      .setTitle("⏳ Starting…")
      .setColor(Colors.INFO)
      .setDescription(`Question reveals in **${i}**…`)
      .addFields(
        {
          name: "Mode",
          value: isSolo(session)
            ? "Solo"
            : isPvp(session)
              ? "Versus"
              : session.agents.length > 1
                ? `Fleet (${session.agents.length})`
                : "Duel",
          inline: true
        },
        { name: "Difficulty", value: formatDifficulty(session.difficulty), inline: true },
        { name: "Category", value: String(session.category || "Any"), inline: true }
      )
      .setFooter({ text: isAgentMatch(session) ? "Agents cannot answer for at least 3 seconds after reveal." : "Get ready." })
      .setTimestamp();

    const { msg } = await getSessionMessage(client, session);
    if (msg) {
      await msg.edit({ embeds: [e], components: buildLobbyComponents(sessionId, session, { disabled: true }) }).catch(() => {});
    }

    await new Promise(r => setTimeout(r, 1000));
  }
  return true;
}

function resolveSingleResult(session, agentEntry) {
  const correct = session.correctIndex;
  const userPick = Number.isFinite(Number(session.userPick)) ? Number(session.userPick) : null;
  const agentPick = Number.isFinite(Number(agentEntry?.pick)) ? Number(agentEntry.pick) : null;

  const userCorrect = userPick !== null && userPick === correct;
  const agentCorrect = agentPick !== null && agentPick === correct;

  let result = "tie";
  if (userCorrect && !agentCorrect) result = "win";
  else if (!userCorrect && agentCorrect) result = "lose";
  else if (userCorrect && agentCorrect) {
    const uAt = Number(session.userLockedAt || 0);
    const aAt = Number(agentEntry?.lockedAt || 0);
    if (uAt && aAt) result = uAt < aAt ? "win" : uAt > aAt ? "lose" : "tie";
  }

  return { result, userCorrect, agentCorrect };
}

function resolveFleetResult(session, agents) {
  const correct = session.correctIndex;
  const userPick = Number.isFinite(Number(session.userPick)) ? Number(session.userPick) : null;
  const userCorrect = userPick !== null && userPick === correct;

  const agentsCorrect = agents.filter(a => Number(a.pick) === correct);
  const correctCount = agentsCorrect.length;
  const majority = correctCount > Math.floor(Math.max(1, agents.length) / 2);
  const firstCorrectAt = earliestLockedAt(agentsCorrect);
  const userAt = Number(session.userLockedAt || 0);

  let result = "tie";
  if (userCorrect && correctCount === 0) result = "win";
  else if (!userCorrect && correctCount > 0) result = "lose";
  else if (!userCorrect && correctCount === 0) result = "tie";
  else if (userCorrect && !majority) result = "win";
  else if (userCorrect && majority && userAt && firstCorrectAt && userAt < firstCorrectAt) result = "tie";
  else if (userCorrect && majority) result = "lose";

  return { result, userCorrect, correctCount, totalAgents: agents.length };
}

function resolvePerAgentResult(session, agentEntry) {
  const correct = session.correctIndex;
  const userPick = Number.isFinite(Number(session.userPick)) ? Number(session.userPick) : null;
  const userCorrect = userPick !== null && userPick === correct;
  const agentPick = Number.isFinite(Number(agentEntry?.pick)) ? Number(agentEntry.pick) : null;
  const agentCorrect = agentPick !== null && agentPick === correct;

  if (userCorrect && !agentCorrect) return "lose";
  if (!userCorrect && agentCorrect) return "win";
  if (!userCorrect && !agentCorrect) return "tie";

  const uAt = Number(session.userLockedAt || 0);
  const aAt = Number(agentEntry?.lockedAt || 0);
  if (uAt && aAt) {
    if (aAt < uAt) return "win";
    if (aAt > uAt) return "lose";
  }
  return "tie";
}

function resolveSoloResult(session) {
  const correct = session.correctIndex;
  const userPick = Number.isFinite(Number(session.userPick)) ? Number(session.userPick) : null;
  const userCorrect = userPick !== null && userPick === correct;
  return { result: userCorrect ? "win" : "lose", userCorrect };
}

function resolvePvpResult(session) {
  const correct = session.correctIndex;
  const hostPick = Number.isFinite(Number(session.userPick)) ? Number(session.userPick) : null;
  const oppPick = Number.isFinite(Number(session.opponentPick)) ? Number(session.opponentPick) : null;
  const hostCorrect = hostPick !== null && hostPick === correct;
  const oppCorrect = oppPick !== null && oppPick === correct;

  let hostResult = "tie";
  let oppResult = "tie";

  if (hostCorrect && !oppCorrect) {
    hostResult = "win";
    oppResult = "lose";
  } else if (!hostCorrect && oppCorrect) {
    hostResult = "lose";
    oppResult = "win";
  } else if (hostCorrect && oppCorrect) {
    const hAt = Number(session.userLockedAt || 0);
    const oAt = Number(session.opponentLockedAt || 0);
    if (hAt && oAt) {
      if (hAt < oAt) {
        hostResult = "win";
        oppResult = "lose";
      } else if (hAt > oAt) {
        hostResult = "lose";
        oppResult = "win";
      }
    }
  }

  return { hostResult, oppResult, hostCorrect, oppCorrect };
}

async function finalizeSoloSession(client, sessionId, session, { reason = "completed" } = {}) {
  const preMatch = !Array.isArray(session.choices) || !Number.isFinite(Number(session.correctIndex));
  if (preMatch) {
    await deleteTriviaSession(sessionId);
    await clearActiveTriviaSessionId({ guildId: session.guildId, channelId: session.channelId, userId: session.userId });

    const desc =
      reason === "lobby-timeout"
        ? "Lobby timed out before the run started."
        : reason === "forfeit"
          ? "You cancelled before starting."
          : "Run cancelled before start.";

    const e = new EmbedBuilder()
      .setTitle("🧩 Trivia Results")
      .setColor(Colors.INFO)
      .setDescription(desc)
      .addFields(
        { name: "Mode", value: "Solo", inline: true },
        { name: "Difficulty", value: formatDifficulty(session.difficulty), inline: true },
        { name: "Category", value: String(session.category || "Any"), inline: true },
        { name: "Rewards", value: "No rewards granted (run cancelled).", inline: false }
      )
      .setTimestamp();

    try {
      const { channel, msg } = await getSessionMessage(client, session);
      if (channel) {
        if (msg) await msg.edit({ embeds: [e], components: [] }).catch(() => {});
        else await channel.send({ embeds: [e] }).catch(() => {});
      }
    } catch {}
    return true;
  }

  const correct = session.correctIndex;
  const userPick = Number.isFinite(Number(session.userPick)) ? Number(session.userPick) : null;
  const userPickLetter = userPick === null ? "_none_" : `**${LETTERS[userPick] || "?"}**`;

  const { result, userCorrect } = resolveSoloResult(session);
  const noReward = reason === "forfeit" || reason === "lobby-timeout";
  const reward = noReward ? { credits: 0, xp: 0 } : computeReward({ difficulty: session.difficulty, result, answeredBeforeAgent: false });

  try {
    if (reward.credits > 0) await addCredits(session.userId, reward.credits, `Trivia (solo ${session.difficulty}): ${result}`);
  } catch {}
  let xpRes = null;
  try {
    xpRes = await addGameXp(session.userId, reward.xp, { reason: `trivia:solo:${result}` });
  } catch {}

  try { await recordQuestEvent(session.userId, "trivia_runs", 1); } catch {}
  try { if (result === "win") await recordQuestEvent(session.userId, "trivia_wins", 1); } catch {}

  // Per-guild stats + XP
  if (session.guildId) {
    void (async () => {
      try {
        const { addStat } = await import('../game/activityStats.js');
        const { addGuildXp } = await import('../game/guildXp.js');
        addStat(session.userId, session.guildId, 'trivia_runs', 1);
        if (result === 'win') {
          addStat(session.userId, session.guildId, 'trivia_wins', 1);
          await addGuildXp(session.userId, session.guildId, 'trivia_win').catch(() => {});
        }
      } catch {}
    })();
  }

  session.endedAt = Date.now();
  session.endReason = reason;
  await deleteTriviaSession(sessionId);
  await clearActiveTriviaSessionId({ guildId: session.guildId, channelId: session.channelId, userId: session.userId });

  const resultColor = result === "win" ? Colors.SUCCESS : Colors.ERROR;
  const outcomeDescription =
    reason === "forfeit"
      ? "You forfeited the run."
      : reason === "timeout"
        ? (userCorrect ? "You answered correctly in time." : "Time expired.")
        : userCorrect
          ? "Correct."
          : "Incorrect.";

  const e = new EmbedBuilder()
    .setTitle("🧩 Trivia Results")
    .setColor(resultColor)
    .setDescription(outcomeDescription)
    .addFields(
      { name: "Mode", value: "Solo", inline: true },
      { name: "Category", value: String(session.category || "Any"), inline: true },
      { name: "Difficulty", value: formatDifficulty(session.difficulty), inline: true },
      { name: "Correct", value: `**${LETTERS[correct] || "?"}**`, inline: true },
      { name: "Your Pick", value: userPickLetter, inline: true },
      {
        name: "Rewards",
        value: noReward
          ? "No rewards granted (run cancelled)."
          : `+${reward.credits.toLocaleString()} Credits • +${reward.xp.toLocaleString()} XP`,
        inline: false
      }
    )
    .setTimestamp();

  if (session.explanation) {
    e.addFields({ name: "Why", value: String(session.explanation).slice(0, 400), inline: false });
  }
  if (xpRes?.granted?.length) {
    const crates = xpRes.granted.slice(0, 3).map(g => `Lv ${g.level}: \`${g.crateId}\``).join("\n");
    const more = xpRes.granted.length > 3 ? `\n...and ${xpRes.granted.length - 3} more.` : "";
    e.addFields({ name: "Level Rewards", value: crates + more, inline: false });
  }

  try {
    const { channel, msg } = await getSessionMessage(client, session);
    if (channel) {
      if (msg) await msg.edit({ embeds: [e], components: [] }).catch(() => {});
      else await channel.send({ embeds: [e] }).catch(() => {});
    }
  } catch {}

  return true;
}

async function finalizePvpSession(client, sessionId, session, { reason = "completed", actorUserId = null } = {}) {
  const preMatch = !Array.isArray(session.choices) || !Number.isFinite(Number(session.correctIndex));
  const hostId = String(session.userId || "");
  const oppId = String(session.opponentUserId || "");

  if (preMatch) {
    await deleteTriviaSession(sessionId);
    await clearActiveTriviaSessionId({ guildId: session.guildId, channelId: session.channelId, userId: hostId });
    if (oppId) await clearActiveTriviaSessionId({ guildId: session.guildId, channelId: session.channelId, userId: oppId }).catch(() => {});

    const desc =
      reason === "declined"
        ? `<@${oppId}> declined the challenge.`
        : reason === "lobby-timeout"
          ? "Lobby timed out before the match started."
          : reason === "forfeit"
            ? (actorUserId === oppId ? `<@${oppId}> forfeited before start.` : `<@${hostId}> cancelled before start.`)
            : "Match cancelled before start.";

    const e = new EmbedBuilder()
      .setTitle("🧩 Trivia Results")
      .setColor(Colors.INFO)
      .setDescription(desc)
      .addFields(
        { name: "Mode", value: "Versus", inline: true },
        { name: "Host", value: `<@${hostId}>`, inline: true },
        { name: "Opponent", value: `<@${oppId}>`, inline: true },
        { name: "Difficulty", value: formatDifficulty(session.difficulty), inline: true },
        { name: "Category", value: String(session.category || "Any"), inline: true },
        { name: "Rewards", value: "No rewards granted (match cancelled).", inline: false }
      )
      .setTimestamp();

    try {
      const { channel, msg } = await getSessionMessage(client, session);
      if (channel) {
        if (msg) await msg.edit({ embeds: [e], components: [] }).catch(() => {});
        else await channel.send({ embeds: [e] }).catch(() => {});
      }
    } catch {}
    return true;
  }

  const correct = session.correctIndex;
  const hostPick = Number.isFinite(Number(session.userPick)) ? Number(session.userPick) : null;
  const oppPick = Number.isFinite(Number(session.opponentPick)) ? Number(session.opponentPick) : null;

  const noReward = reason === "forfeit" || reason === "lobby-timeout" || reason === "declined";
  const resolved = resolvePvpResult(session);

  const hostReward = noReward ? { credits: 0, xp: 0 } : computeReward({ difficulty: session.difficulty, result: resolved.hostResult, answeredBeforeAgent: false });
  const oppReward = noReward ? { credits: 0, xp: 0 } : computeReward({ difficulty: session.difficulty, result: resolved.oppResult, answeredBeforeAgent: false });

  try { if (hostReward.credits > 0) await addCredits(hostId, hostReward.credits, `Trivia (versus ${session.difficulty}): ${resolved.hostResult}`); } catch {}
  try { if (oppReward.credits > 0) await addCredits(oppId, oppReward.credits, `Trivia (versus ${session.difficulty}): ${resolved.oppResult}`); } catch {}

  let hostXp = null;
  let oppXp = null;
  try { hostXp = await addGameXp(hostId, hostReward.xp, { reason: `trivia:pvp:${resolved.hostResult}` }); } catch {}
  try { oppXp = await addGameXp(oppId, oppReward.xp, { reason: `trivia:pvp:${resolved.oppResult}` }); } catch {}

  try { await recordQuestEvent(hostId, "trivia_runs", 1); } catch {}
  try { await recordQuestEvent(oppId, "trivia_runs", 1); } catch {}
  try { if (resolved.hostResult === "win") await recordQuestEvent(hostId, "trivia_wins", 1); } catch {}
  try { if (resolved.oppResult === "win") await recordQuestEvent(oppId, "trivia_wins", 1); } catch {}

  session.endedAt = Date.now();
  session.endReason = reason;
  await deleteTriviaSession(sessionId);
  await clearActiveTriviaSessionId({ guildId: session.guildId, channelId: session.channelId, userId: hostId });
  if (oppId) await clearActiveTriviaSessionId({ guildId: session.guildId, channelId: session.channelId, userId: oppId }).catch(() => {});

  const resultColor =
    resolved.hostResult === "win" ? Colors.SUCCESS
      : resolved.oppResult === "win" ? Colors.ERROR
        : Colors.INFO;

  const hostPickLetter = hostPick === null ? "_none_" : `**${LETTERS[hostPick] || "?"}**`;
  const oppPickLetter = oppPick === null ? "_none_" : `**${LETTERS[oppPick] || "?"}**`;
  const winnerLine =
    reason === "forfeit"
      ? `Forfeited by <@${actorUserId || "0"}>.`
      : resolved.hostResult === "win"
        ? `<@${hostId}> won.`
        : resolved.oppResult === "win"
          ? `<@${oppId}> won.`
          : "It's a tie.";

  const e = new EmbedBuilder()
    .setTitle("🧩 Trivia Results")
    .setColor(resultColor)
    .setDescription(winnerLine)
    .addFields(
      { name: "Mode", value: "Versus", inline: true },
      { name: "Difficulty", value: formatDifficulty(session.difficulty), inline: true },
      { name: "Category", value: String(session.category || "Any"), inline: true },
      { name: "Correct", value: `**${LETTERS[correct] || "?"}**`, inline: true },
      { name: `<@${hostId}>`, value: hostPickLetter, inline: true },
      { name: `<@${oppId}>`, value: oppPickLetter, inline: true },
      {
        name: "Rewards",
        value: noReward
          ? "No rewards granted (match cancelled)."
          : [
            `<@${hostId}>: +${hostReward.credits.toLocaleString()} Credits • +${hostReward.xp.toLocaleString()} XP`,
            `<@${oppId}>: +${oppReward.credits.toLocaleString()} Credits • +${oppReward.xp.toLocaleString()} XP`
          ].join("\n").slice(0, 1024),
        inline: false
      }
    )
    .setTimestamp();

  if (session.explanation) {
    e.addFields({ name: "Why", value: String(session.explanation).slice(0, 400), inline: false });
  }

  const hostRewards = hostXp?.granted?.length ? hostXp.granted : [];
  const oppRewards = oppXp?.granted?.length ? oppXp.granted : [];
  if (hostRewards.length) {
    const crates = hostRewards.slice(0, 2).map(g => `Lv ${g.level}: \`${g.crateId}\``).join("\n");
    const more = hostRewards.length > 2 ? `\n...and ${hostRewards.length - 2} more.` : "";
    e.addFields({ name: "Level Rewards (Host)", value: crates + more, inline: false });
  }
  if (oppRewards.length) {
    const crates = oppRewards.slice(0, 2).map(g => `Lv ${g.level}: \`${g.crateId}\``).join("\n");
    const more = oppRewards.length > 2 ? `\n...and ${oppRewards.length - 2} more.` : "";
    e.addFields({ name: "Level Rewards (Opponent)", value: crates + more, inline: false });
  }

  try {
    const { channel, msg } = await getSessionMessage(client, session);
    if (channel) {
      if (msg) await msg.edit({ embeds: [e], components: [] }).catch(() => {});
      else await channel.send({ embeds: [e] }).catch(() => {});
    }
  } catch {}

  return true;
}

async function finalizeSession(client, sessionId, { reason = "completed", actorUserId = null } = {}) {
  const session = normalizeSession(await loadTriviaSession(sessionId));
  if (!session || session.endedAt) return false;

  if (isSolo(session)) {
    return await finalizeSoloSession(client, sessionId, session, { reason });
  }
  if (isPvp(session)) {
    return await finalizePvpSession(client, sessionId, session, { reason, actorUserId });
  }

  const preMatch = !Array.isArray(session.choices) || !Number.isFinite(Number(session.correctIndex));
  if (preMatch) {
    await deleteTriviaSession(sessionId);
    await clearActiveTriviaSessionId({ guildId: session.guildId, channelId: session.channelId, userId: session.userId });
    try {
      const mgr = global.agentManager;
      releaseTriviaLeases(mgr, session);
    } catch {}

    const desc =
      reason === "lobby-timeout"
        ? "Lobby timed out before the match started."
        : reason === "forfeit"
        ? "You cancelled before starting."
        : "Match cancelled before start.";
    const e = new EmbedBuilder()
      .setTitle("🧩 Trivia Results")
      .setColor(Colors.INFO)
      .setDescription(desc)
      .addFields(
        { name: "Difficulty", value: formatDifficulty(session.difficulty), inline: true },
        { name: "Category", value: String(session.category || "Any"), inline: true },
        { name: "Opponents", value: String(getConfiguredOpponents(session)), inline: true },
        { name: "Rewards", value: "No rewards granted (match cancelled).", inline: false }
      )
      .setTimestamp();

    try {
      const { channel, msg } = await getSessionMessage(client, session);
      if (channel) {
        if (msg) await msg.edit({ embeds: [e], components: [] }).catch(() => {});
        else await channel.send({ embeds: [e] }).catch(() => {});
      }
    } catch {}
    return true;
  }

  const agents = session.agents || [];
  const correct = session.correctIndex;
  const userPick = Number.isFinite(Number(session.userPick)) ? Number(session.userPick) : null;

  let result = "tie";
  let userCorrect = false;
  let fleetCorrectCount = 0;
  if (agents.length <= 1) {
    const resolved = resolveSingleResult(session, agents[0]);
    result = resolved.result;
    userCorrect = resolved.userCorrect;
    fleetCorrectCount = resolved.agentCorrect ? 1 : 0;
  } else {
    const resolved = resolveFleetResult(session, agents);
    result = resolved.result;
    userCorrect = resolved.userCorrect;
    fleetCorrectCount = resolved.correctCount;
  }

  const noReward = reason === "forfeit" || reason === "lobby-timeout";
  const earliestAgentAt = earliestLockedAt(agents);
  const answeredBeforeAgent = Boolean(session.userLockedAt && earliestAgentAt && Number(session.userLockedAt) < earliestAgentAt);
  const reward = noReward
    ? { credits: 0, xp: 0 }
    : computeReward({ difficulty: session.difficulty, result, answeredBeforeAgent });

  try {
    if (reward.credits > 0) await addCredits(session.userId, reward.credits, `Trivia (${session.difficulty}): ${result}`);
  } catch {}
  let xpRes = null;
  try {
    xpRes = await addGameXp(session.userId, reward.xp, { reason: `trivia:${result}` });
  } catch {}

  try { await recordQuestEvent(session.userId, "trivia_runs", 1); } catch {}
  try { if (result === "win") await recordQuestEvent(session.userId, "trivia_wins", 1); } catch {}

  const perAgentResults = [];
  for (const a of agents) {
    const agentUserId = String(a.agentUserId || "").trim();
    const agentResult = resolvePerAgentResult(session, a);
    perAgentResults.push({ slot: a.slot, agentId: a.agentId, agentTag: a.agentTag, result: agentResult });
    if (noReward) continue;
    if (!agentUserId) continue;
    const agentAnsweredBeforeUser = Boolean(session.userLockedAt && a.lockedAt && Number(a.lockedAt) < Number(session.userLockedAt));
    const agentReward = computeReward({ difficulty: session.difficulty, result: agentResult, answeredBeforeAgent: agentAnsweredBeforeUser });
    try {
      await addGameXp(agentUserId, agentReward.xp, { reason: `trivia-agent:${agentResult}` });
    } catch {}
  }

  try {
    if (session.publicMode) {
      const mgr = global.agentManager;
      for (const a of agents.slice(0, 3)) {
        const agent = mgr?.liveAgents?.get?.(a.agentId) || null;
        if (!agent?.ready) continue;
        const own = perAgentResults.find(p => p.slot === a.slot)?.result || "tie";
        await sendViaAgent({
          agent,
          guildId: session.guildId,
          channelId: session.channelId,
          actorUserId: session.userId,
          content: pickAgentResultLine({
            agentTag: a.agentTag,
            result: own,
            difficulty: session.difficulty
          })
        });
      }
    }
  } catch {}

  session.endedAt = Date.now();
  session.endReason = reason;
  await deleteTriviaSession(sessionId);
  await clearActiveTriviaSessionId({ guildId: session.guildId, channelId: session.channelId, userId: session.userId });

  try {
    const mgr = global.agentManager;
    releaseTriviaLeases(mgr, session);
  } catch {}

  const userPickLetter = userPick === null ? "_none_" : `**${LETTERS[userPick] || "?"}**`;
  const resultColor = result === "win" ? Colors.SUCCESS : result === "lose" ? Colors.ERROR : Colors.INFO;
  const modeText = agents.length > 1 ? `Fleet (${agents.length})` : "Duel";
  const picksLines = agents
    .slice(0, 8)
    .map(a => {
      const pick = Number.isFinite(Number(a.pick)) ? `**${LETTERS[Number(a.pick)] || "?"}**` : "_none_";
      return `${a.agentTag}: ${pick}`;
    });
  if (agents.length > 8) picksLines.push(`…and ${agents.length - 8} more`);

  const outcomeDescription =
    reason === "forfeit"
      ? "You forfeited the match."
      : reason === "lobby-timeout"
      ? "Lobby timed out before the match started."
      : result === "win"
      ? "You won."
      : result === "lose"
      ? "You lost."
      : "It's a tie.";

  const e = new EmbedBuilder()
    .setTitle("🧩 Trivia Results")
    .setColor(resultColor)
    .setDescription(outcomeDescription)
    .addFields(
      { name: "Category", value: String(session.category || "Any"), inline: true },
      { name: "Difficulty", value: formatDifficulty(session.difficulty), inline: true },
      { name: "Mode", value: modeText, inline: true },
      { name: "Correct", value: `**${LETTERS[correct] || "?"}**`, inline: true },
      { name: "Your Pick", value: userPickLetter, inline: true },
      { name: "Fleet Correct", value: `${fleetCorrectCount}/${Math.max(1, agents.length)}`, inline: true },
      { name: "Opponent Picks", value: picksLines.join("\n").slice(0, 1024), inline: false },
      {
        name: "Rewards",
        value: noReward
          ? "No rewards granted (match cancelled)."
          : `+${reward.credits.toLocaleString()} Credits • +${reward.xp.toLocaleString()} XP`,
        inline: false
      }
    )
    .setTimestamp();

  if (session.explanation) {
    e.addFields({ name: "Why", value: String(session.explanation).slice(0, 400), inline: false });
  }
  if (xpRes?.granted?.length) {
    const crates = xpRes.granted.slice(0, 3).map(g => `Lv ${g.level}: \`${g.crateId}\``).join("\n");
    const more = xpRes.granted.length > 3 ? `\n...and ${xpRes.granted.length - 3} more.` : "";
    e.addFields({ name: "Level Rewards", value: crates + more, inline: false });
  }

  try {
    const { channel, msg } = await getSessionMessage(client, session);
    if (channel) {
      if (msg) await msg.edit({ embeds: [e], components: [] }).catch(() => {});
      else await channel.send({ embeds: [e] }).catch(() => {});
    }
  } catch {}

  return true;
}

async function maybeRunAgentAnswer(client, sessionId, { slot = null, force = false } = {}) {
  const session = normalizeSession(await loadTriviaSession(sessionId));
  if (!session || session.endedAt) return false;
  if (session.stage !== "question") return false;

  const now = Date.now();
  const targets = slot
    ? (session.agents || []).filter(a => Number(a.slot) === Number(slot))
    : [...(session.agents || [])];

  const answered = [];
  for (const a of targets) {
    if (!a) continue;
    if (a.pick !== null && a.pick !== undefined) continue;
    const dueAt = Number(a.dueAt || 0);
    if (!force && dueAt && now < dueAt) continue;

    const agentPick = pickAgentAnswer({
      correctIndex: session.correctIndex,
      choicesLen: session.choices?.length || 4,
      difficulty: session.difficulty
    });

    a.pick = agentPick;
    a.lockedAt = Date.now();
    answered.push({ slot: a.slot, pick: agentPick, tag: a.agentTag, agentId: a.agentId });
  }

  if (!answered.length) return false;

  normalizeSession(session);
  await saveTriviaSession(sessionId, session, SESSION_TTL_SECONDS);

  for (const item of answered) {
    try {
      if (!session.publicMode) continue;
      const mgr = global.agentManager;
      const agent = mgr?.liveAgents?.get?.(item.agentId) || null;
      if (mgr && agent?.ready) {
        await sendViaAgent({
          agent,
          guildId: session.guildId,
          channelId: session.channelId,
          actorUserId: session.userId,
          content: `${item.tag} locks in: **${LETTERS[item.pick] || "?"}**`
        });
      }
    } catch {}
  }

  if (session.userLockedAt && allAgentsAnswered(session)) {
    await finalizeSession(client, sessionId, { reason: "completed" });
  }
  return true;
}

async function acquireTriviaAgents(mgr, { guildId, channelId, userId, requestedOpponents, sessionId }) {
  const leases = [];
  const errors = [];
  const desired = clampOpponents(requestedOpponents, 1);
  const forceFleet = desired >= MIN_FLEET_OPPONENTS;

  for (let i = 0; i < desired; i += 1) {
    const kind = desired === 1 ? "trivia" : `trivia:${sessionId}:${i + 1}`;
    const lease = await mgr.ensureTextSessionAgent(guildId, channelId, {
      ownerUserId: userId,
      kind
    });
    if (!lease.ok) {
      errors.push(String(lease.reason || "unknown"));
      break;
    }
    leases.push({
      kind,
      key: lease.key,
      agent: lease.agent
    });
  }

  if (!leases.length) {
    return { ok: false, reason: errors[0] || "no-free-agents", leases: [] };
  }

  if (forceFleet && leases.length < MIN_FLEET_OPPONENTS) {
    for (const l of leases) {
      mgr.releaseTextSession(guildId, channelId, { ownerUserId: userId, kind: l.kind });
    }
    return { ok: false, reason: "no-free-agents", leases: [] };
  }

  return {
    ok: true,
    leases,
    partial: leases.length < desired,
    requested: desired,
    actual: leases.length
  };
}

export const meta = {
  category: "fun",
  guildOnly: true,
};

export const data = new SlashCommandBuilder()
  .setName("trivia")
  .setDescription("Play trivia solo, versus players, or versus deployed agents")
  .addSubcommand(sub =>
    sub
      .setName("start")
      .setDescription("Start a trivia match")
      .addStringOption(o =>
        o
          .setName("difficulty")
          .setDescription("Opponent difficulty (affects speed + accuracy)")
          .setRequired(false)
          .addChoices(
            { name: "Easy", value: "easy" },
            { name: "Normal", value: "normal" },
            { name: "Hard", value: "hard" },
            { name: "Nightmare", value: "nightmare" }
          )
      )
      .addStringOption(o =>
        o
          .setName("category")
          .setDescription("Question category")
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addIntegerOption(o =>
        o
          .setName("opponents")
          .setDescription("Number of agents to challenge (1-6)")
          .setMinValue(1)
          .setMaxValue(MAX_FLEET_OPPONENTS)
          .setRequired(false)
      )
      .addBooleanOption(o =>
        o
          .setName("public")
          .setDescription("Post the match publicly in this channel (default true)")
          .setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName("solo")
      .setDescription("Play a solo trivia run (no opponents)")
      .addStringOption(o =>
        o
          .setName("difficulty")
          .setDescription("Question difficulty")
          .setRequired(false)
          .addChoices(
            { name: "Easy", value: "easy" },
            { name: "Normal", value: "normal" },
            { name: "Hard", value: "hard" },
            { name: "Nightmare", value: "nightmare" }
          )
      )
      .addStringOption(o =>
        o
          .setName("category")
          .setDescription("Question category")
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addBooleanOption(o =>
        o
          .setName("public")
          .setDescription("Post the run publicly in this channel (default true)")
          .setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName("versus")
      .setDescription("Challenge another player to trivia")
      .addUserOption(o =>
        o
          .setName("user")
          .setDescription("Opponent (must accept)")
          .setRequired(true)
      )
      .addStringOption(o =>
        o
          .setName("difficulty")
          .setDescription("Question difficulty")
          .setRequired(false)
          .addChoices(
            { name: "Easy", value: "easy" },
            { name: "Normal", value: "normal" },
            { name: "Hard", value: "hard" },
            { name: "Nightmare", value: "nightmare" }
          )
      )
      .addStringOption(o =>
        o
          .setName("category")
          .setDescription("Question category")
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addBooleanOption(o =>
        o
          .setName("public")
          .setDescription("Post the match publicly in this channel (default true)")
          .setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName("fleet")
      .setDescription("Start a fleet match against multiple agents")
      .addStringOption(o =>
        o
          .setName("difficulty")
          .setDescription("Opponent difficulty")
          .setRequired(false)
          .addChoices(
            { name: "Easy", value: "easy" },
            { name: "Normal", value: "normal" },
            { name: "Hard", value: "hard" },
            { name: "Nightmare", value: "nightmare" }
          )
      )
      .addStringOption(o =>
        o
          .setName("category")
          .setDescription("Question category")
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addIntegerOption(o =>
        o
          .setName("opponents")
          .setDescription("Fleet size (2-6)")
          .setMinValue(MIN_FLEET_OPPONENTS)
          .setMaxValue(MAX_FLEET_OPPONENTS)
          .setRequired(false)
      )
      .addBooleanOption(o =>
        o
          .setName("public")
          .setDescription("Post the match publicly in this channel (default true)")
          .setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName("stop")
      .setDescription("Forfeit your current trivia match in this channel")
  );

export default {
  data,
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused?.name !== "category") return await interaction.respond([]);
    const q = String(focused.value || "").toLowerCase();
    const opts = listTriviaCategories()
      .filter(c => c.toLowerCase().includes(q))
      .slice(0, 25)
      .map(c => ({ name: c, value: c }));
    await interaction.respond(opts);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const channelId = interaction.channelId;
    if (!guildId) {
      return await replyError(interaction, "Guild Only", "Trivia matches can only be played in a server.", true);
    }

    if (sub === "stop") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await withTimeout(interaction, async () => {
        const active = await getActiveTriviaSessionId({ guildId, channelId, userId: interaction.user.id });
        if (!active) {
          return await replyError(interaction, "No Active Match", "You have no active trivia match in this channel.", true);
        }
        await finalizeSession(interaction.client, String(active), { reason: "forfeit", actorUserId: interaction.user.id });
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(Colors.SUCCESS)
              .setTitle("Forfeited")
              .setDescription("Your trivia match has been ended.")
          ]
        });
      }, { label: "trivia" });
      return;
    }

    const isPublic = interaction.options.getBoolean("public");
    const publicMode = isPublic === null ? true : Boolean(isPublic);

    // Solo can be ephemeral. Versus/agent matches require public channel visibility.
    if ((sub === "start" || sub === "fleet" || sub === "versus") && !publicMode) {
      return await replyError(
        interaction,
        "Not Supported Yet",
        "Private trivia matches are not supported for this mode.\nUse `public:true` for now.",
        true
      );
    }

    await interaction.deferReply({ flags: publicMode ? undefined : MessageFlags.Ephemeral });
    await withTimeout(interaction, async () => {
    const existing = await getActiveTriviaSessionId({ guildId, channelId, userId: interaction.user.id });
    if (existing) {
      const still = normalizeSession(await loadTriviaSession(String(existing)));
      if (still) {
        // Self-heal stale startup sessions that never rendered a lobby message.
        if (still.stage === "lobby" && !still.messageId) {
          try {
            const mgr = global.agentManager;
            releaseTriviaLeases(mgr, still);
          } catch {}
          await deleteTriviaSession(String(existing));
          await clearActiveTriviaSessionId({ guildId, channelId, userId: interaction.user.id });
        } else {
        return await replyError(
          interaction,
          "Match Already Running",
          "You already have an active trivia match in this channel.\nUse `/trivia stop` to forfeit it.",
          true
        );
        }
      }
    }

    if (sub === "versus") {
      const opponent = interaction.options.getUser("user", true);
      if (!opponent || opponent.bot) {
        return await replyError(interaction, "Invalid Opponent", "Pick a real user (not a bot).", true);
      }
      if (opponent.id === interaction.user.id) {
        return await replyError(interaction, "Invalid Opponent", "You cannot challenge yourself.", true);
      }
      const oppActive = await getActiveTriviaSessionId({ guildId, channelId, userId: opponent.id });
      if (oppActive) {
        return await replyError(interaction, "Opponent Busy", "That user already has an active trivia match in this channel.", true);
      }
    }

    const difficulty = interaction.options.getString("difficulty") || "normal";
    const category = interaction.options.getString("category") || "Any";
    if (sub === "start" || sub === "fleet") {
      const mgr = global.agentManager;
      if (!mgr) {
        return await replyError(interaction, "Agents Not Ready", formatAgentTextError("agents-not-ready"), true);
      }
    }

    const requested = sub === "fleet"
      ? clampOpponents(interaction.options.getInteger("opponents") ?? 3, 3)
      : clampOpponents(interaction.options.getInteger("opponents") ?? 1, 1);
    const requestedOpponents = sub === "fleet" ? Math.max(MIN_FLEET_OPPONENTS, requested) : requested;
    const sessionId = makeTriviaSessionId();
    const opponentUser = sub === "versus" ? interaction.options.getUser("user", true) : null;

    const session = normalizeSession({
      sessionId,
      guildId,
      channelId,
      userId: interaction.user.id,
      opponentUserId: opponentUser?.id || null,
      acceptedAt: null,
      difficulty,
      category: String(category || "Any"),
      prompt: null,
      explanation: null,
      choices: null,
      correctIndex: null,
      createdAt: Date.now(),
      stage: "lobby",
      expiresAt: null,
      revealedAt: null,
      mode: sub === "solo" ? "solo" : sub === "versus" ? "pvp" : requestedOpponents > 1 ? "fleet" : "duel",
      opponents: sub === "solo" ? 0 : sub === "versus" ? 1 : requestedOpponents,
      agents: [],
      agentLeases: [],
      userPick: null,
      userLockedAt: null,
      opponentPick: null,
      opponentLockedAt: null,
      messageId: null,
      publicMode,
      startNote: sub === "versus"
        ? `Waiting for <@${opponentUser?.id}> to accept.`
        : "Use dropdowns to configure this run."
    });

    try {
      await saveTriviaSession(sessionId, session, SESSION_TTL_SECONDS);
      await setActiveTriviaSessionId({ guildId, channelId, userId: interaction.user.id, sessionId, ttlSeconds: SESSION_TTL_SECONDS });

      const embed = buildLobbyEmbed(session);
      const components = buildLobbyComponents(sessionId, session, { disabled: false });
      const payload = {
        embeds: [embed],
        components,
        flags: publicMode ? undefined : MessageFlags.Ephemeral,
        fetchReply: true
      };

      const msg = await interaction.editReply(payload);
      session.messageId = msg?.id || null;
      await saveTriviaSession(sessionId, session, SESSION_TTL_SECONDS);
    } catch (err) {
      try {
        const mgr = global.agentManager;
        releaseTriviaLeases(mgr, session);
      } catch {}
      try { await deleteTriviaSession(sessionId); } catch {}
      try { await clearActiveTriviaSessionId({ guildId, channelId, userId: interaction.user.id }); } catch {}
      return await replyError(interaction, "Trivia Error", "Could not open the trivia setup panel. Please run `/trivia start` again.", true);
    }

    setTimeout(() => {
      (async () => {
        const s = normalizeSession(await loadTriviaSession(sessionId));
        if (!s || s.endedAt) return;
        if (s.stage !== "lobby") return;
        await finalizeSession(interaction.client, sessionId, { reason: "lobby-timeout" });
      })().catch(() => {});
    }, LOBBY_TIMEOUT_MS);
    }, { label: "trivia" });
  }
};

export async function handleSelect(interaction) {
  const id = String(interaction.customId || "");
  if (!id.startsWith("trivia:")) return false;
  const parts = id.split(":");
  const area = parts[1];
  if (area !== "sel" && area !== "cfg") return false;
  const sessionId = parts[2];
  const session = normalizeSession(await loadTriviaSession(sessionId));
  if (!session) {
    await interaction.reply({ content: "This match expired. Run `/trivia start` again.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (area === "cfg") {
    if (interaction.user.id !== session.userId) {
      await interaction.reply({ content: "Only the host can change match settings.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (session.stage !== "lobby") {
      await interaction.reply({ content: "Setup is locked after Start.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const configKey = parts[3];
    const v = String(interaction.values?.[0] || "").trim();
    if (!v) {
      await interaction.reply({ content: "No value selected.", flags: MessageFlags.Ephemeral });
      return true;
    }

    if (configKey === "difficulty") {
      const next = String(v).toLowerCase();
      if (!DIFFICULTY_CHOICES.includes(next)) {
        await interaction.reply({ content: "Unsupported difficulty.", flags: MessageFlags.Ephemeral });
        return true;
      }
      session.difficulty = next;
    } else if (configKey === "category") {
      session.category = v === "Any" ? "Any" : v;
    } else if (configKey === "opponents") {
      const n = clampOpponents(v, 1);
      session.opponents = n;
      session.mode = n > 1 ? "fleet" : "duel";
    } else {
      await interaction.reply({ content: "Unknown setup option.", flags: MessageFlags.Ephemeral });
      return true;
    }

    session.startNote = "Setup updated.";
    await saveTriviaSession(sessionId, session, SESSION_TTL_SECONDS);
    await interaction.update({
      embeds: [buildLobbyEmbed(session)],
      components: buildLobbyComponents(sessionId, session, { disabled: false })
    });
    return true;
  }

  if (!canUseMatchUi(session, interaction.user.id)) {
    await interaction.reply({ content: "This match belongs to another user.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (session.stage !== "question") {
    await interaction.reply({ content: "Not ready yet. Press Start first.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const isOpponent = isPvp(session) && interaction.user.id === session.opponentUserId;
  if (isOpponent ? session.opponentLockedAt : session.userLockedAt) {
    await interaction.reply({ content: "Already locked in.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const v = interaction.values?.[0];
  const maxIndex = Math.max(0, (session.choices?.length || 4) - 1);
  const pick = Math.max(0, Math.min(maxIndex, Math.trunc(Number(v))));
  if (isOpponent) session.opponentPick = pick;
  else session.userPick = pick;
  await saveTriviaSession(sessionId, session, SESSION_TTL_SECONDS);

  const embed = buildQuestionEmbed({ session });
  await interaction.update({
    embeds: [embed],
    components: buildAnswerComponents(sessionId, session.choices?.length || 4, { disabled: false })
  });
  return true;
}

export async function handleButton(interaction) {
  const id = String(interaction.customId || "");
  if (!id.startsWith("trivia:btn:")) return false;
  const parts = id.split(":");
  const sessionId = parts[2];
  const action = parts[3];

  const session = normalizeSession(await loadTriviaSession(sessionId));
  if (!session) {
    await interaction.reply({ content: "This match expired. Run `/trivia start` again.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!canUseMatchUi(session, interaction.user.id)) {
    await interaction.reply({ content: "This match belongs to another user.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (action === "rules") {
    await interaction.reply({ embeds: [buildRulesEmbed()], flags: MessageFlags.Ephemeral });
    return true;
  }

  if (action === "status") {
    await interaction.reply({ embeds: [buildStatusEmbed(session)], flags: MessageFlags.Ephemeral });
    return true;
  }

  if (action === "accept" || action === "decline") {
    if (!isPvp(session)) {
      await interaction.reply({ content: "This is not a versus match.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (session.stage !== "lobby") {
      await interaction.reply({ content: "This match already started.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (interaction.user.id !== session.opponentUserId) {
      await interaction.reply({ content: "Only the challenged opponent can do that.", flags: MessageFlags.Ephemeral });
      return true;
    }

    if (action === "accept") {
      if (session.acceptedAt) {
        await interaction.reply({ content: "Already accepted.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const oppActive = await getActiveTriviaSessionId({
        guildId: session.guildId,
        channelId: session.channelId,
        userId: session.opponentUserId
      });
      if (oppActive) {
        await interaction.reply({ content: "You already have an active trivia match in this channel.", flags: MessageFlags.Ephemeral });
        return true;
      }

      session.acceptedAt = Date.now();
      session.startNote = "✅ Opponent accepted. Host can press Start.";
      await saveTriviaSession(sessionId, session, SESSION_TTL_SECONDS);
      await setActiveTriviaSessionId({
        guildId: session.guildId,
        channelId: session.channelId,
        userId: session.opponentUserId,
        sessionId,
        ttlSeconds: SESSION_TTL_SECONDS
      });

      await interaction.update({
        embeds: [buildLobbyEmbed(session)],
        components: buildLobbyComponents(sessionId, session, { disabled: false })
      });
      return true;
    }

    await interaction.deferUpdate();
    await finalizeSession(interaction.client, sessionId, { reason: "declined", actorUserId: interaction.user.id });
    return true;
  }

  if (action === "start") {
    if (session.stage !== "lobby") {
      await interaction.reply({ content: "Already started.", flags: MessageFlags.Ephemeral });
      return true;
    }

    if (isPvp(session)) {
      if (interaction.user.id !== session.userId) {
        await interaction.reply({ content: "Only the host can start.", flags: MessageFlags.Ephemeral });
        return true;
      }
      if (!session.acceptedAt) {
        await interaction.reply({ content: "Waiting for the opponent to accept.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const prep = prepareSessionForNonAgentMatch(session);
      if (!prep.ok) {
        const msg = prep.reason === "no-questions"
          ? "No trivia questions are available for the selected category/difficulty."
          : "Unable to start this match.";
        await saveTriviaSession(sessionId, session, SESSION_TTL_SECONDS);
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        return true;
      }
      session.stage = "countdown";
      await saveTriviaSession(sessionId, session, SESSION_TTL_SECONDS);
      await interaction.update({
        embeds: [buildLobbyEmbed(session)],
        components: buildLobbyComponents(sessionId, session, { disabled: true })
      });
      await runCountdown(interaction.client, sessionId);
      await showQuestion(interaction.client, sessionId);
      return true;
    }

    if (isSolo(session)) {
      const prep = prepareSessionForNonAgentMatch(session);
      if (!prep.ok) {
        const msg = prep.reason === "no-questions"
          ? "No trivia questions are available for the selected category/difficulty."
          : "Unable to start this run.";
        await saveTriviaSession(sessionId, session, SESSION_TTL_SECONDS);
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        return true;
      }
      session.stage = "countdown";
      await saveTriviaSession(sessionId, session, SESSION_TTL_SECONDS);
      await interaction.update({
        embeds: [buildLobbyEmbed(session)],
        components: buildLobbyComponents(sessionId, session, { disabled: true })
      });
      await runCountdown(interaction.client, sessionId);
      await showQuestion(interaction.client, sessionId);
      return true;
    }

    const mgr = global.agentManager;
    if (!mgr) {
      await interaction.reply({ content: formatAgentTextError("agents-not-ready"), flags: MessageFlags.Ephemeral });
      return true;
    }

    // Safety: clear any stale leases before re-allocating on Start.
    releaseTriviaLeases(mgr, session);
    session.agents = [];
    session.agentLeases = [];
    session.agentPick = null;
    session.agentLockedAt = null;
    session.agentDueAt = null;
    session.prompt = null;
    session.explanation = null;
    session.choices = null;
    session.correctIndex = null;

    const prep = await prepareSessionForMatch(session);
    if (!prep.ok) {
      const msg = prep.reason === "no-questions"
        ? "No trivia questions are available for the selected category/difficulty."
        : formatAgentTextError(prep.reason);
      await saveTriviaSession(sessionId, session, SESSION_TTL_SECONDS);
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      return true;
    }

    session.stage = "countdown";
    await saveTriviaSession(sessionId, session, SESSION_TTL_SECONDS);

    await interaction.update({
      embeds: [buildLobbyEmbed(session)],
      components: buildLobbyComponents(sessionId, session, { disabled: true })
    });
    await runCountdown(interaction.client, sessionId);
    await showQuestion(interaction.client, sessionId);
    return true;
  }

  if (action === "forfeit") {
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(Colors.INFO).setTitle("Cancelled").setDescription("Ending match…")],
      components: []
    });
    await finalizeSession(interaction.client, sessionId, { reason: "forfeit", actorUserId: interaction.user.id });
    return true;
  }

  if (action === "lock") {
    if (session.stage !== "question") {
      await interaction.reply({ content: "Press Start first.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const isOpponent = isPvp(session) && interaction.user.id === session.opponentUserId;
    const actorLockedAt = isOpponent ? session.opponentLockedAt : session.userLockedAt;
    const actorPick = isOpponent ? session.opponentPick : session.userPick;
    if (actorLockedAt) {
      await interaction.reply({ content: "Already locked in.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (actorPick === null || actorPick === undefined) {
      await interaction.reply({ content: "Pick an option first.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (isOpponent) session.opponentLockedAt = Date.now();
    else session.userLockedAt = Date.now();
    await saveTriviaSession(sessionId, session, SESSION_TTL_SECONDS);

    const embed = buildQuestionEmbed({ session });
    await interaction.update({
      embeds: [embed],
      components: buildAnswerComponents(
        sessionId,
        session.choices?.length || 4,
        { disabled: isAgentMatch(session) || isSolo(session) ? true : false }
      )
    });

    if (isSolo(session)) {
      await finalizeSession(interaction.client, sessionId, { reason: "completed", actorUserId: interaction.user.id });
      return true;
    }

    if (isPvp(session)) {
      const updated = normalizeSession(await loadTriviaSession(sessionId));
      if (updated?.userLockedAt && updated?.opponentLockedAt) {
        await finalizeSession(interaction.client, sessionId, { reason: "completed", actorUserId: interaction.user.id });
      }
      return true;
    }

    await maybeRunAgentAnswer(interaction.client, sessionId);
    const updated = normalizeSession(await loadTriviaSession(sessionId));
    if (updated && allAgentsAnswered(updated)) {
      await finalizeSession(interaction.client, sessionId, { reason: "completed" });
    }
    return true;
  }

  await interaction.reply({ content: "Unknown trivia action.", flags: MessageFlags.Ephemeral });
  return true;
}
