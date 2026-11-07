import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function mapPlan(row) {
  return {
    ...row,
    available: row.available === 1,
    price_cents: row.price_cents == null ? null : Number(row.price_cents),
    duration_days: Number(row.duration_days),
    stock: row.stock == null ? null : Number(row.stock),
    vcpu: row.vcpu == null ? null : Number(row.vcpu),
  };
}

function mapTicket(row) {
  if (!row) return null;
  return { ...row, price_cents: Number(row.price_cents), stock_reserved: row.stock_reserved === 1, stock_released: row.stock_released === 1 };
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
  {
    version: 3,
    sql: `
      CREATE TABLE catalog_items (
        guild_id TEXT NOT NULL,
        sku TEXT NOT NULL CHECK (sku IN ('t4-4', 't4-8', 't4-16')),
        code TEXT NOT NULL CHECK (code IN ('7d', '15d', '30d')),
        label TEXT NOT NULL,
        product_name TEXT NOT NULL,
        vcpu INTEGER NOT NULL,
        duration_days INTEGER NOT NULL CHECK (duration_days IN (7, 15, 30)),
        price_cents INTEGER CHECK (price_cents IS NULL OR (price_cents >= 1 AND price_cents <= 10000000)),
        available INTEGER NOT NULL CHECK (available IN (0, 1)),
        stock INTEGER CHECK (stock IS NULL OR (stock >= 0 AND stock <= 1000000)),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, sku, code),
        CHECK (available = 0 OR price_cents IS NOT NULL)
      );

      INSERT INTO catalog_items (
        guild_id, sku, code, label, product_name, vcpu, duration_days, price_cents, available, stock, updated_at
      )
      SELECT guild_id, 't4-4', code, label, 'Tesla T4 · 4 vCPU', 4, duration_days, price_cents, available, NULL, updated_at
      FROM plans;

      CREATE TABLE tickets (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT,
        opener_id TEXT NOT NULL,
        sku TEXT NOT NULL,
        code TEXT NOT NULL,
        product_name TEXT NOT NULL,
        label TEXT NOT NULL,
        duration_days INTEGER NOT NULL,
        price_cents INTEGER NOT NULL,
        stock_reserved INTEGER NOT NULL CHECK (stock_reserved IN (0, 1)),
        stock_released INTEGER NOT NULL DEFAULT 0 CHECK (stock_released IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('pending', 'open', 'closed', 'failed')),
        claimed_by TEXT,
        claimed_at INTEGER,
        opened_at INTEGER NOT NULL,
        closed_at INTEGER,
        closed_by TEXT
      );

      CREATE UNIQUE INDEX idx_one_open_ticket
      ON tickets (guild_id, opener_id, sku, code)
      WHERE status IN ('pending', 'open');

      ALTER TABLE guild_settings ADD COLUMN ticket_category_id TEXT;
      ALTER TABLE guild_settings ADD COLUMN staff_role_id TEXT;
      ALTER TABLE guild_settings ADD COLUMN transcript_channel_id TEXT;

      CREATE TABLE confirmations_v3 (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN (
          'warn', 'timeout', 'timeout_remove', 'kick', 'ban',
          'set_log_channel', 'set_plan', 'set_stock', 'set_category', 'set_staff_role', 'set_transcript_channel',
          'enroll_admin', 'remove_admin', 'close_ticket'
        )),
        reason TEXT NOT NULL,
        payload TEXT,
        status TEXT NOT NULL CHECK (status IN ('open', 'claimed', 'completed', 'failed', 'cancelled')),
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO confirmations_v3 (
        id, guild_id, moderator_id, target_id, action, reason, payload, status, expires_at, created_at, updated_at
      )
      SELECT id, guild_id, moderator_id, target_id, action, reason, payload, status, expires_at, created_at, updated_at
      FROM confirmations;

      DROP TABLE confirmations;
      ALTER TABLE confirmations_v3 RENAME TO confirmations;
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE tickets ADD COLUMN opener_avatar_url TEXT;
      ALTER TABLE tickets ADD COLUMN close_phase TEXT;
      ALTER TABLE tickets ADD COLUMN transcript_saved INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE catalog_posts (
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        PRIMARY KEY (guild_id, channel_id, message_id)
      );

      CREATE TABLE guild_styles (
        guild_id TEXT PRIMARY KEY,
        catalog_heading TEXT,
        catalog_emoji TEXT,
        catalog_banner_url TEXT,
        ticket_greeting TEXT,
        ticket_banner_url TEXT,
        open_emoji TEXT,
        claim_emoji TEXT,
        unclaim_emoji TEXT,
        transcript_emoji TEXT,
        close_emoji TEXT,
        updated_at INTEGER NOT NULL
      );

      UPDATE catalog_items SET product_name = 'Atlas' WHERE product_name IN ('Nyx', 'Nyx Cloud');
      UPDATE guild_styles SET catalog_heading = 'Atlas' WHERE catalog_heading IN ('Nyx', 'Nyx Cloud');

      CREATE TABLE confirmations_v4 (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN (
          'warn', 'timeout', 'timeout_remove', 'kick', 'ban',
          'set_log_channel', 'set_plan', 'set_stock', 'set_offer', 'set_style',
          'set_category', 'set_staff_role', 'set_transcript_channel',
          'enroll_admin', 'remove_admin', 'close_ticket'
        )),
        reason TEXT NOT NULL,
        payload TEXT,
        status TEXT NOT NULL CHECK (status IN ('open', 'claimed', 'completed', 'failed', 'cancelled')),
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO confirmations_v4 (
        id, guild_id, moderator_id, target_id, action, reason, payload, status, expires_at, created_at, updated_at
      )
      SELECT id, guild_id, moderator_id, target_id, action, reason, payload, status, expires_at, created_at, updated_at
      FROM confirmations;

      DROP TABLE confirmations;
      ALTER TABLE confirmations_v4 RENAME TO confirmations;
    `,
  },
  {
    version: 5,
    sql: `
      ALTER TABLE guild_styles ADD COLUMN catalog_intro TEXT;
      ALTER TABLE guild_styles ADD COLUMN title_t4_4 TEXT;
      ALTER TABLE guild_styles ADD COLUMN title_t4_8 TEXT;
      ALTER TABLE guild_styles ADD COLUMN title_t4_16 TEXT;
      ALTER TABLE guild_styles ADD COLUMN emoji_t4_4 TEXT;
      ALTER TABLE guild_styles ADD COLUMN emoji_t4_8 TEXT;
      ALTER TABLE guild_styles ADD COLUMN emoji_t4_16 TEXT;
      ALTER TABLE guild_styles ADD COLUMN placeholder_t4_4 TEXT;
      ALTER TABLE guild_styles ADD COLUMN placeholder_t4_8 TEXT;
      ALTER TABLE guild_styles ADD COLUMN placeholder_t4_16 TEXT;
      ALTER TABLE guild_styles ADD COLUMN games_text TEXT;
      ALTER TABLE guild_styles ADD COLUMN games_emoji TEXT;
      ALTER TABLE guild_styles ADD COLUMN faq_text TEXT;
      ALTER TABLE guild_styles ADD COLUMN faq_emoji TEXT;
      ALTER TABLE guild_styles ADD COLUMN ticket_title_emoji TEXT;
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
      `INSERT INTO catalog_items (
         guild_id, sku, code, label, product_name, vcpu, duration_days, price_cents, available, stock, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, sku, code) DO NOTHING`,
    ),
    listPlans: db.prepare("SELECT * FROM catalog_items WHERE guild_id = ? ORDER BY vcpu, duration_days"),
    selectPlan: db.prepare("SELECT * FROM catalog_items WHERE guild_id = ? AND sku = 't4-4' AND code = ?"),
    selectItem: db.prepare("SELECT * FROM catalog_items WHERE guild_id = ? AND sku = ? AND code = ?"),
    updatePlan: db.prepare(
      `UPDATE catalog_items
       SET price_cents = ?, available = ?, updated_at = ?
       WHERE guild_id = ? AND sku = ? AND code = ? AND duration_days = ?`,
    ),
    updateStock: db.prepare(
      `UPDATE catalog_items SET stock = ?, updated_at = ? WHERE guild_id = ? AND sku = ? AND code = ?`,
    ),
    decrementStock: db.prepare(
      `UPDATE catalog_items SET stock = stock - 1
       WHERE guild_id = ? AND sku = ? AND code = ? AND stock IS NOT NULL AND stock >= 1`,
    ),
    incrementStock: db.prepare(
      `UPDATE catalog_items SET stock = stock + 1
       WHERE guild_id = ? AND sku = ? AND code = ? AND stock IS NOT NULL`,
    ),
    openTicket: db.prepare(
      `SELECT * FROM tickets
       WHERE guild_id = ? AND opener_id = ? AND sku = ? AND code = ? AND status IN ('pending', 'open')`,
    ),
    insertTicket: db.prepare(
      `INSERT INTO tickets (
         id, guild_id, channel_id, opener_id, sku, code, product_name, label, duration_days, price_cents,
         stock_reserved, stock_released, status, opened_at, opener_avatar_url
       ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?)`,
    ),
    selectTicket: db.prepare("SELECT * FROM tickets WHERE id = ? AND guild_id = ?"),
    attachChannel: db.prepare("UPDATE tickets SET channel_id = ?, status = 'open' WHERE id = ? AND status = 'pending'"),
    failTicket: db.prepare("UPDATE tickets SET status = 'failed' WHERE id = ? AND status = 'pending' AND stock_released = 0"),
    claimTicket: db.prepare(
      `UPDATE tickets SET claimed_by = ?, claimed_at = ?
       WHERE id = ? AND guild_id = ? AND status = 'open' AND claimed_by IS NULL`,
    ),
    clearClaim: db.prepare(
      `UPDATE tickets SET claimed_by = NULL, claimed_at = NULL
       WHERE id = ? AND guild_id = ? AND status = 'open' AND claimed_by IS NOT NULL`,
    ),
    closeTicket: db.prepare(
      `UPDATE tickets SET status = 'closed', closed_at = ?, closed_by = ?, stock_released = 1
       WHERE id = ? AND guild_id = ? AND status = 'open' AND stock_released = 0`,
    ),
    beginClose: db.prepare(
      `UPDATE tickets SET close_phase = 'closing'
       WHERE id = ? AND guild_id = ? AND status = 'open' AND (close_phase IS NULL OR close_phase = '')`,
    ),
    abortClose: db.prepare(
      `UPDATE tickets SET close_phase = NULL WHERE id = ? AND guild_id = ? AND close_phase = 'closing'`,
    ),
    markTranscript: db.prepare(
      `UPDATE tickets SET close_phase = 'transcript_saved', transcript_saved = 1
       WHERE id = ? AND guild_id = ? AND close_phase = 'closing'`,
    ),
    markPendingDelete: db.prepare(
      `UPDATE tickets SET close_phase = 'pending_delete', closed_by = ?, closed_at = ?
       WHERE id = ? AND guild_id = ? AND status = 'open' AND close_phase = 'transcript_saved'`,
    ),
    markStockReleased: db.prepare(
      `UPDATE tickets SET stock_released = 1 WHERE id = ? AND guild_id = ? AND stock_released = 0`,
    ),
    markDeleted: db.prepare(
      `UPDATE tickets SET status = 'closed' WHERE id = ? AND guild_id = ? AND status = 'open' AND close_phase = 'pending_delete'`,
    ),
    listPendingDeletes: db.prepare(
      `SELECT * FROM tickets WHERE status = 'open' AND close_phase = 'pending_delete'`,
    ),
    insertCatalogPost: db.prepare(
      `INSERT INTO catalog_posts (guild_id, channel_id, message_id) VALUES (?, ?, ?)
       ON CONFLICT(guild_id, channel_id, message_id) DO NOTHING`,
    ),
    listCatalogPosts: db.prepare("SELECT * FROM catalog_posts WHERE guild_id = ?"),
    listAllCatalogPosts: db.prepare("SELECT * FROM catalog_posts"),
    deleteCatalogPost: db.prepare(
      "DELETE FROM catalog_posts WHERE guild_id = ? AND channel_id = ? AND message_id = ?",
    ),
    selectStyle: db.prepare("SELECT * FROM guild_styles WHERE guild_id = ?"),
    upsertStyle: db.prepare(
      `INSERT INTO guild_styles (
         guild_id, catalog_heading, catalog_emoji, catalog_banner_url, ticket_greeting, ticket_banner_url,
         open_emoji, claim_emoji, unclaim_emoji, transcript_emoji, close_emoji, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET
         catalog_heading = excluded.catalog_heading,
         catalog_emoji = excluded.catalog_emoji,
         catalog_banner_url = excluded.catalog_banner_url,
         ticket_greeting = excluded.ticket_greeting,
         ticket_banner_url = excluded.ticket_banner_url,
         open_emoji = excluded.open_emoji,
         claim_emoji = excluded.claim_emoji,
         unclaim_emoji = excluded.unclaim_emoji,
         transcript_emoji = excluded.transcript_emoji,
         close_emoji = excluded.close_emoji,
         updated_at = excluded.updated_at`,
    ),
    rewriteCatalogBrand: db.prepare(
      "UPDATE catalog_items SET product_name = 'Atlas' WHERE product_name IN ('Nyx', 'Nyx Cloud')",
    ),
    rewriteStyleBrand: db.prepare(
      "UPDATE guild_styles SET catalog_heading = 'Atlas' WHERE catalog_heading IN ('Nyx', 'Nyx Cloud')",
    ),
    selectSettings: db.prepare("SELECT * FROM guild_settings WHERE guild_id = ?"),
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
    ensureDefaultPlans(guildId, products, now) {
      for (const product of products) {
        for (const duration of product.durations) {
          statements.insertPlan.run(
            guildId,
            product.sku,
            duration.code,
            duration.label,
            product.name,
            product.vcpu,
            duration.durationDays,
            duration.priceCents,
            duration.available ? 1 : 0,
            duration.stock,
            now,
          );
        }
      }
    },
    listPlans(guildId) {
      return statements.listPlans.all(guildId).map(mapPlan);
    },
    getPlan(guildId, code) {
      const row = statements.selectPlan.get(guildId, code);
      return row ? mapPlan(row) : null;
    },
    getItem(guildId, sku, code) {
      const row = statements.selectItem.get(guildId, sku, code);
      return row ? mapPlan(row) : null;
    },
    updatePlan({ guildId, sku = "t4-4", code, durationDays, priceCents, available, now }) {
      return (
        statements.updatePlan.run(priceCents, available ? 1 : 0, now, guildId, sku, code, durationDays).changes === 1
      );
    },
    updateStock({ guildId, sku, code, stock, now }) {
      return statements.updateStock.run(stock, now, guildId, sku, code).changes === 1;
    },
    reserveTicket({ guildId, openerId, sku, code, now, id, avatarUrl = null }) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const existing = statements.openTicket.get(guildId, openerId, sku, code);
        if (existing) {
          db.exec("COMMIT");
          return { ok: true, idempotent: true, ticket: mapTicket(existing) };
        }
        const item = statements.selectItem.get(guildId, sku, code);
        if (!item || item.available !== 1 || item.price_cents == null) {
          db.exec("ROLLBACK");
          return { ok: false, code: item?.price_cents == null && sku === "t4-8" ? "sku_setup_required" : "sold_out" };
        }
        statements.insertTicket.run(
          id,
          guildId,
          openerId,
          sku,
          code,
          item.product_name,
          item.label,
          item.duration_days,
          item.price_cents,
          0,
          now,
          avatarUrl,
        );
        db.exec("COMMIT");
        return { ok: true, idempotent: false, ticket: mapTicket(statements.selectTicket.get(id, guildId)) };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    markTicketOpen(id, channelId) {
      return statements.attachChannel.run(channelId, id).changes === 1;
    },
    failPendingTicket(id) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id);
        if (!ticket || ticket.status !== "pending") {
          db.exec("ROLLBACK");
          return false;
        }
        statements.failTicket.run(id);
        db.exec("COMMIT");
        return true;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    getTicket(guildId, id) {
      return mapTicket(statements.selectTicket.get(id, guildId));
    },
    claimTicket({ guildId, id, userId, now }) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const changed = statements.claimTicket.run(userId, now, id, guildId).changes === 1;
        const ticket = mapTicket(statements.selectTicket.get(id, guildId));
        db.exec("COMMIT");
        return { changed, ticket };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    clearTicketClaim({ guildId, id }) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const changed = statements.clearClaim.run(id, guildId).changes === 1;
        const ticket = mapTicket(statements.selectTicket.get(id, guildId));
        db.exec("COMMIT");
        return { changed, ticket };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    releaseTicket({ guildId, id, closedBy, now }) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const current = statements.selectTicket.get(id, guildId);
        if (!current || current.status !== "open") {
          db.exec("COMMIT");
          return { released: false, ticket: mapTicket(current) };
        }
        const changed = statements.closeTicket.run(now, closedBy, id, guildId).changes === 1;
        const ticket = mapTicket(statements.selectTicket.get(id, guildId));
        db.exec("COMMIT");
        return { released: changed, ticket };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    getSettings(guildId) {
      return statements.selectSettings.get(guildId) ?? null;
    },
    setOpenerAvatar(id, url) {
      db.prepare("UPDATE tickets SET opener_avatar_url = ? WHERE id = ?").run(url, id);
    },
    beginClose(guildId, id) {
      return statements.beginClose.run(id, guildId).changes === 1;
    },
    abortClose(guildId, id) {
      statements.abortClose.run(id, guildId);
    },
    markTranscriptSaved(guildId, id) {
      return statements.markTranscript.run(id, guildId).changes === 1;
    },
    markPendingDelete({ guildId, id, closedBy, now }) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const changed = statements.markPendingDelete.run(closedBy, now, id, guildId).changes === 1;
        const ticket = mapTicket(statements.selectTicket.get(id, guildId));
        db.exec("COMMIT");
        return { changed, ticket };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    markTicketDeleted(guildId, id) {
      return statements.markDeleted.run(id, guildId).changes === 1;
    },
    listPendingDeletes() {
      return statements.listPendingDeletes.all().map(mapTicket);
    },
    trackCatalogPost({ guildId, channelId, messageId }) {
      statements.insertCatalogPost.run(guildId, channelId, messageId);
    },
    listCatalogPosts(guildId) {
      return guildId ? statements.listCatalogPosts.all(guildId) : statements.listAllCatalogPosts.all();
    },
    pruneCatalogPost(post) {
      statements.deleteCatalogPost.run(post.guild_id, post.channel_id, post.message_id);
    },
    getStyle(guildId) {
      return statements.selectStyle.get(guildId) ?? null;
    },
    saveStyleColumns(guildId, style) {
      const fields = [
        "catalog_intro", "title_t4_4", "title_t4_8", "title_t4_16", "emoji_t4_4", "emoji_t4_8", "emoji_t4_16",
        "placeholder_t4_4", "placeholder_t4_8", "placeholder_t4_16", "games_text", "games_emoji", "faq_text", "faq_emoji", "ticket_title_emoji",
      ];
      for (const field of fields) {
        if (!(field in style)) continue;
        db.prepare(`UPDATE guild_styles SET ${field} = ? WHERE guild_id = ?`).run(style[field] ?? null, guildId);
      }
    },
    saveStyle(guildId, style, now) {
      statements.upsertStyle.run(
        guildId,
        style.catalogHeading,
        style.catalogEmoji,
        style.catalogBannerUrl,
        style.ticketGreeting,
        style.ticketBannerUrl,
        style.openEmoji,
        style.claimEmoji,
        style.unclaimEmoji,
        style.transcriptEmoji,
        style.closeEmoji,
        now,
      );
    },
    updateOffer({ guildId, sku, code, durationDays, priceCents, available, stock, now }) {
      return (
        db.prepare(
          `UPDATE catalog_items
           SET price_cents = ?, available = ?, updated_at = ?
           WHERE guild_id = ? AND sku = ? AND code = ? AND duration_days = ?`,
        ).run(priceCents, available ? 1 : 0, now, guildId, sku, code, durationDays).changes === 1
      );
    },
    rewriteDefaultBrands() {
      const catalog = statements.rewriteCatalogBrand.run().changes;
      const styles = statements.rewriteStyleBrand.run().changes;
      return { catalog, styles };
    },
    setGuildField(guildId, field, value, now) {
      const allowed = new Set(["ticket_category_id", "staff_role_id", "transcript_channel_id"]);
      if (!allowed.has(field)) throw new Error("Campo de configuração inválido.");
      db.prepare(
        `INSERT INTO guild_settings (guild_id, ${field}, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET ${field} = excluded.${field}, updated_at = excluded.updated_at`,
      ).run(guildId, value, now);
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
