export const SKUS = Object.freeze({
  t4_4: "t4-4",
  t4_8: "t4-8",
  t4_16: "t4-16",
});

export const STORE_NAME = "IGNIX CLOUD";

export const STORE_DESCRIPTION = "Tenha seu próprio computador na nuvem! Jogue, trabalhe e utilize seus programas favoritos com desempenho e praticidade.";

const T4 = "NVIDIA Tesla T4 16 GB";

export const T4_16_DATA_GB = 2560;

export function suggestedDataGb(vcpus) {
  const cores = Number(vcpus) || 4;
  if (cores >= 16) return T4_16_DATA_GB;
  if (cores >= 8) return 1024;
  return 512;
}

export function dataDiskLabel(gb) {
  if (Number(gb) === 2560) return "2,5 TB SSD v2";
  return `${gb} GB SSD v2`;
}

export const CATALOG = Object.freeze([
  {
    sku: SKUS.t4_4,
    name: "Tesla T4 · 4 vCPU",
    headline: "Tesla T4 · 4 vCPU",
    specs: "4 núcleos • 28 GB RAM • 512 GB SSD v2 • Windows 10/11 • GPU NVIDIA Tesla T4 16 GB",
    vmSize: "Standard_NC4as_T4_v3",
    gpu: "Tesla T4",
    vcpus: 4,
    ramGib: 28,
    ram: "28 GB",
    diskGb: suggestedDataGb(4),
    processor: "AMD EPYC 7V12",
    gpuMemory: T4,
    prices: { semanal: 2490, quinzenal: 3690, mensal: 4990 },
    plans: ["semanal", "quinzenal", "mensal"],
    category: "Cloud PC",
  },
  {
    sku: SKUS.t4_8,
    name: "Tesla T4 · 8 vCPU",
    headline: "Tesla T4 · 8 vCPU",
    specs: "8 núcleos • 56 GB RAM • 1024 GB SSD v2 • Windows 10/11 • GPU NVIDIA Tesla T4 16 GB",
    vmSize: "Standard_NC8as_T4_v3",
    gpu: "Tesla T4",
    vcpus: 8,
    ramGib: 56,
    ram: "56 GB",
    diskGb: suggestedDataGb(8),
    processor: "AMD EPYC 7V12",
    gpuMemory: T4,
    prices: { semanal: 3590, quinzenal: 5590, mensal: 6990 },
    plans: ["semanal", "quinzenal", "mensal"],
    category: "Cloud PC",
  },
  {
    sku: SKUS.t4_16,
    name: "Tesla T4 · 16 vCPU",
    headline: "Tesla T4 · 16 vCPU",
    specs: "16 núcleos • 110 GB RAM • 2,5 TB SSD v2 • Windows 10/11 • GPU NVIDIA Tesla T4 16 GB",
    vmSize: "Standard_NC16as_T4_v3",
    gpu: "Tesla T4",
    vcpus: 16,
    ramGib: 110,
    ram: "110 GB",
    diskGb: suggestedDataGb(16),
    processor: "AMD EPYC 7V12",
    gpuMemory: T4,
    prices: { semanal: 4990, quinzenal: 6990, mensal: 8990 },
    plans: ["semanal", "quinzenal", "mensal"],
    category: "Cloud PC",
  },
]);

export function storeBanner(url) {
  return /^https:\/\//i.test(String(url || "")) ? String(url) : "";
}
