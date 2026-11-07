import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE warnings (
        id INTEGER PRIMARY KEY,
        guild_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE actions (
        id INTEGER PRIMARY KEY,
        guild_id TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'partial', 'failed')),
        target_id TEXT,
        moderator_id TEXT NOT NULL,
        reason TEXT,
        detail TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE confirmations (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('kick', 'ban')),
        reason TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'claimed', 'completed', 'failed', 'cancelled')),
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE guild_settings (
        guild_id TEXT PRIMARY KEY,
        log_channel_id TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX idx_warnings_guild_target ON warnings (guild_id, target_id);
      CREATE INDEX idx_actions_guild_created ON actions (guild_id, created_at);
    `,
  },
];

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(db.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

function createStore(db, file, options = {}) {
  const statements = {
    insertWarning: db.prepare(
      `INSERT INTO warnings (guild_id, target_id, moderator_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ),
    insertAction: db.prepare(
      `INSERT INTO actions (guild_id, action, status, target_id, moderator_id, reason, detail, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    updateAction: db.prepare("UPDATE actions SET status = ?, detail = ?, updated_at = ? WHERE id = ?"),
    selectAction: db.prepare("SELECT * FROM actions WHERE id = ?"),
    listActions: db.prepare("SELECT * FROM actions WHERE guild_id = ? ORDER BY id"),
    listWarnings: db.prepare("SELECT * FROM warnings WHERE guild_id = ? ORDER BY id"),
    insertConfirmation: db.prepare(
      `INSERT INTO confirmations (
         id, guild_id, moderator_id, target_id, action, reason, status, expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    ),
    selectConfirmation: db.prepare("SELECT * FROM confirmations WHERE id = ?"),
    claimConfirmation: db.prepare(
      `UPDATE confirmations
       SET status = 'claimed', updated_at = ?
       WHERE id = ? AND guild_id = ? AND moderator_id = ? AND status = 'open' AND expires_at > ?`,
    ),
    cancelConfirmation: db.prepare(
      `UPDATE confirmations
       SET status = 'cancelled', updated_at = ?
       WHERE id = ? AND guild_id = ? AND moderator_id = ? AND status = 'open' AND expires_at > ?`,
    ),
    finishConfirmation: db.prepare(
      "UPDATE confirmations SET status = ?, updated_at = ? WHERE id = ? AND status = 'claimed'",
    ),
    selectLogChannel: db.prepare("SELECT log_channel_id FROM guild_settings WHERE guild_id = ?"),
    upsertLogChannel: db.prepare(
      `INSERT INTO guild_settings (guild_id, log_channel_id, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET log_channel_id = excluded.log_channel_id, updated_at = excluded.updated_at`,
    ),
    migrationCount: db.prepare("SELECT COUNT(*) AS count FROM schema_migrations"),
  };

  return {
    path: file,
    close() {
      db.close();
    },
    migrationCount() {
      return Number(statements.migrationCount.get().count);
    },
    recordWarning({ guildId, targetId, moderatorId, reason, now }) {
      db.exec("BEGIN");
      try {
        const warning = statements.insertWarning.run(guildId, targetId, moderatorId, reason, now);
        if (options.failAfterWarningInsert) throw new Error("falha injetada");
        const action = statements.insertAction.run(
          guildId,
          "warn",
          "pending",
          targetId,
          moderatorId,
          reason,
          null,
          now,
          now,
        );
        db.exec("COMMIT");
        return {
          warningId: Number(warning.lastInsertRowid),
          actionId: Number(action.lastInsertRowid),
        };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    insertAction({ guildId, action, status, targetId, moderatorId, reason, detail, now }) {
      const result = statements.insertAction.run(
        guildId,
        action,
        status,
        targetId ?? null,
        moderatorId,
        reason ?? null,
        detail == null ? null : JSON.stringify(detail),
        now,
        now,
      );
      return Number(result.lastInsertRowid);
    },
    updateAction(id, { status, now, detail }) {
      const current = statements.selectAction.get(id);
      if (!current) throw new Error("Ação de auditoria inexistente.");
      const merged = {
        ...(current.detail ? JSON.parse(current.detail) : {}),
        ...(detail ?? {}),
      };
      const result = statements.updateAction.run(status, JSON.stringify(merged), now, id);
      if (result.changes !== 1) throw new Error("Auditoria não atualizada.");
    },
    getAction(id) {
      return statements.selectAction.get(id) ?? null;
    },
    listActions(guildId) {
      return statements.listActions.all(guildId);
    },
    listWarnings(guildId) {
      return statements.listWarnings.all(guildId);
    },
    createConfirmation({ id, guildId, moderatorId, targetId, action, reason, expiresAt, now }) {
      statements.insertConfirmation.run(id, guildId, moderatorId, targetId, action, reason, expiresAt, now, now);
    },
    getConfirmation(id) {
      return statements.selectConfirmation.get(id) ?? null;
    },
    claimConfirmation(id, { guildId, moderatorId, now }) {
      return statements.claimConfirmation.run(now, id, guildId, moderatorId, now).changes === 1;
    },
    cancelConfirmation(id, { guildId, moderatorId, now }) {
      return statements.cancelConfirmation.run(now, id, guildId, moderatorId, now).changes === 1;
    },
    finishConfirmation(id, status, now) {
      statements.finishConfirmation.run(status, now, id);
    },
    getLogChannel(guildId) {
      return statements.selectLogChannel.get(guildId)?.log_channel_id ?? null;
    },
    setLogChannel(guildId, channelId, now) {
      statements.upsertLogChannel.run(guildId, channelId, now);
    },
  };
}

export function openDatabase(dataDir, options = {}) {
  const memory = dataDir === ":memory:";
  const file = memory ? ":memory:" : path.join(path.resolve(dataDir), "moderation.sqlite");
  if (!memory) fs.mkdirSync(path.resolve(dataDir), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = FULL");
  if (!memory) db.exec("PRAGMA journal_mode = WAL");
  migrate(db);
  return createStore(db, file, options);
}
