import { GPUS, PLAN_DAYS, expiryFrom, parseDate } from "./plans.js";

const VM_ID = /^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.Compute\/virtualMachines\/[^/]+$/i;
const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function fail(error) {
  return { ok: false, error };
}

function clean(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

export function validateIdentity(input) {
  const clientName = clean(input.clientName, 48);
  const machineName = clean(input.machineName, 32);
  if (clientName.length < 2) return fail("Informe o nome do cliente.");
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{1,31}$/.test(machineName)) return fail("O nome da máquina usa letras, números, espaço, hífen ou sublinhado.");
  return { ok: true, value: { clientName, machineName } };
}

export function validateSpecs(input) {
  const gpu = clean(input.gpu, 32);
  const ram = clean(input.ram, 24);
  const vcpus = Number(clean(input.vcpus, 4));
  if (!GPUS.includes(gpu)) return fail("Escolha uma GPU da lista.");
  if (!Number.isInteger(vcpus) || vcpus < 1 || vcpus > 128) return fail("Os vCPUs precisam ser um número de 1 a 128.");
  if (ram.length < 2) return fail("Informe a RAM, por exemplo 28 GB.");
  return { ok: true, value: { gpu, vcpus, ram } };
}

export function validateAccess(input) {
  const publicIp = clean(input.publicIp, 64);
  const rdpUser = clean(input.rdpUser, 32);
  const password = String(input.password ?? "");
  if (publicIp && !IPV4.test(publicIp)) return fail("O IP público precisa ser um IPv4 válido ou ficar vazio.");
  if (rdpUser && !/^[A-Za-z0-9._-]{1,32}$/.test(rdpUser)) return fail("O usuário RDP usa letras, números, ponto, hífen ou sublinhado.");
  if (password && (password.length < 4 || password.length > 128 || /\s/.test(password))) return fail("A senha RDP, se informada, tem de 4 a 128 caracteres e não leva espaço.");
  if (!PLAN_DAYS[input.plan]) return fail("Escolha um plano semanal, quinzenal ou mensal.");
  return { ok: true, value: { publicIp, rdpUser, password, plan: input.plan } };
}

export function validateSchedule(input) {
  const startedAt = parseDate(input.start);
  const typedExpiry = clean(input.expiry, 32) ? parseDate(input.expiry) : expiryFrom(startedAt ?? 0, input.plan);
  const infraId = clean(input.infraId, 400);
  if (startedAt == null) return fail("A data de início é inválida. Use DD/MM/AAAA ou AAAA-MM-DD.");
  if (typedExpiry == null) return fail("A data de vencimento é inválida.");
  if (typedExpiry <= startedAt) return fail("O vencimento precisa ser depois do início.");
  if (infraId && !VM_ID.test(infraId)) return fail("O ID da máquina precisa ser o resource ID da VM na Azure, ou ficar vazio.");
  return { ok: true, value: { startedAt, expiresAt: typedExpiry, infraId } };
}

export function phraseMatches(text, machineName) {
  const value = String(text ?? "").trim().toLocaleLowerCase("pt-BR");
  if (!value) return false;
  return value === "confirmar" || value === String(machineName ?? "").trim().toLocaleLowerCase("pt-BR");
}
