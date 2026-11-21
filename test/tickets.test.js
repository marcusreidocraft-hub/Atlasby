import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MessageFlags } from "discord.js";
import { openDatabase } from "../src/db/database.js";
import { inspectModal } from "../src/panels/admin.js";
import { DEFAULT_TICKET_HOURS, ticketChannelName, ticketMark } from "../src/tickets/catalog.js";
import { announceTicket, countdownBar } from "../src/tickets/countdown.js";
import { adminSelect, renderTicketDenied, renderTicketDesk, renderTicketWelcome, ticketModal } from "../src/tickets/panel.js";
import { openPurchaseTicket, orderFacts } from "../src/tickets/purchase.js";
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
    repo.patchSupportTicket(first.id, { channelId: "canal-aberto" });
    assert.equal(repo.supportTicketOpen("g", "u").channelId, "canal-aberto");
    assert.equal(repo.supportTicketOpen("g", "outro"), null);
  } finally {
    repo.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a contagem regressiva edita a mesma resposta e termina com o link", async () => {
  assert.equal(countdownBar(5), "▰▱▱▱▱");
  assert.equal(countdownBar(3), "▰▰▰▱▱");
  assert.equal(countdownBar(1), "▰▰▰▰▰");
  const edits = [];
  const interaction = { editReply: async (body) => { edits.push(JSON.stringify(body)); } };
  await announceTicket(interaction, {}, async () => ({ ok: true, url: "https://discord.com/channels/g/c" }), { delay: 0 });
  assert.equal(edits.length, 6);
  assert.match(edits[0], /Preparando seu atendimento/);
  assert.match(edits[0], /# 5/);
  assert.match(edits[0], /▰▱▱▱▱/);
  assert.match(edits[4], /# 1/);
  assert.match(edits[5], /Ticket criado/);
  assert.match(edits[5], /https:\/\/discord.com\/channels\/g\/c/);
  edits.length = 0;
  await announceTicket(interaction, {}, async () => { throw new Error("canal"); }, { delay: 0 });
  assert.match(edits.at(-1), /Não foi possível abrir o atendimento/);
});

test("o ticket de compra usa o painel da central e bloqueia duplicado", async () => {
  const facts = orderFacts({
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    sku: "t4-4",
    plan: "semanal",
    originalCents: 2490,
    discountCents: 500,
    totalCents: 1990,
    status: "aguardando_pagamento",
  }, { name: "Tesla T4 · 4 vCPU" });
  const welcome = JSON.stringify(renderTicketWelcome({
    id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    number: 7,
    userId: "cliente",
    category: "compra",
    reason: "Pedido da loja.",
  }, {}, "staff", facts));
  assert.match(welcome, /Compra #7/);
  assert.match(welcome, /aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/);
  assert.match(welcome, /Tesla T4 · 4 vCPU/);
  assert.match(welcome, /7 dias/);
  assert.match(welcome, /R\$ 19,90/);
  assert.match(welcome, /oferta de R\$ 5,00/);
  assert.match(welcome, /atlas:ticket:menu:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/);
  assert.match(welcome, /Chamar cliente/);
  assert.match(welcome, /Adicionar membro/);
  assert.match(welcome, /Criar canal de voz/);
  assert.doesNotMatch(welcome, /Assumir atendimento/);
  assert.equal(ticketChannelName("compra", "Ana", 7), "compra-ana-7");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-compra-"));
  const repo = openDatabase(dir);
  const order = {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    sku: "t4-4",
    plan: "semanal",
    originalCents: 2490,
    discountCents: 0,
    totalCents: 2490,
    status: "aguardando_pagamento",
    userId: "cliente",
  };
  const sent = [];
  let closed = null;
  let choices = 0;
  const interaction = {
    guildId: "g",
    deferred: true,
    replied: true,
    user: { id: "cliente", username: "Ana" },
    client: { user: { id: "bot" } },
    editReply: async () => {},
    guild: {
      roles: { everyone: { id: "everyone" } },
      channels: {
        create: async (input) => ({
          id: "canal",
          name: input.name,
          send: async (body) => {
            sent.push({ name: input.name, overwrites: input.permissionOverwrites, body });
            return { id: "mensagem", pin: async () => {} };
          },
        }),
      },
    },
  };
  const app = {
    config: { panelColor: 1, adminRoleIds: ["staff"] },
    repo,
    store: {
      choose: () => {
        choices += 1;
        return { ok: true, order, product: { name: "Tesla T4 · 4 vCPU" } };
      },
      rememberTicket: (id, channelId) => { order.channelId = channelId; },
      openOrder: () => null,
      close: async (_guild, _user, id, reason) => { closed = { id, reason }; },
    },
  };
  try {
    await openPurchaseTicket(interaction, app, "t4-4:semanal", { delay: 0 });
    assert.equal(choices, 1);
    assert.equal(sent[0].name, "compra-ana-1");
    assert.equal(sent[0].overwrites[0].id, "everyone");
    assert.match(JSON.stringify(sent[0].body), /Compra #1/);
    assert.match(JSON.stringify(sent[0].body), /R\$ 24,90/);
    const ticket = repo.supportTicketByOrder(order.id);
    assert.equal(ticket.channelId, "canal");
    assert.equal(ticket.category, "compra");
    const again = [];
    await openPurchaseTicket({ ...interaction, editReply: async (body) => again.push(JSON.stringify(body)) }, app, "t4-4:semanal", { delay: 0 });
    assert.equal(choices, 1);
    assert.match(again.at(-1), /já tem um atendimento aberto/);
    assert.match(again.at(-1), /channels\/g\/canal/);

    interaction.guild.channels.create = async () => { throw new Error("sem permissão"); };
    const other = { ...interaction, user: { id: "outro", username: "Bia" }, editReply: async () => {} };
    await openPurchaseTicket(other, app, "t4-4:semanal", { delay: 0 });
    assert.equal(closed.id, order.id);
    assert.match(closed.reason, /Falha ao abrir o canal/);
    assert.equal(repo.supportTicketOpen("g", "outro"), null);
  } finally {
    repo.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
