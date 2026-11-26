import { ChannelType } from "discord.js";
import { present } from "../components/reply.js";
import { attendanceOf, ticketOverwrites } from "../loja/attendance.js";
import { formatBrl } from "../loja/products.js";
import { V2 } from "../panels/ui.js";
import { announceTicket } from "./countdown.js";
import { ticketChannelName } from "./catalog.js";
import { renderTicketCreated, renderTicketWelcome } from "./panel.js";
import { chargeFiles, renderChargePanel } from "../loja/charge-panel.js";
import { renderPurchaseSummary } from "../loja/summary.js";

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

function summaryOf(order, product, user, payDisabled) {
  const facts = orderFacts(order, product);
  return renderPurchaseSummary({
    order: { ...order, duration: facts.duration },
    product,
    userId: user.id,
    userName: user.globalName || user.username || "Cliente",
    avatarUrl: user.displayAvatarURL?.({ extension: "png", size: 256 }) || "https://cdn.discordapp.com/embed/avatars/0.png",
    payDisabled,
  });
}

export async function refreshPurchaseSummary(client, app, orderId) {
  const order = app.store.order(orderId);
  if (!order?.channelId || !order.messageId) return;
  const channel = await client.channels.fetch(order.channelId).catch(() => null);
  if (!channel?.messages?.fetch) return;
  const product = app.repo.storeProduct(order.guildId, order.sku);
  let user = { id: order.userId, username: order.clientName || "Cliente" };
  try {
    user = await client.users.fetch(order.userId);
  } catch { /* segue com o nome salvo */ }
  const view = summaryOf(order, product, user, order.status !== "aguardando_pagamento" || Boolean(order.pixCode && (!order.pixExpiresAt || order.pixExpiresAt > Date.now())));
  const message = await channel.messages.fetch(order.messageId).catch(() => null);
  if (!message) return;
  await message.edit({ components: view.components, flags: V2, allowedMentions: { parse: [] } }).catch(() => {});
}

export async function showOrderCharge(interaction, app, orderId) {
  const result = await app.store.payment(orderId);
  if (!result.ok) return result;
  const order = result.order;
  const channel = interaction.channel?.send
    ? interaction.channel
    : await interaction.client.channels.fetch(order.channelId);
  const files = await chargeFiles(order);
  const view = renderChargePanel(order, { withQr: files.length > 0 });
  if (order.paymentMessageId) {
    const message = await channel.messages.fetch(order.paymentMessageId);
    await message.edit({ components: view.components, files, flags: V2, allowedMentions: { parse: [] } });
  } else {
    const sent = await channel.send({ components: view.components, files, flags: V2, allowedMentions: { parse: [] } });
    app.store.rememberPaymentMessage(orderId, sent.id);
  }
  if (order.messageId) {
    const product = app.repo.storeProduct(order.guildId, order.sku);
    let user = interaction.user;
    if (user?.id !== order.userId) {
      try { user = await interaction.client.users.fetch(order.userId); } catch { user = { id: order.userId, username: order.clientName || "Cliente" }; }
    }
    const summary = summaryOf(app.store.order(orderId), product, user, true);
    const message = await channel.messages.fetch(order.messageId);
    await message.edit({ components: summary.components, flags: V2, allowedMentions: { parse: [] } }).catch(() => {});
  }
  return { ...result, order: app.store.order(orderId) };
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
    const summary = summaryOf(chosen.order, chosen.product, interaction.user, false);
    const summaryMessage = await channel.send({
      components: summary.components,
      flags: V2,
      allowedMentions: { users: [interaction.user.id] },
    });
    app.store.rememberTicket(orderId, channel.id, summaryMessage.id);
    app.repo.patchOrder(orderId, { reserveExpiresAt: Date.now() + 24 * 60 * 60 * 1000 }, Date.now());
    return { ok: true, url: ticketUrl(guildId, channel.id) };
  } catch (error) {
    console.error(`Ticket: ${error instanceof Error ? error.message : "erro"}`);
    if (ticketId) app.repo.patchSupportTicket(ticketId, { status: "fechado" });
    if (orderId) await app.store.close(guildId, interaction.user.id, orderId, "Falha ao abrir o canal.").catch(() => {});
    return { ok: false, error: "Não foi possível abrir o atendimento. Tente de novo em instantes." };
  }
}
