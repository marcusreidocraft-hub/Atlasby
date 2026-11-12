import { randomUUID } from "node:crypto";
import { CATALOG } from "./products.js";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS store_settings (
    guild_id TEXT PRIMARY KEY,
    title TEXT,
    description TEXT,
    banner_url TEXT,
    accent INTEGER,
    channel_id TEXT,
    message_id TEXT,
    hours_enabled INTEGER NOT NULL DEFAULT 1,
    price_3h INTEGER,
    price_6h INTEGER,
    ticket_category_id TEXT,
    image_id TEXT,
    image_kind TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS store_products (
    guild_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    headline TEXT NOT NULL,
    specs TEXT NOT NULL,
    vm_size TEXT NOT NULL,
    gpu TEXT NOT NULL,
    vcpus INTEGER NOT NULL,
    ram TEXT NOT NULL,
    disk_gb INTEGER NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    purchases_enabled INTEGER NOT NULL DEFAULT 1,
    visible INTEGER NOT NULL DEFAULT 1,
    role_id TEXT,
    azure_json TEXT,
    prices_json TEXT,
    PRIMARY KEY (guild_id, sku)
  );
  CREATE TABLE IF NOT EXISTS store_offers (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    plan TEXT NOT NULL,
    promo_cents INTEGER NOT NULL,
    units_left INTEGER NOT NULL,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS store_orders (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    plan TEXT NOT NULL,
    original_cents INTEGER NOT NULL,
    discount_cents INTEGER NOT NULL,
    total_cents INTEGER NOT NULL,
    status TEXT NOT NULL,
    reserve_expires_at INTEGER,
    channel_id TEXT,
    message_id TEXT,
    assignee_id TEXT,
    charge_id TEXT,
    pix_code TEXT,
    paid_at INTEGER,
    provision_json TEXT,
    offer_id TEXT,
    client_name TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS wyvi_events (
    delivery_id TEXT PRIMARY KEY,
    event_name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS store_events (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    order_id TEXT,
    kind TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`;

const OPEN = "('aguardando_pagamento','pago','provisionando','acompanhamento')";

function mapProduct(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    sku: row.sku,
    name: row.name,
    headline: row.headline,
    specs: row.specs,
    vmSize: row.vm_size,
    gpu: row.gpu,
    vcpus: row.vcpus,
    ram: row.ram,
    diskGb: row.disk_gb,
    stock: row.stock,
    purchasesEnabled: row.purchases_enabled !== 0,
    visible: row.visible === 1,
    roleId: row.role_id || "",
    azure: row.azure_json ? JSON.parse(row.azure_json) : {},
    prices: row.prices_json ? JSON.parse(row.prices_json) : null,
  };
}

function mapOffer(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    sku: row.sku,
    plan: row.plan,
    promoCents: row.promo_cents,
    unitsLeft: row.units_left,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    active: row.active === 1,
  };
}

function mapOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    sku: row.sku,
    plan: row.plan,
    originalCents: row.original_cents,
    discountCents: row.discount_cents,
    totalCents: row.total_cents,
    status: row.status,
    reserveExpiresAt: row.reserve_expires_at,
    channelId: row.channel_id || "",
    messageId: row.message_id || "",
    assigneeId: row.assignee_id || "",
    chargeId: row.charge_id || "",
    pixCode: row.pix_code || "",
    paidAt: row.paid_at,
    provision: row.provision_json ? JSON.parse(row.provision_json) : null,
    offerId: row.offer_id || "",
    clientName: row.client_name || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSettings(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    title: row.title || "🎮 Atlas Cloud PC",
    description: row.description || "Tenha seu próprio computador na nuvem! Jogue, trabalhe e utilize seus programas favoritos com desempenho e praticidade.",
    bannerUrl: row.banner_url || "",
    accent: row.accent ?? 0x0a0a0a,
    channelId: row.channel_id || "",
    messageId: row.message_id || "",
    hoursEnabled: row.hours_enabled !== 0,
    price3h: row.price_3h,
    price6h: row.price_6h,
    ticketCategoryId: row.ticket_category_id || "",
    imageId: row.image_id || "",
    imageKind: row.image_kind || "",
    updatedAt: row.updated_at,
  };
}

export function attachStore(db) {
  db.exec(SCHEMA);
  const productColumns = db.prepare("PRAGMA table_info(store_products)").all();
  if (!productColumns.some((column) => column.name === "purchases_enabled")) {
    db.exec("ALTER TABLE store_products ADD COLUMN purchases_enabled INTEGER NOT NULL DEFAULT 1");
  }
  const columns = db.prepare("PRAGMA table_info(clients)").all();
  if (!columns.some((column) => column.name === "expiry_handled")) {
    db.exec("ALTER TABLE clients ADD COLUMN expiry_handled INTEGER NOT NULL DEFAULT 0");
  }
  const settings = db.prepare("SELECT * FROM store_settings WHERE guild_id = ?");
  const saveSettings = db.prepare(`INSERT INTO store_settings (
      guild_id, title, description, banner_url, accent, channel_id, message_id, hours_enabled, price_3h, price_6h,
      ticket_category_id, image_id, image_kind, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      title = excluded.title, description = excluded.description, banner_url = excluded.banner_url, accent = excluded.accent,
      channel_id = excluded.channel_id, message_id = excluded.message_id, hours_enabled = excluded.hours_enabled,
      price_3h = excluded.price_3h, price_6h = excluded.price_6h, ticket_category_id = excluded.ticket_category_id,
      image_id = excluded.image_id, image_kind = excluded.image_kind, updated_at = excluded.updated_at`);
  const product = db.prepare("SELECT * FROM store_products WHERE guild_id = ? AND sku = ?");
  const products = db.prepare("SELECT * FROM store_products WHERE guild_id = ? ORDER BY vcpus");
  const upsertProduct = db.prepare(`INSERT INTO store_products (
      guild_id, sku, name, headline, specs, vm_size, gpu, vcpus, ram, disk_gb, stock, purchases_enabled, visible, role_id, azure_json, prices_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, sku) DO UPDATE SET
      name = excluded.name, headline = excluded.headline, specs = excluded.specs, vm_size = excluded.vm_size,
      gpu = excluded.gpu, vcpus = excluded.vcpus, ram = excluded.ram, disk_gb = excluded.disk_gb,
      purchases_enabled = excluded.purchases_enabled,
      visible = excluded.visible, role_id = excluded.role_id, azure_json = excluded.azure_json, prices_json = excluded.prices_json`);
  const offers = db.prepare("SELECT * FROM store_offers WHERE guild_id = ? AND active = 1");
  const offerById = db.prepare("SELECT * FROM store_offers WHERE id = ?");
  const insertOffer = db.prepare(`INSERT INTO store_offers (id, guild_id, sku, plan, promo_cents, units_left, starts_at, ends_at, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`);
  const orderById = db.prepare("SELECT * FROM store_orders WHERE id = ?");
  const ordersByGuild = db.prepare("SELECT * FROM store_orders WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?");
  const due = db.prepare("SELECT * FROM store_orders WHERE status = 'aguardando_pagamento' AND reserve_expires_at IS NOT NULL AND reserve_expires_at <= ?");
  const resume = db.prepare("SELECT * FROM store_orders WHERE status IN ('pago', 'provisionando')");
  const expiredClients = db.prepare("SELECT * FROM clients WHERE expires_at <= ? AND expiry_handled = 0");

  function transaction(work) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* a transação já foi encerrada */ }
      throw error;
    }
  }

  function ensure(guildId, now, defaults) {
    if (!settings.get(guildId)) {
      saveSettings.run(guildId, defaults.title, defaults.description, "", defaults.accent, "", "", 1, null, null, "", "", "", now);
    }
    for (const item of CATALOG) {
      if (product.get(guildId, item.sku)) continue;
      upsertProduct.run(
        guildId, item.sku, item.name, item.headline, item.specs, item.vmSize, item.gpu, item.vcpus, item.ram, item.diskGb,
        0, 1, 1, "", JSON.stringify({
          location: defaults.location, group: "Reido7", size: item.vmSize, spot: true, disk: "PremiumV2_LRS",
          vnet: defaults.vnet, subnet: defaults.subnet, nsg: "Atlas-nsg",
        }),
        JSON.stringify(item.prices),
      );
    }
  }

  return {
    ensureStore: ensure,
    storeSettings(guildId) {
      return mapSettings(settings.get(guildId));
    },
    saveStore(row) {
      saveSettings.run(
        row.guildId, row.title, row.description, row.bannerUrl, row.accent, row.channelId, row.messageId,
        row.hoursEnabled ? 1 : 0, row.price3h, row.price6h, row.ticketCategoryId, row.imageId, row.imageKind, row.updatedAt,
      );
    },
    storeProducts(guildId) {
      return products.all(guildId).map(mapProduct);
    },
    storeProduct(guildId, sku) {
      return mapProduct(product.get(guildId, sku));
    },
    saveProduct(row) {
      const current = product.get(row.guildId, row.sku);
      const prices = row.prices || (current?.prices_json ? JSON.parse(current.prices_json) : {});
      const purchases = row.purchasesEnabled === undefined ? current?.purchases_enabled !== 0 : row.purchasesEnabled;
      upsertProduct.run(
        row.guildId, row.sku, row.name, row.headline, row.specs, row.vmSize, row.gpu, row.vcpus, row.ram, row.diskGb,
        current?.stock ?? row.stock ?? 0, purchases ? 1 : 0, row.visible ? 1 : 0, row.roleId || "", JSON.stringify(row.azure || {}),
        JSON.stringify(prices),
      );
    },
    setPurchases(guildId, sku, enabled) {
      const flag = enabled ? 1 : 0;
      if (sku) return db.prepare("UPDATE store_products SET purchases_enabled = ? WHERE guild_id = ? AND sku = ?").run(flag, guildId, sku).changes;
      return db.prepare("UPDATE store_products SET purchases_enabled = ? WHERE guild_id = ?").run(flag, guildId).changes;
    },
    setStock(guildId, sku, stock) {
      return db.prepare("UPDATE store_products SET stock = ? WHERE guild_id = ? AND sku = ?").run(Math.max(0, stock), guildId, sku).changes === 1;
    },
    changeStock(guildId, sku, delta) {
      return transaction(() => {
        const row = product.get(guildId, sku);
        if (!row) return false;
        const next = row.stock + delta;
        if (next < 0) return false;
        db.prepare("UPDATE store_products SET stock = ? WHERE guild_id = ? AND sku = ?").run(next, guildId, sku);
        return true;
      });
    },
    storeOffers(guildId) {
      return offers.all(guildId).map(mapOffer);
    },
    saveOffer(row) {
      insertOffer.run(row.id, row.guildId, row.sku, row.plan, row.promoCents, row.unitsLeft, row.startsAt, row.endsAt);
    },
    deactivateOffer(guildId, id) {
      return db.prepare("UPDATE store_offers SET active = 0 WHERE guild_id = ? AND id = ?").run(guildId, id).changes === 1;
    },
    reserveOrder(input) {
      return transaction(() => {
        const open = db.prepare(`SELECT id FROM store_orders WHERE guild_id = ? AND user_id = ? AND sku = ? AND status IN ${OPEN}`).get(input.guildId, input.userId, input.sku);
        if (open) return { ok: false, error: "duplicado" };
        const taken = db.prepare("UPDATE store_products SET stock = stock - 1 WHERE guild_id = ? AND sku = ? AND stock > 0 AND visible = 1").run(input.guildId, input.sku);
        if (taken.changes !== 1) return { ok: false, error: "estoque" };
        if (input.offerId) {
          const burned = db.prepare("UPDATE store_offers SET units_left = units_left - 1 WHERE id = ? AND units_left > 0 AND active = 1").run(input.offerId);
          if (burned.changes !== 1) {
            db.prepare("UPDATE store_products SET stock = stock + 1 WHERE guild_id = ? AND sku = ?").run(input.guildId, input.sku);
            return { ok: false, error: "oferta" };
          }
        }
        const id = randomUUID();
        db.prepare(`INSERT INTO store_orders (
          id, guild_id, user_id, sku, plan, original_cents, discount_cents, total_cents, status, reserve_expires_at,
          channel_id, message_id, assignee_id, charge_id, pix_code, paid_at, provision_json, offer_id, client_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aguardando_pagamento', ?, '', '', '', '', '', NULL, NULL, ?, ?, ?, ?)`).run(
          id, input.guildId, input.userId, input.sku, input.plan, input.originalCents, input.discountCents, input.totalCents,
          input.reserveExpiresAt, input.offerId || "", input.clientName || "", input.now, input.now,
        );
        return { ok: true, order: mapOrder(orderById.get(id)) };
      });
    },
    storeOrder(id) {
      return mapOrder(orderById.get(id));
    },
    storeGuilds() {
      return db.prepare("SELECT guild_id FROM store_settings").all().map((row) => row.guild_id);
    },
    storeOrders(guildId, limit = 15) {
      return ordersByGuild.all(guildId, limit).map(mapOrder);
    },
    patchOrder(id, patch, now) {
      const current = mapOrder(orderById.get(id));
      if (!current) return null;
      const next = { ...current, ...patch };
      db.prepare(`UPDATE store_orders SET status = ?, channel_id = ?, message_id = ?, assignee_id = ?, charge_id = ?, pix_code = ?,
        paid_at = ?, provision_json = ?, updated_at = ? WHERE id = ?`).run(
        next.status, next.channelId, next.messageId, next.assigneeId, next.chargeId, next.pixCode,
        next.paidAt, next.provision ? JSON.stringify(next.provision) : null, now, id,
      );
      return mapOrder(orderById.get(id));
    },
    releaseOrder(id, status, now) {
      return transaction(() => {
        const row = orderById.get(id);
        if (!row || !["aguardando_pagamento", "pago", "provisionando", "acompanhamento"].includes(row.status)) return false;
        db.prepare("UPDATE store_products SET stock = stock + 1 WHERE guild_id = ? AND sku = ?").run(row.guild_id, row.sku);
        if (row.offer_id) db.prepare("UPDATE store_offers SET units_left = units_left + 1 WHERE id = ?").run(row.offer_id);
        db.prepare("UPDATE store_orders SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
        return true;
      });
    },
    dueReservations(now) {
      return due.all(now).map(mapOrder);
    },
    resumeOrders() {
      return resume.all().map(mapOrder);
    },
    rememberWyviEvent(deliveryId, eventName, now) {
      const inserted = db.prepare("INSERT OR IGNORE INTO wyvi_events (delivery_id, event_name, created_at) VALUES (?, ?, ?)").run(deliveryId, eventName, now);
      return inserted.changes === 1;
    },
    findOrderByReference(reference) {
      return mapOrder(db.prepare("SELECT * FROM store_orders WHERE id = ?").get(reference));
    },
    addStoreEvent(row) {
      db.prepare("INSERT INTO store_events (id, guild_id, order_id, kind, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
        randomUUID(), row.guildId, row.orderId || "", row.kind, row.detail.slice(0, 500), row.now,
      );
    },
    expiredClients(now) {
      return expiredClients.all(now);
    },
    markExpiryHandled(id) {
      db.prepare("UPDATE clients SET expiry_handled = 1 WHERE id = ?").run(id);
    },
  };
}
