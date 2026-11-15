import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, LabelBuilder, ModalBuilder, SectionBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle, ThumbnailBuilder } from "discord.js";
import { gallery, notice, press, separator, V2, V2_EPHEMERAL } from "../panels/ui.js";
import { announcementFooter, announcementHeading, mentionAllows } from "./model.js";

function display(content) {
  return new TextDisplayBuilder().setContent(content);
}

export function renderAnnouncement(data) {
  const root = new ContainerBuilder().setAccentColor(data.color);
  const heading = announcementHeading(data.title, data.emoji);
  if (data.thumbnailUrl) {
    root.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(display(heading))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(data.thumbnailUrl).setDescription("Atlas Cloud PC")));
  } else {
    root.addTextDisplayComponents(display(heading));
  }
  root.addTextDisplayComponents(display(data.text));
  root.addSeparatorComponents(separator());
  if (data.imageUrl) root.addMediaGalleryComponents(gallery(data.imageUrl));
  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(display(announcementFooter(data.footer, data.publishedAt)));
  if (data.button) {
    root.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(data.button.label).setURL(data.button.url),
    ));
  }
  const components = [];
  if (data.mention?.text) components.push(display(data.mention.text));
  components.push(root);
  return { components, flags: V2, allowedMentions: mentionAllows(data.mention) };
}

export function renderAnnouncePreview(data, draftId) {
  const view = renderAnnouncement(data);
  const row = new ActionRowBuilder().addComponents(
    press(`atlas:anuncio:publish:${draftId}`, "Publicar", ButtonStyle.Success),
    press(`atlas:anuncio:edit:${draftId}`, "Editar", ButtonStyle.Secondary),
    press(`atlas:anuncio:cancel:${draftId}`, "Cancelar", ButtonStyle.Danger),
  );
  return { components: [...view.components, row], flags: V2_EPHEMERAL, allowedMentions: { parse: [] } };
}

export function renderAnnounceConfirm({ title, url, updated }) {
  const root = new ContainerBuilder();
  root.addTextDisplayComponents(display(`## ${updated ? "Anúncio atualizado" : "Anúncio publicado"}\n${title}\n${url}`));
  root.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Abrir mensagem").setURL(url),
  ));
  return { components: [root], flags: V2_EPHEMERAL, allowedMentions: { parse: [] } };
}

export function announceModal(draftId, data = {}) {
  const title = new TextInputBuilder().setCustomId("titulo").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(200).setPlaceholder("Título do anúncio");
  const text = new TextInputBuilder().setCustomId("texto").setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(1).setMaxLength(3500).setPlaceholder("Texto. Aceita markdown e vários parágrafos.");
  const footer = new TextInputBuilder().setCustomId("rodape").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200).setPlaceholder("Texto pequeno opcional");
  const image = new TextInputBuilder().setCustomId("imagem").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2000).setPlaceholder("https://");
  const button = new TextInputBuilder().setCustomId("botao").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2000).setPlaceholder("texto|https://");
  if (data.title) title.setValue(String(data.title).slice(0, 200));
  if (data.text) text.setValue(String(data.text).slice(0, 3500));
  if (data.footer) footer.setValue(String(data.footer).slice(0, 200));
  if (data.imageUrl && String(data.imageUrl).length <= 2000) image.setValue(String(data.imageUrl));
  if (data.button) {
    const packed = `${data.button.label}|${data.button.url}`;
    if (packed.length <= 2000) button.setValue(packed);
  }
  return new ModalBuilder()
    .setCustomId(`atlas:modal:anuncio:${draftId}`)
    .setTitle(data.title ? "Editar anúncio" : "Novo anúncio")
    .addLabelComponents(
      new LabelBuilder().setLabel("Título").setDescription("Uma linha. O emoji padrão fica ao lado.").setTextInputComponent(title),
      new LabelBuilder().setLabel("Texto").setDescription("Aceita markdown e vários parágrafos.").setTextInputComponent(text),
      new LabelBuilder().setLabel("Rodapé").setDescription("Texto pequeno opcional.").setTextInputComponent(footer),
      new LabelBuilder().setLabel("URL da imagem grande").setDescription("https opcional. O anexo tem prioridade.").setTextInputComponent(image),
      new LabelBuilder().setLabel("Botão").setDescription("Opcional, no formato texto|https://").setTextInputComponent(button),
    );
}

export function announceError(message, accent) {
  return notice(message, accent);
}
