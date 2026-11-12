import { ActionRowBuilder, ButtonStyle, ContainerBuilder, StringSelectMenuBuilder } from "discord.js";
import { PLAN_NAMES, formatBrl } from "./products.js";
import { quotePrice } from "./promotions.js";
import { press, gallery, separator, text, V2 } from "../panels/ui.js";

function priceLine(quote) {
  if (!quote) return "";
  if (quote.discount > 0) return `~~${formatBrl(quote.original)}~~ **${formatBrl(quote.total)}** · -${quote.percent}%`;
  return formatBrl(quote.total);
}

export function renderStorePanel({ settings, products, offers, now, phase = 0 }) {
  const root = new ContainerBuilder().setAccentColor(settings.accent || 0x0a0a0a);
  if (settings.bannerUrl?.startsWith("https://")) root.addMediaGalleryComponents(gallery(settings.bannerUrl));
  root.addTextDisplayComponents(text(`## ${settings.title}`), text(settings.description));
  const options = [];
  for (const product of products.filter((item) => item.visible)) {
    const plans = Object.keys(product.prices || {});
    const lines = [product.headline, product.specs];
    const priced = plans
      .map((plan) => {
        const offer = offers.find((item) => item.sku === product.sku && item.plan === plan);
        return { plan, quote: quotePrice({
          product: { ...product, prices: product.prices },
          plan,
          now,
          hoursEnabled: settings.hoursEnabled,
          overrides: { price3h: settings.price3h, price6h: settings.price6h },
          offer,
        }) };
      })
      .filter((item) => item.quote);
    if (priced.some((item) => item.quote.discount > 0)) {
      lines.push(phase % 2 === 0 ? "🔥 PROMOÇÃO ONLINE!" : "🔥 Oferta por tempo limitado");
    }
    lines.push(priced.map((item) => `${PLAN_NAMES[item.plan] || item.plan} ${priceLine(item.quote)}`).join(" · ") || "Preço sob consulta");
    lines.push(product.stock > 0 ? "🛒 Escolher seu plano" : "Sem estoque no momento");
    root.addSeparatorComponents(separator());
    root.addTextDisplayComponents(text(lines.join("\n")));
    if (product.stock > 0) {
      for (const item of priced) {
        options.push({
          label: `${product.headline} — ${PLAN_NAMES[item.plan] || item.plan}`.slice(0, 100),
          description: priceLine(item.quote).replaceAll(/[*~]/g, "").slice(0, 100),
          value: `${product.sku}:${item.plan}`,
        });
      }
    }
  }
  if (options.length) {
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("atlas:store:pick")
        .setPlaceholder("🛒 Escolha seu plano")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options.slice(0, 25)),
    ));
  }
  return { components: [root], flags: V2 };
}

export function renderOrder(order, product, { accent = 0x0a0a0a } = {}) {
  const root = new ContainerBuilder().setAccentColor(accent);
  root.addTextDisplayComponents(text([
    "## 🛒 Pedido Atlas Cloud PC",
    `Cliente: <@${order.userId}>`,
    `Produto: ${product?.headline || order.sku}`,
    `Plano: ${PLAN_NAMES[order.plan] || order.plan}`,
    `Valor original: ${formatBrl(order.originalCents)}`,
    `Desconto: ${formatBrl(order.discountCents)}`,
    `Total: ${formatBrl(order.totalCents)}`,
    `Status: ${statusLabel(order.status)}`,
    order.assigneeId ? `Atendimento: <@${order.assigneeId}>` : "",
  ].filter(Boolean).join("\n")));
  root.addActionRowComponents(new ActionRowBuilder().addComponents(
    press(`atlas:store:claim:${order.id}`, "Assumir atendimento", ButtonStyle.Secondary),
    press(`atlas:store:pay:${order.id}`, "Gerar pagamento", ButtonStyle.Primary),
    press(`atlas:store:notify:${order.id}`, "Notificar cliente", ButtonStyle.Secondary),
    press(`atlas:store:close:${order.id}`, "Fechar ticket", ButtonStyle.Danger),
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
