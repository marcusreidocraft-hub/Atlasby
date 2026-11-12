import { ActionRowBuilder, ButtonStyle, ContainerBuilder, StringSelectMenuBuilder } from "discord.js";
import { PLAN_NAMES, formatBrl } from "./products.js";
import { quotePrice } from "./promotions.js";
import { emojiText } from "./emojis.js";
import { press, gallery, separator, text, V2 } from "../panels/ui.js";

const PLAN_ORDER = ["3h", "6h", "semanal", "quinzenal", "mensal"];
const PLAN_SHORT = { "3h": "3h", "6h": "6h", semanal: "7d", quinzenal: "15d", mensal: "30d" };

function priceLine(quote) {
  if (!quote) return "";
  if (quote.discount > 0) return `~~${formatBrl(quote.original)}~~ **${formatBrl(quote.total)}** · -${quote.percent}%`;
  return formatBrl(quote.total);
}

function plainPrice(quote) {
  return priceLine(quote).replaceAll(/[*~]/g, "").slice(0, 100);
}

function quotesFor(product, settings, offers, now) {
  return PLAN_ORDER.map((plan) => {
    const offer = offers.find((item) => item.sku === product.sku && item.plan === plan);
    const quote = quotePrice({
      product,
      plan,
      now,
      hoursEnabled: settings.hoursEnabled,
      overrides: { price3h: settings.price3h, price6h: settings.price6h },
      offer,
    });
    return quote ? { plan, quote } : null;
  }).filter(Boolean);
}

function compactAmount(item) {
  const label = PLAN_SHORT[item.plan] || item.plan;
  if (item.quote.discount > 0) return `${label} ~~${formatBrl(item.quote.original)}~~ **${formatBrl(item.quote.total)}**`;
  return `${label} **${formatBrl(item.quote.total)}**`;
}

function compactSpecs(product) {
  const ram = String(product.ramGib ?? product.ram ?? "").replace(/[^\d]/g, "") || "0";
  const disk = String(product.diskGb ?? "").replace(/[^\d]/g, "") || "512";
  return `-# ${ram}GB RAM / ${disk}GB SSD`;
}

function machineSelect(product, priced) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`atlas:store:pick:${product.sku}`)
    .setMinValues(1)
    .setMaxValues(1);
  if (product.purchasesEnabled === false || !priced.length) {
    return menu
      .setPlaceholder("Compras desativadas")
      .setDisabled(true)
      .addOptions({ label: "Compras desativadas", value: "indisponivel" });
  }
  return menu.setPlaceholder("Escolher seu plano").addOptions(priced.map((item) => ({
    label: (PLAN_SHORT[item.plan] || PLAN_NAMES[item.plan] || item.plan).slice(0, 100),
    description: plainPrice(item.quote),
    value: `${product.sku}:${item.plan}`,
  })));
}

export function renderStorePanel({ settings, products, offers, now }) {
  const root = new ContainerBuilder();
  const title = String(settings.title || "Atlas Cloud PC").replace(/^🎮\s*/, "").replace(/^<:[^>]+>\s*/, "");
  root.addTextDisplayComponents(
    text(`${emojiText("gaming")} **${title}**`),
    text(settings.description),
  );
  if (settings.bannerUrl?.startsWith("https://")) root.addMediaGalleryComponents(gallery(settings.bannerUrl));
  const visible = products.filter((item) => item.visible);
  visible.forEach((product, index) => {
    root.addSeparatorComponents(separator());
    const priced = quotesFor(product, settings, offers, now);
    const hours = priced.filter((item) => item.plan === "3h" || item.plan === "6h");
    const days = priced.filter((item) => item.plan !== "3h" && item.plan !== "6h");
    const open = product.purchasesEnabled !== false && priced.length > 0;
    const lines = [
      `**${product.gpu || "Tesla T4"} · ${product.vcpus} vCPU**`,
      compactSpecs(product),
      hours.length ? hours.map(compactAmount).join(" · ") : "",
      days.length ? days.map(compactAmount).join(" · ") : "",
      open ? "" : "Esgotado",
    ].filter(Boolean);
    root.addTextDisplayComponents(text(lines.join("\n")));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(machineSelect(product, priced)));
    if (index === visible.length - 1) return;
  });
  return { components: [root], flags: V2 };
}

export function renderOrder(order, product, { accent = 0x0a0a0a, supportRoleId = "" } = {}) {
  const root = new ContainerBuilder().setAccentColor(accent);
  const paid = order.status === "pago" || order.status === "entregue";
  root.addTextDisplayComponents(text([
    `## ${emojiText("ticket")} Pedido Atlas Cloud PC`,
    `${emojiText("arrow")} Cliente: <@${order.userId}>`,
    `${emojiText("gaming")} Produto: ${product?.headline || order.sku}`,
    `${emojiText("timer")} Plano: ${PLAN_NAMES[order.plan] || order.plan}`,
    `${emojiText("cash")} Valor original: ${formatBrl(order.originalCents)}`,
    `${emojiText("megaphone")} Desconto: ${formatBrl(order.discountCents)}`,
    `${emojiText("cash")} Total: ${formatBrl(order.totalCents)}`,
    `${paid ? emojiText("verified") : emojiText("warning")} Status: ${statusLabel(order.status)}`,
    order.assigneeId ? `${emojiText("staff")} Atendimento: <@${order.assigneeId}>` : "",
    supportRoleId ? `${emojiText("admin")} Equipe: <@&${supportRoleId}>` : "",
  ].filter(Boolean).join("\n")));
  root.addActionRowComponents(new ActionRowBuilder().addComponents(
    press(`atlas:store:claim:${order.id}`, "Assumir atendimento", ButtonStyle.Secondary, emojiText("staff")),
    press(`atlas:store:pay:${order.id}`, "Gerar pagamento", ButtonStyle.Primary, emojiText("cash")),
    press(`atlas:store:notify:${order.id}`, "Notificar cliente", ButtonStyle.Secondary, emojiText("bell")),
    press(`atlas:store:close:${order.id}`, "Fechar ticket", ButtonStyle.Danger, emojiText("warning")),
  ));
  return { components: [root], flags: V2 };
}

function statusLabel(status) {
  return {
    aguardando_pagamento: "Aguardando pagamento",
    pago: "Pago",
    provisionando: "Preparando a máquina",
    acompanhamento: "Acompanhamento",
    entregue: "Entregue",
    cancelado: "Cancelado",
    expirado: "Expirado",
  }[status] || status;
}

export { statusLabel };
