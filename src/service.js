import { randomUUID } from "node:crypto";
import { assessConfirmation } from "./confirmations.js";
import { parseDuration } from "./duration.js";
import { PRODUCTS, durationSpec, offerState, parseBrlToCents, parseStock, validatePlanUpdate } from "./plans.js";
import { collectHistoryPages, renderTranscriptDocument, safeAvatarUrl, staffMention, ticketOverwrites } from "./tickets.js";
import { canPostLogs, evaluateModeration, hasPermission, Permissions } from "./permissions.js";

const REASON_MAX = 512;
const SNOWFLAKE = /^\d{17,20}$/;
const CONFIG_ACTIONS = new Set([
  "set_log_channel",
  "set_plan",
  "set_stock",
  "set_category",
  "set_staff_role",
  "set_transcript_channel",
  "enroll_admin",
  "remove_admin",
]);
const MODERATION_ACTIONS = new Set(["warn", "timeout", "timeout_remove", "kick", "ban"]);

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

function readPayload(row) {
  if (!row?.payload) return {};
  try {
    const value = JSON.parse(row.payload);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value;
  } catch {
    return null;
  }
}

export function createService({ store, discord, now = () => Date.now(), ttlMs }) {
  if (!Number.isInteger(ttlMs) || ttlMs < 15_000 || ttlMs > 300_000) throw new Error("ttlMs inválido.");

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
    if (!info || info.guildId !== guildId || info.type !== "GuildText" || !canPostLogs(info.permissions)) {
      return deny(action, { code: "log_channel_unusable" });
    }
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

  function openConfirmation({ action, guildId, actorId, targetId, reason, payload, summary }) {
    const ts = now();
    const id = randomUUID();
    try {
      store.createConfirmation({
        id,
        guildId,
        moderatorId: actorId,
        targetId,
        action,
        reason,
        payload: payload ?? null,
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
      summary: summary ?? null,
      punishmentApplied: false,
      logDelivered: false,
      auditRecorded: false,
    };
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
        store.updateAction(pendingId, { status: "failed", now: now(), detail: { stage: "discord" } });
        auditRecorded = true;
      } catch {
        auditRecorded = false;
      }
      return { ok: false, action, code: "discord_api", punishmentApplied: false, logDelivered: false, auditRecorded };
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
      return { ok: false, action, code: "audit_failed", punishmentApplied: true, logDelivered, auditRecorded: false };
    }
    if (!logDelivered) {
      return { ok: false, action, code: "log_failed", punishmentApplied: true, logDelivered: false, auditRecorded: true };
    }
    return { ok: true, action, code: "applied", punishmentApplied: true, logDelivered: true, auditRecorded: true };
  }

  async function requestModeration(action, { guildId, actorId, targetId, reason, payload, summary }) {
    const normalized = normalizeReason(reason);
    if (!normalized.ok) return deny(action, normalized);
    const prepared = await prepare(action, { guildId, actorId, targetId });
    if (!prepared.ok) return prepared;
    if (action === "timeout_remove") {
      const until = prepared.ctx.target.timedOutUntil;
      if (until == null || until <= now()) return deny(action, { code: "not_timed_out" });
    }
    return openConfirmation({
      action,
      guildId,
      actorId,
      targetId,
      reason: normalized.reason,
      payload,
      summary,
    });
  }

  async function assertAdmin(guildId, userId, { ownerOnly = false } = {}) {
    let actor;
    try {
      actor = await discord.inspectActor(guildId, userId);
    } catch {
      return deny(null, { code: "lookup_failed" });
    }
    const isOwner = actor?.isOwner === true || actor?.ownerId === userId;
    if (ownerOnly && !isOwner) return deny(null, { code: "owner_only" });
    if (isOwner || store.isGuildAdmin(guildId, userId)) return { ok: true, isOwner };
    return deny(null, { code: "admin_unauthorized" });
  }

  async function executeModeration(row, prepared) {
    const payload = readPayload(row);
    if (payload == null) return deny(row.action, { code: "confirmation_mismatch" });
    if (row.action === "warn") {
      let ids;
      try {
        ids = store.recordWarning({
          guildId: row.guild_id,
          targetId: row.target_id,
          moderatorId: row.moderator_id,
          reason: row.reason,
          now: now(),
        });
      } catch {
        return deny("warn", { code: "warn_persist_failed" });
      }
      let logDelivered = false;
      try {
        await discord.sendLog(prepared.channelId, {
          action: "warn",
          guildId: row.guild_id,
          targetId: row.target_id,
          moderatorId: row.moderator_id,
          reason: row.reason,
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
    }
    const input = {
      guildId: row.guild_id,
      actorId: row.moderator_id,
      targetId: row.target_id,
      reason: row.reason,
      extra: row.action === "timeout" ? { durationMs: payload.durationMs, durationLabel: payload.durationLabel } : null,
    };
    const perform = async () => {
      if (row.action === "timeout") {
        await discord.timeoutMember(row.guild_id, row.target_id, payload.durationMs, row.reason);
      } else if (row.action === "timeout_remove") await discord.removeTimeout(row.guild_id, row.target_id, row.reason);
      else if (row.action === "kick") await discord.kickMember(row.guild_id, row.target_id, row.reason);
      else await discord.banMember(row.guild_id, row.target_id, row.reason);
    };
    return deliver(row.action, prepared, input, perform);
  }

  async function executeConfig(row) {
    const payload = readPayload(row);
    if (payload == null) return deny(row.action, { code: "confirmation_mismatch" });
    const ts = now();
    try {
      if (row.action === "set_log_channel") {
        if (payload.channelId !== row.target_id) return deny(row.action, { code: "confirmation_mismatch" });
        store.setLogChannel(row.guild_id, payload.channelId, ts);
      } else if (row.action === "set_plan" || row.action === "set_stock") {
        const sku = payload.sku ?? "t4-4";
        const duration = durationSpec(sku, payload.code);
        if (!duration || `${sku}:${payload.code}` !== row.target_id) return deny(row.action, { code: "confirmation_mismatch" });
        if (row.action === "set_plan") {
          const valid = validatePlanUpdate({ ...duration, sku, code: payload.code }, payload);
          if (!valid.ok) return deny(row.action, valid);
          const updated = store.updatePlan({
            guildId: row.guild_id,
            sku,
            code: payload.code,
            durationDays: duration.durationDays,
            priceCents: valid.priceCents,
            available: valid.available,
            now: ts,
          });
          if (!updated) return deny(row.action, { code: "plan_unknown" });
        } else {
          const parsed = parseStock(payload.stock);
          if (!parsed.ok) return deny(row.action, parsed);
          if (!store.updateStock({ guildId: row.guild_id, sku, code: payload.code, stock: parsed.stock, now: ts })) {
            return deny(row.action, { code: "plan_unknown" });
          }
        }
      } else if (row.action === "set_category" || row.action === "set_staff_role" || row.action === "set_transcript_channel") {
        const field = {
          set_category: "ticket_category_id",
          set_staff_role: "staff_role_id",
          set_transcript_channel: "transcript_channel_id",
        }[row.action];
        if (payload.value !== row.target_id) return deny(row.action, { code: "confirmation_mismatch" });
        store.setGuildField(row.guild_id, field, payload.value, ts);
      } else if (row.action === "enroll_admin") {
        if (payload.userId !== row.target_id || !SNOWFLAKE.test(payload.userId)) {
          return deny(row.action, { code: "confirmation_mismatch" });
        }
        store.enrollAdmin({ guildId: row.guild_id, userId: payload.userId, enrolledBy: row.moderator_id, now: ts });
      } else if (row.action === "remove_admin") {
        if (payload.userId !== row.target_id) return deny(row.action, { code: "confirmation_mismatch" });
        if (!store.removeAdmin(row.guild_id, payload.userId)) return deny(row.action, { code: "admin_missing" });
      }
      store.insertAction({
        guildId: row.guild_id,
        action: row.action,
        status: "succeeded",
        targetId: row.target_id,
        moderatorId: row.moderator_id,
        reason: row.reason,
        detail: payload,
        now: ts,
      });
    } catch {
      return deny(row.action, { code: "config_save_failed" });
    }
    return {
      ok: true,
      action: row.action,
      code: "config_saved",
      punishmentApplied: false,
      logDelivered: false,
      auditRecorded: true,
    };
  }

  async function canStaff(guildId, userId) {
    let actor;
    try {
      actor = await discord.inspectActor(guildId, userId);
    } catch {
      return false;
    }
    if (actor?.isOwner === true || actor?.ownerId === userId || store.isGuildAdmin(guildId, userId)) return true;
    const roleId = store.getSettings(guildId)?.staff_role_id;
    if (!roleId) return false;
    try {
      return await discord.memberHasRole(guildId, userId, roleId);
    } catch {
      return false;
    }
  }

  async function deliverTranscript(guildId, ticket) {
    const settings = store.getSettings(guildId);
    let destination = ticket.channel_id;
    if (settings?.transcript_channel_id) {
      let info;
      try {
        info = await discord.inspectChannel(settings.transcript_channel_id);
      } catch {
        const error = new Error("canal");
        error.code = "unsafe";
        throw error;
      }
      if (!info || info.guildId !== guildId || info.everyoneCanView || info.type !== "GuildText" || !canPostLogs(info.permissions)) {
        const error = new Error("canal");
        error.code = "unsafe";
        throw error;
      }
      destination = settings.transcript_channel_id;
    }
    const messages = await collectHistoryPages((before) => discord.fetchHistoryPage(ticket.channel_id, before));
    const html = renderTranscriptDocument(messages);
    await discord.deliverTranscript({ channelId: destination, html, filename: `ticket-${ticket.id}.html` });
    return html;
  }

  async function executeClose(row) {
    const ticket = store.getTicket(row.guild_id, row.target_id);
    if (!ticket || ticket.status !== "open" || !ticket.channel_id) return deny("close_ticket", { code: "ticket_missing" });
    const allowed = row.moderator_id === ticket.opener_id || (await canStaff(row.guild_id, row.moderator_id));
    if (!allowed) return deny("close_ticket", { code: "staff_only" });
    try {
      await deliverTranscript(row.guild_id, ticket);
    } catch (error) {
      return deny("close_ticket", { code: error?.code === "unsafe" ? "transcript_channel_unsafe" : "transcript_failed" });
    }
    let identity;
    try {
      identity = await discord.guildIdentity(row.guild_id);
      const settings = store.getSettings(row.guild_id);
      await discord.applyOverwrites(
        ticket.channel_id,
        ticketOverwrites({
          everyoneId: identity.everyoneId,
          openerId: ticket.opener_id,
          staffRoleId: settings.staff_role_id,
          botId: identity.botId,
          archive: true,
        }),
      );
    } catch {
      return deny("close_ticket", { code: "discord_api" });
    }
    const released = store.releaseTicket({ guildId: row.guild_id, id: ticket.id, closedBy: row.moderator_id, now: now() });
    if (!released.released) return deny("close_ticket", { code: "ticket_missing" });
    return {
      ok: true,
      action: "close_ticket",
      code: "ticket_closed",
      ticket: released.ticket,
      punishmentApplied: false,
      logDelivered: true,
      auditRecorded: false,
    };
  }

  return {
    async warn(input) {
      return requestModeration("warn", input);
    },

    async timeout({ guildId, actorId, targetId, reason, duration }) {
      const normalized = normalizeReason(reason);
      if (!normalized.ok) return deny("timeout", normalized);
      const parsed = parseDuration(duration);
      if (!parsed.ok) return deny("timeout", parsed);
      const label = duration.trim();
      return requestModeration("timeout", {
        guildId,
        actorId,
        targetId,
        reason: normalized.reason,
        payload: { durationMs: parsed.ms, durationLabel: label },
        summary: `Duração: ${label}.`,
      });
    },

    async removeTimeout(input) {
      return requestModeration("timeout_remove", input);
    },

    requestKick(input) {
      return requestModeration("kick", input);
    },

    requestBan(input) {
      return requestModeration("ban", input);
    },

    async catalog({ guildId }) {
      store.ensureDefaultPlans(guildId, PRODUCTS, now());
      return {
        ok: true,
        action: null,
        code: "catalog",
        plans: store.listPlans(guildId),
        punishmentApplied: false,
        logDelivered: false,
        auditRecorded: false,
      };
    },

    async adminView({ guildId, actorId }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "config" };
      store.ensureDefaultPlans(guildId, PRODUCTS, now());
      return {
        ok: true,
        action: "config",
        code: "admin_panel",
        isOwner: auth.isOwner,
        logChannelId: store.getLogChannel(guildId),
        plans: store.listPlans(guildId),
        admins: store.listAdmins(guildId),
        punishmentApplied: false,
        logDelivered: false,
        auditRecorded: false,
      };
    },

    async requestSetLogChannel({ guildId, actorId, channelId }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "set_log_channel" };
      if (!channelId) return deny("set_log_channel", { code: "channel_required" });
      let info;
      try {
        info = await discord.inspectChannel(channelId);
      } catch {
        return deny("set_log_channel", { code: "log_channel_check_failed" });
      }
      if (!info || info.guildId !== guildId) return deny("set_log_channel", { code: "channel_guild" });
      if (info.type !== "GuildText") return deny("set_log_channel", { code: "channel_type" });
      if (!canPostLogs(info.permissions)) return deny("set_log_channel", { code: "log_channel_unusable" });
      return openConfirmation({
        action: "set_log_channel",
        guildId,
        actorId,
        targetId: channelId,
        reason: "Alterar o canal de logs",
        payload: { channelId },
        summary: `Canal proposto: <#${channelId}>.`,
      });
    },

    async requestSetPlan({ guildId, actorId, sku = "t4-4", code, priceCents, available }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "set_plan" };
      const spec = durationSpec(sku, code);
      if (!spec) return deny("set_plan", { code: "plan_unknown" });
      store.ensureDefaultPlans(guildId, PRODUCTS, now());
      const current = store.getItem(guildId, sku, code);
      if (!current || current.duration_days !== spec.durationDays) return deny("set_plan", { code: "plan_unknown" });
      const nextPrice = priceCents === undefined ? current.price_cents : priceCents;
      const nextAvailable = available === undefined ? current.available : Boolean(available);
      const valid = validatePlanUpdate({ ...spec, sku, code }, { priceCents: nextPrice, available: nextAvailable });
      if (!valid.ok) return deny("set_plan", valid);
      const priceText = valid.priceCents == null ? "sem preço" : `${valid.priceCents} centavos`;
      return openConfirmation({
        action: "set_plan",
        guildId,
        actorId,
        targetId: `${sku}:${code}`,
        reason: "Alterar plano do catálogo",
        payload: { sku, code, priceCents: valid.priceCents, available: valid.available },
        summary: `${current.product_name} ${spec.label}: ${priceText}, ${valid.available ? "disponível" : "esgotado"}.`,
      });
    },

    async parseAndRequestPrice({ guildId, actorId, sku = "t4-4", code, rawPrice }) {
      const parsed = parseBrlToCents(rawPrice);
      if (!parsed.ok) return deny("set_plan", parsed);
      return this.requestSetPlan({ guildId, actorId, sku, code, priceCents: parsed.cents });
    },

    async requestSetStock({ guildId, actorId, sku, code, stock }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action: "set_stock" };
      const parsed = parseStock(stock);
      if (!parsed.ok) return deny("set_stock", parsed);
      const spec = durationSpec(sku, code);
      if (!spec) return deny("set_stock", { code: "plan_unknown" });
      store.ensureDefaultPlans(guildId, PRODUCTS, now());
      if (!store.getItem(guildId, sku, code)) return deny("set_stock", { code: "plan_unknown" });
      return openConfirmation({
        action: "set_stock",
        guildId,
        actorId,
        targetId: `${sku}:${code}`,
        reason: "Alterar estoque",
        payload: { sku, code, stock: parsed.stock },
        summary: `Estoque proposto: ${parsed.stock}.`,
      });
    },

    async requestEnrollAdmin({ guildId, actorId, userId }) {
      const auth = await assertAdmin(guildId, actorId, { ownerOnly: true });
      if (!auth.ok) return { ...auth, action: "enroll_admin" };
      if (!SNOWFLAKE.test(userId ?? "")) return deny("enroll_admin", { code: "target_required" });
      if (userId === actorId) return deny("enroll_admin", { code: "self_protected" });
      return openConfirmation({
        action: "enroll_admin",
        guildId,
        actorId,
        targetId: userId,
        reason: "Incluir administrador",
        payload: { userId },
        summary: `Incluir <@${userId}>.`,
      });
    },

    async requestGuildSetting({ guildId, actorId, action, value, summary }) {
      const auth = await assertAdmin(guildId, actorId);
      if (!auth.ok) return { ...auth, action };
      if (!SNOWFLAKE.test(value ?? "")) return deny(action, { code: "channel_required" });
      if (action === "set_category" || action === "set_transcript_channel") {
        let info;
        try {
          info = await discord.inspectChannel(value);
        } catch {
          return deny(action, { code: "log_channel_check_failed" });
        }
        if (!info || info.guildId !== guildId) return deny(action, { code: "channel_guild" });
        if (action === "set_category" && info.type !== "GuildCategory") return deny(action, { code: "channel_type" });
        if (action === "set_transcript_channel" && (info.type !== "GuildText" || info.everyoneCanView || !canPostLogs(info.permissions))) {
          return deny(action, { code: "transcript_channel_unsafe" });
        }
      }
      return openConfirmation({
        action,
        guildId,
        actorId,
        targetId: value,
        reason: "Alterar configuração de ticket",
        payload: { value },
        summary,
      });
    },

    async openTicket({ guildId, openerId, sku, code, avatarUrl }) {
      store.ensureDefaultPlans(guildId, PRODUCTS, now());
      const settings = store.getSettings(guildId);
      if (!settings?.ticket_category_id || !settings?.staff_role_id) return deny("open_ticket", { code: "ticket_setup_required" });
      const item = store.getItem(guildId, sku, code);
      const state = item ? offerState(item) : { code: "plan_unknown" };
      if (!item || !state.openable) return deny("open_ticket", { code: state.code });
      let identity;
      try {
        identity = await discord.guildIdentity(guildId);
      } catch {
        return deny("open_ticket", { code: "lookup_failed" });
      }
      if (!hasPermission(identity.botPermissions, Permissions.ManageChannels)) return deny("open_ticket", { code: "bot_permission" });
      const reserved = store.reserveTicket({ guildId, openerId, sku, code, now: now(), id: randomUUID() });
      if (!reserved.ok) return deny("open_ticket", reserved);
      if (reserved.ticket.channel_id) {
        return { ok: true, action: "open_ticket", code: "ticket_exists", ticket: reserved.ticket, punishmentApplied: false, logDelivered: false, auditRecorded: false };
      }
      let channelId;
      try {
        const created = await discord.createTicketChannel({
          guildId,
          name: `ticket-${sku}-${code}`.slice(0, 90),
          parentId: settings.ticket_category_id,
          overwrites: ticketOverwrites({
            everyoneId: identity.everyoneId,
            openerId,
            staffRoleId: settings.staff_role_id,
            botId: identity.botId,
          }),
        });
        channelId = created.id;
      } catch {
        store.failPendingTicket(reserved.ticket.id);
        return deny("open_ticket", { code: "discord_api" });
      }
      if (!store.markTicketOpen(reserved.ticket.id, channelId)) return deny("open_ticket", { code: "config_save_failed" });
      const ticket = store.getTicket(guildId, reserved.ticket.id);
      try {
        await discord.sendTicketPanel({
          channelId,
          ticket,
          avatarUrl: safeAvatarUrl(avatarUrl),
          staffRoleId: settings.staff_role_id,
          mention: staffMention(settings.staff_role_id),
        });
      } catch {
        return { ok: false, action: "open_ticket", code: "ticket_panel_failed", ticket, punishmentApplied: false, logDelivered: false, auditRecorded: false };
      }
      return { ok: true, action: "open_ticket", code: reserved.idempotent ? "ticket_exists" : "ticket_opened", ticket, punishmentApplied: false, logDelivered: true, auditRecorded: false };
    },

    async claimTicket({ guildId, actorId, ticketId }) {
      if (!(await canStaff(guildId, actorId))) return deny("claim_ticket", { code: "staff_only" });
      const result = store.claimTicket({ guildId, id: ticketId, userId: actorId, now: now() });
      if (!result.ticket) return deny("claim_ticket", { code: "ticket_missing" });
      if (!result.changed) return { ok: false, action: "claim_ticket", code: "claim_taken", ticket: result.ticket, punishmentApplied: false, logDelivered: false, auditRecorded: false };
      return { ok: true, action: "claim_ticket", code: "ticket_claimed", ticket: result.ticket, punishmentApplied: false, logDelivered: false, auditRecorded: false };
    },

    async clearTicketClaim({ guildId, actorId, ticketId }) {
      if (!(await canStaff(guildId, actorId))) return deny("claim_ticket", { code: "staff_only" });
      const result = store.clearTicketClaim({ guildId, id: ticketId });
      if (!result.ticket) return deny("claim_ticket", { code: "ticket_missing" });
      return { ok: true, action: "claim_ticket", code: "claim_cleared", ticket: result.ticket, punishmentApplied: false, logDelivered: false, auditRecorded: false };
    },

    async requestCloseTicket({ guildId, actorId, ticketId }) {
      const ticket = store.getTicket(guildId, ticketId);
      if (!ticket || ticket.status !== "open") return deny("close_ticket", { code: "ticket_missing" });
      const allowed = actorId === ticket.opener_id || (await canStaff(guildId, actorId));
      if (!allowed) return deny("close_ticket", { code: "staff_only" });
      return openConfirmation({
        action: "close_ticket",
        guildId,
        actorId,
        targetId: ticketId,
        reason: "Fechar ticket e liberar a reserva",
        payload: { ticketId },
        summary: "O canal permanece arquivado e a reserva volta ao estoque. Não é uma venda.",
      });
    },

    async transcriptTicket({ guildId, actorId, ticketId }) {
      const ticket = store.getTicket(guildId, ticketId);
      if (!ticket?.channel_id) return deny("transcript", { code: "ticket_missing" });
      const allowed = actorId === ticket.opener_id || (await canStaff(guildId, actorId));
      if (!allowed) return deny("transcript", { code: "staff_only" });
      try {
        await deliverTranscript(guildId, ticket);
      } catch (error) {
        return deny("transcript", { code: error?.code === "unsafe" ? "transcript_channel_unsafe" : "transcript_failed" });
      }
      return { ok: true, action: "transcript", code: "transcript_ready", ticket, punishmentApplied: false, logDelivered: true, auditRecorded: false };
    },

    async requestRemoveAdmin({ guildId, actorId, userId }) {
      const auth = await assertAdmin(guildId, actorId, { ownerOnly: true });
      if (!auth.ok) return { ...auth, action: "remove_admin" };
      if (!store.isGuildAdmin(guildId, userId)) return deny("remove_admin", { code: "admin_missing" });
      return openConfirmation({
        action: "remove_admin",
        guildId,
        actorId,
        targetId: userId,
        reason: "Remover administrador",
        payload: { userId },
        summary: `Remover <@${userId}>.`,
      });
    },

    async confirm({ confirmationId, guildId, moderatorId, decision }) {
      const row = store.getConfirmation(confirmationId);
      const assessment = assessConfirmation(row, { guildId, moderatorId, now: now() });
      if (!assessment.ok) return deny(row?.action ?? null, assessment);
      if (decision === "cancel") {
        const cancelled = store.cancelConfirmation(confirmationId, { guildId, moderatorId, now: now() });
        if (!cancelled) {
          const again = assessConfirmation(store.getConfirmation(confirmationId), { guildId, moderatorId, now: now() });
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

      let prepared = null;
      if (MODERATION_ACTIONS.has(row.action)) {
        prepared = await prepare(row.action, { guildId, actorId: moderatorId, targetId: row.target_id });
        if (!prepared.ok) return prepared;
        if (row.action === "timeout_remove") {
          const until = prepared.ctx.target.timedOutUntil;
          if (until == null || until <= now()) return deny(row.action, { code: "not_timed_out" });
        }
        if (row.action === "timeout") {
          const payload = readPayload(row);
          const parsed = payload ? parseDuration(payload.durationLabel) : { ok: false };
          if (!parsed.ok || parsed.ms !== payload.durationMs) return deny(row.action, { code: "duration_format" });
        }
      } else if (row.action === "close_ticket") {
        const ticket = store.getTicket(guildId, row.target_id);
        const allowed = ticket && (moderatorId === ticket.opener_id || (await canStaff(guildId, moderatorId)));
        if (!allowed) return deny(row.action, { code: "staff_only" });
      } else if (CONFIG_ACTIONS.has(row.action)) {
        const ownerOnly = row.action === "enroll_admin" || row.action === "remove_admin";
        const auth = await assertAdmin(guildId, moderatorId, { ownerOnly });
        if (!auth.ok) return { ...auth, action: row.action };
        if (row.action === "set_log_channel") {
          const payload = readPayload(row);
          if (!payload || payload.channelId !== row.target_id) return deny(row.action, { code: "confirmation_mismatch" });
          let info;
          try {
            info = await discord.inspectChannel(payload.channelId);
          } catch {
            return deny(row.action, { code: "log_channel_check_failed" });
          }
          if (!info || info.guildId !== guildId || info.type !== "GuildText" || !canPostLogs(info.permissions)) {
            return deny(row.action, { code: "log_channel_unusable" });
          }
        }
        if (row.action === "set_plan" || row.action === "set_stock") {
          const payload = readPayload(row);
          const sku = payload?.sku ?? "t4-4";
          const spec = payload ? durationSpec(sku, payload.code) : null;
          const valid = row.action === "set_stock" ? parseStock(payload?.stock) : validatePlanUpdate(spec ? { ...spec, sku, code: payload.code } : null, payload ?? {});
          if (!payload || `${sku}:${payload.code}` !== row.target_id || !valid.ok) {
            return deny(row.action, valid.ok ? { code: "confirmation_mismatch" } : valid);
          }
        }
      } else return deny(row.action, { code: "unknown_action" });

      const claimed = store.claimConfirmation(confirmationId, { guildId, moderatorId, now: now() });
      if (!claimed) {
        const again = assessConfirmation(store.getConfirmation(confirmationId), { guildId, moderatorId, now: now() });
        return deny(row.action, again.ok ? { code: "confirmation_used" } : again);
      }

      const result = MODERATION_ACTIONS.has(row.action)
        ? await executeModeration(row, prepared)
        : row.action === "close_ticket"
          ? await executeClose(row)
          : await executeConfig(row);
      try {
        const completed = result.punishmentApplied || result.code === "config_saved" || result.code === "ticket_closed";
        store.finishConfirmation(confirmationId, completed ? "completed" : "failed", now());
      } catch {
        if (result.punishmentApplied || result.code === "config_saved" || result.code === "ticket_closed") {
          return { ...result, ok: false, code: "audit_failed", auditRecorded: false };
        }
        return { ...result, auditRecorded: false };
      }
      return result;
    },
  };
}
