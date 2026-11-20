import assert from "node:assert/strict";
import test from "node:test";
import { createSubscriptionBook } from "../src/assinatura/azure.js";
import { abbreviateId, offerLabel, parseCost, translateState, usageBar } from "../src/assinatura/model.js";
import { renderSubscription } from "../src/assinatura/panel.js";
import { routeSubscriptionCommand, routeSubscriptionComponent } from "../src/assinatura/router.js";
import { adminCommands } from "../src/commands/admin/commands.js";

function http(status, body) {
  return { ok: status >= 200 && status < 300, status, async text() { return JSON.stringify(body); } };
}

const subscription = {
  subscriptionId: "02daccdd-f01a-4b29-adad-3322cba43a21",
  displayName: "Ignix",
  state: "Enabled",
  tenantId: "11111111-2222-3333-4444-555555555555",
  subscriptionPolicies: { quotaId: "PayAsYouGo_2014-09-01" },
};

function columns(...names) {
  return names.map((name) => ({ name }));
}

function book({ quotaId = subscription.subscriptionPolicies.quotaId, costStatus = 200, now = () => Date.now() } = {}) {
  const calls = [];
  const usageCalls = [];
  const payload = { ...subscription, subscriptionPolicies: { quotaId } };
  const fetchImpl = async (url, options) => {
    calls.push(url);
    if (url.includes("Microsoft.Consumption")) return http(200, { value: [{ properties: { currency: "USD", endingBalance: 40 } }] });
    if (url.includes("CostManagement")) {
      if (costStatus !== 200) return http(costStatus, { error: { message: "negado" } });
      const body = JSON.parse(options.body);
      if (body.timeframe === "TheLastMonth") return http(200, { properties: { columns: columns("Cost", "Currency"), rows: [[8.1, "BRL"]] } });
      if (body.dataset.grouping) {
        return http(200, {
          properties: {
            columns: columns("Cost", "ServiceName", "Currency"),
            rows: [[5, "Virtual Machines", "BRL"], [1, "Storage", "BRL"], [9, "Bandwidth", "BRL"], [0.2, "Disks", "BRL"], [0.1, "Log Analytics", "BRL"], [0.05, "Key Vault", "BRL"]],
          },
        });
      }
      return http(200, { properties: { columns: columns("Cost", "Currency"), rows: [[15.35, "BRL"]] } });
    }
    return http(200, payload);
  };
  const usageList = async (location) => {
    usageCalls.push(location);
    return [
      { name: { value: "lowPriorityCores" }, currentValue: 4, limit: 10 },
      { name: { value: "cores" }, currentValue: 20, limit: 100 },
      { name: { value: "standardNCASv3_T4Family" }, currentValue: 8, limit: 16 },
    ];
  };
  const config = { azure: { configured: true, tenantId: "tenant", clientId: "client", clientSecret: "secret", subscriptionId: payload.subscriptionId, location: "brazilsouth" } };
  return { calls, usageCalls, api: createSubscriptionBook({ config, fetchImpl, usageList, token: async () => "token", now }) };
}

test("estado, oferta, custo e barra da cota", () => {
  assert.equal(translateState("Enabled"), "Ativa");
  assert.equal(translateState("Disabled"), "Desativada");
  assert.equal(translateState("Warned"), "Em aviso");
  assert.equal(translateState("PastDue"), "Pagamento pendente");
  assert.equal(offerLabel("FreeTrial_2014-09-01"), "Avaliação gratuita");
  assert.equal(offerLabel("PayAsYouGo_2014-09-01"), "Pagamento conforme o uso");
  assert.equal(abbreviateId("02daccdd-f01a-4b29-adad-3322cba43a21"), "02daccdd…");
  assert.equal(usageBar(0, 10), "░░░░░░░░░░");
  assert.equal(usageBar(5, 10), "█████░░░░░");
  assert.equal(usageBar(10, 10), "██████████");
  const parsed = parseCost({
    properties: {
      columns: [{ name: "Cost" }, { name: "ServiceName" }, { name: "Currency" }],
      rows: [[1, "Storage", "BRL"], [9, "Bandwidth", "BRL"], [3, "Disks", "BRL"], [2, "A", "BRL"], [4, "B", "BRL"], [8, "C", "BRL"]],
    },
  });
  assert.equal(parsed.currency, "BRL");
  assert.equal(parsed.total, 27);
  assert.equal(parsed.top.length, 5);
  assert.equal(parsed.top[0].name, "Bandwidth");
  assert.equal(adminCommands().some((command) => command.name === "assinatura"), true);
});

test("o painel lê assinatura, custo e cota e guarda cache", async () => {
  let clock = 1_000;
  const made = book({ now: () => clock });
  const view = await made.api.report({ location: "brazilsouth" });
  assert.equal(view.subscription.stateLabel, "Ativa");
  assert.equal(view.subscription.shortId, "02daccdd…");
  assert.equal(view.cost.current, 15.35);
  assert.equal(view.cost.previous, 8.1);
  assert.equal(view.cost.top[0].name, "Bandwidth");
  assert.equal(view.cost.top.length, 5);
  assert.equal(view.balance, null);
  assert.equal(view.quota.low.used, 4);
  assert.equal(made.calls.some((url) => url.includes("Consumption")), false);
  const panel = JSON.stringify(renderSubscription(view, 1));
  assert.match(panel, /Ignix/);
  assert.match(panel, /Ativa/);
  assert.match(panel, /15,35 BRL/);
  assert.match(panel, /Low-priority vCPU: 4 \/ 10/);
  assert.match(panel, /████░░░░░░/);
  assert.match(panel, /NCASv3_T4 \(standardNCASv3_T4Family\): 8 \/ 16/);
  assert.match(panel, /Atualizar/);
  assert.match(panel, /Forçar/);
  assert.equal(panel.includes('"default":true'), false);
  const after = made.calls.length;
  await made.api.report({ location: "brazilsouth" });
  assert.equal(made.calls.length, after);
  await made.api.report({ location: "eastus" });
  assert.equal(made.calls.length, after);
  assert.deepEqual(made.usageCalls, ["brazilsouth", "eastus"]);
  clock += 11 * 60 * 1000;
  await made.api.report({ location: "brazilsouth" });
  assert.ok(made.calls.length > after);
});

test("forçar ignora o cache e o crédito de avaliação aparece", async () => {
  const made = book({ quotaId: "FreeTrial_2014-09-01" });
  const view = await made.api.report({ location: "brazilsouth" });
  assert.equal(view.balance.remaining, 40);
  assert.match(JSON.stringify(renderSubscription(view, 1)), /Saldo restante: 40,00 USD/);
  const after = made.calls.length;
  await made.api.report({ location: "brazilsouth", force: true });
  assert.ok(made.calls.length > after);
});

test("custo sem permissão ou limitado não esconde a assinatura", async () => {
  const denied = book({ costStatus: 403 });
  const forbidden = await denied.api.report({ location: "brazilsouth" });
  assert.equal(forbidden.subscription.name, "Ignix");
  assert.match(JSON.stringify(renderSubscription(forbidden, 1)), /Cost Management Reader/);
  const limited = book({ costStatus: 429 });
  const throttled = await limited.api.report({ location: "brazilsouth" });
  assert.match(JSON.stringify(renderSubscription(throttled, 1)), /limitou as consultas de custo/);
});

test("atualizar respeita a região escolhida", async () => {
  const seen = [];
  const app = {
    config: { panelColor: 1, azure: { location: "brazilsouth" } },
    admin: { isAdmin: () => true },
    subscription: { async report(query) { seen.push(query); return { configured: false, location: query.location }; } },
  };
  const interaction = {
    customId: "atlas:assinatura:region",
    values: ["westus2"],
    user: { id: "1" },
    member: { permissions: { bitfield: 8n }, roles: { cache: new Map() } },
    guild: { ownerId: "1" },
    deferred: false,
    replied: false,
    async deferUpdate() { this.deferred = true; },
    async editReply(body) { this.last = body; },
    async reply(body) { this.last = body; },
  };
  assert.equal(await routeSubscriptionComponent(interaction, app), true);
  assert.deepEqual(seen, [{ location: "westus2", force: false }]);
  interaction.customId = "atlas:assinatura:force:westus2";
  await routeSubscriptionComponent(interaction, app);
  assert.equal(seen[1].force, true);
  const command = { deferred: true, replied: false, async editReply(body) { this.last = body; } };
  await routeSubscriptionCommand(command, app);
  assert.match(JSON.stringify(command.last), /Ignix/);
});
