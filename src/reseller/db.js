const SCHEMA = `
  CREATE TABLE IF NOT EXISTS resellers (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reseller_vms (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    reseller_id TEXT NOT NULL,
    infra_id TEXT NOT NULL,
    name TEXT NOT NULL,
    size TEXT NOT NULL DEFAULT '',
    public_ip TEXT NOT NULL DEFAULT '',
    power_state TEXT NOT NULL DEFAULT 'desconhecida',
    operation TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (guild_id, infra_id)
  );
`;

function mapReseller(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    keyHash: row.key_hash,
    revoked: row.revoked === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVm(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    resellerId: row.reseller_id,
    infraId: row.infra_id,
    name: row.name,
    size: row.size || "",
    publicIp: row.public_ip || "",
    powerState: row.power_state || "desconhecida",
    operation: row.operation || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function attachResellers(db) {
  db.exec(SCHEMA);
  return {
    insertReseller(row) {
      db.prepare(`INSERT INTO resellers (id, guild_id, name, key_hash, revoked, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?)`).run(row.id, row.guildId, row.name, row.keyHash, row.now, row.now);
    },
    resellers(guildId) {
      return db.prepare("SELECT * FROM resellers WHERE guild_id = ? ORDER BY name").all(guildId).map(mapReseller);
    },
    reseller(id) {
      return mapReseller(db.prepare("SELECT * FROM resellers WHERE id = ?").get(id));
    },
    resellerByHash(hash) {
      return mapReseller(db.prepare("SELECT * FROM resellers WHERE key_hash = ?").get(hash));
    },
    setResellerHash(id, keyHash, now) {
      db.prepare("UPDATE resellers SET key_hash = ?, revoked = 0, updated_at = ? WHERE id = ?").run(keyHash, now, id);
    },
    revokeReseller(id, now) {
      return db.prepare("UPDATE resellers SET revoked = 1, updated_at = ? WHERE id = ?").run(now, id).changes === 1;
    },
    insertResellerVm(row) {
      db.prepare(`INSERT INTO reseller_vms (
        id, guild_id, reseller_id, infra_id, name, size, public_ip, power_state, operation, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`).run(
        row.id, row.guildId, row.resellerId, row.infraId, row.name, row.size || "", row.publicIp || "", row.powerState || "desconhecida", row.now, row.now,
      );
    },
    resellerVms(resellerId) {
      return db.prepare("SELECT * FROM reseller_vms WHERE reseller_id = ? ORDER BY name").all(resellerId).map(mapVm);
    },
    resellerVmsByGuild(guildId) {
      return db.prepare("SELECT * FROM reseller_vms WHERE guild_id = ?").all(guildId).map(mapVm);
    },
    resellerVm(id) {
      return mapVm(db.prepare("SELECT * FROM reseller_vms WHERE id = ?").get(id));
    },
    deleteResellerVm(id, resellerId) {
      return db.prepare("DELETE FROM reseller_vms WHERE id = ? AND reseller_id = ?").run(id, resellerId).changes === 1;
    },
    patchResellerVm(id, patch, now) {
      const current = mapVm(db.prepare("SELECT * FROM reseller_vms WHERE id = ?").get(id));
      if (!current) return null;
      const next = { ...current, ...patch };
      db.prepare(`UPDATE reseller_vms SET name = ?, size = ?, public_ip = ?, power_state = ?, operation = ?, updated_at = ? WHERE id = ?`).run(
        next.name, next.size, next.publicIp, next.powerState, next.operation, now, id,
      );
      return mapVm(db.prepare("SELECT * FROM reseller_vms WHERE id = ?").get(id));
    },
  };
}
