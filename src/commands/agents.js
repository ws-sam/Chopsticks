import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder
} from "discord.js";
import {
  insertAgentBot,
  fetchAgentBots,
  updateAgentBotStatus,
  deleteAgentBot,
  updateAgentBotProfile,
  fetchAgentBotProfile
} from "../utils/storage.js";

export const meta = {
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageGuild],
  category: "admin"
};

function fmtTs(ms) {
  if (!ms) return "n/a";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

function buildMainInvite(clientId) {
  const perms = new PermissionsBitField([
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.Connect,
    PermissionsBitField.Flags.Speak,
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageGuild,
    PermissionsBitField.Flags.ModerateMembers
  ]);
  return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${perms.bitfield}&scope=bot%20applications.commands`;
}

export const data = new SlashCommandBuilder()
  .setName("agents")
  .setDescription("Deploy and manage Chopsticks agents")
  .addSubcommand(s => s.setName("status").setDescription("Status overview for this guild"))
  .addSubcommand(s => s.setName("manifest").setDescription("List every connected agent and identity"))
  .addSubcommand(s =>
    s
      .setName("deploy")
      .setDescription("Generate invite links to deploy more agents into this guild")
      .addIntegerOption(o =>
        o
          .setName("desired_total")
          .setDescription("Total number of agents you want available in this guild (multiples of 10, max 50)")
          .setRequired(true)
          .setMinValue(10) // Enforce minimum package size
          .setMaxValue(50)  // Enforce maximum total agents
      )
  )
  .addSubcommand(s => s.setName("sessions").setDescription("List active sessions for this guild"))
  .addSubcommand(s =>
    s
      .setName("assign")
      .setDescription("Pin a specific agent to a voice channel")
      .addChannelOption(o =>
        o.setName("channel").setDescription("Voice channel").setRequired(true).addChannelTypes(ChannelType.GuildVoice)
      )
      .addStringOption(o => o.setName("agent_id").setDescription("Agent ID (e.g. agent0001)").setRequired(true))
      .addStringOption(o =>
        o
          .setName("kind")
          .setDescription("Session type")
          .addChoices(
            { name: "music", value: "music" },
            { name: "assistant", value: "assistant" }
          )
      )
  )
  .addSubcommand(s =>
    s
      .setName("release")
      .setDescription("Release a session for a voice channel")
      .addChannelOption(o =>
        o.setName("channel").setDescription("Voice channel").setRequired(true).addChannelTypes(ChannelType.GuildVoice)
      )
      .addStringOption(o =>
        o
          .setName("kind")
          .setDescription("Session type")
          .addChoices(
            { name: "music", value: "music" },
            { name: "assistant", value: "assistant" }
          )
      )
  )
  .addSubcommand(s =>
    s
      .setName("scale")
      .setDescription("Scale active agents inside agentRunner (requires AGENT_SCALE_TOKEN)")
      .addIntegerOption(o =>
        o.setName("count").setDescription("Desired active agents").setRequired(true).setMinValue(1).setMaxValue(200)
      )
  )
  .addSubcommand(s =>
    s
      .setName("restart")
      .setDescription("Restart an agent by id (disconnects it so agentRunner reconnects)")
      .addStringOption(o => o.setName("agent_id").setDescription("Agent ID").setRequired(true))
  )
  .addSubcommand(s =>
    s
      .setName("add_token")
      .setDescription("Add a new agent token to the system")
      .addStringOption(o => o.setName("token").setDescription("Discord Bot Token").setRequired(true))
      .addStringOption(o => o.setName("client_id").setDescription("Discord Bot Client ID").setRequired(true))
      .addStringOption(o => o.setName("tag").setDescription("Bot Tag (e.g., BotName#1234)").setRequired(true))
  )
  .addSubcommand(s => s.setName("list_tokens").setDescription("List all registered agent tokens"))
  .addSubcommand(s =>
    s
      .setName("update_token_status")
      .setDescription("Update the status of an agent token")
      .addStringOption(o => o.setName("agent_id").setDescription("Agent ID (e.g., agent0001)").setRequired(true))
      .addStringOption(o =>
        o
          .setName("status")
          .setDescription("New status for the agent (active, inactive, or restarting)") // Added restarting
          .setRequired(true)
          .addChoices({ name: "active", value: "active" }, { name: "inactive", value: "inactive" }, { name: "restarting", value: "restarting" })
      )
  )
  .addSubcommand(s =>
    s
      .setName("delete_token")
      .setDescription("Delete an agent token from the system")
      .addStringOption(o => o.setName("agent_id").setDescription("Agent ID (e.g., agent0001)").setRequired(true))
  )
  .addSubcommand(s =>
    s
      .setName("set_profile")
      .setDescription("Set the AI profile for an agent.")
      .addStringOption(o => o.setName("agent_id").setDescription("The ID of the agent to update").setRequired(true))
      .addStringOption(o => o.setName("profile").setDescription("The JSON profile string for the agent").setRequired(true))
  )
  .addSubcommand(s =>
    s
      .setName("get_profile")
      .setDescription("Get the AI profile for an agent.")
      .addStringOption(o => o.setName("agent_id").setDescription("The ID of the agent").setRequired(true))
  );

export async function execute(interaction) {
  const mgr = global.agentManager;
  if (!mgr) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: "Agent control not started." });
    return;
  }

  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  // --- Bot Owner Permissions ---
  const ownerIds = (process.env.BOT_OWNER_IDS || "").split(",").filter(id => id.length > 0);
  const isBotOwner = ownerIds.includes(interaction.user.id);
  const ownerOnlySubcommands = new Set([
    "add_token",
    "delete_token",
    "set_profile",
    "update_token_status",
    "scale",
    "restart"
  ]);

  if (ownerOnlySubcommands.has(sub) && !isBotOwner) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "❌ This command is restricted to the Bot Owner."
    });
    return;
  }
  // -----------------------------

  if (sub === "status") {
    const allAgents = await fetchAgentBots(); // Fetch all registered agents from DB
    const liveAgents = await mgr.listAgents(); // Currently connected agents
    const liveAgentIds = new Set(liveAgents.map(a => a.agentId));

    const inGuild = liveAgents.filter(a => a.guildIds.includes(guildId));
    const idleInGuild = inGuild.filter(a => a.ready && !a.busyKey);
    const busyInGuild = inGuild.filter(a => a.ready && a.busyKey);

    const registeredButNotInGuild = allAgents.filter(a => !liveAgentIds.has(a.agent_id) || !liveAgents.find(la => la.agentId === a.agent_id)?.guildIds.includes(guildId));
    const invitable = registeredButNotInGuild.filter(a => a.status === 'active'); // Only active registered agents are invitable

    const embed = new EmbedBuilder()
      .setTitle("Agent Status")
      .setColor(0x00ff00)
      .setTimestamp()
      .addFields(
        { name: "Summary", value: `Registered: **${allAgents.length}**\nLive: **${liveAgents.length}**\nInvitable: **${invitable.length}**` },
        { name: `Agents in this Guild (${inGuild.length})`, value: `Idle: **${idleInGuild.length}**\nBusy: **${busyInGuild.length}**` }
      );

    const liveInGuildText = inGuild
      .sort((x, y) => String(x.agentId).localeCompare(String(y.agentId)))
      .map(a => {
        const state = a.ready ? (a.busyKey ? `busy(${a.busyKind || "?"})` : "idle") : "down";
        const ident = a.tag ? `${a.tag} (${a.botUserId})` : (a.botUserId ? String(a.botUserId) : "unknown-id");
        return `\`${a.agentId}\` — ${state} — seen ${fmtTs(a.lastSeen)} — ${ident}`;
      })
      .join("\n");

    if (liveInGuildText) {
      embed.addFields({ name: "Live Agents in Guild", value: liveInGuildText.slice(0, 1024) });
    }

    const invitableText = invitable
      .sort((x, y) => String(x.agent_id).localeCompare(String(y.agent_id)))
      .map(a => `\`${a.agent_id}\` — ${a.tag} (${a.client_id}) — Status: ${a.status}`)
      .join("\n");

    if (invitableText) {
      embed.addFields({ name: "Invitable Agents", value: invitableText.slice(0, 1024) });
    }

    await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed] });
    return;
  }

  if (sub === "manifest") {
    const agents = await fetchAgentBots(); // Fetch all registered agents from DB
    const liveAgents = await mgr.listAgents(); // Currently connected agents
    const liveAgentMap = new Map(liveAgents.map(a => [a.agentId, a]));

    const embed = new EmbedBuilder()
      .setTitle("Agent Manifest")
      .setColor(0x0099ff)
      .setTimestamp();
      
    const descriptionLines = agents
      .sort((x, y) => String(x.agent_id).localeCompare(String(y.agent_id)))
      .map(a => {
        const liveStatus = liveAgentMap.get(a.agent_id);
        const state = liveStatus ? (liveStatus.ready ? (liveStatus.busyKey ? `busy(${liveStatus.busyKind || "?"})` : "idle") : "down") : "offline";
        const inGuildState = liveStatus?.guildIds.includes(guildId) ? "in-guild" : "not-in-guild";
        const profileState = a.profile ? "Yes" : "No";
        return `**${a.agent_id}** (${a.tag})\nDB: \`${a.status}\` | Live: \`${state}\` | Guild: \`${inGuildState}\` | Profile: \`${profileState}\``;
      });

    embed.setDescription(descriptionLines.join("\n\n").slice(0, 4096));

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [embed]
    });
    return;
  }

  if (sub === "deploy") {
    const desiredTotal = interaction.options.getInteger("desired_total", true);

    if (desiredTotal % 10 !== 0) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ The desired total number of agents must be a multiple of 10. You entered ${desiredTotal}.`
      });
      return;
    }

    const plan = await mgr.buildDeployPlan(guildId, desiredTotal); // Now async

    const lines = [];
    lines.push(`Desired total agents in this guild: ${plan.desired}`);
    lines.push(`Currently present: ${plan.presentCount}`);
    lines.push(`Need invites: ${plan.needInvites}`);
    lines.push("");

    if (plan.invites.length) {
      lines.push("To deploy more agents, invite these bot identities:");
      for (const inv of plan.invites) {
        const label = inv.tag ? `${inv.agentId} (${inv.tag})` : inv.agentId;
        // Use client_id from the stored agent bot for the invite URL
        lines.push(`- **${label}**: <${buildMainInvite(inv.botUserId)}>`);
      }
    } else {
      lines.push("No invites needed (already at or above desired count, or no available agents to invite).");
    }

    // If there's an issue and still need invites but none are available for invite
    if (plan.needInvites > 0 && plan.invites.length === 0) {
        lines.push("");
        lines.push("💡 If you need more agents, ensure they are registered and active:");
        lines.push("1. Use `/agents add_token` to register new agents.");
        lines.push("2. Ensure registered agents are marked `active` using `/agents update_token_status`.");
        lines.push("3. Start `chopsticks-agent-runner` processes (e.g., via PM2) to bring agents online.");
        lines.push("4. Rerun `/agents deploy`.");
    }

    await interaction.reply({ flags: MessageFlags.Ephemeral, content: lines.join("\n").slice(0, 1900) });
    return;
  }

  if (sub === "sessions") {
    const sessions = mgr
      .listSessions()
      .filter(s => s.guildId === guildId)
      .map(s => `music ${s.voiceChannelId} -> ${s.agentId}`);

    const assistantSessions = mgr
      .listAssistantSessions()
      .filter(s => s.guildId === guildId)
      .map(s => `assistant ${s.voiceChannelId} -> ${s.agentId}`);

    const lines = [...sessions, ...assistantSessions];
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: lines.length ? lines.join("\n") : "No sessions for this guild."
    });
    return;
  }

  if (sub === "assign") {
    const channel = interaction.options.getChannel("channel", true);
    const agentId = interaction.options.getString("agent_id", true);
    const kind = interaction.options.getString("kind") || "music";
    const agent = mgr.agents.get(agentId);
    if (!agent?.ready || !agent.ws) {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: "Agent not ready." });
      return;
    }
    if (kind === "assistant") {
      mgr.setPreferredAssistant(guildId, channel.id, agentId, 300_000);
    } else {
      mgr.setPreferredAgent(guildId, channel.id, agentId, 300_000);
    }
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Pinned ${agentId} to ${channel.id} (${kind}).` });
    return;
  }

  if (sub === "release") {
    const channel = interaction.options.getChannel("channel", true);
    const kind = interaction.options.getString("kind") || "music";

    if (kind === "assistant") {
      const sess = mgr.getAssistantSessionAgent(guildId, channel.id);
      if (sess.ok) {
        try {
          await mgr.request(sess.agent, "assistantLeave", {
            guildId,
            voiceChannelId: channel.id,
            actorUserId: interaction.user.id
          });
        } catch {}
        mgr.releaseAssistantSession(guildId, channel.id);
      }
    } else {
      const sess = mgr.getSessionAgent(guildId, channel.id);
      if (sess.ok) {
        try {
          await mgr.request(sess.agent, "stop", {
            guildId,
            voiceChannelId: channel.id,
            actorUserId: interaction.user.id
          });
        } catch {}
        mgr.releaseSession(guildId, channel.id);
      }
    }

    await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Released ${kind} session for ${channel.id}.` });
    return;
  }

  if (sub === "scale") {
    const count = interaction.options.getInteger("count", true);
    const scaleToken = String(process.env.AGENT_SCALE_TOKEN || "").trim();
    if (!scaleToken) {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: "AGENT_SCALE_TOKEN not configured." });
      return;
    }
    const any = mgr.listAgents().find(a => a.ready);
    if (!any) {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: "No ready agent available." });
      return;
    }
    const agentObj = mgr.agents.get(any.agentId);
    try {
      const res = await mgr.request(agentObj, "scale", { desiredActive: count, scaleToken });
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `Scale result: ${res?.action ?? "ok"} (active: ${res?.active ?? "?"})`
      });
    } catch (err) {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Scale failed: ${err?.message ?? err}` });
    }
    return;
  }

  if (sub === "restart") {
    const agentId = interaction.options.getString("agent_id", true);
    // Use the new updateAgentBotStatus to set status to 'restarting'
    try {
      await mgr.updateAgentBotStatus(agentId, 'restarting');
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Agent ${agentId} marked for restart. AgentRunner will handle reconnection.` });
    } catch (error) {
      console.error(`Error marking agent ${agentId} for restart: ${error}`);
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Failed to mark agent for restart: ${error.message}` });
    }
    return;
  }

  if (sub === "add_token") {
    const token = interaction.options.getString("token", true);
    const clientId = interaction.options.getString("client_id", true);
    const tag = interaction.options.getString("tag", true);
    const agentId = `agent${clientId}`; // Use client ID to form a unique agent ID

    try {
      const result = await insertAgentBot(agentId, token, clientId, tag);
      const operationMsg = result.operation === 'inserted' ? 'added' : 'updated';
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Agent token ${agentId} ${operationMsg} successfully. AgentRunner will attempt to start it.` });
    } catch (error) {
      console.error(`Error adding/updating agent token: ${error}`); // Updated log message
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Failed to add/update agent token: ${error.message}` }); // Updated reply message
    }
    return;
  }

  if (sub === "list_tokens") {
    try {
      const tokens = await fetchAgentBots();
      if (tokens.length === 0) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: "No agent tokens registered." });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("Registered Agent Tokens")
        .setColor(0x0099ff)
        .setTimestamp();
        
      const description = tokens
        .map(t => `**${t.agent_id}** (${t.tag})\nClient ID: \`${t.client_id}\` | Status: \`${t.status}\``)
        .join("\n\n");

      embed.setDescription(description.slice(0, 4096));

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error(`Error listing agent tokens: ${error}`);
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Failed to list agent tokens: ${error.message}` });
    }
    return;
  }

  if (sub === "update_token_status") {
    const agentId = interaction.options.getString("agent_id", true);
    const status = interaction.options.getString("status", true);

    try {
      const updated = await updateAgentBotStatus(agentId, status); // Await boolean return
      if (updated) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Agent ${agentId} status updated to ${status}.` });
      } else {
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Agent ${agentId} not found.` });
      }
    } catch (error) {
      console.error(`Error updating agent token status: ${error}`);
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Failed to update agent token status: ${error.message}` });
    }
    return;
  }

  if (sub === "delete_token") {
    const agentId = interaction.options.getString("agent_id", true);

    try {
      const allAgents = await fetchAgentBots();
      const agentToDelete = allAgents.find(a => a.agent_id === agentId);

      if (!agentToDelete) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Agent token ${agentId} not found.` });
        return;
      }

      const confirmId = `confirm_delete_${agentId}_${Date.now()}`;
      const cancelId = `cancel_delete_${agentId}_${Date.now()}`;

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(cancelId)
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(confirmId)
            .setLabel("Confirm Delete")
            .setStyle(ButtonStyle.Danger),
        );

      const reply = await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `Are you sure you want to delete agent **${agentToDelete.tag}** (\`${agentId}\`)?\nThis action cannot be undone.`,
        components: [row]
      });

      const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 15000,
        filter: i => i.user.id === interaction.user.id,
      });

      collector.on('collect', async i => {
        if (i.customId === confirmId) {
          const deleted = await deleteAgentBot(agentId);
          if (deleted) {
            await i.update({ content: `✅ Agent token **${agentToDelete.tag}** (\`${agentId}\`) has been deleted.`, components: [] });
          } else {
            await i.update({ content: `❌ Failed to delete agent token ${agentId}. It may have already been deleted.`, components: [] });
          }
        } else {
          await i.update({ content: "Deletion cancelled.", components: [] });
        }
        collector.stop();
      });

      collector.on('end', collected => {
        if (collected.size === 0) {
          interaction.editReply({ content: "Confirmation timed out. Deletion cancelled.", components: [] });
        }
      });

    } catch (error) {
      console.error(`Error during agent token deletion process: ${error}`);
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `An error occurred: ${error.message}` });
    }
    return;
  }

  if (sub === "set_profile") {
    const agentId = interaction.options.getString("agent_id", true);
    const profileString = interaction.options.getString("profile", true);

    let profileJson;
    try {
      profileJson = JSON.parse(profileString);
    } catch (error) {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Invalid JSON provided for profile: ${error.message}` });
      return;
    }

    try {
      const updated = await updateAgentBotProfile(agentId, profileJson);
      if (updated) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: `✅ Profile for agent ${agentId} has been updated.` });
      } else {
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Agent ${agentId} not found.` });
      }
    } catch (error) {
      console.error(`Error setting agent profile: ${error}`);
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `An error occurred while setting the profile: ${error.message}` });
    }
    return;
  }

  if (sub === "get_profile") {
    const agentId = interaction.options.getString("agent_id", true);

    try {
      const profile = await fetchAgentBotProfile(agentId);
      if (profile) {
        const profileString = JSON.stringify(profile, null, 2);
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Profile for **${agentId}**:\n\`\`\`json\n${profileString}\n\`\`\`` });
      } else {
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: `No profile set for agent ${agentId}.` });
      }
    } catch (error) {
      console.error(`Error fetching agent profile: ${error}`);
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `An error occurred while fetching the profile: ${error.message}` });
    }
    return;
  }
}
