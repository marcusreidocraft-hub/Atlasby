import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { buttonEmoji } from "../services/emojis.js";
import { press, gallery, separator, text } from "./ui.js";
import { ContainerBuilder } from "discord.js";
import { V2 } from "./ui.js";

export function renderPublicPanel({ accent, emojis, supportUrl, bannerUrl }) {
  const root = new ContainerBuilder().setAccentColor(accent);
  if (bannerUrl) root.addMediaGalleryComponents(gallery(bannerUrl));
  root.addTextDisplayComponents(
    text(`## ${emojis.controle} Sua Máquina`),
    text("Clique abaixo para consultar seu plano e acessar os controles da sua máquina. Precisa de ajuda? Acesse o canal de suporte para abrir um ticket."),
    text(`-# As informações do seu plano e da sua máquina aparecem somente para você.\n-# Atlas Cloud PC`),
  );
  root.addSeparatorComponents(separator());
  root.addActionRowComponents(new ActionRowBuilder().addComponents(
    press("atlas:panel:control", "Controlar VM", ButtonStyle.Primary, emojis.controle),
    press("atlas:panel:plan", "Consultar plano", ButtonStyle.Secondary, emojis.calendario),
  ));
  if (supportUrl) {
    const link = new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(supportUrl).setLabel("Suporte / Tickets").setEmoji(buttonEmoji(emojis.ticket));
    root.addActionRowComponents(new ActionRowBuilder().addComponents(link));
  }
  return { components: [root], flags: V2 };
}
