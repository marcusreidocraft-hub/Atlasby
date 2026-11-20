const SCHEMA = `
  CREATE TABLE IF NOT EXISTS announcements (
    message_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

export function attachAnnouncements(db) {
  db.exec(SCHEMA);
  const get = db.prepare("SELECT * FROM announcements WHERE message_id = ? AND guild_id = ?");
  const save = db.prepare(`INSERT INTO announcements (message_id, guild_id, channel_id, payload, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(message_id) DO UPDATE SET
      guild_id = excluded.guild_id,
      channel_id = excluded.channel_id,
      payload = excluded.payload,
      updated_at = excluded.updated_at`);
  return {
    announcement(guildId, messageId) {
      const row = get.get(messageId, guildId);
      if (!row) return null;
      return {
        messageId: row.message_id,
        guildId: row.guild_id,
        channelId: row.channel_id,
        payload: JSON.parse(row.payload),
        updatedAt: row.updated_at,
      };
    },
    saveAnnouncement(row) {
      save.run(row.messageId, row.guildId, row.channelId, JSON.stringify(row.payload), row.updatedAt);
    },
  };
}
