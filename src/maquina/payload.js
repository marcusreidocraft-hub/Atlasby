import { randomBytes } from "node:crypto";
import { buildDataDisk, buildSpecializedVm } from "../loja/image.js";
import { resourceNames } from "../loja/provision.js";
import { specsFromSize } from "../services/vm-size.js";

export const MACHINE_SIZES = Object.freeze([
  Object.freeze({ id: "t4-4", label: "T4 4 vCPUs", size: "Standard_NC4as_T4_v3" }),
  Object.freeze({ id: "t4-8", label: "T4 8 vCPUs", size: "Standard_NC8as_T4_v3" }),
  Object.freeze({ id: "t4-16", label: "T4 16 vCPUs", size: "Standard_NC16as_T4_v3" }),
]);

export function sizeById(id) {
  return MACHINE_SIZES.find((item) => item.id === id) || null;
}

export function defaultMachineName(username) {
  const user = String(username ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "").slice(0, 4) || "user";
  return `ignix-${user}-${randomBytes(2).toString("hex")}`.slice(0, 15);
}

export function validMachineName(value) {
  return /^[a-z][a-z0-9-]{0,13}[a-z0-9]$/.test(String(value ?? "")) || /^[a-z]$/.test(String(value ?? ""));
}

export function machineNames(seed, machineName) {
  const names = resourceNames(seed);
  const short = names.vm.replace(/^atlas/, "").slice(0, 6) || "vm";
  return { ...names, vm: machineName, data: `atlas-dd-${short}`.slice(0, 20), nsg: `atlas-nsg-${short}`.slice(0, 24) };
}

export function buildMachinePayload(input) {
  const chosen = sizeById(input.sizeId);
  if (!chosen) return null;
  const specs = specsFromSize(chosen.size);
  const disk = input.diskMode === "v2"
    ? buildDataDisk({ location: input.location, zone: input.zone, gb: input.dataGb, iops: input.iops, throughput: input.throughput })
    : null;
  const dataDisks = input.dataDiskId
    ? [{ lun: 0, name: input.dataName, createOption: "Attach", managedDisk: { id: input.dataDiskId, storageAccountType: "PremiumV2_LRS" } }]
    : [];
  const vm = buildSpecializedVm({
    location: input.location,
    size: chosen.size,
    nicId: input.nicId,
    imageId: input.imageId,
    diskGb: input.osGb,
    diskType: "Premium_LRS",
    spot: Boolean(input.spot),
    diskName: input.osName,
    zone: input.diskMode === "v2" ? input.zone : "",
    dataDisks,
  });
  return { specs, size: chosen.size, disk, vm };
}
