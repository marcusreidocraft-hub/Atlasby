import { randomUUID } from "node:crypto";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS support_tickets (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    number INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    channel_id TEXT,
    message_id TEXT,
    voice_id TEXT,
    reason TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (guild_id, number)
  );
`;

function mapTicket(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    number: row.number,
    userId: row.user_id,
    category: row.category,
    channelId: row.channel_id || "",
    messageId: row.message_id || "",
    voiceId: row.voice_id || "",
    reason: row.reason,
    orderId: row.order_id || "",
    status: row.status,
    createdAt: row.created_at,
  };
}

export function attachTickets(db) {
  db.exec(SCHEMA);
  const columns = db.prepare("PRAGMA table_info(support_tickets)").all();
  if (!columns.some((column) => column.name === "order_id")) db.exec("ALTER TABLE support_tickets ADD COLUMN order_id TEXT NOT NULL DEFAULT ''");
  const byId = db.prepare("SELECT * FROM support_tickets WHERE id = ?");
  const byChannel = db.prepare("SELECT * FROM support_tickets WHERE channel_id = ?");
  const byOrder = db.prepare("SELECT * FROM support_tickets WHERE order_id = ? AND order_id != ''");
  const openByUser = db.prepare("SELECT * FROM support_tickets WHERE guild_id = ? AND user_id = ? AND status = 'aberto' AND channel_id != '' ORDER BY created_at DESC LIMIT 1");
  return {
    openSupportTicket({ guildId, userId, category, reason, orderId = "", now }) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const current = db.prepare("SELECT COALESCE(MAX(number), 0) AS n FROM support_tickets WHERE guild_id = ?").get(guildId);
        const number = Number(current.n) + 1;
        const id = randomUUID();
        db.prepare(`INSERT INTO support_tickets (
          id, guild_id, number, user_id, category, channel_id, message_id, voice_id, reason, status, created_at, order_id
        ) VALUES (?, ?, ?, ?, ?, '', '', '', ?, 'aberto', ?, ?)`).run(id, guildId, number, userId, category, reason, now, orderId);
        db.exec("COMMIT");
        return mapTicket(byId.get(id));
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch { /* já encerrada */ }
        throw error;
      }
    },
    supportTicket(id) {
      return mapTicket(byId.get(id));
    },
    supportTicketByChannel(channelId) {
      return mapTicket(byChannel.get(channelId));
    },
    supportTicketByOrder(orderId) {
      return mapTicket(byOrder.get(orderId));
    },
    supportTicketOpen(guildId, userId) {
      return mapTicket(openByUser.get(guildId, userId));
    },
    patchSupportTicket(id, patch) {
      const current = mapTicket(byId.get(id));
      if (!current) return null;
      const next = { ...current, ...patch };
      db.prepare("UPDATE support_tickets SET channel_id = ?, message_id = ?, voice_id = ?, status = ? WHERE id = ?").run(
        next.channelId, next.messageId, next.voiceId, next.status, id,
      );
      return mapTicket(byId.get(id));
    },
  };
}
