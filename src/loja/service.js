import { randomUUID } from "node:crypto";
import { CATALOG, catalogBySku, durationMs, formatBrl, parseMoney, PLAN_NAMES, STORE_DESCRIPTION, storeBanner } from "./products.js";
import { BASE_THROUGHPUT } from "../maquina/limits.js";
import { emojiText } from "./emojis.js";
import { quotePrice, validateOffer } from "./promotions.js";
import { fitsPlan } from "./availability.js";
import { advanceProvision, resourceNames } from "./provision.js";
import { resolveGalleryImage } from "./image.js";
import { createWyzeCashClient, paymentAmount, paymentId, verifyWyzeCashSignature, webhookEvent, webhookEventId } from "./payments.js";
import { renderStorePanel } from "./panel.js";

const RESERVE_MS = 30 * 60 * 1000;
const CAPACITY_MS = 2 * 60 * 1000;
const DEFAULT_DESCRIPTION = STORE_DESCRIPTION;

export function createStore({ repo, config, audit, now = () => Date.now(), payments = null, sunshine = null, provisioner = null, infra = null, capacityReader = null }) {
  const gateway = payments ?? createWyzeCashClient({ apiKey: config.wyzecash?.apiKey || "", baseUrl: config.wyzecash?.baseUrl });
  function defaults() {
    return {
      title: "🎮 Ignix Cloud PC",
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

  let capacity = { ok: false, at: 0 };

  function activeOffer(guildId, sku, plan) {
    return repo.storeOffers(guildId).find((offer) => offer.sku === sku && offer.plan === plan && offer.active && offer.unitsLeft > 0 && offer.startsAt <= now() && now() < offer.endsAt) ?? null;
  }

  function catalogProducts(guildId) {
    return CATALOG.map((item) => {
      const saved = repo.storeProduct(guildId, item.sku);
      return {
        ...item,
        visible: true,
        roleId: saved?.roleId || "",
        azure: saved?.azure || { spot: true, location: config.azure?.location || "brazilsouth" },
        prices: item.prices,
      };
    });
  }

  async function note(guildId, actorId, action, detail) {
    await audit?.record({ guildId, actorId: actorId || "sistema", action, detail });
    repo.addStoreEvent({ guildId, kind: action, detail, now: now() });
  }

  return {
    panel(guildId) {
      const settings = settingsOf(guildId);
      return renderStorePanel({
        settings,
        products: catalogProducts(guildId),
        offers: repo.storeOffers(guildId),
        now: now(),
        capacity,
        bannerUrl: storeBanner(config.storeBannerUrl),
        supportUrl: repo.getSettings?.(guildId)?.supportUrl || config.supportUrl || "",
      });
    },
    noteCapacity(value) {
      capacity = { at: now(), ok: false, ...value };
    },
    async refreshCapacity() {
      if (capacity.at && now() - capacity.at < CAPACITY_MS && capacity.ok !== undefined) return capacity;
      const reader = capacityReader || (provisioner?.usage ? () => provisioner.usage(config.azure?.location || "brazilsouth") : null);
      if (!reader) {
        capacity = { ok: false, at: now() };
        return capacity;
      }
      try {
        const value = await reader();
        capacity = { at: now(), ok: Boolean(value?.ok), low: value?.low || null, cores: value?.cores || null, family: value?.family || null };
      } catch {
        capacity = { ok: false, at: now() };
      }
      return capacity;
    },
    async preparePanel(guildId) {
      repo.sweepOffers?.(guildId, now());
      await this.refreshCapacity();
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
    async setPurchases(guildId, actorId, { enabled }) {
      ready(guildId);
      if (!repo.setPurchasesEnabled(guildId, enabled)) return { ok: false, error: "A loja ainda não foi preparada." };
      await note(guildId, actorId, "compras", enabled ? "Compras ativadas." : "Compras desativadas.");
      return { ok: true };
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
      const product = catalogBySku(input.sku);
      const check = validateOffer({
        original: product?.prices?.[input.plan],
        promo: input.promoCents,
        units: input.units,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        now: now(),
        existing: repo.storeOffers(guildId),
        sku: input.sku,
        plan: input.plan,
      });
      if (!check.ok) return check;
      const offer = {
        id: randomUUID(), guildId, sku: input.sku, plan: input.plan, promoCents: check.promo,
        unitsLeft: input.units, startsAt: input.startsAt, endsAt: input.endsAt,
      };
      repo.saveOffer(offer);
      await note(guildId, actorId, "oferta", `Oferta criada para ${input.sku} ${input.plan}. Desconto de ${check.percent}%.`);
      return { ok: true, offer, percent: check.percent };
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
      const product = catalogProducts(guildId).find((item) => item.sku === sku);
      if (!product) return { ok: false, error: "Esse plano não está disponível." };
      if (settings.purchasesEnabled === false) return { ok: false, error: "Compras desativadas no momento." };
      if (!fitsPlan(product.vcpus, product.azure?.spot, capacity)) return { ok: false, error: "Este plano está indisponível no momento." };
      const quote = quotePrice({
        product, plan, now: now(), hoursEnabled: true, offer: activeOffer(guildId, sku, plan),
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
          : "A oferta acabou.";
        return { ok: false, error: message };
      }
      return { ok: true, order: reserved.order, product, quote };
    },
    rememberTicket(orderId, channelId, messageId) {
      return repo.patchOrder(orderId, { channelId, messageId }, now());
    },
    openOrder(guildId, userId) {
      return repo.openStoreOrder(guildId, userId);
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
      await note(guildId, actorId, "fechar_pedido", `Pedido fechado. Motivo: ${String(reason || "não informado").slice(0, 180)}. Reembolso de pedido pago é feito no painel da WyzeCash.`);
      return { ok: true };
    },
    async cancel(guildId, actorId, orderId) {
      return this.close(guildId, actorId, orderId, "Cancelado pelo administrador.");
    },
    async payment(orderId) {
      const order = repo.storeOrder(orderId);
      if (!order) return { ok: false, error: "Pedido não encontrado." };
      if (order.status !== "aguardando_pagamento") return { ok: false, error: "Este pedido não está aguardando pagamento." };
      if (!gateway?.configured) return { ok: false, error: "Defina WYZECASH_API_KEY no host. Nada foi cobrado." };
      if (order.pixCode) return { ok: true, order, copiaECola: order.pixCode };
      try {
        const charge = await gateway.createPayment({
          cents: order.totalCents,
          description: `Ignix Cloud PC ${order.id}`,
          idempotencyKey: order.id,
        });
        const expiresAt = Date.parse(charge.expiresAt);
        const next = repo.patchOrder(orderId, {
          chargeId: charge.id,
          pixCode: charge.copyPaste,
          pixExpiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
          reserveExpiresAt: Number.isFinite(expiresAt) ? expiresAt : order.reserveExpiresAt,
        }, now());
        repo.addStoreEvent({ guildId: order.guildId, orderId, kind: "pix", detail: "Cobrança Pix criada.", now: now() });
        return { ok: true, order: next, copiaECola: charge.copyPaste };
      } catch (error) {
        console.error(`WyzeCash: cobrança recusada (${error?.status || "erro"} ${error?.code || ""}).`.trim());
        return { ok: false, error: "Não foi possível gerar o Pix. Tente de novo em instantes." };
      }
    },
    rememberPaymentMessage(orderId, messageId) {
      return repo.patchOrder(orderId, { paymentMessageId: messageId }, now());
    },
    async confirmFromProvider(orderId) {
      const order = repo.storeOrder(orderId);
      if (!order) return { ok: false, error: "Pedido não encontrado." };
      if (order.status !== "aguardando_pagamento") {
        const paid = order.status === "pago" || order.status === "provisionando" || order.status === "acompanhamento" || order.status === "entregue";
        return { ok: true, paid, duplicate: true, orderId: order.id, order };
      }
      if (!order.chargeId || !gateway?.configured) return { ok: false, error: "Este pedido ainda não tem cobrança." };
      try {
        const charge = await gateway.getPayment(order.chargeId);
        return this.applyChargeStatus(order, charge);
      } catch (error) {
        console.error(`WyzeCash: consulta recusada (${error?.status || "erro"} ${error?.code || ""}).`.trim());
        return { ok: false, error: "Não foi possível consultar o pagamento agora." };
      }
    },
    applyChargeStatus(order, charge) {
      if (charge?.amount != null && Number.isInteger(charge.amount) && charge.amount !== order.totalCents) {
        repo.addStoreEvent({ guildId: order.guildId, orderId: order.id, kind: "valor", detail: "Consulta recusada porque o valor não confere.", now: now() });
        return { ok: false, error: "O valor da cobrança não confere com o pedido." };
      }
      if (charge?.status === "paid") return this.markPaid(order);
      if (charge?.status === "expired" || charge?.status === "refunded") {
        if (order.status === "aguardando_pagamento") repo.releaseOrder(order.id, "expirado", now());
        return { ok: true, expired: true, orderId: order.id };
      }
      return { ok: true, pending: true, orderId: order.id };
    },
    markPaid(order) {
      if (order.status !== "aguardando_pagamento") return { ok: true, paid: false, duplicate: true, orderId: order.id };
      repo.patchOrder(order.id, { status: "pago", paidAt: now() }, now());
      repo.addStoreEvent({ guildId: order.guildId, orderId: order.id, kind: "pago", detail: "Pagamento confirmado.", now: now() });
      return { ok: true, paid: true, orderId: order.id, status: 200 };
    },
    async pollPayments() {
      if (!gateway?.configured) return [];
      const changed = [];
      for (const order of repo.pendingCharges()) {
        const result = await this.confirmFromProvider(order.id);
        if (result.paid || result.expired) changed.push(result);
      }
      return changed;
    },
    async handleWebhook(raw, headers) {
      if (!verifyWyzeCashSignature(raw, headers, config.wyzecash?.webhookSecret || "", now())) return { status: 401 };
      let body = {};
      try { body = JSON.parse(raw); } catch { return { status: 400 }; }
      const event = webhookEvent(body, headers);
      const delivery = webhookEventId(body, headers);
      if (!delivery) return { status: 400 };
      if (!repo.rememberPaymentEvent(delivery, event || "desconhecido", now())) return { status: 200, duplicate: true };
      if (event !== "payment.paid" && event !== "payment.expired" && event !== "payment.refunded") return { status: 200 };
      const order = repo.findOrderByCharge(paymentId(body));
      if (!order) return { status: 200 };
      const cents = paymentAmount(body);
      if (cents != null && cents !== order.totalCents) {
        repo.addStoreEvent({ guildId: order.guildId, orderId: order.id, kind: "valor", detail: "Webhook recusado porque o valor não confere.", now: now() });
        return { status: 200, rejected: true };
      }
      if (event === "payment.expired" || event === "payment.refunded") {
        if (order.status === "aguardando_pagamento") repo.releaseOrder(order.id, "expirado", now());
        return { status: 200, expired: true, orderId: order.id };
      }
      const paid = this.markPaid(order);
      return { status: 200, paid: paid.paid, duplicate: paid.duplicate, orderId: paid.paid ? order.id : undefined };
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
      const catalog = catalogBySku(order.sku);
      repo.patchOrder(orderId, { status: "provisionando" }, now());
      const state = {
        orderId,
        step: "start",
        ...(order.provision || {}),
        names: order.provision?.names || resourceNames(orderId),
        location: azure.location || config.azure?.location, group: azure.group, size: azure.size || catalog?.vmSize, vcpus: catalog?.vcpus || product.vcpus,
        spot: azure.spot, disk: "Premium_LRS", diskGb: Math.min(512, config.azure?.maxOsDiskGb || 512),
        dataGb: catalog?.diskGb || product.diskGb,
        zone: config.azure?.zone || "",
        iops: config.azure?.dataIops || 3000,
        throughput: BASE_THROUGHPUT,
        vnet: azure.vnet, subnet: azure.subnet,
        nsg: azure.nsg, imageId: image.id, imageKind: image.kind,
      };
      const steps = {
        quota: (current) => provisioner.quota(current),
        ip: (current) => provisioner.ip(current),
        nic: (current) => provisioner.nic(current),
        disk: (current) => provisioner.disk(current),
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
          if (row.infra_id && infra?.setPower) {
            const result = await infra.setPower(row.infra_id, "desligada");
            if (result?.mode === "missing") console.warn(`Vencimento ${row.id}: máquina ausente na assinatura atual.`);
          }
        } catch (error) {
          const code = error?.code || "erro";
          console.warn(`Vencimento ${row.id}: ${code}. ${String(error?.message || "").split("\n")[0].slice(0, 180)}`);
        }
        repo.updatePower(row.id, "desligada", now());
        repo.markExpiryHandled(row.id);
        expired.push({
          guildId: row.guild_id,
          userId: row.user_id,
          machine: row.machine_name,
          gpu: row.gpu,
          vcpus: row.vcpus,
          ram: row.ram,
          ip: row.public_ip,
          plan: row.plan_type,
          startedAt: row.started_at,
          expiresAt: row.expires_at,
        });
      }
      return expired;
    },
    guilds() {
      return repo.storeGuilds();
    },
    status(guildId) {
      const settings = settingsOf(guildId);
      const products = catalogProducts(guildId);
      const lines = products.map((product) => `${product.name}: ${fitsPlan(product.vcpus, product.azure?.spot, capacity) ? "disponível" : "indisponível"}`);
      const offers = repo.storeOffers(guildId).filter((offer) => offer.unitsLeft > 0 && offer.startsAt <= now() && now() < offer.endsAt);
      const link = settings.channelId ? `https://discord.com/channels/${guildId}/${settings.channelId}` : "Painel ainda não publicado.";
      return [
        settings.purchasesEnabled === false ? "Compras desativadas." : "Compras ativas.",
        ...lines,
        offers.length ? offers.map((offer) => `Oferta ${offer.sku} ${offer.plan}: ${offer.unitsLeft} un.`).join("\n") : "Nenhuma oferta ativa.",
        link,
      ].join("\n");
    },
    activeOffers(guildId) {
      ready(guildId);
      return repo.storeOffers(guildId).filter((offer) => offer.unitsLeft > 0 && offer.startsAt <= now() && now() < offer.endsAt);
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
