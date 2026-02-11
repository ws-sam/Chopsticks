// Comprehensive error logging utility

export function logCommandError(commandName, interaction, error, context = {}) {
  const timestamp = new Date().toISOString();
  const userId = interaction.user?.id || 'unknown';
  const guildId = interaction.guildId || 'DM';
  
  console.error(`
========================================
COMMAND ERROR: ${commandName}
Time: ${timestamp}
User: ${userId}
Guild: ${guildId}
Context: ${JSON.stringify(context)}
Error: ${error.message}
Stack: ${error.stack}
========================================
  `);
}

export function logAgentError(agentId, operation, error, context = {}) {
  const timestamp = new Date().toISOString();
  
  console.error(`
========================================
AGENT ERROR: ${agentId}
Time: ${timestamp}
Operation: ${operation}
Context: ${JSON.stringify(context)}
Error: ${error.message}
Stack: ${error.stack}
========================================
  `);
}

export function logSystemError(component, error, context = {}) {
  const timestamp = new Date().toISOString();
  
  console.error(`
========================================
SYSTEM ERROR: ${component}
Time: ${timestamp}
Context: ${JSON.stringify(context)}
Error: ${error.message}
Stack: ${error.stack}
========================================
  `);
}
