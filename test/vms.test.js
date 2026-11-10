import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createService } from "../src/service.js";
import { openDatabase } from "../src/storage.js";
import { deriveCredentialKey, openJson } from "../src/azure.js";
import { PRODUCTS } from "../src/plans.js";
import { evictionOf, backoffMs } from "../src/vm-model.js";
import { textOf, validateV2Message } from "../src/ui.js";
import { ACTOR, GUILD, OTHER_GUILD, OWNER, TARGET, fakeDiscord } from "../src/fixtures.js";

const KEY = deriveCredentialKey({ credentialsKey: "chave-de-teste-atlas-32" });
const REVIEW = "100000000000000061";

function harness(azure) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlasby-vm-"));
  const store = openDatabase(dir);
  store.ensureDefaultPlans(GUILD, PRODUCTS, 1);
  const calls = [];
  let clock = 10_000;
  const discord = fakeDiscord({
    async inspectChannel() {
      return { guildId: GUILD, type: "GuildText", permissions: 1n << 10n | 1n << 11n | 1n << 14n, everyoneCanView: false };
    },
    async inspectActor(_guildId, userId) {
      return { id: userId, isOwner: userId === OWNER, ownerId: OWNER, highestPosition: 10, permissions: 0n };
    },
    async sendComponents(...args) {
      calls.push(["log", args[0]]);
    },
    async tryDm(...args) {
      calls.push(["dm", args[0], JSON.stringify(args[1])]);
    },
  });
  const service = createService({
    store,
    discord,
    now: () => clock,
    ttlMs: 60_000,
    azure,
    credentialKey: KEY,
  });
  return {
    dir,
    store,
    service,
    calls,
    discord,
    setNow(value) {
      clock = value;
    },
    close: () => store.close(),
  };
}

function azureFake(state = { power: "deallocated", fail: null, statuses: [] }) {
  const calls = [];
  return {
    calls,
    configured: true,
    async getInstanceView() {
      calls.push("view");
      return { powerState: state.power, statuses: state.statuses };
    },
    async start() {
      calls.push("start");
      if (state.fail) throw state.fail;
      state.power = "starting";
    },
    async deallocate() {
      calls.push("stop");
      state.power = "deallocated";
    },
    async restart() {
      calls.push("restart");
      state.power = "starting";
    },
    async readNetwork() {
      return { publicIp: "20.1.2.3", privateIp: "10.0.0.4" };
    },
    state,
    async resizeDisk() {
      if (state.power !== "deallocated") {
        const error = new Error("disk_needs_deallocated");
        error.code = "disk_needs_deallocated";
        throw error;
      }
      calls.push("disk");
    },
    async listVirtualMachines() {
      return [{ name: "karl", resourceGroup: "rg-atlas", size: "Standard_NC4as_T4_v3" }];
    },
  };
}

async function confirm(service, pending, moderatorId = OWNER) {
  return service.confirm({ confirmationId: pending.confirmationId, guildId: GUILD, moderatorId, decision: "confirm" });
}

async function register(app, azure) {
  const pending = await app.service.vms.requestCreate({
    guildId: GUILD,
    actorId: OWNER,
    displayName: "karl",
    resourceGroup: "rg-atlas",
    vmName: "karl",
    osLabel: "Windows",
    diskGb: "128",
  });
  assert.equal((await confirm(app.service, pending)).code, "config_saved");
  const vm = app.store.listVms(GUILD)[0];
  assert.equal((await confirm(app.service, await app.service.vms.requestLink({ guildId: GUILD, actorId: OWNER, vmId: vm.id, userId: TARGET }))).code, "config_saved");
  return vm;
}

test("migração 7 preserva ticket e o menu sem Azure não liga nada", async () => {
  const app = harness({ configured: false, async start() { throw new Error("não chamar"); } });
  const reserved = app.store.reserveTicket({ guildId: GUILD, openerId: OWNER, sku: "t4-4", code: "7d", now: 3, id: "33333333-3333-4333-8333-333333333333" });
  app.close();
  const reopened = openDatabase(app.dir);
  assert.equal(reopened.migrationCount(), 8);
  assert.equal(reopened.getTicket(GUILD, reserved.ticket.id).opener_id, OWNER);
  const service = createService({ store: reopened, discord: app.discord, now: () => 1, ttlMs: 60_000, azure: { configured: false }, credentialKey: KEY });
  const menu = service.vms.menu(GUILD, TARGET);
  assert.equal(menu.code, "vm_none");
  assert.equal((await service.vms.autoStartPass()).checked, 0);
  reopened.close();
});

test("menu, posse, energia, validade e credencial cifrada", async () => {
  const azure = azureFake();
  const app = harness(azure);
  const vm = await register(app);
  const menu = app.service.vms.menu(GUILD, TARGET, vm.id);
  const rendered = JSON.stringify(menu.view);
  assert.equal(validateV2Message(menu.view).ok, true);
  assert.match(rendered, /karl/);
  assert.match(rendered, /Validade não cadastrada/);
  assert.match(rendered, /Escolha uma categoria de ações/);
  assert.match(rendered, /Ligar/);
  assert.doesNotMatch(rendered, /Vanity|senha/i);
  assert.equal(app.service.vms.menu(OTHER_GUILD, TARGET, vm.id).code, "vm_none");
  assert.equal((await app.service.vms.requestPower(GUILD, ACTOR, vm.id, "start")).code, "vm_missing");

  const started = await app.service.vms.requestPower(GUILD, TARGET, vm.id, "start");
  const finished = await started.task();
  assert.equal(finished.code, "vm_requested");
  assert.equal(azure.calls.filter((call) => call === "start").length, 1);
  assert.equal(app.store.getVm(GUILD, vm.id).desired_power, "running");
  const busy = await app.service.vms.requestPower(GUILD, TARGET, vm.id, "start");
  assert.equal((await busy.task()).code, "vm_busy");

  app.setNow(40_000);
  const stopping = await app.service.vms.confirmPower(GUILD, TARGET, vm.id, "deallocate");
  assert.equal((await stopping.task()).code, "vm_requested");
  assert.equal(app.store.getVm(GUILD, vm.id).desired_power, "stopped");

  const secret = await app.service.vms.requestSecret({ guildId: GUILD, actorId: OWNER, vmId: vm.id, username: "player", password: "segredo-super", pin: "1234" });
  assert.doesNotMatch(secret.summary, /segredo-super/);
  await confirm(app.service, secret);
  const stored = app.store.getVm(GUILD, vm.id).credentials_cipher;
  assert.equal(stored.includes("segredo-super"), false);
  assert.equal(openJson(KEY, stored).password, "segredo-super");
  const shown = app.service.vms.credentials(GUILD, TARGET, vm.id);
  assert.match(textOf(shown.view), /segredo-super/);
  assert.equal(app.service.vms.credentials(GUILD, ACTOR, vm.id).code, "vm_missing");

  await confirm(app.service, await app.service.vms.requestValidity({ guildId: GUILD, actorId: OWNER, vmId: vm.id, raw: "2020-01-01", blockText: "sim" }));
  app.setNow(Date.UTC(2026, 0, 1));
  const blocked = await app.service.vms.requestPower(GUILD, TARGET, vm.id, "start");
  assert.equal(blocked.code, "vm_expired");
  const refreshed = await app.service.vms.refresh(GUILD, TARGET, vm.id);
  assert.equal(refreshed.ok, true);
  app.close();
});

test("auto ligamento distingue eviction de desligamento e espera capacidade", async () => {
  assert.equal(evictionOf({ desired: "running", observed: "deallocated", statuses: [] }), true);
  assert.equal(evictionOf({ desired: "stopped", observed: "deallocated", statuses: [{ code: "Preempt" }] }), false);
  assert.equal(backoffMs(1) < backoffMs(3), true);

  const state = { power: "deallocated", fail: Object.assign(new Error("AllocationFailed capacity"), { code: "AllocationFailed" }), statuses: [] };
  const azure = azureFake(state);
  const app = harness(azure);
  const vm = await register(app);
  app.store.updateVm(GUILD, vm.id, { auto_start: true, spot: true, desired_power: "stopped", last_power: "running" }, 10_000);
  await app.service.vms.autoStartPass();
  assert.equal(azure.calls.includes("start"), false);

  app.store.updateVm(GUILD, vm.id, { desired_power: "running" }, 10_000);
  await app.service.vms.autoStartPass();
  assert.equal(azure.calls.filter((call) => call === "start").length, 1);
  assert.equal(app.calls.some((call) => call[0] === "dm" && call[2].includes("capacidade")), true);
  const retry = app.store.getVmRetry(vm.id);
  assert.ok(retry.next_at > 10_000);
  await app.service.vms.autoStartPass();
  assert.equal(azure.calls.filter((call) => call === "start").length, 1);

  app.setNow(retry.next_at + 1);
  state.fail = null;
  await app.service.vms.autoStartPass();
  assert.equal(azure.calls.filter((call) => call === "start").length, 2);
  assert.equal(app.store.getVmRetry(vm.id), null);

  app.store.updateVm(GUILD, vm.id, { desired_power: "running", last_power: "deallocated" }, app.store.getVm(GUILD, vm.id).updated_at);
  await confirm(app.service, await app.service.vms.requestPolicy({ guildId: GUILD, actorId: OWNER }));
  state.power = "deallocated";
  const before = azure.calls.filter((call) => call === "start").length;
  await app.service.vms.autoStartPass();
  assert.equal(azure.calls.filter((call) => call === "start").length, before);
  app.close();
});

test("disco só aumenta com aprovação e o isolamento permanece", async () => {
  const azure = azureFake();
  const app = harness(azure);
  const vm = await register(app);
  assert.equal((await app.service.vms.requestDisk({ guildId: GUILD, userId: ACTOR, vmId: vm.id, raw: "256" })).code, "vm_missing");
  assert.equal((await app.service.vms.requestDisk({ guildId: GUILD, userId: TARGET, vmId: vm.id, raw: "64" })).code, "disk_not_increase");
  assert.equal((await confirm(app.service, await app.service.vms.requestDisk({ guildId: GUILD, userId: TARGET, vmId: vm.id, raw: "256" }), TARGET)).code, "vm_disk_requested");
  assert.equal(azure.calls.includes("disk"), false);
  const request = app.store.listDiskRequests(GUILD)[0];
  azure.state.power = "running";
  const denied = await confirm(app.service, await app.service.vms.requestApproveDisk({ guildId: GUILD, actorId: OWNER, requestId: request.id }));
  assert.equal(denied.code, "disk_needs_deallocated");
  const again = await confirm(app.service, await app.service.vms.requestDisk({ guildId: GUILD, userId: TARGET, vmId: vm.id, raw: "256" }), TARGET);
  assert.equal(again.code, "vm_disk_requested");
  const next = app.store.listDiskRequests(GUILD).find((row) => row.status === "pending");
  azure.state.power = "deallocated";
  const approved = await confirm(app.service, await app.service.vms.requestApproveDisk({ guildId: GUILD, actorId: OWNER, requestId: next.id }));
  assert.equal(approved.code, "config_saved");
  assert.equal(azure.calls.includes("disk"), true);
  assert.equal(app.store.getVm(GUILD, vm.id).disk_gb, 256);
  app.close();
});
