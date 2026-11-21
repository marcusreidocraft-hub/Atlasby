import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, StringSelectMenuBuilder } from "discord.js";
import { PLAN_NAMES, STORE_DESCRIPTION, STORE_NAME, dataDiskLabel, formatBrl } from "./products.js";
import { offerApplies, quotePrice } from "./promotions.js";
import { fitsPlan } from "./availability.js";
import { emojiText } from "./emojis.js";
import { press, gallery, separator, text, V2 } from "../panels/ui.js";

const PLAN_ORDER = ["semanal", "quinzenal", "mensal"];
const PLAN_SHORT = { semanal: "7d", quinzenal: "15d", mensal: "30d" };
const PLAN_LABEL = { semanal: "7 dias", quinzenal: "15 dias", mensal: "30 dias" };

function priceLine(quote) {
  if (!quote) return "";
  if (quote.discount > 0) return `~~${formatBrl(quote.original)}~~ **${formatBrl(quote.total)}** · -${quote.percent}%`;
  return formatBrl(quote.total);
}

function plainPrice(quote) {
  return priceLine(quote).replaceAll(/[*~]/g, "").slice(0, 100);
}

function quotesFor(product, offers, now) {
  return (product.plans || PLAN_ORDER).map((plan) => {
    const offer = offers.find((item) => item.sku === product.sku && item.plan === plan);
    const quote = quotePrice({ product, plan, now, hoursEnabled: true, offer });
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

function machineSelect(product, priced, open) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`atlas:store:pick:${product.sku}`)
    .setMinValues(1)
    .setMaxValues(1);
  if (!open || !priced.length) {
    return menu.setPlaceholder("Indisponível").setDisabled(true).addOptions({ label: "Indisponível", value: "indisponivel" });
  }
  return menu.setPlaceholder("Escolher duração").addOptions(priced.map((item) => ({
    label: (PLAN_LABEL[item.plan] || PLAN_NAMES[item.plan] || item.plan).slice(0, 100),
    description: plainPrice(item.quote),
    value: `${product.sku}:${item.plan}`,
  })));
}

function offerLines(offers, products, now) {
  return offers.filter((offer) => offerApplies(offer, offer.sku, offer.plan, now)).map((offer) => {
    const product = products.find((item) => item.sku === offer.sku);
    const original = product?.prices?.[offer.plan];
    const percent = original ? Math.round(((original - offer.promoCents) / original) * 100) : 0;
    const name = product?.name || offer.sku;
    return [
      `**${name} · ${PLAN_NAMES[offer.plan] || offer.plan}**`,
      original ? `~~${formatBrl(original)}~~ **${formatBrl(offer.promoCents)}** · -${percent}%` : formatBrl(offer.promoCents),
      `${offer.unitsLeft} ${offer.unitsLeft === 1 ? "unidade" : "unidades"} · acaba <t:${Math.floor(offer.endsAt / 1000)}:R>`,
    ].join("\n");
  });
}

export function renderStorePanel({ settings = {}, products, offers = [], now, capacity = { ok: false }, bannerUrl = "", supportUrl = "" }) {
  const root = new ContainerBuilder().setAccentColor(0x111111);
  if (bannerUrl?.startsWith("https://")) root.addMediaGalleryComponents(gallery(bannerUrl));
  root.addTextDisplayComponents(text([
    `${settings.headerEmoji || emojiText("gaming")} **${STORE_NAME}**`,
    STORE_DESCRIPTION,
  ].join("\n")));
  const visible = products.filter((item) => item.visible !== false);
  for (const product of visible) {
    root.addSeparatorComponents(separator());
    const priced = quotesFor(product, offers, now);
    const open = settings.purchasesEnabled !== false && fitsPlan(product.vcpus, product.azure?.spot, capacity) && priced.length > 0;
    const from = priced.length ? Math.min(...priced.map((item) => item.quote.total)) : null;
    root.addTextDisplayComponents(text([
      `**${product.name || product.headline}**`,
      `GPU ${product.gpu || "Tesla T4"} · ${product.vcpus} vCPUs · ${product.ram || `${product.ramGib || ""} GB`} · ${dataDiskLabel(product.diskGb || 512)}`,
      from != null ? `A partir de **${formatBrl(from)}**` : "",
      priced.map(compactAmount).join("\n"),
      open ? "" : "Indisponível",
    ].filter(Boolean).join("\n")));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(machineSelect(product, priced, open)));
  }
  const promos = offerLines(offers, visible, now);
  if (promos.length) {
    root.addSeparatorComponents(separator());
    root.addTextDisplayComponents(text(["**Ofertas**", ...promos].join("\n\n")));
  }
  root.addSeparatorComponents(separator());
  const foot = ["Pix com entrega automática da máquina.", settings.purchasesEnabled === false ? "Compras pausadas." : "", "-# Ignix Cloud PC"].filter(Boolean);
  root.addTextDisplayComponents(text(foot.join("\n")));
  if (/^https:\/\//i.test(supportUrl)) {
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(supportUrl).setLabel("Suporte"),
    ));
  }
  return { components: [root], flags: V2 };
}

export function renderOrder(order, product, { accent = 0x0a0a0a, supportRoleId = "" } = {}) {
  const root = new ContainerBuilder().setAccentColor(accent);
  const paid = order.status === "pago" || order.status === "entregue";
  root.addTextDisplayComponents(text([
    `## ${emojiText("ticket")} Pedido Ignix Cloud PC`,
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
