import { costQuery, parseBalance, parseCost, parseSubscription, pickQuotas, QUOTA_REGIONS, wantsBalance } from "./model.js";

const SUBSCRIPTION_API = "2022-12-01";
const COST_API = "2023-03-01";
const BALANCE_API = "2023-05-01";
const CACHE_MS = 10 * 60 * 1000;

function kind(error) {
  if (error?.status === 401 || error?.status === 403) return "forbidden";
  if (error?.status === 429) return "throttled";
  return "failed";
}

async function settle(work) {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error };
  }
}

export function createSubscriptionBook({ config, fetchImpl = fetch, usageList = null, token = null, now = () => Date.now(), cacheMs = CACHE_MS } = {}) {
  let entry = null;
  const azure = config?.azure || {};

  async function bearer() {
    if (token) return token();
    const identity = await import("@azure/identity");
    const credential = new identity.ClientSecretCredential(azure.tenantId, azure.clientId, azure.clientSecret);
    const granted = await credential.getToken("https://management.azure.com/.default");
    if (!granted?.token) throw Object.assign(new Error("token"), { status: 401 });
    return granted.token;
  }

  async function call(method, url, body) {
    const response = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${await bearer()}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const message = String(payload?.error?.message || "").split("\n")[0].slice(0, 180);
      throw Object.assign(new Error(message || `azure ${response.status}`), { status: response.status });
    }
    return payload;
  }

  async function listUsage(location) {
    if (usageList) return usageList(location);
    const identity = await import("@azure/identity");
    const arm = await import("@azure/arm-compute");
    const credential = new identity.ClientSecretCredential(azure.tenantId, azure.clientId, azure.clientSecret);
    const client = new arm.ComputeManagementClient(credential, azure.subscriptionId);
    const rows = [];
    for await (const row of client.usageOperations.list(location)) rows.push(row);
    return rows;
  }

  async function loadQuota(location) {
    try {
      return { ...pickQuotas(await listUsage(location)), error: "" };
    } catch (error) {
      console.warn(`Cota ${location}: ${kind(error)}. ${String(error?.message || "").slice(0, 160)}`);
      return { low: null, cores: null, family: null, error: kind(error) };
    }
  }

  async function loadBalance(quotaId) {
    if (!wantsBalance(quotaId)) return null;
    try {
      return parseBalance(await call("GET", `https://management.azure.com/subscriptions/${azure.subscriptionId}/providers/Microsoft.Consumption/balances?api-version=${BALANCE_API}`));
    } catch {
      return null;
    }
  }

  async function loadFresh(location) {
    const id = azure.subscriptionId;
    const subscriptionUrl = `https://management.azure.com/subscriptions/${id}?api-version=${SUBSCRIPTION_API}`;
    const costUrl = `https://management.azure.com/subscriptions/${id}/providers/Microsoft.CostManagement/query?api-version=${COST_API}`;
    const [subscriptionResult, monthResult, lastResult, groupedResult, quota] = await Promise.all([
      settle(() => call("GET", subscriptionUrl)),
      settle(() => call("POST", costUrl, costQuery("MonthToDate", false))),
      settle(() => call("POST", costUrl, costQuery("TheLastMonth", false))),
      settle(() => call("POST", costUrl, costQuery("MonthToDate", true))),
      loadQuota(location),
    ]);
    const subscription = subscriptionResult.ok
      ? { ...parseSubscription(subscriptionResult.value), error: "" }
      : { error: kind(subscriptionResult.error) };
    const cost = { currency: "", current: null, previous: null, top: [], error: "" };
    if (!monthResult.ok) cost.error = kind(monthResult.error);
    else {
      const parsed = parseCost(monthResult.value);
      cost.current = parsed.total;
      cost.currency = parsed.currency;
    }
    if (lastResult.ok) {
      const parsed = parseCost(lastResult.value);
      cost.previous = parsed.total;
      if (!cost.currency) cost.currency = parsed.currency;
    } else if (!cost.error) cost.error = kind(lastResult.error);
    if (groupedResult.ok) {
      const parsed = parseCost(groupedResult.value);
      cost.top = parsed.top;
      if (!cost.currency) cost.currency = parsed.currency;
    }
    const balance = subscription.quotaId ? await loadBalance(subscription.quotaId) : null;
    return { subscription, cost, balance, quota };
  }

  return {
    async report({ location = azure.location, force = false } = {}) {
      const place = QUOTA_REGIONS.includes(location) ? location : (QUOTA_REGIONS.includes(azure.location) ? azure.location : "brazilsouth");
      if (!azure.configured || !azure.subscriptionId) return { configured: false, location: place, cached: false };
      const fresh = entry && !force && now() - entry.at < cacheMs;
      if (!fresh) {
        const loaded = await loadFresh(place);
        entry = { at: now(), ...loaded, quotas: { [place]: loaded.quota } };
        return { configured: true, cached: false, location: place, ...loaded };
      }
      if (!entry.quotas[place]) entry.quotas[place] = await loadQuota(place);
      return {
        configured: true,
        cached: true,
        location: place,
        subscription: entry.subscription,
        cost: entry.cost,
        balance: entry.balance,
        quota: entry.quotas[place],
      };
    },
  };
}
