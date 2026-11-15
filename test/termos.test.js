import assert from "node:assert/strict";
import test from "node:test";
import { MessageFlags } from "discord.js";
import { routeCommand } from "../src/commands/admin/router.js";
import { adminCommands } from "../src/commands/admin/commands.js";
import { TERMS_SECTIONS, TERMS_TITLE } from "../src/content/termos.js";
import { renderTermsMessages } from "../src/panels/termos.js";
import { zonedToUtc } from "../src/services/plans.js";

const OTHER = ["n", "y", "x"].join("");
const LINK = "https://discord.com/channels/100/200";

function walk(node, visit) {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (!node || typeof node !== "object") return;
  visit(node);
  if (node.components) walk(node.components, visit);
}

function messageText(payload) {
  const parts = [];
  let components = 0;
  walk(payload.components.map((component) => component.toJSON()), (node) => {
    components += 1;
    if (typeof node.content === "string") parts.push(node.content);
  });
  return { text: parts.join("\n"), components };
}

test("os termos cabem no Discord e usam a marca Atlas", () => {
  assert.equal(TERMS_SECTIONS.length, 24);
  assert.deepEqual(TERMS_SECTIONS.map((section) => section.number), Array.from({ length: 24 }, (_, index) => index + 1));
  const publishedAt = zonedToUtc(2026, 11, 15, 12, 0, 0);
  const messages = renderTermsMessages({ supportUrl: LINK, publishedAt });
  assert.ok(messages.length >= 6 && messages.length <= 10, `mensagens: ${messages.length}`);
  const all = [];
  for (const payload of messages) {
    assert.equal(payload.flags, MessageFlags.IsComponentsV2);
    assert.equal(payload.components.length, 1);
    assert.equal(payload.components[0].toJSON().accent_color, undefined);
    const { text, components } = messageText(payload);
    assert.ok(text.length > 0 && text.length <= 4000, `texto ${text.length}`);
    assert.ok(components <= 40, `componentes ${components}`);
    all.push(text);
  }
  const raw = all.join("\n");
  assert.equal(raw.toLowerCase().includes(OTHER), false);
  assert.equal(raw.includes("art. 49"), false);
  assert.equal(raw.includes("CDC"), false);
  assert.equal(raw.includes("discord.gg"), false);
  assert.match(all[0], new RegExp(`Termos de Uso - Atlas`));
  assert.match(all[0], /7232rules:1568512643961061386/);
  assert.match(all[0], /\*\*Ao contratar, acessar ou utilizar os serviços da Atlas Cloud PC/);
  assert.match(all[0], /## 1\. Sobre o serviço/);
  assert.equal(all.slice(1).some((text) => text.includes(TERMS_TITLE)), false);
  assert.match(all.at(-1), /Última atualização: 15\/11\/2026/);
  for (const section of TERMS_SECTIONS) {
    assert.equal(raw.includes(`## ${section.number}. ${section.title}`), true, section.title);
  }
  assert.match(raw, /a compra é final/);
  assert.match(raw, /Não há reembolso nessas situações/);
  assert.match(raw, new RegExp(`Suporte: ${LINK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(raw, /Responsável pelo serviço: Atlas Cloud PC/);
  const withoutLink = renderTermsMessages({ supportUrl: "", publishedAt }).map((payload) => messageText(payload).text).join("\n");
  assert.match(withoutLink, /link ainda não configurado neste servidor/);
  assert.equal(withoutLink.includes("discord.gg"), false);
});

test("só administrador publica os termos", async () => {
  const command = adminCommands().find((item) => item.name === "termos");
  assert.equal(command.options[0].name, "canal");
  assert.equal(command.options[0].required, false);
  const seen = [];
  const interaction = {
    commandName: "termos",
    user: { id: "membro" },
    member: { permissions: 0n, roles: [] },
    guild: { ownerId: "dono" },
    guildId: "g",
    deferred: false,
    replied: false,
    channel: { isTextBased: () => true, isDMBased: () => false, send: async () => { throw new Error("não deveria publicar"); } },
    options: { getChannel: () => null },
    async deferReply() { this.deferred = true; },
    async editReply(body) { seen.push(body); },
  };
  await routeCommand(interaction, { admin: { isAdmin: () => false }, config: { panelColor: 1 } });
  assert.match(JSON.stringify(seen), /administrador/);
  const sent = [];
  const target = { isTextBased: () => true, isDMBased: () => false, async send(payload) { sent.push(payload); } };
  const admin = {
    ...interaction,
    deferred: false,
    replied: false,
    options: { getChannel: () => target },
  };
  await routeCommand(admin, {
    admin: { isAdmin: () => true, supportUrl: () => LINK },
    config: { panelColor: 1 },
  });
  assert.equal(sent.length, renderTermsMessages({ supportUrl: LINK, publishedAt: Date.now() }).length);
  assert.match(JSON.stringify(seen.at(-1)), /Termos de Uso publicados/);
});
