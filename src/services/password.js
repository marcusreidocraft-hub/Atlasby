import { isAdmin } from "./admin.js";

const FORBIDDEN = new Set([
  "password123!",
  "p@ssw0rd",
  "p@ssw0rd!",
  "p@ssw0rd123!",
  "p@ssword1",
  "p@ssword1!",
  "pa$$w0rd",
  "pa$$word",
  "password1",
  "password1!",
  "passw0rd",
  "passw0rd!",
  "welcome1",
  "welcome123!",
  "qwerty123",
  "qwerty123!",
  "abc123456",
  "admin123",
  "admin123!",
  "changeme1",
  "changeme123!",
  "iloveyou1",
]);

export function passwordKinds(value) {
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value));
  return kinds.length;
}

export function validatePassword(password, confirm, username = "") {
  const next = String(password ?? "");
  const again = String(confirm ?? "");
  if (!next || !again) return { ok: false, error: "Informe a senha nos dois campos." };
  if (next !== again) return { ok: false, error: "As senhas não coincidem." };
  if (next.length < 12 || next.length > 72) return { ok: false, error: "A senha precisa ter de 12 a 72 caracteres." };
  if (passwordKinds(next) < 3) return { ok: false, error: "Use pelo menos 3 tipos: maiúscula, minúscula, número e símbolo." };
  const account = String(username ?? "").trim();
  const folded = next.toLowerCase();
  if (account && (folded === account.toLowerCase() || (account.length >= 3 && folded.includes(account.toLowerCase())))) {
    return { ok: false, error: "A senha não pode conter o nome de usuário." };
  }
  if (FORBIDDEN.has(folded)) return { ok: false, error: "Essa senha é recusada pela Azure. Escolha outra." };
  return { ok: true };
}

export function canResetPassword(actor, client, config) {
  if (!actor?.id || !client?.userId) return false;
  if (actor.id === client.userId) return true;
  return isAdmin(actor, config);
}
