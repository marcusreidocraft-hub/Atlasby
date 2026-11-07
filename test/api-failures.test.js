import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { describeResult } from "../src/messages.js";
import { createService } from "../src/service.js";
import { openDatabase } from "../src/storage.js";
import { ACTOR, CHANNEL, GUILD, TARGET, context, fakeDiscord } from "../src/fixtures.js";

function harness(discordOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlasby-api-"));
  const store = openDatabase(dir);
  store.setLogChannel(GUILD, CHANNEL, 1);
  const discord = fakeDiscord(discordOverrides);
  const service = createService({ store, discord, now: () => 5_000, ttlMs: 60_000 });
  return { store, discord, service, close: () => store.close() };
}

function statuses(store) {
  return store.listActions(GUILD).map((row) => row.status);
}

test("falha da API de expulsão não grava sucesso nem envia log", async () => {
  const app = harness({
    async kickMember() {
      throw new Error("HTTP 500");
    },
  });
  const pending = await app.service.requestKick({
    guildId: GUILD,
    actorId: ACTOR,
    targetId: TARGET,
    reason: "flood",
  });
  const result = await app.service.confirm({
    confirmationId: pending.confirmationId,
    guildId: GUILD,
    moderatorId: ACTOR,
    decision: "confirm",
  });
  assert.equal(result.code, "discord_api");
  assert.equal(result.ok, false);
  assert.equal(result.punishmentApplied, false);
  assert.equal(result.logDelivered, false);
  assert.equal(statuses(app.store).includes("succeeded"), false);
  assert.equal(statuses(app.store).includes("partial"), false);
  assert.deepEqual(statuses(app.store), ["failed"]);
  assert.equal(app.discord.calls.some((call) => call[0] === "log"), false);
  assert.match(describeResult(result), /não foi aplicado/);
  assert.doesNotMatch(describeResult(result), /recebeu o registro/);
  assert.equal(app.store.getConfirmation(pending.confirmationId).status, "failed");
  app.close();
});

test("timeout não é aplicado se a chamada ao Discord falha", async () => {
  const app = harness({
    async timeoutMember() {
      throw new Error("timeout recusado");
    },
  });
  const pending = await app.service.timeout({
    guildId: GUILD,
    actorId: ACTOR,
    targetId: TARGET,
    reason: "ofensa",
    duration: "10m",
  });
  assert.equal(pending.code, "confirmation_required");
  assert.equal(app.discord.calls.some((call) => call[0] === "timeout"), false);
  const result = await app.service.confirm({
    confirmationId: pending.confirmationId,
    guildId: GUILD,
    moderatorId: ACTOR,
    decision: "confirm",
  });
  assert.equal(result.punishmentApplied, false);
  assert.equal(result.code, "discord_api");
  assert.deepEqual(statuses(app.store), ["failed"]);
  assert.match(describeResult(result), /não foi aplicado/);
  app.close();
});

test("falha ao gravar o aviso não chama o Discord e não deixa registro", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlasby-warn-"));
  const store = openDatabase(dir, { failAfterWarningInsert: true });
  store.setLogChannel(GUILD, CHANNEL, 1);
  const discord = fakeDiscord();
  const service = createService({ store, discord, now: () => 5_000, ttlMs: 60_000 });
  const pending = await service.warn({
    guildId: GUILD,
    actorId: ACTOR,
    targetId: TARGET,
    reason: "aviso",
  });
  assert.equal(store.listWarnings(GUILD).length, 0);
  const result = await service.confirm({
    confirmationId: pending.confirmationId,
    guildId: GUILD,
    moderatorId: ACTOR,
    decision: "confirm",
  });
  assert.equal(result.code, "warn_persist_failed");
  assert.equal(result.punishmentApplied, false);
  assert.equal(store.listWarnings(GUILD).length, 0);
  assert.equal(discord.calls.length, 0);
  assert.match(describeResult(result), /não foi registrado/);
  store.close();
});

test("aviso gravado com falha de log não é anunciado como envio concluído", async () => {
  const app = harness({
    async sendLog() {
      throw new Error("canal sumiu");
    },
  });
  const pending = await app.service.warn({
    guildId: GUILD,
    actorId: ACTOR,
    targetId: TARGET,
    reason: "aviso persistente",
  });
  assert.equal(app.store.listWarnings(GUILD).length, 0);
  const result = await app.service.confirm({
    confirmationId: pending.confirmationId,
    guildId: GUILD,
    moderatorId: ACTOR,
    decision: "confirm",
  });
  assert.equal(result.code, "log_failed");
  assert.equal(result.ok, false);
  assert.equal(result.punishmentApplied, true);
  assert.equal(app.store.listWarnings(GUILD).length, 1);
  assert.deepEqual(statuses(app.store), ["partial"]);
  const message = describeResult(result);
  assert.match(message, /foi registrado/);
  assert.match(message, /não recebeu a mensagem/);
  assert.doesNotMatch(message, /recebeu o registro/);
  app.close();
});

test("consulta ao Discord que falha impede a punição", async () => {
  const app = harness({
    async getModerationContext() {
      throw new Error("gateway");
    },
  });
  const result = await app.service.timeout({
    guildId: GUILD,
    actorId: ACTOR,
    targetId: TARGET,
    reason: "motivo",
    duration: "30s",
  });
  assert.equal(result.code, "lookup_failed");
  assert.equal(result.punishmentApplied, false);
  assert.deepEqual(statuses(app.store), []);
  assert.equal(app.discord.calls.length, 0);
  app.close();
});

test("canal de logs ausente ou sem permissão bloqueia antes da API", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlasby-nolog-"));
  const store = openDatabase(dir);
  const discord = fakeDiscord();
  const service = createService({ store, discord, now: () => 5_000, ttlMs: 60_000 });
  const missing = await service.requestKick({
    guildId: GUILD,
    actorId: ACTOR,
    targetId: TARGET,
    reason: "motivo",
  });
  assert.equal(missing.code, "log_channel_missing");
  assert.equal(discord.calls.length, 0);

  store.setLogChannel(GUILD, CHANNEL, 1);
  discord.inspectChannel = async () => {
    throw new Error("unknown channel");
  };
  const failedCheck = await service.timeout({
    guildId: GUILD,
    actorId: ACTOR,
    targetId: TARGET,
    reason: "motivo",
    duration: "30s",
  });
  assert.equal(failedCheck.code, "log_channel_check_failed");
  assert.equal(failedCheck.punishmentApplied, false);
  assert.deepEqual(statuses(store), []);
  store.close();
});

test("remoção de timeout sem timeout ativo não chama a API", async () => {
  const app = harness({
    async getModerationContext() {
      return context({ target: { timedOutUntil: null } });
    },
  });
  const result = await app.service.removeTimeout({
    guildId: GUILD,
    actorId: ACTOR,
    targetId: TARGET,
    reason: "rever decisão",
  });
  assert.equal(result.code, "not_timed_out");
  assert.equal(result.punishmentApplied, false);
  assert.equal(app.discord.calls.length, 0);
  app.close();
});

test("auditoria que falha antes da chamada não pune", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlasby-audit-"));
  const store = openDatabase(dir);
  store.setLogChannel(GUILD, CHANNEL, 1);
  const discord = fakeDiscord();
  const broken = {
    ...store,
    insertAction() {
      throw new Error("disco cheio");
    },
  };
  const service = createService({ store: broken, discord, now: () => 5_000, ttlMs: 60_000 });
  const pending = await service.timeout({
    guildId: GUILD,
    actorId: ACTOR,
    targetId: TARGET,
    reason: "motivo",
    duration: "30s",
  });
  assert.equal(pending.code, "confirmation_required");
  const result = await service.confirm({
    confirmationId: pending.confirmationId,
    guildId: GUILD,
    moderatorId: ACTOR,
    decision: "confirm",
  });
  assert.equal(result.code, "audit_failed");
  assert.equal(result.punishmentApplied, false);
  assert.equal(discord.calls.length, 0);
  assert.match(describeResult(result), /não foi aplicado/);
  store.close();
});
