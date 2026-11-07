const SNOWFLAKE = /^\d{17,20}$/;
const AVATAR_URL = /^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/(?:avatars|embed\/avatars|guilds)\//i;

export function ticketOverwrites({ everyoneId, openerId, staffRoleId, botId, archive = false }) {
  for (const id of [everyoneId, openerId, staffRoleId, botId]) {
    if (!SNOWFLAKE.test(id ?? "")) throw new Error("overwrite sem snowflake");
  }
  const memberAllow = archive
    ? ["ViewChannel", "ReadMessageHistory"]
    : ["ViewChannel", "SendMessages", "ReadMessageHistory", "AttachFiles"];
  const memberDeny = archive ? ["SendMessages"] : [];
  return [
    { id: everyoneId, allow: [], deny: ["ViewChannel", "SendMessages"] },
    { id: openerId, allow: memberAllow, deny: memberDeny },
    { id: staffRoleId, allow: memberAllow, deny: memberDeny },
    {
      id: botId,
      allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "AttachFiles", "ManageChannels"],
      deny: [],
    },
  ];
}

export function staffMention(roleId) {
  if (!SNOWFLAKE.test(roleId ?? "")) return { text: "Cargo da equipe ainda não configurado.", allowedMentions: { parse: [] } };
  return { text: `<@&${roleId}>`, allowedMentions: { parse: [], roles: [roleId] } };
}

export function defaultAvatarUrl(userId) {
  const index = Number((BigInt(userId) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export function resolveOpenerAvatar({ userId, url, hasCustomAvatar }) {
  if (typeof url === "string" && AVATAR_URL.test(url) && hasCustomAvatar !== false) return url;
  return defaultAvatarUrl(userId);
}

export function messageNeedsContentIntent(message) {
  return !message?.authorIsBot && !message?.content && !(message?.attachments ?? []).length && !(message?.embeds ?? []).length && !(message?.components ?? []).length;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function redactSecrets(value) {
  return String(value ?? "")
    .replace(/\b[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}\b/g, "[segredo]")
    .replace(/\b(?:ghp_|github_pat_|sk_live_|xox[baprs]-)[\w-]+\b/g, "[segredo]");
}

export function renderTranscriptDocument(messages) {
  const rows = messages.map((message) => {
    const content = redactSecrets(message.content ?? "");
    const unavailable = !content && !(message.attachments ?? []).length;
    const attachments = (message.attachments ?? [])
      .map((item) => escapeHtml(item.url ?? item.name ?? "anexo"))
      .join(", ");
    return `<article><time>${escapeHtml(message.timestamp ?? "")}</time> <strong>${escapeHtml(message.authorId ?? "")}</strong> ${escapeHtml(message.authorName ?? "")}<p>${unavailable ? "[conteúdo indisponível sem a intent Message Content]" : escapeHtml(content)}</p><p>${attachments}</p></article>`;
  });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Transcrição</title></head><body>${rows.join("")}</body></html>`;
}

export async function collectHistoryPages(fetchPage, { pageSize = 100, maxPages = 50 } = {}) {
  const pages = [];
  let before;
  for (let index = 0; index < maxPages; index += 1) {
    const page = await fetchPage(before);
    if (!Array.isArray(page)) throw new Error("página inválida");
    if (page.length === 0) break;
    pages.push(page);
    before = page[page.length - 1]?.id;
    if (!before) throw new Error("página sem id");
    if (page.length < pageSize) break;
  }
  return pages.flat().reverse();
}
