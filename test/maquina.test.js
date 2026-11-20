import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ComputeManagementClient } from "@azure/arm-compute";
import { NetworkManagementClient } from "@azure/arm-network";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { createAzureProvisioner } from "../src/loja/azure.js";
import { DEFAULT_GALLERY_IMAGE, preferVersion, withGalleryVersion } from "../src/loja/image.js";
import { createMachine } from "../src/maquina/create.js";
import { atlasNsgRules, chooseNsgs, nsgOptions } from "../src/maquina/nsg.js";
import { autoThroughput, maxIopsForSize, maxThroughputForIops, validateDataDisk, azureErrorText } from "../src/maquina/limits.js";
import { buildMachinePayload, defaultMachineName, sizeById, validMachineName } from "../src/maquina/payload.js";
import { routeMachineComponent } from "../src/maquina/router.js";
import { inspectModal } from "../src/panels/admin.js";
import { nameModal, renderDiskStep, renderFailure, renderGbStep, renderImageStep, renderIopsStep, renderNameStep, renderNsgStep, renderReview, renderSizeStep, renderSpotStep, renderThroughputStep, renderZoneStep } from "../src/maquina/panel.js";

test("disco v2 respeita IOPS, taxa e tamanho", () => {
  assert.equal(maxIopsForSize(4), 3000);
  assert.equal(maxIopsForSize(8), 4000);
  assert.equal(maxIopsForSize(128), 64000);
  assert.equal(maxIopsForSize(200), 80000);
  assert.equal(maxThroughputForIops(3000), 750);
  assert.equal(maxThroughputForIops(16000), 1200);
  assert.equal(autoThroughput(3000), 750);
  assert.equal(validateDataDisk({ gb: 128, iops: 3000, throughput: 125 }).ok, true);
  assert.match(validateDataDisk({ gb: 64, iops: 3000, throughput: 125 }).error, /128, 256, 512 ou 1024/);
  assert.match(validateDataDisk({ gb: 128, iops: 70000, throughput: 125 }).error, /64000/);
  assert.match(validateDataDisk({ gb: 512, iops: 3000, throughput: 800 }).error, /750/);
  assert.equal(sizeById("t4-4").size, "Standard_NC4as_T4_v3");
  assert.equal(sizeById("t4-8").size, "Standard_NC8as_T4_v3");
  assert.equal(sizeById("t4-16").size, "Standard_NC16as_T4_v3");
  assert.equal(validMachineName(defaultMachineName("João")), true);
  assert.equal(validMachineName("1atlas"), false);
  assert.equal(inspectModal(nameModal("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).length, 0);
  assert.match(azureErrorText({ code: "AuthorizationFailed" }), /O aplicativo não tem permissão/);
  assert.match(azureErrorText(new Error("SkuNotAvailable for spot")), /capacidade Spot/);
  assert.match(azureErrorText(new Error("PremiumV2 is not supported in this region")), /SSD v2/);
  const plain = azureErrorText(new Error("Cannot read properties of undefined (reading 'list')"));
  assert.equal(plain.includes(": Cannot"), false);
  assert.match(plain, /Cannot read properties/);
});

test("o payload da VM usa a galeria, zona e disco v2", async () => {
  const built = buildMachinePayload({
    sizeId: "t4-8",
    location: "brazilsouth",
    nicId: "/nic/1",
    imageId: DEFAULT_GALLERY_IMAGE,
    osGb: 512,
    osName: "atlas-os",
    spot: false,
    diskMode: "v2",
    zone: "2",
    dataGb: 256,
    iops: 5000,
    throughput: 125,
    dataDiskId: "/disk/dados",
    dataName: "atlas-dd-1",
  });
  assert.equal(built.vm.osProfile, undefined);
  assert.equal(built.vm.priority, undefined);
  assert.equal(built.vm.zones[0], "2");
  assert.equal(built.vm.storageProfile.osDisk.managedDisk.storageAccountType, "Premium_LRS");
  assert.equal(built.vm.storageProfile.imageReference.id, DEFAULT_GALLERY_IMAGE);
  assert.equal(built.vm.storageProfile.dataDisks[0].managedDisk.id, "/disk/dados");
  assert.equal(built.disk.sku.name, "PremiumV2_LRS");
  assert.equal(built.disk.diskIOPSReadWrite, 5000);
  assert.equal(built.disk.diskMBpsReadWrite, 125);
  assert.deepEqual(built.disk.zones, ["2"]);
  assert.equal(built.specs.vcpus, 8);
  const seen = [];
  const deleted = [];
  const provisioner = createAzureProvisioner({ azure: { subscriptionId: "sub" } }, {
    compute: {
      disks: {
        async beginCreateOrUpdateAndWait(_g, name, body) { seen.push(["disk", name, body]); return { id: "/disk/dados" }; },
        async beginDeleteAndWait(_g, name) { deleted.push(name); },
      },
      virtualMachines: {
        async beginCreateOrUpdateAndWait(_g, name, body) { seen.push(["vm", name, body]); throw new Error("QuotaExceeded"); },
        async beginDeleteAndWait(_g, name) { deleted.push(name); },
      },
    },
    network: {
      publicIPAddresses: {
        async beginCreateOrUpdateAndWait(_g, name, body) { seen.push(["ip", name, body]); return { id: "/ip/1" }; },
        async beginDeleteAndWait(_g, name) { deleted.push(name); },
      },
      networkInterfaces: {
        async beginCreateOrUpdateAndWait(_g, name) { seen.push(["nic", name]); return { id: "/nic/1" }; },
        async beginDeleteAndWait(_g, name) { deleted.push(name); },
      },
    },
  });
  const result = await createMachine({
    seed: "pedido-1",
    machineName: "atlas-ana-01",
    sizeId: "t4-4",
    vmSize: "Standard_NC4as_T4_v3",
    vcpus: 4,
    spot: true,
    diskMode: "v2",
    dataGb: 128,
    iops: 3000,
    throughput: 125,
    zone: "1",
    location: "brazilsouth",
    group: "REIDO7",
    vnet: "vnet",
    subnet: "snet",
    nsg: "Atlas-nsg",
    imageId: DEFAULT_GALLERY_IMAGE,
    osGb: 512,
  }, { ...provisioner, async quota() { return { ok: true }; } });
  assert.equal(result.ok, false);
  assert.match(result.error, /cota/);
  assert.deepEqual(seen.map((item) => item[0]), ["ip", "nic", "disk", "vm"]);
  assert.equal(seen[0][2].zones[0], "1");
  assert.equal(seen[2][2].sku.name, "PremiumV2_LRS");
  assert.equal(seen[3][2].priority, "Spot");
  assert.equal(seen[3][2].storageProfile.imageReference.id, DEFAULT_GALLERY_IMAGE);
  assert.deepEqual(deleted, ["atlas-ana-01", "atlas-dd-pedido", "atlas-nic-pedido1", "atlas-ip-pedido1"]);
});

test("a lista de NSG fica na região e as regras padrão abrem o Moonlight", async () => {
  const rules = atlasNsgRules(7474);
  assert.deepEqual(rules.find((rule) => rule.name === "moonlight-tcp").destinationPortRanges, ["47984", "47989", "48010"]);
  assert.deepEqual(rules.find((rule) => rule.name === "moonlight-udp").destinationPortRanges, ["47998-48000", "48002", "48010"]);
  assert.equal(rules.find((rule) => rule.name === "rdp").destinationPortRange, "3389");
  assert.equal(rules.find((rule) => rule.name === "agente-pin").destinationPortRange, "7474");
  const many = [
    { name: "leste", group: "outro", location: "eastus", id: "/subscriptions/s/resourceGroups/outro/providers/Microsoft.Network/networkSecurityGroups/leste" },
    ...Array.from({ length: 30 }, (_, index) => ({ name: `fora-${index}`, group: "outro", location: "brazilsouth", id: `/subscriptions/s/resourceGroups/outro/providers/Microsoft.Network/networkSecurityGroups/fora-${index}` })),
    { name: "Atlas-nsg", group: "REIDO7", location: "Brazil South", id: "/subscriptions/s/resourceGroups/REIDO7/providers/Microsoft.Network/networkSecurityGroups/Atlas-nsg" },
  ];
  const chosen = chooseNsgs(many, { location: "brazilsouth", resourceGroup: "REIDO7", limit: 23 });
  assert.equal(chosen.every((item) => item.group === "REIDO7"), true);
  assert.equal(chosen.some((item) => item.location === "eastus"), false);
  const options = nsgOptions({ nsgs: chosen, defaultName: "Atlas-nsg" });
  assert.equal(options[0].label, "Padrão");
  assert.equal(options[1].label, "Criar NSG Ignix");
  assert.ok(options.length <= 25);
  const recorded = [];
  const provisioner = createAzureProvisioner({ azure: { subscriptionId: "sub" } }, {
    network: {
      networkInterfaces: {
        async beginCreateOrUpdateAndWait(_group, _name, body) {
          recorded.push(body.networkSecurityGroup.id);
          return { id: "/nic/1" };
        },
      },
      networkSecurityGroups: {
        async listAll() {
          return [{
            name: "Atlas-nsg",
            location: "brazilsouth",
            id: "/subscriptions/sub/resourceGroups/REIDO7/providers/Microsoft.Network/networkSecurityGroups/Atlas-nsg",
          }];
        },
        async beginCreateOrUpdateAndWait(_group, name, body) {
          recorded.push([name, body.securityRules.length]);
          return { id: "/nsg/novo" };
        },
      },
    },
  });
  const listed = await provisioner.listNsgs();
  assert.equal(listed[0].group, "REIDO7");
  await provisioner.nic({ group: "REIDO7", location: "brazilsouth", names: { nic: "nic" }, vnet: "vnet", subnet: "snet", nsgId: listed[0].id, ipId: "/ip" });
  assert.equal(recorded[0], listed[0].id);
  const created = await provisioner.nsg({ group: "REIDO7", location: "brazilsouth", names: { nsg: "atlas-nsg-1" }, nsgRules: rules });
  assert.equal(created, "/nsg/novo");
  assert.equal(recorded[1][1], 4);
  assert.equal(preferVersion(["1.0.0", "2.0.0", "1.5.0"]), "2.0.0");
  assert.equal(preferVersion(["1.0.0", "1.5.0"]), "1.5.0");
  assert.match(withGalleryVersion(DEFAULT_GALLERY_IMAGE, "2.0.0"), /\/versions\/2\.0\.0$/);
  const checked = await createAzureProvisioner({ azure: { subscriptionId: "02daccdd-f01a-4b29-adad-3322cba43a21" } }, {
    network: {
      virtualNetworks: { async get() { const error = new Error("Resource group missing"); error.code = "ResourceGroupNotFound"; throw error; } },
    },
    compute: { galleryImageVersions: { async get() { return { provisioningState: "Succeeded" }; } } },
  }).preflight({ group: "Ignix", vnet: "vnet", subnet: "snet", nsgMode: "padrao", nsg: "", location: "brazilsouth", imageId: DEFAULT_GALLERY_IMAGE });
  assert.match(checked.join(" "), /grupo de recursos não existe/);
});

test("continuar aceita a sugestão e a única imagem não trava o menu", async () => {
  const draftId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const views = [
    renderSizeStep({ id: draftId, userId: "1" }, 1),
    renderSpotStep({ id: draftId, sizeLabel: "T4" }, 1),
    renderDiskStep({ id: draftId }, 1),
    renderGbStep({ id: draftId }, 1),
    renderIopsStep({ id: draftId }, 1),
    renderThroughputStep({ id: draftId, iops: 3000 }, 1),
    renderZoneStep({ id: draftId }, 1, "2"),
    renderNsgStep({ id: draftId }, [], { defaultName: "Ignix-nsg", accent: 1 }),
    renderImageStep({ id: draftId }, ["2.0.0"], "2.0.0", 1),
    renderImageStep({ id: draftId }, ["1.0.0", "2.0.0"], "2.0.0", 1),
  ];
  for (const view of views) {
    const raw = JSON.stringify(view);
    assert.equal(raw.includes('"default":true'), false);
    assert.match(raw, /Continuar/);
    assert.match(raw, /Voltar/);
  }
  assert.match(JSON.stringify(renderNameStep({ id: draftId, suggestedName: "ignix-ana-ab" }, 1)), /Usar sugestão/);
  assert.match(JSON.stringify(renderReview({ id: draftId, userId: "1", sizeLabel: "T4", spot: true, diskMode: "premium", nsgLabel: "Ignix-nsg", machineName: "ignix-ana-ab" }, 1, { location: "brazilsouth", image: "Atlas2.0/2.0.0", version: "2.0.0", expires: 1 })), /Versão: 2\.0\.0/);
  assert.match(JSON.stringify(renderFailure("falhou", 1, [], draftId)), /Tentar de novo/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-maquina-"));
  const repo = openDatabase(dir);
  const config = readConfig({
    DISCORD_TOKEN: "token",
    DISCORD_CLIENT_ID: "100000000000000003",
    ALLOWED_GUILD_IDS: "100000000000000001",
    CREDENTIALS_KEY: "chave-de-teste-atlas",
    AZURE_TENANT_ID: "tenant",
    AZURE_CLIENT_ID: "client",
    AZURE_CLIENT_SECRET: "secret",
    AZURE_SUBSCRIPTION_ID: "02daccdd-f01a-4b29-adad-3322cba43a21",
    AZURE_RESOURCE_GROUP: "Ignix",
    AZURE_VIRTUAL_NETWORK: "vnet",
    AZURE_SUBNET: "snet",
    AZURE_NSG: "Ignix-nsg",
    AZURE_ZONE: "2",
    AZURE_IMAGE_ID: DEFAULT_GALLERY_IMAGE,
  });
  const app = createApp({ config, repo, infra: { configured: true, async listVms() { return []; } } });
  let versions = ["2.0.0"];
  app.provisioner.listNsgs = async () => [];
  app.provisioner.listImageVersions = async () => ({ ok: true, versions, preferred: versions.includes("2.0.0") ? "2.0.0" : versions[0] });
  const guildId = "100000000000000001";
  const actorId = "100000000000000002";
  const save = (id, payload) => repo.saveDraft({ id, guildId, actorId, kind: "maquina", expiresAt: Date.now() + 30 * 60 * 1000, payload });
  const press = async (customId, values = []) => {
    const interaction = {
      customId,
      guildId,
      user: { id: actorId },
      member: { permissions: { bitfield: 8n }, roles: { cache: new Map() } },
      guild: { ownerId: actorId },
      deferred: false,
      replied: false,
      values,
      async deferUpdate() { this.deferred = true; },
      async deferReply() { this.deferred = true; },
      async editReply(body) { this.last = body; },
      async reply(body) { this.replied = true; this.last = body; },
      async showModal() {},
    };
    assert.equal(await routeMachineComponent(interaction, app), true);
    return JSON.stringify(interaction.last);
  };

  save(draftId, { id: draftId, userId: "100000000000000009", username: "ana" });
  assert.match(await press(`atlas:maquina:ok:size:${draftId}`), /Capacidade/);
  assert.match(await press(`atlas:maquina:back:spot:${draftId}`), /Tamanho/);
  assert.match(await press(`atlas:maquina:ok:size:${draftId}`), /Sugestão: Spot/);
  assert.match(await press(`atlas:maquina:ok:spot:${draftId}`), /SSD Premium/);
  assert.match(await press(`atlas:maquina:ok:disk:${draftId}`), /Firewall/);
  const named = await press(`atlas:maquina:ok:nsg:${draftId}`);
  assert.match(named, /Nome/);
  assert.equal(named.includes("atlas:maquina:image:"), false);
  assert.equal(repo.getDraft(draftId).payload.imageVersion, "2.0.0");
  assert.match(repo.getDraft(draftId).payload.imageId, /\/versions\/2\.0\.0$/);
  assert.match(await press(`atlas:maquina:auto:${draftId}`), /Versão: 2\.0\.0/);

  const dataId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  save(dataId, { id: dataId, userId: "100000000000000009", username: "ana", diskMode: "v2", sizeId: "t4-4", sizeLabel: "T4 4 vCPUs" });
  assert.match(await press(`atlas:maquina:ok:gb:${dataId}`), /3000/);
  assert.match(await press(`atlas:maquina:ok:iops:${dataId}`), /125 MB\/s/);
  assert.match(await press(`atlas:maquina:ok:flow:${dataId}`), /zona 2/);
  assert.match(await press(`atlas:maquina:ok:zone:${dataId}`), /Firewall/);
  await press(`atlas:maquina:ok:nsg:${dataId}`);
  const data = repo.getDraft(dataId).payload;
  assert.equal(data.dataGb, 128);
  assert.equal(data.iops, 3000);
  assert.equal(data.throughput, 125);
  assert.equal(data.zone, "2");
  assert.equal(data.imageSkipped, true);

  versions = ["1.0.0", "2.0.0"];
  const imageId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  save(imageId, { id: imageId, userId: "100000000000000009", username: "ana", diskMode: "premium", nsgMode: "padrao", nsgs: [] });
  const imageStep = await press(`atlas:maquina:ok:nsg:${imageId}`);
  assert.match(imageStep, /Sugestão: 2\.0\.0/);
  assert.equal(imageStep.includes('"default":true'), false);
  assert.match(imageStep, /atlas:maquina:ok:image:/);
  assert.match(await press(`atlas:maquina:ok:image:${imageId}`), /Nome/);
  assert.equal(repo.getDraft(imageId).payload.imageVersion, "2.0.0");
  repo.close();
});

test("cota Spot olha lowPriorityCores e uma consulta quebrada não bloqueia", async () => {
  const usage = [
    { name: { value: "standardNCADSv3Family" }, limit: 0, currentValue: 0 },
    { name: { value: "cores" }, limit: 4, currentValue: 2 },
    { name: { value: "lowPriorityCores" }, limit: 8, currentValue: 0 },
  ];
  const client = {
    resourceSkus: {
      async *list() {
        yield { name: "Standard_NC4as_T4_v3", family: "standardNCADSv3Family", capabilities: [{ name: "vCPUs", value: "4" }] };
      },
    },
    usageOperations: { async *list() { yield* usage; } },
  };
  const provisioner = createAzureProvisioner({ azure: {} }, { compute: client });
  const spot = await provisioner.quota({ location: "brazilsouth", size: "Standard_NC4as_T4_v3", vcpus: 4, spot: true });
  assert.equal(spot.ok, true);
  usage[2].currentValue = 6;
  const tightSpot = await provisioner.quota({ location: "brazilsouth", size: "Standard_NC4as_T4_v3", vcpus: 4, spot: true });
  assert.match(tightSpot.error, /Spot/);
  const tightCores = await provisioner.quota({ location: "brazilsouth", size: "Standard_NC4as_T4_v3", vcpus: 4, spot: false });
  assert.match(tightCores.error, /família/);
  usage[0].limit = 16;
  const tightRegional = await provisioner.quota({ location: "brazilsouth", size: "Standard_NC4as_T4_v3", vcpus: 4, spot: false });
  assert.match(tightRegional.error, /regional de vCPU acabou/);
  usage[1].limit = 20;
  assert.equal((await provisioner.quota({ location: "brazilsouth", size: "Standard_NC4as_T4_v3", vcpus: 4, spot: false })).ok, true);
  const broken = createAzureProvisioner({ azure: {} }, {
    compute: {
      resourceSkus: { list() { throw new Error("Cannot read properties of undefined (reading 'list')"); } },
    },
  });
  assert.equal((await broken.quota({ location: "brazilsouth", size: "Standard_NC4as_T4_v3", vcpus: 4, spot: true })).ok, true);
});

test("cada operação Azure usada existe no SDK instalado", () => {
  const credential = { getToken: async () => ({ token: "x", expiresOnTimestamp: Date.now() + 60_000 }) };
  const compute = new ComputeManagementClient(credential, "00000000-0000-0000-0000-000000000000");
  const network = new NetworkManagementClient(credential, "00000000-0000-0000-0000-000000000000");
  const files = [
    ...fs.readdirSync("src/maquina").map((name) => path.join("src/maquina", name)),
    ...fs.readdirSync("src/assinatura").filter((name) => name.endsWith(".js")).map((name) => path.join("src/assinatura", name)),
    "src/loja/azure.js",
    "src/services/provider.js",
  ];
  const call = /(?:(?<![\w.])(?:computeClient|networkClient|client|comp|net)|\))\.([A-Za-z][A-Za-z0-9]*)\.([A-Za-z][A-Za-z0-9]*)\s*\(/g;
  const seen = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(call)) seen.push([file, match[1], match[2]]);
  }
  assert.ok(seen.some((item) => item[1] === "usageOperations" && item[2] === "list"));
  assert.equal(seen.some((item) => item[1] === "usage"), false);
  for (const [file, group, method] of seen) {
    const owner = group in compute ? compute : group in network ? network : null;
    assert.ok(owner, `${file} usa ${group}.${method}, ausente no SDK`);
    assert.equal(typeof owner[group][method], "function", `${file} usa ${group}.${method}`);
  }
});
