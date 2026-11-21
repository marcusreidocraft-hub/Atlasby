import { MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder } from "discord.js";
import { notice, V2, V2_EPHEMERAL } from "../panels/ui.js";
import { ack, present } from "../components/reply.js";
import { parseDate } from "../services/plans.js";
import { formatBrl } from "./products.js";
import { openPurchaseTicket } from "../tickets/purchase.js";
import { STORE_COMMANDS } from "./commands.js";
import { attendanceOf, canAttend, renderAttendance } from "./attendance.js";
import { chargeFiles, renderChargePanel } from "./charge-panel.js";
import { deliverComponents, isStaleMessage, publishStorePanel } from "./publish.js";

async function refresh(interaction, app) {
  const guildId = interaction.guildId;
  const view = app.store.panel(guildId);
  const settings = app.store.settings(guildId);
  if (!settings.channelId || !settings.messageId) return false;
  try {
    const channel = await interaction.client.channels.fetch(settings.channelId);
    const message = await channel.messages.fetch(settings.messageId);
    await deliverComponents((body) => message.edit(body), view);
    return true;
  } catch (error) {
    if (isStaleMessage(error)) await app.store.saveSettings(guildId, interaction.user.id, { messageId: "" });
    throw error;
  }
}

export async function handleStoreCommand(interaction, app, actor) {
  if (!STORE_COMMANDS.has(interaction.commandName)) return false;
  const guildId = interaction.guildId;
  const name = interaction.commandName;
  if (name === "configurar-atendimento") {
    app.store.settings(guildId);
    await present(interaction, renderAttendance(app.repo.getSettings(guildId), app.config.panelColor));
    return true;
  }
  if (name === "configurar-loja") {
    const sub = interaction.options.getSubcommand();
    if (sub === "publicar") {
      const settings = app.store.settings(guildId);
      await app.store.preparePanel(guildId);
      const outcome = await publishStorePanel({
        channelId: interaction.channelId,
        settings,
        view: app.store.panel(guildId),
        fetchMessage: async (channelId, messageId) => {
          const channel = await interaction.client.channels.fetch(channelId);
          if (!channel?.messages?.fetch) throw Object.assign(new Error("Unknown Channel"), { code: 10003 });
          return channel.messages.fetch(messageId);
        },
        edit: (message, body) => message.edit(body),
        send: (body) => interaction.channel.send(body),
      });
      if (outcome.created) await app.store.saveSettings(guildId, actor.id, { channelId: outcome.channelId, messageId: outcome.messageId });
      await present(interaction, notice(outcome.created ? "Painel da loja publicado." : "Painel da loja atualizado no lugar.", app.config.panelColor));
      return true;
    }
    if (sub === "compras") {
      const result = await app.store.setPurchases(guildId, actor.id, { enabled: interaction.options.getString("acao") === "ativar" });
      if (!result.ok) {
        await present(interaction, notice(result.error, app.config.panelColor));
        return true;
      }
      const updated = await refresh(interaction, app).catch(() => false);
      await present(interaction, notice(updated ? "Compras atualizadas no painel." : "Compras atualizadas. Publique o painel para exibir.", app.config.panelColor));
      return true;
    }
    if (sub === "status") {
      await app.store.preparePanel(guildId);
      await present(interaction, notice(app.store.status(guildId), app.config.panelColor));
      return true;
    }
    await present(interaction, notice("Use publicar, compras ou status.", app.config.panelColor));
    return true;
  }
  if (name === "criar-oferta") {
    const start = parseDate(interaction.options.getString("inicio"));
    const end = parseDate(interaction.options.getString("fim"));
    const promo = app.store.parseMoney(interaction.options.getString("preco") || "");
    const created = await app.store.createOffer(guildId, actor.id, {
      sku: interaction.options.getString("produto"), plan: interaction.options.getString("plano"),
      units: interaction.options.getInteger("unidades"), startsAt: start, endsAt: end, promoCents: promo,
    });
    await refresh(interaction, app).catch(() => false);
    await present(interaction, notice(created.ok ? `Oferta criada. Desconto de ${created.percent}%.` : created.error, app.config.panelColor));
    return true;
  }
  if (name === "remover-oferta") {
    const removed = await app.store.removeOffer(guildId, actor.id, interaction.options.getString("id"));
    await refresh(interaction, app).catch(() => false);
    await present(interaction, notice(removed.ok ? "Oferta removida." : removed.error, app.config.panelColor));
    return true;
  }
  if (name === "configurar-cargo") {
    const product = app.repo.storeProduct(guildId, interaction.options.getString("produto"));
    await app.store.saveProduct(guildId, actor.id, { ...product, roleId: interaction.options.getRole("cargo").id });
    await present(interaction, notice("Cargo do produto gravado.", app.config.panelColor));
    return true;
  }
  if (name === "configurar-azure") {
    const product = app.repo.storeProduct(guildId, interaction.options.getString("produto"));
    if (!product) {
      await present(interaction, notice("Produto não encontrado.", app.config.panelColor));
      return true;
    }
    await app.store.saveProduct(guildId, actor.id, {
      ...product,
      azure: {
        ...product.azure,
        group: interaction.options.getString("grupo"),
        vnet: interaction.options.getString("vnet"),
        subnet: interaction.options.getString("subnet"),
        nsg: interaction.options.getString("nsg") || product.azure.nsg || "Atlas-nsg",
        spot: interaction.options.getBoolean("spot") ?? product.azure.spot,
      },
    });
    await present(interaction, notice("Rede da VM gravada.", app.config.panelColor));
    return true;
  }
  if (name === "configurar-imagem") {
    await app.store.saveSettings(guildId, actor.id, { imageKind: interaction.options.getString("tipo"), imageId: interaction.options.getString("id").trim() });
    await present(interaction, notice("Imagem gravada. A VM nasce dessa imagem, sem perfil de sistema quando ela é especializada.", app.config.panelColor));
    return true;
  }
  if (name === "pedidos") {
    const rows = app.store.orders(guildId);
    await present(interaction, notice(rows.map((order) => `${order.id} · <@${order.userId}> · ${order.sku} · ${order.status} · ${formatBrl(order.totalCents)}`).join("\n") || "Nenhum pedido.", app.config.panelColor));
    return true;
  }
  if (name === "pedido") {
    const order = app.store.order(interaction.options.getString("id"));
    await present(interaction, notice(order ? `${order.id}\n${order.status}\n${formatBrl(order.totalCents)}` : "Pedido não encontrado.", app.config.panelColor));
    return true;
  }
  if (name === "cancelar-pedido") {
    const cancelled = await app.store.cancel(guildId, actor.id, interaction.options.getString("id"));
    await refresh(interaction, app).catch(() => false);
    await present(interaction, notice(cancelled.ok ? "Pedido cancelado. Se já houve pagamento, o reembolso é feito no painel da WyzeCash." : cancelled.error, app.config.panelColor));
    return true;
  }
  return false;
}

async function writeTranscript(interaction, app, order, reason) {
  const desk = attendanceOf(app.repo, app.config, interaction.guildId);
  if (!desk.logChannelId) return;
  let history = "";
  try {
    const fetched = await interaction.channel?.messages?.fetch({ limit: 20 });
    history = [...(fetched?.values?.() ?? [])].reverse().map((message) => `${message.author?.username || "sistema"}: ${message.content || "[painel]"}`).join("\n").slice(0, 1500);
  } catch { /* o canal pode já ter sido fechado */ }
  const channel = await interaction.client.channels.fetch(desk.logChannelId);
  await channel.send({
    components: notice([
      `Transcrição do pedido ${order?.id || "sem id"}`,
      `Cliente: <@${order?.userId || interaction.user.id}>`,
      `Motivo: ${String(reason || "não informado").slice(0, 180)}`,
      history,
    ].filter(Boolean).join("\n"), app.config.panelColor).components,
    flags: V2,
    allowedMentions: { parse: [] },
  });
}

export async function routeStoreComponent(interaction, app) {
  const id = interaction.customId ?? "";
  if (!id.startsWith("atlas:store:") && !id.startsWith("atlas:modal:store:")) return false;
  const guildId = interaction.guildId;
  const actor = { id: interaction.user.id, guildId, permissions: interaction.member?.permissions?.bitfield ?? 0n, roleIds: interaction.member?.roles?.cache?.map?.((role) => role.id) ?? [], owner: interaction.guild?.ownerId === interaction.user.id };
  const copy = /^atlas:store:copy:([0-9a-f-]{36})$/.exec(id);
  if (copy) {
    const order = app.store.order(copy[1]);
    const code = order?.pixCode || "";
    await interaction.reply({
      content: code || "Este pedido ainda não tem código Pix.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  const check = /^atlas:store:check:([0-9a-f-]{36})$/.exec(id);
  if (check) {
    await ack(interaction, false);
    const result = await app.store.confirmFromProvider(check[1]);
    if (result.paid) app.onOrderPaid?.(result.orderId);
    const text = result.paid
      ? "Pagamento confirmado. A máquina segue para a entrega."
      : result.expired
        ? "Esta cobrança expirou. A unidade da oferta voltou."
        : result.pending
          ? "O pagamento ainda não consta. Assim que a WyzeCash confirmar, a máquina é criada."
          : result.error;
    await present(interaction, notice(text, app.config.panelColor));
    return true;
  }
  if (id.startsWith("atlas:store:pick")) {
    await ack(interaction, false);
    await openPurchaseTicket(interaction, app, interaction.values?.[0] ?? "");
    await refresh(interaction, app).catch(() => false);
    return true;
  }
  const claim = /^atlas:store:claim:([0-9a-f-]{36})$/.exec(id);
  const pay = /^atlas:store:pay:([0-9a-f-]{36})$/.exec(id);
  const notify = /^atlas:store:notify:([0-9a-f-]{36})$/.exec(id);
  const close = /^atlas:store:close:([0-9a-f-]{36})$/.exec(id);
  if (claim || notify || close) {
    if (!canAttend(actor, app.config, attendanceOf(app.repo, app.config, guildId))) {
      await ack(interaction, false);
      await present(interaction, notice("Só a equipe pode fazer isso.", app.config.panelColor));
      return true;
    }
  }
  if (claim) {
    await ack(interaction, true);
    const result = await app.store.claim(guildId, actor.id, claim[1]);
    await present(interaction, notice(result.ok ? "Atendimento assumido." : result.error, app.config.panelColor));
    return true;
  }
  if (close) {
    const modal = new ModalBuilder().setCustomId(`atlas:modal:store:${close[1]}`).setTitle("Fechar ticket").addLabelComponents(
      new LabelBuilder().setLabel("Motivo").setTextInputComponent(new TextInputBuilder().setCustomId("motivo").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(180)),
    );
    await interaction.showModal(modal);
    return true;
  }
  if (id.startsWith("atlas:modal:store:")) {
    if (!canAttend(actor, app.config, attendanceOf(app.repo, app.config, guildId))) {
      await ack(interaction, false);
      await present(interaction, notice("Só a equipe pode fazer isso.", app.config.panelColor));
      return true;
    }
    await ack(interaction, false);
    const orderId = id.slice("atlas:modal:store:".length);
    const reason = interaction.fields.getTextInputValue("motivo");
    const order = app.store.order(orderId);
    await writeTranscript(interaction, app, order, reason);
    const closed = await app.store.close(guildId, actor.id, orderId, reason);
    await refresh(interaction, app).catch(() => false);
    await present(interaction, notice(closed.ok ? "Ticket fechado. O reembolso de um Pix pago é feito no painel da WyzeCash." : closed.error, app.config.panelColor));
    return true;
  }
  if (notify) {
    await ack(interaction, true);
    const order = app.store.order(notify[1]);
    try {
      const user = await interaction.client.users.fetch(order.userId);
      await user.send(`Há uma atualização no seu pedido da Ignix Cloud PC: https://discord.com/channels/${guildId}/${order.channelId}`);
      await present(interaction, notice("Cliente avisado no privado.", app.config.panelColor));
    } catch {
      await present(interaction, notice("Não foi possível enviar a mensagem privada.", app.config.panelColor));
    }
    return true;
  }
  if (pay) {
    await ack(interaction, false);
    const result = await app.store.payment(pay[1]);
    if (!result.ok) {
      await present(interaction, notice(result.error, app.config.panelColor));
      return true;
    }
    const files = await chargeFiles(result.order);
    const view = renderChargePanel(result.order, { withQr: files.length > 0 });
    await interaction.editReply({ components: view.components, files, flags: V2_EPHEMERAL, allowedMentions: { parse: [] } });
    return true;
  }
  return false;
}

const panelSignatures = new Map();

export function offerChoices(offers, query) {
  const needle = String(query || "").toLowerCase();
  return offers
    .filter((offer) => `${offer.sku} ${offer.plan} ${offer.id}`.toLowerCase().includes(needle))
    .slice(0, 25)
    .map((offer) => ({ name: `${offer.sku} · ${offer.plan} · ${offer.unitsLeft} un.`.slice(0, 100), value: offer.id }));
}

export async function routeStoreAutocomplete(interaction, app) {
  if (interaction.commandName !== "remover-oferta") {
    await interaction.respond([]);
    return;
  }
  const offers = app.store.activeOffers(interaction.guildId);
  await interaction.respond(offerChoices(offers, interaction.options.getFocused()));
}

export async function editStorePanel(client, app) {
  for (const guildId of app.store.guilds()) {
    const settings = app.store.settings(guildId);
    if (!settings?.channelId || !settings.messageId) continue;
    try {
      await app.store.preparePanel(guildId);
      const view = app.store.panel(guildId);
      const signature = JSON.stringify(view.components);
      if (panelSignatures.get(settings.messageId) === signature) continue;
      const channel = await client.channels.fetch(settings.channelId);
      const message = await channel.messages.fetch(settings.messageId);
      await deliverComponents((body) => message.edit(body), view);
      panelSignatures.set(message.id, signature);
    } catch (error) {
      if (isStaleMessage(error)) {
        panelSignatures.delete(settings.messageId);
        await app.store.saveSettings(guildId, "sistema", { messageId: "" }).catch(() => {});
      }
      console.error(`Painel da loja [${error?.code ?? "erro"}]: ${error instanceof Error ? error.message : "erro"}`);
    }
  }
}
