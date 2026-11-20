import { randomUUID } from "node:crypto";
import { DEFAULT_TIERS, normalizeTiers } from "./model.js";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS invite_settings (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT,
    tiers_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invite_links (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    code TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS invite_joins (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    inviter_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    code TEXT,
    joined_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    eligible INTEGER NOT NULL,
    left_at INTEGER,
    validated_at INTEGER,
    UNIQUE (guild_id, member_id)
  );
  CREATE TABLE IF NOT EXISTS invite_bonus (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS invite_rewards (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    invites INTEGER NOT NULL,
    label TEXT NOT NULL,
    reward_ms INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    resolved_by TEXT,
    UNIQUE (guild_id, user_id, invites)
  );
`;

function mapJoin(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    inviterId: row.inviter_id,
    memberId: row.member_id,
    code: row.code || "",
    joinedAt: row.joined_at,
    status: row.status,
    eligible: row.eligible !== 0,
    leftAt: row.left_at,
    validatedAt: row.validated_at,
  };
}

function mapReward(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    invites: row.invites,
    label: row.label,
    rewardMs: row.reward_ms,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by || "",
  };
}

export function attachInvites(db) {
  db.exec(SCHEMA);
  const settingsGet = db.prepare("SELECT * FROM invite_settings WHERE guild_id = ?");
  const settingsSave = db.prepare(`INSERT INTO invite_settings (guild_id, channel_id, tiers_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      tiers_json = excluded.tiers_json,
      updated_at = excluded.updated_at`);
  const linkGet = db.prepare("SELECT * FROM invite_links WHERE guild_id = ? AND user_id = ?");
  const linkSave = db.prepare(`INSERT INTO invite_links (guild_id, user_id, code, channel_id, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET code = excluded.code, channel_id = excluded.channel_id, created_at = excluded.created_at`);
  const joinInsert = db.prepare(`INSERT INTO invite_joins (
    id, guild_id, inviter_id, member_id, code, joined_at, status, eligible, left_at, validated_at
  ) VALUES (?, ?, ?, ?, ?, ?, 'pendente', 1, NULL, NULL)`);
  const joinByMember = db.prepare("SELECT * FROM invite_joins WHERE guild_id = ? AND member_id = ?");
  const joinById = db.prepare("SELECT * FROM invite_joins WHERE id = ?");
  const joinsByInviter = db.prepare("SELECT * FROM invite_joins WHERE guild_id = ? AND inviter_id = ? ORDER BY joined_at DESC LIMIT ? OFFSET ?");
  const joinCount = db.prepare("SELECT COUNT(*) AS count FROM invite_joins WHERE guild_id = ? AND inviter_id = ?");
  const stats = db.prepare(`SELECT
      SUM(CASE WHEN status = 'valido' AND eligible = 1 THEN 1 ELSE 0 END) AS valid,
      SUM(CASE WHEN status = 'pendente' AND eligible = 1 THEN 1 ELSE 0 END) AS pending
    FROM invite_joins WHERE guild_id = ? AND inviter_id = ?`);
  const due = db.prepare("SELECT * FROM invite_joins WHERE guild_id = ? AND status = 'pendente' AND eligible = 1 AND joined_at <= ?");
  const dueAll = db.prepare("SELECT * FROM invite_joins WHERE status = 'pendente' AND eligible = 1 AND joined_at <= ?");
  const joinPatch = db.prepare("UPDATE invite_joins SET status = ?, eligible = ?, left_at = ?, validated_at = ? WHERE id = ?");
  const resetJoins = db.prepare("UPDATE invite_joins SET eligible = 0 WHERE guild_id = ? AND inviter_id = ?");
  const bonusGet = db.prepare("SELECT amount FROM invite_bonus WHERE guild_id = ? AND user_id = ?");
  const bonusSave = db.prepare(`INSERT INTO invite_bonus (guild_id, user_id, amount) VALUES (?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET amount = excluded.amount`);
  const bonusList = db.prepare("SELECT user_id, amount FROM invite_bonus WHERE guild_id = ? AND amount != 0");
  const validGroups = db.prepare(`SELECT inviter_id AS user_id, COUNT(*) AS total
    FROM invite_joins WHERE guild_id = ? AND status = 'valido' AND eligible = 1 GROUP BY inviter_id`);
  const rewardInsert = db.prepare(`INSERT INTO invite_rewards (
    id, guild_id, user_id, invites, label, reward_ms, status, created_at, resolved_at, resolved_by
  ) VALUES (?, ?, ?, ?, ?, ?, 'aguardando', ?, NULL, NULL)`);
  const rewardsByUser = db.prepare("SELECT * FROM invite_rewards WHERE guild_id = ? AND user_id = ? ORDER BY invites");
  const rewardById = db.prepare("SELECT * FROM invite_rewards WHERE id = ?");
  const rewardResolve = db.prepare("UPDATE invite_rewards SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ? AND status = 'aguardando'");
  return {
    inviteSettings(guildId) {
      const row = settingsGet.get(guildId);
      const tiers = normalizeTiers(row?.tiers_json ? JSON.parse(row.tiers_json) : DEFAULT_TIERS);
      return { guildId, channelId: row?.channel_id || "", tiers };
    },
    saveInviteSettings(guildId, settings, now) {
      const tiers = normalizeTiers(settings.tiers);
      settingsSave.run(guildId, settings.channelId || null, JSON.stringify(tiers.length ? tiers : DEFAULT_TIERS), now);
    },
    inviteLink(guildId, userId) {
      const row = linkGet.get(guildId, userId);
      if (!row) return null;
      return { guildId: row.guild_id, userId: row.user_id, code: row.code, channelId: row.channel_id, createdAt: row.created_at };
    },
    saveInviteLink(row) {
      linkSave.run(row.guildId, row.userId, row.code, row.channelId, row.createdAt);
    },
    insertInviteJoin(row) {
      const id = row.id || randomUUID();
      try {
        joinInsert.run(id, row.guildId, row.inviterId, row.memberId, row.code || null, row.joinedAt);
      } catch (error) {
        if (!String(error.message).includes("UNIQUE")) throw error;
        return null;
      }
      return mapJoin(joinById.get(id));
    },
    inviteJoinByMember(guildId, memberId) {
      return mapJoin(joinByMember.get(guildId, memberId));
    },
    inviteJoins(guildId, inviterId, limit = 100, offset = 0) {
      return joinsByInviter.all(guildId, inviterId, limit, offset).map(mapJoin);
    },
    inviteJoinTotal(guildId, inviterId) {
      return Number(joinCount.get(guildId, inviterId).count);
    },
    inviteStats(guildId, inviterId) {
      const row = stats.get(guildId, inviterId);
      return { valid: Number(row?.valid || 0), pending: Number(row?.pending || 0) };
    },
    dueInviteJoins(guildId, joinedBefore) {
      const rows = guildId ? due.all(guildId, joinedBefore) : dueAll.all(joinedBefore);
      return rows.map(mapJoin);
    },
    patchInviteJoin(id, patch) {
      const current = mapJoin(joinById.get(id));
      if (!current) return null;
      const next = { ...current, ...patch };
      joinPatch.run(next.status, next.eligible ? 1 : 0, next.leftAt ?? null, next.validatedAt ?? null, id);
      return mapJoin(joinById.get(id));
    },
    resetInviteJoins(guildId, inviterId) {
      resetJoins.run(guildId, inviterId);
    },
    inviteBonus(guildId, userId) {
      return Number(bonusGet.get(guildId, userId)?.amount || 0);
    },
    saveInviteBonus(guildId, userId, amount) {
      bonusSave.run(guildId, userId, amount);
    },
    inviteRanking(guildId, limit = 10) {
      const totals = new Map();
      for (const row of validGroups.all(guildId)) totals.set(row.user_id, Number(row.total));
      for (const row of bonusList.all(guildId)) totals.set(row.user_id, Math.max(0, (totals.get(row.user_id) || 0) + Number(row.amount)));
      return [...totals.entries()]
        .map(([userId, total]) => ({ userId, total }))
        .filter((row) => row.total > 0)
        .sort((a, b) => b.total - a.total || a.userId.localeCompare(b.userId))
        .slice(0, limit);
    },
    insertInviteReward(row) {
      const id = row.id || randomUUID();
      try {
        rewardInsert.run(id, row.guildId, row.userId, row.invites, row.label, row.rewardMs, row.createdAt);
      } catch (error) {
        if (!String(error.message).includes("UNIQUE")) throw error;
        return null;
      }
      return mapReward(rewardById.get(id));
    },
    inviteRewards(guildId, userId) {
      return rewardsByUser.all(guildId, userId).map(mapReward);
    },
    inviteReward(id) {
      return mapReward(rewardById.get(id));
    },
    resolveInviteReward(id, status, actorId, now) {
      if (rewardResolve.run(status, now, actorId, id).changes !== 1) return null;
      return mapReward(rewardById.get(id));
    },
  };
}
