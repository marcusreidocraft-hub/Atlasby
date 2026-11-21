import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase } from "../src/db/database.js";
import { readConfig } from "../src/config.js";
import { createStore } from "../src/loja/service.js";
import { advanceProvision } from "../src/loja/provision.js";
import { quotePrice, validateOffer } from "../src/loja/promotions.js";
import { fitsPlan } from "../src/loja/availability.js";
import { offerChoices, editStorePanel } from "../src/loja/router.js";
import { storeCommands } from "../src/loja/commands.js";
import { catalogBySku, formatBrl } from "../src/loja/products.js";
import { buildSpecializedVm, DEFAULT_GALLERY_IMAGE, resolveGalleryImage } from "../src/loja/image.js";
import { createAzureProvisioner } from "../src/loja/azure.js";
import { renderStorePanel } from "../src/loja/panel.js";
import { MessageFlags } from "discord.js";
import { isEmojiRejection, isStaleMessage, panelLocation, publishStorePanel, stripComponentEmojis } from "../src/loja/publish.js";
import { interactionErrorText } from "../src/components/reply.js";
import { attendanceOf, canAttend, ticketOverwrites } from "../src/loja/attendance.js";
import { createAdmin } from "../src/services/admin.js";

const GUILD = "100000000000000001";

function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-loja-"));
  const repo = openDatabase(dir);
  const config = readConfig({
    DISCORD_TOKEN: "token",
    DISCORD_CLIENT_ID: "100000000000000003",
    ALLOWED_GUILD_IDS: GUILD,
    WYVI_WEBHOOK_SECRET: "segredo-wyvi",
    AZURE_LOCATION: "brazilsouth",
  });
  const store = createStore({ repo, config, audit: { async record() {} }, now: () => Date.parse("2026-11-12T15:00:00Z") });
  store.noteCapacity({ ok: true, low: { used: 0, limit: 64 }, cores: { used: 0, limit: 64 }, family: { used: 0, limit: 64 } });
  store.settings(GUILD);
  return { repo, store, dir, close() { repo.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test("a VM especializada nasce da imagem da galeria sem perfil de sistema", async () => {
  const definition = DEFAULT_GALLERY_IMAGE.replace(/\/versions\/1\.0\.0$/, "");
  assert.equal(resolveGalleryImage({}).id, DEFAULT_GALLERY_IMAGE);
  assert.equal(resolveGalleryImage({ storedId: definition, storedKind: "gallery" }).id, definition);
  assert.equal(resolveGalleryImage({ storedKind: "snapshot", storedId: "/subscriptions/x/snapshots/old" }).kind, "snapshot");
  const body = buildSpecializedVm({
    location: "brazilsouth",
    size: "Standard_NC8as_T4_v3",
    nicId: "/nic/1",
    imageId: DEFAULT_GALLERY_IMAGE,
    diskGb: 512,
    spot: true,
  });
  assert.equal(body.osProfile, undefined);
  assert.equal(body.storageProfile.imageReference.id, DEFAULT_GALLERY_IMAGE);
  assert.equal(body.storageProfile.osDisk.createOption, "FromImage");
  assert.equal(body.storageProfile.diskControllerType, "SCSI");
  assert.equal(body.securityProfile.securityType, "TrustedLaunch");
  assert.equal(body.securityProfile.uefiSettings.secureBootEnabled, true);
  assert.equal(body.securityProfile.uefiSettings.vTpmEnabled, true);
  assert.equal(body.priority, "Spot");
  const recorded = [];
  const provisioner = createAzureProvisioner({ azure: { subscriptionId: "sub", tenantId: "t", clientId: "c", clientSecret: "s" } }, {
    compute: { virtualMachines: { async beginCreateOrUpdateAndWait(_group, _name, parameters) { recorded.push(parameters); return { id: "/vm" }; } } },
  });
  await provisioner.vm({
    group: "REIDO7", names: { vm: "atlas1", disk: "os1" }, location: "brazilsouth", size: "Standard_NC4as_T4_v3",
    nicId: "/nic/1", imageId: DEFAULT_GALLERY_IMAGE, imageKind: "gallery", diskGb: 512, disk: "PremiumV2_LRS", spot: true,
  });
  assert.equal(recorded[0].osProfile, undefined);
  assert.equal(recorded[0].storageProfile.imageReference.id, DEFAULT_GALLERY_IMAGE);
  assert.equal(recorded[0].securityProfile.securityType, "TrustedLaunch");
});

function selectsOf(view) {
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === 3) found.push(node);
    for (const child of node.components || []) walk(child);
  };
  walk(view.components[0].toJSON());
  return found;
}

function componentCount(node) {
  if (!node || typeof node !== "object") return 0;
  const children = node.components || [];
  return (node.type ? 1 : 0) + children.reduce((sum, child) => sum + componentCount(child), 0);
}

function textLength(node) {
  if (!node || typeof node !== "object") return 0;
  return (node.content?.length || 0) + (node.components || []).reduce((sum, child) => sum + textLength(child), 0);
}

test("o painel da loja é Components V2 e cada máquina tem o próprio seletor", () => {
  const products = [
    { sku: "t4-4", visible: true, gpu: "Tesla T4", vcpus: 4, ram: "28 GB", ramGib: 28, diskGb: 512, name: "T4 · 4 vCPUs", azure: { spot: true }, prices: { "3h": 459, "6h": 800, semanal: 2490, quinzenal: 3690, mensal: 4990 } },
    { sku: "t4-8", visible: true, gpu: "Tesla T4", vcpus: 8, ram: "56 GB", diskGb: 512, name: "T4 · 8 vCPUs", azure: { spot: true }, prices: { semanal: 3590, quinzenal: 5590, mensal: 6990 } },
    { sku: "t4-16", visible: true, gpu: "Tesla T4", vcpus: 16, ram: "110 GB", diskGb: 512, name: "T4 · 16 vCPUs", azure: { spot: true }, prices: { semanal: 4990, quinzenal: 6990, mensal: 8990 } },
  ];
  const capacity = { ok: true, low: { used: 4, limit: 10 }, cores: { used: 0, limit: 64 }, family: { used: 0, limit: 64 } };
  const view = renderStorePanel({
    settings: { description: "Tenha seu próprio computador na nuvem.", purchasesEnabled: true },
    products,
    offers: [{ id: "oferta", sku: "t4-4", plan: "semanal", promoCents: 1990, unitsLeft: 2, active: true, startsAt: 0, endsAt: 3_600_000 }],
    now: 1_000,
    capacity,
    bannerUrl: "https://cdn.example.com/ignix.png",
    supportUrl: "https://discord.com/channels/1/2",
  });
  const raw = JSON.stringify(view);
  const tree = view.components[0].toJSON();
  assert.equal(view.flags, MessageFlags.IsComponentsV2);
  assert.equal(view.embeds, undefined);
  assert.equal(view.content, undefined);
  assert.equal(tree.accent_color, 0x111111);
  assert.match(raw, /IGNIX CLOUD/);
  assert.match(raw, /Ignix Cloud PC/);
  assert.match(raw, /GPU Tesla T4 · 4 vCPUs · 28 GB · 512 GB/);
  assert.match(raw, /A partir de \*\*R\$ 4,59\*\*/);
  assert.match(raw, /~~R\$ 24,90~~ \*\*R\$ 19,90\*\*/);
  assert.match(raw, /<t:3600:R>/);
  assert.ok(componentCount(tree) <= 40);
  assert.ok(textLength(tree) <= 4000);
  const selects = selectsOf(view);
  assert.equal(selects.length, 3);
  const four = selects.find((item) => item.custom_id === "atlas:store:pick:t4-4");
  const eight = selects.find((item) => item.custom_id === "atlas:store:pick:t4-8");
  assert.deepEqual(four.options.map((item) => item.value), ["t4-4:3h", "t4-4:6h", "t4-4:semanal", "t4-4:quinzenal", "t4-4:mensal"]);
  assert.equal(four.disabled, undefined);
  assert.equal(eight.disabled, true);
  assert.equal(eight.placeholder, "Indisponível");
  const paused = renderStorePanel({
    settings: { purchasesEnabled: false },
    products,
    offers: [],
    now: 0,
    capacity,
  });
  assert.equal(selectsOf(paused).every((item) => item.disabled === true), true);
  assert.match(JSON.stringify(paused), /Compras pausadas/);
});

test("publicar cria outro painel quando a mensagem guardada não existe", async () => {
  const view = { components: [{ type: 17, components: [{ type: 3, emoji: { id: "1", name: "carrinho" } }] }], flags: MessageFlags.IsComponentsV2 };
  const sent = [];
  const outcome = await publishStorePanel({
    channelId: "canal-atual",
    settings: { channelId: "canal-atual", messageId: "mensagem-antiga" },
    view,
    fetchMessage: async () => {
      throw Object.assign(new Error("Unknown Message"), { code: 10008 });
    },
    edit: async () => {
      throw new Error("não deveria editar");
    },
    send: async (body) => {
      sent.push(body);
      return { id: "mensagem-nova" };
    },
  });
  assert.equal(outcome.created, true);
  assert.equal(outcome.messageId, "mensagem-nova");
  assert.equal(outcome.channelId, "canal-atual");
  assert.equal(sent.length, 1);
  assert.equal(isStaleMessage(Object.assign(new Error("Unknown Channel"), { code: 10003 })), true);
  assert.deepEqual(panelLocation({ currentChannelId: "a", nextChannelId: "b", messageId: "old" }), { channelId: "b", messageId: "" });
  assert.equal(panelLocation({ currentChannelId: "a", nextChannelId: "a", messageId: "old" }).messageId, "old");
  const emojiError = Object.assign(new Error("Invalid Form Body"), { code: 50035, rawError: { errors: { components: { 0: { emoji: "Invalid emoji" } } } } });
  assert.equal(isEmojiRejection(emojiError), true);
  let attempts = 0;
  await publishStorePanel({
    channelId: "outro",
    settings: { channelId: "antigo", messageId: "x" },
    view,
    fetchMessage: async () => { throw new Error("não consulta outro canal"); },
    edit: async () => { throw new Error("não edita"); },
    send: async (body) => {
      attempts += 1;
      if (attempts === 1) throw emojiError;
      assert.equal(JSON.stringify(body.components).includes("\"emoji\""), false);
      return { id: "sem-emoji" };
    },
  });
  assert.equal(attempts, 2);
  assert.equal(stripComponentEmojis(view.components)[0].components[0].emoji, undefined);
  assert.match(interactionErrorText(emojiError, true), /Código: 50035/);
  assert.doesNotMatch(interactionErrorText(emojiError, false), /50035/);
});

test("preços T4 e desconto saem só do servidor", () => {
  const t4 = catalogBySku("t4-4");
  assert.equal(t4.vcpus, 4);
  assert.equal(t4.ramGib, 28);
  assert.equal(t4.vmSize, "Standard_NC4as_T4_v3");
  assert.equal(catalogBySku("t4-8").ramGib, 56);
  assert.equal(catalogBySku("t4-16").ramGib, 110);
  assert.equal(quotePrice({ product: t4, plan: "mensal", now: 0 }).total, 4990);
  assert.equal(quotePrice({ product: t4, plan: "3h", now: 0, hoursEnabled: false }), null);
  const offer = { id: "oferta", sku: "t4-4", plan: "mensal", promoCents: 3990, unitsLeft: 2, active: true, startsAt: 0, endsAt: 10 };
  const quote = quotePrice({ product: t4, plan: "mensal", now: 5, offer });
  assert.equal(quote.total, 3990);
  assert.equal(quote.original, 4990);
  assert.equal(formatBrl(459), "R$ 4,59");
  assert.equal(catalogBySku("a10-1"), null);
});

test("a oferta sai na compra e volta se o pedido for cancelado", async () => {
  const env = world();
  try {
    const created = await env.store.createOffer(GUILD, "admin", {
      sku: "t4-4", plan: "mensal", promoCents: 3990, units: 1, startsAt: 1, endsAt: Date.parse("2026-12-01T00:00:00Z"),
    });
    assert.equal(created.ok, true);
    const again = await env.store.createOffer(GUILD, "admin", {
      sku: "t4-4", plan: "mensal", promoCents: 3500, units: 1, startsAt: 1, endsAt: Date.parse("2026-12-02T00:00:00Z"),
    });
    assert.match(again.error, /oferta ativa/);
    const first = env.store.choose(GUILD, "200000000000000001", "t4-4:mensal", "Ana");
    const second = env.store.choose(GUILD, "200000000000000002", "t4-4:mensal", "Bia");
    assert.equal(first.ok, true);
    assert.equal(first.order.totalCents, 3990);
    assert.equal(second.ok, true);
    assert.equal(second.order.totalCents, 4990);
    assert.equal(env.repo.storeOffers(GUILD).some((offer) => offer.id === created.offer.id), false);
    const shown = JSON.stringify(env.store.panel(GUILD));
    assert.match(shown, /IGNIX CLOUD/);
    assert.match(shown, /Escolher duração/);
    assert.match(shown, /R\$ 49,90/);
    await env.store.setPurchases(GUILD, "admin", { enabled: false });
    const blocked = env.store.choose(GUILD, "200000000000000003", "t4-4:semanal", "Caio");
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, "Compras desativadas no momento.");
    assert.match(JSON.stringify(env.store.panel(GUILD)), /Indisponível/);
    assert.equal(env.repo.releaseOrder(first.order.id, "cancelado", Date.parse("2026-11-12T15:00:00Z")), true);
    assert.equal(env.repo.storeOffers(GUILD).find((offer) => offer.id === created.offer.id).unitsLeft, 1);
    env.store.noteCapacity({ ok: false });
    assert.equal(env.store.choose(GUILD, "200000000000000004", "t4-16:mensal", "Duda").ok, false);
  } finally {
    env.close();
  }
});

test("webhook exige assinatura, confere o valor e não processa duas vezes", async () => {
  const env = world();
  try {
    const chosen = env.store.choose(GUILD, "200000000000000001", "t4-4:semanal", "Ana");
    const raw = JSON.stringify({ referencia: chosen.order.id, valor_centavos: chosen.order.totalCents });
    const stamp = String(Math.floor(Date.parse("2026-11-12T15:00:00Z") / 1000));
    const signature = createHmac("sha256", "segredo-wyvi").update(`${stamp}.${raw}`).digest("hex");
    const headers = { "x-wyvi-carimbo": stamp, "x-wyvi-assinatura": `v1=${signature}`, "x-wyvi-evento": "cobranca.paga", "x-wyvi-entrega": "entrega-1" };
    assert.equal((await env.store.handleWebhook(raw, { ...headers, "x-wyvi-assinatura": "v1=00" })).status, 401);
    const paid = await env.store.handleWebhook(raw, headers);
    const again = await env.store.handleWebhook(raw, headers);
    assert.equal(paid.orderId, chosen.order.id);
    assert.equal(again.duplicate, true);
    assert.equal(env.store.order(chosen.order.id).status, "pago");
    const other = env.store.choose(GUILD, "200000000000000003", "t4-8:mensal", "Caio");
    const wrongRaw = JSON.stringify({ referencia: other.order.id, valor_centavos: 1 });
    const wrongSig = createHmac("sha256", "segredo-wyvi").update(`${stamp}.${wrongRaw}`).digest("hex");
    await env.store.handleWebhook(wrongRaw, { ...headers, "x-wyvi-assinatura": `v1=${wrongSig}`, "x-wyvi-entrega": "entrega-2" });
    assert.equal(env.store.order(other.order.id).status, "aguardando_pagamento");
  } finally {
    env.close();
  }
});

test("a mesma VM não é criada duas vezes para o pedido", async () => {
  let created = 0;
  const steps = {
    async quota() { return { ok: true }; },
    async ip() { return "ip"; },
    async nic() { return "nic"; },
    async vm() { created += 1; return "vm"; },
    async readIp() { return "203.0.113.40"; },
    async health() { return { ok: true }; },
  };
  const first = await advanceProvision({ orderId: "abc123", step: "start" }, steps);
  const resumed = await advanceProvision({ ...first.state, step: "start" }, steps);
  assert.equal(created, 1);
  assert.equal(resumed.created, false);
  assert.equal(resumed.state.step, "done");
  const env = world();
  let vms = 0;
  try {
    const config = readConfig({
      DISCORD_TOKEN: "token",
      DISCORD_CLIENT_ID: "100000000000000003",
      ALLOWED_GUILD_IDS: GUILD,
      WYVI_WEBHOOK_SECRET: "segredo-wyvi",
    });
    const store = createStore({
      repo: env.repo,
      config,
      audit: { async record() {} },
      now: () => Date.parse("2026-11-12T15:00:00Z"),
      sunshine: { async health() { return { ok: true }; } },
      provisioner: {
        async quota() { return { ok: true }; },
        async ip() { return "/ip"; },
        async nic() { return "/nic"; },
        async vm() { vms += 1; return "/subscriptions/x/resourceGroups/Reido7/providers/Microsoft.Compute/virtualMachines/atlas"; },
        async readIp() { return "203.0.113.50"; },
      },
    });
    const product = env.repo.storeProduct(GUILD, "t4-4");
    await store.saveProduct(GUILD, "admin", { ...product, azure: { ...product.azure, vnet: "vnet", subnet: "sub", group: "Reido7" } });
    await store.saveSettings(GUILD, "admin", { imageId: "/subscriptions/x/resourceGroups/Reido7/providers/Microsoft.Compute/galleries/atlas/images/base/versions/1.0.0", imageKind: "gallery" });
    store.noteCapacity({ ok: true, low: { used: 0, limit: 64 }, cores: { used: 0, limit: 64 }, family: { used: 0, limit: 64 } });
    const chosen = store.choose(GUILD, "200000000000000009", "t4-4:mensal", "Ana");
    env.repo.patchOrder(chosen.order.id, { status: "pago", paidAt: 1 }, 1);
    const createdVm = await store.provision(chosen.order.id);
    const repeated = await store.provision(chosen.order.id);
    assert.equal(createdVm.ok, true);
    assert.equal(vms, 1);
    assert.equal(repeated.done, true);
    assert.equal(env.repo.getByOwner(GUILD, "200000000000000009").publicIp, "203.0.113.50");
    env.repo.saveSettings(GUILD, { supportUrl: "", logChannelId: "777", supportRoleId: "123", ticketCategoryId: "456", emoji: {} }, 1);
    env.repo.saveStore({ ...env.repo.storeSettings(GUILD), ticketCategoryId: "999", updatedAt: 1 });
    const desk = attendanceOf(env.repo, { adminRoleIds: ["9999"], adminLogChannelId: "888" }, GUILD);
    assert.equal(desk.supportRoleId, "123");
    assert.equal(desk.categoryId, "456");
    assert.equal(desk.logChannelId, "777");
    assert.deepEqual(desk.staffRoleIds, ["123", "9999"]);
    const fallbackRepo = openDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "atlas-desk-")));
    const fallback = attendanceOf(fallbackRepo, { adminRoleIds: ["9999"], adminLogChannelId: "888" }, GUILD);
    fallbackRepo.close();
    assert.equal(fallback.logChannelId, "888");
    assert.equal(fallback.categoryId, "");
    assert.equal(canAttend({ id: "1", owner: false, permissions: 0n, roleIds: ["123"] }, { adminRoleIds: [] }, desk), true);
    assert.equal(canAttend({ id: "2", owner: false, permissions: 0n, roleIds: [] }, { adminRoleIds: [] }, desk), false);
    assert.equal(ticketOverwrites({ everyoneId: "e", userId: "u", botId: "b", staffRoleIds: desk.staffRoleIds })[3].id, "123");
    const admin = createAdmin({
      config: { panelColor: 1, adminRoleIds: [], supportUrl: "" },
      repo: env.repo,
      audit: { async record() {} },
      sealer: null,
      emojis: { pack() { return {}; } },
      now: () => 1,
      infra: { configured: false },
    });
    admin.updateSettings(GUILD, { id: "1", owner: true, permissions: 8n, roleIds: [] }, { emoji: { controle: "x" } });
    assert.equal(env.repo.getSettings(GUILD).supportRoleId, "123");
    assert.equal(env.repo.getSettings(GUILD).logChannelId, "777");
  } finally {
    env.close();
  }
});

test("disponibilidade, oferta e o painel só mudam quando precisa", async () => {
  assert.equal(fitsPlan(4, true, { ok: true, low: { used: 2, limit: 6 } }), true);
  assert.equal(fitsPlan(8, true, { ok: true, low: { used: 2, limit: 6 } }), false);
  assert.equal(fitsPlan(4, false, { ok: true, family: { used: 1, limit: 8 }, cores: { used: 10, limit: 12 } }), false);
  assert.equal(fitsPlan(4, false, { ok: false }), false);
  const rejected = validateOffer({ original: 4990, promo: 4990, units: 1, startsAt: 1, endsAt: 5, now: 0, sku: "t4-4", plan: "mensal" });
  assert.match(rejected.error, /menor que o original/);
  const names = storeCommands().map((command) => command.name);
  assert.equal(names.includes("estoque"), false);
  assert.equal(names.includes("configurar-horas"), false);
  assert.deepEqual(storeCommands().find((command) => command.name === "configurar-loja").options.map((option) => option.name), ["publicar", "compras", "status"]);
  assert.equal(offerChoices([{ id: "abc", sku: "t4-4", plan: "mensal", unitsLeft: 2 }], "t4")[0].value, "abc");
  const env = world();
  try {
    env.repo.saveStore({ ...env.repo.storeSettings(GUILD), channelId: "100000000000000010", messageId: "100000000000000011", updatedAt: 1 });
    let edits = 0;
    const client = { channels: { async fetch() { return { messages: { async fetch() { return { id: "100000000000000011", async edit() { edits += 1; } }; } } }; } } };
    await editStorePanel(client, { store: env.store });
    await editStorePanel(client, { store: env.store });
    assert.equal(edits, 1);
    await env.store.setPurchases(GUILD, "admin", { enabled: false });
    await editStorePanel(client, { store: env.store });
    assert.equal(edits, 2);
  } finally {
    env.close();
  }
});
