import { randomUUID } from "node:crypto";
import { assessConfirmation } from "./confirmations.js";
import { parseDuration } from "./duration.js";
import { canPostLogs, evaluateLogConfig, evaluateModeration } from "./permissions.js";

const REASON_MAX = 512;

export function normalizeReason(reason) {
  if (typeof reason !== "string") return { ok: false, code: "reason_required" };
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, code: "reason_required" };
  if (trimmed.length > REASON_MAX) return { ok: false, code: "reason_length" };
  return { ok: true, reason: trimmed };
}

function deny(action, fields) {
  return {
    ok: false,
    action,
    punishmentApplied: false,
    logDelivered: false,
    auditRecorded: false,
    ...fields,
  };
}

export function createService({ store, discord, now = () => Date.now(), ttlMs }) {
  if (!Number.isInteger(ttlMs) || ttlMs < 15_000 || ttlMs > 300_000) {
    throw new Error("ttlMs inválido.");
  }

  async function loadPeople(guildId, actorId, targetId) {
    try {
      return { ok: true, ctx: await discord.getModerationContext(guildId, actorId, targetId) };
    } catch {
      return deny(null, { code: "lookup_failed" });
    }
  }

  function decide(action, ctx, actorId, targetId) {
    if (ctx.actor?.id !== actorId) return deny(action, { code: "lookup_failed" });
    if (targetId === ctx.guildOwnerId) return deny(action, { code: "owner_protected" });
    if (!ctx.target) return deny(action, { code: "target_not_member" });
    if (ctx.target.id !== targetId) return deny(action, { code: "lookup_failed" });

    const decision = evaluateModeration({
      action,
      actorId,
      targetId,
      botId: ctx.bot.id,
      actorPermissions: ctx.actor.permissions,
      targetPermissions: ctx.target.permissions,
      botPermissions: ctx.bot.permissions,
      actorHighestPosition: ctx.actor.highestPosition,
      targetHighestPosition: ctx.target.highestPosition,
      botHighestPosition: ctx.bot.highestPosition,
      actorIsOwner: actorId === ctx.guildOwnerId,
      targetIsOwner: targetId === ctx.guildOwnerId,
      botIsOwner: ctx.bot.id === ctx.guildOwnerId,
    });
    if (!decision.ok) return deny(action, decision);
    return { ok: true, action, ctx };
  }

  async function ensureLogChannel(action, guildId) {
    const channelId = store.getLogChannel(guildId);
    if (!channelId) return deny(action, { code: "log_channel_missing" });
    let info;
    try {
      info = await discord.inspectChannel(channelId);
    } catch {
      return deny(action, { code: "log_channel_check_failed" });
    }
    if (!info || info.guildId !== guildId) return deny(action, { code: "log_channel_unusable" });
    if (info.type !== "GuildText") return deny(action, { code: "log_channel_unusable" });
    if (!canPostLogs(info.permissions)) return deny(action, { code: "log_channel_unusable" });
    return { ok: true, channelId };
  }

  async function prepare(action, { guildId, actorId, targetId }) {
    if (actorId === targetId) return deny(action, { code: "self_protected" });
    const loaded = await loadPeople(guildId, actorId, targetId);
    if (!loaded.ok) return { ...loaded, action };
    const decision = decide(action, loaded.ctx, actorId, targetId);
    if (!decision.ok) return decision;
    const logs = await ensureLogChannel(action, guildId);
    if (!logs.ok) return logs;
    return { ok: true, action, ctx: loaded.ctx, channelId: logs.channelId };
  }

  async function deliver(action, prepared, { guildId, actorId, targetId, reason, extra }, perform) {
    const ts = now();
    let pendingId;
    try {
      pendingId = store.insertAction({
        guildId,
        action,
        status: "pending",
        targetId,
        moderatorId: actorId,
        reason,
        detail: extra ?? null,
        now: ts,
      });
    } catch {
      return deny(action, { code: "audit_failed" });
    }

    try {
      await perform();
    } catch {
      let auditRecorded = false;
      try {
        store.updateAction(pendingId, {
          status: "failed",
          now: now(),
          detail: { stage: "discord" },
        });
        auditRecorded = true;
      } catch {
        auditRecorded = false;
      }
      return {
        ok: false,
        action,
        code: "discord_api",
        punishmentApplied: false,
        logDelivered: false,
        auditRecorded,
      };
    }

    let logDelivered = false;
    try {
      await discord.sendLog(prepared.channelId, {
        action,
        guildId,
        targetId,
        moderatorId: actorId,
        reason,
        extra: extra ?? null,
        at: now(),
      });
      logDelivered = true;
    } catch {
      logDelivered = false;
    }

    try {
      store.updateAction(pendingId, {
        status: logDelivered ? "succeeded" : "partial",
        now: now(),
        detail: { logDelivered },
      });
    } catch {
      return {
        ok: false,
        action,
        code: "audit_failed",
        punishmentApplied: true,
        logDelivered,
        auditRecorded: false,
      };
    }

    if (!logDelivered) {
      return {
        ok: false,
        action,
        code: "log_failed",
        punishmentApplied: true,
        logDelivered: false,
        auditRecorded: true,
      };
    }
    return {
      ok: true,
      action,
      code: "applied",
      punishmentApplied: true,
      logDelivered: true,
      auditRecorded: true,
    };
  }

  async function requestConfirmation(action, { guildId, actorId, targetId, reason }) {
    const normalized = normalizeReason(reason);
    if (!normalized.ok) return deny(action, normalized);
    const prepared = await prepare(action, { guildId, actorId, targetId });
    if (!prepared.ok) return prepared;
    const ts = now();
    const id = randomUUID();
    try {
      store.createConfirmation({
        id,
        guildId,
        moderatorId: actorId,
        targetId,
        action,
        reason: normalized.reason,
        expiresAt: ts + ttlMs,
        now: ts,
      });
    } catch {
      return deny(action, { code: "audit_failed" });
    }
    return {
      ok: false,
      action,
      code: "confirmation_required",
      confirmationId: id,
      expiresAt: ts + ttlMs,
      punishmentApplied: false,
      logDelivered: false,
      auditRecorded: false,
    };
  }

  return {
    async warn({ guildId, actorId, targetId, reason }) {
      const normalized = normalizeReason(reason);
      if (!normalized.ok) return deny("warn", normalized);
      const prepared = await prepare("warn", { guildId, actorId, targetId });
      if (!prepared.ok) return prepared;
      const ts = now();
      let ids;
      try {
        ids = store.recordWarning({
          guildId,
          targetId,
          moderatorId: actorId,
          reason: normalized.reason,
          now: ts,
        });
      } catch {
        return deny("warn", { code: "warn_persist_failed" });
      }

      let logDelivered = false;
      try {
        await discord.sendLog(prepared.channelId, {
          action: "warn",
          guildId,
          targetId,
          moderatorId: actorId,
          reason: normalized.reason,
          warningId: ids.warningId,
          at: now(),
        });
        logDelivered = true;
      } catch {
        logDelivered = false;
      }

      try {
        store.updateAction(ids.actionId, {
          status: logDelivered ? "succeeded" : "partial",
          now: now(),
          detail: { warningId: ids.warningId, logDelivered },
        });
      } catch {
        return {
          ok: false,
          action: "warn",
          code: "audit_failed",
          punishmentApplied: true,
          logDelivered,
          auditRecorded: false,
          warningId: ids.warningId,
        };
      }

      if (!logDelivered) {
        return {
          ok: false,
          action: "warn",
          code: "log_failed",
          punishmentApplied: true,
          logDelivered: false,
          auditRecorded: true,
          warningId: ids.warningId,
        };
      }
      return {
        ok: true,
        action: "warn",
        code: "applied",
        punishmentApplied: true,
        logDelivered: true,
        auditRecorded: true,
        warningId: ids.warningId,
      };
    },

    async timeout({ guildId, actorId, targetId, reason, duration }) {
      const normalized = normalizeReason(reason);
      if (!normalized.ok) return deny("timeout", normalized);
      const parsed = parseDuration(duration);
      if (!parsed.ok) return deny("timeout", parsed);
      const prepared = await prepare("timeout", { guildId, actorId, targetId });
      if (!prepared.ok) return prepared;
      const label = duration.trim();
      return deliver(
        "timeout",
        prepared,
        {
          guildId,
          actorId,
          targetId,
          reason: normalized.reason,
          extra: { durationMs: parsed.ms, durationLabel: label },
        },
        () => discord.timeoutMember(guildId, targetId, parsed.ms, normalized.reason),
      );
    },

    async removeTimeout({ guildId, actorId, targetId, reason }) {
      const normalized = normalizeReason(reason);
      if (!normalized.ok) return deny("timeout_remove", normalized);
      const prepared = await prepare("timeout_remove", { guildId, actorId, targetId });
      if (!prepared.ok) return prepared;
      const until = prepared.ctx.target.timedOutUntil;
      if (until == null || until <= now()) return deny("timeout_remove", { code: "not_timed_out" });
      return deliver(
        "timeout_remove",
        prepared,
        { guildId, actorId, targetId, reason: normalized.reason },
        () => discord.removeTimeout(guildId, targetId, normalized.reason),
      );
    },

    requestKick(input) {
      return requestConfirmation("kick", input);
    },

    requestBan(input) {
      return requestConfirmation("ban", input);
    },

    async confirm({ confirmationId, guildId, moderatorId, decision }) {
      const row = store.getConfirmation(confirmationId);
      const assessment = assessConfirmation(row, { guildId, moderatorId, now: now() });
      if (!assessment.ok) {
        return deny(row?.action ?? null, assessment);
      }

      if (decision === "cancel") {
        const cancelled = store.cancelConfirmation(confirmationId, { guildId, moderatorId, now: now() });
        if (!cancelled) {
          const again = assessConfirmation(store.getConfirmation(confirmationId), {
            guildId,
            moderatorId,
            now: now(),
          });
          return deny(row.action, again.ok ? { code: "confirmation_used" } : again);
        }
        return {
          ok: true,
          action: row.action,
          code: "cancelled",
          punishmentApplied: false,
          logDelivered: false,
          auditRecorded: false,
        };
      }

      const prepared = await prepare(row.action, {
        guildId,
        actorId: moderatorId,
        targetId: row.target_id,
      });
      if (!prepared.ok) return prepared;

      const claimed = store.claimConfirmation(confirmationId, { guildId, moderatorId, now: now() });
      if (!claimed) {
        const again = assessConfirmation(store.getConfirmation(confirmationId), {
          guildId,
          moderatorId,
          now: now(),
        });
        return deny(row.action, again.ok ? { code: "confirmation_used" } : again);
      }

      const result = await deliver(
        row.action,
        prepared,
        {
          guildId,
          actorId: moderatorId,
          targetId: row.target_id,
          reason: row.reason,
        },
        async () => {
          if (row.action === "kick") await discord.kickMember(guildId, row.target_id, row.reason);
          else await discord.banMember(guildId, row.target_id, row.reason);
        },
      );

      try {
        store.finishConfirmation(confirmationId, result.punishmentApplied ? "completed" : "failed", now());
      } catch {
        if (result.punishmentApplied) {
          return { ...result, ok: false, code: "audit_failed", auditRecorded: false };
        }
        return { ...result, auditRecorded: false };
      }
      return result;
    },

    async setLogChannel({ guildId, actorId, channelId }) {
      if (!channelId) return deny("set_log_channel", { code: "channel_required" });
      let actor;
      try {
        actor = await discord.inspectActor(guildId, actorId);
      } catch {
        return deny("set_log_channel", { code: "lookup_failed" });
      }
      const allowed = evaluateLogConfig({ actorPermissions: actor?.permissions });
      if (!allowed.ok) return deny("set_log_channel", allowed);

      let info;
      try {
        info = await discord.inspectChannel(channelId);
      } catch {
        return deny("set_log_channel", { code: "log_channel_check_failed" });
      }
      if (!info || info.guildId !== guildId) return deny("set_log_channel", { code: "channel_guild" });
      if (info.type !== "GuildText") return deny("set_log_channel", { code: "channel_type" });
      if (!canPostLogs(info.permissions)) return deny("set_log_channel", { code: "log_channel_unusable" });

      const ts = now();
      try {
        store.setLogChannel(guildId, channelId, ts);
      } catch {
        return deny("set_log_channel", { code: "log_channel_save_failed" });
      }
      try {
        store.insertAction({
          guildId,
          action: "set_log_channel",
          status: "succeeded",
          targetId: null,
          moderatorId: actorId,
          reason: null,
          detail: { channelId },
          now: ts,
        });
      } catch {
        return {
          ok: true,
          action: "set_log_channel",
          code: "log_channel_saved",
          punishmentApplied: false,
          logDelivered: false,
          auditRecorded: false,
        };
      }
      return {
        ok: true,
        action: "set_log_channel",
        code: "log_channel_saved",
        punishmentApplied: false,
        logDelivered: false,
        auditRecorded: true,
      };
    },
  };
}
