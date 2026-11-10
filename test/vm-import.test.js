import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createService } from "../src/service.js";
import { openDatabase } from "../src/storage.js";
import { importKey, skuFacts } from "../src/vm-model.js";
import { textOf, validateV2Message } from "../src/ui.js";
import { ACTOR, GUILD, OWNER, TARGET, fakeDiscord } from "../src/fixtures.js";

function harness(azure) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlasby-import-"));
  const store = openDatabase(dir);
  const discord = fakeDiscord({
    async inspectActor(_guildId, userId) {
      return { id: userId, isOwner: userId === OWNER, ownerId: OWNER, highestPosition: 10, permissions: 0n };
    },
  });
  const service = createService({ store, discord, now: () => 5_000, ttlMs: 60_000, azure });
  return { store, service, close: () => store.close() };
}

function machines(count, group = "rg-atlas") {
  return Array.from({ length: count }, (_item, index) => ({
    name: `vm-${index}`,
    resourceGroup: group,
    size: "Standard_NC4as_T4_v3",
    location: "brazilsouth",
    osType: "Windows",
    priority: index % 2 === 0 ? "Spot" : "Regular",
  }));
}

function azureOf(items, extra = {}) {
  const calls = [];
  return {
    calls,
    configured: true,
    async listVirtualMachines() {
      calls.push("list");
      if (extra.listError) throw extra.listError;
      return items;
    },
    async describeVirtualMachine(group, name) {
      calls.push(["describe", group, name]);
      if (extra.describeError) throw extra.describeError;
      return {
        name,
        resourceGroup: group,
        location: "brazilsouth",
        size: "Standard_NC4as_T4_v3",
        osType: "Windows",
        priority: "Spot",
        publicIp: "20.1.2.3",
        privateIp: "10.0.0.4",
        diskGb: 128,
        powerState: "running",
        ...skuFacts("Standard_NC4as_T4_v3"),
      };
    },
    async start() {
      calls.push("start");
    },
    async resizeDisk() {
      calls.push("disk");
    },
  };
}

test("importação pagina, oculta vinculada e não altera a Azure", async () => {
  const items = machines(30);
  const azure = azureOf(items);
  const app = harness(azure);
  app.store.insertVm({
    id: "44444444-4444-4444-8444-444444444444",
    guildId: GUILD,
    displayName: "vm-0",
    resourceGroup: "rg-atlas",
    vmName: "vm-0",
    osLabel: "Windows",
    sizeLabel: "Standard_NC4as_T4_v3",
    cpuLabel: null,
    ramLabel: null,
    gpuLabel: null,
    diskGb: 128,
    publicIp: null,
    privateIp: null,
    validityUntil: null,
    location: "brazilsouth",
    blockWhenExpired: true,
    autoStart: false,
    spot: true,
    now: 1,
  });
  const first = await app.service.vms.importList(GUILD, OWNER, 0, 0);
  assert.equal(first.ok, true);
  assert.equal(validateV2Message(first.view).ok, true);
  const rendered = textOf(first.view);
  assert.match(rendered, /Página 1 de 2/);
  assert.match(rendered, /ocultada/);
  const json = JSON.stringify(first.view);
  assert.doesNotMatch(json, new RegExp(importKey("rg-atlas", "vm-0")));
  assert.match(json, new RegExp(importKey("rg-atlas", "vm-1")));
  const second = await app.service.vms.importList(GUILD, OWNER, 1, 0);
  assert.match(textOf(second.view), /Página 2 de 2/);
  const preview = await app.service.vms.importPreview(GUILD, OWNER, importKey("rg-atlas", "vm-1"));
  const summary = textOf(preview.view);
  assert.match(summary, /Spot/);
  assert.match(summary, /20\.1\.2\.3/);
  assert.match(summary, /10\.0\.0\.4/);
  assert.match(summary, /128 GB/);
  assert.match(summary, /NVIDIA Tesla T4/);
  assert.match(summary, /CPU: 4/);
  assert.equal((await app.service.vms.importPreview(GUILD, OWNER, importKey("rg-atlas", "vm-0"))).code, "vm_exists");
  assert.equal((await app.service.vms.requestImport(GUILD, OWNER, importKey("rg-atlas", "vm-1"))).code, "vm_user_required");
  await app.service.vms.stageImportUser(GUILD, OWNER, importKey("rg-atlas", "vm-1"), TARGET);
  const pending = await app.service.vms.requestImport(GUILD, OWNER, importKey("rg-atlas", "vm-1"));
  assert.equal(pending.code, "confirmation_required");
  assert.doesNotMatch(pending.summary, /senha|password/i);
  const saved = await app.service.confirm({ confirmationId: pending.confirmationId, guildId: GUILD, moderatorId: OWNER, decision: "confirm" });
  assert.equal(saved.code, "config_saved");
  const stored = app.store.listVms(GUILD).find((vm) => vm.vm_name === "vm-1");
  assert.equal(stored.public_ip, "20.1.2.3");
  assert.equal(stored.disk_gb, 128);
  assert.equal(stored.cpu_label, "4");
  assert.equal(stored.spot, true);
  assert.equal(app.store.ownsVm(GUILD, stored.id, TARGET), true);
  assert.equal(azure.calls.includes("start"), false);
  assert.equal(azure.calls.includes("disk"), false);
  assert.equal((await app.service.vms.importList(GUILD, ACTOR, 0, 0)).code, "admin_unauthorized");
  app.close();
});

test("filtro de grupo e erro de permissão", async () => {
  const items = [...machines(2, "rg-atlas"), ...machines(2, "rg-other").map((item, index) => ({ ...item, name: `other-${index}` }))];
  const azure = azureOf(items);
  const app = harness(azure);
  const filtered = await app.service.vms.importList(GUILD, OWNER, 0, 2);
  const json = JSON.stringify(filtered.view);
  assert.match(json, new RegExp(importKey("rg-other", "other-0")));
  assert.doesNotMatch(json, new RegExp(importKey("rg-atlas", "vm-0")));
  azure.listVirtualMachines = async () => {
    const error = new Error("AuthorizationFailed");
    error.statusCode = 403;
    error.code = "AuthorizationFailed";
    throw error;
  };
  const denied = await app.service.vms.importList(GUILD, OWNER, 0, 0);
  assert.equal(denied.code, "azure_forbidden");
  const bare = harness({ configured: false });
  assert.equal((await bare.service.vms.importList(GUILD, OWNER, 0, 0)).code, "azure_unconfigured");
  bare.close();
  app.close();
});

test("tabela conhecida do NC4as preenche CPU, RAM e GPU", () => {
  assert.deepEqual(skuFacts("Standard_NC4as_T4_v3"), { cpu: "4", ram: "28 GB", gpu: "NVIDIA Tesla T4" });
  assert.equal(skuFacts("Standard_D2s_v5", [{ name: "vCPUs", value: "2" }, { name: "MemoryGB", value: "8" }]).ram, "8 GB");
});
