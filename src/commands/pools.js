import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import * as storageLayer from '../utils/storage.js';

const BOT_OWNER_ID = process.env.BOT_OWNER_ID || '1122800062628634684'; // goot27

export const meta = {
  guildOnly: false, // Pool management can be done outside guilds
  userPerms: [],
  category: "pools"
};

export const data = new SlashCommandBuilder()
    .setName('pools')
    .setDescription('Manage agent pools')
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('View available pools')
    )
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a new agent pool')
        .addStringOption((opt) =>
          opt
            .setName('name')
            .setDescription('Pool display name')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('visibility')
            .setDescription('Pool visibility')
            .setRequired(true)
            .addChoices(
              { name: 'Public', value: 'public' },
              { name: 'Private', value: 'private' }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription('View details of a pool')
        .addStringOption((opt) =>
          opt
            .setName('pool')
            .setDescription('Pool ID (e.g., pool_goot27)')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('select')
        .setDescription('Select which pool this guild uses (admin only)')
        .addStringOption((opt) =>
          opt
            .setName('pool')
            .setDescription('Pool ID to use for agent deployments')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('settings')
        .setDescription('Manage your pool settings')
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Delete your pool (owner only)')
        .addStringOption((opt) =>
          opt
            .setName('pool')
            .setDescription('Pool ID to delete')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('transfer')
        .setDescription('Transfer pool ownership')
        .addStringOption((opt) =>
          opt
            .setName('pool')
            .setDescription('Pool ID to transfer')
            .setRequired(true)
        )
        .addUserOption((opt) =>
          opt
            .setName('user')
            .setDescription('New owner')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('admin_list')
        .setDescription('List all pools including private (master only)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('admin_view')
        .setDescription('View any pool details (master only)')
        .addStringOption((opt) =>
          opt
            .setName('pool')
            .setDescription('Pool ID')
            .setRequired(true)
        )
    );

export async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    try {
      switch (subcommand) {
        case 'list':
          await handleList(interaction);
          break;
        case 'create':
          await handleCreate(interaction);
          break;
        case 'view':
          await handleView(interaction);
          break;
        case 'select':
          await handleSelect(interaction);
          break;
        case 'settings':
          await handleSettings(interaction);
          break;
        case 'delete':
          await handleDelete(interaction);
          break;
        case 'transfer':
          await handleTransfer(interaction);
          break;
        case 'admin_list':
          await handleAdminList(interaction);
          break;
        case 'admin_view':
          await handleAdminView(interaction);
          break;
        default:
          await interaction.reply({
            content: '❌ Unknown subcommand.',
            ephemeral: true,
          });
      }
    } catch (error) {
      console.error('[pools]', error);
      const replyMethod = interaction.deferred ? 'editReply' : 'reply';
      await interaction[replyMethod]({
        content: `❌ Error: ${error.message}`,
        ephemeral: true,
      }).catch(() => {});
    }
}

// ========== HELPERS ==========

function isMaster(userId) {
  return userId === BOT_OWNER_ID;
}

function isGuildAdmin(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

async function canAccessPool(userId, poolId, pool) {
  // Master can access everything
  if (isMaster(userId)) return true;
  
  // Owner can access their pool
  if (pool && pool.owner_user_id === userId) return true;
  
  // Public pools can be viewed by anyone
  if (pool && pool.visibility === 'public') return true;
  
  return false;
}

// ========== LIST POOLS ==========

async function handleList(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const allPools = await storageLayer.listPools();
  
  if (!allPools || allPools.length === 0) {
    return interaction.editReply({
      content: '📦 No pools found.',
    });
  }

  // Filter pools based on visibility and ownership
  const visiblePools = allPools.filter((pool) => {
    if (isMaster(userId)) return true;
    if (pool.owner_user_id === userId) return true;
    if (pool.visibility === 'public') return true;
    return false;
  });

  if (visiblePools.length === 0) {
    return interaction.editReply({
      content: '📦 No pools available.',
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('📦 Agent Pools')
    .setColor(0x5865f2)
    .setDescription('Available agent pools for deployments')
    .setTimestamp();

  for (const pool of visiblePools) {
    const agents = await storageLayer.fetchPoolAgents(pool.pool_id);
    const agentCount = agents ? agents.length : 0;
    const visIcon = pool.visibility === 'public' ? '🌐' : '🔒';
    const owner = pool.owner_user_id === BOT_OWNER_ID ? 'goot27 (Master)' : `<@${pool.owner_user_id}>`;
    
    let fieldValue = `${visIcon} **${pool.visibility}** | Owner: ${owner}\n`;
    fieldValue += `Agents: **${agentCount}**`;
    
    if (pool.visibility === 'public' && agentCount > 0) {
      const activeAgents = agents.filter(a => a.status === 'active');
      fieldValue += ` (${activeAgents.length} active)`;
    }
    
    embed.addFields({
      name: `${pool.name} \`${pool.pool_id}\``,
      value: fieldValue,
      inline: false,
    });
  }

  embed.setFooter({ text: `Total visible pools: ${visiblePools.length}` });

  await interaction.editReply({ embeds: [embed] });
}

// ========== CREATE POOL ==========

async function handleCreate(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const poolName = interaction.options.getString('name');
  const visibility = interaction.options.getString('visibility');

  // Generate pool ID
  const poolId = `pool_${userId}`;

  // Check if user already has a pool
  const existing = await storageLayer.fetchPool(poolId);
  if (existing) {
    return interaction.editReply({
      content: `❌ You already have a pool: **${existing.name}** (\`${poolId}\`)`,
    });
  }

  // Create the pool
  const created = await storageLayer.createPool(poolId, userId, poolName, visibility);
  
  if (!created) {
    return interaction.editReply({
      content: '❌ Failed to create pool. Please try again.',
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('✅ Pool Created')
    .setColor(0x57f287)
    .setDescription(`Your pool **${poolName}** has been created.`)
    .addFields(
      { name: 'Pool ID', value: `\`${poolId}\``, inline: true },
      { name: 'Visibility', value: visibility === 'public' ? '🌐 Public' : '🔒 Private', inline: true },
      { name: 'Owner', value: `<@${userId}>`, inline: true }
    )
    .setFooter({ text: 'Use /agents add_token to add agents to your pool' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ========== VIEW POOL ==========

async function handleView(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const poolId = interaction.options.getString('pool');

  const pool = await storageLayer.fetchPool(poolId);
  
  if (!pool) {
    return interaction.editReply({
      content: `❌ Pool \`${poolId}\` not found.`,
    });
  }

  // Check access
  const hasAccess = await canAccessPool(userId, poolId, pool);
  
  if (!hasAccess) {
    return interaction.editReply({
      content: `🔒 Pool \`${poolId}\` is private and you don't have access.`,
    });
  }

  // Fetch agents in this pool
  const agents = await storageLayer.fetchPoolAgents(poolId);
  const agentCount = agents ? agents.length : 0;
  const activeAgents = agents ? agents.filter(a => a.status === 'active') : [];

  const embed = new EmbedBuilder()
    .setTitle(`📦 ${pool.name}`)
    .setColor(pool.visibility === 'public' ? 0x5865f2 : 0x99aab5)
    .setDescription(`Pool ID: \`${pool.pool_id}\``)
    .addFields(
      { name: 'Owner', value: `<@${pool.owner_user_id}>`, inline: true },
      { name: 'Visibility', value: pool.visibility === 'public' ? '🌐 Public' : '🔒 Private', inline: true },
      { name: 'Total Agents', value: `${agentCount}`, inline: true },
      { name: 'Active Agents', value: `${activeAgents.length}`, inline: true },
      { name: 'Created', value: `<t:${Math.floor(pool.created_at / 1000)}:R>`, inline: true }
    )
    .setTimestamp();

  // Show agent list if owner or public
  if (pool.owner_user_id === userId || isMaster(userId) || pool.visibility === 'public') {
    if (agentCount > 0) {
      const agentList = agents
        .slice(0, 10) // Max 10 agents
        .map((a) => {
          const statusIcon = a.status === 'active' ? '🟢' : '🔴';
          return `${statusIcon} ${a.tag} (\`${a.agent_id}\`)`;
        })
        .join('\n');
      
      embed.addFields({
        name: 'Agents',
        value: agentList + (agentCount > 10 ? `\n*...and ${agentCount - 10} more*` : ''),
      });
    } else {
      embed.addFields({
        name: 'Agents',
        value: '*No agents registered*',
      });
    }
  }

  await interaction.editReply({ embeds: [embed] });
}

// ========== SELECT POOL ==========

async function handleSelect(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const poolId = interaction.options.getString('pool');

  // Check if user is guild admin or master
  if (!isGuildAdmin(interaction.member) && !isMaster(userId)) {
    return interaction.editReply({
      content: '❌ You need Administrator permissions to select a pool for this guild.',
    });
  }

  // Verify pool exists
  const pool = await storageLayer.fetchPool(poolId);
  if (!pool) {
    return interaction.editReply({
      content: `❌ Pool \`${poolId}\` not found.`,
    });
  }

  // Set guild's selected pool
  const guildId = interaction.guild.id;
  await storageLayer.setGuildSelectedPool(guildId, poolId);

  const embed = new EmbedBuilder()
    .setTitle('✅ Pool Selected')
    .setColor(0x57f287)
    .setDescription(`This guild will now use pool **${pool.name}** for agent deployments.`)
    .addFields(
      { name: 'Pool', value: `\`${poolId}\``, inline: true },
      { name: 'Visibility', value: pool.visibility === 'public' ? '🌐 Public' : '🔒 Private', inline: true },
      { name: 'Owner', value: `<@${pool.owner_user_id}>`, inline: true }
    )
    .setFooter({ text: 'Use /agents deploy to deploy agents from this pool' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ========== SETTINGS ==========

async function handleSettings(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const poolId = `pool_${userId}`;

  const pool = await storageLayer.fetchPool(poolId);
  
  if (!pool) {
    return interaction.editReply({
      content: '❌ You don\'t have a pool yet. Use `/pools create` to create one.',
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('⚙️ Pool Settings')
    .setColor(0x5865f2)
    .setDescription(`Manage settings for **${pool.name}**`)
    .addFields(
      { name: 'Pool ID', value: `\`${pool.pool_id}\``, inline: true },
      { name: 'Visibility', value: pool.visibility === 'public' ? '🌐 Public' : '🔒 Private', inline: true }
    )
    .setFooter({ text: 'Use /pools delete to remove your pool' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ========== DELETE POOL ==========

async function handleDelete(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const poolId = interaction.options.getString('pool');

  const pool = await storageLayer.fetchPool(poolId);
  
  if (!pool) {
    return interaction.editReply({
      content: `❌ Pool \`${poolId}\` not found.`,
    });
  }

  // Check ownership
  if (pool.owner_user_id !== userId && !isMaster(userId)) {
    return interaction.editReply({
      content: '❌ You can only delete pools you own.',
    });
  }

  // Check if pool has agents
  const agents = await storageLayer.fetchPoolAgents(poolId);
  if (agents && agents.length > 0) {
    return interaction.editReply({
      content: `❌ Cannot delete pool with agents. Remove all agents first (${agents.length} agents registered).`,
    });
  }

  // Delete the pool
  const deleted = await storageLayer.deletePool(poolId);
  
  if (!deleted) {
    return interaction.editReply({
      content: '❌ Failed to delete pool. Please try again.',
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('🗑️ Pool Deleted')
    .setColor(0xed4245)
    .setDescription(`Pool **${pool.name}** has been deleted.`)
    .addFields(
      { name: 'Pool ID', value: `\`${poolId}\``, inline: true }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ========== TRANSFER OWNERSHIP ==========

async function handleTransfer(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const poolId = interaction.options.getString('pool');
  const newOwner = interaction.options.getUser('user');

  const pool = await storageLayer.fetchPool(poolId);
  
  if (!pool) {
    return interaction.editReply({
      content: `❌ Pool \`${poolId}\` not found.`,
    });
  }

  // Check ownership
  if (pool.owner_user_id !== userId && !isMaster(userId)) {
    return interaction.editReply({
      content: '❌ You can only transfer pools you own.',
    });
  }

  // Update ownership
  const updated = await storageLayer.updatePool(poolId, {
    owner_user_id: newOwner.id,
  });
  
  if (!updated) {
    return interaction.editReply({
      content: '❌ Failed to transfer pool. Please try again.',
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('🔄 Pool Transferred')
    .setColor(0xfee75c)
    .setDescription(`Pool **${pool.name}** has been transferred.`)
    .addFields(
      { name: 'Pool ID', value: `\`${poolId}\``, inline: true },
      { name: 'Previous Owner', value: `<@${userId}>`, inline: true },
      { name: 'New Owner', value: `<@${newOwner.id}>`, inline: true }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ========== ADMIN LIST (MASTER ONLY) ==========

async function handleAdminList(interaction) {
  const userId = interaction.user.id;
  
  if (!isMaster(userId)) {
    return interaction.reply({
      content: '❌ This command is restricted to the bot master (goot27).',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const allPools = await storageLayer.listPools();
  
  if (!allPools || allPools.length === 0) {
    return interaction.editReply({
      content: '📦 No pools found.',
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('🔐 All Pools (Master View)')
    .setColor(0xfee75c)
    .setDescription('Complete list of all pools including private')
    .setTimestamp();

  for (const pool of allPools) {
    const agents = await storageLayer.fetchPoolAgents(pool.pool_id);
    const agentCount = agents ? agents.length : 0;
    const activeCount = agents ? agents.filter(a => a.status === 'active').length : 0;
    const visIcon = pool.visibility === 'public' ? '🌐' : '🔒';
    
    embed.addFields({
      name: `${pool.name} \`${pool.pool_id}\``,
      value: `${visIcon} ${pool.visibility} | Owner: <@${pool.owner_user_id}>\nAgents: ${agentCount} (${activeCount} active)`,
      inline: false,
    });
  }

  embed.setFooter({ text: `Total pools: ${allPools.length}` });

  await interaction.editReply({ embeds: [embed] });
}

// ========== ADMIN VIEW (MASTER ONLY) ==========

async function handleAdminView(interaction) {
  const userId = interaction.user.id;
  
  if (!isMaster(userId)) {
    return interaction.reply({
      content: '❌ This command is restricted to the bot master (goot27).',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const poolId = interaction.options.getString('pool');
  const pool = await storageLayer.fetchPool(poolId);
  
  if (!pool) {
    return interaction.editReply({
      content: `❌ Pool \`${poolId}\` not found.`,
    });
  }

  const agents = await storageLayer.fetchPoolAgents(poolId);
  const agentCount = agents ? agents.length : 0;
  const activeAgents = agents ? agents.filter(a => a.status === 'active') : [];

  const embed = new EmbedBuilder()
    .setTitle(`🔐 ${pool.name} (Master View)`)
    .setColor(0xfee75c)
    .setDescription(`Pool ID: \`${pool.pool_id}\``)
    .addFields(
      { name: 'Owner', value: `<@${pool.owner_user_id}>`, inline: true },
      { name: 'Visibility', value: pool.visibility === 'public' ? '🌐 Public' : '🔒 Private', inline: true },
      { name: 'Total Agents', value: `${agentCount}`, inline: true },
      { name: 'Active Agents', value: `${activeAgents.length}`, inline: true },
      { name: 'Created', value: `<t:${Math.floor(pool.created_at / 1000)}:R>`, inline: true },
      { name: 'Updated', value: `<t:${Math.floor(pool.updated_at / 1000)}:R>`, inline: true }
    )
    .setTimestamp();

  if (agentCount > 0) {
    const agentList = agents
      .map((a) => {
        const statusIcon = a.status === 'active' ? '🟢' : '🔴';
        return `${statusIcon} ${a.tag} (\`${a.agent_id}\`) - Client: ${a.client_id}`;
      })
      .join('\n');
    
    embed.addFields({
      name: 'Agents',
      value: agentList.length > 1024 ? agentList.substring(0, 1020) + '...' : agentList,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}
