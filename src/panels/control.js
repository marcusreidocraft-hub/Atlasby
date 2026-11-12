import { ActionRowBuilder, AttachmentBuilder, ButtonStyle, LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { PLAN_LABEL, formatStamp, planStatus, powerLabel, remainingLabel } from "../services/plans.js";
import { headlineOf } from "../services/vm-size.js";
import { attachmentGallery, container, heading, mark, press, text } from "./ui.js";

const CARD_FILE = "vm-card.png";

export function cardFacts(client, now) {
  const status = powerLabel(client.powerStatus);
  const state = planStatus(now, client.expiresAt);
  return {
    status,
    headline: headlineOf(client.gpu, client.vcpus),
    ip: client.publicIp || "não informado",
    time: remainingLabel(now, client.expiresAt),
    plan: `${PLAN_LABEL[client.planType] || client.planType || "Plano"} · ${state}`,
    consulted: formatStamp(client.lastQueryAt),
  };
}

function fallbackLines(client, now, emojis) {
  const card = cardFacts(client, now);
  const status = client.powerStatus === "ligada" ? mark(emojis, "ligada", card.status) : card.status;
  return [
    "**Atlas**",
    "Seu poder em nuvem",
    `Status: **${status}**`,
    `**${card.headline}**`,
    `**IP público** · ${card.ip}`,
    `**Tempo do plano** · ${card.time}`,
    `**Plano** · ${card.plan}`,
    `**Última consulta da VM** · ${card.consulted}`,
    "Use os botões abaixo para controlar sua máquina.",
    "Instância Spot: se desligar inesperadamente, tente ligá-la novamente.",
  ].join("\n");
}

export function renderMissing(accent) {
  return container(accent, (root) => {
    root.addTextDisplayComponents(text("Não há uma máquina vinculada à sua conta neste servidor."));
  });
}

export function renderControl(client, { accent, emojis, now, notice, image, agentLabel = "" }) {
  const on = client.powerStatus === "ligada";
  const payload = container(accent, (root) => {
    if (notice) root.addTextDisplayComponents(text(notice));
    root.addTextDisplayComponents(text(mark(emojis, "verified", `${client.clientName} autorizado com acesso completo.`)));
    if (image) root.addMediaGalleryComponents(attachmentGallery(CARD_FILE));
    else root.addTextDisplayComponents(text(fallbackLines(client, now, emojis)));
    if (agentLabel) root.addTextDisplayComponents(text(agentLabel));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      press("atlas:vm:power", on ? "Desligar VM" : "Ligar VM", on ? ButtonStyle.Primary : ButtonStyle.Success, on ? emojis.desligar : emojis.power),
      press("atlas:vm:pin", "Liberar PIN", ButtonStyle.Secondary, emojis.moonlight),
      press("atlas:vm:rdp", "Acesso RDP", ButtonStyle.Secondary, emojis.rdp),
      press("atlas:vm:format", "Formatar VM", ButtonStyle.Danger, emojis.alerta),
    ));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      press("atlas:vm:refresh", "Atualizar", ButtonStyle.Secondary, emojis.engrenagem),
      press("atlas:vm:unpair", "Desparear dispositivos", ButtonStyle.Secondary),
    ));
  });
  if (image) payload.files = [new AttachmentBuilder(image, { name: CARD_FILE })];
  return payload;
}

export function renderPinModal() {
  const field = new TextInputBuilder().setCustomId("pin").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(4).setMaxLength(4).setPlaceholder("4 dígitos");
  return new ModalBuilder()
    .setCustomId("atlas:modal:moonlight")
    .setTitle("Liberar PIN")
    .addLabelComponents(new LabelBuilder().setLabel("PIN do Moonlight").setDescription("Os 4 dígitos mostrados na tela do Moonlight.").setTextInputComponent(field));
}

export function renderPinResult(accent, message) {
  return container(accent, (root) => {
    root.addTextDisplayComponents(text(`## Liberar PIN\n${message}`));
  });
}

export function renderUnpairConfirm(client, confirmation, accent) {
  return container(0xed4245, (root) => {
    root.addTextDisplayComponents(text([
      "## Desparear dispositivos",
      `Isso remove os aparelhos pareados no Sunshine de **${client.machineName}**.`,
      `A confirmação expira <t:${Math.floor(confirmation.expiresAt / 1000)}:R>.`,
    ].join("\n")));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      press(`atlas:vm:unpair:yes:${confirmation.id}`, "Confirmar", ButtonStyle.Danger),
      press(`atlas:vm:unpair:no:${confirmation.id}`, "Cancelar", ButtonStyle.Secondary),
    ));
  });
}

export function renderPlan(client, { accent, now, emojis = {} }) {
  const state = planStatus(now, client.expiresAt);
  return container(accent, (root) => {
    root.addTextDisplayComponents(text([
      heading(emojis, "star", "Seu plano"),
      mark(emojis, "member", `Cliente: ${client.clientName}`),
      mark(emojis, "monitor", `Máquina: ${client.machineName}`),
      mark(emojis, "vip", `Plano: ${PLAN_LABEL[client.planType] || client.planType}`),
      `Início: ${formatStamp(client.startedAt)}`,
      mark(emojis, "cash", `Vencimento: ${formatStamp(client.expiresAt)}`),
      mark(emojis, "calendario", `Tempo restante: ${remainingLabel(now, client.expiresAt)}`),
      mark(emojis, state === "Ativo" ? "verified" : "alerta", `Status: ${state}`),
    ].join("\n")));
  });
}

export function renderSecret(title, lines, accent, emoji) {
  const heading = emoji ? `${emoji} ${title}` : title;
  return container(accent, (root) => {
    root.addTextDisplayComponents(text(`## ${heading}\n${lines.join("\n")}\n\n-# Esta resposta é só sua e não fica no canal.`));
  });
}
