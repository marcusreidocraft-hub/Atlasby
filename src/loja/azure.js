import { buildSpecializedVm } from "./image.js";

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
    async quota({ location, size, vcpus }) {
      const client = await compute();
      let family = "";
      let needed = vcpus;
      for await (const sku of client.resourceSkus.list({ filter: `location eq '${location}'` })) {
        if (sku.name !== size) continue;
        family = sku.family || "";
        const found = sku.capabilities?.find((item) => item.name === "vCPUs")?.value;
        if (found) needed = Number(found);
        break;
      }
      if (!family) return { ok: false, error: "O tamanho não existe nesta região." };
      for await (const row of client.usage.list(location)) {
        if ((row.name?.value || "") !== family) continue;
        return row.limit - row.currentValue >= needed ? { ok: true } : { ok: false, error: "A cota desta família acabou." };
      }
      return { ok: false, error: "A cota não foi consultada." };
    },
    async ip(state) {
      const client = await network();
      const created = await client.publicIPAddresses.beginCreateOrUpdateAndWait(state.group, state.names.ip, {
        location: state.location,
        sku: { name: "Standard" },
        publicIPAllocationMethod: "Static",
      });
      return created.id;
    },
    async nic(state) {
      const client = await network();
      const subnet = idOf(config.azure.subscriptionId, state.group, "Microsoft.Network", `virtualNetworks/${state.vnet}`, `subnets/${state.subnet}`);
      const nsg = idOf(config.azure.subscriptionId, state.group, "Microsoft.Network", `networkSecurityGroups/${state.nsg}`);
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
        });
      const created = await client.virtualMachines.beginCreateOrUpdateAndWait(state.group, state.names.vm, parameters);
      return created.id;
    },
    async readIp(state) {
      const client = await network();
      const address = await client.publicIPAddresses.get(state.group, state.names.ip);
      return address.ipAddress || "";
    },
  };
}
