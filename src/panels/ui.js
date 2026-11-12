import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";
import { buttonEmoji } from "../services/emojis.js";

export const V2 = MessageFlags.IsComponentsV2;
export const V2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

export function text(content) {
  return new TextDisplayBuilder().setContent(String(content).slice(0, 3900));
}

export function separator() {
  return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

export function press(customId, label, style, emoji) {
  const button = new ButtonBuilder().setCustomId(customId).setLabel(String(label).slice(0, 80)).setStyle(style);
  if (emoji) button.setEmoji(buttonEmoji(emoji));
  return button;
}

export function container(accent, build) {
  const root = new ContainerBuilder().setAccentColor(accent);
  build(root);
  return { components: [root], flags: V2_EPHEMERAL };
}

export function gallery(url) {
  return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(url).setDescription("Atlas Cloud PC"));
}

export function section(content, { bannerUrl, button }) {
  const block = new SectionBuilder().addTextDisplayComponents(text(content));
  if (bannerUrl) block.setThumbnailAccessory(new ThumbnailBuilder().setURL(bannerUrl).setDescription("Atlas Cloud PC"));
  else block.setButtonAccessory(button);
  return block;
}

export function notice(message, accent, extra = []) {
  return container(accent, (root) => {
    root.addTextDisplayComponents(text(message));
    for (const row of extra) root.addActionRowComponents(row);
  });
}

export { ButtonStyle };
