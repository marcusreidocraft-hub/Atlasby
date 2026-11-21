import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { chargeFiles, renderChargePanel } from "../src/loja/charge-panel.js";
import { createStoreHttp } from "../src/loja/http.js";
import { createWyzeCashClient, verifyWyzeCashSignature, WYZECASH_API_BASE } from "../src/loja/payments.js";
import { createStore } from "../src/loja/service.js";
import { openDatabase } from "../src/db/database.js";
import { readConfig } from "../src/config.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SECRET = "segredo-do-webhook";
const STAMP = String(Math.floor(Date.parse("2026-11-12T15:00:00Z") / 1000));

function sign(raw, stamp = STAMP, secret = SECRET) {
  return createHmac("sha256", secret).update(`${stamp}.${raw}`).digest("hex");
}

test("a assinatura aceita o corpo cru e recusa segredo, prazo e alteração", () => {
  const raw = JSON.stringify({ id: "evt-1", type: "payment.paid" });
  const headers = { "x-wyzecash-signature": `t=${STAMP},v1=${sign(raw)}` };
  const now = Date.parse("2026-11-12T15:00:00Z");
  assert.equal(verifyWyzeCashSignature(raw, headers, SECRET, now), true);
  assert.equal(verifyWyzeCashSignature(raw, headers, "outro", now), false);
  assert.equal(verifyWyzeCashSignature(`${raw} `, headers, SECRET, now), false);
  assert.equal(verifyWyzeCashSignature(raw, { "x-wyzecash-signature": `t=${Number(STAMP) - 301},v1=${sign(raw, String(Number(STAMP) - 301))}` }, SECRET, now), false);
  assert.equal(verifyWyzeCashSignature(raw, { "x-wyzecash-signature": `t=${STAMP},v1=${"0".repeat(64)}` }, SECRET, now), false);
});

test("criar e consultar cobrança usa centavos, Idempotency-Key e o copyPaste", async () => {
  const calls = [];
  const client = createWyzeCashClient({
    apiKey: "wyze_teste",
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method, headers: init.headers, body: init.body });
      const payload = init.method === "POST"
        ? { id: "BKY-9", copyPaste: "00020126580014br.gov.bcb.pix", expiresAt: "2026-11-12T15:30:00.000Z", status: "pending", amount: 2490 }
        : { id: "BKY-9", copyPaste: "00020126580014br.gov.bcb.pix", status: "paid", amount: 2490 };
      return { ok: true, async json() { return payload; } };
    },
  });
  const created = await client.createPayment({ cents: 2490, description: "Ignix", idempotencyKey: "pedido-1052" });
  assert.equal(created.copyPaste, "00020126580014br.gov.bcb.pix");
  assert.equal(created.id, "BKY-9");
  assert.equal(calls[0].url, `${WYZECASH_API_BASE}/payments`);
  assert.equal(calls[0].headers.authorization, "Bearer wyze_teste");
  assert.equal(calls[0].headers["idempotency-key"], "pedido-1052");
  assert.equal(JSON.parse(calls[0].body).amount, 2490);
  assert.equal(JSON.parse(calls[0].body).method, "pix");
  const found = await client.getPayment("BKY-9");
  assert.equal(found.status, "paid");
  assert.equal(calls[1].url, `${WYZECASH_API_BASE}/payments/BKY-9`);
  assert.equal(calls[1].method, "GET");
});

test("o painel de pagamento mostra valor, oferta, QR, código e confirmação", async () => {
  const order = {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    originalCents: 2490,
    discountCents: 500,
    totalCents: 1990,
    pixCode: "00020126580014br.gov.bcb.pix",
    status: "aguardando_pagamento",
    pixExpiresAt: Date.parse("2026-11-12T15:30:00.000Z"),
  };
  const raw = JSON.stringify(renderChargePanel(order, { withQr: true }));
  assert.match(raw, /R\$ 19,90/);
  assert.match(raw, /oferta de R\$ 5,00/);
  assert.match(raw, /Aguardando pagamento/);
  assert.match(raw, /```\\n00020126580014br\.gov\.bcb\.pix\\n```/);
  assert.doesNotMatch(raw, /Copia e cola/);
  assert.match(raw, /Copiar código/);
  assert.match(raw, /Já paguei/);
  assert.match(raw, /attachment:\/\/pix-qr\.png/);
  const files = await chargeFiles(order);
  assert.equal(files[0].name, "pix-qr.png");
  const paid = JSON.stringify(renderChargePanel({ ...order, status: "pago" }));
  assert.match(paid, /Pagamento confirmado/);
  assert.doesNotMatch(paid, /Copiar código/);
});

test("pagamento confirmado é idempotente e a expiração devolve a oferta", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-wyze-"));
  const repo = openDatabase(dir);
  const config = readConfig({
    DISCORD_TOKEN: "token",
    DISCORD_CLIENT_ID: "100000000000000003",
    ALLOWED_GUILD_IDS: "100000000000000001",
    WYZECASH_API_KEY: "wyze_teste",
    WYZECASH_WEBHOOK_SECRET: SECRET,
  });
  let lookups = 0;
  const keys = [];
  const payments = createWyzeCashClient({
    apiKey: "wyze_teste",
    fetchImpl: async (_url, init) => {
      if (init?.method === "POST") {
        keys.push(init.headers["idempotency-key"]);
        return { ok: true, async json() { return { id: "BKY-OFERTA", copyPaste: "000201", expiresAt: "2026-11-12T15:30:00.000Z", status: "pending", amount: 1990 }; } };
      }
      lookups += 1;
      return { ok: true, async json() { return { id: "BKY-OFERTA", status: lookups < 2 ? "pending" : "paid", amount: 1990 }; } };
    },
  });
  const store = createStore({
    repo, config, payments,
    audit: { async record() {} },
    now: () => Date.parse("2026-11-12T15:00:00Z"),
  });
  store.noteCapacity({ ok: true, low: { used: 0, limit: 64 }, cores: { used: 0, limit: 64 }, family: { used: 0, limit: 64 } });
  store.settings("100000000000000001");
  try {
    const created = await store.createOffer("100000000000000001", "admin", {
      sku: "t4-4", plan: "semanal", promoCents: 1990, units: 2, startsAt: 1, endsAt: Date.parse("2026-12-02T00:00:00Z"),
    });
    const chosen = store.choose("100000000000000001", "200000000000000001", "t4-4:semanal", "Ana");
    assert.equal(repo.storeOffers("100000000000000001").find((offer) => offer.id === created.offer.id).unitsLeft, 1);
    const charged = await store.payment(chosen.order.id);
    assert.equal(charged.ok, true);
    assert.equal(charged.order.chargeId, "BKY-OFERTA");
    assert.equal(charged.order.pixCode, "000201");
    const again = await store.payment(chosen.order.id);
    assert.equal(again.reused, true);
    assert.equal(again.order.chargeId, "BKY-OFERTA");
    repo.patchOrder(chosen.order.id, { pixExpiresAt: 1 }, 1);
    const renewed = await store.payment(chosen.order.id);
    assert.equal(renewed.order.pixCode, "000201");
    assert.deepEqual(keys, [chosen.order.id, `${chosen.order.id}:1`]);
    const pending = await store.confirmFromProvider(chosen.order.id);
    assert.equal(pending.pending, true);
    const paid = await store.confirmFromProvider(chosen.order.id);
    assert.equal(paid.paid, true);
    const repeated = await store.confirmFromProvider(chosen.order.id);
    assert.equal(repeated.duplicate, true);
    assert.equal(store.order(chosen.order.id).status, "pago");

    const second = store.choose("100000000000000001", "200000000000000002", "t4-4:semanal", "Bia");
    repo.patchOrder(second.order.id, { chargeId: "BKY-EXP" }, 1);
    const raw = JSON.stringify({ id: "evt-exp", type: "payment.expired", data: { id: "BKY-EXP", amount: second.order.totalCents } });
    const signature = sign(raw);
    const expired = await store.handleWebhook(raw, { "x-wyzecash-signature": `t=${STAMP},v1=${signature}`, "x-wyzecash-event": "payment.expired" });
    assert.equal(expired.expired, true);
    assert.equal(expired.chargeCleared, true);
    assert.equal(store.order(second.order.id).status, "aguardando_pagamento");
    assert.equal(store.order(second.order.id).pixCode, "");
    await store.close("100000000000000001", "admin", second.order.id, "desistiu");
    assert.equal(repo.storeOffers("100000000000000001").find((offer) => offer.id === created.offer.id).unitsLeft, 1);
  } finally {
    repo.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("o servidor HTTP só aceita o webhook da WyzeCash", async () => {
  const server = createStoreHttp(async () => 200);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const ok = await fetch(`http://127.0.0.1:${port}/webhooks/wyzecash`, { method: "POST", body: "{}" });
    const missing = await fetch(`http://127.0.0.1:${port}/webhooks/outro`, { method: "POST", body: "{}" });
    assert.equal(ok.status, 200);
    assert.equal(missing.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
