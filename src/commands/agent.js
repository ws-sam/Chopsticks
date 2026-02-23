import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { Colors, replyError } from "../utils/discordOutput.js";
import { generateText } from "../utils/textLlm.js";
import { withTimeout } from "../utils/interactionTimeout.js";

function fallbackReply(style, msg) {
  const s = String(style || "helper").toLowerCase();
  const text = String(msg || "").trim();
  if (!text) return "Say something and I'll respond.";

  if (s === "dm" || s === "dungeon_master") {
    return (
      `The Dungeon Master considers your words:\n` +
      `> ${text.slice(0, 240)}\n\n` +
      `Choose your next move carefully. If you want a challenge, run \`/trivia start\`.`
    );
  }
  if (s === "coach") {
    return (
      `Quick coaching:\n` +
      `1. Define the goal.\n` +
      `2. Reduce the next step to 5 minutes.\n` +
      `3. Ship it, then iterate.\n\n` +
      `Your message: ${text.slice(0, 240)}`
    );
  }
  if (s === "roast") {
    return `I read: "${text.slice(0, 220)}". Bold. Risky. Unverified. Try again, but with receipts.`;
  }
  // helper
  if (text.endsWith("?")) {
    return `Answer: it depends. Tell me the context (guild, command, expected behavior) and I'll give the exact steps.`;
  }
  return `Got it. If you want something interactive, use \`/game panel\` or try \`/trivia start\`.`;
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

export const meta = {
  category: "social",
  guildOnly: false,
};

export default {
  data: new SlashCommandBuilder()
    .setName("agent")
    .setDescription("Chat to a deployed agent identity")
    .addSubcommand(sub =>
      sub
        .setName("chat")
        .setDescription("Send a message and get a response from an agent in this guild")
        .addStringOption(o =>
          o
            .setName("message")
            .setDescription("What you want to say")
            .setRequired(true)
        )
        .addStringOption(o =>
          o
            .setName("style")
            .setDescription("How the agent should respond")
            .setRequired(false)
            .addChoices(
              { name: "Helper", value: "helper" },
              { name: "Dungeon Master", value: "dungeon_master" },
              { name: "Coach", value: "coach" },
              { name: "Roast", value: "roast" }
            )
        )
        .addBooleanOption(o =>
          o
            .setName("public")
            .setDescription("Post the agent reply publicly (default true)")
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub !== "chat") return;

    const guildId = interaction.guildId;
    const channelId = interaction.channelId;
    if (!guildId) {
      return await replyError(interaction, "Guild Only", "Agent chat is server-only.", true);
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    await withTimeout(interaction, async () => {
      const mgr = global.agentManager;
      if (!mgr) return await replyError(interaction, "Agents Not Ready", "Agents are starting up. Try again shortly.", true);

      const message = interaction.options.getString("message") || "";
      const style = interaction.options.getString("style") || "helper";
      const pub = interaction.options.getBoolean("public");
      const publicMode = pub === null ? true : Boolean(pub);

      const lease = await mgr.ensureTextSessionAgent(guildId, channelId, {
        ownerUserId: interaction.user.id,
        kind: "chat"
      });
      if (!lease.ok) {
        const msg =
          lease.reason === "no-agents-in-guild"
            ? "No agents deployed in this guild. Use `/agents deploy 3` first."
            : "All agents are currently busy. Try again in a few seconds, or deploy more agents.";
        return await replyError(interaction, "Agent Unavailable", msg, true);
      }

      const agentTag = lease.agent.tag ? lease.agent.tag : `Agent ${lease.agent.agentId}`;

      let reply = "";
      try {
        const system =
          style === "dungeon_master"
            ? "You are a Dungeon Master in a fast-paced Discord bot. Be concise, vivid, and interactive. End with a question or a clear next action."
            : style === "coach"
            ? "You are a pragmatic coach. Give short, actionable steps. No fluff."
            : style === "roast"
            ? "You are a sarcastic but not hateful critic. Keep it PG-13, short, and safe."
            : "You are a helpful assistant. Be concise and concrete.";

        const prompt =
          `User: ${interaction.user.username}\n` +
          `Message: ${message}\n` +
          `Reply as ${agentTag}.`;

        reply = await generateText({ prompt, system });
      } catch (err) {
        reply = fallbackReply(style, message);
      }

      const embed = new EmbedBuilder()
        .setTitle(`🛰️ ${agentTag}`)
        .setColor(Colors.INFO)
        .setDescription(String(reply).slice(0, 3500))
        .setFooter({ text: publicMode ? "Public reply" : "Private reply" })
        .setTimestamp();

      try {
        if (publicMode) {
          await sendViaAgent({
            agent: lease.agent,
            guildId,
            channelId,
            actorUserId: interaction.user.id,
            embeds: [embed.toJSON()]
          });
        } else {
          await interaction.user.send({ embeds: [embed] });
        }
      } catch (err) {
        mgr.releaseTextSession(guildId, channelId, { ownerUserId: interaction.user.id, kind: "chat" });
        return await replyError(interaction, "Send Failed", "The agent couldn't deliver the message (missing perms or DMs blocked).", true);
      } finally {
        mgr.releaseTextSession(guildId, channelId, { ownerUserId: interaction.user.id, kind: "chat" });
      }

      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(Colors.SUCCESS).setTitle("Sent").setDescription("Agent response delivered.")] });
    }, { label: "agent" });
  }
};

