export const QUOTA_REGIONS = Object.freeze(["brazilsouth", "eastus", "eastus2", "southcentralus", "westus2"]);
export const SPOT_USAGE = "lowPriorityCores";
export const CORE_USAGE = "cores";
export const T4_FAMILY = "standardNCASv3_T4Family";

const STATES = Object.freeze({
  enabled: "Ativa",
  disabled: "Desativada",
  warned: "Em aviso",
  pastdue: "Pagamento pendente",
  deleted: "Excluída",
  expired: "Expirada",
  active: "Ativa",
});

const REGIONS = Object.freeze({
  brazilsouth: "Brazil South",
  eastus: "East US",
  eastus2: "East US 2",
  southcentralus: "South Central US",
  westus2: "West US 2",
});

export function translateState(state) {
  const key = String(state || "").replace(/[\s_-]/g, "").toLowerCase();
  return STATES[key] || (state ? String(state).slice(0, 32) : "Desconhecido");
}

export function regionLabel(location) {
  return REGIONS[location] || location || "Brazil South";
}

export function abbreviateId(value) {
  const id = String(value || "").split("/").filter(Boolean).at(-1) || "";
  if (!id) return "não informado";
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…`;
}

export function offerLabel(quotaId) {
  const id = String(quotaId || "");
  if (/AzureForStudents|Students/i.test(id)) return "Azure for Students";
  if (/FreeTrial/i.test(id)) return "Avaliação gratuita";
  if (/PayAsYouGo/i.test(id)) return "Pagamento conforme o uso";
  if (/MSDN|VisualStudio/i.test(id)) return "Visual Studio / MSDN";
  if (/Sponsored/i.test(id)) return "Patrocinada";
  return "";
}

export function wantsBalance(quotaId) {
  return /FreeTrial|Students|Sponsored/i.test(String(quotaId || ""));
}

export function costQuery(timeframe, grouped = false) {
  const dataset = {
    granularity: "None",
    aggregation: { totalCost: { name: "Cost", function: "Sum" } },
  };
  if (grouped) dataset.grouping = [{ type: "Dimension", name: "ServiceName" }];
  return { type: "ActualCost", timeframe, dataset };
}

export function parseCost(payload) {
  const properties = payload?.properties || payload || {};
  const columns = properties.columns || [];
  const rows = Array.isArray(properties.rows) ? properties.rows : [];
  const at = (names) => columns.findIndex((column) => names.includes(String(column?.name || "").toLowerCase()));
  const costIndex = at(["cost", "pretaxcost"]);
  const nameIndex = at(["servicename", "resourcename", "resourceid"]);
  const currencyIndex = at(["currency"]);
  let currency = "";
  const items = [];
  for (const row of rows) {
    const cost = Number(row?.[costIndex]);
    if (currencyIndex >= 0 && row?.[currencyIndex]) currency = String(row[currencyIndex]);
    if (nameIndex >= 0) items.push({ name: String(row?.[nameIndex] || "Serviço").slice(0, 48), cost: Number.isFinite(cost) ? cost : 0 });
  }
  const total = nameIndex >= 0 ? items.reduce((sum, item) => sum + item.cost, 0) : Number(rows[0]?.[costIndex] ?? 0);
  return {
    currency,
    total: Number.isFinite(total) ? total : 0,
    top: [...items].sort((left, right) => right.cost - left.cost).slice(0, 5),
  };
}

export function parseBalance(payload) {
  const row = payload?.value?.[0] || payload;
  const props = row?.properties || row || {};
  const remaining = Number(props.endingBalance ?? props.remainingBalance);
  if (!Number.isFinite(remaining)) return null;
  return { currency: String(props.currency || ""), remaining };
}

export function parseSubscription(payload) {
  const id = String(payload?.subscriptionId || "").trim();
  const quotaId = String(payload?.subscriptionPolicies?.quotaId || "");
  return {
    name: String(payload?.displayName || "Assinatura").slice(0, 80),
    id,
    shortId: abbreviateId(id),
    state: String(payload?.state || ""),
    stateLabel: translateState(payload?.state),
    quotaId,
    offer: offerLabel(quotaId),
    tenant: abbreviateId(payload?.tenantId),
  };
}

export function usageBar(used, limit, width = 10) {
  const size = Math.max(1, width);
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return "░".repeat(size);
  const filled = Math.max(0, Math.min(size, Math.round((used / limit) * size)));
  return `${"█".repeat(filled)}${"░".repeat(size - filled)}`;
}

export function pickQuotas(rows) {
  const list = rows || [];
  const find = (name) => list.find((row) => String(row?.name?.value || row?.name || "").toLowerCase() === name.toLowerCase()) || null;
  const read = (row) => row ? { used: Number(row.currentValue) || 0, limit: Number(row.limit) || 0 } : null;
  return {
    low: read(find(SPOT_USAGE)),
    cores: read(find(CORE_USAGE)),
    family: read(find(T4_FAMILY)),
  };
}

export function formatAmount(value) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export function formatCount(value) {
  if (!Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
