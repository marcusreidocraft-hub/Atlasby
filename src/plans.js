export const PRODUCT_LINE = "Atlas";
const MAX_CENTS = 10_000_000;
const MAX_STOCK = 1_000_000;

export const PRODUCTS = Object.freeze([
  Object.freeze({
    sku: "t4-4",
    name: "Tesla T4 · 4 vCPU",
    vcpu: 4,
    durations: Object.freeze([
      Object.freeze({ code: "7d", label: "7 dias", durationDays: 7, priceCents: 3590, available: true, stock: null }),
      Object.freeze({ code: "15d", label: "Quinzenal", durationDays: 15, priceCents: 4990, available: true, stock: null }),
      Object.freeze({ code: "30d", label: "Mensal", durationDays: 30, priceCents: null, available: false, stock: null }),
    ]),
  }),
  Object.freeze({
    sku: "t4-8",
    name: "Tesla T4 · 8 vCPU",
    vcpu: 8,
    durations: Object.freeze([
      Object.freeze({ code: "7d", label: "7 dias", durationDays: 7, priceCents: null, available: false, stock: 0 }),
      Object.freeze({ code: "15d", label: "Quinzenal", durationDays: 15, priceCents: null, available: false, stock: 0 }),
      Object.freeze({ code: "30d", label: "Mensal", durationDays: 30, priceCents: null, available: false, stock: 0 }),
    ]),
  }),
  Object.freeze({
    sku: "t4-16",
    name: "Tesla T4 · 16 vCPU",
    vcpu: 16,
    durations: Object.freeze([
      Object.freeze({ code: "7d", label: "7 dias", durationDays: 7, priceCents: 4500, available: true, stock: 0 }),
      Object.freeze({ code: "15d", label: "Quinzenal", durationDays: 15, priceCents: 7500, available: true, stock: 0 }),
      Object.freeze({ code: "30d", label: "Mensal", durationDays: 30, priceCents: null, available: false, stock: 0 }),
    ]),
  }),
]);

const BY_SKU = new Map(PRODUCTS.map((product) => [product.sku, product]));

export function productSpec(sku) {
  return BY_SKU.get(sku) ?? null;
}

export function durationSpec(sku, code) {
  return productSpec(sku)?.durations.find((item) => item.code === code) ?? null;
}

export function planSpec(code) {
  return durationSpec("t4-4", code);
}

export function formatBrl(cents) {
  const reais = Math.trunc(cents / 100);
  const frac = String(Math.abs(cents % 100)).padStart(2, "0");
  return `R$${reais},${frac}`;
}

export function parseBrlToCents(input) {
  if (typeof input !== "string") return { ok: false, code: "price_invalid" };
  const text = input.trim().replace(/\s+/g, "").replace(/^R\$/i, "");
  if (!text) return { ok: false, code: "price_invalid" };
  let cents;
  if (/^\d{1,8}$/.test(text)) cents = Number(text);
  else {
    const match = /^(\d{1,6})[.,](\d{2})$/.exec(text);
    if (!match) return { ok: false, code: "price_invalid" };
    cents = Number(match[1]) * 100 + Number(match[2]);
  }
  if (!Number.isInteger(cents) || cents < 1 || cents > MAX_CENTS) return { ok: false, code: "price_invalid" };
  return { ok: true, cents };
}

export function parseStock(input) {
  const text = typeof input === "number" ? String(input) : typeof input === "string" ? input.trim() : "";
  if (!/^\d{1,7}$/.test(text)) return { ok: false, code: "stock_invalid" };
  const stock = Number(text);
  if (!Number.isInteger(stock) || stock < 0 || stock > MAX_STOCK) return { ok: false, code: "stock_invalid" };
  return { ok: true, stock };
}

export function validatePlanUpdate(spec, { priceCents, available }) {
  if (!spec || !BY_SKU.has(spec.sku ?? "t4-4") || !["7d", "15d", "30d"].includes(spec.code)) {
    return { ok: false, code: "plan_unknown" };
  }
  if (![7, 15, 30].includes(spec.durationDays)) return { ok: false, code: "plan_forbidden" };
  const on = Boolean(available);
  if (priceCents == null) {
    if (on) return { ok: false, code: "price_required" };
    return { ok: true, priceCents: null, available: false };
  }
  if (!Number.isInteger(priceCents) || priceCents < 1 || priceCents > MAX_CENTS) {
    return { ok: false, code: "price_invalid" };
  }
  return { ok: true, priceCents, available: on };
}

export function offerState(item) {
  if (item.price_cents == null || !item.available) {
    if (item.sku === "t4-8" && item.price_cents == null) return { openable: false, code: "sku_setup_required" };
    return { openable: false, code: "sold_out" };
  }
  if (item.stock === 0) return { openable: false, code: "out_of_stock" };
  return { openable: true, code: "open" };
}

function planTitle(plan) {
  return plan.label === "7 dias" ? "7 dias" : `${plan.label} · ${plan.duration_days} dias`;
}

export function publicPlanLine(plan) {
  const state = offerState(plan);
  const title = planTitle(plan);
  if (state.code === "sku_setup_required") return `${title} · aguardando preço e estoque`;
  if (state.code === "sold_out") {
    return plan.price_cents == null ? `${title} · Esgotado` : `${title} · ${formatBrl(plan.price_cents)} · Esgotado`;
  }
  if (state.code === "out_of_stock") return `${title} · ${formatBrl(plan.price_cents)} · estoque 0`;
  const stock = plan.stock == null ? "" : ` · estoque ${plan.stock}`;
  return `${title} · ${formatBrl(plan.price_cents)}${stock}`;
}

export function reservationLine(ticket) {
  const title = ticket.label === "7 dias" ? "7 dias" : `${ticket.label} · ${ticket.duration_days} dias`;
  return `${title} · ${formatBrl(ticket.price_cents)} reservados`;
}
