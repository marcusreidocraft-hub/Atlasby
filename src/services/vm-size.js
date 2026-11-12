const TABLE = {
  Standard_NC4as_T4_v3: { gpu: "Tesla T4", vcpus: 4, ram: "28 GB" },
  Standard_NC8as_T4_v3: { gpu: "Tesla T4", vcpus: 8, ram: "56 GB" },
  Standard_NC16as_T4_v3: { gpu: "Tesla T4", vcpus: 16, ram: "110 GB" },
  Standard_NC64as_T4_v3: { gpu: "Tesla T4", vcpus: 64, ram: "440 GB" },
  Standard_NV6ads_A10_v5: { gpu: "NVIDIA A10 1/6", vcpus: 6, ram: "55 GB" },
  Standard_NV12ads_A10_v5: { gpu: "NVIDIA A10 1/3", vcpus: 12, ram: "110 GB" },
  Standard_NV18ads_A10_v5: { gpu: "NVIDIA A10 1/2", vcpus: 18, ram: "220 GB" },
  Standard_NV36ads_A10_v5: { gpu: "NVIDIA A10", vcpus: 36, ram: "440 GB" },
  Standard_NV36adms_A10_v5: { gpu: "NVIDIA A10", vcpus: 36, ram: "880 GB" },
  Standard_NV72ads_A10_v5: { gpu: "NVIDIA A10 2", vcpus: 72, ram: "880 GB" },
  Standard_NC24ads_A100_v4: { gpu: "NVIDIA A100", vcpus: 24, ram: "220 GB" },
  Standard_NC48ads_A100_v4: { gpu: "NVIDIA A100 2", vcpus: 48, ram: "440 GB" },
  Standard_NC96ads_A100_v4: { gpu: "NVIDIA A100 4", vcpus: 96, ram: "880 GB" },
};

const A10_FRACTION = { 6: "1/6", 12: "1/3", 18: "1/2", 36: "1", 72: "2" };

export function specsFromSize(size) {
  const name = String(size ?? "").trim();
  if (TABLE[name]) return { ...TABLE[name], size: name };
  const vcpus = Number(/(?:NC|NV|ND|NP)(\d+)/i.exec(name)?.[1] || 0);
  if (/T4_v3/i.test(name)) return { gpu: "Tesla T4", vcpus, ram: "não informado", size: name };
  if (/A10_v5/i.test(name)) {
    const fraction = A10_FRACTION[vcpus];
    return { gpu: fraction && fraction !== "1" ? `NVIDIA A10 ${fraction}` : "NVIDIA A10", vcpus, ram: "não informado", size: name };
  }
  if (/A100/i.test(name)) return { gpu: "NVIDIA A100", vcpus, ram: "não informado", size: name };
  return { gpu: "não informado", vcpus, ram: "não informado", size: name };
}

export function headlineOf(gpu, vcpus) {
  const processor = gpu && gpu !== "não informado" ? gpu : "GPU não informada";
  const cores = vcpus ? `${vcpus} vCPU` : "vCPU não informado";
  return `${processor} · ${cores}`;
}
