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
    assert.match(shown, /Sem estoque no momento/);
    assert.match(shown, /R\$ 49,90/);
    await env.store.setHours(GUILD, "admin", { enabled: false });
    assert.doesNotMatch(JSON.stringify(env.store.panel(GUILD)), /3 horas/);
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
  } finally {
    env.close();
  }
});
