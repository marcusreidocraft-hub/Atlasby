import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createService } from "../src/service.js";
import { openDatabase } from "../src/storage.js";
import { PRODUCTS } from "../src/plans.js";
import { Permissions } from "../src/permissions.js";
import { DEFAULT_QUESTIONS } from "../src/forms-model.js";
import { textOf, validateV2Message } from "../src/ui.js";
import { ACTOR, GUILD, OTHER_GUILD, OWNER, TARGET, fakeDiscord } from "../src/fixtures.js";

const REVIEW = "100000000000000061";
const PUBLIC = "100000000000000063";
const ROLE = "100000000000000066";
const STAFF = "100000000000000065";
const EVERYONE = "100000000000000031";
const REVIEWER = "100000000000000069";
const APPLICANT = TARGET;
const ANSWER = "quero ajudar a comunidade no horario combinado";

function roleOf(id, extra = {}) {
  return {
    guildId: GUILD,
    id,
    managed: false,
    everyone: id === EVERYONE,
    position: 5,
    permissions: 0n,
    botHighestPosition: 20,
    botPermissions: Permissions.ManageRoles,
    ...extra,
  };
}

function harness(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlasby-form-"));
  const store = openDatabase(dir);
  store.ensureDefaultPlans(GUILD, PRODUCTS, 1);
  store.setGuildField(GUILD, "staff_role_id", STAFF, 1);
  const calls = [];
  const discord = fakeDiscord({
    async inspectChannel(channelId) {
      calls.push(["inspect", channelId]);
      return {
        guildId: GUILD,
        type: "GuildText",
        permissions: Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks,
        everyoneCanView: channelId === PUBLIC,
      };
    },
    async inspectActor(_guildId, userId) {
      return { id: userId, isOwner: userId === OWNER, ownerId: OWNER, highestPosition: 10, permissions: Permissions.ManageGuild };
    },
    async inspectRole(_guildId, roleId) {
      if (roleId === EVERYONE) return roleOf(EVERYONE, { everyone: true });
      if (roleId === "100000000000000067") return roleOf(roleId, { permissions: Permissions.Administrator });
      if (roleId === "100000000000000068") return roleOf(roleId, { managed: true });
      if (roleId === "100000000000000070") return roleOf(roleId, { position: 30 });
      return roleOf(roleId);
    },
    async memberRoleIds(_guildId, userId) {
      return userId === ACTOR ? [REVIEWER] : [];
    },
    async addRole(...args) {
      calls.push(["role", ...args]);
    },
    async sendComponents(channelId, payload) {
      calls.push(["panel", channelId, payload]);
      return { id: `9000000000000000${calls.length}`.slice(0, 18).padEnd(18, "1") };
    },
    async editMessage(...args) {
      calls.push(["edit", ...args]);
      return { ok: true, missing: false };
    },
    async tryDm(...args) {
      calls.push(["dm", ...args]);
    },
    async deleteMessage(...args) {
      calls.push(["delete", ...args]);
    },
    async sendLog(...args) {
      calls.push(["log", ...args]);
    },
    ...overrides,
  });
  const service = createService({ store, discord, now: () => 5_000, ttlMs: 60_000 });
  return { dir, store, discord, service, calls, close: () => store.close() };
}

async function confirm(service, pending, moderatorId = OWNER) {
  return service.confirm({ confirmationId: pending.confirmationId, guildId: GUILD, moderatorId, decision: "confirm" });
}

async function configure(app) {
  await confirm(app.service, await app.service.forms.requestOpen({ guildId: GUILD, actorId: OWNER }));
  await confirm(app.service, await app.service.forms.requestReview({ guildId: GUILD, actorId: OWNER, channelId: REVIEW }));
  await confirm(app.service, await app.service.forms.requestRole({ guildId: GUILD, actorId: OWNER, roleId: ROLE }));
  await confirm(app.service, await app.service.forms.requestReviewer({ guildId: GUILD, actorId: OWNER, roleId: REVIEWER, op: "add" }));
}

function answersFor(questions, text = ANSWER) {
  return Object.fromEntries(questions.map((question) => [question.id, text]));
}

test("migração 6 preserva ticket, preço e aviso", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlasby-form-migrate-"));
  const first = openDatabase(dir);
  first.ensureDefaultPlans(GUILD, PRODUCTS, 1);
  first.updatePlan({ guildId: GUILD, sku: "t4-4", code: "7d", durationDays: 7, priceCents: 3590, available: true, now: 2 });
  const reserved = first.reserveTicket({ guildId: GUILD, openerId: OWNER, sku: "t4-4", code: "7d", now: 3, id: "11111111-1111-4111-8111-111111111111" });
  first.recordWarning({ guildId: GUILD, targetId: TARGET, moderatorId: ACTOR, reason: "histórico", now: 4 });
  assert.equal(first.migrationCount(), 6);
  first.close();
  const second = openDatabase(dir);
  assert.equal(second.migrationCount(), 6);
  assert.equal(second.getPlan(GUILD, "7d").price_cents, 3590);
  assert.equal(second.getTicket(GUILD, reserved.ticket.id).status, "pending");
  assert.equal(second.listWarnings(GUILD)[0].reason, "histórico");
  assert.equal(second.getForm(GUILD), null);
  second.close();
});

test("painel público é Atlas, privado e sem respostas", async () => {
  const app = harness();
  const published = await app.service.forms.publish({ guildId: GUILD, actorId: OWNER, channelId: PUBLIC });
  const rendered = JSON.stringify(published.message);
  assert.equal(validateV2Message(published.message).ok, true);
  assert.match(rendered, /Fazer formulário/);
  assert.match(rendered, /Atlas/);
  assert.match(rendered, /não são publicadas/);
  assert.doesNotMatch(rendered, /e-mail|senha|cpf|endereço/i);
  const questions = app.store.listQuestions(GUILD);
  assert.deepEqual(questions.map((question) => question.prompt), DEFAULT_QUESTIONS.map((question) => question.prompt));
  const closed = await app.service.forms.start({ guildId: GUILD, userId: APPLICANT });
  assert.equal(closed.code, "applications_closed");
  const unsafe = await app.service.forms.requestReview({ guildId: GUILD, actorId: OWNER, channelId: PUBLIC });
  assert.equal(unsafe.code, "review_channel_unsafe");
  app.close();
});

test("etapas, rascunho, snapshot e isolamento", async () => {
  const app = harness();
  await configure(app);
  for (const prompt of ["Pergunta quatro da etapa", "Pergunta cinco da etapa", "Pergunta seis da etapa"]) {
    const pending = await app.service.forms.requestQuestion({
      guildId: GUILD,
      actorId: OWNER,
      prompt,
      hint: "",
      kindText: "curta",
      requiredText: "sim",
    });
    assert.equal((await confirm(app.service, pending)).code, "config_saved");
  }
  const questions = app.store.listQuestions(GUILD);
  assert.equal(questions.length, 6);
  const started = await app.service.forms.start({ guildId: GUILD, userId: APPLICANT, hasCustomAvatar: false });
  assert.equal(started.modal.data.custom_id.endsWith(":0"), true);
  const applicationId = started.modal.data.custom_id.split(":")[3];
  const first = await app.service.forms.saveStep({ guildId: GUILD, userId: APPLICANT, applicationId, step: 0, raw: answersFor(questions.slice(0, 5)) });
  assert.match(textOf(first.view), /Etapa 1 de 2/);
  app.close();

  const reopened = openDatabase(app.dir);
  const service = createService({ store: reopened, discord: app.discord, now: () => 6_000, ttlMs: 60_000 });
  const draft = reopened.getApplication(GUILD, applicationId);
  assert.equal(draft.status, "draft");
  assert.equal(draft.draft.step, 1);
  const second = await service.forms.saveStep({ guildId: GUILD, userId: APPLICANT, applicationId, step: 1, raw: answersFor(questions.slice(5)) });
  assert.match(textOf(second.view), /Revise antes de enviar/);
  const stale = await service.forms.saveStep({ guildId: GUILD, userId: APPLICANT, applicationId, step: 0, raw: answersFor(questions.slice(0, 5), "velho") });
  assert.equal(stale.code, "application_step");
  const sent = await confirm(service, await service.forms.requestSubmit({ guildId: GUILD, userId: APPLICANT, applicationId }), APPLICANT);
  assert.equal(sent.code, "application_submitted");
  const stored = reopened.getApplication(GUILD, applicationId);
  assert.equal(stored.status, "pending");
  assert.equal(stored.snapshot.answers[questions[0].id], ANSWER);
  await confirm(service, await service.forms.requestQuestion({
    guildId: GUILD,
    actorId: OWNER,
    id: questions[0].id,
    prompt: "Pergunta alterada depois",
    hint: "",
    kindText: "longa",
    requiredText: "sim",
  }));
  assert.equal(reopened.getApplication(GUILD, applicationId).snapshot.questions[0].prompt, questions[0].prompt);
  const again = await service.forms.start({ guildId: GUILD, userId: APPLICANT });
  assert.equal(again.code, "application_exists");
  assert.equal(reopened.activeApplication(OTHER_GUILD, APPLICANT), null);
  const stranger = await service.forms.requestApprove({ guildId: OTHER_GUILD, actorId: ACTOR, applicationId });
  assert.equal(stranger.code, "application_missing");
  const forged = await service.forms.claim({ guildId: GUILD, actorId: ACTOR, applicationId: "22222222-2222-4222-8222-222222222222" });
  assert.equal(forged.code, "application_missing");
  assert.equal(app.calls.some((call) => call[0] === "log"), false);
  assert.equal(app.calls.filter((call) => call[0] === "panel").every((call) => call[1] === REVIEW), true);
  reopened.close();
});

test("análise, cargo, falha, concorrência e exclusão", async () => {
  const app = harness();
  await configure(app);
  const questions = app.store.listQuestions(GUILD);
  const started = await app.service.forms.start({ guildId: GUILD, userId: APPLICANT, hasCustomAvatar: false });
  const applicationId = started.modal.data.custom_id.split(":")[3];
  await app.service.forms.saveStep({ guildId: GUILD, userId: APPLICANT, applicationId, step: 0, raw: answersFor(questions) });
  assert.equal((await confirm(app.service, await app.service.forms.requestSubmit({ guildId: GUILD, userId: APPLICANT, applicationId }), APPLICANT)).code, "application_submitted");
  assert.equal((await app.service.forms.requestApprove({ guildId: GUILD, actorId: APPLICANT, applicationId })).code, "own_application");
  assert.equal((await app.service.forms.requestApprove({ guildId: GUILD, actorId: "100000000000000099", applicationId })).code, "reviewer_only");
  const claimed = await app.service.forms.claim({ guildId: GUILD, actorId: ACTOR, applicationId });
  assert.equal(claimed.code, "application_claimed");
  app.close();
  const reopened = openDatabase(app.dir);
  const service = createService({ store: reopened, discord: app.discord, now: () => 7_000, ttlMs: 60_000 });
  assert.equal((await service.forms.claim({ guildId: GUILD, actorId: ACTOR, applicationId })).code, "application_claimed");

  app.discord.addRole = async () => {
    const error = new Error("falha");
    error.code = 500;
    throw error;
  };
  const failed = await confirm(service, await service.forms.requestApprove({ guildId: GUILD, actorId: ACTOR, applicationId }), ACTOR);
  assert.equal(failed.code, "role_grant_failed");
  assert.equal(reopened.getApplication(GUILD, applicationId).status, "claimed");
  assert.equal(reopened.getApplication(GUILD, applicationId).role_applied, false);

  app.discord.addRole = async (...args) => {
    app.calls.push(["role", ...args]);
  };
  const approved = await confirm(service, await service.forms.requestApprove({ guildId: GUILD, actorId: ACTOR, applicationId }), ACTOR);
  assert.equal(approved.code, "application_approved");
  assert.equal(app.calls.filter((call) => call[0] === "role").at(-1)[3], ROLE);
  assert.notEqual(app.calls.filter((call) => call[0] === "role").at(-1)[3], STAFF);
  const repeat = await service.forms.requestApprove({ guildId: GUILD, actorId: OWNER, applicationId });
  assert.equal(repeat.code, "application_approved");
  assert.equal(app.calls.filter((call) => call[0] === "role").length, 1);

  for (const roleId of [EVERYONE, STAFF, "100000000000000067", "100000000000000068"]) {
    const denied = await service.forms.requestRole({ guildId: GUILD, actorId: OWNER, roleId });
    assert.equal(denied.code, "role_unsafe", roleId);
  }
  const above = await service.forms.requestRole({ guildId: GUILD, actorId: OWNER, roleId: "100000000000000070" });
  assert.equal(above.code, "bot_hierarchy");
  reopened.close();
});

test("recusa não dá cargo, aviso falho não é inventado e dados podem ser apagados", async () => {
  const app = harness();
  await configure(app);
  app.discord.tryDm = async () => {
    throw new Error("dm fechada");
  };
  const questions = app.store.listQuestions(GUILD);
  const started = await app.service.forms.start({ guildId: GUILD, userId: APPLICANT, hasCustomAvatar: false });
  const applicationId = started.modal.data.custom_id.split(":")[3];
  await app.service.forms.saveStep({ guildId: GUILD, userId: APPLICANT, applicationId, step: 0, raw: answersFor(questions) });
  await confirm(app.service, await app.service.forms.requestSubmit({ guildId: GUILD, userId: APPLICANT, applicationId }), APPLICANT);
  const rejected = await confirm(
    app.service,
    await app.service.forms.requestReject({ guildId: GUILD, actorId: ACTOR, applicationId, reason: "Sem disponibilidade nesta semana." }),
    ACTOR,
  );
  assert.equal(rejected.code, "application_rejected_unnotified");
  assert.equal(app.calls.some((call) => call[0] === "role"), false);
  assert.equal(app.store.getApplication(GUILD, applicationId).status, "rejected");
  const removed = await confirm(app.service, await app.service.forms.requestForget({ guildId: GUILD, userId: APPLICANT, applicationId }), APPLICANT);
  assert.equal(removed.code, "application_deleted");
  assert.equal(app.store.getApplication(GUILD, applicationId), null);
  const fresh = await app.service.forms.start({ guildId: GUILD, userId: APPLICANT, hasCustomAvatar: false });
  const nextId = fresh.modal.data.custom_id.split(":")[3];
  await app.service.forms.saveStep({ guildId: GUILD, userId: APPLICANT, applicationId: nextId, step: 0, raw: answersFor(questions) });
  await confirm(app.service, await app.service.forms.requestSubmit({ guildId: GUILD, userId: APPLICANT, applicationId: nextId }), APPLICANT);
  const admin = await confirm(app.service, await app.service.forms.requestAdminDelete({ guildId: GUILD, actorId: OWNER, applicationId: nextId }));
  assert.equal(admin.code, "application_deleted");
  app.close();
});

test("painel publicado é editado e o envio não duplica candidatura", async () => {
  const app = harness();
  await configure(app);
  app.service.forms.track({ guildId: GUILD, channelId: PUBLIC, messageId: "100000000000000077" });
  await confirm(app.service, await app.service.forms.requestOpen({ guildId: GUILD, actorId: OWNER }));
  await app.service.forms.whenSettled(GUILD);
  const edits = app.calls.filter((call) => call[0] === "edit" && call[1] === PUBLIC);
  assert.equal(edits.length, 1);
  assert.match(JSON.stringify(edits[0][3]), /Inscrições fechadas/);
  await confirm(app.service, await app.service.forms.requestOpen({ guildId: GUILD, actorId: OWNER }));
  let sends = 0;
  app.discord.sendComponents = async () => {
    sends += 1;
    if (sends === 1) throw new Error("discord");
    return { id: "100000000000000088" };
  };
  const questions = app.store.listQuestions(GUILD);
  const started = await app.service.forms.start({ guildId: GUILD, userId: APPLICANT, hasCustomAvatar: false });
  const applicationId = started.modal.data.custom_id.split(":")[3];
  await app.service.forms.saveStep({ guildId: GUILD, userId: APPLICANT, applicationId, step: 0, raw: answersFor(questions) });
  const pending = await confirm(app.service, await app.service.forms.requestSubmit({ guildId: GUILD, userId: APPLICANT, applicationId }), APPLICANT);
  assert.equal(pending.code, "application_panel_pending");
  assert.equal(app.store.getApplication(GUILD, applicationId).status, "pending");
  await app.service.forms.recover();
  assert.equal(app.store.getApplication(GUILD, applicationId).review_message_id, "100000000000000088");
  await app.service.forms.recover();
  assert.equal(sends, 2);
  app.close();
});

test("decisão concorrente concede o cargo uma vez e saída do membro não marca aprovação", async () => {
  const app = harness();
  await configure(app);
  const questions = app.store.listQuestions(GUILD);
  async function submit() {
    const started = await app.service.forms.start({ guildId: GUILD, userId: APPLICANT, hasCustomAvatar: false });
    const applicationId = started.modal.data.custom_id.split(":")[3];
    await app.service.forms.saveStep({ guildId: GUILD, userId: APPLICANT, applicationId, step: 0, raw: answersFor(questions) });
    await confirm(app.service, await app.service.forms.requestSubmit({ guildId: GUILD, userId: APPLICANT, applicationId }), APPLICANT);
    return applicationId;
  }
  const first = await submit();
  const left = await app.service.forms.requestApprove({ guildId: GUILD, actorId: ACTOR, applicationId: first });
  const owner = await app.service.forms.requestApprove({ guildId: GUILD, actorId: OWNER, applicationId: first });
  const [a, b] = await Promise.all([confirm(app.service, left, ACTOR), confirm(app.service, owner, OWNER)]);
  assert.equal(app.calls.filter((call) => call[0] === "role").length, 1);
  assert.ok([a.code, b.code].includes("application_approved"));
  assert.equal(app.store.getApplication(GUILD, first).status, "approved");
  await confirm(app.service, await app.service.forms.requestForget({ guildId: GUILD, userId: APPLICANT, applicationId: first }), APPLICANT);

  app.discord.addRole = async () => {
    const error = new Error("saiu");
    error.code = 10007;
    throw error;
  };
  const second = await submit();
  const missing = await confirm(app.service, await app.service.forms.requestApprove({ guildId: GUILD, actorId: ACTOR, applicationId: second }), ACTOR);
  assert.equal(missing.code, "user_left");
  assert.notEqual(app.store.getApplication(GUILD, second).status, "approved");
  app.close();
});
