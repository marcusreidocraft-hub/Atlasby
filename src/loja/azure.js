import { buildDataDisk, buildSpecializedVm, parseGalleryImage, preferVersion } from "./image.js";

function idOf(subscription, group, provider, ...parts) {
  return `/subscriptions/${subscription}/resourceGroups/${group}/providers/${provider}/${parts.join("/")}`;
}

export function createAzureProvisioner(config, deps = {}) {
  async function compute() {
    if (deps.compute) return deps.compute;
    const identity = await import("@azure/identity");
    const arm = await import("@azure/arm-compute");
    const credential = new identity.ClientSecretCredential(config.azure.tenantId, config.azure.clientId, config.azure.clientSecret);
    return new arm.ComputeManagementClient(credential, config.azure.subscriptionId);
  }
  async function network() {
    if (deps.network) return deps.network;
    const identity = await import("@azure/identity");
    const arm = await import("@azure/arm-network");
    const credential = new identity.ClientSecretCredential(config.azure.tenantId, config.azure.clientId, config.azure.clientSecret);
    return new arm.NetworkManagementClient(credential, config.azure.subscriptionId);
  }
  return {
    async quota({ location, size, vcpus, spot }) {
      const client = await compute();
      try {
        let family = "";
        let needed = Number(vcpus) || 0;
        for await (const sku of client.resourceSkus.list({ filter: `location eq '${location}'` })) {
          if (sku.name !== size) continue;
          family = sku.family || "";
          const found = sku.capabilities?.find((item) => item.name === "vCPUs")?.value;
          if (found) needed = Number(found);
          break;
        }
        const usage = [];
        for await (const row of client.usageOperations.list(location)) usage.push(row);
        const left = (name) => {
          const row = usage.find((item) => (item.name?.value || "") === name);
          if (!row || !Number.isFinite(row.limit) || !Number.isFinite(row.currentValue)) return null;
          return row.limit - row.currentValue;
        };
        if (spot) {
          const low = left("lowPriorityCores");
          if (low == null) {
            console.warn(`Cota Spot não consultada em ${location}. A criação segue.`);
            return { ok: true };
          }
          return low >= needed ? { ok: true } : { ok: false, error: "A cota regional de vCPU Spot acabou." };
        }
        const familyLeft = family ? left(family) : null;
        const coresLeft = left("cores");
        if (familyLeft == null || coresLeft == null) {
          console.warn(`Cota não consultada em ${location}. A criação segue.`);
          return { ok: true };
        }
        if (familyLeft < needed) return { ok: false, error: "A cota desta família acabou." };
        if (coresLeft < needed) return { ok: false, error: "A cota regional de vCPU acabou." };
        return { ok: true };
      } catch (error) {
        const message = String(error?.message || error).split("\n")[0].slice(0, 240);
        console.warn(`Cota não consultada em ${location}: ${message}`);
        return { ok: true };
      }
    },
    async ip(state) {
      const client = await network();
      const address = {
        location: state.location,
        sku: { name: "Standard" },
        publicIPAllocationMethod: "Static",
      };
      if (state.zone) address.zones = [String(state.zone)];
      const created = await client.publicIPAddresses.beginCreateOrUpdateAndWait(state.group, state.names.ip, address);
      return created.id;
    },
    async nic(state) {
      const client = await network();
      const subnet = idOf(config.azure.subscriptionId, state.group, "Microsoft.Network", `virtualNetworks/${state.vnet}`, `subnets/${state.subnet}`);
      const nsg = state.nsgId || idOf(config.azure.subscriptionId, state.group, "Microsoft.Network", `networkSecurityGroups/${state.nsg}`);
      const created = await client.networkInterfaces.beginCreateOrUpdateAndWait(state.group, state.names.nic, {
        location: state.location,
        ipConfigurations: [{ name: "ipconfig1", subnet: { id: subnet }, publicIPAddress: { id: state.ipId } }],
        networkSecurityGroup: { id: nsg },
      });
      return created.id;
    },
    async vm(state) {
      const client = await compute();
      const parameters = state.imageKind === "snapshot"
        ? {
          location: state.location,
          hardwareProfile: { vmSize: state.size },
          storageProfile: { osDisk: { osType: "Windows", createOption: "Attach", managedDisk: { id: state.imageId }, diskSizeGB: state.diskGb } },
          networkProfile: { networkInterfaces: [{ id: state.nicId, primary: true }] },
        }
        : buildSpecializedVm({
          location: state.location,
          size: state.size,
          nicId: state.nicId,
          imageId: state.imageId,
          diskGb: state.diskGb,
          diskType: state.disk || "PremiumV2_LRS",
          spot: state.spot !== false,
          diskName: state.names?.disk,
          zone: state.zone || "",
          dataDisks: state.dataDiskId ? [{ lun: 0, name: state.names.data, createOption: "Attach", managedDisk: { id: state.dataDiskId, storageAccountType: "PremiumV2_LRS" } }] : [],
        });
      const created = await client.virtualMachines.beginCreateOrUpdateAndWait(state.group, state.names.vm, parameters);
      return created.id;
    },
    async listImageVersions(imageId) {
      const parsed = parseGalleryImage(imageId);
      if (!parsed) return { ok: false, error: "AZURE_IMAGE_ID não é um ID de galeria." };
      if (parsed.subscription !== config.azure.subscriptionId) return { ok: false, error: "A galeria está em outra assinatura. Ajuste AZURE_IMAGE_ID." };
      try {
        const client = await compute();
        const versions = [];
        let page = client.galleryImageVersions.listByGalleryImage(parsed.group, parsed.gallery, parsed.image);
        if (page && typeof page.then === "function") page = await page;
        for await (const version of page) {
          if (!version.provisioningState || version.provisioningState === "Succeeded") versions.push(version.name);
        }
        if (!versions.length) return { ok: false, error: "Nenhuma versão pronta dessa imagem." };
        return { ok: true, versions, preferred: preferVersion(versions) };
      } catch (error) {
        const blob = `${error?.code || ""} ${error?.message || ""}`;
        if (/ResourceGroupNotFound|ResourceNotFound/i.test(blob)) return { ok: false, error: "A imagem não foi encontrada nesta assinatura. Confira AZURE_IMAGE_ID." };
        return { ok: false, error: `Não foi possível listar as versões da imagem. ${error?.code || "erro"}` };
      }
    },
    async preflight(state) {
      const problems = [];
      const net = await network();
      const comp = await compute();
      const textOf = (error, fallback) => {
        const blob = `${error?.code || ""} ${error?.message || ""}`;
        if (/ResourceGroupNotFound/i.test(blob)) return "O grupo de recursos não existe nesta assinatura.";
        if (/ResourceNotFound/i.test(blob)) return fallback;
        return fallback;
      };
      try {
        await net.virtualNetworks.get(state.group, state.vnet);
      } catch (error) {
        const text = textOf(error, "A rede virtual não existe no grupo de recursos.");
        problems.push(text);
        if (text.startsWith("O grupo de recursos")) return problems;
      }
      try {
        await net.subnets.get(state.group, state.vnet, state.subnet);
      } catch (error) {
        problems.push(textOf(error, "A sub-rede não existe."));
      }
      if (state.nsgMode !== "criar" && state.nsg) {
        try {
          const nsg = await net.networkSecurityGroups.get(state.nsgGroup || state.group, state.nsg);
          const place = (value) => String(value || "").toLowerCase().replace(/\s+/g, "");
          if (nsg.location && place(nsg.location) !== place(state.location)) problems.push("O NSG está em outra região.");
        } catch (error) {
          problems.push(textOf(error, "O NSG não existe nesse grupo de recursos."));
        }
      }
      const image = parseGalleryImage(state.imageId);
      if (!image) problems.push("A imagem configurada não é um ID de galeria.");
      else if (image.subscription !== config.azure.subscriptionId) problems.push("A imagem está em outra assinatura.");
      else if (image.version) {
        try {
          const version = await comp.galleryImageVersions.get(image.group, image.gallery, image.image, image.version);
          if (version.provisioningState && version.provisioningState !== "Succeeded") problems.push("A versão da imagem ainda não está pronta.");
        } catch (error) {
          problems.push(textOf(error, "A versão da imagem não foi encontrada."));
        }
      }
      return problems;
    },
    async listNsgs() {
      const client = await network();
      const rows = [];
      let page = client.networkSecurityGroups.listAll();
      if (page && typeof page.then === "function") page = await page;
      for await (const nsg of page) {
        const id = nsg.id || "";
        rows.push({
          id,
          name: nsg.name || "",
          group: /resourceGroups\/([^/]+)/i.exec(id)?.[1] || "",
          location: nsg.location || "",
        });
      }
      return rows;
    },
    async nsg(state) {
      const client = await network();
      const created = await client.networkSecurityGroups.beginCreateOrUpdateAndWait(state.group, state.names.nsg, {
        location: state.location,
        securityRules: state.nsgRules,
      });
      return created.id;
    },
    async disk(state) {
      const client = await compute();
      const created = await client.disks.beginCreateOrUpdateAndWait(state.group, state.names.data, buildDataDisk({
        location: state.location,
        zone: state.zone,
        gb: state.dataGb,
        iops: state.iops,
        throughput: state.throughput,
      }));
      return created.id;
    },
    async start(state) {
      const client = await compute();
      await client.virtualMachines.beginStartAndWait(state.group, state.names.vm);
    },
    async cleanup(state) {
      const computeClient = await compute();
      const networkClient = await network();
      const jobs = [];
      if (state.vmCreated) jobs.push(() => computeClient.virtualMachines.beginDeleteAndWait(state.group, state.names.vm));
      if (state.dataDiskId) jobs.push(() => computeClient.disks.beginDeleteAndWait(state.group, state.names.data));
      if (state.nicId) jobs.push(() => networkClient.networkInterfaces.beginDeleteAndWait(state.group, state.names.nic));
      if (state.ipId) jobs.push(() => networkClient.publicIPAddresses.beginDeleteAndWait(state.group, state.names.ip));
      if (state.nsgCreated) jobs.push(() => networkClient.networkSecurityGroups.beginDeleteAndWait(state.group, state.names.nsg));
      const failed = [];
      for (const job of jobs) {
        try { await job(); } catch { failed.push("recurso"); }
      }
      return failed;
    },
    async readIp(state) {
      const client = await network();
      const address = await client.publicIPAddresses.get(state.group, state.names.ip);
      return address.ipAddress || "";
    },
  };
}
