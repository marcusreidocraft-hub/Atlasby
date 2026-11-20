import { randomUUID } from "node:crypto";
import { actorFrom, ack, present } from "../components/reply.js";
import { notice } from "../panels/ui.js";
import { V2, V2_EPHEMERAL } from "../panels/ui.js";
import { announcementFromComponents, composeAnnouncement, parseEmoji, parseHexColor, parseHttps, parseMention, parseMessageRef, preferUrl } from "./model.js";
import { announceError, announceModal, renderAnnounceConfirm, renderAnnouncePreview, renderAnnouncement } from "./panel.js";

const DRAFT_MS = 30 * 60 * 1000;

function attachmentUrl(file) {
  const url = String(file?.url || file?.proxyURL || "").trim();
  return url.startsWith("https://") ? url : "";
}

function keepDraft(repo, row) {
  repo.deleteDraft(row.id);
  repo.saveDraft(row);
}

function loadDraft(repo, id, guildId, actorId, now) {
  const draft = repo.getDraft(id);
  if (!draft || draft.kind !== "anuncio" || draft.guildId !== guildId) return { error: "Esse rascunho expirou. Use /anuncio publicar de novo." };
  if (draft.actorId !== actorId) return { error: "Este rascunho é de outro administrador." };
  if (draft.expiresAt <= now) return { error: "Esse rascunho expirou. Use /anuncio publicar de novo." };
  return { draft };
}

function slashExtras(interaction, accent) {
  const color = parseHexColor(interaction.options.getString("cor") ?? "", accent);
  if (!color.ok) return color;
  const emoji = parseEmoji(interaction.options.getString("emoji") ?? "");
  if (!emoji.ok) return emoji;
  const mention = parseMention(interaction.options.getString("mencionar") ?? "");
  if (!mention.ok) return mention;
  const fileImage = attachmentUrl(interaction.options.getAttachment("imagem"));
  if (interaction.options.getAttachment("imagem") && !fileImage) return { ok: false, error: "O anexo da imagem precisa ter um link https." };
  const fileThumb = attachmentUrl(interaction.options.getAttachment("miniatura"));
  if (interaction.options.getAttachment("miniatura") && !fileThumb) return { ok: false, error: "O anexo da miniatura precisa ter um link https." };
  const typedThumb = parseHttps(interaction.options.getString("url_miniatura") ?? "", "A URL da miniatura");
  if (!typedThumb.ok) return typedThumb;
  return {
    ok: true,
    color: color.color,
    colorText: interaction.options.getString("cor") ?? "",
    emoji: interaction.options.getString("emoji") ?? "",
    mention: interaction.options.getString("mencionar") ?? "",
    attachmentImage: fileImage,
    attachmentThumb: preferUrl(fileThumb, typedThumb.url),
  };
}

async function fail(interaction, app, message) {
  if (!interaction.deferred && !interaction.replied) await ack(interaction, false);
  await present(interaction, announceError(message, app.config.panelColor));
}

export async function routeAnnounceCommand(interaction, app, actor) {
  const sub = interaction.options.getSubcommand();
  if (sub === "editar") return openEdit(interaction, app, actor);
  if (sub === "publicar") return openCreate(interaction, app, actor);
  await fail(interaction, app, "Comando não reconhecido.");
}

async function openCreate(interaction, app, actor) {
  const extras = slashExtras(interaction, app.config.panelColor);
  if (!extras.ok) return fail(interaction, app, extras.error);
  const chosen = interaction.options.getChannel("canal");
  const channel = chosen ?? interaction.channel;
  if (!channel?.isTextBased?.() || channel.isDMBased?.()) return fail(interaction, app, "Escolha um canal de texto do servidor.");
  const id = randomUUID();
  const now = Date.now();
  keepDraft(app.repo, {
    id,
    guildId: interaction.guildId,
    actorId: actor.id,
    kind: "anuncio",
    expiresAt: now + DRAFT_MS,
    payload: {
      channelId: channel.id,
      sourceMessageId: "",
      attachmentImage: extras.attachmentImage,
      attachmentThumb: extras.attachmentThumb,
      color: extras.colorText,
      emoji: extras.emoji,
      mention: extras.mention,
      title: "",
      text: "",
      footer: "",
      imageUrl: "",
      button: "",
      publishedAt: now,
    },
  });
  await interaction.showModal(announceModal(id, { imageUrl: extras.attachmentImage }));
}

async function openEdit(interaction, app, actor) {
  const ref = parseMessageRef(interaction.options.getString("mensagem"), interaction.channelId);
  if (!ref.ok) return fail(interaction, app, ref.error);
  if (ref.guildId && ref.guildId !== interaction.guildId) return fail(interaction, app, "Essa mensagem é de outro servidor.");
  const extras = slashExtras(interaction, app.config.panelColor);
  if (!extras.ok) return fail(interaction, app, extras.error);
  const channel = await interaction.guild.channels.fetch(ref.channelId).catch(() => null);
  if (!channel?.isTextBased?.() || channel.isDMBased?.()) return fail(interaction, app, "Não encontrei essa mensagem.");
  const message = await channel.messages.fetch(ref.messageId).catch(() => null);
  if (!message) return fail(interaction, app, "Não encontrei essa mensagem.");
  if (message.author?.id !== interaction.client.user.id) return fail(interaction, app, "Só edito anúncios publicados por este bot.");
  const stored = app.repo.announcement(interaction.guildId, message.id);
  const base = stored?.payload ?? announcementFromComponents((message.components ?? []).map((item) => (typeof item.toJSON === "function" ? item.toJSON() : item))) ?? {};
  const id = randomUUID();
  const now = Date.now();
  const payload = {
    channelId: channel.id,
    sourceMessageId: message.id,
    attachmentImage: extras.attachmentImage,
    attachmentThumb: extras.attachmentThumb || base.thumbnailUrl || "",
    color: extras.colorText || (base.color != null ? `#${base.color.toString(16).padStart(6, "0")}` : ""),
    emoji: extras.emoji || (base.emoji ? base.emoji : "nenhum"),
    mention: extras.mention || (base.mention?.type === "role" ? base.mention.id : base.mention?.text?.replace(/^@/, "") || ""),
    title: base.title || "",
    text: base.text || "",
    footer: base.footer || "",
    imageUrl: base.imageUrl || "",
    button: base.button ? `${base.button.label}|${base.button.url}` : "",
    publishedAt: base.publishedAt || now,
  };
  if (!payload.title || !payload.text) return fail(interaction, app, "Não consegui ler o conteúdo desse anúncio.");
  keepDraft(app.repo, {
    id,
    guildId: interaction.guildId,
    actorId: actor.id,
    kind: "anuncio",
    expiresAt: now + DRAFT_MS,
    payload,
  });
  await interaction.showModal(announceModal(id, {
    title: payload.title,
    text: payload.text,
    footer: payload.footer,
    imageUrl: payload.attachmentImage || payload.imageUrl,
    button: base.button || null,
  }));
}

export async function routeAnnounceComponent(interaction, app) {
  const id = interaction.customId ?? "";
  const modal = /^atlas:modal:anuncio:([0-9a-f-]{36})$/.exec(id);
  const button = /^atlas:anuncio:(publish|edit|cancel):([0-9a-f-]{36})$/.exec(id);
  if (!modal && !button) return false;
  const actor = actorFrom(interaction);
  if (!app.admin.isAdmin(actor)) {
    await fail(interaction, app, "Só um administrador do servidor, ou um cargo de ADMIN_ROLE_IDS, pode fazer isso.");
    return true;
  }
  const draftId = modal?.[1] || button?.[2];
  const loaded = loadDraft(app.repo, draftId, interaction.guildId, actor.id, Date.now());
  if (loaded.error) {
    await fail(interaction, app, loaded.error);
    return true;
  }
  if (modal) return submitModal(interaction, app, loaded.draft);
  if (button[1] === "edit") {
    const composed = viewFromDraft(loaded.draft.payload, app.config.panelColor);
    if (!composed.ok) return fail(interaction, app, composed.error);
    await interaction.showModal(announceModal(draftId, composed.value));
    return true;
  }
  if (button[1] === "cancel") return cancelDraft(interaction, app, loaded.draft);
  return publishDraft(interaction, app, actor, loaded.draft);
}

function viewFromDraft(payload, accent) {
  return composeAnnouncement({
    title: payload.title,
    text: payload.text,
    footer: payload.footer,
    imageUrl: payload.imageUrl,
    attachmentImage: payload.attachmentImage,
    thumbnailUrl: "",
    attachmentThumb: payload.attachmentThumb,
    button: payload.button,
    color: payload.color,
    emoji: payload.emoji,
    mention: payload.mention,
    publishedAt: payload.publishedAt,
  }, { accent });
}

async function submitModal(interaction, app, draft) {
  const payload = {
    ...draft.payload,
    title: interaction.fields.getTextInputValue("titulo"),
    text: interaction.fields.getTextInputValue("texto"),
    footer: interaction.fields.getTextInputValue("rodape"),
    imageUrl: interaction.fields.getTextInputValue("imagem"),
    button: interaction.fields.getTextInputValue("botao"),
  };
  const composed = viewFromDraft(payload, app.config.panelColor);
  if (!composed.ok) return fail(interaction, app, composed.error);
  const next = { ...draft, payload: { ...payload, publishedAt: composed.value.publishedAt }, expiresAt: Date.now() + DRAFT_MS };
  keepDraft(app.repo, next);
  await ack(interaction, false);
  await present(interaction, renderAnnouncePreview(composed.value, draft.id));
  return true;
}

async function cancelDraft(interaction, app, draft) {
  app.repo.deleteDraft(draft.id);
  await interaction.deferUpdate();
  await interaction.editReply({
    components: notice("Anúncio cancelado.", app.config.panelColor).components,
    flags: V2_EPHEMERAL,
    allowedMentions: { parse: [] },
  });
  return true;
}

async function publishDraft(interaction, app, actor, draft) {
  const composed = viewFromDraft(draft.payload, app.config.panelColor);
  if (!composed.ok) return fail(interaction, app, composed.error);
  await interaction.deferUpdate();
  app.repo.deleteDraft(draft.id);
  try {
    const channel = await interaction.guild.channels.fetch(draft.payload.channelId);
    if (!channel?.isTextBased?.() || channel.isDMBased?.()) throw new Error("canal");
    const view = renderAnnouncement(composed.value);
    const body = { components: view.components, flags: V2, allowedMentions: view.allowedMentions };
    const message = draft.payload.sourceMessageId
      ? await (await channel.messages.fetch(draft.payload.sourceMessageId)).edit(body)
      : await channel.send(body);
    app.repo.saveAnnouncement({
      messageId: message.id,
      guildId: interaction.guildId,
      channelId: channel.id,
      payload: composed.value,
      updatedAt: Date.now(),
    });
    const url = `https://discord.com/channels/${interaction.guildId}/${channel.id}/${message.id}`;
    await interaction.editReply({
      components: renderAnnounceConfirm({ title: composed.value.title, url, updated: Boolean(draft.payload.sourceMessageId) }).components,
      flags: V2_EPHEMERAL,
      allowedMentions: { parse: [] },
    });
    await app.audit?.record?.({
      guildId: interaction.guildId,
      actorId: actor.id,
      action: draft.payload.sourceMessageId ? "Anúncio editado" : "Anúncio publicado",
      detail: `${composed.value.title} em <#${channel.id}> ${url}`,
    });
  } catch {
    keepDraft(app.repo, draft);
    await interaction.editReply({
      components: notice("Não consegui publicar neste canal. Confira as permissões do bot.", app.config.panelColor).components,
      flags: V2_EPHEMERAL,
      allowedMentions: { parse: [] },
    });
  }
  return true;
}
