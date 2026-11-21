import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, SectionBuilder, ThumbnailBuilder } from "discord.js";
import { dataDiskLabel, formatBrl } from "./products.js";
import { text, V2 } from "../panels/ui.js";

export function purchaseSpecs(product) {
  if (!product) return "";
  const ram = String(product.ram || "").trim();
  const ramLabel = ram ? ( /ram/i.test(ram) ? ram : `${ram} RAM` ).replace(/(\d)\s+GB/gi, "$1GB") : "";
  const disk = product.diskGb ? dataDiskLabel(product.diskGb).replace(/(\d)\s+GB/gi, "$1GB") : "";
  return [ramLabel, disk].filter(Boolean).join(" · ");
}

export function chargeLive(order, now = Date.now()) {
  if (!order?.pixCode || order.status !== "aguardando_pagamento") return false;
  return !order.pixExpiresAt || order.pixExpiresAt > now;
}

function priceLine(order) {
  if (order.discountCents > 0) return `Valor: ~~${formatBrl(order.originalCents)}~~ **${formatBrl(order.totalCents)}**`;
  return `Valor: **${formatBrl(order.totalCents)}**`;
}

export function renderPurchaseSummary({ order, product, userId, userName, avatarUrl, payDisabled = false }) {
  const specs = purchaseSpecs(product);
  const duration = order.duration || "";
  const lines = [
    "## Resumo da compra",
    `<@${userId}> · ${userName || "Cliente"}`,
    `**${product?.name || product?.headline || order.sku}**`,
    specs,
    duration ? `Duração: ${duration}` : "",
    priceLine(order),
    `ID: \`${order.id}\``,
  ].filter(Boolean);
  const root = new ContainerBuilder();
  const section = new SectionBuilder().addTextDisplayComponents(text(lines.join("\n")));
  if (/^https:\/\//i.test(avatarUrl || "")) {
    section.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl).setDescription(userName || "Cliente"));
  }
  root.addSectionComponents(section);
  const pay = new ButtonBuilder()
    .setCustomId(`atlas:store:pay:${order.id}`)
    .setLabel("Gerar pagamento")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(payDisabled || order.status !== "aguardando_pagamento");
  const cancel = new ButtonBuilder()
    .setCustomId(`atlas:store:cancel:${order.id}`)
    .setLabel("Cancelar pedido")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(order.status !== "aguardando_pagamento");
  root.addActionRowComponents(new ActionRowBuilder().addComponents(pay, cancel));
  return { components: [root], flags: V2 };
}
