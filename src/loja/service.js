import { randomUUID } from "node:crypto";
import { catalogBySku, durationMs, formatBrl, parseMoney, PLAN_NAMES } from "./products.js";
import { emojiText } from "./emojis.js";
import { priceFromDiscount, quotePrice } from "./promotions.js";
import { advanceProvision, resourceNames } from "./provision.js";
import { resolveGalleryImage } from "./image.js";
import { chargeCents, chargeReference, verifyWyviSignature } from "./payments.js";
import { renderStorePanel } from "./panel.js";

const RESERVE_MS = 30 * 60 * 1000;
const DEFAULT_DESCRIPTION = "Tenha seu próprio computador na nuvem! Jogue, trabalhe e utilize seus programas favoritos com desempenho e praticidade.";

export function createStore({ repo, config, audit, now = () => Date.now(), wyvi = null, sunshine = null, provisioner = null, infra = null }) {
  function defaults() {
    return {
      title: "🎮 Atlas Cloud PC",
      description: DEFAULT_DESCRIPTION,
      accent: 0x0a0a0a,
      location: config.azure?.location || "brazilsouth",
      vnet: config.azure?.virtualNetwork || "",
      subnet: config.azure?.subnet || "",
    };
  }

  function ready(guildId) {
    repo.ensureStore(guildId, now(), defaults());
  }

  function settingsOf(guildId) {
    ready(guildId);
    return repo.storeSettings(guildId);
  }

  function activeOffer(guildId, sku, plan) {
    return repo.storeOffers(guildId).find((offer) => offer.sku === sku && offer.plan === plan && offer.active && offer.unitsLeft > 0 && offer.startsAt <= now() && now() < offer.endsAt) ?? null;
  }

  async function note(guildId, actorId, action, detail) {
    await audit?.record({ guildId, actorId: actorId || "sistema", action, detail });
    repo.addStoreEvent({ guildId, kind: action, detail, now: now() });
  }

  return {
    panel(guildId, phase = 0) {
      const settings = settingsOf(guildId);
      return renderStorePanel({ settings, products: repo.storeProducts(guildId), offers: repo.storeOffers(guildId), now: now(), phase });
    },
    settings(guildId) {
      return settingsOf(guildId);
    },
    async saveSettings(guildId, actorId, patch) {
      const current = settingsOf(guildId);
      const next = { ...current, ...patch, guildId, updatedAt: now() };
      repo.saveStore(next);
      await note(guildId, actorId, "loja", "Configuração da loja atualizada.");
      return next;
    },
    async setHours(guildId, actorId, { enabled, price3h, price6h }) {
      const patch = {};
      if (typeof enabled === "boolean") patch.hoursEnabled = enabled;
      if (price3h) patch.price3h = price3h;
      if (price6h) patch.price6h = price6h;
      return this.saveSettings(guildId, actorId, patch);
    },
    async setStock(guildId, actorId, sku, stock) {
      ready(guildId);
      if (!repo.storeProduct(guildId, sku)) return { ok: false, error: "Produto não encontrado." };
      if (!repo.setStock(guildId, sku, stock)) return { ok: false, error: "Não foi possível ajustar o estoque." };
      await note(guildId, actorId, "estoque", `Estoque de ${sku} definido em ${stock}.`);
      return { ok: true, stock };
    },
    async changeStock(guildId, actorId, sku, delta) {
      ready(guildId);
      if (!repo.changeStock(guildId, sku, delta)) return { ok: false, error: "Estoque insuficiente ou produto inexistente." };
      await note(guildId, actorId, "estoque", `Estoque de ${sku} alterado em ${delta}.`);
      return { ok: true };
    },
    async saveProduct(guildId, actorId, row) {
      ready(guildId);
      const base = catalogBySku(row.sku) || repo.storeProduct(guildId, row.sku);
      repo.saveProduct({
        guildId,
        sku: row.sku,
        name: row.name || base?.name || row.sku,
        headline: row.headline || base?.headline || row.name || row.sku,
        specs: row.specs || base?.specs || "Configuração informada pelo administrador.",
        vmSize: row.vmSize || base?.vmSize || "",
        gpu: row.gpu || base?.gpu || "GPU",
        vcpus: row.vcpus || base?.vcpus || 1,
        ram: row.ram || base?.ram || "não informado",
        diskGb: row.diskGb || base?.diskGb || 512,
        stock: row.stock ?? 0,
        visible: row.visible !== false,
        roleId: row.roleId || base?.roleId || "",
        azure: row.azure || base?.azure || {},
        prices: row.prices || base?.prices || {},
      });
      await note(guildId, actorId, "produto", `Produto ${row.sku} gravado.`);
      return { ok: true };
    },
    async createOffer(guildId, actorId, input) {
      ready(guildId);
      const product = repo.storeProduct(guildId, input.sku);
      if (!product?.prices?.[input.plan]) return { ok: false, error: "Esse plano não existe nesse produto." };
      const original = product.prices[input.plan];
      const promo = input.percent ? priceFromDiscount(original, input.percent) : input.promoCents;
      if (!promo || promo >= original) return { ok: false, error: "O preço promocional precisa ser menor que o original." };
      const offer = {
        id: randomUUID(), guildId, sku: input.sku, plan: input.plan, promoCents: promo,
        unitsLeft: input.units, startsAt: input.startsAt, endsAt: input.endsAt,
      };
      repo.saveOffer(offer);
      await note(guildId, actorId, "oferta", `Oferta criada para ${input.sku} ${input.plan}.`);
      return { ok: true, offer };
    },
    async removeOffer(guildId, actorId, id) {
      if (!repo.deactivateOffer(guildId, id)) return { ok: false, error: "Oferta não encontrada." };
      await note(guildId, actorId, "oferta", "Oferta removida.");
      return { ok: true };
    },
    choose(guildId, userId, value, clientName) {
      ready(guildId);
      const split = String(value).lastIndexOf(":");
      if (split <= 0) return { ok: false, error: "Escolha inválida." };
      const sku = value.slice(0, split);
      const plan = value.slice(split + 1);
      const settings = repo.storeSettings(guildId);
      const product = repo.storeProduct(guildId, sku);
      const quote = quotePrice({
        product, plan, now: now(), hoursEnabled: settings.hoursEnabled,
        overrides: { price3h: settings.price3h, price6h: settings.price6h },
        offer: activeOffer(guildId, sku, plan),
      });
      if (!quote) return { ok: false, error: "Esse plano não está disponível." };
      const reserved = repo.reserveOrder({
        guildId, userId, sku, plan, clientName,
        originalCents: quote.original, discountCents: quote.discount, totalCents: quote.total,
        offerId: quote.offerId, reserveExpiresAt: now() + RESERVE_MS, now: now(),
      });
      if (!reserved.ok) {
        const message = reserved.error === "duplicado"
          ? "Você já tem um pedido aberto deste produto."
          : "Sem estoque no momento.";
        return { ok: false, error: message };
      }
      return { ok: true, order: reserved.order, product, quote };
    },
    rememberTicket(orderId, channelId, messageId) {
      return repo.patchOrder(orderId, { channelId, messageId }, now());
    },
    async claim(guildId, actorId, orderId) {
      const order = repo.storeOrder(orderId);
      if (!order || order.guildId !== guildId) return { ok: false, error: "Pedido não encontrado." };
      const next = repo.patchOrder(orderId, { assigneeId: actorId }, now());
      await note(guildId, actorId, "atendimento", `Atendimento assumido no pedido ${orderId}.`);
      return { ok: true, order: next };
    },
    async close(guildId, actorId, orderId, reason) {
      const order = repo.storeOrder(orderId);
      if (!order || order.guildId !== guildId) return { ok: false, error: "Pedido não encontrado." };
      if (order.status !== "entregue") repo.releaseOrder(orderId, "cancelado", now());
      else repo.patchOrder(orderId, { status: "cancelado" }, now());
      await note(guildId, actorId, "fechar_pedido", `Pedido fechado. Motivo: ${String(reason || "não informado").slice(0, 180)}. Reembolso de pedido pago é feito no painel da Wyvi.`);
      return { ok: true };
    },
    async cancel(guildId, actorId, orderId) {
      return this.close(guildId, actorId, orderId, "Cancelado pelo administrador.");
    },
    async payment(orderId) {
      const order = repo.storeOrder(orderId);
      if (!order) return { ok: false, error: "Pedido não encontrado." };
      if (order.status !== "aguardando_pagamento") return { ok: false, error: "Este pedido não está aguardando pagamento." };
      if (!wyvi?.configured) return { ok: false, error: "Defina WYVI_API_KEY no host. Nada foi cobrado." };
      if (order.pixCode) return { ok: true, order, copiaECola: order.pixCode, qrcode: "" };
      const charge = await wyvi.createCharge({
        cents: order.totalCents,
        description: `Atlas Cloud PC ${order.sku} ${PLAN_NAMES[order.plan] || order.plan}`,
        reference: order.id,
        idempotencyKey: order.id,
      });
      const next = repo.patchOrder(orderId, { chargeId: charge.id, pixCode: charge.copiaECola }, now());
      repo.addStoreEvent({ guildId: order.guildId, orderId, kind: "pix", detail: "Cobrança Pix criada.", now: now() });
      return { ok: true, order: next, copiaECola: charge.copiaECola, qrcode: charge.qrcode };
    },
    async handleWebhook(raw, headers) {
      if (!verifyWyviSignature(raw, headers, config.wyvi?.webhookSecret || "", now())) return { status: 401 };
      const event = String(headers["x-wyvi-evento"] || "");
      const delivery = String(headers["x-wyvi-entrega"] || "");
      if (!delivery) return { status: 400 };
      if (!repo.rememberWyviEvent(delivery, event || "desconhecido", now())) return { status: 200, duplicate: true };
      if (event !== "cobranca.paga") return { status: 200 };
      let body = {};
      try { body = JSON.parse(raw); } catch { return { status: 400 }; }
      const order = repo.findOrderByReference(chargeReference(body));
      if (!order) return { status: 200 };
      const cents = chargeCents(body);
      if (cents != null && cents !== order.totalCents) {
        repo.addStoreEvent({ guildId: order.guildId, orderId: order.id, kind: "valor", detail: "Webhook recusado porque o valor não confere.", now: now() });
        return { status: 200, rejected: true };
      }
      if (order.status === "aguardando_pagamento") repo.patchOrder(order.id, { status: "pago", paidAt: now() }, now());
      repo.addStoreEvent({ guildId: order.guildId, orderId: order.id, kind: "pago", detail: "Pagamento confirmado pelo webhook.", now: now() });
      return { status: 200, orderId: order.id };
    },
    async deliver(orderId, names, publicIp, vmId = "") {
      const order = repo.storeOrder(orderId);
      const product = repo.storeProduct(order.guildId, order.sku);
      const start = now();
      try {
        repo.insertClient({
          id: randomUUID(), guildId: order.guildId, userId: order.userId, clientName: order.clientName || "Cliente",
          machineName: names.vm, gpu: product.gpu, vcpus: product.vcpus, ram: product.ram, publicIp,
          rdpUser: null, rdpPasswordCipher: null, pinCipher: null, planType: order.plan, startedAt: start,
          expiresAt: durationMs(order.plan, start), infraId: vmId || order.provision?.vmId || "", powerStatus: "ligada", now: start,
        });
      } catch (error) {
        repo.patchOrder(orderId, { status: "acompanhamento" }, now());
        return { ok: false, error: "O cliente já tem máquina cadastrada. Nada foi sobrescrito." };
      }
      repo.patchOrder(orderId, { status: "entregue" }, now());
      return { ok: true, roleId: product.roleId, product, order: repo.storeOrder(orderId) };
    },
    async provision(orderId, hooks = {}) {
      const order = repo.storeOrder(orderId);
      if (!order) return { ok: false, error: "Pedido não encontrado." };
      if (order.status === "entregue" || order.provision?.step === "done") return { ok: true, done: true, order };
      const product = repo.storeProduct(order.guildId, order.sku);
      const settings = repo.storeSettings(order.guildId);
      const azure = product.azure || {};
      if (!azure.vnet || !azure.subnet) {
        const next = repo.patchOrder(orderId, { status: "acompanhamento", provision: { ...(order.provision || {}), step: "acompanhamento", error: "rede" } }, now());
        await note(order.guildId, "sistema", "provisionamento", `Pedido ${orderId} sem rede configurada.`);
        return { ok: false, error: "Configure a rede antes de criar a VM.", order: next };
      }
      const image = resolveGalleryImage({ storedId: settings.imageId, storedKind: settings.imageKind, envId: config.azure?.imageId });
      repo.patchOrder(orderId, { status: "provisionando" }, now());
      const state = {
        orderId,
        step: "start",
        ...(order.provision || {}),
        names: order.provision?.names || resourceNames(orderId),
        location: azure.location, group: azure.group, size: azure.size, vcpus: product.vcpus,
        spot: azure.spot, disk: azure.disk, diskGb: product.diskGb, vnet: azure.vnet, subnet: azure.subnet,
        nsg: azure.nsg, imageId: image.id, imageKind: image.kind,
      };
      const steps = {
        quota: (current) => provisioner.quota(current),
        ip: (current) => provisioner.ip(current),
        nic: (current) => provisioner.nic(current),
        vm: (current) => provisioner.vm(current),
        readIp: (current) => provisioner.readIp(current),
        health: async (ip) => {
          if (!sunshine?.health) return { ok: false };
          const deadline = Date.now() + (hooks.healthTimeoutMs ?? 120_000);
          const pause = hooks.healthIntervalMs ?? 5_000;
          let last = { ok: false };
          while (Date.now() <= deadline) {
            last = await sunshine.health(ip);
            if (last?.ok) return last;
            if (Date.now() + pause > deadline) break;
            await new Promise((resolve) => setTimeout(resolve, pause));
          }
          return last;
        },
      };
      try {
        await hooks.onProgress?.("Criando a máquina.");
        const result = await advanceProvision(state, steps);
        repo.patchOrder(orderId, { provision: result.state, status: result.state.step === "done" ? "provisionando" : "acompanhamento" }, now());
        if (result.state.step !== "done") {
          await note(order.guildId, "sistema", "provisionamento", `Pedido ${orderId} em acompanhamento: ${result.state.error || "falha"}.`);
          return { ok: false, error: result.state.error, order: repo.storeOrder(orderId) };
        }
        const delivered = await this.deliver(orderId, result.state.names, result.state.publicIp, result.state.vmId);
        return { ok: delivered.ok, delivered, state: result.state, created: result.created };
      } catch (error) {
        console.error(`Provisionamento ${orderId}: ${error instanceof Error ? error.message : "erro"}`);
        repo.patchOrder(orderId, { status: "acompanhamento" }, now());
        await note(order.guildId, "sistema", "provisionamento", `Falha ao criar a VM do pedido ${orderId}.`);
        return { ok: false, error: "falha" };
      }
    },
    expireReservations() {
      for (const order of repo.dueReservations(now())) repo.releaseOrder(order.id, "expirado", now());
    },
    async expireClients() {
      const expired = [];
      for (const row of repo.expiredClients(now())) {
        try {
          if (row.infra_id && infra?.setPower) await infra.setPower(row.infra_id, "desligada");
        } catch (error) {
          console.error(`Vencimento ${row.id}: ${error instanceof Error ? error.message : "erro"}`);
        }
        repo.updatePower(row.id, "desligada", now());
        repo.markExpiryHandled(row.id);
        expired.push({ userId: row.user_id, machine: row.machine_name });
      }
      return expired;
    },
    guilds() {
      return repo.storeGuilds();
    },
    hasOffer(guildId) {
      return repo.storeOffers(guildId).some((offer) => offer.active && offer.unitsLeft > 0 && offer.startsAt <= now() && now() < offer.endsAt);
    },
    orders(guildId) {
      ready(guildId);
      return repo.storeOrders(guildId);
    },
    order(id) {
      return repo.storeOrder(id);
    },
    paidText(order, product) {
      return [
        `${emojiText("verified")} Pagamento confirmado!`,
        "Estamos preparando sua Cloud PC. Você receberá outra notificação assim que a máquina estiver pronta.",
        `Produto: ${product?.headline || order.sku}`,
        `Plano: ${PLAN_NAMES[order.plan] || order.plan}`,
        `Valor pago: ${formatBrl(order.totalCents)}`,
      ].join("\n");
    },
    readyText(product, plan, ip) {
      return [
        `${emojiText("announcement")} Sua Cloud PC está pronta!`,
        `GPU: ${product.gpu}`,
        `Configuração: ${product.vcpus} vCPUs`,
        `Plano: ${PLAN_NAMES[plan] || plan}`,
        `IP público: ${ip}`,
        "Acesse o canal de painel para controlar sua máquina.",
      ].join("\n");
    },
    parseMoney,
  };
}
