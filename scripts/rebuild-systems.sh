#!/bin/bash
# COMPREHENSIVE REBUILD - Music & Voice Systems

echo "==================================="
echo "REBUILDING CHOPSTICKS CORE SYSTEMS"
echo "==================================="

# 1. Create missing voice event handler
cat > src/tools/voice/events.js << 'EOF'
// Voice channel join-to-create event handler
import { Events } from "discord.js";
import * as VoiceDomain from "./domain.js";
import * as VoiceState from "./state.js";

export const name = Events.VoiceStateUpdate;

export async function execute(oldState, newState) {
  const guild = newState.guild;
  if (!guild) return;

  const oldChannel = oldState.channel;
  const newChannel = newState.channel;
  const member = newState.member;

  // User joined a channel
  if (!oldChannel && newChannel) {
    await handleJoin(guild, member, newChannel);
  }

  // User left a channel
  if (oldChannel && !newChannel) {
    await handleLeave(guild, oldChannel);
  }

  // User moved channels
  if (oldChannel && newChannel && oldChannel.id !== newChannel.id) {
    await handleJoin(guild, member, newChannel);
    await handleLeave(guild, oldChannel);
  }
}

async function handleJoin(guild, member, channel) {
  const lobbies = await VoiceDomain.getStatus(guild.id);
  const lobby = lobbies.lobbies?.[channel.id];

  if (!lobby || !lobby.enabled) return;

  // User joined a lobby - create temp channel
  try {
    const category = await guild.channels.fetch(lobby.categoryId);
    if (!category) return;

    const channelName = (lobby.nameTemplate || "{user}'s room").replace('{user}', member.displayName);

    const tempChannel = await guild.channels.create({
      name: channelName,
      type: 2, // Voice channel
      parent: lobby.categoryId,
      userLimit: lobby.userLimit || 0,
      bitrate: lobby.bitrateKbps ? lobby.bitrateKbps * 1000 : undefined
    });

    // Move user to temp channel
    await member.voice.setChannel(tempChannel);

    // Track temp channel
    VoiceState.trackTempChannel(guild.id, tempChannel.id, member.id);

    console.log(`[Voice] Created temp channel ${tempChannel.id} for ${member.displayName}`);
  } catch (err) {
    console.error(`[Voice] Failed to create temp channel:`, err);
  }
}

async function handleLeave(guild, channel) {
  // Check if empty temp channel
  const tempChannels = VoiceState.getTempChannels(guild.id);
  if (!tempChannels.includes(channel.id)) return;

  if (channel.members.size === 0) {
    try {
      await channel.delete();
      VoiceState.removeTempChannel(guild.id, channel.id);
      console.log(`[Voice] Deleted empty temp channel ${channel.id}`);
    } catch (err) {
      console.error(`[Voice] Failed to delete temp channel:`, err);
    }
  }
}
EOF

# 2. Fix voice state tracking
cat > src/tools/voice/state.js << 'EOF'
// Process-local voice state
const tempChannels = new Map(); // guildId -> Set<channelId>

export function trackTempChannel(guildId, channelId, ownerId) {
  if (!tempChannels.has(guildId)) {
    tempChannels.set(guildId, new Set());
  }
  tempChannels.get(guildId).add(channelId);
}

export function removeTempChannel(guildId, channelId) {
  tempChannels.get(guildId)?.delete(channelId);
}

export function getTempChannels(guildId) {
  return Array.from(tempChannels.get(guildId) || []);
}

export function clearGuild(guildId) {
  tempChannels.delete(guildId);
}
EOF

# 3. Fix agent control plane logging
cat > /tmp/fix_music.patch << 'EOF'
--- a/src/index.js
+++ b/src/index.js
@@ -464,6 +464,8 @@ client.on(Events.InteractionCreate, async interaction => {
   if (!interaction.isChatInputCommand()) return;

   const commandName = interaction.commandName;
+  console.log(`[command:${commandName}] Received from user ${interaction.user.id} in guild ${interaction.guildId}`);
+
   const command = client.commands.get(commandName);

   if (!command) {
EOF

patch -p1 < /tmp/fix_music.patch

# 4. Add detailed agent request logging
cat >> src/agents/agentManager.js << 'EOF'

// Enhanced logging for debugging
const originalRequest = AgentManager.prototype.request;
AgentManager.prototype.request = function(agent, op, data) {
  console.log(`[AgentManager] RPC request: ${op} to agent ${agent.agentId}`);
  return originalRequest.call(this, agent, op, data).catch(err => {
    console.error(`[AgentManager] RPC failed: ${op}`, err.message);
    throw err;
  });
};
EOF

# 5. Rebuild Docker images
echo "Rebuilding Docker images..."
docker compose -f docker-compose.stack.yml -f docker-compose.voice.yml -f docker-compose.override.yml build main-bot agent-runner

# 6. Restart services
echo "Restarting services..."
docker compose -f docker-compose.stack.yml -f docker-compose.voice.yml -f docker-compose.override.yml up -d main-bot agent-runner

echo ""
echo "==================================="
echo "REBUILD COMPLETE"
echo "==================================="
echo ""
echo "Wait 15 seconds, then test:"
echo "  /music play test"
echo "  /voice add"
echo ""
echo "Check logs with:"
echo "  docker logs chopsticks-main-bot -f"
