import { createHash } from "node:crypto";
import { specsFromSize } from "./vm-size.js";
import { buildSpecializedVm } from "../loja/image.js";

export function vmOptionValue(resourceId) {
  return createHash("sha256").update(String(resourceId)).digest("hex").slice(0, 32);
}

export function parseVmResourceId(value) {
  const match = /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/Microsoft\.Compute\/virtualMachines\/([^/]+)$/i.exec(String(value ?? "").trim());
  if (!match) return null;
  return { subscriptionId: match[1], resourceGroup: match[2], name: match[3] };
}

export function withTimeout(work, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "timeout" })), ms);
    Promise.resolve().then(work).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function classifyAzure(error) {
  const blob = `${error?.code || ""} ${error?.statusCode || ""} ${error?.message || ""}`;
  if (/ResourceGroupNotFound|ResourceNotFound/i.test(blob)) return "missing";
  if (/AuthorizationFailed/i.test(blob) || error?.statusCode === 403) return "forbidden";
  if (error?.code === "timeout") return "timeout";
  return "failed";
}

function failureCode(error) {
  return classifyAzure(error);
}

export const MISSING_VM = "A máquina deste cliente não foi encontrada na assinatura atual. Use /editar-cliente para atualizar.";
const MISSING_WAIT = 15 * 60 * 1000;

function powerFromView(view) {
  const code = (view?.statuses ?? []).find((status) => String(status.code ?? "").startsWith("PowerState/"))?.code ?? "";
  if (code.endsWith("running") || code.endsWith("starting")) return "ligada";
  if (code.endsWith("deallocated") || code.endsWith("deallocating") || code.endsWith("stopped") || code.endsWith("stopping")) return "desligada";
  return "desconhecida";
}

async function collectVms(source) {
  const rows = [];
  for await (const item of source) rows.push(item);
  return rows;
}

function summarizeVm(vm, power) {
  const parsed = parseVmResourceId(vm.id);
  if (!vm?.id || !vm?.name || !parsed) return null;
  return {
    name: vm.name,
    resourceGroup: parsed.resourceGroup,
    location: vm.location ?? "",
    size: vm.hardwareProfile?.vmSize ?? "",
    id: vm.id,
    power: power ?? null,
    tags: vm.tags || {},
  };
}

function parseProviderId(value, provider) {
  const match = new RegExp(`^/subscriptions/([^/]+)/resourceGroups/([^/]+)/providers/${provider}/([^/]+)$`, "i").exec(String(value ?? "").trim());
  if (!match) return null;
  return { resourceGroup: match[2], name: match[3] };
}

function diskName(vmName) {
  const base = String(vmName).replace(/[^A-Za-z0-9]/g, "").slice(0, 40) || "vm";
  return `os${base}${Date.now()}`.slice(0, 80);
}

function logAzure(prefix, error) {
  const name = error?.name ?? "Error";
  const message = error instanceof Error ? error.message : String(error ?? "erro");
  const code = error?.code;
  console.error(`${prefix}: ${name}${code === undefined ? "" : ` [${code}]`}: ${message}`);
  if (error?.rawError) console.error(JSON.stringify(error.rawError));
}

export function createInfrastructure(config, deps = {}) {
  const readMs = deps.readTimeoutMs ?? 20_000;
  const writeMs = deps.writeTimeoutMs ?? 90_000;
  const cacheMs = deps.vmCacheMs ?? 60_000;
  const statusMs = deps.statusTimeoutMs ?? 8_000;
  const clock = deps.now ?? (() => Date.now());
  let credential;
  let computeClient;
  let networkClient;
  let vmCache = null;
  const machineCache = new Map();
  const missingUntil = new Map();
  const missingLogged = new Set();

  function remembered(infraId) {
    const until = missingUntil.get(infraId);
    if (until && clock() < until) return { mode: "missing", reason: "missing" };
    return null;
  }

  function rememberMissing(infraId, error) {
    missingUntil.set(infraId, clock() + MISSING_WAIT);
    if (missingLogged.has(infraId)) return;
    missingLogged.add(infraId);
    const code = error?.code || classifyAzure(error);
    console.warn(`Azure: ${code} em ${infraId}. Nova consulta só depois do intervalo.`);
  }

  async function tokenCredential() {
    if (deps.credential) return deps.credential;
    if (!credential) {
      const identity = await import("@azure/identity");
      credential = new identity.ClientSecretCredential(config.azure.tenantId, config.azure.clientId, config.azure.clientSecret);
    }
    return credential;
  }

  async function compute() {
    if (deps.compute) return deps.compute;
    if (!computeClient) {
      const arm = await import("@azure/arm-compute");
      computeClient = new arm.ComputeManagementClient(await tokenCredential(), config.azure.subscriptionId);
    }
    return computeClient;
  }

  async function network() {
    if (deps.network) return deps.network;
    if (!networkClient) {
      const arm = await import("@azure/arm-network");
      networkClient = new arm.NetworkManagementClient(await tokenCredential(), config.azure.subscriptionId);
    }
    return networkClient;
  }

  async function publicIpOf(vm) {
    const nicRef = vm.networkProfile?.networkInterfaces?.[0]?.id;
    const nicId = parseProviderId(nicRef, "Microsoft\\.Network/networkInterfaces");
    if (!nicId) return "";
    const nic = await (await network()).networkInterfaces.get(nicId.resourceGroup, nicId.name);
    const pipRef = nic.ipConfigurations?.find((item) => item.publicIPAddress?.id)?.publicIPAddress?.id;
    const pipId = parseProviderId(pipRef, "Microsoft\\.Network/publicIPAddresses");
    if (!pipId) return "";
    const pip = await (await network()).publicIPAddresses.get(pipId.resourceGroup, pipId.name);
    return pip.ipAddress || "";
  }

  function manual(reason) {
    return { mode: "manual", status: null, reason };
  }

  async function azureCall(infraId, ms, work, scrub = (text) => text) {
    if (!config.azure.configured) return manual("unconfigured");
    const target = parseVmResourceId(infraId);
    if (!target) return manual("infra");
    try {
      const client = await compute();
      return await withTimeout(() => work(client, target), ms);
    } catch (error) {
      const code = failureCode(error);
      if (code === "missing" || code === "forbidden") {
        rememberMissing(infraId, error);
        return { mode: "missing", reason: code };
      }
      const line = scrub(String(error?.message || "erro").split("\n")[0]).slice(0, 240);
      console.error(`Azure: ${code} em ${infraId}. ${line}`);
      throw Object.assign(new Error("azure"), { code });
    }
  }

  return {
    configured: Boolean(config.azure.configured),
    async listVms() {
      if (!config.azure.configured) return [];
      if (vmCache && clock() - vmCache.at < cacheMs) return vmCache.vms;
      try {
        const client = await compute();
        const listed = await withTimeout(() => collectVms(client.virtualMachines.listAll()), readMs);
        const powerById = new Map();
        try {
          const states = await withTimeout(() => collectVms(client.virtualMachines.listAll({ statusOnly: "true" })), statusMs);
          for (const vm of states) {
            if (vm?.id) powerById.set(vm.id, powerFromView(vm.instanceView));
          }
        } catch (error) {
          logAzure("Estado das VMs não consultado", error);
        }
        const vms = listed.map((vm) => summarizeVm(vm, powerById.get(vm.id))).filter(Boolean);
        vms.sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
        vmCache = { at: clock(), vms };
        return vms;
      } catch (error) {
        const code = failureCode(error);
        console.warn(`Lista de VMs: ${code}. ${String(error?.message || "").split("\n")[0].slice(0, 180)}`);
        throw Object.assign(new Error(code === "missing" ? MISSING_VM : "azure"), { code });
      }
    },
    async readMachine(infraId) {
      if (!config.azure.configured) return null;
      const target = parseVmResourceId(infraId);
      if (!target) return null;
      if (remembered(infraId)) return { missing: true };
      const cached = machineCache.get(infraId);
      if (cached && clock() - cached.at < cacheMs) return cached.value;
      const client = await compute();
      let vm;
      try {
        vm = await withTimeout(() => client.virtualMachines.get(target.resourceGroup, target.name), readMs);
      } catch (error) {
        if (classifyAzure(error) === "missing" || classifyAzure(error) === "forbidden") {
          rememberMissing(infraId, error);
          return { missing: true };
        }
        throw error;
      }
      let power = null;
      try {
        const view = await withTimeout(() => client.virtualMachines.instanceView(target.resourceGroup, target.name), readMs);
        power = powerFromView(view);
      } catch (error) {
        logAzure("Estado da VM não consultado", error);
      }
      let publicIp = "";
      try {
        publicIp = await withTimeout(() => publicIpOf(vm), readMs);
      } catch (error) {
        logAzure("IP público não consultado", error);
      }
      const specs = specsFromSize(vm.hardwareProfile?.vmSize);
      const value = { power, publicIp, gpu: specs.gpu, vcpus: specs.vcpus, ram: specs.ram, size: specs.size };
      machineCache.set(infraId, { at: clock(), value });
      return value;
    },
    async readPower(infraId) {
      const skipped = remembered(infraId);
      if (skipped) return skipped;
      const result = await azureCall(infraId, readMs, async (client, target) => {
        const view = await client.virtualMachines.instanceView(target.resourceGroup, target.name);
        return { mode: "azure", status: powerFromView(view) };
      });
      return result;
    },
    async setPower(infraId, desired) {
      const skipped = remembered(infraId);
      if (skipped) return skipped;
      return azureCall(infraId, writeMs, async (client, target) => {
        if (desired === "ligada") await client.virtualMachines.beginStartAndWait(target.resourceGroup, target.name);
        else await client.virtualMachines.beginDeallocateAndWait(target.resourceGroup, target.name);
        return { mode: "azure", status: desired === "ligada" ? "ligada" : "desligada" };
      });
    },
    async format(infraId, image = null) {
      const skipped = remembered(infraId);
      if (skipped) return skipped;
      if (!config.azure.configured) return manual("unconfigured");
      const chosen = image?.kind === "snapshot" && image.id
        ? image
        : { kind: "gallery", id: image?.id || config.azure.imageId };
      if (chosen.kind === "snapshot") {
        return azureCall(infraId, writeMs, async (client, target) => {
          await client.virtualMachines.beginDeallocateAndWait(target.resourceGroup, target.name);
          const vm = await client.virtualMachines.get(target.resourceGroup, target.name);
          const name = diskName(target.name);
          const disk = await client.disks.beginCreateOrUpdateAndWait(target.resourceGroup, name, {
            location: vm.location,
            sku: { name: vm.storageProfile?.osDisk?.managedDisk?.storageAccountType || "StandardSSD_LRS" },
            creationData: { createOption: "Copy", sourceResourceId: chosen.id },
          });
          const next = {
            ...vm,
            storageProfile: {
              ...vm.storageProfile,
              osDisk: {
                ...vm.storageProfile?.osDisk,
                name,
                createOption: "Attach",
                managedDisk: { id: disk.id, storageAccountType: vm.storageProfile?.osDisk?.managedDisk?.storageAccountType },
              },
            },
          };
          delete next.osProfile;
          delete next.provisioningState;
          await client.virtualMachines.beginCreateOrUpdateAndWait(target.resourceGroup, target.name, next);
          return { mode: "azure", status: "desligada" };
        });
      }
      return azureCall(infraId, writeMs, async (client, target) => {
        await client.virtualMachines.beginDeallocateAndWait(target.resourceGroup, target.name);
        const vm = await client.virtualMachines.get(target.resourceGroup, target.name);
        const nicId = vm.networkProfile?.networkInterfaces?.[0]?.id;
        const next = {
          ...vm,
          ...buildSpecializedVm({
            location: vm.location,
            size: vm.hardwareProfile?.vmSize || config.azure.vmSize,
            nicId,
            imageId: chosen.id,
            diskGb: vm.storageProfile?.osDisk?.diskSizeGB || config.azure.maxOsDiskGb,
            diskType: vm.storageProfile?.osDisk?.managedDisk?.storageAccountType || "Premium_LRS",
            spot: vm.priority === "Spot",
            diskName: diskName(target.name),
          }),
        };
        delete next.osProfile;
        delete next.provisioningState;
        await client.virtualMachines.beginCreateOrUpdateAndWait(target.resourceGroup, target.name, next);
        return { mode: "azure", status: "desligada" };
      });
    },
    async resetWindowsPassword(infraId, { username = "", password = "" } = {}) {
      const scrub = (text) => (password ? String(text).split(password).join("[omitido]") : String(text));
      return azureCall(infraId, writeMs, async (client, target) => {
        const view = await client.virtualMachines.instanceView(target.resourceGroup, target.name);
        const code = (view?.statuses ?? []).find((status) => String(status.code ?? "").startsWith("PowerState/"))?.code ?? "";
        if (!code.endsWith("running")) return { mode: "azure", code: "off" };
        const vm = await client.virtualMachines.get(target.resourceGroup, target.name);
        if (vm.osProfile?.linuxConfiguration) return { mode: "azure", code: "linux" };
        const account = String(vm.osProfile?.adminUsername || username || "").trim();
        if (!account) return { mode: "azure", code: "nouser" };
        let current = null;
        try {
          current = await client.virtualMachineExtensions.get(target.resourceGroup, target.name, "enablevmaccess");
        } catch (error) {
          if (error?.statusCode !== 404) throw error;
        }
        if (/creating|updating|deleting/i.test(String(current?.provisioningState || ""))) return { mode: "azure", code: "busy" };
        try {
          await client.virtualMachineExtensions.beginCreateOrUpdateAndWait(target.resourceGroup, target.name, "enablevmaccess", {
            location: vm.location,
            publisher: "Microsoft.Compute",
            typePropertiesType: "VMAccessAgent",
            typeHandlerVersion: "2.4",
            autoUpgradeMinorVersion: true,
            forceUpdateTag: String(Date.now()),
            settings: { UserName: account },
            protectedSettings: { Password: password },
          });
        } catch (error) {
          const blob = `${error?.code || ""} ${error?.statusCode || ""} ${error?.message || ""}`;
          if (error?.statusCode === 409 || /conflict|in progress|already/i.test(blob)) return { mode: "azure", code: "busy" };
          throw error;
        }
        return { mode: "azure", code: "ok" };
      }, scrub);
    },
    async tagOwner(infraId, userId) {
      if (!userId) return { mode: "manual", reason: "owner" };
      return azureCall(infraId, writeMs, async (client, target) => {
        const vm = await client.virtualMachines.get(target.resourceGroup, target.name);
        const tags = { ...(vm.tags || {}), "ignix-owner": String(userId) };
        await client.virtualMachines.beginUpdateAndWait(target.resourceGroup, target.name, { tags });
        return { mode: "azure" };
      });
    },
    async tagReseller(infraId, resellerId) {
      return azureCall(infraId, writeMs, async (client, target) => {
        const vm = await client.virtualMachines.get(target.resourceGroup, target.name);
        const tags = { ...(vm.tags || {}) };
        if (resellerId) tags["ignix-reseller"] = String(resellerId);
        else delete tags["ignix-reseller"];
        await client.virtualMachines.beginUpdateAndWait(target.resourceGroup, target.name, { tags });
        return { mode: "azure" };
      });
    },
    async restart(infraId) {
      const skipped = remembered(infraId);
      if (skipped) return skipped;
      return azureCall(infraId, writeMs, async (client, target) => {
        await client.virtualMachines.beginRestartAndWait(target.resourceGroup, target.name);
        return { mode: "azure", status: "ligada" };
      });
    },
    async adminUsername(infraId) {
      const result = await azureCall(infraId, readMs, async (client, target) => {
        const vm = await client.virtualMachines.get(target.resourceGroup, target.name);
        return String(vm.osProfile?.adminUsername || "");
      });
      return typeof result === "string" ? result : "";
    },
  };
}

export function providerNotice(result, action) {
  if (result.mode === "missing" || result.reason === "missing") return MISSING_VM;
  if (result.mode === "azure") {
    if (action === "format") return "O disco do sistema foi recriado a partir da imagem. A VM ficou desligada.";
    return result.status === "ligada" ? "A VM está ligada." : "A VM está desligada.";
  }
  if (result.reason === "snapshot") return "O snapshot não está configurado. O disco não foi alterado e a equipe foi avisada.";
  if (result.reason === "infra") return "Esta máquina não tem um resource ID válido. Nada foi alterado na Azure e a equipe foi avisada.";
  return "A Azure não está configurada. Nada foi alterado na nuvem e a equipe foi avisada.";
}

export function providerError(error) {
  if (error?.code === "missing") return MISSING_VM;
  if (error?.code === "timeout") return "A Azure não respondeu a tempo. Nada foi concluído. Use Atualizar para consultar de novo.";
  if (error?.code === "forbidden") return "O aplicativo não tem permissão para operar esta VM. Nada foi concluído.";
  return "A Azure recusou a operação. Nada foi concluído.";
}
