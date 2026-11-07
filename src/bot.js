import { Client, Events, GatewayIntentBits, REST, Routes } from "discord.js";
import { createDiscordAdapter } from "./adapter.js";
import { commands } from "./commands.js";
import { isGuildAuthorized } from "./config.js";
import { durationSpec } from "./plans.js";
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
  offerModal,
  renderAppearance,
  renderProductAdmin,
  renderProductTexts,
  renderStylePreview,
  productCopyModal,
  infoModal,
  styleModal,
  renderTicketSettings,
  stockModal,
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
    if (interaction.isChannelSelectMenu?.() || interaction.isUserSelectMenu?.() || interaction.isRoleSelectMenu?.() || interaction.isStringSelectMenu?.()) {
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
    const message = await interaction.reply({ ...renderCatalog(result.plans, result.style), fetchReply: true });
    if (message?.id && interaction.channelId) {
      service.trackCatalog({ guildId, channelId: interaction.channelId, messageId: message.id });
    }
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
  if (customId.startsWith("atlasby:ticket:blocked:")) {
    await interaction.reply(renderNotice(describeResult({ code: "sold_out" })));
    return;
  }
  const openTicket = /^atlasby:ticket:open:(t4-4|t4-8|t4-16):(7d|15d|30d)$/.exec(customId);
  if (openTicket) {
    await replyOpenedTicket(interaction, service, openTicket[1], openTicket[2]);
    return;
  }
  if (customId === "atlasby:catalog:games" || customId === "atlasby:catalog:faq") {
    const kind = customId.endsWith("faq") ? "faq" : "games";
    const info = service.catalogNote(interaction.guildId, kind);
    await interaction.reply(renderNotice(info.text ?? describeResult(info)));
    return;
  }
  const ticketAction = /^atlasby:ticket:(claim|unclaim|transcript|close):([0-9a-f-]{36})$/.exec(customId);
  if (ticketAction) {
    const ticketId = ticketAction[2];
    if (ticketAction[1] === "close") {
      const result = await service.requestCloseTicket({ guildId: interaction.guildId, actorId: interaction.user.id, ticketId });
      await interaction.reply(notice(result, result.confirmationId ? confirmationRow(result.confirmationId) : null));
      return;
    }
    const result =
      ticketAction[1] === "claim"
        ? await service.claimTicket({ guildId: interaction.guildId, actorId: interaction.user.id, ticketId })
        : ticketAction[1] === "unclaim"
          ? await service.clearTicketClaim({ guildId: interaction.guildId, actorId: interaction.user.id, ticketId })
          : await service.transcriptTicket({ guildId: interaction.guildId, actorId: interaction.user.id, ticketId });
    if (result.ticket && ticketAction[1] !== "transcript") {
      await interaction.update(service.ticketCard(interaction.guildId, result.ticket));
      await interaction.followUp(renderNotice(describeResult(result)));
      return;
    }
    await interaction.reply(renderNotice(describeResult(result)));
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
    if (result.code === "countdown_ready") {
      const finished = await service.finishDeletion({
        guildId: interaction.guildId,
        ticketId: result.ticket.id,
        editStatus: (content) => interaction.editReply(renderNotice(content, { update: true })),
      });
      await interaction.editReply(notice(finished, null, { update: true }));
      return;
    }
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
  if (customId === "atlasby:cfg:appearance") {
    const view = await service.adminView({ guildId: interaction.guildId, actorId: interaction.user.id });
    if (view.code !== "admin_panel") {
      await interaction.update(renderNotice(describeResult(view), { update: true }));
      return;
    }
    await interaction.update(renderAppearance());
    return;
  }
  if (customId === "atlasby:cfg:style:catalog" || customId === "atlasby:cfg:style:ticket" || customId === "atlasby:cfg:style:buttons") {
    await interaction.showModal(styleModal(customId.split(":").at(-1)));
    return;
  }
  if (customId === "atlasby:cfg:style:products") {
    const view = await service.adminView({ guildId: interaction.guildId, actorId: interaction.user.id });
    if (view.code !== "admin_panel") {
      await interaction.update(renderNotice(describeResult(view), { update: true }));
      return;
    }
    await interaction.update(renderProductTexts());
    return;
  }
  if (customId === "atlasby:cfg:style:info") {
    const view = await service.adminView({ guildId: interaction.guildId, actorId: interaction.user.id });
    if (view.code !== "admin_panel") {
      await interaction.reply(renderNotice(describeResult(view)));
      return;
    }
    await interaction.showModal(infoModal());
    return;
  }
  const copy = /^atlasby:cfg:copy:(t4-4|t4-8|t4-16)$/.exec(customId);
  if (copy) {
    const view = await service.adminView({ guildId: interaction.guildId, actorId: interaction.user.id });
    if (view.code !== "admin_panel") {
      await interaction.reply(renderNotice(describeResult(view)));
      return;
    }
    await interaction.showModal(productCopyModal(copy[1]));
    return;
  }
  if (customId === "atlasby:cfg:tickets") {
    const view = await service.adminView({ guildId: interaction.guildId, actorId: interaction.user.id });
    if (view.code !== "admin_panel") {
      await interaction.update(renderNotice(describeResult(view), { update: true }));
      return;
    }
    await interaction.update(renderTicketSettings());
    return;
  }
  const product = /^atlasby:cfg:product:(t4-4|t4-8|t4-16)$/.exec(customId);
  if (product) {
    const view = await service.adminView({ guildId: interaction.guildId, actorId: interaction.user.id });
    if (view.code !== "admin_panel") {
      await interaction.update(renderNotice(describeResult(view), { update: true }));
      return;
    }
    await interaction.update(renderProductAdmin(view.plans.filter((plan) => plan.sku === product[1])));
    return;
  }
  const durationChoice = /^atlasby:cfg:duration:(t4-4|t4-8|t4-16):(7d|15d|30d)$/.exec(customId);
  if (durationChoice) {
    const view = await service.adminView({ guildId: interaction.guildId, actorId: interaction.user.id });
    const plan = view.plans?.find((item) => item.sku === durationChoice[1] && item.code === durationChoice[2]);
    if (!plan) {
      await interaction.reply(renderNotice(describeResult({ code: "plan_unknown" })));
      return;
    }
    await interaction.showModal(offerModal(plan));
    return;
  }
  const price = /^atlasby:cfg:price:(t4-4|t4-8|t4-16):(7d|15d|30d)$/.exec(customId);
  if (price) {
    const spec = durationSpec(price[1], price[2]);
    await interaction.showModal(priceModal(price[1], price[2], spec?.label ?? price[2]));
    return;
  }
  const stock = /^atlasby:cfg:stock:(t4-4|t4-8|t4-16):(7d|15d|30d)$/.exec(customId);
  if (stock) {
    const spec = durationSpec(stock[1], stock[2]);
    await interaction.showModal(stockModal(stock[1], stock[2], spec?.label ?? stock[2]));
    return;
  }
  const avail = /^atlasby:cfg:avail:(t4-4|t4-8|t4-16):(7d|15d|30d)$/.exec(customId);
  if (avail) {
    const view = await service.adminView({ guildId: interaction.guildId, actorId: interaction.user.id });
    if (view.code !== "admin_panel") {
      await interaction.update(renderNotice(describeResult(view), { update: true }));
      return;
    }
    const plan = view.plans.find((item) => item.sku === avail[1] && item.code === avail[2]);
    const result = await service.requestSetPlan({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      sku: avail[1],
      code: avail[2],
      available: plan ? !plan.available : false,
    });
    await interaction.update(notice(result, result.confirmationId ? confirmationRow(result.confirmationId) : null, { update: true }));
  }
}

function avatarFrom(interaction) {
  return {
    hasCustomAvatar: Boolean(interaction.member?.avatar || interaction.user?.avatar),
    avatarUrl:
      interaction.member?.displayAvatarURL?.({ extension: "png", size: 128 }) ??
      interaction.user?.displayAvatarURL?.({ extension: "png", size: 128 }) ??
      null,
  };
}

async function replyOpenedTicket(interaction, service, sku, code) {
  const result = await service.openTicket({
    guildId: interaction.guildId,
    openerId: interaction.user.id,
    sku,
    code,
    ...avatarFrom(interaction),
  });
  const channel = result.ticket?.channel_id ? ` <#${result.ticket.channel_id}>` : "";
  const content = result.code === "ticket_opened" || result.code === "ticket_exists" ? `${describeResult(result)}${channel}` : describeResult(result);
  await interaction.reply(renderNotice(content));
}

async function handleSelect(interaction, service) {
  const customId = interaction.customId ?? "";
  const selected = interaction.values?.[0] ?? null;
  const period = /^atlasby:catalog:period:(t4-4|t4-8|t4-16)$/.exec(customId);
  if (period) {
    if (!["7d", "15d", "30d"].includes(selected)) {
      await interaction.reply(renderNotice(describeResult({ code: "plan_unknown" })));
      return;
    }
    await replyOpenedTicket(interaction, service, period[1], selected);
    return;
  }
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
  } else if (customId === "atlasby:cfg:category") {
    result = await service.requestGuildSetting({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      action: "set_category",
      value: selected,
      summary: `Categoria proposta: <#${selected}>.`,
    });
  } else if (customId === "atlasby:cfg:staff") {
    result = await service.requestGuildSetting({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      action: "set_staff_role",
      value: selected,
      summary: `Cargo proposto: <@&${selected}>.`,
    });
  } else if (customId === "atlasby:cfg:transcript") {
    result = await service.requestGuildSetting({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      action: "set_transcript_channel",
      value: selected,
      summary: `Canal de transcrição proposto: <#${selected}>.`,
    });
  } else return;
  await interaction.update(notice(result, result.confirmationId ? confirmationRow(result.confirmationId) : null, { update: true }));
}

function blankToNull(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text : null;
}

async function handleModal(interaction, service) {
  const styleMatch = /^atlasby:modal:style:(catalog|ticket|buttons)$/.exec(interaction.customId ?? "");
  if (styleMatch) {
    const read = (id) => blankToNull(interaction.fields.getTextInputValue(id));
    const patch = styleMatch[1] === "catalog"
      ? { catalogEmoji: read("catalogo_emoji"), catalog_intro: read("catalogo_intro"), catalogBannerUrl: read("catalogo_banner"), openEmoji: read("abrir_emoji") }
      : styleMatch[1] === "ticket"
        ? { ticketGreeting: read("saudacao"), ticket_title_emoji: read("titulo_emoji"), ticketBannerUrl: read("ticket_banner") }
        : {
            claimEmoji: read("assumir"),
            unclaimEmoji: read("liberar"),
            transcriptEmoji: read("transcricao"),
            closeEmoji: read("fechar"),
          };
    const result = await service.requestSetStyle({ guildId: interaction.guildId, actorId: interaction.user.id, patch });
    if (result.code === "confirmation_required") {
      await interaction.reply(renderStylePreview(result.preview, result.confirmationId));
      return;
    }
    await interaction.reply(renderNotice(describeResult(result)));
    return;
  }
  const copyMatch = /^atlasby:modal:copy:(t4-4|t4-8|t4-16)$/.exec(interaction.customId ?? "");
  if (copyMatch) {
    const sku = copyMatch[1].replace("-", "_");
    const read = (id) => blankToNull(interaction.fields.getTextInputValue(id));
    const result = await service.requestSetStyle({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      patch: { [`title_${sku}`]: read("titulo"), [`emoji_${sku}`]: read("emoji"), [`placeholder_${sku}`]: read("placeholder") },
    });
    if (result.code === "confirmation_required") {
      await interaction.reply(renderStylePreview(result.preview, result.confirmationId));
      return;
    }
    await interaction.reply(renderNotice(describeResult(result)));
    return;
  }
  if (interaction.customId === "atlasby:modal:style:info") {
    const read = (id) => blankToNull(interaction.fields.getTextInputValue(id));
    const result = await service.requestSetStyle({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      patch: {
        faq_text: read("faq"),
        faq_emoji: read("faq_emoji"),
        games_text: read("jogos"),
        games_emoji: read("jogos_emoji"),
      },
    });
    if (result.code === "confirmation_required") {
      await interaction.reply(renderStylePreview(result.preview, result.confirmationId));
      return;
    }
    await interaction.reply(renderNotice(describeResult(result)));
    return;
  }
  const offerMatch = /^atlasby:modal:offer:(t4-4|t4-8|t4-16):(7d|15d|30d)$/.exec(interaction.customId ?? "");
  if (offerMatch) {
    const availability = interaction.fields.getTextInputValue("disponibilidade").trim().toLowerCase();
    const available = availability === "disponivel" || availability === "disponível";
    if (!available && availability !== "esgotado") {
      await interaction.reply(renderNotice(describeResult({ code: "greeting_invalid", action: "set_offer" })));
      return;
    }
    const result = await service.requestSetOffer({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      sku: offerMatch[1],
      code: offerMatch[2],
      rawPrice: interaction.fields.getTextInputValue("preco"),
      available,
    });
    await interaction.reply(notice(result, result.confirmationId ? confirmationRow(result.confirmationId) : null));
    return;
  }
  const priceMatch = /^atlasby:modal:price:(t4-4|t4-8|t4-16):(7d|15d|30d)$/.exec(interaction.customId ?? "");
  const stockMatch = /^atlasby:modal:stock:(t4-4|t4-8|t4-16):(7d|15d|30d)$/.exec(interaction.customId ?? "");
  if (!priceMatch && !stockMatch) return;
  const result = priceMatch
    ? await service.parseAndRequestPrice({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        sku: priceMatch[1],
        code: priceMatch[2],
        rawPrice: interaction.fields.getTextInputValue("preco"),
      })
    : await service.requestSetStock({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        sku: stockMatch[1],
        code: stockMatch[2],
        stock: interaction.fields.getTextInputValue("estoque"),
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
  const intents = [GatewayIntentBits.Guilds];
  if (config.messageContentIntent) intents.push(GatewayIntentBits.MessageContent);
  const client = new Client({ intents });
  const service = createService({
    store,
    discord: createDiscordAdapter(client),
    ttlMs: config.confirmationTtlMs,
    messageContentIntent: config.messageContentIntent,
  });
  client.on(Events.InteractionCreate, (interaction) => {
    handleInteraction(interaction, { config, service }).catch((error) => {
      const message = error instanceof Error ? error.message : "erro";
      console.error(`Falha ao processar interação: ${message}`);
    });
  });
  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Conectado como ${readyClient.user.tag}.`);
    service.recoverPendingDeletes().catch((error) => {
      const message = error instanceof Error ? error.message : "erro";
      console.error(`Falha ao retomar exclusão de ticket: ${message}`);
    });
    service.reconcileCatalogs().catch((error) => {
      const message = error instanceof Error ? error.message : "erro";
      console.error(`Falha ao atualizar catálogos publicados: ${message}`);
    });
    registerGuildCommands(config).catch((error) => {
      const message = error instanceof Error ? error.message : "erro";
      console.error(`Falha ao registrar comandos: ${message}`);
    });
  });
  await client.login(config.token);
  return client;
}
