import { ActionRowBuilder, ButtonStyle, ContainerBuilder, StringSelectMenuBuilder } from "discord.js";
import { PLAN_NAMES, formatBrl } from "./products.js";
import { quotePrice } from "./promotions.js";
import { emojiText, machineEmoji, STORE_EMOJI } from "./emojis.js";
import { press, gallery, separator, text, V2 } from "../panels/ui.js";

const PLAN_ORDER = ["3h", "6h", "semanal", "quinzenal", "mensal"];

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

function machineSelect(product, priced) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`atlas:store:pick:${product.sku}`)
    .setMinValues(1)
    .setMaxValues(1);
  if (!priced.length || product.stock <= 0) {
    return menu
      .setPlaceholder("Sem estoque no momento")
      .setDisabled(true)
      .addOptions({ label: "Sem estoque", value: "indisponivel", emoji: STORE_EMOJI.off });
  }
  return menu.setPlaceholder("Escolher seu plano").addOptions(priced.map((item) => ({
    label: (PLAN_NAMES[item.plan] || item.plan).slice(0, 100),
    description: plainPrice(item.quote),
    value: `${product.sku}:${item.plan}`,
    emoji: STORE_EMOJI.cart,
  })));
}

export function renderStorePanel({ settings, products, offers, now, phase = 0 }) {
  const root = new ContainerBuilder().setAccentColor(settings.accent || 0x0a0a0a);
  if (settings.bannerUrl?.startsWith("https://")) root.addMediaGalleryComponents(gallery(settings.bannerUrl));
  const title = String(settings.title || "Atlas Cloud PC").replace(/^🎮\s*/, "");
  root.addTextDisplayComponents(
    text(`## ${emojiText("monitor")} ${title}`),
    text(settings.description),
  );
  const visible = products.filter((item) => item.visible);
  visible.forEach((product, index) => {
    if (index > 0) root.addSeparatorComponents(separator());
    const priced = quotesFor(product, settings, offers, now);
    const lines = [
      `## ${emojiText(machineEmoji(product.vcpus))} ${product.headline}`,
      `${emojiText("windows")} ${emojiText("tools")} ${product.specs}`,
    ];
    if (priced.some((item) => item.quote.discount > 0)) {
      lines.push(phase % 2 === 0
        ? `${emojiText("megaphone")} PROMOÇÃO ONLINE!`
        : `${emojiText("star")} Oferta por tempo limitado`);
    }
    for (const item of priced) {
      const promo = item.quote.discount > 0 ? `${emojiText("megaphone")} ` : "";
      lines.push(`${emojiText("timer")} ${PLAN_NAMES[item.plan] || item.plan} · ${promo}${emojiText("cash")} ${priceLine(item.quote)}`);
    }
    if (!priced.length) lines.push(`${emojiText("warning")} Preço sob consulta`);
    root.addTextDisplayComponents(text(lines.join("\n")));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(machineSelect(product, product.stock > 0 ? priced : [])));
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
