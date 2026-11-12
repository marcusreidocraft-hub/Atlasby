import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    client_name TEXT NOT NULL,
    machine_name TEXT NOT NULL,
    gpu TEXT NOT NULL,
    vcpus INTEGER NOT NULL,
    ram TEXT NOT NULL,
    public_ip TEXT,
    rdp_user TEXT,
    rdp_password_cipher TEXT,
    pin_cipher TEXT,
    plan_type TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    infra_id TEXT,
    power_status TEXT NOT NULL DEFAULT 'desconhecida',
    last_query_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS action_logs (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_user_id TEXT,
    machine_name TEXT,
    detail TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    support_url TEXT,
    log_channel_id TEXT,
    emoji_json TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS confirmations (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    action TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS panels (
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, channel_id, message_id)
  );
`;

function mapClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    clientName: row.client_name,
    machineName: row.machine_name,
    gpu: row.gpu,
    vcpus: row.vcpus,
    ram: row.ram,
    publicIp: row.public_ip,
    rdpUser: row.rdp_user,
    rdpPasswordCipher: row.rdp_password_cipher,
    pinCipher: row.pin_cipher,
    planType: row.plan_type,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    infraId: row.infra_id,
    powerStatus: row.power_status,
    lastQueryAt: row.last_query_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(path.resolve(dataDir), "atlas.sqlite");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);

  const statements = {
    byOwner: db.prepare("SELECT * FROM clients WHERE guild_id = ? AND user_id = ?"),
    byId: db.prepare("SELECT * FROM clients WHERE guild_id = ? AND id = ?"),
    byInfra: db.prepare("SELECT * FROM clients WHERE guild_id = ? AND infra_id = ? AND infra_id IS NOT NULL"),
    infraLinks: db.prepare("SELECT user_id, client_name, infra_id FROM clients WHERE guild_id = ? AND infra_id IS NOT NULL AND infra_id != ''"),
    insert: db.prepare(`INSERT INTO clients (
      id, guild_id, user_id, client_name, machine_name, gpu, vcpus, ram, public_ip, rdp_user,
      rdp_password_cipher, pin_cipher, plan_type, started_at, expires_at, infra_id, power_status,
      last_query_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    update: db.prepare(`UPDATE clients SET
      client_name = ?, machine_name = ?, gpu = ?, vcpus = ?, ram = ?, public_ip = ?, rdp_user = ?,
      rdp_password_cipher = ?, pin_cipher = ?, plan_type = ?, started_at = ?, expires_at = ?, infra_id = ?,
      updated_at = ?
      WHERE guild_id = ? AND id = ?`),
    power: db.prepare("UPDATE clients SET power_status = ?, last_query_at = ?, updated_at = ? WHERE id = ?"),
    touch: db.prepare("UPDATE clients SET last_query_at = ?, updated_at = ? WHERE id = ?"),
    remove: db.prepare("DELETE FROM clients WHERE guild_id = ? AND user_id = ?"),
    search: db.prepare(`SELECT * FROM clients WHERE guild_id = ? AND (
      client_name LIKE ? OR machine_name LIKE ? OR user_id LIKE ? OR IFNULL(public_ip, '') LIKE ?
    ) ORDER BY client_name LIMIT 10`),
    page: db.prepare("SELECT * FROM clients WHERE guild_id = ? ORDER BY client_name LIMIT ? OFFSET ?"),
    count: db.prepare("SELECT COUNT(*) AS count FROM clients WHERE guild_id = ?"),
    log: db.prepare(`INSERT INTO action_logs (id, guild_id, actor_id, action, target_user_id, machine_name, detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    settings: db.prepare("SELECT * FROM guild_settings WHERE guild_id = ?"),
    saveSettings: db.prepare(`INSERT INTO guild_settings (guild_id, support_url, log_channel_id, emoji_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        support_url = excluded.support_url,
        log_channel_id = excluded.log_channel_id,
        emoji_json = excluded.emoji_json,
        updated_at = excluded.updated_at`),
    draft: db.prepare("SELECT * FROM drafts WHERE id = ?"),
    saveDraft: db.prepare(`INSERT INTO drafts (id, guild_id, actor_id, kind, payload, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at, kind = excluded.kind`),
    deleteDraft: db.prepare("DELETE FROM drafts WHERE id = ?"),
    confirm: db.prepare("SELECT * FROM confirmations WHERE id = ?"),
    saveConfirm: db.prepare(`INSERT INTO confirmations (id, guild_id, user_id, client_id, action, expires_at, used_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)`),
    useConfirm: db.prepare("UPDATE confirmations SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?"),
    panel: db.prepare(`INSERT INTO panels (guild_id, channel_id, message_id, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, channel_id, message_id) DO NOTHING`),
  };

  return {
    file,
    close() {
      db.close();
    },
    getByOwner(guildId, userId) {
      return mapClient(statements.byOwner.get(guildId, userId));
    },
    getById(guildId, id) {
      return mapClient(statements.byId.get(guildId, id));
    },
    findByInfra(guildId, infraId) {
      if (!infraId) return null;
      return mapClient(statements.byInfra.get(guildId, infraId));
    },
    listInfraLinks(guildId) {
      return statements.infraLinks.all(guildId).map((row) => ({
        userId: row.user_id,
        clientName: row.client_name,
        infraId: row.infra_id,
      }));
    },
    insertClient(row) {
      statements.insert.run(
        row.id, row.guildId, row.userId, row.clientName, row.machineName, row.gpu, row.vcpus, row.ram,
        row.publicIp, row.rdpUser, row.rdpPasswordCipher, row.pinCipher, row.planType, row.startedAt,
        row.expiresAt, row.infraId, row.powerStatus ?? "desconhecida", row.lastQueryAt ?? null, row.now, row.now,
      );
    },
    updateClient(row) {
      statements.update.run(
        row.clientName, row.machineName, row.gpu, row.vcpus, row.ram, row.publicIp, row.rdpUser,
        row.rdpPasswordCipher, row.pinCipher, row.planType, row.startedAt, row.expiresAt, row.infraId,
        row.now, row.guildId, row.id,
      );
    },
    updatePower(id, status, now) {
      statements.power.run(status, now, now, id);
    },
    touchQuery(id, now) {
      statements.touch.run(now, now, id);
    },
    removeClient(guildId, userId) {
      return statements.remove.run(guildId, userId).changes;
    },
    searchClients(guildId, term) {
      const like = `%${term.replace(/[\\%_]/g, "")}%`;
      return statements.search.all(guildId, like, like, like, like).map(mapClient);
    },
    pageClients(guildId, limit, offset) {
      return statements.page.all(guildId, limit, offset).map(mapClient);
    },
    countClients(guildId) {
      return Number(statements.count.get(guildId).count);
    },
    addLog(row) {
      statements.log.run(row.id, row.guildId, row.actorId, row.action, row.targetUserId ?? null, row.machineName ?? null, row.detail, row.now);
    },
    getSettings(guildId) {
      const row = statements.settings.get(guildId);
      return {
        supportUrl: row?.support_url ?? "",
        logChannelId: row?.log_channel_id ?? "",
        emoji: row?.emoji_json ? JSON.parse(row.emoji_json) : {},
      };
    },
    saveSettings(guildId, settings, now) {
      statements.saveSettings.run(guildId, settings.supportUrl || null, settings.logChannelId || null, JSON.stringify(settings.emoji ?? {}), now);
    },
    getDraft(id) {
      const row = statements.draft.get(id);
      if (!row) return null;
      return { id: row.id, guildId: row.guild_id, actorId: row.actor_id, kind: row.kind, payload: JSON.parse(row.payload), expiresAt: row.expires_at };
    },
    saveDraft(row) {
      statements.saveDraft.run(row.id, row.guildId, row.actorId, row.kind, JSON.stringify(row.payload), row.expiresAt);
    },
    deleteDraft(id) {
      statements.deleteDraft.run(id);
    },
    getConfirmation(id) {
      const row = statements.confirm.get(id);
      if (!row) return null;
      return {
        id: row.id,
        guildId: row.guild_id,
        userId: row.user_id,
        clientId: row.client_id,
        action: row.action,
        expiresAt: row.expires_at,
        usedAt: row.used_at,
      };
    },
    saveConfirmation(row) {
      statements.saveConfirm.run(row.id, row.guildId, row.userId, row.clientId, row.action, row.expiresAt);
    },
    consumeConfirmation(id, now) {
      return statements.useConfirm.run(now, id, now).changes === 1;
    },
    rememberPanel(row) {
      statements.panel.run(row.guildId, row.channelId, row.messageId, row.now);
    },
  };
}
