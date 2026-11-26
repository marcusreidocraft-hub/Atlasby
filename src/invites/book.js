import { STAY_MS, freshTiers, tierProgress } from "./model.js";

export function createInviteBook({ repo, now = () => Date.now() }) {
  function settings(guildId) {
    return repo.inviteSettings(guildId);
  }

  function summary(guildId, userId) {
    const joins = repo.inviteJoins(guildId, userId, 500, 0);
    const bonus = repo.inviteBonus(guildId, userId);
    const tiers = settings(guildId).tiers;
    const stats = repo.inviteStats(guildId, userId);
    const valid = Math.max(0, stats.valid + bonus);
    const rewards = repo.inviteRewards(guildId, userId);
    return {
      joins,
      total: repo.inviteJoinTotal(guildId, userId),
      bonus,
      valid,
      pending: stats.pending,
      rewards,
      ...tierProgress(valid, tiers),
      tiers,
    };
  }

  function unlock(guildId, userId, count) {
    const granted = repo.inviteRewards(guildId, userId).map((reward) => reward.invites);
    const created = [];
    for (const tier of freshTiers(count, settings(guildId).tiers, granted)) {
      const reward = repo.insertInviteReward({
        guildId,
        userId,
        invites: tier.invites,
        label: tier.label,
        rewardMs: tier.rewardMs,
        createdAt: now(),
      });
      if (reward) created.push(reward);
    }
    return created;
  }

  return {
    settings,
    setChannel(guildId, channelId) {
      const current = settings(guildId);
      repo.saveInviteSettings(guildId, { channelId, tiers: current.tiers }, now());
      return settings(guildId);
    },
    summary,
    recordJoin({ guildId, inviterId, memberId, code, joinedAt }) {
      if (!inviterId || inviterId === memberId) return { ok: false, reason: "self" };
      const existing = repo.inviteJoinByMember(guildId, memberId);
      if (existing) return { ok: false, reason: "repeat", join: existing };
      const join = repo.insertInviteJoin({ guildId, inviterId, memberId, code, joinedAt: joinedAt ?? now() });
      if (!join) return { ok: false, reason: "repeat" };
      return { ok: true, join };
    },
    leave(guildId, memberId, at = now()) {
      const join = repo.inviteJoinByMember(guildId, memberId);
      if (!join || join.status === "saiu") return null;
      const wasValid = join.status === "valido" && join.eligible;
      const next = repo.patchInviteJoin(join.id, { status: "saiu", eligible: false, leftAt: at });
      return { join: next, wasValid, summary: summary(guildId, join.inviterId) };
    },
    promote(join, at = now()) {
      if (!join || join.status !== "pendente" || !join.eligible) return null;
      const saved = repo.patchInviteJoin(join.id, { status: "valido", eligible: true, validatedAt: at });
      const view = summary(saved.guildId, saved.inviterId);
      return { join: saved, summary: view, rewards: unlock(saved.guildId, saved.inviterId, view.valid) };
    },
    due(guildId, at = now(), stayMs = STAY_MS) {
      return repo.dueInviteJoins(guildId, at - stayMs);
    },
    adjust(guildId, userId, delta) {
      const before = summary(guildId, userId).valid;
      repo.saveInviteBonus(guildId, userId, repo.inviteBonus(guildId, userId) + delta);
      const view = summary(guildId, userId);
      const rewards = view.valid > before ? unlock(guildId, userId, view.valid) : [];
      return { before, summary: view, rewards };
    },
    reset(guildId, userId) {
      repo.resetInviteJoins(guildId, userId);
      repo.saveInviteBonus(guildId, userId, 0);
      return summary(guildId, userId);
    },
    deliver(rewardId, actorId, at = now()) {
      const reward = repo.resolveInviteReward(rewardId, "entregue", actorId, at);
      if (!reward) return { ok: false, error: "Essa bonificação já foi decidida." };
      const client = repo.getByOwner(reward.guildId, reward.userId);
      if (!client || client.expiresAt <= at) return { ok: true, reward, extended: null, client: client || null };
      const expiresAt = client.expiresAt + reward.rewardMs;
      repo.updateClient({ ...client, expiresAt, now: at });
      return { ok: true, reward, extended: expiresAt, client };
    },
    refuse(rewardId, actorId, at = now()) {
      const reward = repo.resolveInviteReward(rewardId, "recusado", actorId, at);
      if (!reward) return { ok: false, error: "Essa bonificação já foi decidida." };
      return { ok: true, reward };
    },
    ranking(guildId, limit = 10) {
      return repo.inviteRanking(guildId, limit);
    },
  };
}
