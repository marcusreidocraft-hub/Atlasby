import assert from "node:assert/strict";
import test from "node:test";
import { createAzureProvisioner } from "../src/loja/azure.js";
import { DEFAULT_GALLERY_IMAGE } from "../src/loja/image.js";
import { createMachine } from "../src/maquina/create.js";
import { autoThroughput, maxIopsForSize, maxThroughputForIops, validateDataDisk, azureErrorText } from "../src/maquina/limits.js";
import { buildMachinePayload, defaultMachineName, sizeById, validMachineName } from "../src/maquina/payload.js";
import { inspectModal } from "../src/panels/admin.js";
import { nameModal } from "../src/maquina/panel.js";

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
