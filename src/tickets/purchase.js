import { ChannelType } from "discord.js";
import { present } from "../components/reply.js";
import { attendanceOf, ticketOverwrites } from "../loja/attendance.js";
import { formatBrl } from "../loja/products.js";
import { V2 } from "../panels/ui.js";
import { announceTicket } from "./countdown.js";
import { ticketChannelName } from "./catalog.js";
import { renderTicketCreated, renderTicketWelcome } from "./panel.js";
import { chargeFiles, renderChargePanel } from "../loja/charge-panel.js";
import { notice } from "../panels/ui.js";

const DURATION = Object.freeze({
  semanal: "7 dias",
  quinzenal: "15 dias",
  mensal: "30 dias",
  "3h": "3 horas",
  "6h": "6 horas",
});

const STATUS = Object.freeze({
  aguardando_pagamento: "Aguardando pagamento",
  pago: "Pagamento confirmado",
  provisionando: "Preparando a máquina",
  acompanhamento: "Acompanhamento",
  entregue: "Entregue",
  cancelado: "Cancelado",
  expirado: "Expirado",
});

export function orderFacts(order, product) {
  return {
    id: order.id,
    planName: product?.name || product?.headline || order.sku,
    duration: DURATION[order.plan] || order.plan,
    price: formatBrl(order.totalCents),
    offer: order.discountCents > 0 ? `oferta de ${formatBrl(order.discountCents)}` : "",
    statusLabel: STATUS[order.status] || order.status || "",
  };
}

export function ticketUrl(guildId, channelId) {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

export async function openPurchaseTicket(interaction, app, value, options = {}) {
  const guildId = interaction.guildId;
  const settings = app.repo.getSettings(guildId);
  const existing = app.repo.supportTicketOpen(guildId, interaction.user.id);
  if (existing?.channelId) {
    await present(interaction, renderTicketCreated(ticketUrl(guildId, existing.channelId), settings, { existing: true }));
    return;
  }
  await announceTicket(interaction, settings, () => createPurchase(interaction, app, value, settings), options);
}

async function postCharge(channel, app, orderId) {
  const result = await app.store.payment(orderId);
  if (!result.ok) {
    await channel.send({
      components: notice(result.error).components,
      flags: V2,
      allowedMentions: { parse: [] },
    });
    return;
  }
  const files = await chargeFiles(result.order);
  const view = renderChargePanel(result.order, { withQr: files.length > 0 });
  const sent = await channel.send({
    components: view.components,
    files,
    flags: V2,
    allowedMentions: { parse: [] },
  });
  app.store.rememberPaymentMessage(orderId, sent.id);
}

async function createPurchase(interaction, app, value, settings) {
  const guildId = interaction.guildId;
  let orderId = "";
  let ticketId = "";
  try {
    const chosen = app.store.choose(guildId, interaction.user.id, value, interaction.user.username);
    if (!chosen.ok) {
      const open = app.store.openOrder(guildId, interaction.user.id);
      if (open?.channelId) return { ok: true, url: ticketUrl(guildId, open.channelId), existing: true };
      return { ok: false, error: chosen.error };
    }
    orderId = chosen.order.id;
    const ticket = app.repo.openSupportTicket({
      guildId,
      userId: interaction.user.id,
      category: "compra",
      reason: "Pedido da loja.",
      orderId,
      now: Date.now(),
    });
    ticketId = ticket.id;
    const desk = attendanceOf(app.repo, app.config, guildId);
    const channel = await interaction.guild.channels.create({
      name: ticketChannelName("compra", interaction.user.username, ticket.number),
      type: ChannelType.GuildText,
      parent: desk.categoryId || null,
      permissionOverwrites: ticketOverwrites({
        everyoneId: interaction.guild.roles.everyone.id,
        userId: interaction.user.id,
        botId: interaction.client.user.id,
        staffRoleIds: desk.staffRoleIds,
      }),
    });
    const view = renderTicketWelcome(ticket, settings, desk.supportRoleId, orderFacts(chosen.order, chosen.product));
    const message = await channel.send({
      components: view.components,
      flags: V2,
      allowedMentions: { roles: desk.supportRoleId ? [desk.supportRoleId] : [], users: [interaction.user.id] },
    });
    await message.pin().catch(() => {});
    app.repo.patchSupportTicket(ticket.id, { channelId: channel.id, messageId: message.id });
    app.store.rememberTicket(orderId, channel.id, message.id);
    await postCharge(channel, app, orderId).catch(() => {});
    return { ok: true, url: ticketUrl(guildId, channel.id) };
  } catch (error) {
    console.error(`Ticket: ${error instanceof Error ? error.message : "erro"}`);
    if (ticketId) app.repo.patchSupportTicket(ticketId, { status: "fechado" });
    if (orderId) await app.store.close(guildId, interaction.user.id, orderId, "Falha ao abrir o canal.").catch(() => {});
    return { ok: false, error: "Não foi possível abrir o atendimento. Tente de novo em instantes." };
  }
}
