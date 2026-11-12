import { Client, Events, GatewayIntentBits } from "discord.js";
import { createApp } from "./app.js";
import { fail, logInteractionError } from "./components/reply.js";
import { routeClient } from "./components/client/router.js";
import { registerCommands, routeAdminComponent, routeCommand } from "./commands/admin/router.js";
import { createInfrastructure } from "./services/provider.js";

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
    if (await routeAdminComponent(interaction, app)) return;
  } catch (error) {
    logInteractionError(error);
    await fail(interaction, app.config.panelColor);
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
  return client;
}
