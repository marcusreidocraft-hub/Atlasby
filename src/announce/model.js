import { formatDate } from "../services/plans.js";

export const DEFAULT_ANNOUNCE_EMOJI = "<:megaphone:1568512322450882665>";
const TEXT_BUDGET = 3900;

export function parseHttps(value, label) {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: true, url: "" };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: `${label} precisa ser um link https.` };
  }
  if (url.protocol !== "https:") return { ok: false, error: `${label} precisa começar com https.` };
  if (url.toString().length > 2000) return { ok: false, error: `${label} é longo demais.` };
  return { ok: true, url: url.toString() };
}

export function parseHexColor(value, fallback) {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: true, color: fallback };
  const match = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(raw);
  if (!match) return { ok: false, error: "A cor precisa ser hexadecimal, como #1A1A1A." };
  const hex = match[1].length === 3 ? match[1].split("").map((char) => char + char).join("") : match[1];
  return { ok: true, color: Number.parseInt(hex, 16) };
}

export function parseMention(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: true, mention: null };
  if (/^@?everyone$/i.test(raw)) return { ok: true, mention: { type: "everyone", text: "@everyone" } };
  if (/^@?here$/i.test(raw)) return { ok: true, mention: { type: "here", text: "@here" } };
  const role = /^(?:<@&)?(\d{17,20})>?$/.exec(raw);
  if (!role) return { ok: false, error: "A menção precisa ser um cargo, @everyone ou @here." };
  return { ok: true, mention: { type: "role", id: role[1], text: `<@&${role[1]}>` } };
}

export function parseEmoji(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: true, emoji: DEFAULT_ANNOUNCE_EMOJI };
  if (/^nenhum$/i.test(raw)) return { ok: true, emoji: "" };
  if (/^<a?:[\w]+:\d+>$/.test(raw)) return { ok: true, emoji: raw };
  if (!/\s/u.test(raw) && [...raw].length <= 8 && /\p{Extended_Pictographic}/u.test(raw)) return { ok: true, emoji: raw };
  return { ok: false, error: "O emoji precisa ser um emoji do servidor, um emoji comum, ou nenhum." };
}

export function parseButton(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: true, button: null };
  const split = raw.indexOf("|");
  if (split <= 0 || split === raw.length - 1) return { ok: false, error: "O botão precisa seguir o formato texto|https://..." };
  const label = raw.slice(0, split).trim();
  if (!label || label.length > 80) return { ok: false, error: "O texto do botão precisa ter de 1 a 80 caracteres." };
  const url = parseHttps(raw.slice(split + 1), "A URL do botão");
  if (!url.ok) return url;
  return { ok: true, button: { label, url: url.url } };
}

export function parseMessageRef(value, fallbackChannelId = "") {
  const raw = String(value ?? "").trim();
  const link = /^https?:\/\/(?:[\w-]+\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)\/?$/.exec(raw);
  if (link) return { ok: true, guildId: link[1], channelId: link[2], messageId: link[3] };
  const pair = /^(\d{17,20})[-/](\d{17,20})$/.exec(raw);
  if (pair) return { ok: true, channelId: pair[1], messageId: pair[2] };
  if (/^\d{17,20}$/.test(raw) && /^\d{17,20}$/.test(fallbackChannelId)) return { ok: true, channelId: fallbackChannelId, messageId: raw };
  return { ok: false, error: "Informe o link da mensagem ou o ID dela neste canal." };
}

export function preferUrl(primary, secondary) {
  return String(primary ?? "").trim() || String(secondary ?? "").trim();
}

export function mentionAllows(mention) {
  if (mention?.type === "everyone" || mention?.type === "here") return { parse: ["everyone"] };
  if (mention?.type === "role" && mention.id) return { parse: [], roles: [mention.id] };
  return { parse: [] };
}

export function announcementFooter(footer, publishedAt) {
  const lines = [];
  const note = String(footer ?? "").trim();
  if (note) lines.push(`-# ${note.replace(/\n+/g, "\n-# ")}`);
  lines.push(`-# Ignix Cloud PC • ${formatDate(publishedAt)}`);
  return lines.join("\n");
}

export function announcementFromComponents(components) {
  const list = Array.isArray(components) ? components : [];
  const top = list.find((item) => item?.type === 10);
  let mention = null;
  if (top?.content === "@everyone" || top?.content === "@here") {
    mention = { type: top.content === "@everyone" ? "everyone" : "here", text: top.content };
  } else if (top?.content && /^<@&\d{17,20}>$/.test(top.content)) {
    mention = { type: "role", id: top.content.replace(/\D/g, ""), text: top.content };
  }
  const container = list.find((item) => item?.type === 17);
  if (!container) return null;
  let title = "";
  let emoji = "";
  let text = "";
  let footer = "";
  let imageUrl = "";
  let thumbnailUrl = "";
  let button = null;
  for (const child of container.components ?? []) {
    if (child.type === 9) {
      const content = child.components?.find((item) => item.type === 10)?.content || "";
      const heading = readHeading(content);
      title = heading.title;
      emoji = heading.emoji;
      thumbnailUrl = child.accessory?.media?.url || "";
    } else if (child.type === 10 && String(child.content || "").startsWith("# ")) {
      const heading = readHeading(child.content);
      title = heading.title;
      emoji = heading.emoji;
    } else if (child.type === 10 && String(child.content || "").startsWith("-#")) {
      footer = String(child.content).split("\n").map((line) => line.replace(/^-#\s?/, "")).filter((line) => line && !line.startsWith("Ignix Cloud PC • ") && !line.startsWith("Atlas Cloud PC • ")).join("\n");
    } else if (child.type === 10 && !text) {
      text = child.content || "";
    } else if (child.type === 12) {
      imageUrl = child.items?.[0]?.media?.url || "";
    } else if (child.type === 1) {
      const link = (child.components ?? []).find((item) => item.style === 5 && item.url);
      if (link) button = { label: link.label, url: link.url };
    }
  }
  if (!title || !text) return null;
  return { title, text, footer, imageUrl, thumbnailUrl, button, emoji, mention, color: container.accent_color ?? null };
}

function readHeading(content) {
  const match = /^#\s+(?:(<a?:[\w]+:\d+>)\s+)?([\s\S]+)$/.exec(String(content ?? ""));
  if (!match) return { emoji: "", title: String(content ?? "").replace(/^#\s+/, "").trim() };
  return { emoji: match[1] || "", title: match[2].trim() };
}

export function announcementHeading(title, emoji) {
  const mark = String(emoji ?? "").trim();
  return mark ? `# ${mark} ${title}` : `# ${title}`;
}

export function composeAnnouncement(input, { accent = 0x5865f2, now = Date.now() } = {}) {
  const title = String(input.title ?? "").replace(/\s+/g, " ").trim();
  const text = String(input.text ?? "").trim();
  const footer = String(input.footer ?? "").trim();
  if (!title) return { ok: false, error: "Informe o título do anúncio." };
  if (title.length > 200) return { ok: false, error: "O título pode ter no máximo 200 caracteres." };
  if (!text) return { ok: false, error: "Informe o texto do anúncio." };
  if (text.length > 3500) return { ok: false, error: "O texto pode ter no máximo 3500 caracteres." };
  if (footer.length > 200) return { ok: false, error: "O rodapé pode ter no máximo 200 caracteres." };
  const color = parseHexColor(input.color ?? "", accent);
  if (!color.ok) return color;
  const emoji = parseEmoji(input.emoji ?? "");
  if (!emoji.ok) return emoji;
  const mention = parseMention(input.mention ?? "");
  if (!mention.ok) return mention;
  const image = parseHttps(preferUrl(input.attachmentImage, input.imageUrl), "A URL da imagem");
  if (!image.ok) return image;
  const thumb = parseHttps(preferUrl(input.attachmentThumb, input.thumbnailUrl), "A URL da miniatura");
  if (!thumb.ok) return thumb;
  const button = parseButton(input.button ?? (input.buttonLabel ? `${input.buttonLabel}|${input.buttonUrl ?? ""}` : ""));
  if (!button.ok) return button;
  const publishedAt = input.publishedAt || now;
  const heading = announcementHeading(title, emoji.emoji);
  const foot = announcementFooter(footer, publishedAt);
  const total = heading.length + text.length + foot.length + (mention.mention?.text.length ?? 0);
  if (total > TEXT_BUDGET) return { ok: false, error: "O anúncio passou do limite do Discord. Encurte o título, o texto ou o rodapé." };
  return {
    ok: true,
    value: {
      title,
      text,
      footer,
      imageUrl: image.url,
      thumbnailUrl: thumb.url,
      button: button.button,
      color: color.color,
      mention: mention.mention,
      emoji: emoji.emoji,
      publishedAt,
      imageFromAttachment: Boolean(String(input.attachmentImage ?? "").trim()),
    },
  };
}
