export const PRODUCT_NAME = "Tesla T4 · 4 vCPU";
export const PRODUCT_LINE = "Nyx Cloud";

const MAX_CENTS = 10_000_000;

export const PLAN_SPECS = Object.freeze([
  Object.freeze({
    code: "7d",
    label: "7 dias",
    durationDays: 7,
    defaultPriceCents: 3590,
    defaultAvailable: true,
    temporaryPrice: false,
  }),
  Object.freeze({
    code: "15d",
    label: "Quinzenal",
    durationDays: 15,
    defaultPriceCents: 4990,
    defaultAvailable: true,
    temporaryPrice: true,
  }),
  Object.freeze({
    code: "30d",
    label: "Mensal",
    durationDays: 30,
    defaultPriceCents: null,
    defaultAvailable: false,
    temporaryPrice: false,
  }),
]);

const SPEC_BY_CODE = new Map(PLAN_SPECS.map((spec) => [spec.code, spec]));

export function planSpec(code) {
  return SPEC_BY_CODE.get(code) ?? null;
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

export function validatePlanUpdate(spec, { priceCents, available }) {
  if (!spec || !SPEC_BY_CODE.has(spec.code)) return { ok: false, code: "plan_unknown" };
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

export function publicPlanLine(plan) {
  if (!plan.available) return `${plan.label} · ${plan.duration_days} dias · Esgotado`;
  const price = formatBrl(plan.price_cents);
  if (plan.temporary_price) return `${plan.label} · ${plan.duration_days} dias · ${price} · preço temporário`;
  return `${plan.label} · ${price}`;
}
