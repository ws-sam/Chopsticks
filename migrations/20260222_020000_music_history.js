export default {
  version: "20260222_020000",
  description: "Add music play history table",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS music_play_history (
        id BIGSERIAL PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        track_title TEXT NOT NULL,
        track_author TEXT,
        track_uri TEXT,
        dedicated_to TEXT,
        played_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_mph_guild_played
      ON music_play_history(guild_id, played_at DESC);
    `);
  },

  async down(client) {}
};
