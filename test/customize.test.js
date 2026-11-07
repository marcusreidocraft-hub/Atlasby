import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handleInteraction } from "../src/bot.js";
import { createService } from "../src/service.js";
import { openDatabase } from "../src/storage.js";
import { textOf, validateV2Message } from "../src/ui.js";
import { ACTOR, GUILD, OTHER_GUILD, OWNER, fakeDiscord } from "../src/fixtures.js";

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlasby-ui-"));
  const store = openDatabase(dir);
  const discord = fakeDiscord();
  const service = createService({ store, discord, now: () => 5_000, ttlMs: 60_000 });
  return { store, service, close: () => store.close() };
}

function button(customId, userId = OWNER) {
  return {
    guildId: GUILD,
    user: { id: userId, avatar: "abc" },
    customId,
    replies: [],
    edits: [],
    modals: [],
    inGuild() {
      return true;
    },
    isChatInputCommand() {
      return false;
    },
    isButton() {
      return true;
    },
    isModalSubmit() {
      return false;
    },
    async update(payload) {
      this.edits.push(payload);
    },
    async reply(payload) {
      this.replies.push(payload);
    },
    async showModal(modal) {
      this.modals.push(modal.toJSON());
    },
    async deferUpdate() {},
    async editReply() {},
    async followUp() {},
  };
}

test("painel guiado pede produto, duração e resumo antes de gravar", async () => {
  const app = harness();
  const config = { allowedGuildIds: [GUILD] };
  const home = button("atlasby:cfg:product:t4-4");
  await handleInteraction(home, { config, service: app.service });
  const durations = JSON.stringify(home.edits[0]);
  assert.match(durations, /atlasby:cfg:duration:t4-4:7d/);
  assert.match(durations, /atlasby:cfg:duration:t4-4:15d/);
  assert.match(textOf(home.edits[0]), /preço e disponível ou esgotado/i);

  const choice = button("atlasby:cfg:duration:t4-8:7d");
  await handleInteraction(choice, { config, service: app.service });
  const modal = choice.modals[0];
  assert.deepEqual(modal.components.map((row) => row.label), ["Preço em reais", "Disponibilidade"]);

  const stranger = button("atlasby:cfg:product:t4-4", ACTOR);
  await handleInteraction(stranger, { config, service: app.service });
  assert.match(textOf(stranger.edits[0]), /dono do servidor ou um administrador/);

  const pending = await app.service.requestSetOffer({
    guildId: GUILD,
    actorId: OWNER,
    sku: "t4-8",
    code: "7d",
    rawPrice: "12,50",
    available: true,
  });
  assert.equal(pending.code, "confirmation_required");
  assert.match(pending.summary, /R\$12,50/);
  assert.doesNotMatch(pending.summary, /estoque/);
  assert.equal(app.store.getItem(GUILD, "t4-8", "7d").price_cents, null);
  const saved = await app.service.confirm({
    confirmationId: pending.confirmationId,
    guildId: GUILD,
    moderatorId: OWNER,
    decision: "confirm",
  });
  assert.equal(saved.code, "config_saved");
  assert.equal(app.store.getItem(GUILD, "t4-8", "7d").price_cents, 1250);
  assert.equal(app.store.getItem(GUILD, "t4-8", "7d").stock, 0);
  assert.equal(app.store.getItem(GUILD, "t4-8", "7d").available, true);
  assert.equal(app.store.getItem(GUILD, "t4-4", "7d").price_cents, 3590);
  assert.equal(app.store.getItem(OTHER_GUILD, "t4-8", "7d"), null);
  app.close();
});

test("aparência tem prévia, confirmação e isolamento", async () => {
  const app = harness();
  const config = { allowedGuildIds: [GUILD] };
  const open = button("atlasby:cfg:appearance");
  await handleInteraction(open, { config, service: app.service });
  assert.match(JSON.stringify(open.edits[0]), /Visual do catálogo/);
  assert.match(JSON.stringify(open.edits[0]), /Mensagem do ticket/);
  assert.match(JSON.stringify(open.edits[0]), /Emojis dos botões/);

  const denied = await app.service.requestSetStyle({
    guildId: GUILD,
    actorId: ACTOR,
    patch: { catalogEmoji: "🙂" },
  });
  assert.equal(denied.code, "admin_unauthorized");
  const invalid = await app.service.requestSetStyle({
    guildId: GUILD,
    actorId: OWNER,
    patch: { catalogBannerUrl: "http://inseguro/banner.png" },
  });
  assert.equal(invalid.code, "media_invalid");
  assert.equal(app.store.getStyle(GUILD), null);

  const pending = await app.service.requestSetStyle({
    guildId: GUILD,
    actorId: OWNER,
    patch: {
      catalogEmoji: "🙂",
      catalogBannerUrl: "https://cdn.example/banner.png",
      openEmoji: "🎫",
      ticketGreeting: "Olá {usuario}",
      claimEmoji: "<:assumir:100000000000000022>",
    },
  });
  assert.equal(pending.code, "confirmation_required");
  assert.equal(app.store.getStyle(GUILD), null);
  const preview = (await import("../src/ui.js")).renderStylePreview(pending.preview, pending.confirmationId);
  const validation = validateV2Message(preview);
  assert.deepEqual(validation.errors, []);
  const json = JSON.stringify(preview);
  assert.match(json, /"type":12/);
  assert.match(json, /https:\/\/cdn\.example\/banner\.png/);
  assert.match(json, /atlasby:confirm:/);
  assert.doesNotMatch(textOf(preview), /@everyone|@here/);
  assert.match(textOf(preview), /Olá cliente/);

  const saved = await app.service.confirm({
    confirmationId: pending.confirmationId,
    guildId: GUILD,
    moderatorId: OWNER,
    decision: "confirm",
  });
  assert.equal(saved.code, "config_saved");
  assert.equal(app.store.getStyle(GUILD).catalog_emoji, "🙂");
  assert.equal(app.store.getStyle(GUILD).ticket_greeting, "Olá {usuario}");
  assert.equal(app.store.getStyle(OTHER_GUILD), null);

  const copy = await app.service.requestSetStyle({
    guildId: GUILD,
    actorId: OWNER,
    patch: {
      title_t4_4: "Plano de 4 vCPUs",
      emoji_t4_4: "🖥️",
      placeholder_t4_4: "Escolha o período de 4 vCPUs",
      faq_text: "Perguntas deste servidor.",
      faq_emoji: "❓",
      games_text: "Lista informada pela equipe.",
      games_emoji: "🎮",
    },
  });
  await app.service.confirm({ confirmationId: copy.confirmationId, guildId: GUILD, moderatorId: OWNER, decision: "confirm" });
  const style = app.store.getStyle(GUILD);
  assert.equal(style.title_t4_4, "Plano de 4 vCPUs");
  assert.equal(style.emoji_t4_4, "🖥️");
  assert.equal(style.placeholder_t4_4, "Escolha o período de 4 vCPUs");
  assert.equal(style.faq_text, "Perguntas deste servidor.");
  assert.equal(style.catalog_emoji, "🙂");
  assert.equal(app.store.getStyle(OTHER_GUILD), null);
  const catalog = await app.service.catalog({ guildId: GUILD });
  const rendered = JSON.stringify((await import("../src/ui.js")).renderCatalog(catalog.plans, catalog.style));
  assert.match(rendered, /Plano de 4 vCPUs/);
  assert.match(rendered, /atlasby:catalog:faq/);
  assert.match(rendered, /Jogos incompatíveis/);
  assert.doesNotMatch(rendered, /atlasby:ticket:open/);
  const hidden = JSON.stringify((await import("../src/ui.js")).renderCatalog(catalog.plans, null));
  assert.doesNotMatch(hidden, /atlasby:catalog:faq|atlasby:catalog:games/);
  app.close();
});
