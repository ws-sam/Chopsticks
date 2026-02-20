#!/usr/bin/env node
/**
 * Auto-register all Discord commands into the help registry
 * Parses command files and extracts metadata from SlashCommandBuilder
 */

import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { registerCommand } from '../src/utils/helpRegistry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const commandsPath = join(__dirname, '../src/commands');

const categoryMap = {
  // Core utilities
  'help': 'core', 'ping': 'core', 'botinfo': 'core', 'commands': 'core',
  
  // Economy & Fun
  'balance': 'economy', 'bank': 'economy', 'daily': 'economy', 'give': 'economy',
  'shop': 'economy', 'buy': 'economy', 'inventory': 'economy', 'use': 'economy',
  'craft': 'economy', 'collection': 'economy', 'leaderboard': 'economy',
  '8ball': 'fun', 'choose': 'fun', 'coinflip': 'fun', 'roll': 'fun', 'meme': 'fun',
  'joke': 'fun', 'roast': 'fun', 'rps': 'fun',
  
  // Moderation
  'ban': 'moderation', 'unban': 'moderation', 'kick': 'moderation',
  'timeout': 'moderation', 'untimeout': 'moderation', 'warn': 'moderation',
  'clearwarns': 'moderation', 'purge': 'moderation', 'lock': 'moderation',
  'unlock': 'moderation', 'slowmode': 'moderation', 'mute': 'moderation',
  'unmute': 'moderation', 'softban': 'moderation',
  
  // Voice & Audio
  'play': 'voice', 'pause': 'voice', 'resume': 'voice', 'skip': 'voice',
  'stop': 'voice', 'queue': 'voice', 'nowplaying': 'voice', 'shuffle': 'voice',
  'loop': 'voice', 'volume': 'voice', 'seek': 'voice', 'join': 'voice',
  'leave': 'voice', 'radio': 'voice',
  
  // Admin & Setup
  'setup': 'admin', 'config': 'admin', 'prefix': 'admin', 'setwelcome': 'admin',
  'setlogs': 'admin', 'autorole': 'admin', 'automations': 'admin',
  'customcommand': 'admin', 'custom': 'admin', 'alias': 'admin',
  'logs': 'admin', 'modlog': 'admin', 'settings': 'admin',
  
  // Agent/Advanced
  'agent': 'advanced', 'agents': 'advanced', 'assistant': 'advanced',
  'persona': 'advanced', 'task': 'advanced',
  
  // Utility
  'avatar': 'utility', 'userinfo': 'utility', 'serverinfo': 'utility',
  'poll': 'utility', 'remind': 'utility', 'search': 'utility',
  'translate': 'utility', 'weather': 'utility',
  
  // Tags/Custom
  'tag': 'utility', 'tags': 'utility',
};

async function loadCommand(filePath) {
  try {
    const module = await import(`file://${filePath}`);
    return module.default || module;
  } catch (err) {
    console.warn(`⚠️  Failed to load ${filePath}: ${err.message}`);
    return null;
  }
}

function extractMetadata(command, fileName) {
  const name = command.data?.name || fileName.replace('.js', '');
  const description = command.data?.description || 'No description';
  const category = categoryMap[name] || 'utility';
  
  // Extract options for usage examples
  const options = command.data?.options || [];
  const usage = options.length > 0
    ? `/${name} ${options.map(opt => opt.required ? `${opt.name}:<value>` : `[${opt.name}:<value>]`).join(' ')}`
    : `/${name}`;
  
  // Build examples
  const examples = [];
  if (options.length === 0) {
    examples.push(`/${name}`);
  } else {
    // Example with required params only
    const requiredParams = options.filter(opt => opt.required);
    if (requiredParams.length > 0) {
      examples.push(`/${name} ${requiredParams.map(opt => `${opt.name}:example`).join(' ')}`);
    } else {
      examples.push(`/${name}`);
    }
    
    // Example with all params (if optional exist)
    if (options.length > requiredParams.length) {
      examples.push(`/${name} ${options.map(opt => `${opt.name}:value`).join(' ')}`);
    }
  }
  
  // Determine permissions
  const permissions = [];
  if (command.requiresAdmin || name.includes('setup') || name.includes('config')) {
    permissions.push('Administrator');
  } else if (['ban', 'kick', 'timeout', 'warn', 'purge', 'mute', 'lock'].includes(name)) {
    permissions.push('ModerateMembers', 'ManageMessages');
  } else if (['autorole', 'setwelcome', 'setlogs'].includes(name)) {
    permissions.push('ManageGuild');
  }
  
  // Determine context
  const context = [];
  if (command.dmPermission === false || ['ban', 'kick', 'purge', 'setup'].includes(name)) {
    context.push('guild');
  } else {
    context.push('guild', 'dm');
  }
  
  // Keywords for search
  const keywords = [name];
  if (description) {
    keywords.push(...description.toLowerCase().split(' ').filter(w => w.length > 3));
  }
  if (category) keywords.push(category);
  
  return {
    name,
    category,
    description,
    usage,
    examples: examples.slice(0, 3),
    permissions: permissions.length > 0 ? permissions : ['None'],
    context,
    keywords: [...new Set(keywords)].slice(0, 10),
    aliases: command.aliases || [],
  };
}

async function registerAllCommands() {
  console.log('🔍 Scanning commands directory...\n');
  
  const files = readdirSync(commandsPath).filter(f => f.endsWith('.js'));
  let registered = 0;
  let skipped = 0;
  
  for (const file of files) {
    const filePath = join(commandsPath, file);
    const command = await loadCommand(filePath);
    
    if (!command || !command.data) {
      skipped++;
      continue;
    }
    
    const metadata = extractMetadata(command, file);
    
    try {
      registerCommand(metadata);
      console.log(`✅ ${metadata.name.padEnd(20)} [${metadata.category}]`);
      registered++;
    } catch (err) {
      console.warn(`⚠️  ${file}: ${err.message}`);
      skipped++;
    }
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Registered: ${registered}`);
  console.log(`   ⚠️  Skipped: ${skipped}`);
  console.log(`   📁 Total files: ${files.length}`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  registerAllCommands()
    .then(() => {
      console.log('\n✅ All commands registered successfully!');
      process.exit(0);
    })
    .catch(err => {
      console.error('\n❌ Registration failed:', err);
      process.exit(1);
    });
}

export { registerAllCommands };
