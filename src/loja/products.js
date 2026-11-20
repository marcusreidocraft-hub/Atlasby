export const SKUS = Object.freeze({
  t4_4: "t4-4",
  t4_8: "t4-8",
  t4_16: "t4-16",
});

const T4 = "NVIDIA Tesla T4 16 GB";

export const CATALOG = Object.freeze([
  {
    sku: SKUS.t4_4,
    name: "Tesla T4 · 4 vCPUs",
    headline: "Tesla T4 • 4 vCPUs",
    specs: "4 núcleos • 28 GB RAM • 512 GB SSD v2 • Windows 10/11 • GPU NVIDIA Tesla T4 16 GB",
    vmSize: "Standard_NC4as_T4_v3",
    gpu: "Tesla T4",
    vcpus: 4,
    ramGib: 28,
    ram: "28 GB",
    diskGb: 512,
    processor: "AMD EPYC 7V12",
    gpuMemory: T4,
    prices: { "3h": 459, "6h": 800, semanal: 2490, quinzenal: 3690, mensal: 4990 },
    plans: ["3h", "6h", "semanal", "quinzenal", "mensal"],
    emoji: "🎮",
  },
  {
    sku: SKUS.t4_8,
    name: "Tesla T4 · 8 vCPUs",
    headline: "Tesla T4 • 8 vCPUs",
    specs: "8 núcleos • 56 GB RAM • 512 GB SSD v2 • Windows 10/11 • GPU NVIDIA Tesla T4 16 GB",
    vmSize: "Standard_NC8as_T4_v3",
    gpu: "Tesla T4",
    vcpus: 8,
    ramGib: 56,
    ram: "56 GB",
    diskGb: 512,
    processor: "AMD EPYC 7V12",
    gpuMemory: T4,
    prices: { semanal: 3590, quinzenal: 5590, mensal: 6990 },
    plans: ["semanal", "quinzenal", "mensal"],
    emoji: "⚡",
  },
  {
    sku: SKUS.t4_16,
    name: "Tesla T4 · 16 vCPUs",
    headline: "Tesla T4 • 16 vCPUs",
    specs: "16 núcleos • 110 GB RAM • 512 GB SSD v2 • Windows 10/11 • GPU NVIDIA Tesla T4 16 GB",
    vmSize: "Standard_NC16as_T4_v3",
    gpu: "Tesla T4",
    vcpus: 16,
    ramGib: 110,
    ram: "110 GB",
    diskGb: 512,
    processor: "AMD EPYC 7V12",
    gpuMemory: T4,
    prices: { semanal: 4990, quinzenal: 6990, mensal: 8990 },
    plans: ["semanal", "quinzenal", "mensal"],
    emoji: "🚀",
  },
]);

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
