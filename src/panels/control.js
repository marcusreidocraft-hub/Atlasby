import { ActionRowBuilder, ButtonStyle } from "discord.js";
import { PLAN_LABEL, formatStamp, planStatus, powerLabel, remainingLabel } from "../services/plans.js";
import { container, press, section, separator, text } from "./ui.js";

export function renderMissing(accent) {
  return container(accent, (root) => {
    root.addTextDisplayComponents(text("Não há uma máquina vinculada à sua conta neste servidor."));
  });
}

export function renderControl(client, { accent, emojis, bannerUrl, now, notice }) {
  const status = powerLabel(client.powerStatus);
  const on = client.powerStatus === "ligada";
  const header = `**${client.machineName}**\nSua Máquina\n\n**${client.gpu} · ${client.vcpus} vCPU · ${client.ram}**\nStatus: **${status}**`;
  const facts = [
    `**IP público** · ${client.publicIp || "não informado"}`,
    `**Tempo do plano** · ${remainingLabel(now, client.expiresAt)}`,
    `**Plano** · ${PLAN_LABEL[client.planType] || client.planType} · ${planStatus(now, client.expiresAt)}`,
    `**Última consulta da VM** · ${formatStamp(client.lastQueryAt)}`,
  ].join("\n");
  return container(accent, (root) => {
    if (notice) root.addTextDisplayComponents(text(notice));
    root.addTextDisplayComponents(text(`${client.clientName} autorizado com acesso completo.`));
    root.addSeparatorComponents(separator());
    root.addSectionComponents(section(header, {
      bannerUrl,
      button: press("atlas:vm:status", status, on ? ButtonStyle.Success : ButtonStyle.Secondary, emojis.power).setDisabled(false),
    }));
    root.addTextDisplayComponents(text(facts));
    root.addSeparatorComponents(separator());
    root.addTextDisplayComponents(text("Use os botões abaixo para controlar sua máquina.\nInstância Spot: se desligar inesperadamente, tente ligá-la novamente."));
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

export function renderPlan(client, { accent, now }) {
  return container(accent, (root) => {
    root.addTextDisplayComponents(text([
      "## Seu plano",
      `Cliente: ${client.clientName}`,
      `Máquina: ${client.machineName}`,
      `Plano: ${PLAN_LABEL[client.planType] || client.planType}`,
      `Início: ${formatStamp(client.startedAt)}`,
      `Vencimento: ${formatStamp(client.expiresAt)}`,
      `Tempo restante: ${remainingLabel(now, client.expiresAt)}`,
      `Status: ${planStatus(now, client.expiresAt)}`,
    ].join("\n")));
  });
}

export function renderSecret(title, lines, accent) {
  return container(accent, (root) => {
    root.addTextDisplayComponents(text(`## ${title}\n${lines.join("\n")}\n\n-# Esta resposta é só sua e não fica no canal.`));
  });
}
