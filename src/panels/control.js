import { ActionRowBuilder, ButtonStyle } from "discord.js";
import { PLAN_LABEL, formatStamp, planStatus, powerLabel, remainingLabel } from "../services/plans.js";
import { container, heading, mark, press, section, separator, text } from "./ui.js";

export function renderMissing(accent) {
  return container(accent, (root) => {
    root.addTextDisplayComponents(text("Não há uma máquina vinculada à sua conta neste servidor."));
  });
}

export function renderControl(client, { accent, emojis, bannerUrl, now, notice }) {
  const status = powerLabel(client.powerStatus);
  const on = client.powerStatus === "ligada";
  const state = planStatus(now, client.expiresAt);
  const header = [
    mark(emojis, "monitor", `**${client.machineName}**`),
    "Sua Máquina",
    "",
    mark(emojis, "windows", `**${client.gpu} · ${client.vcpus} vCPU · ${client.ram}**`),
    `Status: **${status}**`,
  ].join("\n");
  const facts = [
    mark(emojis, "world", `**IP público** · ${client.publicIp || "não informado"}`),
    mark(emojis, "calendario", `**Tempo do plano** · ${remainingLabel(now, client.expiresAt)}`),
    mark(emojis, "vip", `**Plano** · ${PLAN_LABEL[client.planType] || client.planType} · ${state}`),
    mark(emojis, "bell", `**Última consulta da VM** · ${formatStamp(client.lastQueryAt)}`),
  ].join("\n");
  return container(accent, (root) => {
    if (notice) root.addTextDisplayComponents(text(notice));
    root.addTextDisplayComponents(text(mark(emojis, "verified", `${client.clientName} autorizado com acesso completo.`)));
    root.addSeparatorComponents(separator());
    root.addSectionComponents(section(header, {
      bannerUrl,
      button: press("atlas:vm:status", status, on ? ButtonStyle.Success : ButtonStyle.Secondary, emojis.power).setDisabled(false),
    }));
    root.addTextDisplayComponents(text(facts));
    root.addSeparatorComponents(separator());
    root.addTextDisplayComponents(text(mark(emojis, "megaphone", "Use os botões abaixo para controlar sua máquina.\nInstância Spot: se desligar inesperadamente, tente ligá-la novamente.")));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      press("atlas:vm:power", on ? "Desligar VM" : "Ligar VM", on ? ButtonStyle.Primary : ButtonStyle.Success, emojis.power),
      press("atlas:vm:pin", "PIN Moonlight", ButtonStyle.Secondary, emojis.moonlight),
      press("atlas:vm:rdp", "Acesso RDP", ButtonStyle.Secondary, emojis.rdp),
      press("atlas:vm:format", "Formatar VM", ButtonStyle.Danger, emojis.alerta),
    ));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      press("atlas:vm:refresh", "Atualizar", ButtonStyle.Secondary, emojis.engrenagem),
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
