import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";
import { TERMS_EMOJI, TERMS_INTRO, TERMS_SECTIONS, TERMS_TITLE, supportLabel } from "../content/termos.js";
import { formatDate } from "../services/plans.js";

const TEXT_LIMIT = 4000;
const MESSAGE_BUDGET = 3200;
const SECTIONS_PER_MESSAGE = 3;

function block(content) {
  if (content.length < 1 || content.length > TEXT_LIMIT) {
    throw new Error(`Bloco dos termos fora do limite (${content.length}).`);
  }
  return content;
}

export function termsBlocks({ supportUrl = "" } = {}) {
  const support = supportLabel(supportUrl);
  const blocks = [
    block(`## ${TERMS_EMOJI} ${TERMS_TITLE}\n\n**${TERMS_INTRO}**`),
  ];
  for (const section of TERMS_SECTIONS) {
    const paragraphs = section.paragraphs.map((paragraph) => paragraph.replaceAll("{suporte}", support));
    blocks.push(block(`## ${section.number}. ${section.title}\n\n${paragraphs.join("\n\n")}`));
  }
  return blocks;
}

function pack(blocks) {
  const groups = [];
  let current = [];
  let size = 0;
  let sections = 0;
  for (const item of blocks) {
    const isHeader = current.length === 0 && groups.length === 0 && item.startsWith("## <:");
    const nextSections = sections + (isHeader ? 0 : 1);
    const overflow = current.length > 0 && (size + item.length > MESSAGE_BUDGET || nextSections > SECTIONS_PER_MESSAGE);
    if (overflow) {
      groups.push(current);
      current = [];
      size = 0;
      sections = 0;
    }
    current.push(item);
    size += item.length;
    if (!item.startsWith(`## ${TERMS_EMOJI}`)) sections += 1;
  }
  if (current.length) groups.push(current);
  return groups;
}

export function renderTermsMessages({ supportUrl = "", publishedAt = Date.now() } = {}) {
  const groups = pack(termsBlocks({ supportUrl }));
  const footer = block(`-# Última atualização: ${formatDate(publishedAt)}`);
  const last = groups[groups.length - 1];
  const used = last.reduce((sum, item) => sum + item.length, 0);
  if (used + footer.length > TEXT_LIMIT) groups.push([footer]);
  else last.push(footer);
  return groups.map((group) => {
    const root = new ContainerBuilder();
    for (const item of group) root.addTextDisplayComponents(new TextDisplayBuilder().setContent(item));
    const payload = { components: [root], flags: MessageFlags.IsComponentsV2 };
    const raw = JSON.stringify(payload.components.map((component) => component.toJSON()));
    if (raw.length > 0 && group.reduce((sum, item) => sum + item.length, 0) > TEXT_LIMIT) {
      throw new Error("Mensagem dos termos passou de 4000 caracteres.");
    }
    return payload;
  });
}
