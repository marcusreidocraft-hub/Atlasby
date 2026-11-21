import { randomUUID } from "node:crypto";
import { expiryFrom, startOfToday } from "../services/plans.js";
import { azureErrorText } from "./limits.js";
import { machineNames } from "./payload.js";
import { normalizeVmId } from "../services/vm-link.js";

const ORDER = ["rede", "nic", "disco", "vm", "ligando", "pronto"];

export function progressMark(step) {
  const index = ORDER.indexOf(step);
  const filled = step === "pronto" ? 10 : Math.max(1, Math.round((Math.max(index, 0) / (ORDER.length - 1)) * 10));
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)}`;
}

export async function createMachine(spec, provisioner, hooks = {}) {
  const names = machineNames(spec.seed || randomUUID(), spec.machineName);
  const state = {
    ...spec,
    names,
    size: spec.vmSize,
    disk: "Premium_LRS",
    diskGb: spec.osGb,
    zone: spec.diskMode === "v2" ? spec.zone : "",
    imageKind: "gallery",
  };
  const touched = { group: state.group, names, zone: state.zone };
  let step = "inicio";
  const report = async (name) => {
    step = name;
    await hooks.progress?.(name, progressMark(name));
  };
  try {
    const quota = await provisioner.quota(state);
    if (!quota?.ok) return { ok: false, error: quota?.error || "A cota desta família acabou.", cleanupFailed: null };
    await report("rede");
    state.ipId = await provisioner.ip(state);
    touched.ipId = state.ipId;
    if (spec.nsgMode === "criar") {
      state.nsgId = await provisioner.nsg(state);
      touched.nsgCreated = true;
    }
    await report("nic");
    state.nicId = await provisioner.nic(state);
    touched.nicId = state.nicId;
    await report("disco");
    if (spec.diskMode === "v2") {
      state.dataDiskId = await provisioner.disk(state);
      touched.dataDiskId = state.dataDiskId;
    }
    await report("vm");
    touched.vmCreated = true;
    state.vmId = await provisioner.vm({ ...state, dataDiskId: state.dataDiskId });
    await report("ligando");
    await provisioner.start(state);
    state.publicIp = await provisioner.readIp(state);
    await report("pronto");
    return { ok: true, state };
  } catch (error) {
    const code = error?.code || "erro";
    const message = String(error?.message || error || "").split("\n")[0].slice(0, 240);
    console.error(`Criar máquina [${step}] ${code}: ${message}`);
    const cleanupFailed = provisioner.cleanup ? await provisioner.cleanup(touched).catch(() => ["limpeza"]) : [];
    return { ok: false, error: azureErrorText(error), cleanupFailed, step, code, message };
  }
}

export function clientRow({ guildId, userId, clientName, machineName, specs, publicIp, infraId, now }) {
  const startedAt = startOfToday(now);
  return {
    id: randomUUID(),
    guildId,
    userId,
    clientName: String(clientName || "Cliente").slice(0, 48),
    machineName,
    gpu: specs.gpu,
    vcpus: specs.vcpus,
    ram: specs.ram,
    publicIp: publicIp || null,
    rdpUser: null,
    rdpPasswordCipher: null,
    pinCipher: null,
    planType: "mensal",
    startedAt,
    expiresAt: expiryFrom(startedAt, "mensal"),
    infraId: normalizeVmId(infraId),
    powerStatus: "ligada",
    now,
  };
}
