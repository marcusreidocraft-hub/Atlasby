import { Client, Events, GatewayIntentBits } from "discord.js";
import { createApp } from "./app.js";
import { fail, logInteractionError } from "./components/reply.js";
import { routeClient } from "./components/client/router.js";
import { registerCommands, routeAdminComponent, routeCommand } from "./commands/admin/router.js";
import { createInfrastructure } from "./services/provider.js";
import { routeStoreComponent, editStorePanel } from "./loja/router.js";
import { renderOrder } from "./loja/panel.js";
import { createStoreHttp } from "./loja/http.js";
import { V2 } from "./panels/ui.js";
import { attendanceOf } from "./loja/attendance.js";

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
    if (interaction.isChatInputCommand?.()) {
      await routeCommand(interaction, app);
      return;
    }
    if (await routeClient(interaction, app)) return;
    if (await routeStoreComponent(interaction, app)) return;
    if (await routeAdminComponent(interaction, app)) return;
  } catch (error) {
    logInteractionError(error);
    await fail(interaction, app.config.panelColor);
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
  if (order?.channelId && order?.messageId) {
    client.channels.fetch(order.channelId).then((channel) => channel.messages.fetch(order.messageId)).then((message) => message.edit({
      components: renderOrder(order, product).components,
      flags: V2,
      allowedMentions: { parse: [] },
    })).catch(() => {});
  }
  if (result.delivered?.ok) {
    client.users.fetch(order.userId).then((user) => user.send(app.store.readyText(product, order.plan, result.state.publicIp))).catch(() => {});
    if (result.delivered.roleId) {
      client.guilds.fetch(order.guildId).then((guild) => guild.members.fetch(order.userId)).then((member) => member.roles.add(result.delivered.roleId)).catch(() => {});
    }
  } else if (!result.ok) {
    const logChannelId = attendanceOf(app.repo, app.config, order.guildId).logChannelId;
    if (!logChannelId) return;
    deliver(client, logChannelId, {
      components: renderOrder(order, product).components,
      flags: V2,
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }
}

export async function startBot({ config, repo, client = new Client({ intents: [GatewayIntentBits.Guilds] }) }) {
  const infra = createInfrastructure(config);
  const bridge = { send: async () => false };
  const app = createApp({ config, repo, infra, deliverLog: (channelId, payload) => bridge.send(channelId, payload) });
  bridge.send = (channelId, payload) => deliver(client, channelId, payload);
  client.on(Events.InteractionCreate, (interaction) => {
    routeInteraction(interaction, app).catch((error) => {
      logInteractionError(error);
    });
  });
  client.once(Events.ClientReady, async (ready) => {
    console.log(`Atlas Cloud PC conectado como ${ready.user.tag}.`);
    await registerCommands(config);
    await app.emojis.refresh(ready);
  });
  await client.login(config.token);
  if (config.serverPort) {
    const server = createStoreHttp(async (raw, headers) => {
      const result = await app.store.handleWebhook(raw, headers);
      if (result.orderId) setImmediate(() => fulfill(client, app, result.orderId));
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
    console.log(`Webhook da loja escutando na porta ${config.serverPort}.`);
  }
  app.store.expireReservations();
  const expired = await app.store.expireClients();
  for (const row of expired) {
    client.users.fetch(row.userId).then((user) => user.send(`Seu plano da Atlas Cloud PC em ${row.machine} venceu. A máquina foi desligada e não foi apagada.`)).catch(() => {});
  }
  for (const order of app.repo.resumeOrders()) fulfill(client, app, order.id);
  let phase = 0;
  const pulse = setInterval(() => {
    phase += 1;
    editStorePanel(client, app, phase).catch(() => {});
  }, 45_000);
  pulse.unref?.();
  client.storePulse = pulse;
  return client;
}
