import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { routeInteraction } from "../src/bot.js";
import { formatModal, inspectModal, specsModal, step1Modal, step2Modal, step3Modal } from "../src/panels/admin.js";
import { renderControl } from "../src/panels/control.js";
import { renderPublicPanel } from "../src/panels/public.js";
import { createSealer } from "../src/services/crypto.js";
import { createEmojiBook, DEFAULTS, UNICODE } from "../src/services/emojis.js";
import { isAdmin } from "../src/services/admin.js";
import { expiryFrom, formatDate, parseDate, planStatus, remainingLabel } from "../src/services/plans.js";
import { validateSchedule } from "../src/services/fields.js";
import { createInfrastructure, vmOptionValue } from "../src/services/provider.js";
import { specsFromSize } from "../src/services/vm-size.js";
import { renderVmCardPng, vmCardSvg } from "../src/services/vm-card.js";

const GUILD = "100000000000000001";
const OWNER = "100000000000000009";
const CLIENT = "100000000000000002";
const OTHER = "100000000000000005";
const ROLE = "100000000000000061";
const INFRA = "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1";
const SNAPSHOT = "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg/providers/Microsoft.Compute/snapshots/base";
const PASSWORD = "SenhaUnica#2026Aa";
const PIN = "1234";

function adminActor(extra = {}) {
  return { id: OWNER, guildId: GUILD, permissions: 8n, roleIds: [], owner: true, ...extra };
}

function harness({ azure = false, snapshot = false, compute = null, clock = Date.parse("2026-10-06T03:00:00.000Z") } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-pc-"));
  const repo = openDatabase(dir);
  const logs = [];
  let now = clock;
  const config = readConfig({
    DISCORD_TOKEN: "token",
    DISCORD_CLIENT_ID: "100000000000000003",
    ALLOWED_GUILD_IDS: GUILD,
    CREDENTIALS_KEY: "chave-de-teste-atlas",
    PANEL_COLOR: "5865F2",
    PANEL_BANNER_URL: "https://cdn.discordapp.com/embed/avatars/0.png",
    SUPPORT_CHANNEL_URL: "https://discord.com/channels/1/2",
    ADMIN_ROLE_IDS: ROLE,
    ADMIN_LOG_CHANNEL_ID: "100000000000000008",
    AZURE_TENANT_ID: azure ? "tenant" : "",
    AZURE_CLIENT_ID: azure ? "client" : "",
    AZURE_CLIENT_SECRET: azure ? "secret" : "",
    AZURE_SUBSCRIPTION_ID: azure ? "sub" : "",
    AZURE_SNAPSHOT_ID: snapshot ? SNAPSHOT : "",
    CONFIRMATION_TTL_SECONDS: "60",
  });
  const calls = [];
  const infra = compute
    ? createInfrastructure(config, { compute, readTimeoutMs: 30, writeTimeoutMs: 50 })
    : {
      configured: azure,
      async readPower() {
        calls.push("read");
        return { mode: azure ? "azure" : "manual", status: azure ? "ligada" : null, reason: azure ? undefined : "unconfigured" };
      },
      async setPower(_id, desired) {
        calls.push(["power", desired]);
        return { mode: azure ? "azure" : "manual", status: azure ? desired : null, reason: azure ? undefined : "unconfigured" };
      },
      async format() {
        calls.push("format");
        return { mode: azure ? "azure" : "manual", status: azure ? "desligada" : null, reason: azure ? undefined : "unconfigured" };
      },
      async listVms() {
        return [];
      },
    };
  const app = createApp({
    config,
    repo,
    infra,
    now: () => now,
    deliverLog: async (_channel, payload) => {
      logs.push(JSON.stringify(payload));
      return true;
    },
  });
  return {
    dir, repo, app, logs, calls, config,
    setNow(value) { now = value; },
    close() { repo.close(); },
  };
}

function textOf(payload) {
  return JSON.stringify(payload.components[0].toJSON());
}

function draftFrom(payload, step) {
  const match = new RegExp(`atlas:admin:draft:${step}:([0-9a-f-]{36})`).exec(textOf(payload));
  assert.ok(match, "rascunho");
  return match[1];
}

function button(customId, userId, extra = {}) {
  return {
    customId,
    guildId: GUILD,
    user: { id: userId },
    member: { permissions: { bitfield: extra.permissions ?? 0n }, roles: { cache: new Map(extra.roles ?? []) } },
    guild: { ownerId: OWNER },
    deferred: false,
    replied: false,
    values: extra.values ?? [],
    fields: extra.fields,
    async deferUpdate() { this.deferred = true; this.order.push("defer"); },
    async deferReply() { this.deferred = true; this.order.push("defer"); },
    async editReply(body) { this.last = body; },
    async reply(body) { this.replied = true; this.last = body; },
    async showModal(modal) { this.modal = modal; },
    isChatInputCommand: () => false,
    isModalSubmit: () => Boolean(extra.modal),
    isButton: () => !extra.modal,
    order: [],
  };
}

async function register(env, actor = adminActor()) {
  const step1 = env.app.admin.applyStep1({
    guildId: GUILD,
    actor,
    kind: "add",
    targetUserId: CLIENT,
    fields: { clientName: "Ana", machineName: "Mesa 01", gpu: "Tesla T4", vcpus: "4", ram: "28 GB" },
  });
  const draft = draftFrom(step1.payload, 2);
  env.app.admin.applyStep2({
    guildId: GUILD,
    actor,
    draftId: draft,
    fields: { publicIp: "203.0.113.10", rdpUser: "pc", password: PASSWORD, pin: PIN, plan: "mensal" },
  });
  env.app.admin.applyStep3({
    guildId: GUILD,
    actor,
    draftId: draft,
    fields: { start: "06/10/2026", expiry: "20/12/2026", infraId: INFRA },
  });
  await env.app.admin.save(GUILD, actor, draft);
  return draft;
}

test("os três modais cabem na API e o seletor abre o primeiro sem adiar", async () => {
  const drafts = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", kind: "edit", payload: { plan: "mensal", publicIp: "203.0.113.10", rdpUser: "pc", startText: "06/10/2026", expiryText: "05/11/2026", infraId: "" } };
  const modals = [
    step1Modal({ kind: "add", targetUserId: CLIENT }),
    step1Modal({ kind: "edit", targetUserId: CLIENT, current: { clientName: "Ana", machineName: "Mesa 01", gpu: "Tesla T4", vcpus: 4, ram: "28 GB" } }),
    step2Modal({ id: drafts.id, kind: "add", payload: { plan: "semanal" } }),
    step2Modal(drafts),
    step3Modal({ id: drafts.id, kind: "add", payload: drafts.payload }),
    step3Modal(drafts),
    specsModal(drafts),
    formatModal("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
  ];
  for (const modal of modals) assert.deepEqual(inspectModal(modal), []);
  const add = step1Modal({ kind: "add", targetUserId: CLIENT }).toJSON();
  assert.equal(add.components.length, 2);
  assert.equal(JSON.stringify(add).includes("gpu"), false);
  const hardware = specsModal({ id: drafts.id, kind: "add", payload: { gpu: "NVIDIA A10" } }).toJSON();
  const selected = hardware.components.find((item) => item.component.custom_id === "gpu").component.options.filter((option) => option.default);
  assert.equal(JSON.parse(JSON.stringify(selected))[0].value, "NVIDIA A10");

  const env = harness();
  const interaction = button("atlas:admin:add:user", OWNER, { permissions: 8n, values: [CLIENT] });
  interaction.showModal = async (modal) => {
    interaction.order.push("modal");
    interaction.modal = modal;
  };
  await routeInteraction(interaction, env.app);
  assert.deepEqual(interaction.order, ["modal"]);
  assert.equal(interaction.deferred, false);
  assert.deepEqual(inspectModal(interaction.modal), []);
  env.close();
});

test("o erro genérico registra o erro cru do Discord", async () => {
  const env = harness();
  const interaction = button("atlas:admin:add:user", OWNER, { permissions: 8n, values: [CLIENT] });
  interaction.showModal = async () => {
    const error = new Error("Invalid Form Body");
    error.name = "DiscordAPIError[50035]";
    error.code = 50035;
    error.rawError = { message: "Invalid Form Body", code: 50035, errors: { data: { components: { 2: { component: { options: "default" } } } } } };
    throw error;
  };
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.map((item) => String(item)).join(" "));
  try {
    await routeInteraction(interaction, env.app);
  } finally {
    console.error = original;
  }
  const log = lines.join("\n");
  assert.match(log, /DiscordAPIError\[50035\] \[50035\]/);
  assert.match(log, /Invalid Form Body/);
  assert.match(log, /"code":50035/);
  env.close();
});

function azureVm(name, group = "rg") {
  return {
    id: `/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/${group}/providers/Microsoft.Compute/virtualMachines/${name}`,
    name,
    location: "brazilsouth",
    hardwareProfile: { vmSize: "Standard_NC4as_T4_v3" },
  };
}

test("a assinatura lista VMs, guarda cache e segue sem o estado lento", async () => {
  let calls = 0;
  let clock = 1_000;
  const compute = {
    virtualMachines: {
      listAll(options = {}) {
        calls += 1;
        if (options.statusOnly) {
          return (async function* fail() {
            throw Object.assign(new Error("estado lento"), { code: "timeout", rawError: { message: "estado lento" } });
          })();
        }
        return (async function* list() {
          yield azureVm("vm-b");
          yield azureVm("vm-a");
        })();
      },
    },
  };
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.map((item) => String(item)).join(" "));
  const infra = createInfrastructure(readConfig({
    AZURE_TENANT_ID: "tenant",
    AZURE_CLIENT_ID: "client",
    AZURE_CLIENT_SECRET: "secret",
    AZURE_SUBSCRIPTION_ID: "sub",
  }), { compute, now: () => clock, statusTimeoutMs: 50, readTimeoutMs: 1_000 });
  try {
    assert.deepEqual(await createInfrastructure(readConfig({}), {}).listVms(), []);
    const listed = await infra.listVms();
    assert.deepEqual(listed.map((vm) => vm.name), ["vm-a", "vm-b"]);
    assert.equal(listed[0].resourceGroup, "rg");
    assert.equal(listed[0].size, "Standard_NC4as_T4_v3");
    assert.equal(listed[0].power, null);
    await infra.listVms();
    assert.equal(calls, 2);
    clock += 61_000;
    await infra.listVms();
    assert.equal(calls, 4);
    assert.match(lines.join("\n"), /estado lento/);
  } finally {
    console.error = original;
  }
});

test("o seletor preenche o resource ID e esconde VM de outro cliente", async () => {
  const env = harness({ azure: true });
  const linked = azureVm("ocupada").id;
  const free = azureVm("livre", "rg-livre").id;
  env.repo.insertClient({
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc", guildId: GUILD, userId: OTHER, clientName: "Outro", machineName: "Ocupada",
    gpu: "Tesla T4", vcpus: 4, ram: "28 GB", publicIp: null, rdpUser: null, rdpPasswordCipher: null, pinCipher: null,
    planType: "mensal", startedAt: 1, expiresAt: 2, infraId: linked, powerStatus: "desligada", now: 1,
  });
  const many = [azureVm("livre", "rg-livre"), ...Array.from({ length: 30 }, (_, index) => azureVm(`vm-${String(index).padStart(2, "0")}`))];
  env.app.infra.listVms = async () => [{ id: linked, name: "ocupada", resourceGroup: "rg", location: "brazilsouth", size: "Standard_B2s", power: "desligada" }].concat(many.map((vm) => ({
    id: vm.id, name: vm.name, resourceGroup: vm.id.split("/")[4], location: vm.location, size: vm.hardwareProfile.vmSize, power: "ligada",
  })));
  const step1 = env.app.admin.applyStep1({
    guildId: GUILD, actor: adminActor(), kind: "add", targetUserId: CLIENT,
    fields: { clientName: "Ana", machineName: "Mesa 01", gpu: "Tesla T4", vcpus: "4", ram: "28 GB" },
  });
  const draft = draftFrom(step1.payload, 2);
  env.app.admin.applyStep2({
    guildId: GUILD, actor: adminActor(), draftId: draft,
    fields: { publicIp: "", rdpUser: "", password: "", pin: "", plan: "mensal" },
  });
  const page = await env.app.admin.vmPicker(GUILD, adminActor(), draft, 0);
  const json = textOf(page);
  assert.match(json, /livre/);
  assert.doesNotMatch(json, /ocupada/);
  assert.match(json, /Nenhuma VM agora/);
  assert.match(json, /Próxima/);
  const body = page.components[0].toJSON();
  const select = body.components.find((item) => item.components?.[0]?.type === 3).components[0];
  assert.ok(select.custom_id.length <= 100);
  assert.ok(select.options.length <= 25);
  assert.ok(select.options.every((option) => option.value.length <= 100 && (!option.description || option.description.length <= 100)));
  await env.app.admin.pickVm(GUILD, adminActor(), draft, vmOptionValue(free));
  assert.equal(env.repo.getDraft(draft).payload.infraId, free);
  await env.app.admin.pickVm(GUILD, adminActor(), draft, "none");
  assert.equal(env.repo.getDraft(draft).payload.infraId, "");
  const catalog = await env.app.admin.listAzureVms(GUILD, adminActor(), 0);
  assert.match(textOf(catalog), /livre/);
  assert.match(textOf(catalog), /Outro/);
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.map((item) => String(item)).join(" "));
  env.app.infra.listVms = async () => {
    throw Object.assign(new Error("negado"), { code: 403, rawError: { message: "negado" } });
  };
  try {
    const failed = await env.app.admin.vmPicker(GUILD, adminActor(), draft, 0);
    assert.match(textOf(failed), /Não foi possível listar as VMs na Azure/);
    assert.match(lines.join("\n"), /negado/);
  } finally {
    console.error = original;
  }
  env.close();
});

test("o cartão é uma imagem sem senha e o tamanho da VM vira GPU", async () => {
  assert.equal(specsFromSize("Standard_NC4as_T4_v3").gpu, "Tesla T4");
  assert.equal(specsFromSize("Standard_NC4as_T4_v3").vcpus, 4);
  assert.equal(specsFromSize("Standard_NV6ads_A10_v5").gpu, "NVIDIA A10 1/6");
  assert.equal(specsFromSize("Standard_NC24ads_A100_v4").gpu, "NVIDIA A100");
  const svg = vmCardSvg({ status: "Ligada", headline: "Tesla T4 · 4 vCPU", ip: "191.232.52.39", time: "29d 21h 38min", plan: "Mensal · Ativo", consulted: "06/10/2026, 22:49" });
  assert.match(svg, /Atlas/);
  assert.match(svg, /Seu poder em nuvem/);
  assert.doesNotMatch(svg, /Senha|PIN/);
  const png = await renderVmCardPng({ status: "Ligada", headline: "Tesla T4 · 4 vCPU", ip: "191.232.52.39", time: "29d 21h 38min", plan: "Mensal · Ativo", consulted: "06/10/2026, 22:49" });
  assert.equal(png[0], 0x89);
  assert.equal(png.includes(Buffer.from(PASSWORD)), false);
  const book = createEmojiBook({ emoji: {}, allowedGuildIds: [] }, { getSettings: () => ({ emoji: {} }) });
  book.remember(GUILD, [{ id: "1570365824810877048", name: "reduto_on" }]);
  assert.equal(book.pack(GUILD).ligada, DEFAULTS.ligada);
  book.remember(GUILD, [{ id: "1570370496673873952", name: "desligar" }]);
  assert.equal(book.pack(GUILD).desligar, DEFAULTS.desligar);
});

test("o IP público sai da interface de rede da VM", async () => {
  let reads = 0;
  const compute = {
    virtualMachines: {
      async get() {
        reads += 1;
        return {
          hardwareProfile: { vmSize: "Standard_NC8as_T4_v3" },
          networkProfile: { networkInterfaces: [{ id: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg/providers/Microsoft.Network/networkInterfaces/nic1" }] },
        };
      },
      async instanceView() {
        return { statuses: [{ code: "PowerState/running" }] };
      },
    },
  };
  const network = {
    networkInterfaces: {
      async get() {
        return { ipConfigurations: [{ publicIPAddress: { id: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg/providers/Microsoft.Network/publicIPAddresses/pip1" } }] };
      },
    },
    publicIPAddresses: { async get() { return { ipAddress: "191.232.52.39" }; } },
  };
  const infra = createInfrastructure(readConfig({
    AZURE_TENANT_ID: "tenant", AZURE_CLIENT_ID: "client", AZURE_CLIENT_SECRET: "secret", AZURE_SUBSCRIPTION_ID: "sub",
  }), { compute, network, readTimeoutMs: 1_000 });
  const machine = await infra.readMachine(azureVm("vm-a").id);
  assert.equal(machine.publicIp, "191.232.52.39");
  assert.equal(machine.gpu, "Tesla T4");
  assert.equal(machine.vcpus, 8);
  assert.equal(machine.power, "ligada");
  await infra.readMachine(azureVm("vm-a").id);
  assert.equal(reads, 1);
});

test("emoji padrão exige o cache e a variável fica na frente", () => {
  const repo = { getSettings: () => ({ emoji: {} }) };
  const book = createEmojiBook({ emoji: {}, allowedGuildIds: [] }, repo);
  assert.equal(book.pack(GUILD).controle, UNICODE.controle);
  assert.equal(book.pack(GUILD).controle.includes("1568512664705961985"), false);
  book.remember(GUILD, [{ id: "1568512664705961985", name: "8688gaming" }, { id: "1568512326804574281", name: "monitor" }]);
  assert.equal(book.pack(GUILD).controle, DEFAULTS.controle);
  assert.equal(book.pack(GUILD).monitor, "<:monitor:1568512326804574281>");
  const replaced = createEmojiBook({ emoji: { controle: "<:outro:999>" }, allowedGuildIds: [] }, repo);
  replaced.remember(GUILD, [{ id: "1568512664705961985", name: "8688gaming" }]);
  assert.equal(replaced.pack(GUILD).controle, DEFAULTS.controle);
  replaced.remember(GUILD, [{ id: "999", name: "outro" }]);
  assert.equal(replaced.pack(GUILD).controle, "<:outro:999>");
  const typed = createEmojiBook({ emoji: { controle: "🎮" }, allowedGuildIds: [] }, repo);
  assert.equal(typed.pack(GUILD).controle, "🎮");
});

test("permissão de admin usa o bit ou o cargo", () => {
  const config = { adminRoleIds: [ROLE] };
  assert.equal(isAdmin({ permissions: 8n, roleIds: [] }, config), true);
  assert.equal(isAdmin({ owner: true, permissions: 0n, roleIds: [] }, config), true);
  assert.equal(isAdmin({ permissions: 0n, roleIds: [ROLE] }, config), true);
  assert.equal(isAdmin({ permissions: 0n, roleIds: [CLIENT] }, config), false);
});

test("criptografia não guarda o texto e rejeita alteração", () => {
  const sealer = createSealer("chave-de-teste-atlas");
  const cipher = sealer.seal(PASSWORD);
  assert.equal(cipher.includes(PASSWORD), false);
  assert.equal(sealer.open(cipher), PASSWORD);
  assert.throws(() => sealer.open(`${cipher.slice(0, -2)}aa`));
});

test("vencimento segue o plano e aceita data editada", () => {
  const start = parseDate("06/10/2026");
  assert.equal(formatDate(start), "06/10/2026");
  assert.equal(formatDate(expiryFrom(start, "semanal")), "13/10/2026");
  assert.equal(formatDate(expiryFrom(start, "quinzenal")), "21/10/2026");
  assert.equal(formatDate(expiryFrom(start, "mensal")), "05/11/2026");
  assert.equal(planStatus(start, expiryFrom(start, "mensal")), "Ativo");
  assert.equal(planStatus(expiryFrom(start, "mensal"), expiryFrom(start, "mensal")), "Vencido");
  assert.equal(remainingLabel(expiryFrom(start, "mensal") - 90_000, expiryFrom(start, "mensal")), "0d 0h 1min");
  const custom = validateSchedule({ start: "06/10/2026", expiry: "20/12/2026", plan: "semanal", infraId: "" });
  assert.equal(custom.ok, true);
  assert.equal(formatDate(custom.value.expiresAt), "20/12/2026");
});

test("painéis usam Components V2 e o texto do painel", () => {
  const pub = renderPublicPanel({
    accent: 0x5865f2,
    emojis: UNICODE,
    supportUrl: "https://discord.com/channels/1/2",
    bannerUrl: "https://cdn.discordapp.com/embed/avatars/0.png",
  });
  const json = textOf(pub);
  assert.equal(pub.content, undefined);
  assert.equal(pub.embeds, undefined);
  assert.ok(pub.flags & 32768);
  assert.match(json, /Sua Máquina/);
  assert.match(json, /Clique abaixo para consultar seu plano/);
  assert.match(json, /As informações do seu plano e da sua máquina aparecem somente para você/);
  assert.match(json, /atlas:panel:control/);
  assert.match(json, /atlas:panel:plan/);
  assert.match(json, /Suporte \/ Tickets/);
  assert.match(json, /"type":12/);
  const control = renderControl({
    machineName: "Mesa 01", clientName: "Ana", gpu: "Tesla T4", vcpus: 4, ram: "28 GB",
    publicIp: "203.0.113.10", planType: "mensal", expiresAt: Date.parse("2026-11-05T03:00:00.000Z"),
    lastQueryAt: Date.parse("2026-10-06T03:00:00.000Z"), powerStatus: "ligada",
  }, { accent: 0x5865f2, emojis: UNICODE, bannerUrl: "https://cdn.discordapp.com/embed/avatars/0.png", now: Date.parse("2026-10-06T03:00:00.000Z") });
  const card = textOf(control);
  assert.match(card, /Ana autorizado com acesso completo/);
  assert.match(card, /Tesla T4 · 4 vCPU/);
  assert.match(card, /Seu poder em nuvem/);
  assert.match(card, /Ligada/);
  assert.match(card, /Mensal · Ativo/);
  assert.match(card, /Instância Spot: se desligar inesperadamente/);
  assert.match(card, /Desligar VM/);
  const pictured = renderControl({
    machineName: "Mesa 01", clientName: "Ana", gpu: "Tesla T4", vcpus: 4, ram: "28 GB",
    publicIp: "203.0.113.10", planType: "mensal", expiresAt: Date.parse("2026-11-05T03:00:00.000Z"),
    lastQueryAt: Date.parse("2026-10-06T03:00:00.000Z"), powerStatus: "ligada",
  }, { accent: 0x5865f2, emojis: UNICODE, now: Date.parse("2026-10-06T03:00:00.000Z"), image: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
  const shutdown = renderControl({
    machineName: "Mesa 01", clientName: "Ana", gpu: "Tesla T4", vcpus: 4, ram: "28 GB",
    publicIp: "203.0.113.10", planType: "mensal", expiresAt: Date.parse("2026-11-05T03:00:00.000Z"),
    lastQueryAt: Date.parse("2026-10-06T03:00:00.000Z"), powerStatus: "ligada",
  }, { accent: 0x5865f2, emojis: { ...UNICODE, desligar: "<:desligar:1570370496673873952>", ligada: "<:reduto_on:1570365824810877048>" }, now: Date.parse("2026-10-06T03:00:00.000Z") });
  const shutdownButton = shutdown.components[0].toJSON().components.flatMap((row) => row.components ?? []).find((item) => item.custom_id === "atlas:vm:power");
  assert.equal(shutdownButton.label, "Desligar VM");
  assert.equal(shutdownButton.emoji.id, "1570370496673873952");
  assert.match(textOf(shutdown), /reduto_on:1570365824810877048/);
  const off = renderControl({
    machineName: "Mesa 01", clientName: "Ana", gpu: "Tesla T4", vcpus: 4, ram: "28 GB",
    publicIp: "203.0.113.10", planType: "mensal", expiresAt: Date.parse("2026-11-05T03:00:00.000Z"),
    lastQueryAt: Date.parse("2026-10-06T03:00:00.000Z"), powerStatus: "desligada",
  }, { accent: 0x5865f2, emojis: { ...UNICODE, desligar: "<:desligar:1570370496673873952>", ligada: "<:reduto_on:1570365824810877048>", power: "⏻" }, now: Date.parse("2026-10-06T03:00:00.000Z") });
  assert.doesNotMatch(textOf(off), /1570370496673873952|1570365824810877048/);
  assert.match(textOf(off), /Desligada/);
  assert.match(textOf(pictured), /attachment:\/\/vm-card\.png/);
  assert.match(textOf(pictured), /"type":12/);
  assert.equal(pictured.files.length, 1);
  assert.equal(step1Modal({ kind: "add", targetUserId: CLIENT }).toJSON().components.length, 2);
  assert.equal(step2Modal({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", kind: "add", payload: {} }).toJSON().components.length, 4);
  assert.equal(step3Modal({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", kind: "add", payload: { startText: "06/10/2026", expiryText: "05/11/2026" } }).toJSON().components.length, 3);
});

test("cliente só vê a própria máquina e a senha não entra no banco nem no log", async () => {
  const env = harness();
  await register(env);
  const owner = await env.app.clients.open(GUILD, CLIENT);
  const ownerText = textOf(owner);
  assert.ok(ownerText.includes("203.0.113.10") || owner.files?.length === 1);
  const stranger = await env.app.clients.open(GUILD, OTHER);
  assert.doesNotMatch(textOf(stranger), /203\.0\.113\.10/);
  const soon = await env.app.clients.reveal(GUILD, CLIENT, "pin");
  assert.match(textOf(soon), /Agente não instalado nesta máquina/);
  assert.doesNotMatch(textOf(soon), new RegExp(PIN));
  const revealed = await env.app.clients.reveal(GUILD, CLIENT, "rdp");
  assert.match(textOf(revealed), new RegExp(PASSWORD));
  const hidden = await env.app.clients.reveal(GUILD, OTHER, "rdp");
  assert.doesNotMatch(textOf(hidden), new RegExp(PASSWORD));
  const dump = fs.readdirSync(env.dir).map((name) => fs.readFileSync(path.join(env.dir, name))).reduce((all, file) => Buffer.concat([all, file]), Buffer.alloc(0));
  const stored = JSON.stringify(env.repo.getByOwner(GUILD, CLIENT));
  assert.equal(stored.includes(PASSWORD), false);
  assert.equal(stored.includes(PIN), false);
  assert.equal(dump.includes(Buffer.from(PASSWORD)), false);
  assert.equal(env.logs.some((line) => line.includes(PASSWORD) || line.includes(PIN)), false);
  assert.match(env.logs.join("\n"), /adicionar_cliente/);
  env.close();
});

test("formatação exige frase, dono e prazo", async () => {
  const env = harness();
  await register(env);
  const asked = await env.app.clients.askFormat(GUILD, CLIENT);
  const confirmation = /atlas:vm:format:yes:([0-9a-f-]{36})/.exec(textOf(asked))[1];
  const wrong = await env.app.clients.confirmFormat(GUILD, CLIENT, confirmation, "outra");
  assert.match(textOf(wrong), /não confere/);
  assert.equal(env.calls.includes("format"), false);
  const stolen = await env.app.clients.confirmFormat(GUILD, OTHER, confirmation, "CONFIRMAR");
  assert.match(textOf(stolen), /não é sua/);
  assert.equal(env.calls.includes("format"), false);
  env.setNow(Date.parse("2026-10-06T03:00:00.000Z") + 61_000);
  const expired = await env.app.clients.confirmFormat(GUILD, CLIENT, confirmation, "Mesa 01");
  assert.match(textOf(expired), /expirou/);
  assert.equal(env.calls.includes("format"), false);
  env.setNow(Date.parse("2026-10-06T03:00:00.000Z"));
  const again = await env.app.clients.askFormat(GUILD, CLIENT);
  const fresh = /atlas:vm:format:yes:([0-9a-f-]{36})/.exec(textOf(again))[1];
  const done = await env.app.clients.confirmFormat(GUILD, CLIENT, fresh, "CONFIRMAR");
  assert.match(textOf(done), /equipe foi avisada/);
  assert.equal(env.calls.includes("format"), true);
  const repeat = await env.app.clients.confirmFormat(GUILD, CLIENT, fresh, "CONFIRMAR");
  assert.match(textOf(repeat), /já foi usada|expirou/);
  env.close();
});

test("botão adia antes da Azure e o outro cliente não aciona a máquina", async () => {
  const env = harness({ azure: true });
  await register(env);
  const order = [];
  env.app.infra.readPower = async () => {
    order.push("azure");
    return { mode: "azure", status: "ligada" };
  };
  const interaction = button("atlas:panel:control", CLIENT);
  interaction.deferReply = async () => {
    interaction.deferred = true;
    order.push("defer");
  };
  await routeInteraction(interaction, env.app);
  assert.deepEqual(order, ["defer", "azure"]);
  const outsider = button("atlas:vm:power", OTHER);
  let called = false;
  env.app.infra.setPower = async () => {
    called = true;
    return { mode: "azure", status: "desligada" };
  };
  await routeInteraction(outsider, env.app);
  assert.equal(called, false);
  assert.doesNotMatch(JSON.stringify(outsider.last), /203\.0\.113\.10/);
  env.close();
});

test("Azure formata pelo snapshot e o modo manual não chama a nuvem", async () => {
  const calls = [];
  const compute = {
    virtualMachines: {
      async beginDeallocateAndWait() { calls.push("deallocate"); },
      async get() {
        calls.push("get");
        return { location: "brazilsouth", storageProfile: { osDisk: { managedDisk: { storageAccountType: "Premium_LRS" } } } };
      },
      async beginCreateOrUpdateAndWait(_group, _name, body) {
        calls.push(["update", body.storageProfile.osDisk.managedDisk.id, body.storageProfile.osDisk.createOption]);
      },
      async instanceView() { return { statuses: [{ code: "PowerState/deallocated" }] }; },
    },
    disks: {
      async beginCreateOrUpdateAndWait(_group, _name, body) {
        calls.push(["disk", body.creationData.createOption, body.creationData.sourceResourceId]);
        return { id: "/subscriptions/x/resourceGroups/rg/providers/Microsoft.Compute/disks/osvm1" };
      },
    },
  };
  const env = harness({ azure: true, snapshot: true, compute });
  await register(env);
  const asked = await env.app.clients.askFormat(GUILD, CLIENT);
  const confirmation = /atlas:vm:format:yes:([0-9a-f-]{36})/.exec(textOf(asked))[1];
  const done = await env.app.clients.confirmFormat(GUILD, CLIENT, confirmation, "Mesa 01");
  assert.match(textOf(done), /disco do sistema foi recriado/);
  assert.deepEqual(calls.slice(0, 4).map((call) => Array.isArray(call) ? call[0] : call), ["deallocate", "get", "disk", "update"]);
  assert.equal(calls[2][1], "Copy");
  assert.equal(calls[2][2], SNAPSHOT);
  assert.equal(env.repo.getByOwner(GUILD, CLIENT).powerStatus, "desligada");
  env.close();

  const manual = harness();
  await register(manual);
  const before = manual.repo.getByOwner(GUILD, CLIENT).powerStatus;
  const toggled = await manual.app.clients.togglePower(GUILD, CLIENT);
  assert.match(textOf(toggled), /equipe foi avisada/);
  assert.equal(manual.repo.getByOwner(GUILD, CLIENT).powerStatus, before);
  manual.close();
});

test("não administrador não grava cliente", async () => {
  const env = harness();
  const blocked = env.app.admin.applyStep1({
    guildId: GUILD,
    actor: { id: OTHER, guildId: GUILD, permissions: 0n, roleIds: [], owner: false },
    kind: "add",
    targetUserId: CLIENT,
    fields: { clientName: "Ana", machineName: "Mesa 01", gpu: "Tesla T4", vcpus: "4", ram: "28 GB" },
  });
  assert.match(textOf(blocked.payload), /administrador/);
  assert.equal(env.repo.countClients(GUILD), 0);
  const byRole = env.app.admin.applyStep1({
    guildId: GUILD,
    actor: { id: OTHER, guildId: GUILD, permissions: 0n, roleIds: [ROLE], owner: false },
    kind: "add",
    targetUserId: CLIENT,
    fields: { clientName: "Ana", machineName: "Mesa 01", gpu: "Tesla T4", vcpus: "4", ram: "28 GB" },
  });
  assert.equal(byRole.payload.components[0].toJSON().components.at(-1).components[0].custom_id.startsWith("atlas:admin:draft:"), true);
  env.close();
});

test("exemplo de ambiente conserva as variáveis e não traz segredo", () => {
  const example = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
  for (const key of [
    "DISCORD_TOKEN", "DISCORD_CLIENT_ID", "ALLOWED_GUILD_IDS", "DATA_DIR", "SERVER_PORT", "CONFIRMATION_TTL_SECONDS",
    "ENABLE_MESSAGE_CONTENT_INTENT", "AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET",
    "AZURE_SUBSCRIPTION_ID", "AZURE_CREDENTIALS_KEY", "AZURE_SNAPSHOT_ID", "AZURE_LOCATION",
    "AZURE_DEFAULT_VM_SIZE", "AZURE_OS_TYPE", "AZURE_VIRTUAL_NETWORK", "AZURE_SUBNET", "AZURE_MAX_OS_DISK_GB",
    "PANEL_COLOR", "OLLAMA_BASE_URL", "OLLAMA_MODEL", "OLLAMA_API_KEY", "AI_ASSISTANT_ENABLED",
    "SUPPORT_CHANNEL_URL", "ADMIN_ROLE_IDS", "ADMIN_LOG_CHANNEL_ID", "CREDENTIALS_KEY", "PANEL_BANNER_URL",
    "EMOJI_CONTROLE", "EMOJI_CALENDARIO", "EMOJI_TICKET", "EMOJI_MOONLIGHT", "EMOJI_RDP", "EMOJI_ALERTA",
    "EMOJI_ENGRENAGEM", "EMOJI_POWER", "EMOJI_LIGADA", "EMOJI_DESLIGAR",
  ]) {
    assert.match(example, new RegExp(`^${key}=`, "m"));
  }
  for (const secret of ["DISCORD_TOKEN=", "DISCORD_CLIENT_ID=", "AZURE_CLIENT_SECRET=", "AZURE_CREDENTIALS_KEY=", "CREDENTIALS_KEY=", "OLLAMA_API_KEY="]) {
    assert.match(example, new RegExp(`^${secret}$`, "m"));
  }
  const ignore = fs.readFileSync(path.join(process.cwd(), ".gitignore"), "utf8");
  assert.match(ignore, /^\.env$/m);
});

test("o código não cita marcas de outros painéis", () => {
  const roots = ["src", "test", "docs", "agent", "README.md", ".env.example", "index.js", "package.json"];
  for (const root of roots) {
    const full = path.join(process.cwd(), root);
    const files = fs.statSync(full).isDirectory() ? walk(full) : [full];
    for (const file of files) {
      if (!/\.(js|md|example|json)$/.test(file)) continue;
      const banned = new RegExp(["n", "y", "x", "|", "o", "r", "z", "y", "|", "v", "a", "n", "i", "t", "y"].join(""), "i");
      assert.doesNotMatch(fs.readFileSync(file, "utf8"), banned, file);
    }
  }
});

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
