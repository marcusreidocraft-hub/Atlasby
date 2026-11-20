export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const STAY_MS = DAY_MS;

export const DEFAULT_TIERS = Object.freeze([
  Object.freeze({ invites: 10, rewardMs: 6 * HOUR_MS, label: "6 horas de máquina" }),
  Object.freeze({ invites: 20, rewardMs: 12 * HOUR_MS, label: "12 horas de máquina" }),
  Object.freeze({ invites: 30, rewardMs: 24 * HOUR_MS, label: "24 horas de máquina" }),
  Object.freeze({ invites: 40, rewardMs: 3 * DAY_MS, label: "3 dias de máquina" }),
  Object.freeze({ invites: 55, rewardMs: 7 * DAY_MS, label: "1 semana de máquina" }),
]);

export function normalizeTiers(value) {
  const source = Array.isArray(value) && value.length ? value : DEFAULT_TIERS;
  return source
    .map((tier) => ({
      invites: Number(tier.invites),
      rewardMs: Number(tier.rewardMs),
      label: String(tier.label || "").trim(),
    }))
    .filter((tier) => Number.isInteger(tier.invites) && tier.invites > 0 && Number.isFinite(tier.rewardMs) && tier.rewardMs > 0 && tier.label)
    .sort((a, b) => a.invites - b.invites);
}

export function validCount(joins, bonus = 0) {
  const base = (joins || []).filter((join) => join.status === "valido" && join.eligible !== 0 && join.eligible !== false).length;
  return Math.max(0, base + Number(bonus || 0));
}

export function pendingCount(joins) {
  return (joins || []).filter((join) => join.status === "pendente" && join.eligible !== 0 && join.eligible !== false).length;
}

export function tierProgress(count, tiers = DEFAULT_TIERS) {
  const list = normalizeTiers(tiers);
  const next = list.find((tier) => count < tier.invites) || null;
  const current = [...list].reverse().find((tier) => count >= tier.invites) || null;
  return { count, next, current, remaining: next ? next.invites - count : 0 };
}

export function freshTiers(count, tiers, grantedInvites) {
  const granted = new Set(grantedInvites || []);
  return normalizeTiers(tiers).filter((tier) => count >= tier.invites && !granted.has(tier.invites));
}

export function statusLabel(join) {
  if (join.status === "saiu") return "saiu";
  if (join.eligible === 0 || join.eligible === false) return "resetado";
  if (join.status === "valido") return "válido";
  return "pendente";
}

export function detectInviter({ before = [], after = [], memberId = "", featuredDelta = 0 } = {}) {
  const previous = new Map(before.map((invite) => [invite.code, Number(invite.uses) || 0]));
  const deltas = [];
  for (const invite of after) {
    const uses = Number(invite.uses) || 0;
    const delta = uses - (previous.get(invite.code) ?? 0);
    if (delta > 0) deltas.push({ code: invite.code, inviterId: invite.inviterId || "", bot: Boolean(invite.bot), delta });
  }
  const singles = deltas.filter((invite) => invite.delta === 1);
  const chosen = singles.length === 1 ? singles[0] : deltas.length === 1 ? deltas[0] : null;
  if (!chosen && Number(featuredDelta) > 0) return { kind: "featured" };
  if (!chosen) return { kind: "unknown" };
  if (!chosen.inviterId) return { kind: "unknown" };
  if (chosen.bot) return { kind: "bot" };
  if (chosen.inviterId === memberId) return { kind: "self" };
  return { kind: "user", inviterId: chosen.inviterId, code: chosen.code };
}

export function dueJoins(joins, now, stayMs = STAY_MS) {
  return (joins || []).filter((join) => join.status === "pendente" && join.eligible !== 0 && join.eligible !== false && Number(join.joinedAt) + stayMs <= now);
}
