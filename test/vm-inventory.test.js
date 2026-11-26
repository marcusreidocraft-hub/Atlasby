import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { routeAdminComponent } from "../src/commands/admin/router.js";
import { readConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { renderAzureVmList, renderDuplicateConfirm } from "../src/panels/admin.js";
import { createInfrastructure, vmOptionValue } from "../src/services/provider.js";
import { buildInventory, filterInventory, vmLine } from "../src/services/vm-inventory.js";

const GUILD = "100000000000000001";
const OWNER = "100000000000000009";
const ANA = "100000000000000002";
const BIA = "100000000000000005";
const VM = "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/REIDO7/providers/Microsoft.Compute/virtualMachines/mesa";
const LISTED = VM.toLowerCase();
const OTHER = "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/REIDO7/providers/Microsoft.Compute/virtualMachines/livre";
const NIC = "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/REIDO7/providers/Microsoft.Network/networkInterfaces/mesa-nic";
const PIP = "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/REIDO7/providers/Microsoft.Network/publicIPAddresses/mesa-ip";

function person(id, userId, name, infraId, publicIp = null) {
  return {
    id, guildId: GUILD, userId, clientName: name, machineName: name, gpu: "Tesla T4", vcpus: 4, ram: "28 GB",
    publicIp, rdpUser: null, rdpPasswordCipher: null, pinCipher: null, planType: "mensal", startedAt: 1,
    expiresAt: Date.parse("2026-12-01T03:00:00.000Z"), infraId, powerStatus: "ligada", now: 1,
  };
}

function machine(id, name, extra = {}) {
  return { id, name, resourceGroup: "REIDO7", size: "Standard_NC4as_T4_v3", power: "ligada", tags: {}, ...extra };
}

function texts(payload) {
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === 10 && node.content) found.push(node.content);
    for (const value of Object.values(node)) {
      if (Array.isArray(value) || (value && typeof value === "object")) walk(value);
    }
  };
  walk(payload.components[0].toJSON());
  return found;
}

test("o inventário marca dono, revendedor, IP e VM repetida", () => {
  const ana = person("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", ANA, "Ana", VM, "203.0.113.10");
  const bia = person("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", BIA, "Bia", LISTED, "203.0.113.10");
  const free = machine(OTHER, "livre", { power: "desligada" });
  const shared = machine(LISTED, "mesa");
  const resellerVm = machine(`${OTHER}-b`.replace("-b", "").replace("livre", "loja"), "loja", { power: "desligada", tags: { "ignix-reseller": "reseller-1" } });
  const view = buildInventory({
    vms: [shared, free, resellerVm],
    clients: [ana, bia],
    ips: new Map([[LISTED, "203.0.113.10"]]),
    assignments: [{ infraId: resellerVm.id, resellerId: "reseller-1" }],
    resellerNames: new Map([["reseller-1", "Loja Norte"]]),
  });
  assert.equal(view.totals.total, 3);
  assert.equal(view.totals.on, 1);
  assert.equal(view.totals.off, 2);
  assert.equal(view.totals.clients, 1);
  assert.equal(view.totals.free, 1);
  assert.equal(view.totals.resellers, 1);
  assert.equal(view.totals.repeated, 1);
  const row = view.rows.find((item) => item.name === "mesa");
  assert.equal(row.repeated, true);
  assert.match(vmLine(row), /⚠️ Repetida/);
  assert.match(vmLine(row), new RegExp(`<@${ANA}>`));
  assert.match(vmLine(row), new RegExp(`<@${BIA}>`));
  assert.match(vmLine(row), /203\.0\.113\.10/);
  assert.match(vmLine(row), /4 vCPU/);
  assert.equal(view.rows.find((item) => item.name === "livre").kind, "free");
  assert.match(vmLine(view.rows.find((item) => item.name === "loja")), /Revendedor Loja Norte/);
  assert.equal(filterInventory(view.rows, "repetidas").length, 1);
  assert.equal(filterInventory(view.rows, "livres").every((item) => item.kind === "free"), true);
  assert.equal(filterInventory(view.rows, "cliente").length, 1);
  const byIp = buildInventory({
    vms: [machine(LISTED, "mesa", { power: "desligada" })],
    clients: [person(ana.id, ANA, "Ana", LISTED, "198.51.100.8"), person(bia.id, BIA, "Bia", "", "198.51.100.8")],
    ips: new Map([[LISTED, "198.51.100.8"]]),
  });
  assert.equal(byIp.totals.repeated, 1);
});

test("resolver deixa um cliente e não apaga a VM", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-inventory-"));
  const repo = openDatabase(dir);
  const config = readConfig({
    DISCORD_TOKEN: "token",
    DISCORD_CLIENT_ID: "100000000000000003",
    ALLOWED_GUILD_IDS: GUILD,
    ADMIN_ROLE_IDS: "100000000000000061",
    PANEL_COLOR: "5865F2",
  });
  const deleted = [];
  const infra = {
    configured: true,
    async listVms() {
      return [machine(LISTED, "mesa", { power: "desligada" }), machine(OTHER, "livre", { power: "ligada" })];
    },
    async deleteVm() { deleted.push("delete"); },
    async listVmIps() { return new Map([[LISTED, "203.0.113.10"]]); },
  };
  const app = createApp({ config, repo, infra, now: () => 10 });
  repo.insertClient(person("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", ANA, "Ana", VM, "203.0.113.10"));
  repo.insertClient(person("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", BIA, "Bia", LISTED, "203.0.113.10"));
  const actor = { id: OWNER, guildId: GUILD, permissions: 8n, roleIds: [], owner: true };
  const panel = await app.admin.listAzureVms(GUILD, actor, 0, "todas");
  const body = texts(panel).join("\n");
  assert.match(body, /IGNIX CLOUD/);
  assert.match(body, /⚠️ 1 VM repetida/);
  assert.match(body, /Ana/);
  assert.match(body, /Bia/);
  assert.match(body, /Livre/);
  assert.ok(texts(panel).join("").length <= 4000);
  const json = panel.components[0].toJSON();
  const rows = json.components.filter((item) => item.type === 1);
  const selectRow = rows.find((item) => item.components?.[0]?.type === 3);
  assert.equal(selectRow.components.length, 1);
  assert.deepEqual(selectRow.components[0].options.map((option) => option.value), ["todas", "ligadas", "livres", "cliente", "repetidas"]);
  const token = vmOptionValue(LISTED);
  const confirm = renderDuplicateConfirm({
    accent: 1,
    row: { id: LISTED, name: "mesa", owners: [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", clientName: "Ana" }, { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", clientName: "Bia" }] },
    keeper: { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", clientName: "Ana" },
  });
  const confirmId = texts(confirm).length && JSON.stringify(confirm).match(/atlas:admin:azurekeep:yes:[0-9a-f]{32}:[0-9a-f-]{36}/)[0];
  assert.ok(confirmId.length <= 100);
  const opened = await app.admin.openDuplicate(GUILD, actor, token);
  assert.match(texts(opened).join("\n"), /Quem fica com mesa/);
  const preview = await app.admin.confirmDuplicate(GUILD, actor, token, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  assert.match(texts(preview).join("\n"), /Ana fica com/);
  assert.match(texts(preview).join("\n"), /não é apagada/);
  const done = await app.admin.resolveDuplicate(GUILD, actor, token, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  assert.match(texts(done).join("\n"), /Ana ficou com mesa/);
  assert.equal(deleted.length, 0);
  assert.equal(repo.getByOwner(GUILD, ANA).infraId, LISTED);
  assert.equal(repo.getByOwner(GUILD, BIA).infraId, "");
  const again = await app.admin.listAzureVms(GUILD, actor, 0, "repetidas");
  assert.match(texts(again).join("\n"), /Nenhuma VM neste filtro/);
  const replies = [];
  await routeAdminComponent({
    customId: "atlas:admin:azurefilter",
    values: ["livres"],
    guildId: GUILD,
    user: { id: OWNER },
    member: { permissions: { bitfield: 8n }, roles: { cache: new Map() } },
    guild: { ownerId: OWNER },
    deferred: false,
    replied: false,
    async deferUpdate() { this.deferred = true; },
    async editReply(body) { replies.push(body); },
  }, app);
  assert.match(JSON.stringify(replies), /livre/);
  assert.doesNotMatch(JSON.stringify(replies), /mesa/);
  repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("os IPs públicos saem em lote por grupo e ficam em cache", async () => {
  let clock = 1_000;
  const calls = [];
  async function* rows(list) {
    for (const item of list) yield item;
  }
  const network = {
    networkInterfaces: {
      list(group) {
        calls.push(["nic", group]);
        return rows([{ id: NIC, ipConfigurations: [{ publicIPAddress: { id: PIP } }] }]);
      },
    },
    publicIPAddresses: {
      list(group) {
        calls.push(["ip", group]);
        return rows([{ id: PIP, ipAddress: "203.0.113.10" }]);
      },
    },
  };
  const config = readConfig({
    AZURE_TENANT_ID: "tenant",
    AZURE_CLIENT_ID: "client",
    AZURE_CLIENT_SECRET: "secret",
    AZURE_SUBSCRIPTION_ID: "sub",
  });
  const infra = createInfrastructure(config, { network, now: () => clock, ipCacheMs: 45_000 });
  const vms = [
    { id: LISTED, name: "mesa", resourceGroup: "REIDO7", nicId: NIC },
    { id: OTHER, name: "livre", resourceGroup: "REIDO7", nicId: "" },
  ];
  const first = await infra.listVmIps(vms);
  assert.equal(first.get(LISTED), "203.0.113.10");
  assert.equal(calls.length, 2);
  await infra.listVmIps(vms);
  assert.equal(calls.length, 2);
  clock += 46_000;
  await infra.listVmIps(vms);
  assert.equal(calls.length, 4);
  const panel = renderAzureVmList({
    accent: 1,
    page: 0,
    filter: "todas",
    view: buildInventory({ vms: [machine(LISTED, "mesa")], clients: [], ips: first }),
  });
  const button = JSON.stringify(panel);
  assert.match(button, /atlas:admin:azurepage:0:todas:next/);
  assert.match(button, /atlas:admin:azurefilter/);
  assert.equal(panel.components[0].toJSON().components.filter((item) => item.type === 1 && item.components.some((child) => child.type === 3)).every((item) => item.components.length === 1), true);
});
