import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createService } from "../src/service.js";
import { openDatabase } from "../src/storage.js";
import { PRODUCTS } from "../src/plans.js";
import { collectHistoryPages, defaultAvatarUrl, escapeHtml, renderTranscriptDocument, staffMention, ticketOverwrites } from "../src/tickets.js";
import { renderTicket, validateV2Message } from "../src/ui.js";
import { ACTOR, GUILD, OTHER, OTHER_GUILD, OWNER, fakeDiscord } from "../src/fixtures.js";
import { rewriteDefaultBrand, validateEmoji, validateGreeting, validateMediaUrl } from "../src/style.js";

const CATEGORY = "100000000000000021";
const ROLE = "100000000000000022";
const EVERYONE = "100000000000000031";
const BOT = "100000000000000003";

function app() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlasby-ticket-"));
  const store = openDatabase(dir);
  store.ensureDefaultPlans(GUILD, PRODUCTS, 1);
  store.ensureDefaultPlans(OTHER_GUILD, PRODUCTS, 1);
  store.setGuildField(GUILD, "ticket_category_id", CATEGORY, 1);
  store.setGuildField(GUILD, "staff_role_id", ROLE, 1);
  store.setGuildField(GUILD, "transcript_channel_id", "100000000000000008", 1);
  const calls = [];
  const discord = fakeDiscord({
    async guildIdentity() {
      return { everyoneId: EVERYONE, botId: BOT, botPermissions: (1n << 4n) | (1n << 10n) | (1n << 11n) };
    },
    async memberHasRole(_guildId, userId, roleId) {
      return userId === ACTOR && roleId === ROLE;
    },
    async createTicketChannel(input) {
      calls.push(["channel", input]);
      return { id: "100000000000000041" };
    },
    async sendTicketPanel(input) {
      calls.push(["panel", input]);
    },
    async fetchHistoryPage() {
      return [
        { id: "2", authorId: ACTOR, authorName: "ada", content: "<script>alert(1)</script>", timestamp: "2026-11-07T00:00:00.000Z", attachments: [{ url: "https://cdn.discordapp.com/a.png", name: "a.png" }] },
      ];
    },
    async deliverTranscript(input) {
      calls.push(["transcript", input]);
    },
    async applyOverwrites(channelId, overwrites) {
      calls.push(["lock", channelId, overwrites]);
    },
    async deleteChannel(channelId) {
      calls.push(["delete", channelId]);
    },
    async editMessage(channelId, messageId, payload) {
      calls.push(["edit", channelId, messageId, payload]);
      return { ok: true, missing: false };
    },
    async inspectChannel() {
      return { guildId: GUILD, type: "GuildText", permissions: (1n << 10n) | (1n << 11n) | (1n << 14n), everyoneCanView: false };
    },
  });
  const service = createService({ store, discord, now: () => 5_000, ttlMs: 60_000 });
  return { store, discord, service, calls, close: () => store.close() };
}

test("permissões do ticket negam everyone e não pedem administrador", () => {
  const rows = ticketOverwrites({ everyoneId: EVERYONE, openerId: OWNER, staffRoleId: ROLE, botId: BOT });
  const everyone = rows.find((row) => row.id === EVERYONE);
  assert.deepEqual(everyone.deny, ["ViewChannel", "SendMessages"]);
  assert.deepEqual(everyone.allow, []);
  assert.ok(rows.every((row) => !row.allow.includes("Administrator")));
  const mention = staffMention(ROLE);
  assert.deepEqual(mention.allowedMentions, { parse: [], roles: [ROLE] });
  assert.deepEqual(staffMention("everyone").allowedMentions, { parse: [] });
});

test("reserva é transacional, idempotente e devolve o estoque uma vez", async () => {
  const ticket = app();
  ticket.store.updateStock({ guildId: GUILD, sku: "t4-16", code: "7d", stock: 1, now: 2 });
  const first = ticket.store.reserveTicket({ guildId: GUILD, openerId: OWNER, sku: "t4-16", code: "7d", now: 3, id: randomUUID() });
  const second = ticket.store.reserveTicket({ guildId: GUILD, openerId: ACTOR, sku: "t4-16", code: "7d", now: 4, id: randomUUID() });
  const again = ticket.store.reserveTicket({ guildId: GUILD, openerId: OWNER, sku: "t4-16", code: "7d", now: 5, id: randomUUID() });
  assert.equal(first.ok, true);
  assert.equal(first.idempotent, false);
  assert.equal(first.ticket.price_cents, 4500);
  assert.equal(first.ticket.stock_reserved, true);
  assert.equal(second.ok, false);
  assert.equal(second.code, "out_of_stock");
  assert.equal(again.idempotent, true);
  assert.equal(again.ticket.id, first.ticket.id);
  assert.equal(ticket.store.getItem(GUILD, "t4-16", "7d").stock, 0);
  assert.equal(ticket.store.getItem(OTHER_GUILD, "t4-16", "7d").stock, 0);
  ticket.store.markTicketOpen(first.ticket.id, "100000000000000041");
  const closed = ticket.store.releaseTicket({ guildId: GUILD, id: first.ticket.id, closedBy: ACTOR, now: 6 });
  const twice = ticket.store.releaseTicket({ guildId: GUILD, id: first.ticket.id, closedBy: ACTOR, now: 7 });
  assert.equal(closed.released, true);
  assert.equal(twice.released, false);
  assert.equal(ticket.store.getItem(GUILD, "t4-16", "7d").stock, 1);
  const legacy = ticket.store.reserveTicket({ guildId: GUILD, openerId: OWNER, sku: "t4-4", code: "7d", now: 8, id: randomUUID() });
  assert.equal(legacy.ticket.stock_reserved, false);
  assert.equal(ticket.store.getItem(GUILD, "t4-4", "7d").stock, null);
  ticket.close();
});

test("migração tira o preço temporário e não inventa 8 vCPU nem apaga preço customizado", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlasby-migrate-"));
  const file = path.join(dir, "moderation.sqlite");
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE warnings (id INTEGER PRIMARY KEY, guild_id TEXT, target_id TEXT, moderator_id TEXT, reason TEXT, created_at INTEGER);
    CREATE TABLE actions (id INTEGER PRIMARY KEY, guild_id TEXT, action TEXT, status TEXT, target_id TEXT, moderator_id TEXT, reason TEXT, detail TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE guild_admins (guild_id TEXT, user_id TEXT, enrolled_by TEXT, created_at INTEGER, PRIMARY KEY (guild_id, user_id));
    INSERT INTO schema_migrations VALUES (1, 'x'), (2, 'x');
    CREATE TABLE plans (
      guild_id TEXT NOT NULL, code TEXT NOT NULL, label TEXT NOT NULL, duration_days INTEGER NOT NULL,
      price_cents INTEGER, available INTEGER NOT NULL, temporary_price INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, code)
    );
    INSERT INTO plans VALUES ('${GUILD}', '15d', 'Quinzenal', 15, 5100, 1, 1, 9);
    INSERT INTO plans VALUES ('${GUILD}', '7d', '7 dias', 7, 3590, 1, 0, 9);
    CREATE TABLE guild_settings (guild_id TEXT PRIMARY KEY, log_channel_id TEXT, updated_at INTEGER NOT NULL);
    CREATE TABLE confirmations (
      id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, moderator_id TEXT NOT NULL, target_id TEXT NOT NULL,
      action TEXT NOT NULL, reason TEXT NOT NULL, payload TEXT, status TEXT NOT NULL,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
  `);
  db.close();
  const store = openDatabase(dir);
  const custom = store.getItem(GUILD, "t4-4", "15d");
  assert.equal(custom.price_cents, 5100);
  assert.equal(custom.stock, null);
  assert.equal(custom.temporary_price, undefined);
  store.ensureDefaultPlans(GUILD, PRODUCTS, 10);
  assert.equal(store.getItem(GUILD, "t4-4", "15d").price_cents, 5100);
  assert.equal(store.getItem(GUILD, "t4-8", "7d").price_cents, null);
  assert.equal(store.getItem(GUILD, "t4-8", "7d").stock, 0);
  assert.equal(store.getItem(GUILD, "t4-16", "15d").price_cents, 7500);
  assert.equal(store.getItem(GUILD, "t4-16", "15d").stock, 0);
  store.close();
});

test("claim concorrente, transcrição escapada e fechamento sem apagar canal", async () => {
  const ticket = app();
  ticket.store.updateStock({ guildId: GUILD, sku: "t4-4", code: "7d", stock: 2, now: 2 });
  const opened = await ticket.service.openTicket({
    guildId: GUILD,
    openerId: OWNER,
    sku: "t4-4",
    code: "7d",
    hasCustomAvatar: true,
    avatarUrl: "https://cdn.discordapp.com/avatars/1/a.png",
  });
  assert.equal(opened.ticket.opener_avatar_url, "https://cdn.discordapp.com/avatars/1/a.png");
  assert.equal(opened.code, "ticket_opened");
  assert.equal(ticket.calls[0][0], "channel");
  assert.equal(ticket.calls[0][1].overwrites.find((row) => row.id === EVERYONE).deny.includes("ViewChannel"), true);
  const view = renderTicket(opened.ticket, { avatarUrl: opened.ticket.opener_avatar_url, staffText: `<@&${ROLE}>` });
  assert.match(JSON.stringify(view), /7 dias · R\$35,90 reservados/);
  assert.doesNotMatch(JSON.stringify(view), /7 dias · 7 dias/);
  const json = JSON.stringify(view.components[0].toJSON());
  assert.match(json, /"type":11/);
  assert.match(json, /<t:5:F>/);
  assert.equal(validateV2Message(view).ok, true);
  const claim = await ticket.service.claimTicket({ guildId: GUILD, actorId: ACTOR, ticketId: opened.ticket.id });
  const race = await ticket.service.claimTicket({ guildId: GUILD, actorId: OWNER, ticketId: opened.ticket.id });
  assert.equal(claim.code, "ticket_claimed");
  assert.equal(race.code, "claim_taken");
  assert.equal(race.ticket.claimed_by, ACTOR);
  const outsider = await ticket.service.claimTicket({ guildId: GUILD, actorId: "100000000000000099", ticketId: opened.ticket.id });
  assert.equal(outsider.code, "staff_only");
  const html = renderTranscriptDocument([
    { authorId: "1", authorName: "ada", content: "<script>alert(1)</script>", timestamp: "2026-11-07T00:00:00.000Z", attachments: [{ url: "https://cdn.discordapp.com/a.png" }] },
    { authorId: "2", authorName: "bob", content: "", timestamp: "2026-11-07T00:01:00.000Z", attachments: [] },
  ]);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /conteúdo indisponível/);
  const pages = await collectHistoryPages(async (before) => (before ? [] : [{ id: "9" }, { id: "8" }]));
  assert.deepEqual(pages.map((item) => item.id), ["8", "9"]);
  const pending = await ticket.service.requestCloseTicket({ guildId: GUILD, actorId: ACTOR, ticketId: opened.ticket.id });
  const closed = await ticket.service.confirm({ confirmationId: pending.confirmationId, guildId: GUILD, moderatorId: ACTOR, decision: "confirm" });
  assert.equal(closed.code, "countdown_ready");
  assert.equal(ticket.calls.some((call) => call[0] === "transcript"), true);
  assert.equal(ticket.calls.some((call) => call[0] === "delete"), false);
  assert.equal(ticket.store.getItem(GUILD, "t4-4", "7d").stock, 2);
  const edits = [];
  const finished = await ticket.service.finishDeletion({
    guildId: GUILD,
    ticketId: opened.ticket.id,
    editStatus: async (content) => edits.push(content),
    sleep: async () => {},
  });
  assert.deepEqual(edits.map((line) => line.match(/em (\d)/)[1]), ["5", "4", "3", "2", "1"]);
  assert.equal(finished.code, "ticket_deleted");
  assert.equal(ticket.calls.filter((call) => call[0] === "delete").length, 1);
  assert.equal(ticket.store.getItem(GUILD, "t4-4", "7d").stock, 2);
  ticket.close();
});

test("falha da transcrição não fecha nem devolve estoque duas vezes", async () => {
  const ticket = app();
  ticket.store.updateStock({ guildId: GUILD, sku: "t4-16", code: "15d", stock: 1, now: 1 });
  const opened = await ticket.service.openTicket({ guildId: GUILD, openerId: OWNER, sku: "t4-16", code: "15d", avatarUrl: null });
  ticket.discord.fetchHistoryPage = async () => {
    throw new Error("histórico");
  };
  const pending = await ticket.service.requestCloseTicket({ guildId: GUILD, actorId: OWNER, ticketId: opened.ticket.id });
  const failed = await ticket.service.confirm({ confirmationId: pending.confirmationId, guildId: GUILD, moderatorId: OWNER, decision: "confirm" });
  assert.equal(failed.code, "transcript_failed");
  assert.equal(ticket.store.getTicket(GUILD, opened.ticket.id).status, "open");
  assert.equal(ticket.store.getItem(GUILD, "t4-16", "15d").stock, 0);
  ticket.close();
});

test("marca padrão Nyx vira Atlas e texto customizado ou histórico permanecem", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlasby-brand-"));
  const store = openDatabase(dir);
  store.ensureDefaultPlans(GUILD, PRODUCTS, 1);
  store.close();
  const db = new DatabaseSync(path.join(dir, "moderation.sqlite"));
  db.exec(`UPDATE catalog_items SET product_name = 'Nyx Cloud' WHERE sku = 't4-4' AND code = '7d'`);
  db.exec(`UPDATE catalog_items SET product_name = 'Loja Nyx do João' WHERE sku = 't4-4' AND code = '15d'`);
  db.exec(`INSERT INTO guild_styles (guild_id, catalog_heading, updated_at) VALUES ('${GUILD}', 'Nyx', 1)`);
  db.exec(`INSERT INTO guild_styles (guild_id, catalog_heading, ticket_greeting, updated_at) VALUES ('${OTHER_GUILD}', 'Minha loja Nyx', 'Olá {usuario}', 1)`);
  db.exec(`INSERT INTO tickets (
    id, guild_id, opener_id, sku, code, product_name, label, duration_days, price_cents, stock_reserved, stock_released, status, opened_at
  ) VALUES ('hist', '${GUILD}', '${OWNER}', 't4-4', '7d', 'Nyx Cloud', '7 dias', 7, 3590, 0, 0, 'closed', 1)`);
  db.close();
  const reopened = openDatabase(dir);
  reopened.rewriteDefaultBrands();
  reopened.rewriteDefaultBrands();
  assert.equal(reopened.getItem(GUILD, "t4-4", "7d").product_name, "Atlas");
  assert.equal(reopened.getItem(GUILD, "t4-4", "7d").price_cents, 3590);
  assert.equal(reopened.getItem(GUILD, "t4-4", "15d").product_name, "Loja Nyx do João");
  assert.equal(reopened.getStyle(GUILD).catalog_heading, "Atlas");
  assert.equal(reopened.getStyle(OTHER_GUILD).catalog_heading, "Minha loja Nyx");
  assert.equal(reopened.getStyle(OTHER_GUILD).ticket_greeting, "Olá {usuario}");
  const historical = dbOpen(dir);
  assert.equal(historical.prepare("SELECT product_name FROM tickets WHERE id = 'hist'").get().product_name, "Nyx Cloud");
  historical.close();
  reopened.close();
});

function dbOpen(dir) {
  return new DatabaseSync(path.join(dir, "moderation.sqlite"));
}

test("catálogo publicado é editado no lugar e não vaza ticket", async () => {
  const ticket = app();
  ticket.service.trackCatalog({ guildId: GUILD, channelId: "100000000000000008", messageId: "100000000000000077" });
  ticket.service.trackCatalog({ guildId: OTHER_GUILD, channelId: "100000000000000018", messageId: "100000000000000078" });
  ticket.store.updateStock({ guildId: GUILD, sku: "t4-4", code: "7d", stock: 2, now: 2 });
  const opened = await ticket.service.openTicket({
    guildId: GUILD,
    openerId: OWNER,
    sku: "t4-4",
    code: "7d",
    hasCustomAvatar: false,
    avatarUrl: "https://cdn.discordapp.com/embed/avatars/0.png",
  });
  await ticket.service.whenCatalogSettled(GUILD);
  const edits = ticket.calls.filter((call) => call[0] === "edit");
  assert.equal(edits.length, 1);
  assert.equal(edits[0][1], "100000000000000008");
  const rendered = JSON.stringify(edits[0][3]);
  assert.match(rendered, /estoque 1/);
  assert.doesNotMatch(rendered, new RegExp(OWNER));
  assert.equal(opened.ticket.opener_avatar_url, defaultAvatarUrl(OWNER));
  assert.notEqual(defaultAvatarUrl(String(1n << 22n)), defaultAvatarUrl(String(2n << 22n)));
  ticket.close();
});

test("texto ausente sem a intent mantém o canal", async () => {
  const ticket = app();
  ticket.store.updateStock({ guildId: GUILD, sku: "t4-16", code: "7d", stock: 1, now: 1 });
  const opened = await ticket.service.openTicket({ guildId: GUILD, openerId: OWNER, sku: "t4-16", code: "7d", hasCustomAvatar: true, avatarUrl: "https://cdn.discordapp.com/avatars/9/a.png" });
  ticket.discord.fetchHistoryPage = async () => [{ id: "3", authorIsBot: false, content: "", attachments: [], embeds: [], components: [] }];
  const pending = await ticket.service.requestCloseTicket({ guildId: GUILD, actorId: OWNER, ticketId: opened.ticket.id });
  const failed = await ticket.service.confirm({ confirmationId: pending.confirmationId, guildId: GUILD, moderatorId: OWNER, decision: "confirm" });
  assert.equal(failed.code, "transcript_incomplete");
  assert.equal(ticket.store.getTicket(GUILD, opened.ticket.id).status, "open");
  assert.equal(ticket.calls.some((call) => call[0] === "delete"), false);
  assert.equal(ticket.store.getItem(GUILD, "t4-16", "7d").stock, 0);
  ticket.close();
});

test("falha ao apagar não devolve o estoque de novo", async () => {
  const ticket = app();
  ticket.store.updateStock({ guildId: GUILD, sku: "t4-4", code: "15d", stock: 1, now: 1 });
  const opened = await ticket.service.openTicket({ guildId: GUILD, openerId: OWNER, sku: "t4-4", code: "15d", hasCustomAvatar: true, avatarUrl: "https://cdn.discordapp.com/avatars/9/a.png" });
  ticket.discord.deleteChannel = async () => {
    throw new Error("discord");
  };
  const pending = await ticket.service.requestCloseTicket({ guildId: GUILD, actorId: OWNER, ticketId: opened.ticket.id });
  const ready = await ticket.service.confirm({ confirmationId: pending.confirmationId, guildId: GUILD, moderatorId: OWNER, decision: "confirm" });
  assert.equal(ready.code, "countdown_ready");
  const failed = await ticket.service.finishDeletion({ guildId: GUILD, ticketId: opened.ticket.id, editStatus: async () => {}, sleep: async () => {} });
  assert.equal(failed.code, "delete_failed");
  assert.equal(ticket.store.getItem(GUILD, "t4-4", "15d").stock, 1);
  ticket.discord.deleteChannel = async (channelId) => {
    ticket.calls.push(["delete", channelId]);
  };
  const retried = await ticket.service.finishDeletion({ guildId: GUILD, ticketId: opened.ticket.id, editStatus: async () => {}, sleep: async () => {} });
  assert.equal(retried.code, "ticket_deleted");
  assert.equal(ticket.store.getItem(GUILD, "t4-4", "15d").stock, 1);
  ticket.close();
});

test("html de segredo não permanece e paginação rejeita página inválida", async () => {
  const html = escapeHtml(`token ${"a".repeat(24)}.${"b".repeat(6)}.${"c".repeat(27)}`);
  assert.match(renderTranscriptDocument([{ authorId: "1", content: `${"a".repeat(24)}.${"b".repeat(6)}.${"c".repeat(27)}`, timestamp: "t", attachments: [] }]), /\[segredo\]/);
  assert.equal(html.includes("<"), false);
  await assert.rejects(() => collectHistoryPages(async () => ({ id: "1" })));
  assert.equal(rewriteDefaultBrand("Nyx Cloud"), "Atlas");
  assert.equal(rewriteDefaultBrand("Loja Nyx do João"), "Loja Nyx do João");
  assert.equal(validateEmoji("🙂").ok, true);
  assert.equal(validateEmoji("<:ok:100000000000000022>").ok, true);
  assert.equal(validateEmoji("texto").ok, false);
  assert.equal(validateMediaUrl("http://cdn.example/a.png").ok, false);
  assert.equal(validateMediaUrl("https://cdn.example/banner.png").ok, true);
  assert.equal(validateGreeting("Olá {usuario} @everyone").ok, false);
  assert.equal(validateGreeting("Olá {usuario}").ok, true);
});
