import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { routeCommand } from "../src/commands/admin/router.js";
import { adminCommands } from "../src/commands/admin/commands.js";
import { readConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { createStoreHttp } from "../src/loja/http.js";
import { routeResellerAutocomplete } from "../src/reseller/router.js";
import { generateResellerKey, hashResellerKey, resellerKeysMatch } from "../src/reseller/keys.js";
import { createResellers } from "../src/reseller/service.js";
import { vmOptionValue } from "../src/services/provider.js";

const GUILD = "100000000000000001";
const OWNER = "100000000000000009";
const CLIENT = "100000000000000002";
const ROLE = "100000000000000061";
const VM_A = "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-a";
const VM_B = "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-b";
const VM_CLIENT = "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/mesa";

function actor(extra = {}) {
  return { id: OWNER, permissions: 8n, roleIds: [], owner: true, ...extra };
}

function vm(id, name) {
  return { id, name, resourceGroup: "rg", size: "Standard_NC4as_T4_v3", location: "brazilsouth", power: "desligada", publicIp: "203.0.113.10", tags: {} };
}

function world({ rateLimit = 30, vms = [vm(VM_A, "vm-a"), vm(VM_B, "vm-b"), vm(VM_CLIENT, "mesa")] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-reseller-"));
  const repo = openDatabase(dir);
  const config = readConfig({
    DISCORD_TOKEN: "token",
    DISCORD_CLIENT_ID: "100000000000000003",
    ALLOWED_GUILD_IDS: GUILD,
    ADMIN_ROLE_IDS: ROLE,
    PANEL_COLOR: "5865F2",
  });
  const notes = [];
  const tags = [];
  let release = () => {};
  let hold = Promise.resolve();
  const passwords = [];
  const infra = {
    configured: true,
    async listVms() { return vms; },
    async tagReseller(id, resellerId) { tags.push([id, resellerId]); return { mode: "azure" }; },
    async setPower(_id, desired) {
      await hold;
      return { mode: "azure", status: desired };
    },
    async restart() {
      await hold;
      return { mode: "azure", status: "ligada" };
    },
    async adminUsername() { return "cliente"; },
    async resetWindowsPassword(_id, input) {
      passwords.push(input.username);
      return { mode: "azure", code: "ok" };
    },
  };
  const app = createApp({
    config,
    repo,
    infra,
    now: () => 1_700_000_000_000,
  });
  const resellers = createResellers({
    repo,
    infra,
    audit: { async record(entry) { notes.push(entry); } },
    config,
    now: () => 1_700_000_000_000,
    rateLimit,
  });
  return {
    dir, repo, app, infra, notes, tags, passwords, resellers,
    pause() { hold = new Promise((resolve) => { release = resolve; }); },
    resume() { release(); },
    close() { repo.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

function text(payload) {
  return JSON.stringify(payload);
}

function clientRow(infraId = VM_CLIENT) {
  return {
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    guildId: GUILD,
    userId: CLIENT,
    clientName: "Ana",
    machineName: "Mesa",
    gpu: "Tesla T4",
    vcpus: 4,
    ram: "28 GB",
    publicIp: "203.0.113.20",
    rdpUser: "pc",
    rdpPasswordCipher: null,
    pinCipher: null,
    planType: "mensal",
    startedAt: 1,
    expiresAt: 2,
    infraId,
    powerStatus: "ligada",
    now: 1,
  };
}

async function listen(resellers) {
  const server = createStoreHttp(async () => 200, { resellers });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    server,
    base: `http://127.0.0.1:${port}`,
    close() { return new Promise((resolve) => server.close(resolve)); },
  };
}

async function call(base, token, method, pathname, body) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await response.text();
  return { status: response.status, headers: response.headers, body: raw ? JSON.parse(raw) : {} };
}

test("a chave só aparece uma vez e o banco guarda o hash", () => {
  const env = world();
  const created = env.resellers.create(GUILD, actor(), "Loja Norte");
  assert.match(created.token, /^ignx_rs_[A-Za-z0-9_-]{40,}$/);
  assert.match(text(created.payload), new RegExp(created.token));
  const listed = text(env.resellers.list(GUILD, actor()));
  assert.equal(listed.includes(created.token), false);
  assert.match(listed, /Loja Norte/);
  const stored = Buffer.concat(["atlas.sqlite", "atlas.sqlite-wal"].filter((name) => fs.existsSync(path.join(env.dir, name))).map((name) => fs.readFileSync(path.join(env.dir, name))));
  assert.equal(stored.includes(Buffer.from(created.token)), false);
  assert.equal(stored.includes(Buffer.from(hashResellerKey(created.token).toString("hex"))), true);
  const roleOnly = env.resellers.create(GUILD, actor({ permissions: 0n, owner: false, roleIds: [ROLE] }), "Outro");
  assert.equal(roleOnly.token, undefined);
  assert.match(text(roleOnly.payload), /Administrador/);
  env.close();
});

test("revogar e girar a chave invalidam a anterior na hora", async () => {
  const env = world();
  const created = env.resellers.create(GUILD, actor(), "Loja Norte");
  const reseller = env.repo.resellers(GUILD)[0];
  assert.equal(Boolean(env.resellers.authenticate(created.token)), true);
  assert.equal(env.resellers.authenticate("ignx_rs_errada"), null);
  assert.equal(resellerKeysMatch(hashResellerKey(created.token).toString("hex"), created.token), true);
  assert.equal(resellerKeysMatch("aa", created.token), false);
  await env.resellers.revoke(GUILD, actor(), reseller.id);
  assert.equal(env.resellers.authenticate(created.token), null);
  const again = env.resellers.create(GUILD, actor(), "Loja Sul");
  const second = env.repo.resellers(GUILD).find((item) => item.name === "Loja Sul");
  const rotated = await env.resellers.rotate(GUILD, actor(), second.id);
  assert.notEqual(rotated.token, again.token);
  assert.equal(env.resellers.authenticate(again.token), null);
  assert.equal(env.resellers.authenticate(rotated.token)?.id, second.id);
  assert.equal(env.notes.some((item) => String(item.detail).includes(created.token) || String(item.detail).includes(rotated.token)), false);
  env.close();
});

test("a atribuição é exclusiva e some da lista livre", async () => {
  const env = world();
  env.repo.insertClient(clientRow());
  const created = env.resellers.create(GUILD, actor(), "Loja Norte");
  const reseller = env.repo.resellers(GUILD)[0];
  const taken = await env.resellers.assign(GUILD, actor(), reseller.id, vmOptionValue(VM_CLIENT));
  assert.match(text(taken), /já pertence a um cliente/);
  const assigned = await env.resellers.assign(GUILD, actor(), reseller.id, vmOptionValue(VM_A));
  assert.match(text(assigned), /agora é de Loja Norte/);
  assert.equal(env.tags[0][1], reseller.id);
  const duplicate = await env.resellers.assign(GUILD, actor(), reseller.id, vmOptionValue(VM_A));
  assert.match(text(duplicate), /já está com um revendedor/);
  const other = env.resellers.create(GUILD, actor(), "Loja Sul");
  const otherRow = env.repo.resellers(GUILD).find((item) => item.name === "Loja Sul");
  const stolen = await env.resellers.assign(GUILD, actor(), otherRow.id, vmOptionValue(VM_A));
  assert.match(text(stolen), /já está com um revendedor/);
  const choices = await env.app.admin.vmChoices(GUILD, "100000000000000077");
  assert.equal(choices.some((item) => item.name === "vm-a" || item.name === "mesa"), false);
  assert.equal(choices.some((item) => item.name === "vm-b"), true);
  const removed = await env.resellers.unassign(GUILD, actor(), reseller.id, env.repo.resellerVms(reseller.id)[0].id);
  assert.match(text(removed), /sem revendedor/);
  assert.equal(env.tags.at(-1)[1], "");
  const free = await env.app.admin.vmChoices(GUILD, "100000000000000077");
  assert.equal(free.some((item) => item.name === "vm-a"), true);
  const options = await env.resellers.vmOptions(GUILD, "atribuir-vm", reseller.id, "vm-b");
  assert.equal(options[0].value, vmOptionValue(VM_B));
  assert.equal(options[0].value.includes("subscriptions"), false);
  assert.equal(created.token !== other.token, true);
  env.close();
});

test("a API isola revendedores, limita a taxa e não devolve a VM da Azure", async () => {
  const env = world();
  env.repo.insertClient(clientRow());
  const first = env.resellers.create(GUILD, actor(), "Loja Norte");
  const second = env.resellers.create(GUILD, actor(), "Loja Sul");
  const north = env.repo.resellers(GUILD).find((item) => item.name === "Loja Norte");
  const south = env.repo.resellers(GUILD).find((item) => item.name === "Loja Sul");
  await env.resellers.assign(GUILD, actor(), north.id, vmOptionValue(VM_A));
  await env.resellers.assign(GUILD, actor(), south.id, vmOptionValue(VM_B));
  const northVm = env.repo.resellerVms(north.id)[0];
  const southVm = env.repo.resellerVms(south.id)[0];
  const http = await listen(env.resellers);
  try {
    const missing = await call(http.base, "", "GET", "/api/reseller/v1/vms");
    assert.equal(missing.status, 401);
    const invalid = await call(http.base, "ignx_rs_nao", "GET", "/api/reseller/v1/vms");
    assert.equal(invalid.status, 401);
    const list = await call(http.base, first.token, "GET", "/api/reseller/v1/vms");
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.vms.map((item) => item.name), ["vm-a"]);
    assert.equal(JSON.stringify(list.body).includes("subscriptions"), false);
    assert.equal(JSON.stringify(list.body).includes("mesa"), false);
    assert.equal(list.headers.get("access-control-allow-origin"), null);
    const foreign = await call(http.base, first.token, "GET", `/api/reseller/v1/vms/${southVm.id}`);
    assert.equal(foreign.status, 404);
    const control = await call(http.base, first.token, "POST", `/api/reseller/v1/vms/${southVm.id}/start`);
    assert.equal(control.status, 404);
    const guessed = await call(http.base, first.token, "GET", "/api/reseller/v1/vms/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    assert.equal(guessed.status, 404);
    const options = await call(http.base, first.token, "OPTIONS", "/api/reseller/v1/vms");
    assert.equal(options.status, 405);
    assert.equal(options.headers.get("access-control-allow-origin"), null);
    env.pause();
    const started = await call(http.base, first.token, "POST", `/api/reseller/v1/vms/${northVm.id}/start`);
    assert.equal(started.status, 202);
    assert.equal(started.body.state, "iniciando");
    const busy = await call(http.base, first.token, "POST", `/api/reseller/v1/vms/${northVm.id}/stop`);
    assert.equal(busy.status, 409);
    const during = await call(http.base, first.token, "GET", `/api/reseller/v1/vms/${northVm.id}`);
    assert.equal(during.body.state, "iniciando");
    env.resume();
    let after = { body: { state: "" } };
    for (let attempt = 0; attempt < 20; attempt += 1) {
      after = await call(http.base, first.token, "GET", `/api/reseller/v1/vms/${northVm.id}`);
      if (after.body.state === "ligada") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(after.body.state, "ligada");
    assert.equal(after.body.id, northVm.id);
    await env.resellers.revoke(GUILD, actor(), north.id);
    const revoked = await call(http.base, first.token, "GET", "/api/reseller/v1/vms");
    assert.equal(revoked.status, 401);
    const limited = createResellers({
      repo: env.repo,
      infra: env.infra,
      config: env.app.config,
      now: () => 1_700_000_000_000,
      rateLimit: 2,
    });
    const tight = await listen(limited);
    try {
      assert.equal((await call(tight.base, second.token, "GET", "/api/reseller/v1/vms")).status, 200);
      assert.equal((await call(tight.base, second.token, "GET", "/api/reseller/v1/vms")).status, 200);
      const blocked = await call(tight.base, second.token, "GET", "/api/reseller/v1/vms");
      assert.equal(blocked.status, 429);
      assert.equal(blocked.body.error, "muitas requisições");
    } finally {
      await tight.close();
    }
  } finally {
    await http.close();
    env.close();
  }
});

test("a senha segue a mesma validação e não entra no log", async () => {
  const env = world();
  const created = env.resellers.create(GUILD, actor(), "Loja Norte");
  const reseller = env.repo.resellers(GUILD)[0];
  await env.resellers.assign(GUILD, actor(), reseller.id, vmOptionValue(VM_A));
  const row = env.repo.resellerVms(reseller.id)[0];
  const secret = "Nuvem#Forte2026";
  const weak = await env.resellers.handle(env.resellers.authenticate(created.token), "POST", `/api/reseller/v1/vms/${row.id}/password`, { password: secret, confirm: "outra" });
  assert.equal(weak.status, 400);
  const banned = await env.resellers.handle(env.resellers.authenticate(created.token), "POST", `/api/reseller/v1/vms/${row.id}/password`, { password: "p@ssw0rd123!", confirm: "p@ssw0rd123!" });
  assert.equal(banned.status, 400);
  const named = await env.resellers.handle(env.resellers.authenticate(created.token), "POST", `/api/reseller/v1/vms/${row.id}/password`, { password: "Cliente#2026abc", confirm: "Cliente#2026abc" });
  assert.equal(named.status, 400);
  const accepted = await env.resellers.handle(env.resellers.authenticate(created.token), "POST", `/api/reseller/v1/vms/${row.id}/password`, { password: secret, confirm: secret });
  assert.equal(accepted.status, 202);
  assert.equal(JSON.stringify(accepted.body).includes(secret), false);
  await accepted.job;
  assert.equal(env.passwords[0], "cliente");
  assert.equal(env.notes.some((item) => String(item.detail).includes(secret)), false);
  const stored = Buffer.concat(["atlas.sqlite", "atlas.sqlite-wal"].filter((name) => fs.existsSync(path.join(env.dir, name))).map((name) => fs.readFileSync(path.join(env.dir, name))));
  assert.equal(stored.includes(Buffer.from(secret)), false);
  env.close();
});

test("o comando e o autocomplete ficam restritos a Administrador", async () => {
  const command = adminCommands().find((item) => item.name === "revendedor");
  assert.equal(command.default_member_permissions, "8");
  assert.deepEqual(command.options.map((item) => item.name), ["criar", "listar", "revogar", "girar-chave", "atribuir-vm", "remover-vm"]);
  const env = world();
  const replies = [];
  const interaction = {
    commandName: "revendedor",
    guildId: GUILD,
    user: { id: OWNER },
    member: { permissions: { bitfield: 8n }, roles: { cache: new Map() } },
    guild: { ownerId: "100000000000000099" },
    options: { getSubcommand: () => "criar", getString: () => "Loja Norte" },
    deferred: false,
    replied: false,
    async deferReply() { this.deferred = true; },
    async editReply(body) { replies.push(body); },
  };
  await routeCommand(interaction, env.app);
  assert.equal(JSON.stringify(replies).includes("ignx_rs_"), true);
  const choices = [];
  await routeResellerAutocomplete({
    guildId: GUILD,
    user: { id: OWNER },
    member: { permissions: { bitfield: 8n }, roles: { cache: new Map() } },
    guild: { ownerId: OWNER },
    options: {
      getFocused: () => ({ name: "revendedor", value: "loja" }),
      getSubcommand: () => "revogar",
      getString: () => "",
    },
    async respond(rows) { choices.push(...rows); },
  }, env.app);
  assert.equal(choices.length, 1);
  assert.equal(choices[0].value.includes("ignx_rs_"), false);
  const hidden = [];
  await routeResellerAutocomplete({
    guildId: GUILD,
    user: { id: CLIENT },
    member: { permissions: { bitfield: 0n }, roles: { cache: new Map([[ROLE, {}]]) } },
    guild: { ownerId: OWNER },
    options: { getFocused: () => ({ name: "revendedor", value: "" }), getSubcommand: () => "revogar", getString: () => "" },
    async respond(rows) { hidden.push(...rows); },
  }, env.app);
  assert.equal(hidden.length, 0);
  const pair = generateResellerKey();
  assert.equal(pair.hash, hashResellerKey(pair.token).toString("hex"));
  env.close();
});
