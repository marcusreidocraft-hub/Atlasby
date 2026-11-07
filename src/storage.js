import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function mapPlan(row) {
  return {
    ...row,
    available: row.available === 1,
    temporary_price: row.temporary_price === 1,
    price_cents: row.price_cents == null ? null : Number(row.price_cents),
    duration_days: Number(row.duration_days),
  };
}

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
  {
    version: 2,
    sql: `
      CREATE TABLE plans (
        guild_id TEXT NOT NULL,
        code TEXT NOT NULL CHECK (code IN ('7d', '15d', '30d')),
        label TEXT NOT NULL,
        duration_days INTEGER NOT NULL CHECK (duration_days IN (7, 15, 30)),
        price_cents INTEGER CHECK (price_cents IS NULL OR (price_cents >= 1 AND price_cents <= 10000000)),
        available INTEGER NOT NULL CHECK (available IN (0, 1)),
        temporary_price INTEGER NOT NULL CHECK (temporary_price IN (0, 1)),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, code),
        CHECK (available = 0 OR price_cents IS NOT NULL)
      );

      CREATE TABLE guild_admins (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        enrolled_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );

      CREATE TABLE confirmations_v2 (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN (
          'warn', 'timeout', 'timeout_remove', 'kick', 'ban',
          'set_log_channel', 'set_plan', 'enroll_admin', 'remove_admin'
        )),
        reason TEXT NOT NULL,
        payload TEXT,
        status TEXT NOT NULL CHECK (status IN ('open', 'claimed', 'completed', 'failed', 'cancelled')),
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO confirmations_v2 (
        id, guild_id, moderator_id, target_id, action, reason, payload, status, expires_at, created_at, updated_at
      )
      SELECT id, guild_id, moderator_id, target_id, action, reason, NULL, status, expires_at, created_at, updated_at
      FROM confirmations;

      DROP TABLE confirmations;
      ALTER TABLE confirmations_v2 RENAME TO confirmations;
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
         id, guild_id, moderator_id, target_id, action, reason, payload, status, expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    ),
    insertPlan: db.prepare(
      `INSERT INTO plans (guild_id, code, label, duration_days, price_cents, available, temporary_price, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, code) DO NOTHING`,
    ),
    listPlans: db.prepare("SELECT * FROM plans WHERE guild_id = ? ORDER BY duration_days"),
    selectPlan: db.prepare("SELECT * FROM plans WHERE guild_id = ? AND code = ?"),
    updatePlan: db.prepare(
      `UPDATE plans
       SET price_cents = ?, available = ?, updated_at = ?
       WHERE guild_id = ? AND code = ? AND duration_days = ?`,
    ),
    insertAdmin: db.prepare(
      `INSERT INTO guild_admins (guild_id, user_id, enrolled_by, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id) DO NOTHING`,
    ),
    deleteAdmin: db.prepare("DELETE FROM guild_admins WHERE guild_id = ? AND user_id = ?"),
    listAdmins: db.prepare("SELECT * FROM guild_admins WHERE guild_id = ? ORDER BY created_at"),
    selectAdmin: db.prepare("SELECT 1 AS ok FROM guild_admins WHERE guild_id = ? AND user_id = ?"),
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
    createConfirmation({ id, guildId, moderatorId, targetId, action, reason, payload, expiresAt, now }) {
      statements.insertConfirmation.run(
        id,
        guildId,
        moderatorId,
        targetId,
        action,
        reason,
        payload == null ? null : JSON.stringify(payload),
        expiresAt,
        now,
        now,
      );
    },
    ensureDefaultPlans(guildId, specs, now) {
      for (const spec of specs) {
        statements.insertPlan.run(
          guildId,
          spec.code,
          spec.label,
          spec.durationDays,
          spec.defaultPriceCents,
          spec.defaultAvailable ? 1 : 0,
          spec.temporaryPrice ? 1 : 0,
          now,
        );
      }
    },
    listPlans(guildId) {
      return statements.listPlans.all(guildId).map(mapPlan);
    },
    getPlan(guildId, code) {
      const row = statements.selectPlan.get(guildId, code);
      return row ? mapPlan(row) : null;
    },
    updatePlan({ guildId, code, durationDays, priceCents, available, now }) {
      return (
        statements.updatePlan.run(priceCents, available ? 1 : 0, now, guildId, code, durationDays).changes === 1
      );
    },
    isGuildAdmin(guildId, userId) {
      return Boolean(statements.selectAdmin.get(guildId, userId));
    },
    listAdmins(guildId) {
      return statements.listAdmins.all(guildId);
    },
    enrollAdmin({ guildId, userId, enrolledBy, now }) {
      return statements.insertAdmin.run(guildId, userId, enrolledBy, now).changes === 1;
    },
    removeAdmin(guildId, userId) {
      return statements.deleteAdmin.run(guildId, userId).changes === 1;
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
