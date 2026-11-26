import assert from "node:assert/strict";
import test from "node:test";
import { canResetPassword, validatePassword } from "../src/services/password.js";

const config = { adminRoleIds: ["100000000000000061"] };
const GOOD = "Nuvem#Segura2026";

test("a senha da VM exige coincidência, tamanho, tipos, usuário e lista da Azure", () => {
  assert.equal(validatePassword(GOOD, GOOD, "atlasadmin").ok, true);
  assert.match(validatePassword(GOOD, "Outra#Senha2026", "atlasadmin").error, /não coincidem/);
  assert.match(validatePassword("Curta#1Aa", "Curta#1Aa", "atlasadmin").error, /12 a 72/);
  assert.match(validatePassword("a".repeat(73), "a".repeat(73), "atlasadmin").error, /12 a 72/);
  assert.match(validatePassword("somente letras a", "somente letras a", "atlasadmin").error, /3 tipos/);
  assert.match(validatePassword("Atlasadmin#2026", "Atlasadmin#2026", "atlasadmin").error, /nome de usuário/);
  assert.match(validatePassword("Password123!", "Password123!", "atlasadmin").error, /recusada pela Azure/);
  assert.match(validatePassword("P@ssw0rd123!", "P@ssw0rd123!", "atlasadmin").error, /recusada pela Azure/);
  assert.equal(validatePassword("SoDoisTipos12", "SoDoisTipos12", "atlasadmin").ok, true);
});

test("só o dono da VM ou a equipe altera a senha", () => {
  const client = { userId: "100000000000000002" };
  assert.equal(canResetPassword({ id: client.userId, permissions: 0n, roleIds: [] }, client, config), true);
  assert.equal(canResetPassword({ id: "100000000000000009", permissions: 8n, roleIds: [] }, client, config), true);
  assert.equal(canResetPassword({ id: "100000000000000009", permissions: 0n, roleIds: [config.adminRoleIds[0]] }, client, config), true);
  assert.equal(canResetPassword({ id: "100000000000000005", permissions: 0n, roleIds: [], owner: false }, client, config), false);
});
