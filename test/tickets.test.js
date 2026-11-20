import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MessageFlags } from "discord.js";
import { openDatabase } from "../src/db/database.js";
import { inspectModal } from "../src/panels/admin.js";
import { DEFAULT_TICKET_HOURS, ticketChannelName, ticketMark } from "../src/tickets/catalog.js";
import { adminSelect, renderTicketDenied, renderTicketDesk, ticketModal } from "../src/tickets/panel.js";
import { canAttend } from "../src/loja/attendance.js";

test("a central de atendimento lista as três categorias", () => {
  const view = renderTicketDesk({ ticket: {} });
  const raw = JSON.stringify(view);
  assert.equal(view.flags, MessageFlags.IsComponentsV2);
  assert.equal(view.components[0].toJSON().accent_color, undefined);
  assert.match(raw, /Central de atendimento/);
  assert.match(raw, /Escolha a categoria que melhor descreve o que você precisa/);
  assert.match(raw, /Ajuda com acesso, máquinas, sessões ou problemas técnicos/);
  assert.match(raw, /Propostas comerciais, criadores e oportunidades de parceria/);
  assert.match(raw, /Assuntos que não se encaixam nas categorias anteriores/);
  assert.match(raw, new RegExp(DEFAULT_TICKET_HOURS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal((raw.match(/"label":"Abrir"/g) || []).length, 3);
  assert.equal(inspectModal(ticketModal("suporte")).length, 0);
  assert.match(JSON.stringify(ticketModal("parcerias").toJSON()), /Como podemos ajudar/);
  assert.match(JSON.stringify(renderTicketDenied({})), /Esta ação é restrita à equipe/);
  assert.equal(ticketChannelName("suporte", "João Silva", 73), "suporte-joaosilva-73");
  assert.equal(ticketMark("suporte", { suporte: "<:tools:1>" }), "<:tools:1>");
  assert.equal(canAttend({ id: "1", owner: false, permissions: 0n, roleIds: ["staff"] }, { adminRoleIds: [] }, { supportRoleId: "staff" }), true);
  assert.equal(canAttend({ id: "2", owner: false, permissions: 0n, roleIds: [] }, { adminRoleIds: [] }, { supportRoleId: "staff" }), false);
  const actions = adminSelect("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", {}).toJSON();
  assert.deepEqual(actions.options.map((item) => item.label), ["Chamar cliente", "Fechar ticket", "Criar canal de voz", "Remover canal de voz", "Adicionar membro", "Remover membro", "Gerar pagamento"]);
  assert.equal(actions.options[0].description, "Notificar no PV e enviar um ping temporário");
  assert.equal(actions.options[6].description, "Criar uma cobrança PIX");
});

test("o número do ticket cresce no mesmo servidor", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-ticket-"));
  const repo = openDatabase(dir);
  try {
    const first = repo.openSupportTicket({ guildId: "g", userId: "u", category: "outros", reason: "Opa", now: 1 });
    const second = repo.openSupportTicket({ guildId: "g", userId: "u", category: "suporte", reason: "Outra", now: 2 });
    assert.equal(first.number, 1);
    assert.equal(second.number, 2);
    assert.equal(repo.supportTicket(first.id).status, "aberto");
  } finally {
    repo.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
