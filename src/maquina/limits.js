export const DATA_SIZES = Object.freeze([128, 256, 512, 1024, 2048]);
export const IOPS_CHOICES = Object.freeze([3000, 5000, 8000, 12000, 16000]);
export const BASE_IOPS = 3000;
export const BASE_THROUGHPUT = 125;
export const MAX_IOPS = 80000;
export const MAX_THROUGHPUT = 1200;

export function maxIopsForSize(gb) {
  const size = Number(gb);
  if (!Number.isInteger(size) || size <= 6) return BASE_IOPS;
  return Math.min(MAX_IOPS, 500 * size);
}

export function maxThroughputForIops(iops) {
  const ops = Number(iops);
  if (!Number.isInteger(ops) || ops <= 0) return BASE_THROUGHPUT;
  return Math.min(MAX_THROUGHPUT, ops / 4);
}

export function autoThroughput(iops) {
  return Math.max(BASE_THROUGHPUT, maxThroughputForIops(iops));
}

export function validateDataDisk({ gb, iops, throughput }) {
  const size = Number(gb);
  const ops = Number(iops);
  const speed = Number(throughput);
  if (!DATA_SIZES.includes(size)) return { ok: false, error: "Escolha um disco de 128, 256, 512, 1024 ou 2048 GB." };
  const iopsCap = maxIopsForSize(size);
  if (!Number.isInteger(ops) || ops < BASE_IOPS || ops > iopsCap) {
    return { ok: false, error: `O IOPS deste disco fica entre ${BASE_IOPS} e ${iopsCap}.` };
  }
  const speedCap = maxThroughputForIops(ops);
  if (!Number.isInteger(speed) || speed < BASE_THROUGHPUT || speed > speedCap) {
    return { ok: false, error: `A taxa deste IOPS fica entre ${BASE_THROUGHPUT} e ${speedCap} MB/s.` };
  }
  return { ok: true, value: { gb: size, iops: ops, throughput: speed } };
}

export function azureErrorText(error) {
  const message = String(error?.message || error || "");
  const code = String(error?.code || "");
  let lead = "Não foi possível criar a máquina.";
  if (/AuthorizationFailed|does not have authorization|AuthorizationPermissionMismatch/i.test(`${code} ${message}`)) {
    lead = "O aplicativo não tem permissão para criar recursos nesta assinatura. Peça Contributor no grupo de recursos ou na assinatura.";
  } else if (/ResourceGroupNotFound/i.test(`${code} ${message}`)) {
    lead = "O grupo de recursos não existe nesta assinatura.";
  } else if (/ResourceNotFound/i.test(`${code} ${message}`)) {
    lead = "Um recurso necessário não foi encontrado nesta assinatura.";
  } else if (/QuotaExceeded|quota/i.test(`${code} ${message}`)) lead = "A cota desta família acabou.";
  else if (/PremiumV2|does not support.*zone|AvailabilityZone/i.test(message)) lead = "Esta região ou zona não aceita disco Premium SSD v2.";
  else if (/spot/i.test(message) && /capacity|unavailable|SkuNotAvailable|Overconstrained/i.test(message)) {
    lead = "Não há capacidade Spot para este tamanho agora. Tente de novo ou escolha Normal.";
  } else if (/SkuNotAvailable|ZonalAllocationFailed|OverconstrainedAllocation|Capacity/i.test(`${code} ${message}`)) {
    lead = "Não há capacidade deste tamanho nesta região ou zona.";
  }
  const detail = message.split("\n")[0].slice(0, 300);
  if (!detail) return lead;
  return code ? `${lead}\n${code}: ${detail}` : `${lead}\n${detail}`;
}
