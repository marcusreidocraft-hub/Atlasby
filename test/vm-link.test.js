import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { createAzureProvisioner } from "../src/loja/azure.js";
import { planVmLinkRepair, repairVmLinks } from "../src/services/vm-link.js";

const GUILD = "100000000000000001";
const CLIENT = "100000000000000002";
const OTHER = "100000000000000005";

function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-link-"));
  const repo = openDatabase(dir);
  const config = readConfig({
    DISCORD_TOKEN: "token",
    DISCORD_CLIENT_ID: "100000000000000003",
    ALLOWED_GUILD_IDS: GUILD,
    ADMIN_ROLE_IDS: "100000000000000009",
  });
  const tags = [];
  const infra = {
    configured: true,
    async listVms() { return []; },
    async tagOwner(id, userId) { tags.push({ id, userId }); return { mode: "azure" }; },
    async readPower() { return { mode: "manual", status: null, reason: "unconfigured" }; },
    async setPower() { return { mode: "manual", status: null }; },
    async format() { return { mode: "manual", status: null }; },
  };
  const app = createApp({ config, repo, infra, audit: { async record() {} }, now: () => 1 });
  return {
    app, repo, tags, dir,
    close() { repo.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

function client(infraId, userId = CLIENT) {
  return {
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    guildId: GUILD,
    userId,
    clientName: "Ana",
    machineName: "Mesa",
    gpu: "Tesla T4",
    vcpus: 4,
    ram: "28 GB",
    publicIp: null,
    rdpUser: null,
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

test("resource ID com caixa diferente, nome e tag deixam de parecer VM livre", async () => {
  const stored = "/subscriptions/AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA/resourceGroups/REIDO7/providers/Microsoft.Compute/virtualMachines/vm1";
  const listed = "/subscriptions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/resourceGroups/reido7/providers/Microsoft.Compute/virtualMachines/vm1";
  const env = world();
  env.repo.insertClient(client(stored));
  env.app.infra.listVms = async () => [{ id: listed, name: "vm1", resourceGroup: "reido7", size: "Standard_NC4as_T4_v3", location: "brazilsouth", power: "ligada", tags: {} }];
  const choices = await env.app.admin.vmChoices(GUILD, OTHER);
  assert.equal(choices.some((vm) => vm.name === "vm1"), false);
  const own = await env.app.admin.vmChoices(GUILD, CLIENT);
  assert.equal(own.some((vm) => vm.name === "vm1" && vm.own), true);
  const catalog = await env.app.admin.listAzureVms(GUILD, { id: "100000000000000009", permissions: 8n, roleIds: [], owner: true }, 0);
  assert.match(JSON.stringify(catalog), /Ana/);
  assert.doesNotMatch(JSON.stringify(catalog), /sem cliente/);
  env.close();

  const renamed = "/subscriptions/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/resourceGroups/REIDO7/providers/Microsoft.Compute/virtualMachines/vm1";
  const byName = world();
  byName.repo.insertClient(client(stored));
  byName.app.infra.listVms = async () => [{ id: renamed, name: "vm1", resourceGroup: "Reido7", size: "Standard_NC4as_T4_v3", location: "brazilsouth", power: "ligada", tags: {} }];
  assert.equal((await byName.app.admin.vmChoices(GUILD, OTHER)).some((vm) => vm.name === "vm1"), false);
  const named = await byName.app.admin.listAzureVms(GUILD, { id: "100000000000000009", permissions: 8n, roleIds: [], owner: true }, 0);
  assert.match(JSON.stringify(named), /Ana/);
  byName.close();

  const tagged = world();
  tagged.repo.insertClient(client(""));
  tagged.app.infra.listVms = async () => [{
    id: listed,
    name: "vm1",
    resourceGroup: "reido7",
    size: "Standard_NC4as_T4_v3",
    location: "brazilsouth",
    power: "ligada",
    tags: { "ignix-owner": CLIENT },
  }];
  assert.equal((await tagged.app.admin.vmChoices(GUILD, OTHER)).some((vm) => vm.name === "vm1"), false);
  const free = world();
  free.app.infra.listVms = async () => [{ id: listed, name: "vm1", resourceGroup: "reido7", size: "Standard_NC4as_T4_v3", location: "brazilsouth", power: "ligada", tags: {} }];
  assert.equal((await free.app.admin.vmChoices(GUILD, OTHER)).some((vm) => vm.name === "vm1"), true);
  const open = await free.app.admin.listAzureVms(GUILD, { id: "100000000000000009", permissions: 8n, roleIds: [], owner: true }, 0);
  assert.match(JSON.stringify(open), /sem cliente/);
  free.close();
  tagged.close();
});

test("a migração corrige o vínculo uma vez e a tag marca o dono", async () => {
  const stored = "/subscriptions/AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA/resourceGroups/REIDO7/providers/Microsoft.Compute/virtualMachines/vm1";
  const listed = "/subscriptions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/resourceGroups/reido7/providers/Microsoft.Compute/virtualMachines/vm1";
  const clients = [client(stored)];
  const vms = [{ id: listed, name: "vm1", resourceGroup: "reido7", tags: { "ignix-owner": CLIENT } }];
  const once = planVmLinkRepair(clients, vms);
  assert.equal(once.length, 1);
  assert.equal(once[0].infraId, listed.toLowerCase());
  const again = planVmLinkRepair([{ ...clients[0], infraId: once[0].infraId }], vms);
  assert.equal(again.length, 0);

  const env = world();
  env.repo.insertClient(client(stored));
  let tagged = false;
  env.app.infra.listVms = async () => [{ id: listed, name: "vm1", resourceGroup: "reido7", tags: tagged ? { "ignix-owner": CLIENT } : {} }];
  const mark = env.app.infra.tagOwner.bind(env.app.infra);
  env.app.infra.tagOwner = async (id, userId) => {
    tagged = true;
    return mark(id, userId);
  };
  const repairs = await repairVmLinks(env.repo, env.app.infra, 5);
  assert.equal(repairs.length, 1);
  assert.equal(env.repo.getByOwner(GUILD, CLIENT).infraId, listed.toLowerCase());
  await repairVmLinks(env.repo, env.app.infra, 6);
  assert.equal(env.repo.getByOwner(GUILD, CLIENT).infraId, listed.toLowerCase());
  assert.deepEqual(env.tags, [{ id: listed.toLowerCase(), userId: CLIENT }]);
  env.close();

  const seen = [];
  const provisioner = createAzureProvisioner({ azure: { subscriptionId: "sub", tenantId: "t", clientId: "c", clientSecret: "s" } }, {
    compute: {
      virtualMachines: {
        async beginCreateOrUpdateAndWait(_group, _name, body) {
          seen.push(body);
          return { id: listed };
        },
      },
    },
  });
  await provisioner.vm({
    group: "rg",
    names: { vm: "vm1" },
    location: "brazilsouth",
    size: "Standard_NC4as_T4_v3",
    nicId: "/nic/1",
    imageId: "/subscriptions/s/resourceGroups/g/providers/Microsoft.Compute/galleries/a/images/b/versions/1.0.0",
    imageKind: "gallery",
    diskGb: 128,
    spot: true,
    ownerId: CLIENT,
  });
  assert.equal(seen[0].tags["ignix-owner"], CLIENT);
});
