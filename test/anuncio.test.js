import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MessageFlags } from "discord.js";
import { routeAnnounceComponent } from "../src/announce/router.js";
import { announcementFromComponents, composeAnnouncement, parseMessageRef } from "../src/announce/model.js";
import { announceModal, renderAnnouncePreview, renderAnnouncement } from "../src/announce/panel.js";
import { routeCommand } from "../src/commands/admin/router.js";
import { adminCommands } from "../src/commands/admin/commands.js";
import { openDatabase } from "../src/db/database.js";
import { inspectModal } from "../src/panels/admin.js";
import { zonedToUtc } from "../src/services/plans.js";

const OTHER = ["n", "y", "x"].join("");
const WHEN = zonedToUtc(2026, 11, 15, 12, 0, 0);

function textsOf(payload) {
  const found = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (typeof node.content === "string") found.push(node.content);
    if (node.components) walk(node.components);
  };
  walk(payload.components.map((component) => component.toJSON()));
  return found.join("\n");
}

test("o anúncio cabe no container e rejeita dados inválidos", () => {
  const command = adminCommands().find((item) => item.name === "anuncio");
  assert.deepEqual(command.options.map((item) => item.name), ["publicar", "editar"]);
  assert.equal(command.options[0].options.find((item) => item.name === "canal").required, false);
  assert.equal(command.options[1].options.find((item) => item.name === "mensagem").required, true);
  const composed = composeAnnouncement({
    title: "Manutenção",
    text: "Primeira linha.\n\n**Segunda** linha.",
    footer: "Volta às 22h",
    attachmentImage: "https://cdn.example/anexo.png",
    imageUrl: "https://cdn.example/url.png",
    thumbnailUrl: "https://cdn.example/mini.png",
    button: "Saiba mais|https://example.com/atlas",
    color: "#112233",
    mention: "<@&123456789012345678>",
    publishedAt: WHEN,
  }, { accent: 0x5865f2 });
  assert.equal(composed.ok, true);
  assert.equal(composed.value.imageUrl, "https://cdn.example/anexo.png");
  const view = renderAnnouncement(composed.value);
  const raw = JSON.stringify(view.components.map((component) => component.toJSON()));
  assert.equal(view.flags, MessageFlags.IsComponentsV2);
  assert.equal(view.allowedMentions.roles[0], "123456789012345678");
  assert.match(raw, /# <:megaphone:1568512322450882665> Manutenção/);
  assert.match(raw, /Primeira linha/);
  assert.equal((raw.match(/"divider":true/g) || []).length, 2);
  assert.match(raw, /https:\/\/cdn\.example\/anexo\.png/);
  assert.match(raw, /https:\/\/cdn\.example\/mini\.png/);
  assert.match(raw, /-# Volta às 22h/);
  assert.match(raw, /-# Atlas Cloud PC • 15\/11\/2026/);
  assert.match(raw, /Saiba mais/);
  assert.equal(raw.toLowerCase().includes(OTHER), false);
  const preview = renderAnnouncePreview(composed.value, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  assert.deepEqual(preview.allowedMentions, { parse: [] });
  assert.match(JSON.stringify(preview.components.at(-1).toJSON()), /Publicar/);
  assert.match(JSON.stringify(preview.components.at(-1).toJSON()), /Editar/);
  assert.match(JSON.stringify(preview.components.at(-1).toJSON()), /Cancelar/);
  const restored = announcementFromComponents(view.components.map((component) => component.toJSON()));
  assert.equal(restored.title, "Manutenção");
  assert.equal(restored.text, "Primeira linha.\n\n**Segunda** linha.");
  assert.equal(restored.footer, "Volta às 22h");
  assert.equal(restored.imageUrl, "https://cdn.example/anexo.png");
  assert.equal(restored.button.url, "https://example.com/atlas");
  assert.equal(inspectModal(announceModal("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).length, 0);
  assert.equal(inspectModal(announceModal("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", composed.value)).length, 0);
  assert.equal(composeAnnouncement({ title: "Oi", text: "Texto", imageUrl: "http://example.com/a.png" }).ok, false);
  assert.match(composeAnnouncement({ title: "Oi", text: "Texto", color: "azul" }).error, /hexadecimal/);
  assert.match(composeAnnouncement({ title: "Oi", text: "Texto", button: "sem-url" }).error, /texto\|https/);
  assert.match(composeAnnouncement({ title: "Oi", text: "Texto", mention: "pessoal" }).error, /@everyone/);
  assert.equal(composeAnnouncement({ title: "", text: "Texto" }).ok, false);
  assert.equal(composeAnnouncement({ title: "Oi", text: "x".repeat(3501) }).ok, false);
  assert.equal(parseMessageRef("https://discord.com/channels/10/20/30").messageId, "30");
  assert.equal(parseMessageRef("99", "20").ok, false);
});

test("só administrador publica e a prévia vira a mensagem", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-anuncio-"));
  const repo = openDatabase(dir);
  const sent = [];
  const logs = [];
  const channel = {
    id: "20",
    isTextBased: () => true,
    isDMBased: () => false,
    async send(body) {
      sent.push(body);
      return { id: "30" };
    },
  };
  const app = {
    config: { panelColor: 0x5865f2 },
    repo,
    admin: { isAdmin: (actor) => actor.owner === true || actor.id === "admin" },
    audit: { async record(entry) { logs.push(entry); } },
  };
  const blocked = {
    commandName: "anuncio",
    user: { id: "membro" },
    member: { permissions: 0n, roles: [] },
    guild: { ownerId: "dono" },
    guildId: "10",
    channel,
    deferred: false,
    replied: false,
    options: { getSubcommand: () => "publicar", getString: () => null, getAttachment: () => null, getChannel: () => null },
    async deferReply() { this.deferred = true; },
    async editReply() {},
    async showModal() { throw new Error("não deveria abrir"); },
  };
  await routeCommand(blocked, app);
  assert.equal(blocked.deferred, true);
  const opened = [];
  const admin = {
    commandName: "anuncio",
    user: { id: "admin" },
    member: { permissions: 0n, roles: [] },
    guild: { ownerId: "admin", channels: { fetch: async () => channel } },
    guildId: "10",
    channelId: "20",
    channel,
    client: { user: { id: "bot" } },
    deferred: false,
    replied: false,
    options: {
      getSubcommand: () => "publicar",
      getString: (name) => (name === "mencionar" ? "@here" : name === "cor" ? "#112233" : null),
      getAttachment: (name) => (name === "imagem" ? { url: "https://cdn.example/anexo.png" } : null),
      getChannel: () => channel,
    },
    async showModal(modal) { opened.push(modal); },
    async deferReply() { this.deferred = true; },
    async editReply(body) { this.last = body; },
  };
  admin.guild.ownerId = "outra";
  app.admin.isAdmin = (actor) => actor.id === "admin";
  await routeCommand(admin, app);
  assert.equal(opened.length, 1);
  assert.equal(admin.deferred, false);
  const draftId = opened[0].toJSON().custom_id.split(":").at(-1);
  const modal = {
    customId: `atlas:modal:anuncio:${draftId}`,
    user: { id: "admin" },
    member: { permissions: 8n, roles: [] },
    guild: admin.guild,
    guildId: "10",
    client: admin.client,
    deferred: false,
    replied: false,
    fields: { getTextInputValue: (id) => ({ titulo: "Janela", texto: "A máquina volta à noite.", rodape: "Obrigado", imagem: "https://cdn.example/ignorada.png", botao: "Abrir|https://example.com/painel" }[id] ?? "") },
    async deferReply() { this.deferred = true; },
    async editReply(body) { this.last = body; },
  };
  await routeAnnounceComponent(modal, app);
  const preview = JSON.stringify(modal.last);
  assert.match(preview, /Janela/);
  assert.match(preview, /https:\/\/cdn\.example\/anexo\.png/);
  assert.doesNotMatch(preview, /ignorada\.png/);
  const publish = {
    customId: `atlas:anuncio:publish:${draftId}`,
    user: { id: "admin" },
    member: { permissions: 8n, roles: [] },
    guild: admin.guild,
    guildId: "10",
    client: admin.client,
    deferred: false,
    replied: false,
    async deferUpdate() { this.deferred = true; },
    async editReply(body) { this.last = body; },
  };
  await routeAnnounceComponent(publish, app);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].allowedMentions.parse[0], "everyone");
  assert.match(textsOf(publish.last), /https:\/\/discord\.com\/channels\/10\/20\/30/);
  assert.equal(logs[0].action, "Anúncio publicado");
  assert.equal(repo.announcement("10", "30").payload.title, "Janela");
  const reopened = [];
  channel.messages = { fetch: async () => ({ id: "30", author: { id: "bot" }, components: sent[0].components }) };
  admin.options = {
    getSubcommand: () => "editar",
    getString: (name) => (name === "mensagem" ? "https://discord.com/channels/10/20/30" : null),
    getAttachment: () => null,
    getChannel: () => null,
  };
  admin.showModal = async (modal) => { reopened.push(modal); };
  admin.deferred = false;
  await routeCommand(admin, app);
  assert.match(JSON.stringify(reopened[0].toJSON()), /Janela/);
  assert.match(JSON.stringify(reopened[0].toJSON()), /A máquina volta à noite/);
  repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
