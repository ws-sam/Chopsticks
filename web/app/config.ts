// web/app/config.ts
// Centralized configuration for the Chopsticks website.

export const Config = {
  // The Discord Application ID (Client ID) for the bot invite link.
  // Self-hosters should change this to their own Client ID.
  clientId: '1466382874587431036',

  // The permissions integer for the bot invite link.
  // 1099514858544 = Administrator (or granular perms).
  permissions: '1099514858544',

  // Support server invite link.
  supportServer: 'https://discord.gg/QbS47HDdpf',

  // GitHub repository link.
  githubRepo: 'https://github.com/WokSpec/Chopsticks',

  // Canonical URL for the project.
  baseUrl: 'https://chopsticks.wokspec.org',
  
  // Feature counts (approximate)
  stats: {
    slashCommands: 101,
    prefixCommands: 148,
    systems: 7,
    agentRoles: 16
  }
};

export const getBotInvite = () => 
  `https://discord.com/api/oauth2/authorize?client_id=${Config.clientId}&permissions=${Config.permissions}&scope=bot%20applications.commands`;
