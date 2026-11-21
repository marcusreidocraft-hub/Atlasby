import { CATALOG } from "./catalog.config.js";

export { CATALOG, SKUS, STORE_DESCRIPTION, STORE_NAME, T4_16_DATA_GB, dataDiskLabel, storeBanner, suggestedDataGb } from "./catalog.config.js";

export const PLAN_NAMES = Object.freeze({
  "3h": "3 horas",
  "6h": "6 horas",
  semanal: "Semanal",
  quinzenal: "Quinzenal",
  mensal: "Mensal",
});

export function formatBrl(cents) {
  const amount = (Number(cents) / 100).toFixed(2).replace(".", ",");
  return `R$ ${amount}`;
}

export function parseMoney(input) {
  const clean = String(input ?? "").trim().replace(/\s/g, "").replace(/^R\$/i, "").replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const cents = Math.round(Number(clean) * 100);
  return cents > 0 ? cents : null;
}

export function catalogBySku(sku) {
  return CATALOG.find((item) => item.sku === sku) ?? null;
}

export function listPrice(product, plan, overrides = {}) {
  if (plan === "3h" && overrides.price3h) return overrides.price3h;
  if (plan === "6h" && overrides.price6h) return overrides.price6h;
  return product?.prices?.[plan] ?? null;
}

export function durationMs(plan, start) {
  if (plan === "3h") return start + 3 * 60 * 60 * 1000;
  if (plan === "6h") return start + 6 * 60 * 60 * 1000;
  const days = { semanal: 7, quinzenal: 15, mensal: 30 }[plan];
  return days ? start + days * 24 * 60 * 60 * 1000 : null;
}
