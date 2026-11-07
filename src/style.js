const CUSTOM_EMOJI = /^<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>$/u;
const PLACEHOLDER = /\{([a-z]+)\}/g;
const ALLOWED_PLACEHOLDERS = new Set(["produto", "duracao", "preco", "usuario", "equipe"]);

export const DEFAULT_BRAND = "Atlas";
export const LEGACY_BRANDS = Object.freeze(["Nyx", "Nyx Cloud"]);

export function rewriteDefaultBrand(value) {
  if (typeof value !== "string") return value;
  return LEGACY_BRANDS.includes(value.trim()) ? DEFAULT_BRAND : value;
}

export function validateEmoji(value) {
  if (value == null || value === "") return { ok: true, emoji: null };
  if (typeof value !== "string") return { ok: false, code: "emoji_invalid" };
  const text = value.trim();
  if (text.length > 64) return { ok: false, code: "emoji_invalid" };
  if (CUSTOM_EMOJI.test(text)) return { ok: true, emoji: text };
  if (/^[\p{Extended_Pictographic}\uFE0F\u200D]{1,8}$/u.test(text)) return { ok: true, emoji: text };
  return { ok: false, code: "emoji_invalid" };
}

export function validateMediaUrl(value) {
  if (value == null || value === "") return { ok: true, url: null };
  if (typeof value !== "string" || value.length > 300) return { ok: false, code: "media_invalid" };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, code: "media_invalid" };
  }
  if (url.protocol !== "https:" || url.username || url.password) return { ok: false, code: "media_invalid" };
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host === "0.0.0.0") return { ok: false, code: "media_invalid" };
  return { ok: true, url: url.toString() };
}

export function validateGreeting(value) {
  if (value == null || value === "") return { ok: true, greeting: null };
  if (typeof value !== "string" || value.trim().length > 500) return { ok: false, code: "greeting_invalid" };
  const text = value.trim();
  if (/@everyone|@here|<@&?\d|<@!?\d/i.test(text)) return { ok: false, code: "greeting_invalid" };
  const unknown = [...text.matchAll(PLACEHOLDER)].some((match) => !ALLOWED_PLACEHOLDERS.has(match[1]));
  if (unknown) return { ok: false, code: "greeting_invalid" };
  return { ok: true, greeting: text };
}

export function applyGreeting(template, values) {
  if (!template) return "";
  return template.replace(PLACEHOLDER, (token, key) => (ALLOWED_PLACEHOLDERS.has(key) ? values[key] ?? "" : token));
}

export function validateStyle(input) {
  const emojiFields = ["catalogEmoji", "openEmoji", "claimEmoji", "unclaimEmoji", "transcriptEmoji", "closeEmoji"];
  const style = {};
  for (const field of emojiFields) {
    const parsed = validateEmoji(input[field]);
    if (!parsed.ok) return parsed;
    style[field] = parsed.emoji;
  }
  for (const field of ["catalogBannerUrl", "ticketBannerUrl"]) {
    const parsed = validateMediaUrl(input[field]);
    if (!parsed.ok) return parsed;
    style[field] = parsed.url;
  }
  const greeting = validateGreeting(input.ticketGreeting);
  if (!greeting.ok) return greeting;
  const heading = rewriteDefaultBrand(input.catalogHeading ?? "");
  if (heading && (heading.length > 40 || /@everyone|@here/i.test(heading))) return { ok: false, code: "greeting_invalid" };
  return {
    ok: true,
    style: {
      ...style,
      ticketGreeting: greeting.greeting,
      catalogHeading: heading || null,
    },
  };
}
