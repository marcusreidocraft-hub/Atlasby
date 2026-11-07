import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseBrlToCents, planSpec, publicPlanLine, validatePlanUpdate } from "../src/plans.js";
import { createService } from "../src/service.js";
import { openDatabase } from "../src/storage.js";
import { renderAdminPicker, renderCatalog, renderLogPicker, textOf, validateV2Message } from "../src/ui.js";
import { ACTOR, CHANNEL, GUILD, OTHER, OTHER_GUILD, OWNER, TARGET, context, fakeDiscord } from "../src/fixtures.js";

function harness(discordOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlasby-catalog-"));
  const store = openDatabase(dir);
  store.setLogChannel(GUILD, CHANNEL, 1);
  const discord = fakeDiscord(discordOverrides);
  const service = createService({ store, discord, now: () => 5_000, ttlMs: 60_000 });
  return { store, discord, service, close: () => store.close() };
}

async function confirm(service, pending, moderatorId = ACTOR) {
  return service.confirm({
    confirmationId: pending.confirmationId,
    guildId: GUILD,
    moderatorId,
    decision: "confirm",
  });
}

test("preço em centavos aceita só valores inteiros autorizados", () => {
  assert.equal(parseBrlToCents("3590").cents, 3590);
  assert.equal(parseBrlToCents("35,90").cents, 3590);
  assert.equal(parseBrlToCents("R$ 49.90").cents, 4990);
  for (const bad of ["", "35,9", "35.9", "0", "-1", "10.000,00", "6h", "1d", null]) {
    assert.equal(parseBrlToCents(bad).ok, false, String(bad));
  }
  assert.equal(validatePlanUpdate(planSpec("30d"), { priceCents: null, available: true }).code, "price_required");
  assert.equal(validatePlanUpdate({ code: "7d", durationDays: 1 }, { priceCents: 3590, available: true }).code, "plan_forbidden");
  assert.equal(validatePlanUpdate({ code: "6h", durationDays: 7 }, { priceCents: 3590, available: true }).code, "plan_unknown");
});

test("catálogo novo traz 7d, quinzenal temporário e mensal esgotado sem preço", async () => {
  const app = harness();
  const catalog = await app.service.catalog({ guildId: GUILD });
  const byCode = Object.fromEntries(catalog.plans.map((plan) => [plan.code, plan]));
  assert.deepEqual(Object.keys(byCode), ["7d", "15d", "30d"]);
  assert.equal(byCode["7d"].price_cents, 3590);
  assert.equal(byCode["7d"].available, true);
  assert.equal(byCode["15d"].price_cents, 4990);
  assert.equal(byCode["15d"].temporary_price, true);
  assert.equal(byCode["30d"].price_cents, null);
  assert.equal(byCode["30d"].available, false);
  assert.equal(publicPlanLine(byCode["7d"]), "7 dias · R$35,90");
  assert.equal(publicPlanLine(byCode["15d"]), "Quinzenal · 15 dias · R$49,90 · preço temporário");
  assert.equal(publicPlanLine(byCode["30d"]), "Mensal · 30 dias · Esgotado");
  assert.doesNotMatch(publicPlanLine(byCode["30d"]), /R\$/);

  const payload = renderCatalog(catalog.plans);
  const rendered = textOf(payload);
  assert.match(rendered, /Tesla T4 · 4 vCPU/);
  assert.match(rendered, /Somente catálogo/);
  assert.match(rendered, /R\$35,90/);
  assert.match(rendered, /R\$49,90/);
  assert.match(rendered, /preço temporário/);
  assert.match(rendered, /Esgotado/);
  assert.doesNotMatch(rendered, /Comprar|6h|1 dia|provisionad/i);
  assert.equal(payload.flags, 32768);
  const validation = validateV2Message(payload);
  assert.deepEqual(validation.errors, []);
  const sold = JSON.stringify(payload.components[0].toJSON());
  assert.match(sold, /"disabled":true/);
  assert.doesNotMatch(sold, /sku_id/);
  app.close();
});

test("padrão não cobre alteração posterior nem outro servidor", async () => {
  const app = harness();
  await app.service.catalog({ guildId: GUILD });
  await app.service.catalog({ guildId: OTHER_GUILD });
  const changed = await app.service.requestSetPlan({
    guildId: GUILD,
    actorId: OWNER,
    code: "15d",
    priceCents: 5100,
  });
  assert.equal(changed.code, "confirmation_required");
  assert.equal(app.store.getPlan(GUILD, "15d").price_cents, 4990);
  const saved = await confirm(app.service, changed, OWNER);
  assert.equal(saved.code, "config_saved");
  assert.equal(app.store.getPlan(GUILD, "15d").price_cents, 5100);
  await app.service.catalog({ guildId: GUILD });
  await app.service.catalog({ guildId: OTHER_GUILD });
  assert.equal(app.store.getPlan(GUILD, "15d").price_cents, 5100);
  assert.equal(app.store.getPlan(OTHER_GUILD, "15d").price_cents, 4990);
  assert.equal(app.store.updatePlan({ guildId: GUILD, code: "6h", durationDays: 7, priceCents: 100, available: true, now: 1 }), false);
  assert.equal(app.store.listPlans(GUILD).some((plan) => plan.code === "6h" || plan.duration_days === 1), false);
  app.close();
});

test("mensal esgotado não pode ser selecionado sem preço e estranho não configura", async () => {
  const app = harness();
  const denied = await app.service.requestSetPlan({
    guildId: GUILD,
    actorId: ACTOR,
    code: "7d",
    priceCents: 1000,
  });
  assert.equal(denied.code, "admin_unauthorized");
  const blocked = await app.service.requestSetPlan({
    guildId: GUILD,
    actorId: OWNER,
    code: "30d",
    available: true,
  });
  assert.equal(blocked.code, "price_required");
  assert.equal(app.store.getPlan(GUILD, "30d").available, false);
  assert.equal(app.store.getPlan(GUILD, "30d").price_cents, null);
  const enrolled = await app.service.requestEnrollAdmin({ guildId: GUILD, actorId: ACTOR, userId: OTHER });
  assert.equal(enrolled.code, "owner_only");
  const picker = renderAdminPicker([]);
  const logs = renderLogPicker();
  assert.equal(validateV2Message(picker).ok, true);
  assert.equal(validateV2Message(logs).ok, true);
  app.close();
});

test("aviso, timeout, expulsão e banimento esperam confirmação do mesmo moderador", async () => {
  const app = harness({
    async getModerationContext() {
      return context({ target: { timedOutUntil: 60_000 } });
    },
  });
  const warn = await app.service.warn({ guildId: GUILD, actorId: ACTOR, targetId: TARGET, reason: "motivo" });
  const silence = await app.service.timeout({
    guildId: GUILD,
    actorId: ACTOR,
    targetId: TARGET,
    reason: "motivo",
    duration: "10m",
  });
  const remove = await app.service.removeTimeout({ guildId: GUILD, actorId: ACTOR, targetId: TARGET, reason: "motivo" });
  const kick = await app.service.requestKick({ guildId: GUILD, actorId: ACTOR, targetId: TARGET, reason: "motivo" });
  const ban = await app.service.requestBan({ guildId: GUILD, actorId: ACTOR, targetId: TARGET, reason: "motivo" });
  for (const pending of [warn, silence, remove, kick, ban]) assert.equal(pending.code, "confirmation_required");
  assert.equal(app.discord.calls.length, 0);
  assert.equal(app.store.listWarnings(GUILD).length, 0);

  const wrong = await app.service.confirm({
    confirmationId: warn.confirmationId,
    guildId: GUILD,
    moderatorId: OTHER,
    decision: "confirm",
  });
  assert.equal(wrong.code, "confirmation_wrong_user");
  assert.equal(app.store.getConfirmation(warn.confirmationId).status, "open");

  const expired = await createService({
    store: app.store,
    discord: app.discord,
    now: () => 70_000,
    ttlMs: 60_000,
  }).confirm({
    confirmationId: silence.confirmationId,
    guildId: GUILD,
    moderatorId: ACTOR,
    decision: "confirm",
  });
  assert.equal(expired.code, "confirmation_expired");
  assert.equal(app.discord.calls.some((call) => call[0] === "timeout"), false);

  const cancelled = await app.service.confirm({
    confirmationId: remove.confirmationId,
    guildId: GUILD,
    moderatorId: ACTOR,
    decision: "cancel",
  });
  assert.equal(cancelled.code, "cancelled");
  assert.equal(cancelled.punishmentApplied, false);

  const applied = await confirm(app.service, kick);
  assert.equal(applied.punishmentApplied, true);
  assert.deepEqual(app.discord.calls[0], ["kick", GUILD, TARGET, "motivo"]);
  const replay = await confirm(app.service, kick);
  assert.equal(replay.code, "confirmation_used");
  assert.equal(app.discord.calls.filter((call) => call[0] === "kick").length, 1);
  app.close();
});

test("validador rejeita conteúdo legado e payload sem a flag V2", () => {
  const legacy = validateV2Message({ content: "texto", flags: 32768, components: [{ type: 10, content: "ok" }] });
  assert.equal(legacy.ok, false);
  assert.ok(legacy.errors.includes("content"));
  const unflagged = validateV2Message({ flags: 64, components: [{ type: 10, content: "ok" }] });
  assert.equal(unflagged.ok, false);
  assert.ok(unflagged.errors.includes("flag"));
});
