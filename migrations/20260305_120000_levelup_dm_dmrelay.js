// Migration: Add levelup_dm column to guild_xp_config
// and dmRelayChannelId to guild_settings for DM passthrough relay

export default {
  version: '20260305_120000',
  description: 'Add levelup_dm to guild_xp_config; DM relay uses guild_settings JSONB (no schema change needed)',

  async up(client) {
    // Add levelup_dm column to guild_xp_config (if table exists)
    await client.query(`
      ALTER TABLE guild_xp_config
      ADD COLUMN IF NOT EXISTS levelup_dm BOOLEAN NOT NULL DEFAULT false;
    `);
  },

  async down(client) {
    // Intentionally a no-op (additive migration)
  }
};
