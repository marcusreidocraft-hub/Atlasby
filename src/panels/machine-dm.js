import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder } from "discord.js";
import { gallery, separator, text, V2 } from "./ui.js";

export function channelLink(guildId, channelId) {
  if (!/^\d{17,20}$/.test(String(guildId || "")) || !/^\d{17,20}$/.test(String(channelId || ""))) return "";
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

export function machineLinks(repo, config, guildId) {
  const settings = repo?.getSettings?.(guildId) || {};
  const support = String(settings.supportUrl || config?.supportUrl || "");
  return {
    supportUrl: /^https:\/\//i.test(support) ? support : "",
    panelUrl: channelLink(guildId, repo?.latestPanel?.(guildId)),
  };
}

export function diskLabel({ diskMode = "", dataGb = 0, diskGb = 0 } = {}) {
  if (diskMode === "v2" && dataGb) return `SSD Premium · SSD v2 ${dataGb} GB`;
  if (diskMode === "premium") return "SSD Premium";
  if (Number(diskGb) === 2560) return "2,5 TB SSD v2";
  if (diskGb) return `SSD v2 ${diskGb} GB`;
  return "";
}

function configuration(input) {
  const parts = [];
  if (input.gpu) parts.push(input.gpu);
  if (input.vcpus) parts.push(`${input.vcpus} vCPUs`);
  if (input.ram) parts.push(input.ram);
  const disk = input.disk || diskLabel(input);
  if (disk) parts.push(disk);
  return parts.join(" · ");
}

export function machineNoticeText(input) {
  if (input.kind === "venceu") {
    return `Seu plano da Ignix Cloud PC em ${input.machineName} venceu. A máquina foi desligada e não foi apagada.`;
  }
  return `Sua máquina da Ignix Cloud PC está pronta: ${input.machineName}. IP: ${input.ip || "ainda não publicado"}.`;
}

export function renderMachineNotice(input) {
  const expired = input.kind === "venceu";
  const root = new ContainerBuilder().setAccentColor(input.accent ?? 0x5865f2);
  if (input.bannerUrl) root.addMediaGalleryComponents(gallery(input.bannerUrl));
  const blocks = [
    `## ${expired ? "⚠️ Seu plano venceu" : "🎮 Sua máquina está pronta"}`,
    `**Máquina**\n\`${input.machineName || "máquina"}\``,
  ];
  const config = configuration(input);
  if (config) blocks.push(`**Configuração**\n${config}`);
  blocks.push(`**Acesso**\nIP ${input.ip ? `\`${input.ip}\`` : "ainda não publicado"}`);
  const plan = [input.planLabel, input.startedAt ? `Início ${input.startedAt}` : "", input.expiresAt ? `Vencimento ${input.expiresAt}` : ""].filter(Boolean);
  if (plan.length) blocks.push(`**Plano**\n${plan.join("\n")}`);
  blocks.push(expired
    ? "A máquina foi desligada e não foi apagada. Para renovar, fale com a equipe pelo suporte."
    : "No Moonlight, adicione o IP e pareie o aparelho. No painel do servidor, use Controlar VM para ligar a máquina e liberar o PIN.");
  blocks.push("-# Ignix Cloud PC");
  blocks.forEach((block, index) => {
    if (index) root.addSeparatorComponents(separator());
    root.addTextDisplayComponents(text(block));
  });
  const buttons = [];
  if (input.panelUrl) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(input.panelUrl).setLabel("Abrir painel"));
  if (input.supportUrl) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(input.supportUrl).setLabel("Suporte"));
  if (buttons.length) root.addActionRowComponents(new ActionRowBuilder().addComponents(...buttons));
  return { components: [root], flags: V2, fallback: machineNoticeText(input) };
}

export async function sendMachineNotice(user, view) {
  try {
    await user.send({ components: view.components, flags: V2, allowedMentions: { parse: [] } });
    return "componentes";
  } catch {
    try {
      await user.send(view.fallback);
      return "texto";
    } catch {
      return "";
    }
  }
}
