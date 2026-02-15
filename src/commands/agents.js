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
  fetchAgentBotProfile,
  fetchPool,
  fetchPoolsByOwner,
  getGuildSelectedPool,
  fetchPoolAgents,
  listPools,
  loadGuildData,
  saveGuildData
} from "../utils/storage.js";
import { replyEmbed, replyEmbedWithJson, buildEmbed } from "../utils/discordOutput.js";
import { getBotOwnerIds, isBotOwner } from "../utils/owners.js";

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
          .setDescription("Total number of agents you want available in this guild (multiples of 10, max 49)")
          .setRequired(true)
          .setMinValue(10) // Enforce minimum package size
          .setMaxValue(49)  // Enforce maximum total agents (Level 1: Invariants Locked)
      )
      .addStringOption(o =>
        o
          .setName("from_pool")
          .setDescription("Deploy from specific pool (leave empty to use guild default)")
          .setRequired(false)
      )
  )
  .addSubcommand(s =>
    s
      .setName("idle_policy")
      .setDescription("View or configure idle auto-release timeout for this server")
      .addIntegerOption(o =>
        o
          .setName("minutes")
          .setDescription("Idle minutes before release (1-720)")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(720)
      )
      .addBooleanOption(o =>
        o
          .setName("use_default")
          .setDescription("Clear this server override and use global default")
          .setRequired(false)
      )
      .addBooleanOption(o =>
        o
          .setName("disable")
          .setDescription("Disable idle auto-release for this server")
          .setRequired(false)
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
      .setDescription("Register your bot agent")
      .addStringOption(o => o.setName("token").setDescription("Discord Bot Token").setRequired(true))
      .addStringOption(o => o.setName("client_id").setDescription("Bot Application/Client ID").setRequired(true))
      .addStringOption(o => o.setName("tag").setDescription("Bot username (e.g., MyBot#1234)").setRequired(true))
      .addStringOption(o => o.setName("pool").setDescription("Target pool ID (use /pools public to see options)").setRequired(false))
  )
  .addSubcommand(s =>
    s
      .setName("verify_membership")
      .setDescription("Force check which agents are actually in this guild (admin only)")
  )
  .addSubcommand(s => s.setName("list_tokens").setDescription("View registered agents in accessible pools"))
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
  const ownerIds = getBotOwnerIds();
  const requesterIsBotOwner = isBotOwner(interaction.user.id);
  const ownerOnlySubcommands = new Set([
    "add_token",
    "delete_token",
    "set_profile",
    "update_token_status",
    "scale",
    "restart"
  ]);

  if (ownerOnlySubcommands.has(sub) && !requesterIsBotOwner) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "This command is restricted to the Bot Owner."
    });
    return;
  }
  // -----------------------------

  if (sub === "status") {
    try {
      const allAgents = await fetchAgentBots(); // Fetch all registered agents from DB
      const liveAgents = await mgr.listAgents(); // Currently connected agents
      const liveAgentIds = new Set(liveAgents.map(a => a.agentId));

      const inGuild = liveAgents.filter(a => a.guildIds.includes(guildId));
      const idleInGuild = inGuild.filter(a => a.ready && !a.busyKey);
      const busyInGuild = inGuild.filter(a => a.ready && a.busyKey);

      const registeredButNotInGuild = allAgents.filter(a => !liveAgentIds.has(a.agent_id) || !liveAgents.find(la => la.agentId === a.agent_id)?.guildIds.includes(guildId));
      const invitable = registeredButNotInGuild.filter(a => a.status === 'active'); // Only active registered agents are invitable

      const embed = new EmbedBuilder()
        .setTitle("🤖 Agent Status")
        .setColor(0x5865f2)
        .setTimestamp()
        .addFields(
          { 
            name: "📊 Overview", 
            value: `**Registered:** ${allAgents.length} agents\n**Connected:** ${liveAgents.length} online\n**Available:** ${idleInGuild.length} ready for music` 
          },
          { 
            name: `📍 This Guild (${inGuild.length} total)`, 
            value: `✅ **Idle:** ${idleInGuild.length}\n⏳ **Busy:** ${busyInGuild.length}\n🔴 **Offline:** ${registeredButNotInGuild.length}` 
          }
        );

      const liveInGuildText = inGuild
        .sort((x, y) => String(x.agentId).localeCompare(String(y.agentId)))
        .map(a => {
          let statusIcon = '🔴';
          let statusText = 'down';
          
          if (a.ready) {
            if (a.busyKey) {
              statusIcon = '⏳';
              statusText = `busy (${a.busyKind || "?"})`;
            } else {
              statusIcon = '✅';
              statusText = 'idle';
            }
          }
          
          const ident = a.tag ? `${a.tag}` : (a.botUserId ? `User ${a.botUserId}` : "unknown-id");
          return `${statusIcon} \`${a.agentId}\` - **${statusText}** - ${ident}`;
        })
        .join("\n");

      if (liveInGuildText) {
        embed.addFields({ name: "🟢 Connected Agents", value: liveInGuildText.slice(0, 1024) });
      } else {
        embed.addFields({ name: "🟢 Connected Agents", value: "No agents connected to this guild.\n💡 Use `/agents deploy <count>` to get started." });
      }

      const invitableText = invitable
        .sort((x, y) => String(x.agent_id).localeCompare(String(y.agent_id)))
        .map(a => `⭕ \`${a.agent_id}\` - ${a.tag}`)
        .join("\n");

      if (invitableText) {
        embed.addFields({ name: "Invitable Agents", value: invitableText.slice(0, 1024) });
      }

      await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed] });
    } catch (error) {
      console.error(`[agents:status] Error: ${error.message}`);
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Failed to fetch agent status: ${error.message}` });
    }
    return;
  }

  if (sub === "manifest") {
    try {
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
    } catch (error) {
      console.error(`[agents:manifest] Error: ${error.message}`);
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Failed to fetch agent manifest: ${error.message}` });
    }
    return;
  }

  if (sub === "deploy") {
    try {
      const desiredTotal = interaction.options.getInteger("desired_total", true);
      const fromPoolOption = interaction.options.getString("from_pool", false);

      if (desiredTotal % 10 !== 0) {
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          content: `The desired total number of agents must be a multiple of 10. You entered ${desiredTotal}.`
        });
        return;
      }

      // Defer reply because verification may take time
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Determine which pool to use
      let selectedPoolId;
      if (fromPoolOption) {
        // User specified a pool - verify it exists and is accessible
        const specifiedPool = await fetchPool(fromPoolOption);
        if (!specifiedPool) {
          return await interaction.editReply({
            content: `Pool \`${fromPoolOption}\` not found.\nUse \`/pools public\` to see available pools.`
          });
        }
        
        // Check if pool is accessible
        const userId = interaction.user.id;
        const isOwner = specifiedPool.owner_user_id === userId || ownerIds.has(userId);
        const isPublic = specifiedPool.visibility === 'public';
        
        if (!isOwner && !isPublic) {
          return await interaction.editReply({
            content: `Cannot access private pool \`${fromPoolOption}\`.\nUse \`/pools public\` to see available pools.`
          });
        }
        
        selectedPoolId = fromPoolOption;
      } else {
        // Use guild's default pool
        selectedPoolId = await getGuildSelectedPool(guildId);
      }
      
      const pool = await fetchPool(selectedPoolId);
      
      const plan = await mgr.buildDeployPlan(guildId, desiredTotal, selectedPoolId); // Now async with poolId

      // Check for limit error (Level 1: Invariants Locked)
      if (plan.error) {
        await interaction.editReply({
          content: `❌ ${plan.error}\n\nThe platform enforces a maximum of 49 agents per guild to ensure system stability.`
        });
        return;
      }

      const lines = [];
      lines.push(`** Pool:** ${pool ? pool.name : selectedPoolId} (\`${selectedPoolId}\`)`);
      if (fromPoolOption) {
        lines.push(`_Using specified pool (guild default: \`${await getGuildSelectedPool(guildId)}\`)_`);
      } else {
        lines.push(`_Guild default pool - Change with \`/pools select\`_`);
      }
      lines.push("");
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
          lines.push("No agents available from this pool.");
          lines.push("");
          lines.push("**Options:**");
          lines.push("- Deploy from different pool: `/agents deploy from_pool:pool_id`");
          lines.push("- See public pools: `/pools public`");
          lines.push("- Change guild default: `/pools select pool:pool_id`");
          lines.push("");
          lines.push("**Or contribute agents to this pool:**");
          lines.push("1. Use `/agents add_token pool:"+selectedPoolId+"` to register agents.");
          lines.push("2. Ensure agents are marked `active` using `/agents update_token_status`.");
          lines.push("3. Start `chopsticks-agent-runner` to bring agents online.");
          lines.push("4. Rerun `/agents deploy`.");
      }

      await interaction.editReply({ content: lines.join("\n").slice(0, 1900) });
    } catch (error) {
      console.error(`[agents:deploy] Error: ${error.message}`);
      const content = `Failed to deploy agents: ${error.message}`;
      if (interaction.deferred) {
        await interaction.editReply({ content });
      } else {
        await interaction.reply({ flags: MessageFlags.Ephemeral, content });
      }
    }
    return;
  }

  if (sub === "idle_policy") {
    try {
      const minutes = interaction.options.getInteger("minutes", false);
      const useDefault = interaction.options.getBoolean("use_default", false) === true;
      const disable = interaction.options.getBoolean("disable", false) === true;
      const configured = (minutes !== null ? 1 : 0) + (useDefault ? 1 : 0) + (disable ? 1 : 0);

      if (configured > 1) {
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          content: "Use only one option: `minutes`, `use_default`, or `disable`."
        });
        return;
      }

      const defaultIdleMs = typeof mgr.getDefaultIdleReleaseMs === "function"
        ? mgr.getDefaultIdleReleaseMs()
        : Math.max(0, Number(process.env.AGENT_SESSION_IDLE_RELEASE_MS || 1_800_000));

      const data = await loadGuildData(guildId);
      if (!data.agents || typeof data.agents !== "object" || Array.isArray(data.agents)) {
        data.agents = {};
      }

      let changed = false;
      if (useDefault) {
        delete data.agents.idleReleaseMs;
        changed = true;
      } else if (disable) {
        data.agents.idleReleaseMs = 0;
        changed = true;
      } else if (minutes !== null) {
        data.agents.idleReleaseMs = Math.trunc(Number(minutes) * 60_000);
        changed = true;
      }

      if (changed) {
        await saveGuildData(guildId, data);
        if (typeof mgr.clearGuildIdleReleaseCache === "function") {
          mgr.clearGuildIdleReleaseCache(guildId);
        }
      }

      const guildOverride = Number(data?.agents?.idleReleaseMs);
      const hasOverride = Number.isFinite(guildOverride);
      const effectiveMs = hasOverride
        ? (guildOverride <= 0 ? 0 : guildOverride)
        : (defaultIdleMs <= 0 ? 0 : defaultIdleMs);
      const effectiveMin = effectiveMs > 0 ? Math.max(1, Math.round(effectiveMs / 60_000)) : 0;
      const defaultMin = defaultIdleMs > 0 ? Math.max(1, Math.round(defaultIdleMs / 60_000)) : 0;

      const lines = [];
      lines.push("**Idle Auto-Release Policy**");
      lines.push(`Default (global): ${defaultIdleMs > 0 ? `${defaultMin}m` : "disabled"}`);

      if (hasOverride) {
        lines.push(`Server override: ${guildOverride > 0 ? `${Math.max(1, Math.round(guildOverride / 60_000))}m` : "disabled"}`);
      } else {
        lines.push("Server override: none (using default)");
      }

      lines.push(`Effective in this server: ${effectiveMs > 0 ? `${effectiveMin}m` : "disabled"}`);
      lines.push("");
      lines.push("Use `/agents idle_policy minutes:<1-720>` to set, `disable:true` to disable, or `use_default:true` to clear override.");

      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: lines.join("\n")
      });
    } catch (error) {
      console.error(`[agents:idle_policy] Error: ${error.message}`);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `Failed to update idle policy: ${error.message}`
      });
    }
    return;
  }

  if (sub === "verify_membership") {
    // Check admin permissions
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "Only server administrators can verify agent membership."
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = await interaction.guild.fetch();
    const agentsToCheck = [];
    
    // Get all agents that claim to be in this guild
    for (const agent of mgr.liveAgents.values()) {
      if (agent.guildIds?.has?.(guildId) && agent.botUserId) {
        agentsToCheck.push(agent);
      }
    }

    if (agentsToCheck.length === 0) {
      await interaction.editReply({
        content: "No agents claim to be in this guild.\n\nUse `/agents deploy` to invite agents."
      });
      return;
    }

    // Fetch actual members from Discord
    const members = await guild.members.fetch({ 
      user: agentsToCheck.map(a => a.botUserId),
      force: true // Force cache refresh
    }).catch(err => {
      console.error("[VERIFY_MEMBERSHIP] Error fetching members:", err);
      return null; // Indicate failure
    });

    if (members === null) {
      await interaction.editReply({
        content: "Failed to verify agent membership due to Discord API error.\n\nAgents were not removed from cache. Please try again later."
      });
      return;
    }

    const lines = [];
    lines.push(`**Agent Membership Verification**`);
    lines.push(`Checked ${agentsToCheck.length} agent(s):\n`);

    let verified = 0, removed = 0;

    for (const agent of agentsToCheck) {
      const inGuild = members.has(agent.botUserId);
      
      if (inGuild) {
        lines.push(`${agent.agentId} (${agent.tag}) - In guild`);
        verified++;
      } else {
        lines.push(`${agent.agentId} (${agent.tag}) - NOT in guild (removed from cache)`);
        agent.guildIds.delete(guildId);
        removed++;
      }
    }

    lines.push("");
    lines.push(`**Summary:**`);
    lines.push(`Verified: ${verified}`);
    lines.push(`Removed: ${removed}`);
    
    if (removed > 0) {
      lines.push("");
      lines.push("Run `/agents deploy` to re-invite agents.");
    }

    await interaction.editReply({ content: lines.join("\n").slice(0, 1900) });
    return;
  }

  if (sub === "sessions") {
    try {
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
    } catch (error) {
      console.error(`[agents:sessions] Error: ${error.message}`);
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Failed to fetch sessions: ${error.message}` });
    }
    return;
  }

  if (sub === "assign") {
    try {
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
    } catch (error) {
      console.error(`[agents:assign] Error: ${error.message}`);
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Failed to assign agent: ${error.message}` });
    }
    return;
  }

  if (sub === "release") {
    try {
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
    } catch (error) {
      console.error(`[agents:release] Error: ${error.message}`);
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Failed to release session: ${error.message}` });
    }
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
    const poolOption = interaction.options.getString("pool", false);
    const agentId = `agent${clientId}`;
    const userId = interaction.user.id;

    // Defer immediately since we're doing validation and database queries
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // STEP 1: Validate token is real by attempting to fetch bot user
      let botUser;
      try {
        const { Client, GatewayIntentBits } = await import('discord.js');
        const testClient = new Client({ intents: [GatewayIntentBits.Guilds] });
        
        // Set timeout for validation
        const validationPromise = new Promise(async (resolve, reject) => {
          testClient.once('ready', async () => {
            try {
              botUser = testClient.user;
              await testClient.destroy();
              resolve(botUser);
            } catch (err) {
              await testClient.destroy();
              reject(err);
            }
          });
          
          testClient.on('error', async (err) => {
            await testClient.destroy();
            reject(err);
          });
          
          await testClient.login(token);
        });
        
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Token validation timeout')), 10000)
        );
        
        botUser = await Promise.race([validationPromise, timeoutPromise]);
        
        // Verify client_id matches
        if (botUser.id !== clientId) {
          return await interaction.editReply({
            content: `Client ID mismatch. Token belongs to ${botUser.tag} (${botUser.id}), not ${clientId}.`
          });
        }
        
        // Verify tag matches (approximately)
        if (botUser.tag !== tag && botUser.username !== tag.split('#')[0]) {
          return await interaction.editReply({
            content: `Tag mismatch. Bot is actually **${botUser.tag}**. Please use correct tag and try again.`
          });
        }
        
      } catch (validationError) {
        console.error('[add_token] Token validation failed:', validationError.message);
        return await interaction.editReply({
          content: `Token validation failed. Ensure token is valid and bot exists.\n\`\`\`${validationError.message}\`\`\``
        });
      }

      // STEP 2: Determine target pool and check permissions
      let poolId;
      let isContribution = false;
      
      if (poolOption) {
        // User specified a pool - verify it exists
        const specifiedPool = await fetchPool(poolOption);
        if (!specifiedPool) {
          return await interaction.editReply({ 
            content: `Pool \`${poolOption}\` not found.` 
          });
        }
        
        // Check if user owns this pool
        if (specifiedPool.owner_user_id === userId || ownerIds.has(userId)) {
          // User owns pool - direct add
          poolId = poolOption;
        } else if (specifiedPool.visibility === 'public') {
          // Contributing to public pool - mark for verification
          poolId = poolOption;
          isContribution = true;
        } else {
          // Private pool they don't own
          return await interaction.editReply({ 
            content: `Cannot add to private pool \`${poolOption}\` - you don't own it.` 
          });
        }
      } else {
        // No pool specified - show available options
        const userPools = await fetchPoolsByOwner(userId);
        const publicPools = await listPools();
        const availablePublicPools = publicPools.filter(p => p.visibility === 'public');
        
        if (userPools && userPools.length > 0) {
          // User has their own pool - add there
          poolId = userPools[0].pool_id;
        } else {
          // No personal pool - must contribute to public pool
          if (availablePublicPools.length === 0) {
            return await interaction.editReply({
              content: `No public pools available for contribution.\nCreate your own with \`/pools create\``
            });
          }
          
          // Show available public pools
          let poolList = '**Available Public Pools:**\n';
          for (const p of availablePublicPools) {
            const owner = ownerIds.has(p.owner_user_id) ? 'Bot Owner' : `<@${p.owner_user_id}>`;
            poolList += `- \`${p.pool_id}\` - ${p.name} (by ${owner})\n`;
          }
          poolList += `\n**Choose a pool:**\nRe-run this command with \`pool:pool_id\` parameter`;
          poolList += `\nExample: \`/agents add_token pool:pool_goot27\``;
          poolList += `\n\nOr create your own pool: \`/pools create\``;
          
          return await interaction.editReply({
            content: poolList
          });
        }
      }

      // STEP 3: Handle contribution vs direct management
      if (isContribution) {
        // Contributing to public pool - requires verification
        const pool = await fetchPool(poolId);
        
        // Check rate limiting (max 3 contributions per user per hour)
        const recentContributions = await fetchAgentBots();
        const userContributions = recentContributions.filter(a => 
          a.pool_id === poolId && 
          a.status === 'inactive' && // Pending contributions are inactive
          Date.now() - a.created_at < 3600000 // Last hour
        );
        
        if (userContributions.length >= 3 && !ownerIds.has(userId)) {
          return await interaction.editReply({
            content: `Rate limit: You can contribute up to 3 agents per hour to public pools.\nPlease wait before adding more.`
          });
        }
        
        // Add as inactive (requires manual activation by pool owner)
        const result = await insertAgentBot(agentId, token, clientId, botUser.tag, poolId);
        await updateAgentBotStatus(agentId, 'inactive');
        
        const operationMsg = result.operation === 'inserted' ? 'submitted' : 'updated';
        await interaction.editReply({
          embeds: [{
            title: 'Contribution submitted',
            description: `Agent **${botUser.tag}** ${operationMsg} to **${pool.name}**.`,
            color: 0x57f287,
            fields: [
              { name: 'Agent ID', value: `\`${agentId}\``, inline: true },
              { name: 'Pool', value: `\`${poolId}\``, inline: true },
              { name: 'Status', value: 'pending', inline: true },
              { 
                name: 'Review',
                value: 'Pool owner reviews and activates if approved.'
              }
            ],
            timestamp: new Date()
          }]
        });
      } else {
        // Adding to own pool - direct activation
        const result = await insertAgentBot(agentId, token, clientId, botUser.tag, poolId);
        const operationMsg = result.operation === 'inserted' ? 'added' : 'updated';
        
        await interaction.editReply({
          embeds: [{
            title: `Agent ${operationMsg}`,
            description: `Agent **${botUser.tag}** is in your pool.`,
            color: 0x57f287,
            fields: [
              { name: 'Agent ID', value: `\`${agentId}\``, inline: true },
              { name: 'Pool', value: `\`${poolId}\``, inline: true },
              { name: 'Status', value: 'active', inline: true },
              { 
                name: 'Deployment',
                value: 'Use /agents deploy to invite to guilds.'
              }
            ],
            timestamp: new Date()
          }]
        });
      }
      
    } catch (error) {
      console.error(`[add_token] Error: ${error.message}`);
      await interaction.editReply({ 
        content: `Failed to add agent: ${error.message}` 
      });
    }
    return;
  }

  if (sub === "list_tokens") {
    // Defer immediately since we're fetching multiple pools
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const tokens = await fetchAgentBots();
      if (tokens.length === 0) {
        await interaction.editReply({ content: "No agent tokens registered." });
        return;
      }

      // Group by pool
      const poolMap = new Map();
      for (const token of tokens) {
        const poolId = token.pool_id || 'pool_goot27';
        if (!poolMap.has(poolId)) {
          poolMap.set(poolId, []);
        }
        poolMap.get(poolId).push(token);
      }

      // Fetch all pools at once to avoid sequential queries
      const poolIds = Array.from(poolMap.keys());
      const poolPromises = poolIds.map(id => fetchPool(id));
      const pools = await Promise.all(poolPromises);
      const poolDataMap = new Map();
      pools.forEach((pool, idx) => {
        if (pool) poolDataMap.set(poolIds[idx], pool);
      });

      const embed = new EmbedBuilder()
        .setTitle("Registered Agent Tokens")
        .setColor(0x0099ff)
        .setTimestamp();
        
      let description = '';
      for (const [poolId, poolTokens] of poolMap) {
        const pool = poolDataMap.get(poolId);
        const poolName = pool ? pool.name : poolId;
        const visIcon = pool?.visibility === 'public' ? '' : '';
        
        description += `\n**${visIcon} ${poolName}** (\`${poolId}\`)\n`;
        const tokenList = poolTokens
          .map(t => `**${t.agent_id}** (${t.tag})\nClient ID: \`${t.client_id}\` | Status: \`${t.status}\``)
          .join("\n");
        description += tokenList + '\n';
      }

      embed.setDescription(description.slice(0, 4096));

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(`Error listing agent tokens: ${error}`);
      await interaction.editReply({ content: `Failed to list agent tokens: ${error.message}` });
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
            await i.update({
              embeds: [buildEmbed("Agent token deleted", `${agentToDelete.tag} (${agentId})`)],
              components: []
            });
          } else {
            await i.update({
              embeds: [buildEmbed("Agent token delete failed", `Agent ${agentId} may already be deleted.`)],
              components: []
            });
          }
        } else {
          await i.update({ embeds: [buildEmbed("Agent token delete", "Deletion cancelled.")], components: [] });
        }
        collector.stop();
      });

      collector.on('end', collected => {
        if (collected.size === 0) {
          interaction.editReply({
            embeds: [buildEmbed("Agent token delete", "Confirmation timed out. Deletion cancelled.")],
            components: []
          });
        }
      });

    } catch (error) {
      console.error(`Error during agent token deletion process: ${error}`);
      await replyEmbed(interaction, "Agent token delete", `Error: ${error.message}`);
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
      await replyEmbed(interaction, "Agent profile", `Invalid JSON: ${error.message}`);
      return;
    }

    try {
      const updated = await updateAgentBotProfile(agentId, profileJson);
      if (updated) {
        await replyEmbed(interaction, "Agent profile updated", `Agent ${agentId}`);
      } else {
        await replyEmbed(interaction, "Agent profile", `Agent ${agentId} not found.`);
      }
    } catch (error) {
      console.error(`Error setting agent profile: ${error}`);
      await replyEmbed(interaction, "Agent profile", `Error: ${error.message}`);
    }
    return;
  }

  if (sub === "get_profile") {
    const agentId = interaction.options.getString("agent_id", true);

    try {
      const profile = await fetchAgentBotProfile(agentId);
      if (profile) {
        await replyEmbedWithJson(
          interaction,
          "Agent profile",
          `Agent ${agentId}`,
          profile,
          `agent-${agentId}-profile.json`
        );
      } else {
        await replyEmbed(interaction, "Agent profile", `No profile set for agent ${agentId}.`);
      }
    } catch (error) {
      console.error(`Error fetching agent profile: ${error}`);
      await replyEmbed(interaction, "Agent profile", `Error: ${error.message}`);
    }
    return;
  }
}
