export function assessConfirmation(row, { guildId, moderatorId, now }) {
  if (!row) return { ok: false, code: "confirmation_missing" };
  if (row.guild_id !== guildId) return { ok: false, code: "confirmation_guild" };
  if (row.moderator_id !== moderatorId) return { ok: false, code: "confirmation_wrong_user" };
  if (row.expires_at <= now) return { ok: false, code: "confirmation_expired" };
  if (row.status !== "open") return { ok: false, code: "confirmation_used" };
  return { ok: true };
}
