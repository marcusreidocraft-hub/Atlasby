import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
} from "discord.js";
import { createDiscordAdapter } from "./adapter.js";
import { commands } from "./commands.js";
import { isGuildAuthorized } from "./config.js";
import { describeResult } from "./messages.js";
import { createService } from "./service.js";

export function confirmationRow(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`atlasby:confirm:${id}`)
      .setLabel("Confirmar")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`atlasby:cancel:${id}`)
      .setLabel("Cancelar")
      .setStyle(ButtonStyle.Secondary),
  );
}

function ephemeral(content, extra = {}) {
  return { content, flags: MessageFlags.Ephemeral, ...extra };
}

async function safeReply(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(payload);
    return;
  }
  await interaction.reply(payload);
}

export async function handleInteraction(interaction, { config, service }) {
  try {
    if (!interaction.inGuild?.()) {
      await safeReply(interaction, ephemeral(describeResult({ code: "guild_only" })));
      return;
    }
    if (!isGuildAuthorized(config, interaction.guildId)) {
      await safeReply(interaction, ephemeral(describeResult({ code: "guild_unauthorized" })));
      return;
    }
    if (interaction.isButton?.()) {
      await handleButton(interaction, service);
      return;
    }
    if (interaction.isChatInputCommand?.()) {
      await handleCommand(interaction, service);
    }
  } catch {
    const payload = ephemeral(describeResult({ code: "internal", punishmentApplied: false }));
    try {
      await safeReply(interaction, payload);
    } catch {
      // A interação já não pode ser respondida. O processo continua sem declarar punição.
    }
  }
}

async function handleCommand(interaction, service) {
  const actorId = interaction.user.id;
  const guildId = interaction.guildId;
  const name = interaction.commandName;

  if (name === "canal-logs") {
    const channel = interaction.options.getChannel("canal");
    const result = await service.setLogChannel({
      guildId,
      actorId,
      channelId: channel?.id ?? null,
    });
    await interaction.reply(ephemeral(describeResult(result)));
    return;
  }

  const user = interaction.options.getUser("usuario");
  if (!user) {
    await interaction.reply(ephemeral(describeResult({ code: "target_required" })));
    return;
  }
  const reason = interaction.options.getString("motivo");
  const input = { guildId, actorId, targetId: user.id, reason };

  let result;
  if (name === "aviso") result = await service.warn(input);
  else if (name === "expulsar") result = await service.requestKick(input);
  else if (name === "banir") result = await service.requestBan(input);
  else if (name === "silenciar") {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "remover") result = await service.removeTimeout(input);
    else {
      result = await service.timeout({
        ...input,
        duration: interaction.options.getString("duracao"),
      });
    }
  } else return;

  const extra = result.code === "confirmation_required" ? { components: [confirmationRow(result.confirmationId)] } : {};
  await interaction.reply(ephemeral(describeResult(result), extra));
}

async function handleButton(interaction, service) {
  const match = /^atlasby:(confirm|cancel):([0-9a-f-]{36})$/.exec(interaction.customId ?? "");
  if (!match) return;
  await interaction.deferUpdate();
  const result = await service.confirm({
    confirmationId: match[2],
    guildId: interaction.guildId,
    moderatorId: interaction.user.id,
    decision: match[1] === "confirm" ? "confirm" : "cancel",
  });
  await interaction.editReply({
    content: describeResult(result),
    components: [],
  });
}

export async function registerGuildCommands(config) {
  const rest = new REST({ version: "10" }).setToken(config.token);
  const body = commands.map((command) => command.toJSON());
  for (const guildId of config.allowedGuildIds) {
    try {
      await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body });
      console.log(`Comandos registrados no servidor ${guildId}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "erro";
      console.error(`Falha ao registrar comandos no servidor ${guildId}: ${message}`);
    }
  }
}

export async function startBot({ config, store }) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const service = createService({
    store,
    discord: createDiscordAdapter(client),
    ttlMs: config.confirmationTtlMs,
  });

  client.on(Events.InteractionCreate, (interaction) => {
    handleInteraction(interaction, { config, service }).catch((error) => {
      const message = error instanceof Error ? error.message : "erro";
      console.error(`Falha ao processar interação: ${message}`);
    });
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Conectado como ${readyClient.user.tag}.`);
    registerGuildCommands(config).catch((error) => {
      const message = error instanceof Error ? error.message : "erro";
      console.error(`Falha ao registrar comandos: ${message}`);
    });
  });

  await client.login(config.token);
  return client;
}
