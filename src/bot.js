import { Client, Events, GatewayIntentBits } from "discord.js";
import { createApp } from "./app.js";
import { fail, logInteractionError } from "./components/reply.js";
import { routeClient } from "./components/client/router.js";
import { registerCommands, routeAdminComponent, routeCommand } from "./commands/admin/router.js";
import { createInfrastructure } from "./services/provider.js";
import { routeStoreComponent, editStorePanel, routeStoreAutocomplete } from "./loja/router.js";
import { routeTicket } from "./tickets/router.js";
import { routeAnnounceComponent } from "./announce/router.js";
import { routeInviteComponent } from "./invites/router.js";
import { routeMachineComponent } from "./maquina/router.js";
import { notice, V2 } from "./panels/ui.js";
import { renderTicketWelcome } from "./tickets/panel.js";
import { orderFacts, refreshPurchaseSummary } from "./tickets/purchase.js";
import { renderChargePanel } from "./loja/charge-panel.js";
import { createStoreHttp } from "./loja/http.js";
import { machineLinks, renderMachineNotice, sendMachineNotice } from "./panels/machine-dm.js";
import { formatDate, PLAN_LABEL } from "./services/plans.js";
import { PLAN_NAMES } from "./loja/products.js";
import { attendanceOf } from "./loja/attendance.js";
import { repairVmLinks } from "./services/vm-link.js";

async function deliver(client, channelId, payload) {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased?.() || channel.isDMBased?.()) return false;
  await channel.send(payload);
  return true;
}

export async function routeInteraction(interaction, app) {
  if (!interaction.guildId || !app.config.allowedGuildIds.includes(interaction.guildId)) {
    const { notice, V2_EPHEMERAL } = await import("./panels/ui.js");
    const payload = notice("Este servidor não está autorizado.", app.config.panelColor);
    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply({ components: payload.components, flags: V2_EPHEMERAL, allowedMentions: { parse: [] } });
    }
    return;
  }
  try {
    if (interaction.isAutocomplete?.()) {
      await routeStoreAutocomplete(interaction, app);
      return;
    }
    if (interaction.isChatInputCommand?.()) {
      await routeCommand(interaction, app);
      return;
    }
    if (await routeMachineComponent(interaction, app)) return;
    if (await routeInviteComponent(interaction, app)) return;
    if (await routeAnnounceComponent(interaction, app)) return;
    if (await routeTicket(interaction, app)) return;
    if (await routeClient(interaction, app)) return;
    if (await routeStoreComponent(interaction, app)) return;
    if (await routeAdminComponent(interaction, app)) return;
  } catch (error) {
    logInteractionError(error);
    await fail(interaction, app.config.panelColor, error, app);
  }
}

async function fulfill(client, app, orderId) {
  const before = app.store.order(orderId);
  if (!before) return;
  const product = app.repo.storeProduct(before.guildId, before.sku);
  if (before.status === "pago") {
    client.users.fetch(before.userId).then((user) => user.send(app.store.paidText(before, product))).catch(() => {});
  }
  const result = await app.store.provision(orderId);
  const order = app.store.order(orderId);
  if (!order) return;
  if (order.channelId && order.paymentMessageId) {
    const charge = renderChargePanel({ ...order, status: order.status === "aguardando_pagamento" ? order.status : "pago" });
    client.channels.fetch(order.channelId).then((channel) => channel.messages.fetch(order.paymentMessageId)).then((message) => message.edit({
      components: charge.components,
      flags: V2,
      allowedMentions: { parse: [] },
    })).catch(() => {});
  }
  const ticket = app.repo.supportTicketByOrder(order.id);
  if (ticket?.channelId && ticket.messageId) {
    const settings = app.repo.getSettings(order.guildId);
    const desk = attendanceOf(app.repo, app.config, order.guildId);
    const view = renderTicketWelcome(ticket, settings, desk.supportRoleId, orderFacts(order, product));
    client.channels.fetch(ticket.channelId).then((channel) => channel.messages.fetch(ticket.messageId)).then((message) => message.edit({
      components: view.components,
      flags: V2,
      allowedMentions: { parse: [] },
    })).catch(() => {});
  }
  refreshPurchaseSummary(client, app, order.id).catch(() => {});
  if (result.delivered?.ok) {
    const owner = app.repo.getByOwner(order.guildId, order.userId);
    const ready = renderMachineNotice({
      kind: "pronta",
      accent: app.config.panelColor,
      bannerUrl: app.config.bannerUrl,
      machineName: owner?.machineName || product?.name,
      gpu: owner?.gpu || product?.gpu,
      vcpus: owner?.vcpus || product?.vcpus,
      ram: owner?.ram || product?.ram,
      diskGb: product?.diskGb,
      ip: result.state.publicIp,
      planLabel: PLAN_NAMES[order.plan] || PLAN_LABEL[order.plan] || order.plan,
      startedAt: owner?.startedAt ? formatDate(owner.startedAt) : "",
      expiresAt: owner?.expiresAt ? formatDate(owner.expiresAt) : "",
      ...machineLinks(app.repo, app.config, order.guildId),
    });
    client.users.fetch(order.userId).then((user) => sendMachineNotice(user, ready)).catch(() => {});
    if (result.delivered.roleId) {
      client.guilds.fetch(order.guildId).then((guild) => guild.members.fetch(order.userId)).then((member) => member.roles.add(result.delivered.roleId)).catch(() => {});
    }
  } else if (!result.ok) {
    const logChannelId = attendanceOf(app.repo, app.config, order.guildId).logChannelId;
    if (!logChannelId) return;
    deliver(client, logChannelId, {
      components: notice(`Falha ao provisionar o pedido ${order.id}.`).components,
      flags: V2,
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }
}

export async function startBot({ config, repo, client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildInvites] }) }) {
  const infra = createInfrastructure(config);
  const bridge = { send: async () => false };
  const app = createApp({ config, repo, infra, deliverLog: (channelId, payload) => bridge.send(channelId, payload) });
  app.onOrderPaid = (orderId) => fulfill(client, app, orderId);
  bridge.send = (channelId, payload) => deliver(client, channelId, payload);
  client.on(Events.InviteCreate, (invite) => app.invites.noteInvite(invite));
  client.on(Events.InviteDelete, (invite) => app.invites.forgetInvite(invite));
  client.on(Events.GuildMemberAdd, (member) => {
    app.invites.onJoin(member).catch((error) => console.warn(`Convites: falha ao registrar entrada. ${error?.code || "erro"}`));
  });
  client.on(Events.GuildMemberRemove, (member) => {
    app.invites.onLeave(member).catch((error) => console.warn(`Convites: falha ao registrar saída. ${error?.code || "erro"}`));
  });
  client.on(Events.InteractionCreate, (interaction) => {
    routeInteraction(interaction, app).catch((error) => {
      logInteractionError(error);
    });
  });
  client.once(Events.ClientReady, async (ready) => {
    console.log(`Ignix Cloud PC conectado como ${ready.user.tag}.`);
    await registerCommands(config);
    await app.emojis.refresh(ready);
    await app.invites.warm(ready);
    await app.invites.sweep(ready);
  });
  await client.login(config.token);
  await repairVmLinks(repo, infra, Date.now()).catch((error) => console.warn(`Vínculo de VM: ${error?.code || "erro"}`));
  if (config.serverPort) {
    const server = createStoreHttp(async (raw, headers) => {
      const result = await app.store.handleWebhook(raw, headers);
      if (result.paid && result.orderId) setImmediate(() => fulfill(client, app, result.orderId));
      else if (result.chargeCleared && result.orderId) setImmediate(() => refreshPurchaseSummary(client, app, result.orderId));
      return result.status;
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.serverPort, "0.0.0.0", () => {
        server.off("error", reject);
        resolve();
      });
    });
    client.storeServer = server;
    const webhookUrl = config.publicUrl ? `${config.publicUrl}/webhooks/wyzecash` : `porta ${config.serverPort} /webhooks/wyzecash`;
    console.log(`Webhook da WyzeCash em ${webhookUrl}.`);
  }
  app.store.expireReservations();
  const expired = await app.store.expireClients();
  for (const row of expired) {
    const expiredNotice = renderMachineNotice({
      kind: "venceu",
      accent: app.config.panelColor,
      bannerUrl: app.config.bannerUrl,
      machineName: row.machine,
      gpu: row.gpu,
      vcpus: row.vcpus,
      ram: row.ram,
      ip: row.ip,
      planLabel: PLAN_LABEL[row.plan] || row.plan,
      startedAt: row.startedAt ? formatDate(row.startedAt) : "",
      expiresAt: row.expiresAt ? formatDate(row.expiresAt) : "",
      ...machineLinks(app.repo, config, row.guildId),
    });
    client.users.fetch(row.userId).then((user) => sendMachineNotice(user, expiredNotice)).catch(() => {});
  }
  for (const order of app.repo.resumeOrders()) fulfill(client, app, order.id);
  const pulse = setInterval(() => {
    app.invites.sweep(client).catch((error) => console.warn(`Convites: falha na verificação das 24 horas. ${error?.code || "erro"}`));
  }, 45_000);
  const storeTimer = setInterval(() => {
    editStorePanel(client, app).catch((error) => console.warn(`Loja: ${error?.code || "erro"}`));
    app.store.pollPayments().then((rows) => {
      for (const row of rows) {
        if (row.paid) fulfill(client, app, row.orderId);
        else if (row.chargeCleared) refreshPurchaseSummary(client, app, row.orderId);
      }
    }).catch((error) => console.warn(`WyzeCash: ${error?.code || "erro"}`));
  }, config.storeRefreshMs || 180_000);
  storeTimer.unref?.();
  client.storeTimer = storeTimer;
  pulse.unref?.();
  client.storePulse = pulse;
  return client;
}
