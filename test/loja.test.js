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
import { quotePrice } from "../src/loja/promotions.js";
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

test("o painel da loja é Components V2 e cada máquina tem o próprio seletor", () => {
  const products = [
    { sku: "t4-4", visible: true, stock: 0, purchasesEnabled: true, gpu: "Tesla T4", vcpus: 4, ramGib: 28, diskGb: 512, prices: { "3h": 459, "6h": 800, semanal: 2490, quinzenal: 3690, mensal: 4990 } },
    { sku: "t4-8", visible: true, stock: 5, purchasesEnabled: false, gpu: "Tesla T4", vcpus: 8, ram: "56 GB", diskGb: 512, prices: { semanal: 3590, quinzenal: 5590, mensal: 6990 } },
    { sku: "t4-16", visible: true, stock: 1, purchasesEnabled: true, gpu: "Tesla T4", vcpus: 16, ramGib: 110, diskGb: 512, prices: { semanal: 4990, quinzenal: 6990, mensal: 8990 } },
  ];
  const view = renderStorePanel({
    settings: { title: "🎮 Atlas Cloud PC", description: "Tenha seu próprio computador na nuvem.", accent: 0x0a0a0a, hoursEnabled: true },
    products,
    offers: [],
    now: 0,
  });
  const raw = JSON.stringify(view);
  assert.equal(view.flags, MessageFlags.IsComponentsV2);
  assert.equal(view.embeds, undefined);
  assert.equal(view.content, undefined);
  assert.equal(view.components[0].toJSON().accent_color, undefined);
  assert.equal((raw.match(/<:8688gaming:1568512664705961985>/g) || []).length, 1);
  assert.doesNotMatch(raw, /<:timer:|<:cash:|<:windows:|<:tools:|<:carrinho:/);
  assert.match(raw, /Tesla T4 · 4 vCPU/);
  assert.match(raw, /-# 28GB RAM \/ 512GB SSD/);
  assert.match(raw, /3h \*\*R\$ 4,59\*\*/);
  assert.match(raw, /7d \*\*R\$ 24,90\*\*/);
  const selects = selectsOf(view);
  assert.equal(selects.length, 3);
  const four = selects.find((item) => item.custom_id === "atlas:store:pick:t4-4");
  const eight = selects.find((item) => item.custom_id === "atlas:store:pick:t4-8");
  const sixteen = selects.find((item) => item.custom_id === "atlas:store:pick:t4-16");
  assert.deepEqual(four.options.map((item) => item.value), ["t4-4:3h", "t4-4:6h", "t4-4:semanal", "t4-4:quinzenal", "t4-4:mensal"]);
  assert.equal(four.options.every((item) => item.emoji === undefined), true);
  assert.equal(four.disabled, undefined);
  assert.equal(four.placeholder, "Escolher seu plano");
  assert.equal(eight.disabled, true);
  assert.equal(eight.placeholder, "Compras desativadas");
  assert.match(raw, /Esgotado/);
  assert.deepEqual(sixteen.options.map((item) => item.value), ["t4-16:semanal", "t4-16:quinzenal", "t4-16:mensal"]);
  assert.doesNotMatch(raw, /atlas:store:pick"/);
  const hourlyOff = renderStorePanel({
    settings: { title: "Atlas Cloud PC", description: "Loja", accent: 0x0a0a0a, hoursEnabled: false },
    products,
    offers: [],
    now: 0,
  });
  const fourOff = selectsOf(hourlyOff).find((item) => item.custom_id === "atlas:store:pick:t4-4");
  assert.deepEqual(fourOff.options.map((item) => item.value), ["t4-4:semanal", "t4-4:quinzenal", "t4-4:mensal"]);
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

test("estoque não fica negativo e o painel esconde hora desligada", async () => {
  const env = world();
  try {
    assert.equal(env.repo.setStock(GUILD, "t4-4", 1), true);
    const first = env.store.choose(GUILD, "200000000000000001", "t4-4:mensal", "Ana");
    const second = env.store.choose(GUILD, "200000000000000002", "t4-4:mensal", "Bia");
    assert.equal(first.ok, true);
    assert.equal(first.order.totalCents, 4990);
    assert.equal(second.ok, false);
    assert.equal(env.repo.storeProduct(GUILD, "t4-4").stock, 0);
    const shown = JSON.stringify(env.store.panel(GUILD));
    assert.match(shown, /Atlas Cloud PC/);
    assert.match(shown, /Escolher seu plano/);
    assert.doesNotMatch(shown, /Sem estoque no momento/);
    assert.match(shown, /R\$ 49,90/);
    await env.store.setPurchases(GUILD, "admin", { sku: "t4-4", enabled: false });
    const blocked = env.store.choose(GUILD, "200000000000000003", "t4-4:mensal", "Caio");
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, "Compras desativadas no momento.");
    assert.match(JSON.stringify(env.store.panel(GUILD)), /Compras desativadas/);
    await env.store.setHours(GUILD, "admin", { enabled: false });
    assert.doesNotMatch(JSON.stringify(env.store.panel(GUILD)), /3h \*\*/);
    assert.equal(env.repo.releaseOrder(first.order.id, "cancelado", 1), true);
    assert.equal(env.repo.storeProduct(GUILD, "t4-4").stock, 1);
  } finally {
    env.close();
  }
});

test("webhook exige assinatura, confere o valor e não processa duas vezes", async () => {
  const env = world();
  try {
    env.repo.setStock(GUILD, "t4-4", 2);
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
    env.repo.setStock(GUILD, "t4-8", 1);
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
    env.repo.setStock(GUILD, "t4-4", 1);
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
