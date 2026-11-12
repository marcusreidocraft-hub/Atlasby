import { AttachmentBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder } from "discord.js";
import { notice, V2, V2_EPHEMERAL } from "../panels/ui.js";
import { ack, present } from "../components/reply.js";
import { parseDate } from "../services/plans.js";
import { formatBrl } from "./products.js";
import { renderOrder } from "./panel.js";
import { STORE_COMMANDS } from "./commands.js";
import { attendanceOf, canAttend, renderAttendance, ticketOverwrites } from "./attendance.js";
import { emojiText } from "./emojis.js";
import { deliverComponents, isStaleMessage, publishStorePanel, panelLocation } from "./publish.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    if (sub === "banner") {
      await app.store.saveSettings(guildId, actor.id, { bannerUrl: interaction.options.getString("url") });
    } else if (sub === "texto") {
      await app.store.saveSettings(guildId, actor.id, { title: interaction.options.getString("titulo"), description: interaction.options.getString("descricao") });
    } else if (sub === "canal") {
      const category = interaction.options.getChannel("categoria");
      const current = app.store.settings(guildId);
      const location = panelLocation({
        currentChannelId: current.channelId,
        nextChannelId: interaction.options.getChannel("painel").id,
        messageId: current.messageId,
      });
      await app.store.saveSettings(guildId, actor.id, { ...location, ticketCategoryId: category?.id || "" });
    } else if (sub === "compras") {
      const result = await app.store.setPurchases(guildId, actor.id, {
        sku: interaction.options.getString("produto") || "",
        enabled: interaction.options.getString("acao") === "ativar",
      });
      if (!result.ok) {
        await present(interaction, notice(result.error, app.config.panelColor));
        return true;
      }
      const updated = await refresh(interaction, app).catch(() => false);
      await present(interaction, notice(updated ? "Compras atualizadas no painel." : "Compras atualizadas. Publique o painel para exibir.", app.config.panelColor));
      return true;
    } else if (sub === "produto") {
      const prices = Object.fromEntries(interaction.options.getString("precos").split(",").map((part) => part.split("=")).filter((pair) => pair.length === 2).map(([key, value]) => [key.trim(), Number(value)]));
      await app.store.saveProduct(guildId, actor.id, {
        sku: interaction.options.getString("sku"),
        name: interaction.options.getString("nome"),
        headline: interaction.options.getString("nome"),
        vmSize: interaction.options.getString("tamanho"),
        vcpus: interaction.options.getInteger("vcpus"),
        ram: interaction.options.getString("ram"),
        gpu: "GPU",
        prices,
        visible: true,
      });
    }
    const updated = await refresh(interaction, app).catch(() => false);
    await present(interaction, notice(updated ? "Loja atualizada no painel." : "Loja gravada. Publique o painel para exibir.", app.config.panelColor));
    return true;
  }
  if (name === "configurar-horas") {
    const price3h = app.store.parseMoney(interaction.options.getString("preco3") || "");
    const price6h = app.store.parseMoney(interaction.options.getString("preco6") || "");
    await app.store.setHours(guildId, actor.id, { enabled: interaction.options.getBoolean("ativo"), price3h, price6h });
    await refresh(interaction, app).catch(() => false);
    await present(interaction, notice("Planos por hora atualizados.", app.config.panelColor));
    return true;
  }
  if (name === "criar-oferta") {
    const start = parseDate(interaction.options.getString("inicio"));
    const end = parseDate(interaction.options.getString("fim"));
    const promo = app.store.parseMoney(interaction.options.getString("preco") || "");
    if (!start || !end || end <= start) {
      await present(interaction, notice("Informe início e fim válidos.", app.config.panelColor));
      return true;
    }
    const created = await app.store.createOffer(guildId, actor.id, {
      sku: interaction.options.getString("produto"), plan: interaction.options.getString("plano"),
      units: interaction.options.getInteger("unidades"), startsAt: start, endsAt: end,
      percent: interaction.options.getInteger("desconto"), promoCents: promo,
    });
    await refresh(interaction, app).catch(() => false);
    await present(interaction, notice(created.ok ? `Oferta ${created.offer.id} criada.` : created.error, app.config.panelColor));
    return true;
  }
  if (name === "remover-oferta") {
    const removed = await app.store.removeOffer(guildId, actor.id, interaction.options.getString("id"));
    await refresh(interaction, app).catch(() => false);
    await present(interaction, notice(removed.ok ? "Oferta removida." : removed.error, app.config.panelColor));
    return true;
  }
  if (name === "estoque") {
    app.store.settings(guildId);
    const products = app.repo.storeProducts(guildId);
    await present(interaction, notice(products.map((item) => `${item.headline}: ${item.stock}`).join("\n") || "Nenhum produto.", app.config.panelColor));
    return true;
  }
  if (name === "adicionar-estoque" || name === "remover-estoque") {
    const delta = interaction.options.getInteger("quantidade") * (name === "adicionar-estoque" ? 1 : -1);
    const changed = await app.store.changeStock(guildId, actor.id, interaction.options.getString("produto"), delta);
    await refresh(interaction, app).catch(() => false);
    await present(interaction, notice(changed.ok ? "Estoque atualizado." : changed.error, app.config.panelColor));
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
    await present(interaction, notice(cancelled.ok ? "Pedido cancelado. Se já houve pagamento, o reembolso é feito no painel da Wyvi." : cancelled.error, app.config.panelColor));
    return true;
  }
  return false;
}

async function ticketChannel(interaction, app, order) {
  const desk = attendanceOf(app.repo, app.config, interaction.guildId);
  return interaction.guild.channels.create({
    name: `pedido-${order.id.slice(0, 8)}`,
    type: ChannelType.GuildText,
    parent: desk.categoryId || null,
    permissionOverwrites: ticketOverwrites({
      everyoneId: interaction.guild.roles.everyone.id,
      userId: interaction.user.id,
      botId: interaction.client.user.id,
      staffRoleIds: desk.staffRoleIds,
    }),
  });
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
  if (id.startsWith("atlas:store:pick")) {
    await ack(interaction, false);
    await present(interaction, notice(`${emojiText("cart")} Preparando seu pedido... 3...`, app.config.panelColor));
    await sleep(700);
    await interaction.editReply({ components: notice("Preparando seu pedido... 2...", app.config.panelColor).components, flags: V2_EPHEMERAL, allowedMentions: { parse: [] } });
    await sleep(700);
    await interaction.editReply({ components: notice("Preparando seu pedido... 1...", app.config.panelColor).components, flags: V2_EPHEMERAL, allowedMentions: { parse: [] } });
    const chosen = app.store.choose(guildId, interaction.user.id, interaction.values?.[0] ?? "", interaction.user.username);
    if (!chosen.ok) {
      await present(interaction, notice(chosen.error, app.config.panelColor));
      return true;
    }
    try {
      const channel = await ticketChannel(interaction, app, chosen.order);
      const desk = attendanceOf(app.repo, app.config, guildId);
      const view = renderOrder(chosen.order, chosen.product, { accent: app.store.settings(guildId).accent, supportRoleId: desk.supportRoleId });
      const message = await channel.send({
        components: view.components,
        flags: V2,
        allowedMentions: desk.supportRoleId ? { roles: [desk.supportRoleId] } : { parse: [] },
      });
      app.store.rememberTicket(chosen.order.id, channel.id, message.id);
      await refresh(interaction, app).catch(() => false);
      await present(interaction, notice(`Pedido aberto em <#${channel.id}>.`, app.config.panelColor));
    } catch (error) {
      console.error(`Ticket: ${error instanceof Error ? error.message : "erro"}`);
      await app.store.close(guildId, interaction.user.id, chosen.order.id, "Falha ao abrir o canal.");
      await present(interaction, notice("Não foi possível abrir o pedido. O estoque foi devolvido.", app.config.panelColor));
    }
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
    await present(interaction, notice(closed.ok ? "Ticket fechado. O reembolso de um Pix pago é feito no painel da Wyvi." : closed.error, app.config.panelColor));
    return true;
  }
  if (notify) {
    await ack(interaction, true);
    const order = app.store.order(notify[1]);
    try {
      const user = await interaction.client.users.fetch(order.userId);
      await user.send(`Há uma atualização no seu pedido da Atlas Cloud PC: https://discord.com/channels/${guildId}/${order.channelId}`);
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
    let file = null;
    if (result.qrcode?.startsWith("data:image")) file = Buffer.from(result.qrcode.split(",")[1], "base64");
    else if (result.copiaECola) {
      const qr = await import("qrcode");
      file = await qr.toBuffer(result.copiaECola, { type: "png", width: 320, margin: 1 });
    }
    const payload = notice(`${emojiText("cash")} Pix copia e cola:\n${result.copiaECola}\n\n${emojiText("timer")} O pagamento expira em 1 hora. A máquina só é criada depois da confirmação da Wyvi.`, app.config.panelColor);
    const body = { components: payload.components, flags: V2_EPHEMERAL, allowedMentions: { parse: [] } };
    if (file) body.files = [new AttachmentBuilder(file, { name: "pix.png" })];
    await interaction.editReply(body);
    return true;
  }
  return false;
}

export async function editStorePanel(client, app, phase) {
  for (const guildId of app.store.guilds()) {
    if (!app.store.hasOffer(guildId)) continue;
    const settings = app.store.settings(guildId);
    if (!settings.channelId || !settings.messageId) continue;
    try {
      const channel = await client.channels.fetch(settings.channelId);
      const message = await channel.messages.fetch(settings.messageId);
      const view = app.store.panel(guildId, phase);
      await deliverComponents((body) => message.edit(body), view);
    } catch (error) {
      if (isStaleMessage(error)) await app.store.saveSettings(guildId, "sistema", { messageId: "" }).catch(() => {});
      console.error(`Painel da loja [${error?.code ?? "erro"}]: ${error instanceof Error ? error.message : "erro"}`);
    }
  }
}
