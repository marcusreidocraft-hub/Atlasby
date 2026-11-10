import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createService } from "../src/service.js";
import { openDatabase } from "../src/storage.js";
import { createGraphClient } from "../src/graph.js";
import { generatePassword, passwordIsStrong } from "../src/entra-model.js";
import { routeEntraButton, routeEntraModal } from "../src/entra-route.js";
import { describeResult } from "../src/messages.js";
import { textOf, validateV2Message } from "../src/ui.js";
import { ACTOR, CHANNEL, GUILD, OWNER, fakeDiscord } from "../src/fixtures.js";

const USER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const VM = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function harness(graph) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlasby-entra-"));
  const store = openDatabase(dir);
  const logs = [];
  const discord = fakeDiscord({
    async inspectChannel() {
      return { guildId: GUILD, type: "GuildText", permissions: 1n << 10n | 1n << 11n | 1n << 14n, everyoneCanView: false };
    },
    async inspectActor(_guildId, userId) {
      return { id: userId, isOwner: userId === OWNER, ownerId: OWNER, permissions: 0n };
    },
    async sendComponents(...args) {
      logs.push(JSON.stringify(args));
    },
  });
  const service = createService({ store, discord, now: () => 20_000, ttlMs: 60_000, graph });
  return { dir, store, service, logs, close: () => store.close() };
}

function graphFake(state = {}) {
  const calls = [];
  const users = [{
    id: USER,
    displayName: "Ana Silva",
    userPrincipalName: "ana@tenant.onmicrosoft.com",
    mail: "ana@tenant.com",
    otherMails: ["ana.alt@tenant.com"],
    accountEnabled: state.disabled ? false : true,
  }];
  const methods = [
    { id: "phone-1", "@odata.type": "#microsoft.graph.phoneAuthenticationMethod", phoneNumber: "+5511999999999", isDefault: true },
    { id: "auth-1", "@odata.type": "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod", displayName: "Pixel" },
    { id: "pass-1", "@odata.type": "#microsoft.graph.passwordAuthenticationMethod" },
  ];
  return {
    configured: true,
    calls,
    methods,
    get lastPassword() {
      return state.lastPassword ?? "";
    },
    forbid() {
      state.forbidden = true;
    },
    async listUsers({ search = "", page = 0 } = {}) {
      calls.push(["list", search, page]);
      if (state.forbidden) throw Object.assign(new Error("forbidden"), { code: "entra_forbidden" });
      const found = users.filter((user) => !search || `${user.displayName} ${user.mail} ${user.userPrincipalName}`.toLowerCase().includes(search.toLowerCase()));
      return { users: found.slice(page * 25, page * 25 + 25), next: false };
    },
    async getUser(id) {
      calls.push(["get", id]);
      return users.find((user) => user.id === id);
    },
    async resetPassword(id, profile) {
      calls.push(["password", id, profile.forceChangePasswordNextSignIn]);
      state.lastPassword = profile.password;
    },
    async listMethods() {
      calls.push(["methods"]);
      return methods.map((method) => ({ ...method }));
    },
    async deleteMethod(_id, kind, methodId) {
      calls.push(["delete", kind, methodId]);
      const current = methods.find((method) => method.id === methodId);
      const others = methods.some((method) => method.id !== methodId && !String(method["@odata.type"]).includes("password"));
      if (current?.isDefault && others) throw Object.assign(new Error("default method"), { code: "entra_default_method" });
      const index = methods.findIndex((method) => method.id === methodId);
      if (index >= 0) methods.splice(index, 1);
    },
    async revokeSessions() {
      calls.push(["revoke"]);
    },
  };
}

function button(customId, userId = OWNER) {
  const calls = [];
  const interaction = {
    customId,
    guildId: GUILD,
    user: { id: userId },
    deferred: false,
    replied: false,
    calls,
    async deferUpdate() {
      this.deferred = true;
      calls.push("defer");
    },
    async deferReply() {
      this.deferred = true;
      calls.push("deferReply");
    },
    async editReply(body) {
      calls.push(["edit", textOf(body)]);
    },
    async reply() {
      calls.push("reply");
    },
    async followUp() {},
    async showModal() {
      calls.push("modal");
    },
    isModalSubmit() {
      return false;
    },
  };
  return interaction;
}

test("senha forte e senha fraca", () => {
  const password = generatePassword();
  assert.equal(password.length, 20);
  assert.equal(passwordIsStrong(password), true);
  assert.equal(passwordIsStrong("curta"), false);
  assert.equal(passwordIsStrong("abcdefghijkl"), false);
  assert.equal(passwordIsStrong("Abcdefghijk1!"), true);
});

test("cliente e não administrador não consultam o Entra", async () => {
  const graph = graphFake();
  const { service, close } = harness(graph);
  const blocked = await service.entra.list(GUILD, ACTOR, 0, "");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "admin_unauthorized");
  assert.equal(graph.calls.length, 0);
  close();
});

test("administrador lista, vê e-mail e o 403 explica a permissão", async () => {
  const graph = graphFake();
  const { service, close } = harness(graph);
  const listed = await service.entra.list(GUILD, OWNER, 0, "ana@tenant.com");
  assert.equal(listed.ok, true);
  assert.equal(validateV2Message(listed.view).ok, true);
  const text = textOf(listed.view);
  assert.match(text, /Ana Silva/);
  assert.match(text, /ana@tenant.onmicrosoft.com/);
  assert.match(text, /ativa/);
  const opened = await service.entra.open(GUILD, OWNER, USER);
  const account = textOf(opened.view);
  assert.match(account, /ana@tenant.com/);
  assert.match(account, /ana.alt@tenant.com/);
  graph.calls.length = 0;
  graph.forbid();
  const denied = await service.entra.list(GUILD, OWNER, 0, "");
  assert.equal(denied.code, "entra_forbidden");
  assert.match(describeResult(denied), /User-PasswordProfile.ReadWrite.All/);
  close();
});

test("senha gerada aparece uma vez e não entra no log nem no banco", async () => {
  const graph = graphFake();
  const env = harness(graph);
  env.store.saveAzureSettings(GUILD, { log_channel_id: CHANNEL }, 1);
  const prompt = await env.service.entra.passwordPrompt(GUILD, OWNER, USER, false);
  assert.equal(graph.calls.some((call) => call[0] === "password"), false);
  assert.doesNotMatch(textOf(prompt.view), /Senha nova/);
  const applied = await env.service.entra.applyGeneratedPassword(GUILD, OWNER, USER, false);
  const password = graph.lastPassword;
  const shown = textOf(applied.view);
  assert.match(shown, /Senha nova/);
  assert.match(shown, new RegExp(password.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(graph.calls.some((call) => call[0] === "password" && call[2] === false), true);
  assert.equal(env.logs.some((line) => line.includes(password)), false);
  assert.match(env.logs.join("\n"), /senha redefinida/);
  assert.match(env.logs.join("\n"), /ana@tenant.onmicrosoft.com/);
  const dump = fs.readFileSync(path.join(env.dir, "moderation.sqlite"));
  assert.equal(dump.includes(Buffer.from(password)), false);
  const weak = await env.service.entra.applyTypedPassword(GUILD, OWNER, USER, "fraca", "nao");
  assert.equal(weak.code, "entra_password_weak");
  closeSafe(env);
});

test("remove um método, trata o padrão e remove os demais", async () => {
  const graph = graphFake();
  const { service, logs, store, close } = harness(graph);
  store.saveAzureSettings(GUILD, { log_channel_id: CHANNEL }, 1);
  const listed = await service.entra.methods(GUILD, OWNER, USER);
  assert.match(textOf(listed.view), /Pixel/);
  assert.match(textOf(listed.view), /Telefone/);
  assert.doesNotMatch(textOf(listed.view), /Senha ·/);
  const hash = listed.view.components[0].toJSON().components.find((row) => row.components?.[0]?.type === 3).components[0].options[0].value;
  const blocked = await service.entra.deleteMethod(GUILD, OWNER, USER, hash);
  assert.equal(blocked.code, "entra_default_method");
  const cleared = await service.entra.deleteAllMethods(GUILD, OWNER, USER, true);
  assert.equal(cleared.ok, true);
  assert.equal(graph.methods.some((method) => String(method["@odata.type"]).includes("password")), true);
  assert.equal(graph.methods.length, 1);
  assert.equal(graph.calls.some((call) => call[0] === "revoke"), true);
  assert.match(logs.join("\n"), /métodos removidos/);
  assert.doesNotMatch(logs.join("\n"), /phone-1|Pixel|\+5511/);
  close();
});

test("vínculo da conta aparece no detalhe da VM", async () => {
  const graph = graphFake();
  const { service, store, close } = harness(graph);
  store.insertVm({
    id: VM, guildId: GUILD, displayName: "Mesa 01", resourceGroup: "rg", vmName: "vm-01",
    osLabel: "Windows", sizeLabel: "Standard_NC4as_T4_v3", cpuLabel: "4", ramLabel: "28 GB", gpuLabel: "T4",
    diskGb: 128, publicIp: null, privateIp: null, validityUntil: null, blockWhenExpired: false, autoStart: false, spot: true, location: "brazilsouth", now: 1,
  });
  await service.entra.link(GUILD, OWNER, USER, VM);
  const admin = await service.vms.admin(GUILD, OWNER);
  assert.match(textOf(admin.view), /ana@tenant.onmicrosoft.com/);
  assert.match(JSON.stringify(admin.view.components[0].toJSON()), /atlasby:vmcfg:entra/);
  close();
});

test("o botão adia a interação antes do Graph", async () => {
  const order = [];
  const graph = graphFake();
  const original = graph.listUsers;
  graph.listUsers = async (...args) => {
    order.push("graph");
    return original(...args);
  };
  const { service, close } = harness(graph);
  const interaction = button("atlasby:vmcfg:entra");
  interaction.deferUpdate = async () => {
    interaction.deferred = true;
    order.push("defer");
    interaction.calls.push("defer");
  };
  const handled = await routeEntraButton(interaction, service.entra);
  assert.equal(handled, true);
  assert.deepEqual(order.slice(0, 2), ["defer", "graph"]);
  assert.equal(interaction.calls[0], "defer");
  close();
});

test("Graph traduz 403 e envia a senha só no corpo do PATCH", async () => {
  const seen = [];
  const client = createGraphClient(
    { configured: true, tenantId: "tenant", clientId: "client", clientSecret: "secret" },
    {
      getToken: async () => "token-de-teste",
      fetchImpl: async (url, init) => {
        seen.push({ url, method: init.method, body: init.body ?? "" });
        if (String(url).includes("/authentication/methods")) {
          return { status: 403, ok: false, async text() { return JSON.stringify({ error: { code: "Authorization_RequestDenied" } }); } };
        }
        return { status: 204, ok: true, async text() { return ""; } };
      },
    },
  );
  await client.resetPassword(USER, { password: "SenhaUnica#2026Aa", forceChangePasswordNextSignIn: false });
  const patch = seen.find((call) => call.method === "PATCH");
  const body = JSON.parse(patch.body);
  assert.equal(body.passwordProfile.password, "SenhaUnica#2026Aa");
  assert.equal(body.passwordProfile.forceChangePasswordNextSignIn, false);
  await assert.rejects(() => client.listMethods(USER), (error) => error.code === "entra_forbidden");
  const modal = button("atlasby:modal:entra:password:" + USER);
  modal.fields = { getTextInputValue: (id) => (id === "senha" ? "SenhaUnica#2026Aa" : "nao") };
  modal.isModalSubmit = () => true;
  const graph = graphFake();
  const { service, logs, close } = harness(graph);
  await routeEntraModal(modal, service.entra);
  assert.equal(modal.calls[0], "deferReply");
  assert.equal(logs.some((line) => line.includes("SenhaUnica#2026Aa")), false);
  close();
});

function closeSafe(env) {
  env.close();
}
