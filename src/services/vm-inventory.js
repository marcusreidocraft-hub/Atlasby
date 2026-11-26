import { PLAN_LABEL, formatDate } from "./plans.js";
import { specsFromSize } from "./vm-size.js";
import { assignmentFor } from "../reseller/match.js";
import { normalizeVmId, resolveOwner, vmNameKey, vmParts } from "./vm-link.js";

export const VM_FILTERS = Object.freeze([
  ["todas", "Todas"],
  ["ligadas", "Ligadas"],
  ["livres", "Livres"],
  ["cliente", "Com cliente"],
  ["repetidas", "Repetidas"],
]);

export const VM_PAGE_SIZE = 4;

function sameVm(client, vm) {
  const parts = vmParts(client?.infraId);
  const id = normalizeVmId(vm?.id);
  const key = vmNameKey(vm?.name, vm?.resourceGroup);
  return Boolean((id && parts?.id === id) || (key && parts?.key === key && key !== "/"));
}

function ipFor(vm, clients, ips) {
  const cloud = ips?.get?.(normalizeVmId(vm?.id)) || "";
  if (cloud) return cloud;
  const linked = clients.find((client) => sameVm(client, vm) && client.publicIp);
  return linked?.publicIp || "";
}

function resellerName(vm, assignments, names) {
  const row = assignmentFor(vm, assignments);
  if (row) return names.get(row.resellerId) || "revendedor";
  const tag = vm?.tags?.["ignix-reseller"];
  if (tag) return names.get(tag) || "revendedor";
  return "";
}

export function buildInventory({ vms = [], clients = [], ips = new Map(), assignments = [], resellerNames = new Map() } = {}) {
  const rows = vms.map((vm) => {
    const ip = ipFor(vm, clients, ips);
    const seen = new Set();
    const owners = [];
    for (const client of clients) {
      if (!client?.id || seen.has(client.id)) continue;
      const byIp = Boolean(ip && client.publicIp && client.publicIp === ip);
      if (!sameVm(client, vm) && !byIp) continue;
      seen.add(client.id);
      owners.push(client);
    }
    const tagged = resolveOwner(vm, clients);
    if (tagged?.id && !seen.has(tagged.id)) {
      seen.add(tagged.id);
      owners.push(tagged);
    } else if (tagged?.userId && !tagged.id && !owners.some((client) => client.userId === tagged.userId)) {
      owners.push({ id: "", userId: tagged.userId, clientName: tagged.clientName || "", infraId: "", publicIp: "" });
    }
    const reseller = resellerName(vm, assignments, resellerNames);
    const specs = specsFromSize(vm.size);
    const repeated = owners.length >= 2;
    let kind = "free";
    if (repeated) kind = "repeated";
    else if (owners.length === 1) kind = "client";
    else if (reseller) kind = "reseller";
    return {
      id: vm.id,
      name: vm.name,
      resourceGroup: vm.resourceGroup || "",
      power: vm.power || "desconhecida",
      ip,
      size: vm.size || "",
      vcpus: specs.vcpus || 0,
      owners,
      resellerName: reseller,
      repeated,
      kind,
    };
  });
  const totals = {
    total: rows.length,
    on: rows.filter((row) => row.power === "ligada").length,
    off: rows.filter((row) => row.power === "desligada").length,
    clients: rows.filter((row) => row.owners.length > 0).length,
    free: rows.filter((row) => row.kind === "free").length,
    resellers: rows.filter((row) => row.kind === "reseller").length,
    repeated: rows.filter((row) => row.repeated).length,
  };
  return { rows, totals };
}

export function filterInventory(rows, filter) {
  if (filter === "ligadas") return rows.filter((row) => row.power === "ligada");
  if (filter === "livres") return rows.filter((row) => row.kind === "free");
  if (filter === "cliente") return rows.filter((row) => row.owners.length > 0);
  if (filter === "repetidas") return rows.filter((row) => row.repeated);
  return rows;
}

function powerLabel(power) {
  if (power === "ligada") return "🟢 ligada";
  if (power === "desligada") return "⚫ desligada";
  return "⚪ desconhecida";
}

export function ownerLabel(row) {
  if (row.repeated) {
    const people = row.owners.map((client) => `<@${client.userId}> ${client.clientName}`).join(" · ");
    return `⚠️ Repetida · ${people}`;
  }
  if (row.owners.length === 1) {
    const client = row.owners[0];
    const plan = PLAN_LABEL[client.planType] || "";
    const when = client.expiresAt ? `vence ${formatDate(client.expiresAt)}` : "";
    const extra = row.resellerName ? `também Revendedor ${row.resellerName}` : "";
    return [`<@${client.userId}>`, client.clientName, plan, when, extra].filter(Boolean).join(" · ");
  }
  if (row.resellerName) return `Revendedor ${row.resellerName}`;
  return "Livre";
}

export function vmLine(row) {
  const cores = row.vcpus ? `${row.vcpus} vCPU` : "";
  const size = [row.size || "tamanho não informado", cores].filter(Boolean).join(" · ");
  return `**${row.name}** · ${powerLabel(row.power)} · ${row.ip || "sem IP"} · ${size} · ${ownerLabel(row)}`;
}
