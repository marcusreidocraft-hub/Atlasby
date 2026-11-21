import { parseVmResourceId } from "./provider.js";

export function normalizeVmId(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function vmNameKey(name, group) {
  return `${String(group || "").trim().toLowerCase()}/${String(name || "").trim().toLowerCase()}`;
}

export function vmParts(id) {
  const parsed = parseVmResourceId(id);
  if (!parsed) return null;
  return {
    id: normalizeVmId(id),
    name: parsed.name.toLowerCase(),
    group: parsed.resourceGroup.toLowerCase(),
    key: vmNameKey(parsed.name, parsed.resourceGroup),
  };
}

export function resolveOwner(vm, clients) {
  const parts = vmParts(vm?.id) || { id: "", key: vmNameKey(vm?.name, vm?.resourceGroup) };
  const tag = String(vm?.tags?.["ignix-owner"] || "").trim();
  const byId = clients.find((client) => vmParts(client.infraId)?.id === parts.id && parts.id);
  if (byId) return byId;
  const byName = clients.find((client) => {
    const stored = vmParts(client.infraId);
    return stored && parts.key && stored.key === parts.key && stored.key !== "/";
  });
  if (byName) return byName;
  if (!tag) return null;
  const byTag = clients.find((client) => client.userId === tag);
  if (!byTag) return { userId: tag, clientName: "", infraId: "" };
  const stored = vmParts(byTag.infraId);
  if (!stored || stored.id === parts.id || stored.key === parts.key) return byTag;
  return null;
}

export function planVmLinkRepair(clients, vms) {
  const repairs = [];
  const claimed = new Set();
  const nextId = new Map(clients.map((client) => [client.id, normalizeVmId(client.infraId)]));
  for (const client of clients) {
    const normalized = normalizeVmId(client.infraId);
    if (client.infraId && client.infraId !== normalized) repairs.push({ id: client.id, guildId: client.guildId, infraId: normalized });
  }
  const groups = new Map();
  for (const client of clients) {
    const rows = groups.get(client.guildId) || [];
    rows.push(client);
    groups.set(client.guildId, rows);
  }
  for (const [guildId, rows] of groups) {
    for (const vm of vms) {
      const canonical = normalizeVmId(vm.id);
      if (!canonical) continue;
      const owner = resolveOwner(vm, rows.map((client) => ({ ...client, infraId: nextId.get(client.id) || "" })));
      if (!owner?.id || claimed.has(owner.id)) continue;
      if (owner.userId && vm.tags?.["ignix-owner"] && owner.userId !== vm.tags["ignix-owner"] && vmParts(owner.infraId)?.id !== canonical) continue;
      claimed.add(owner.id);
      if (nextId.get(owner.id) !== canonical) {
        const existing = repairs.find((item) => item.id === owner.id);
        if (existing) existing.infraId = canonical;
        else repairs.push({ id: owner.id, guildId, infraId: canonical });
        nextId.set(owner.id, canonical);
      }
    }
  }
  return repairs;
}

export async function repairVmLinks(repo, infra, now = Date.now()) {
  const clients = repo.listAllClients();
  let vms = [];
  if (infra?.configured && infra.listVms) {
    try { vms = await infra.listVms(); } catch { vms = []; }
  }
  const repairs = planVmLinkRepair(clients, vms);
  for (const repair of repairs) repo.setInfraId(repair.guildId, repair.id, repair.infraId, now);
  if (!infra?.tagOwner || !vms.length) return repairs;
  const fresh = repo.listAllClients();
  for (const client of fresh) {
    if (!client.infraId || !client.userId) continue;
    const vm = vms.find((item) => {
      const parts = vmParts(item.id);
      const stored = vmParts(client.infraId);
      return parts && stored && (parts.id === stored.id || parts.key === stored.key);
    });
    if (!vm || String(vm.tags?.["ignix-owner"] || "") === client.userId) continue;
    await infra.tagOwner(client.infraId, client.userId).catch(() => {});
  }
  return repairs;
}
