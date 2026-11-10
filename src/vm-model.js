const VM_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9])?$/;
const RESOURCE_GROUP = /^[\w().-]{1,90}$/;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export const MOONLIGHT_PORT = 47989;
export const MAX_DISK_GB = 2048;
export const POWER_COOLDOWN_MS = 20_000;
export const AUTO_START_MAX_TRIES = 6;
export const AUTO_START_WINDOW_MS = 30 * 60_000;

export const VM_ACTIONS = new Set([
  "upsert_vm",
  "delete_vm",
  "link_vm",
  "unlink_vm",
  "set_vm_secret",
  "set_vm_validity",
  "set_vm_policy",
  "approve_disk",
  "set_vm_log",
  "request_disk",
]);

export function normalizePower(code) {
  const text = String(code ?? "").toLowerCase();
  if (text.includes("deallocat")) return text.includes("ing") && !text.endsWith("deallocated") ? "deallocating" : "deallocated";
  if (text.endsWith("/running") || text === "running") return "running";
  if (text.includes("starting")) return "starting";
  if (text.includes("stopping")) return "stopping";
  if (text.endsWith("/stopped") || text === "stopped") return "stopped";
  return "unknown";
}

export function powerLabel(power) {
  switch (power) {
    case "running":
      return "🟢 Ligada";
    case "starting":
      return "🟡 Ligando";
    case "stopping":
      return "🟠 Desligando";
    case "deallocating":
      return "🟠 Desalocando";
    case "stopped":
      return "🔴 Parada";
    case "deallocated":
      return "⚫ Desligada";
    default:
      return "⚪ Estado desconhecido";
  }
}

export function isCapacityError(error) {
  const text = `${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return /allocationfailed|skunotavailable|capacity|operationnotallowed|zonenotavailable/.test(text);
}

export function evictionOf({ desired, observed, statuses = [] }) {
  const hinted = statuses.some((status) => /evict|preempt|spot/i.test(`${status?.code ?? ""} ${status?.displayStatus ?? ""}`));
  if (desired === "stopped") return false;
  if (observed !== "deallocated") return false;
  return desired === "running" || hinted;
}

export function backoffMs(attempt) {
  const step = Math.max(1, attempt);
  return Math.min(15 * 60_000, 60_000 * 2 ** (step - 1));
}

export function isPublicIpv4(value) {
  if (!IPV4.test(value ?? "")) return false;
  const parts = value.split(".").map(Number);
  if (parts.some((part) => part > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  return true;
}

export function validateVmIdentity({ displayName, resourceGroup, vmName }) {
  const name = String(displayName ?? "").trim();
  const group = String(resourceGroup ?? "").trim();
  const vm = String(vmName ?? "").trim();
  if (!name || name.length > 40 || /@everyone|@here|<@/.test(name)) return { ok: false, code: "vm_invalid" };
  if (!RESOURCE_GROUP.test(group) || !VM_NAME.test(vm)) return { ok: false, code: "vm_invalid" };
  return { ok: true, displayName: name, resourceGroup: group, vmName: vm };
}

export function validateDiskIncrease(current, requested, maxGb = MAX_DISK_GB) {
  const limit = Number.isInteger(maxGb) && maxGb >= 1 ? maxGb : MAX_DISK_GB;
  const next = Number(requested);
  if (!Number.isInteger(next) || next < 1 || next > limit) return { ok: false, code: "disk_invalid", maxDisk: limit };
  if (current != null && next <= current) return { ok: false, code: "disk_not_increase" };
  return { ok: true, requestedGb: next };
}

export function parseValidity(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, until: null };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) || /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return { ok: false, code: "validity_invalid" };
  const year = match[1].length === 4 ? Number(match[1]) : Number(match[3]);
  const month = match[1].length === 4 ? Number(match[2]) : Number(match[2]);
  const day = match[1].length === 4 ? Number(match[3]) : Number(match[1]);
  if (match[1].length === 2 && Number(match[2]) > 12) return { ok: false, code: "validity_invalid" };
  const until = Date.UTC(year, month - 1, day, 23, 59, 59);
  if (Number.isNaN(until)) return { ok: false, code: "validity_invalid" };
  return { ok: true, until };
}

export function validityText(until, now) {
  if (until == null) return "Validade não cadastrada";
  const expired = until < now;
  const date = new Date(until).toISOString().slice(0, 10);
  return expired ? `Vencida em ${date}` : `Válida até ${date}`;
}

export function expired(vm, now) {
  return Boolean(vm?.block_when_expired && vm.validity_until != null && vm.validity_until < now);
}
