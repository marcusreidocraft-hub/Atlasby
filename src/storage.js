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
  {
    version: 6,
    sql: `
      CREATE TABLE application_settings (
        guild_id TEXT PRIMARY KEY,
        open INTEGER NOT NULL DEFAULT 0 CHECK (open IN (0, 1)),
        panel_channel_id TEXT,
        review_channel_id TEXT,
        approval_role_id TEXT,
        heading TEXT,
        emoji TEXT,
        intro TEXT,
        banner_url TEXT,
        button_emoji TEXT,
        questions_seeded INTEGER NOT NULL DEFAULT 0 CHECK (questions_seeded IN (0, 1)),
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE application_reviewers (
        guild_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, role_id)
      );

      CREATE TABLE application_questions (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        prompt TEXT NOT NULL,
        hint TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('short', 'long')),
        required INTEGER NOT NULL CHECK (required IN (0, 1)),
        max_length INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (guild_id, position)
      );

      CREATE TABLE applications (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        applicant_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'pending', 'claimed', 'approving', 'approved', 'rejected')),
        avatar_url TEXT,
        draft_json TEXT,
        snapshot_json TEXT,
        review_channel_id TEXT,
        review_message_id TEXT,
        claimed_by TEXT,
        claimed_at INTEGER,
        decision_by TEXT,
        decision_reason TEXT,
        decided_at INTEGER,
        role_id TEXT,
        role_applied INTEGER NOT NULL DEFAULT 0 CHECK (role_applied IN (0, 1)),
        notify_state TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX applications_one_active
        ON applications (guild_id, applicant_id)
        WHERE status IN ('draft', 'pending', 'claimed', 'approving');

      CREATE TABLE application_posts (
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        PRIMARY KEY (guild_id, channel_id, message_id)
      );

      CREATE TABLE confirmations_v6 (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN (
          'warn', 'timeout', 'timeout_remove', 'kick', 'ban',
          'set_log_channel', 'set_plan', 'set_stock', 'set_offer', 'set_style',
          'set_category', 'set_staff_role', 'set_transcript_channel',
          'enroll_admin', 'remove_admin', 'close_ticket',
          'submit_application', 'cancel_application', 'delete_application',
          'approve_application', 'reject_application',
          'set_form_panel', 'set_form_review', 'set_form_role', 'set_form_reviewer',
          'set_form_open', 'set_form_style', 'set_form_question',
          'remove_form_question', 'move_form_question'
        )),
        reason TEXT NOT NULL,
        payload TEXT,
        status TEXT NOT NULL CHECK (status IN ('open', 'claimed', 'completed', 'failed', 'cancelled')),
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO confirmations_v6 (
        id, guild_id, moderator_id, target_id, action, reason, payload, status, expires_at, created_at, updated_at
      )
      SELECT id, guild_id, moderator_id, target_id, action, reason, payload, status, expires_at, created_at, updated_at
      FROM confirmations;

      DROP TABLE confirmations;
      ALTER TABLE confirmations_v6 RENAME TO confirmations;
    `,
  },
  {
    version: 7,
    sql: `
      CREATE TABLE azure_settings (
        guild_id TEXT PRIMARY KEY,
        log_channel_id TEXT,
        auto_start_enabled INTEGER NOT NULL DEFAULT 1 CHECK (auto_start_enabled IN (0, 1)),
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE azure_vms (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        resource_group TEXT NOT NULL,
        vm_name TEXT NOT NULL,
        os_label TEXT,
        size_label TEXT,
        cpu_label TEXT,
        ram_label TEXT,
        gpu_label TEXT,
        disk_gb INTEGER,
        public_ip TEXT,
        private_ip TEXT,
        validity_until INTEGER,
        block_when_expired INTEGER NOT NULL DEFAULT 1 CHECK (block_when_expired IN (0, 1)),
        auto_start INTEGER NOT NULL DEFAULT 0 CHECK (auto_start IN (0, 1)),
        spot INTEGER NOT NULL DEFAULT 1 CHECK (spot IN (0, 1)),
        desired_power TEXT NOT NULL DEFAULT 'unknown',
        last_power TEXT,
        last_power_at INTEGER,
        credentials_cipher TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (guild_id, resource_group, vm_name)
      );

      CREATE TABLE azure_assignments (
        guild_id TEXT NOT NULL,
        vm_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, vm_id, user_id)
      );

      CREATE TABLE azure_locks (
        vm_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        until_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE azure_retries (
        vm_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        next_at INTEGER NOT NULL,
        last_notice TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE azure_disk_requests (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        vm_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        current_gb INTEGER,
        requested_gb INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'failed')),
        decided_by TEXT,
        detail TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE confirmations_v7 (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN (
          'warn', 'timeout', 'timeout_remove', 'kick', 'ban',
          'set_log_channel', 'set_plan', 'set_stock', 'set_offer', 'set_style',
          'set_category', 'set_staff_role', 'set_transcript_channel',
          'enroll_admin', 'remove_admin', 'close_ticket',
          'submit_application', 'cancel_application', 'delete_application',
          'approve_application', 'reject_application',
          'set_form_panel', 'set_form_review', 'set_form_role', 'set_form_reviewer',
          'set_form_open', 'set_form_style', 'set_form_question',
          'remove_form_question', 'move_form_question',
          'upsert_vm', 'delete_vm', 'link_vm', 'unlink_vm',
          'set_vm_secret', 'set_vm_validity', 'set_vm_policy', 'approve_disk', 'set_vm_log', 'request_disk'
        )),
        reason TEXT NOT NULL,
        payload TEXT,
        status TEXT NOT NULL CHECK (status IN ('open', 'claimed', 'completed', 'failed', 'cancelled')),
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO confirmations_v7 (
        id, guild_id, moderator_id, target_id, action, reason, payload, status, expires_at, created_at, updated_at
      )
      SELECT id, guild_id, moderator_id, target_id, action, reason, payload, status, expires_at, created_at, updated_at
      FROM confirmations;

      DROP TABLE confirmations;
      ALTER TABLE confirmations_v7 RENAME TO confirmations;
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
    getForm(guildId) {
      const row = db.prepare("SELECT * FROM application_settings WHERE guild_id = ?").get(guildId);
      if (!row) return null;
      return { ...row, open: row.open === 1, questions_seeded: row.questions_seeded === 1 };
    },
    ensureForm(guildId, now) {
      db.prepare(
        `INSERT INTO application_settings (guild_id, open, questions_seeded, updated_at)
         VALUES (?, 0, 0, ?)
         ON CONFLICT(guild_id) DO NOTHING`,
      ).run(guildId, now);
      return this.getForm(guildId);
    },
    saveForm(guildId, patch, now) {
      this.ensureForm(guildId, now);
      const allowed = ["open", "panel_channel_id", "review_channel_id", "approval_role_id", "heading", "emoji", "intro", "banner_url", "button_emoji", "questions_seeded"];
      for (const key of allowed) {
        if (!(key in patch)) continue;
        const value = key === "open" || key === "questions_seeded" ? (patch[key] ? 1 : 0) : patch[key];
        db.prepare(`UPDATE application_settings SET ${key} = ?, updated_at = ? WHERE guild_id = ?`).run(value, now, guildId);
      }
      return this.getForm(guildId);
    },
    listReviewers(guildId) {
      return db.prepare("SELECT role_id, created_at FROM application_reviewers WHERE guild_id = ? ORDER BY created_at").all(guildId);
    },
    addReviewer(guildId, roleId, now) {
      return db.prepare(
        `INSERT INTO application_reviewers (guild_id, role_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT(guild_id, role_id) DO NOTHING`,
      ).run(guildId, roleId, now).changes === 1;
    },
    removeReviewer(guildId, roleId) {
      return db.prepare("DELETE FROM application_reviewers WHERE guild_id = ? AND role_id = ?").run(guildId, roleId).changes === 1;
    },
    listQuestions(guildId) {
      return db.prepare("SELECT * FROM application_questions WHERE guild_id = ? ORDER BY position").all(guildId).map((row) => ({
        ...row,
        required: row.required === 1,
      }));
    },
    getQuestion(guildId, id) {
      const row = db.prepare("SELECT * FROM application_questions WHERE guild_id = ? AND id = ?").get(guildId, id);
      return row ? { ...row, required: row.required === 1 } : null;
    },
    insertQuestion(row) {
      db.prepare(
        `INSERT INTO application_questions (
           id, guild_id, position, prompt, hint, kind, required, max_length, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(row.id, row.guildId, row.position, row.prompt, row.hint, row.kind, row.required ? 1 : 0, row.maxLength, row.now);
    },
    nextQuestionPosition(guildId) {
      return Number(db.prepare("SELECT COALESCE(MAX(position), 0) AS n FROM application_questions WHERE guild_id = ?").get(guildId).n) + 1;
    },
    saveQuestion(guildId, id, row) {
      return db.prepare(
        `UPDATE application_questions
         SET prompt = ?, hint = ?, kind = ?, required = ?, max_length = ?, updated_at = ?
         WHERE guild_id = ? AND id = ?`,
      ).run(row.prompt, row.hint, row.kind, row.required ? 1 : 0, row.maxLength, row.now, guildId, id).changes === 1;
    },
    deleteQuestion(guildId, id) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const removed = db.prepare("DELETE FROM application_questions WHERE guild_id = ? AND id = ?").run(guildId, id).changes === 1;
        if (removed) this.renumberQuestions(guildId);
        db.exec("COMMIT");
        return removed;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    renumberQuestions(guildId) {
      const rows = db.prepare("SELECT id FROM application_questions WHERE guild_id = ? ORDER BY position").all(guildId);
      rows.forEach((row, index) => {
        db.prepare("UPDATE application_questions SET position = ? WHERE guild_id = ? AND id = ?").run(-(index + 1), guildId, row.id);
      });
      rows.forEach((row, index) => {
        db.prepare("UPDATE application_questions SET position = ? WHERE guild_id = ? AND id = ?").run(index + 1, guildId, row.id);
      });
    },
    moveQuestion(guildId, id, direction) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const rows = db.prepare("SELECT id, position FROM application_questions WHERE guild_id = ? ORDER BY position").all(guildId);
        const index = rows.findIndex((row) => row.id === id);
        const swap = direction === "up" ? index - 1 : index + 1;
        if (index < 0 || swap < 0 || swap >= rows.length) {
          db.exec("COMMIT");
          return false;
        }
        const current = rows[index];
        const neighbor = rows[swap];
        db.prepare("UPDATE application_questions SET position = ? WHERE guild_id = ? AND id = ?").run(-1, guildId, current.id);
        db.prepare("UPDATE application_questions SET position = ? WHERE guild_id = ? AND id = ?").run(current.position, guildId, neighbor.id);
        db.prepare("UPDATE application_questions SET position = ? WHERE guild_id = ? AND id = ?").run(neighbor.position, guildId, current.id);
        db.exec("COMMIT");
        return true;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    mapApplication(row) {
      if (!row) return null;
      const parse = (value) => {
        if (!value) return null;
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      };
      return {
        ...row,
        role_applied: row.role_applied === 1,
        draft: parse(row.draft_json) ?? { step: 0, answers: {} },
        snapshot: parse(row.snapshot_json),
      };
    },
    getApplication(guildId, id) {
      return this.mapApplication(db.prepare("SELECT * FROM applications WHERE guild_id = ? AND id = ?").get(guildId, id));
    },
    activeApplication(guildId, applicantId) {
      return this.mapApplication(db.prepare(
        `SELECT * FROM applications
         WHERE guild_id = ? AND applicant_id = ? AND status IN ('draft', 'pending', 'claimed', 'approving')`,
      ).get(guildId, applicantId));
    },
    latestApplication(guildId, applicantId) {
      return this.mapApplication(db.prepare(
        "SELECT * FROM applications WHERE guild_id = ? AND applicant_id = ? ORDER BY updated_at DESC LIMIT 1",
      ).get(guildId, applicantId));
    },
    insertDraft(row) {
      try {
        db.prepare(
          `INSERT INTO applications (
             id, guild_id, applicant_id, status, avatar_url, draft_json, role_applied, created_at, updated_at
           ) VALUES (?, ?, ?, 'draft', ?, ?, 0, ?, ?)`,
        ).run(row.id, row.guildId, row.applicantId, row.avatarUrl, JSON.stringify({ step: 0, answers: {} }), row.now, row.now);
        return { ok: true };
      } catch (error) {
        if (String(error?.message ?? "").toLowerCase().includes("unique")) return { ok: false, code: "application_exists" };
        throw error;
      }
    },
    saveDraft(guildId, id, applicantId, draft, now) {
      return db.prepare(
        `UPDATE applications SET draft_json = ?, updated_at = ?
         WHERE guild_id = ? AND id = ? AND applicant_id = ? AND status = 'draft'`,
      ).run(JSON.stringify(draft), now, guildId, id, applicantId).changes === 1;
    },
    submitApplication({ guildId, id, applicantId, snapshot, reviewChannelId, now }) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const current = db.prepare("SELECT status, applicant_id FROM applications WHERE guild_id = ? AND id = ?").get(guildId, id);
        if (!current || current.applicant_id !== applicantId || current.status !== "draft") {
          db.exec("ROLLBACK");
          return false;
        }
        const changed = db.prepare(
          `UPDATE applications
           SET status = 'pending', snapshot_json = ?, draft_json = NULL, review_channel_id = ?, updated_at = ?
           WHERE guild_id = ? AND id = ? AND status = 'draft'`,
        ).run(JSON.stringify(snapshot), reviewChannelId, now, guildId, id).changes === 1;
        db.exec("COMMIT");
        return changed;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    claimReviewPost(guildId, id, channelId) {
      return db.prepare(
        `UPDATE applications SET review_channel_id = ?, review_message_id = 'posting'
         WHERE guild_id = ? AND id = ? AND review_message_id IS NULL`,
      ).run(channelId, guildId, id).changes === 1;
    },
    finishReviewPost(guildId, id, messageId) {
      return db.prepare(
        `UPDATE applications SET review_message_id = ?
         WHERE guild_id = ? AND id = ? AND review_message_id = 'posting'`,
      ).run(messageId, guildId, id).changes === 1;
    },
    clearReviewPost(guildId, id) {
      return db.prepare(
        `UPDATE applications SET review_message_id = NULL
         WHERE guild_id = ? AND id = ? AND review_message_id = 'posting'`,
      ).run(guildId, id).changes === 1;
    },
    claimApplication({ guildId, id, userId, now }) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const current = this.getApplication(guildId, id);
        if (!current) {
          db.exec("ROLLBACK");
          return { ok: false, code: "application_missing" };
        }
        if (current.claimed_by === userId && current.status === "claimed") {
          db.exec("COMMIT");
          return { ok: true, idempotent: true, application: current };
        }
        const changed = db.prepare(
          `UPDATE applications SET status = 'claimed', claimed_by = ?, claimed_at = ?, updated_at = ?
           WHERE guild_id = ? AND id = ? AND status = 'pending' AND claimed_by IS NULL`,
        ).run(userId, now, now, guildId, id).changes === 1;
        db.exec("COMMIT");
        return changed
          ? { ok: true, idempotent: false, application: this.getApplication(guildId, id) }
          : { ok: false, code: current.status === "pending" ? "claim_taken" : "application_decided", application: this.getApplication(guildId, id) };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    lockApproval({ guildId, id, reviewerId, now }) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const current = this.getApplication(guildId, id);
        if (!current) {
          db.exec("ROLLBACK");
          return { ok: false, code: "application_missing" };
        }
        if (current.status === "approved" && current.role_applied) {
          db.exec("COMMIT");
          return { ok: true, done: true, application: current };
        }
        if (current.status === "approving") {
          db.exec("COMMIT");
          return { ok: true, retry: true, application: current };
        }
        if (current.status !== "pending" && current.status !== "claimed") {
          db.exec("COMMIT");
          return { ok: false, code: "application_decided", application: current };
        }
        db.prepare(
          `UPDATE applications SET status = 'approving', decision_by = ?, updated_at = ?
           WHERE guild_id = ? AND id = ? AND status IN ('pending', 'claimed')`,
        ).run(reviewerId, now, guildId, id);
        db.exec("COMMIT");
        return { ok: true, locked: true, previous: current.status, application: this.getApplication(guildId, id) };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    markApplicationApproved({ guildId, id, roleId, reviewerId, now, notifyState }) {
      return db.prepare(
        `UPDATE applications
         SET status = 'approved', role_id = ?, role_applied = 1, decision_by = ?, decision_reason = NULL,
             decided_at = ?, notify_state = ?, updated_at = ?
         WHERE guild_id = ? AND id = ? AND status = 'approving'`,
      ).run(roleId, reviewerId, now, notifyState, now, guildId, id).changes === 1;
    },
    revertApproval(guildId, id, status, now) {
      return db.prepare(
        `UPDATE applications SET status = ?, updated_at = ? WHERE guild_id = ? AND id = ? AND status = 'approving'`,
      ).run(status, now, guildId, id).changes === 1;
    },
    rejectApplication({ guildId, id, reviewerId, reason, now }) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const current = this.getApplication(guildId, id);
        if (!current) {
          db.exec("ROLLBACK");
          return { ok: false, code: "application_missing" };
        }
        if (current.status === "rejected") {
          db.exec("COMMIT");
          return { ok: true, idempotent: true, application: current };
        }
        const changed = db.prepare(
          `UPDATE applications
           SET status = 'rejected', decision_by = ?, decision_reason = ?, decided_at = ?, role_applied = 0, updated_at = ?
           WHERE guild_id = ? AND id = ? AND status IN ('pending', 'claimed')`,
        ).run(reviewerId, reason, now, now, guildId, id).changes === 1;
        db.exec("COMMIT");
        return changed
          ? { ok: true, idempotent: false, application: this.getApplication(guildId, id) }
          : { ok: false, code: current.status === "approving" ? "application_busy" : "application_decided", application: this.getApplication(guildId, id) };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    setNotifyState(guildId, id, state) {
      db.prepare("UPDATE applications SET notify_state = ? WHERE guild_id = ? AND id = ?").run(state, guildId, id);
    },
    releasePosting() {
      db.prepare("UPDATE applications SET review_message_id = NULL WHERE review_message_id = 'posting'").run();
    },
    listUnpostedApplications() {
      return db.prepare(
        `SELECT * FROM applications
         WHERE status IN ('pending', 'claimed', 'approving', 'approved', 'rejected') AND review_message_id IS NULL`,
      ).all().map((row) => this.mapApplication(row));
    },
    listApprovingApplications() {
      return db.prepare("SELECT * FROM applications WHERE status = 'approving'").all().map((row) => this.mapApplication(row));
    },
    deleteApplication(guildId, id) {
      const current = this.getApplication(guildId, id);
      if (!current || current.status === "approving") return { ok: false, application: current };
      db.prepare("DELETE FROM applications WHERE guild_id = ? AND id = ? AND status != 'approving'").run(guildId, id);
      return { ok: true, application: current };
    },
    deleteOwnApplications(guildId, applicantId) {
      const rows = db.prepare("SELECT * FROM applications WHERE guild_id = ? AND applicant_id = ?").all(guildId, applicantId).map((row) => this.mapApplication(row));
      const blocked = rows.filter((row) => row.status === "approving");
      if (blocked.length) return { ok: false, code: "application_busy", applications: rows };
      db.prepare("DELETE FROM applications WHERE guild_id = ? AND applicant_id = ?").run(guildId, applicantId);
      return { ok: true, applications: rows };
    },
    trackFormPost({ guildId, channelId, messageId }) {
      db.prepare(
        `INSERT INTO application_posts (guild_id, channel_id, message_id) VALUES (?, ?, ?)
         ON CONFLICT(guild_id, channel_id, message_id) DO NOTHING`,
      ).run(guildId, channelId, messageId);
    },
    listFormPosts(guildId) {
      return guildId
        ? db.prepare("SELECT * FROM application_posts WHERE guild_id = ?").all(guildId)
        : db.prepare("SELECT * FROM application_posts").all();
    },
    pruneFormPost(post) {
      db.prepare("DELETE FROM application_posts WHERE guild_id = ? AND channel_id = ? AND message_id = ?").run(post.guild_id, post.channel_id, post.message_id);
    },
    getAzureSettings(guildId) {
      const row = db.prepare("SELECT * FROM azure_settings WHERE guild_id = ?").get(guildId);
      if (!row) return { guild_id: guildId, log_channel_id: null, auto_start_enabled: true };
      return { ...row, auto_start_enabled: row.auto_start_enabled === 1 };
    },
    saveAzureSettings(guildId, patch, now) {
      db.prepare(
        `INSERT INTO azure_settings (guild_id, auto_start_enabled, updated_at) VALUES (?, 1, ?)
         ON CONFLICT(guild_id) DO NOTHING`,
      ).run(guildId, now);
      if ("log_channel_id" in patch) {
        db.prepare("UPDATE azure_settings SET log_channel_id = ?, updated_at = ? WHERE guild_id = ?").run(patch.log_channel_id, now, guildId);
      }
      if ("auto_start_enabled" in patch) {
        db.prepare("UPDATE azure_settings SET auto_start_enabled = ?, updated_at = ? WHERE guild_id = ?").run(patch.auto_start_enabled ? 1 : 0, now, guildId);
      }
      return this.getAzureSettings(guildId);
    },
    mapVm(row) {
      if (!row) return null;
      return {
        ...row,
        block_when_expired: row.block_when_expired === 1,
        auto_start: row.auto_start === 1,
        spot: row.spot === 1,
      };
    },
    listVms(guildId) {
      return db.prepare("SELECT * FROM azure_vms WHERE guild_id = ? ORDER BY display_name").all(guildId).map((row) => this.mapVm(row));
    },
    listAssignedVms(guildId, userId) {
      return db.prepare(
        `SELECT v.* FROM azure_vms v
         JOIN azure_assignments a ON a.vm_id = v.id AND a.guild_id = v.guild_id
         WHERE a.guild_id = ? AND a.user_id = ?
         ORDER BY v.display_name`,
      ).all(guildId, userId).map((row) => this.mapVm(row));
    },
    getVm(guildId, id) {
      return this.mapVm(db.prepare("SELECT * FROM azure_vms WHERE guild_id = ? AND id = ?").get(guildId, id));
    },
    ownsVm(guildId, vmId, userId) {
      return Boolean(db.prepare("SELECT 1 AS ok FROM azure_assignments WHERE guild_id = ? AND vm_id = ? AND user_id = ?").get(guildId, vmId, userId));
    },
    listVmUsers(guildId, vmId) {
      return db.prepare("SELECT user_id, created_at FROM azure_assignments WHERE guild_id = ? AND vm_id = ? ORDER BY created_at").all(guildId, vmId);
    },
    insertVm(row) {
      db.prepare(
        `INSERT INTO azure_vms (
           id, guild_id, display_name, resource_group, vm_name, os_label, size_label, cpu_label, ram_label, gpu_label,
           disk_gb, public_ip, private_ip, validity_until, block_when_expired, auto_start, spot, desired_power,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?)`,
      ).run(
        row.id, row.guildId, row.displayName, row.resourceGroup, row.vmName, row.osLabel, row.sizeLabel, row.cpuLabel,
        row.ramLabel, row.gpuLabel, row.diskGb, row.publicIp, row.privateIp, row.validityUntil,
        row.blockWhenExpired ? 1 : 0, row.autoStart ? 1 : 0, row.spot ? 1 : 0, row.now, row.now,
      );
    },
    updateVm(guildId, id, patch, now) {
      const allowed = ["display_name", "os_label", "size_label", "cpu_label", "ram_label", "gpu_label", "disk_gb", "public_ip", "private_ip", "validity_until", "block_when_expired", "auto_start", "spot", "desired_power", "last_power", "last_power_at", "credentials_cipher"];
      for (const key of allowed) {
        if (!(key in patch)) continue;
        let value = patch[key];
        if (key === "block_when_expired" || key === "auto_start" || key === "spot") value = value ? 1 : 0;
        db.prepare(`UPDATE azure_vms SET ${key} = ?, updated_at = ? WHERE guild_id = ? AND id = ?`).run(value, now, guildId, id);
      }
      return this.getVm(guildId, id);
    },
    deleteVm(guildId, id) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM azure_assignments WHERE guild_id = ? AND vm_id = ?").run(guildId, id);
        db.prepare("DELETE FROM azure_locks WHERE guild_id = ? AND vm_id = ?").run(guildId, id);
        db.prepare("DELETE FROM azure_retries WHERE guild_id = ? AND vm_id = ?").run(guildId, id);
        const changes = db.prepare("DELETE FROM azure_vms WHERE guild_id = ? AND id = ?").run(guildId, id).changes;
        db.exec("COMMIT");
        return changes === 1;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    linkVm(guildId, vmId, userId, now) {
      return db.prepare(
        `INSERT INTO azure_assignments (guild_id, vm_id, user_id, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id, vm_id, user_id) DO NOTHING`,
      ).run(guildId, vmId, userId, now).changes === 1;
    },
    unlinkVm(guildId, vmId, userId) {
      return db.prepare("DELETE FROM azure_assignments WHERE guild_id = ? AND vm_id = ? AND user_id = ?").run(guildId, vmId, userId).changes === 1;
    },
    acquireVmLock({ vmId, guildId, operation, actorId, now, holdMs }) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const current = db.prepare("SELECT until_at FROM azure_locks WHERE vm_id = ? AND guild_id = ?").get(vmId, guildId);
        if (current && current.until_at > now) {
          db.exec("COMMIT");
          return false;
        }
        db.prepare(
          `INSERT INTO azure_locks (vm_id, guild_id, operation, actor_id, until_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(vm_id) DO UPDATE SET
             guild_id = excluded.guild_id, operation = excluded.operation, actor_id = excluded.actor_id,
             until_at = excluded.until_at, created_at = excluded.created_at`,
        ).run(vmId, guildId, operation, actorId, now + holdMs, now);
        db.exec("COMMIT");
        return true;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    listAutoStartVms() {
      return db.prepare(
        `SELECT v.* FROM azure_vms v
         LEFT JOIN azure_settings s ON s.guild_id = v.guild_id
         WHERE v.auto_start = 1 AND v.spot = 1 AND v.desired_power = 'running'
           AND COALESCE(s.auto_start_enabled, 1) = 1`,
      ).all().map((row) => this.mapVm(row));
    },
    getVmRetry(vmId) {
      return db.prepare("SELECT * FROM azure_retries WHERE vm_id = ?").get(vmId) ?? null;
    },
    saveVmRetry({ vmId, guildId, attempts, nextAt, lastNotice, now }) {
      db.prepare(
        `INSERT INTO azure_retries (vm_id, guild_id, attempts, next_at, last_notice, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(vm_id) DO UPDATE SET attempts = excluded.attempts, next_at = excluded.next_at,
           last_notice = excluded.last_notice, updated_at = excluded.updated_at`,
      ).run(vmId, guildId, attempts, nextAt, lastNotice, now);
    },
    clearVmRetry(vmId) {
      db.prepare("DELETE FROM azure_retries WHERE vm_id = ?").run(vmId);
    },
    insertDiskRequest(row) {
      db.prepare(
        `INSERT INTO azure_disk_requests (
           id, guild_id, vm_id, user_id, current_gb, requested_gb, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      ).run(row.id, row.guildId, row.vmId, row.userId, row.currentGb, row.requestedGb, row.now, row.now);
    },
    listDiskRequests(guildId) {
      return db.prepare("SELECT * FROM azure_disk_requests WHERE guild_id = ? ORDER BY created_at").all(guildId);
    },
    getDiskRequest(guildId, id) {
      return db.prepare("SELECT * FROM azure_disk_requests WHERE guild_id = ? AND id = ?").get(guildId, id) ?? null;
    },
    finishDiskRequest(guildId, id, status, decidedBy, detail, now) {
      return db.prepare(
        `UPDATE azure_disk_requests
         SET status = ?, decided_by = ?, detail = ?, updated_at = ?
         WHERE guild_id = ? AND id = ? AND status = 'pending'`,
      ).run(status, decidedBy, detail, now, guildId, id).changes === 1;
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
