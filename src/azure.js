import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import net from "node:net";
import { isPublicIpv4, MOONLIGHT_PORT, normalizePower, skuFacts } from "./vm-model.js";

const SALT = "atlasby-vm-credentials-v1";

export function readAzureConfig(env = {}) {
  const tenantId = String(env.AZURE_TENANT_ID ?? "").trim();
  const clientId = String(env.AZURE_CLIENT_ID ?? "").trim();
  const clientSecret = String(env.AZURE_CLIENT_SECRET ?? "").trim();
  const subscriptionId = String(env.AZURE_SUBSCRIPTION_ID ?? "").trim();
  const credentialsKey = String(env.AZURE_CREDENTIALS_KEY ?? "").trim();
  return {
    tenantId,
    clientId,
    clientSecret,
    subscriptionId,
    credentialsKey,
    configured: Boolean(tenantId && clientId && clientSecret && subscriptionId),
  };
}

export function deriveCredentialKey(config) {
  const material = config?.credentialsKey || config?.clientSecret || "";
  if (material.length < 16) return null;
  return scryptSync(material, SALT, 32);
}

export function sealJson(key, value) {
  if (!key) throw Object.assign(new Error("chave"), { code: "credentials_key_missing" });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function openJson(key, encoded) {
  if (!key || !encoded) return null;
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8"));
}

export function probeTcp(host, port = MOONLIGHT_PORT, timeoutMs = 3000) {
  if (!isPublicIpv4(host)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function coded(code) {
  return Object.assign(new Error(code), { code });
}

function resourceGroupOf(id) {
  const parts = String(id ?? "").split("/");
  return { group: parts[4], name: parts[8] };
}

export function azureFailureCode(error) {
  const status = error?.statusCode ?? error?.status;
  const code = String(error?.code ?? "");
  const text = `${code} ${error?.message ?? ""}`;
  if (code === "azure_unconfigured") return "azure_unconfigured";
  if (code === "azure_forbidden" || status === 403 || code === "AuthorizationFailed" || /authorization|forbidden/i.test(text)) {
    return "azure_forbidden";
  }
  return code || "azure_failed";
}

function rethrowAzure(error) {
  throw Object.assign(error instanceof Error ? error : new Error("azure"), { code: azureFailureCode(error) });
}

export function createAzureClient(config, deps = {}) {
  const unconfigured = {
    configured: false,
    async getInstanceView() {
      throw coded("azure_unconfigured");
    },
    async start() {
      throw coded("azure_unconfigured");
    },
    async deallocate() {
      throw coded("azure_unconfigured");
    },
    async restart() {
      throw coded("azure_unconfigured");
    },
    async readNetwork() {
      throw coded("azure_unconfigured");
    },
    async listVirtualMachines() {
      throw coded("azure_unconfigured");
    },
    async describeVirtualMachine() {
      throw coded("azure_unconfigured");
    },
    async resizeDisk() {
      throw coded("azure_unconfigured");
    },
  };
  if (!config?.configured) return unconfigured;

  let cached = null;
  async function sdk() {
    if (deps.sdk) return deps.sdk;
    if (cached) return cached;
    const identity = await import("@azure/identity");
    const compute = await import("@azure/arm-compute");
    const network = await import("@azure/arm-network");
    const credential = new identity.ClientSecretCredential(config.tenantId, config.clientId, config.clientSecret);
    cached = {
      compute: new compute.ComputeManagementClient(credential, config.subscriptionId),
      network: new network.NetworkManagementClient(credential, config.subscriptionId),
    };
    return cached;
  }

  return {
    configured: true,
    async getInstanceView(group, name) {
      const { compute } = await sdk();
      const view = await compute.virtualMachines.instanceView(group, name);
      const power = (view.statuses ?? []).find((status) => String(status.code ?? "").startsWith("PowerState/"));
      return {
        powerState: normalizePower(power?.code),
        statuses: view.statuses ?? [],
      };
    },
    async start(group, name) {
      const { compute } = await sdk();
      const poller = await compute.virtualMachines.beginStart(group, name);
      await poller.pollUntilDone();
    },
    async deallocate(group, name) {
      const { compute } = await sdk();
      const poller = await compute.virtualMachines.beginDeallocate(group, name);
      await poller.pollUntilDone();
    },
    async restart(group, name) {
      const { compute } = await sdk();
      const poller = await compute.virtualMachines.beginRestart(group, name);
      await poller.pollUntilDone();
    },
    async readNetwork(group, name) {
      const { compute, network } = await sdk();
      const vm = await compute.virtualMachines.get(group, name);
      const nicId = vm.networkProfile?.networkInterfaces?.[0]?.id;
      if (!nicId) return { publicIp: null, privateIp: null };
      const nicRef = resourceGroupOf(nicId);
      const nic = await network.networkInterfaces.get(nicRef.group, nicRef.name);
      const config = nic.ipConfigurations?.[0];
      const privateIp = config?.privateIPAddress ?? null;
      const publicId = config?.publicIPAddress?.id;
      if (!publicId) return { publicIp: null, privateIp };
      const publicRef = resourceGroupOf(publicId);
      const address = await network.publicIPAddresses.get(publicRef.group, publicRef.name);
      return { publicIp: address.ipAddress ?? null, privateIp };
    },
    async listVirtualMachines() {
      const { compute } = await sdk();
      const items = [];
      try {
        for await (const vm of compute.virtualMachines.listAll()) {
          const parts = String(vm.id ?? "").split("/");
          items.push({
            name: vm.name,
            resourceGroup: parts[4],
            size: vm.hardwareProfile?.vmSize ?? null,
            location: vm.location ?? null,
            osType: vm.storageProfile?.osDisk?.osType ?? null,
            priority: vm.priority === "Spot" ? "Spot" : "Regular",
          });
        }
      } catch (error) {
        rethrowAzure(error);
      }
      return items;
    },
    async describeVirtualMachine(group, name) {
      const { compute } = await sdk();
      let vm;
      try {
        vm = await compute.virtualMachines.get(group, name);
      } catch (error) {
        rethrowAzure(error);
      }
      const view = await this.getInstanceView(group, name).catch(() => ({ powerState: "unknown", statuses: [] }));
      const network = await this.readNetwork(group, name).catch(() => ({ publicIp: null, privateIp: null }));
      let diskGb = vm.storageProfile?.osDisk?.diskSizeGB ?? null;
      const diskId = vm.storageProfile?.osDisk?.managedDisk?.id;
      if (diskId && compute.disks?.get) {
        try {
          const diskRef = resourceGroupOf(diskId);
          const disk = await compute.disks.get(diskRef.group, diskRef.name);
          diskGb = disk.diskSizeGB ?? diskGb;
        } catch {
          // O tamanho informado no perfil da VM permanece.
        }
      }
      const size = vm.hardwareProfile?.vmSize ?? null;
      let capabilities = [];
      if (compute.resourceSkus?.list && vm.location && size) {
        try {
          for await (const sku of compute.resourceSkus.list({ filter: `location eq '${vm.location}'` })) {
            if (sku.name === size) {
              capabilities = sku.capabilities ?? [];
              break;
            }
          }
        } catch {
          capabilities = [];
        }
      }
      const facts = skuFacts(size, capabilities);
      return {
        name: vm.name,
        resourceGroup: group,
        location: vm.location ?? null,
        size,
        osType: vm.storageProfile?.osDisk?.osType ?? null,
        priority: vm.priority === "Spot" ? "Spot" : "Regular",
        publicIp: network.publicIp,
        privateIp: network.privateIp,
        diskGb,
        powerState: view.powerState,
        cpu: facts.cpu,
        ram: facts.ram,
        gpu: facts.gpu,
      };
    },
    async resizeDisk(group, name, requestedGb) {
      const { compute } = await sdk();
      const view = await this.getInstanceView(group, name);
      if (view.powerState !== "deallocated") throw coded("disk_needs_deallocated");
      const vm = await compute.virtualMachines.get(group, name);
      const diskId = vm.storageProfile?.osDisk?.managedDisk?.id;
      if (!diskId) throw coded("disk_missing");
      const diskRef = resourceGroupOf(diskId);
      const disk = await compute.disks.get(diskRef.group, diskRef.name);
      if (requestedGb <= Number(disk.diskSizeGB ?? 0)) throw coded("disk_not_increase");
      disk.diskSizeGB = requestedGb;
      const poller = await compute.disks.beginCreateOrUpdate(diskRef.group, diskRef.name, disk);
      await poller.pollUntilDone();
      return requestedGb;
    },
  };
}
