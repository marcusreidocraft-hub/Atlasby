import { ActionRowBuilder, ChannelType, ContainerBuilder, PermissionFlagsBits, UserSelectMenuBuilder } from "discord.js";
import { notice, V2, V2_EPHEMERAL } from "../panels/ui.js";
import { ack, present } from "../components/reply.js";
import { attendanceOf, canAttend, ticketOverwrites } from "../loja/attendance.js";
import { parseMoney } from "../loja/products.js";
import { ticketChannelName, ticketCategory } from "./catalog.js";
import { announceTicket } from "./countdown.js";
import { chargeFiles, renderChargePanel } from "../loja/charge-panel.js";
import { closeTicketModal, paymentModal, renderTicketCreated, renderTicketDenied, renderTicketDesk, renderTicketWelcome, ticketModal } from "./panel.js";
import { ticketUrl } from "./purchase.js";

function actorOf(interaction) {
  const member = interaction.member;
  return {
    id: interaction.user.id,
    permissions: member?.permissions?.bitfield ?? member?.permissions ?? 0n,
    roleIds: member?.roles?.cache ? [...member.roles.cache.keys()] : [],
    owner: interaction.guild?.ownerId === interaction.user.id,
  };
}

function settingsOf(app, guildId) {
  return app.repo.getSettings(guildId);
}

export async function routeTicket(interaction, app) {
  const id = interaction.customId ?? "";
  const command = interaction.commandName;
  if (command === "atendimento-publicar") return false;
  if (!id.startsWith("atlas:ticket:") && !id.startsWith("atlas:modal:t")) return false;
  const guildId = interaction.guildId;
  const settings = settingsOf(app, guildId);
  const open = /^atlas:ticket:open:(suporte|parcerias|outros)$/.exec(id);
  if (open) {
    await interaction.showModal(ticketModal(open[1]));
    return true;
  }
  const opened = /^atlas:modal:topen:(suporte|parcerias|outros)$/.exec(id);
  if (opened) {
    await ack(interaction, false);
    const existing = app.repo.supportTicketOpen(guildId, interaction.user.id);
    if (existing?.channelId) {
      await present(interaction, renderTicketCreated(ticketUrl(guildId, existing.channelId), settings, { existing: true }));
      return true;
    }
    const reason = interaction.fields.getTextInputValue("motivo").trim().slice(0, 1000);
    const category = opened[1];
    await announceTicket(interaction, settings, () => openSupportChannel(interaction, app, { guildId, category, reason, settings }));
    return true;
  }
  const menu = /^atlas:ticket:menu:([0-9a-f-]{36})$/.exec(id);
  const member = /^atlas:ticket:user:(add|rem):([0-9a-f-]{36})$/.exec(id);
  const closed = /^atlas:modal:tclose:([0-9a-f-]{36})$/.exec(id);
  const paid = /^atlas:modal:tpay:([0-9a-f-]{36})$/.exec(id);
  if (!menu && !member && !closed && !paid) return false;
  const ticketId = menu?.[1] || member?.[2] || closed?.[1] || paid?.[1];
  const ticket = app.repo.supportTicket(ticketId);
  if (!ticket || ticket.guildId !== guildId) {
    await ack(interaction, false);
    await present(interaction, notice("Ticket não encontrado.", app.config.panelColor));
    return true;
  }
  const actor = actorOf(interaction);
  if (!canAttend(actor, app.config, attendanceOf(app.repo, app.config, guildId))) {
    await ack(interaction, false);
    await present(interaction, renderTicketDenied(settings));
    return true;
  }
  if (menu) {
    const action = interaction.values?.[0];
    if (action === "fechar") {
      await interaction.showModal(closeTicketModal(ticket.id));
      return true;
    }
    if (action === "pix") {
      if (ticket.orderId) {
        await ack(interaction, false);
        await chargeOrder(interaction, app, ticket);
        return true;
      }
      await interaction.showModal(paymentModal(ticket.id));
      return true;
    }
    if (action === "add" || action === "rem") {
      await ack(interaction, false);
      const select = new UserSelectMenuBuilder().setCustomId(`atlas:ticket:user:${action}:${ticket.id}`).setPlaceholder(action === "add" ? "Adicionar membro" : "Remover membro").setMinValues(1).setMaxValues(1);
      const root = new ContainerBuilder();
      root.addActionRowComponents(new ActionRowBuilder().addComponents(select));
      await present(interaction, { components: [root] });
      return true;
    }
    await ack(interaction, false);
    await runStaffAction(interaction, app, ticket, action);
    return true;
  }
  if (member) {
    await ack(interaction, true);
    const userId = interaction.users?.first?.()?.id || interaction.values?.[0];
    const channel = await interaction.guild.channels.fetch(ticket.channelId);
    if (member[1] === "add") {
      await channel.permissionOverwrites.edit(userId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
      await present(interaction, notice("Membro adicionado ao ticket.", app.config.panelColor));
    } else {
      await channel.permissionOverwrites.delete(userId).catch(() => {});
      await present(interaction, notice("Membro removido do ticket.", app.config.panelColor));
    }
    return true;
  }
  if (closed) {
    await ack(interaction, false);
    const reason = interaction.fields.getTextInputValue("motivo").trim();
    await transcribe(interaction, app, ticket, reason);
    if (ticket.orderId) {
      const order = app.store.order(ticket.orderId);
      if (order && order.status !== "entregue" && order.status !== "cancelado") {
        await app.store.close(guildId, interaction.user.id, ticket.orderId, reason);
      }
    }
    app.repo.patchSupportTicket(ticket.id, { status: "fechado" });
    await interaction.channel?.delete?.("Ticket encerrado").catch(() => {});
    return true;
  }
  if (paid) {
    await ack(interaction, false);
    const cents = parseMoney(interaction.fields.getTextInputValue("valor"));
    const description = interaction.fields.getTextInputValue("descricao").trim().slice(0, 80);
    if (!cents) {
      await present(interaction, notice("Informe um valor válido, como 10,00.", app.config.panelColor));
      return true;
    }
    if (!app.payments?.configured) {
      await present(interaction, notice("Defina WYZECASH_API_KEY no host. Nada foi cobrado.", app.config.panelColor));
      return true;
    }
    let charge;
    try {
      charge = await app.payments.createPayment({
        cents,
        description: description || "Ignix Cloud PC",
        idempotencyKey: `suporte-${ticket.id}-${cents}`.slice(0, 128),
      });
    } catch (error) {
      console.error(`WyzeCash: cobrança recusada (${error?.status || "erro"} ${error?.code || ""}).`.trim());
      await present(interaction, notice("Não foi possível gerar o Pix. Tente de novo em instantes.", app.config.panelColor));
      return true;
    }
    const draft = { id: "", totalCents: cents, originalCents: cents, discountCents: 0, pixCode: charge.copyPaste, status: "aguardando_pagamento", pixExpiresAt: Date.parse(charge.expiresAt) || 0 };
    const files = await chargeFiles(draft);
    const view = renderChargePanel(draft, { withQr: files.length > 0 });
    await interaction.channel.send({ components: view.components, files, flags: V2, allowedMentions: { users: [interaction.user.id] } });
    await present(interaction, notice("Cobrança publicada no ticket.", app.config.panelColor));
    return true;
  }
  return false;
}

async function openSupportChannel(interaction, app, { guildId, category, reason, settings }) {
  let ticketId = "";
  try {
    const ticket = app.repo.openSupportTicket({ guildId, userId: interaction.user.id, category, reason, now: Date.now() });
    ticketId = ticket.id;
    const desk = attendanceOf(app.repo, app.config, guildId);
    const channel = await interaction.guild.channels.create({
      name: ticketChannelName(category, interaction.user.username, ticket.number),
      type: ChannelType.GuildText,
      parent: desk.categoryId || null,
      permissionOverwrites: ticketOverwrites({
        everyoneId: interaction.guild.roles.everyone.id,
        userId: interaction.user.id,
        botId: interaction.client.user.id,
        staffRoleIds: desk.staffRoleIds,
      }),
    });
    const view = renderTicketWelcome(ticket, settings, desk.supportRoleId);
    const message = await channel.send({
      components: view.components,
      flags: V2,
      allowedMentions: { roles: desk.supportRoleId ? [desk.supportRoleId] : [], users: [interaction.user.id] },
    });
    await message.pin().catch(() => {});
    app.repo.patchSupportTicket(ticket.id, { channelId: channel.id, messageId: message.id });
    return { ok: true, url: ticketUrl(guildId, channel.id) };
  } catch (error) {
    console.error(`Ticket: ${error instanceof Error ? error.message : "erro"}`);
    if (ticketId) app.repo.patchSupportTicket(ticketId, { status: "fechado" });
    return { ok: false, error: "Não foi possível abrir o atendimento. Tente de novo em instantes." };
  }
}

async function chargeOrder(interaction, app, ticket) {
  const result = await app.store.payment(ticket.orderId);
  if (!result.ok) {
    await present(interaction, notice(result.error, app.config.panelColor));
    return;
  }
  const files = await chargeFiles(result.order);
  const view = renderChargePanel(result.order, { withQr: files.length > 0 });
  const sent = await interaction.channel.send({ components: view.components, files, flags: V2, allowedMentions: { parse: [] } });
  app.store.rememberPaymentMessage(ticket.orderId, sent.id);
  await present(interaction, notice("Cobrança publicada no ticket.", app.config.panelColor));
}

async function runStaffAction(interaction, app, ticket, action) {
  if (action === "chamar") {
    const channel = await interaction.guild.channels.fetch(ticket.channelId);
    await interaction.client.users.fetch(ticket.userId).then((user) => user.send("A equipe da Ignix Cloud PC chamou você no atendimento.")).catch(() => {});
    const ping = await channel.send({ content: `<@${ticket.userId}>`, allowedMentions: { users: [ticket.userId] } });
    setTimeout(() => ping.delete().catch(() => {}), 8000);
    await present(interaction, notice("Cliente chamado no privado e no canal.", app.config.panelColor));
    return;
  }
  if (action === "voz") {
    if (ticket.voiceId) {
      await present(interaction, notice("Este ticket já tem um canal de voz.", app.config.panelColor));
      return;
    }
    const desk = attendanceOf(app.repo, app.config, interaction.guildId);
    const voice = await interaction.guild.channels.create({
      name: `voz-${ticket.category}-${ticket.number}`,
      type: ChannelType.GuildVoice,
      parent: desk.categoryId || null,
      permissionOverwrites: ticketOverwrites({
        everyoneId: interaction.guild.roles.everyone.id,
        userId: ticket.userId,
        botId: interaction.client.user.id,
        staffRoleIds: desk.staffRoleIds,
      }).map((item) => (item.deny ? item : { ...item, allow: [...item.allow, PermissionFlagsBits.Connect] })),
    });
    app.repo.patchSupportTicket(ticket.id, { voiceId: voice.id });
    await present(interaction, notice(`Canal de voz criado: <#${voice.id}>.`, app.config.panelColor));
    return;
  }
  if (action === "sem-voz") {
    if (!ticket.voiceId) {
      await present(interaction, notice("Não há canal de voz neste ticket.", app.config.panelColor));
      return;
    }
    const voice = await interaction.guild.channels.fetch(ticket.voiceId).catch(() => null);
    await voice?.delete?.("Sala de voz removida").catch(() => {});
    app.repo.patchSupportTicket(ticket.id, { voiceId: "" });
    await present(interaction, notice("Canal de voz removido.", app.config.panelColor));
  }
}

async function transcribe(interaction, app, ticket, reason) {
  const desk = attendanceOf(app.repo, app.config, interaction.guildId);
  if (!desk.logChannelId) return;
  let history = "";
  try {
    const fetched = await interaction.channel.messages.fetch({ limit: 30 });
    history = [...fetched.values()].reverse().map((message) => `${message.author?.username || "sistema"}: ${message.content || "[painel]"}`).join("\n").slice(0, 1500);
  } catch { /* segue só com o motivo */ }
  const channel = await interaction.client.channels.fetch(desk.logChannelId);
  const category = ticketCategory(ticket.category).title;
  await channel.send({
    components: notice([
      `Transcrição ${category} #${ticket.number}`,
      `Cliente: <@${ticket.userId}>`,
      `Motivo do ticket: ${ticket.reason.slice(0, 300)}`,
      `Encerramento: ${reason.slice(0, 180)}`,
      history,
    ].filter(Boolean).join("\n"), app.config.panelColor).components,
    flags: V2,
    allowedMentions: { parse: [] },
  });
}

export function publishDesk(settings) {
  return renderTicketDesk(settings);
}

export { ContainerBuilder };
