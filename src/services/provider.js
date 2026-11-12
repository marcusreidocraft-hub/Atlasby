import { createHash } from "node:crypto";

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

function failureCode(error) {
  if (error?.code === "timeout") return "timeout";
  const status = error?.statusCode ?? error?.status;
  if (status === 403 || error?.code === "AuthorizationFailed") return "forbidden";
  return "failed";
}

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
  };
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
  let computeClient;
  let vmCache = null;

  async function compute() {
    if (deps.compute) return deps.compute;
    if (!computeClient) {
      const identity = await import("@azure/identity");
      const arm = await import("@azure/arm-compute");
      const credential = new identity.ClientSecretCredential(config.azure.tenantId, config.azure.clientId, config.azure.clientSecret);
      computeClient = new arm.ComputeManagementClient(credential, config.azure.subscriptionId);
    }
    return computeClient;
  }

  function manual(reason) {
    return { mode: "manual", status: null, reason };
  }

  async function azureCall(infraId, ms, work) {
    if (!config.azure.configured) return manual("unconfigured");
    const target = parseVmResourceId(infraId);
    if (!target) return manual("infra");
    try {
      const client = await compute();
      return await withTimeout(() => work(client, target), ms);
    } catch (error) {
      throw Object.assign(new Error("azure"), { code: failureCode(error) });
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
        throw Object.assign(error instanceof Error ? error : new Error("azure"), { code: failureCode(error) });
      }
    },
    async readPower(infraId) {
      const result = await azureCall(infraId, readMs, async (client, target) => {
        const view = await client.virtualMachines.instanceView(target.resourceGroup, target.name);
        return { mode: "azure", status: powerFromView(view) };
      });
      return result;
    },
    async setPower(infraId, desired) {
      return azureCall(infraId, writeMs, async (client, target) => {
        if (desired === "ligada") await client.virtualMachines.beginStartAndWait(target.resourceGroup, target.name);
        else await client.virtualMachines.beginDeallocateAndWait(target.resourceGroup, target.name);
        return { mode: "azure", status: desired === "ligada" ? "ligada" : "desligada" };
      });
    },
    async format(infraId) {
      if (!config.azure.snapshotId) return manual(config.azure.configured ? "snapshot" : "unconfigured");
      return azureCall(infraId, writeMs, async (client, target) => {
        await client.virtualMachines.beginDeallocateAndWait(target.resourceGroup, target.name);
        const vm = await client.virtualMachines.get(target.resourceGroup, target.name);
        const name = diskName(target.name);
        const disk = await client.disks.beginCreateOrUpdateAndWait(target.resourceGroup, name, {
          location: vm.location,
          sku: { name: vm.storageProfile?.osDisk?.managedDisk?.storageAccountType || "StandardSSD_LRS" },
          creationData: { createOption: "Copy", sourceResourceId: config.azure.snapshotId },
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
        delete next.provisioningState;
        await client.virtualMachines.beginCreateOrUpdateAndWait(target.resourceGroup, target.name, next);
        return { mode: "azure", status: "desligada" };
      });
    },
  };
}

export function providerNotice(result, action) {
  if (result.mode === "azure") {
    if (action === "format") return "O disco do sistema foi recriado a partir do snapshot. A VM ficou desligada.";
    return result.status === "ligada" ? "A VM está ligada." : "A VM está desligada.";
  }
  if (result.reason === "snapshot") return "O snapshot não está configurado. O disco não foi alterado e a equipe foi avisada.";
  if (result.reason === "infra") return "Esta máquina não tem um resource ID válido. Nada foi alterado na Azure e a equipe foi avisada.";
  return "A Azure não está configurada. Nada foi alterado na nuvem e a equipe foi avisada.";
}

export function providerError(error) {
  if (error?.code === "timeout") return "A Azure não respondeu a tempo. Nada foi concluído. Use Atualizar para consultar de novo.";
  if (error?.code === "forbidden") return "O aplicativo não tem permissão para operar esta VM. Nada foi concluído.";
  return "A Azure recusou a operação. Nada foi concluído.";
}
