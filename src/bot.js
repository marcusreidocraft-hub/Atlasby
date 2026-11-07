import { Client, Events, GatewayIntentBits, REST, Routes } from "discord.js";
import { createDiscordAdapter } from "./adapter.js";
import { commands } from "./commands.js";
import { isGuildAuthorized } from "./config.js";
import { planSpec } from "./plans.js";
import { describeResult } from "./messages.js";
import { createService } from "./service.js";
import {
  confirmationRow,
  priceModal,
  renderAdmin,
  renderAdminPicker,
  renderCatalog,
  renderLogPicker,
  renderNotice,
} from "./ui.js";

export { confirmationRow };

async function safeReply(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(payload);
    return;
  }
  await interaction.reply(payload);
}

function notice(result, row = null, { update = false } = {}) {
  return renderNotice(describeResult(result), {
    ephemeral: true,
    update,
    row: result.code === "confirmation_required" ? row : null,
  });
}

export async function handleInteraction(interaction, { config, service }) {
  try {
    if (!interaction.inGuild?.()) {
      await safeReply(interaction, renderNotice(describeResult({ code: "guild_only" })));
      return;
    }
    if (!isGuildAuthorized(config, interaction.guildId)) {
      await safeReply(interaction, renderNotice(describeResult({ code: "guild_unauthorized" })));
      return;
    }
    if (interaction.isModalSubmit?.()) {
      await handleModal(interaction, service);
      return;
    }
    if (interaction.isChannelSelectMenu?.() || interaction.isUserSelectMenu?.() || interaction.isStringSelectMenu?.()) {
      await handleSelect(interaction, service);
      return;
    }
    if (interaction.isButton?.()) {
      await handleButton(interaction, service);
      return;
    }
    if (interaction.isChatInputCommand?.()) await handleCommand(interaction, service);
  } catch {
    try {
      await safeReply(interaction, renderNotice(describeResult({ code: "internal", punishmentApplied: false })));
    } catch {
      // A interação já não pode ser respondida. O processo continua sem declarar punição.
    }
  }
}

async function handleCommand(interaction, service) {
  const actorId = interaction.user.id;
  const guildId = interaction.guildId;
  const name = interaction.commandName;

  if (name === "catalogo") {
    const result = await service.catalog({ guildId });
    await interaction.reply(renderCatalog(result.plans));
    return;
  }
  if (name === "configurar") {
    const result = await service.adminView({ guildId, actorId });
    await interaction.reply(result.code === "admin_panel" ? renderAdmin(result) : renderNotice(describeResult(result)));
    return;
  }
  if (name === "canal-logs") {
    const channel = interaction.options.getChannel("canal");
    const result = await service.requestSetLogChannel({ guildId, actorId, channelId: channel?.id ?? null });
    await interaction.reply(notice(result, result.confirmationId ? confirmationRow(result.confirmationId) : null));
    return;
  }

  const user = interaction.options.getUser("usuario");
  if (!user) {
    await interaction.reply(renderNotice(describeResult({ code: "target_required" })));
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
    result =
      subcommand === "remover"
        ? await service.removeTimeout(input)
        : await service.timeout({ ...input, duration: interaction.options.getString("duracao") });
  } else return;

  await interaction.reply(notice(result, result.confirmationId ? confirmationRow(result.confirmationId) : null));
}

async function handleButton(interaction, service) {
  const customId = interaction.customId ?? "";
  if (customId.startsWith("atlasby:plan:soldout:")) {
    await interaction.reply(renderNotice(describeResult({ code: "sold_out" })));
    return;
  }
  const confirm = /^atlasby:(confirm|cancel):([0-9a-f-]{36})$/.exec(customId);
  if (confirm) {
    await interaction.deferUpdate();
    const result = await service.confirm({
      confirmationId: confirm[2],
      guildId: interaction.guildId,
      moderatorId: interaction.user.id,
      decision: confirm[1] === "confirm" ? "confirm" : "cancel",
    });
    await interaction.editReply(notice(result, null, { update: true }));
    return;
  }
  if (customId === "atlasby:cfg:logs") {
    const view = await service.adminView({ guildId: interaction.guildId, actorId: interaction.user.id });
    if (view.code !== "admin_panel") {
      await interaction.update(renderNotice(describeResult(view)));
      return;
    }
    await interaction.update(renderLogPicker({ update: true }));
    return;
  }
  if (customId === "atlasby:cfg:admins") {
    const view = await service.adminView({ guildId: interaction.guildId, actorId: interaction.user.id });
    if (!view.isOwner) {
      await interaction.update(renderNotice(describeResult({ code: view.code === "admin_panel" ? "owner_only" : view.code, action: "enroll_admin" })));
      return;
    }
    await interaction.update(renderAdminPicker(view.admins, { update: true }));
    return;
  }
  const price = /^atlasby:cfg:price:(7d|15d|30d)$/.exec(customId);
  if (price) {
    const spec = planSpec(price[1]);
    await interaction.showModal(priceModal(spec.code, spec.label));
    return;
  }
  const stock = /^atlasby:cfg:stock:(7d|15d|30d)$/.exec(customId);
  if (stock) {
    const view = await service.adminView({ guildId: interaction.guildId, actorId: interaction.user.id });
    if (view.code !== "admin_panel") {
      await interaction.update(renderNotice(describeResult(view)));
      return;
    }
    const plan = view.plans.find((item) => item.code === stock[1]);
    const result = await service.requestSetPlan({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      code: stock[1],
      available: plan ? !plan.available : true,
    });
    await interaction.update(notice(result, result.confirmationId ? confirmationRow(result.confirmationId) : null, { update: true }));
  }
}

async function handleSelect(interaction, service) {
  const customId = interaction.customId ?? "";
  const selected = interaction.values?.[0] ?? null;
  let result;
  if (customId === "atlasby:cfg:logselect") {
    result = await service.requestSetLogChannel({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      channelId: selected,
    });
  } else if (customId === "atlasby:cfg:adminadd") {
    result = await service.requestEnrollAdmin({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      userId: selected,
    });
  } else if (customId === "atlasby:cfg:admindel") {
    result = await service.requestRemoveAdmin({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      userId: selected,
    });
  } else return;
  await interaction.update(notice(result, result.confirmationId ? confirmationRow(result.confirmationId) : null, { update: true }));
}

async function handleModal(interaction, service) {
  const match = /^atlasby:modal:price:(7d|15d|30d)$/.exec(interaction.customId ?? "");
  if (!match) return;
  const raw = interaction.fields.getTextInputValue("preco");
  const result = await service.parseAndRequestPrice({
    guildId: interaction.guildId,
    actorId: interaction.user.id,
    code: match[1],
    rawPrice: raw,
  });
  await interaction.reply(notice(result, result.confirmationId ? confirmationRow(result.confirmationId) : null));
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
