import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder } from "discord.js";
import { formatBrl } from "./products.js";
import { gallery, text, V2 } from "../panels/ui.js";

export const PIX_QR_FILE = "pix-qr.png";

export function chargeConfirmed(status) {
  return status === "pago" || status === "provisionando" || status === "acompanhamento" || status === "entregue";
}

function priceLines(order) {
  if (order.discountCents > 0) {
    return `Valor: ~~${formatBrl(order.originalCents)}~~ **${formatBrl(order.totalCents)}** · oferta de ${formatBrl(order.discountCents)}`;
  }
  return `Valor: **${formatBrl(order.totalCents)}**`;
}

function expiryLine(order) {
  const at = Number(order.pixExpiresAt);
  if (!Number.isFinite(at) || at <= 0) return "";
  return `Expira <t:${Math.floor(at / 1000)}:R>`;
}

export function renderChargePanel(order, { withQr = false } = {}) {
  const confirmed = chargeConfirmed(order.status);
  const expired = order.status === "expirado" || order.status === "cancelado";
  const status = confirmed ? "Pagamento confirmado" : expired ? "Expirado" : "Aguardando pagamento";
  const root = new ContainerBuilder();
  root.addTextDisplayComponents(text([
    confirmed ? "## Pagamento confirmado" : "## Pagamento",
    priceLines(order),
    `Status: **${status}**`,
    expiryLine(order),
  ].filter(Boolean).join("\n")));
  if (!confirmed && order.pixCode) root.addTextDisplayComponents(text(`\`\`\`\n${order.pixCode}\n\`\`\``));
  if (withQr && !confirmed && order.pixCode) root.addMediaGalleryComponents(gallery(`attachment://${PIX_QR_FILE}`));
  if (!confirmed && !expired && order.pixCode && order.id) {
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`atlas:store:copy:${order.id}`).setLabel("Copiar código").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`atlas:store:check:${order.id}`).setLabel("Já paguei").setStyle(ButtonStyle.Primary),
    ));
  }
  return { components: [root], flags: V2 };
}

export async function chargeFiles(order) {
  if (chargeConfirmed(order.status) || !order.pixCode) return [];
  const qr = await import("qrcode");
  const buffer = await qr.toBuffer(order.pixCode, { type: "png", width: 320, margin: 1 });
  return [new AttachmentBuilder(buffer, { name: PIX_QR_FILE })];
}
