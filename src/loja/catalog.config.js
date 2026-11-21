export const SKUS = Object.freeze({
  t4_4: "t4-4",
  t4_8: "t4-8",
  t4_16: "t4-16",
});

export const STORE_NAME = "IGNIX CLOUD";

export const STORE_DESCRIPTION = "Computador na nuvem com GPU Tesla T4 para jogar, trabalhar e usar seus programas. O Pix confirma e a máquina é entregue automaticamente.";

const T4 = "NVIDIA Tesla T4 16 GB";

export const CATALOG = Object.freeze([
  {
    sku: SKUS.t4_4,
    name: "T4 · 4 vCPUs",
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
    category: "Cloud PC",
  },
  {
    sku: SKUS.t4_8,
    name: "T4 · 8 vCPUs",
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
    category: "Cloud PC",
  },
  {
    sku: SKUS.t4_16,
    name: "T4 · 16 vCPUs",
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
    category: "Cloud PC",
  },
]);

export function storeBanner(url) {
  return /^https:\/\//i.test(String(url || "")) ? String(url) : "";
}
