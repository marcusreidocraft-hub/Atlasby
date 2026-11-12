import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createAgentHttp, listenAgent } from "../src/agent-http.js";
import { readConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { hashAgentToken } from "../src/services/agent.js";
import { buildAgentInstallScript } from "../src/services/agent-install.js";
import { createInfrastructure } from "../src/services/provider.js";

const GUILD = "100000000000000001";

function clientRow(id, userId, machine) {
  return {
    id, guildId: GUILD, userId, clientName: machine, machineName: machine,
    gpu: "não informado", vcpus: 0, ram: "não informado", publicIp: null, rdpUser: null,
    rdpPasswordCipher: null, pinCipher: null, planType: "mensal", startedAt: 1, expiresAt: 2,
    infraId: "", powerStatus: "desligada", now: 1,
  };
}

function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-agent-"));
  const repo = openDatabase(dir);
  const logs = [];
  let clock = 1_700_000_000_000;
  const config = readConfig({
    DISCORD_TOKEN: "token",
    DISCORD_CLIENT_ID: "100000000000000003",
    ALLOWED_GUILD_IDS: GUILD,
    ADMIN_LOG_CHANNEL_ID: "100000000000000008",
  });
  const app = createApp({
    config,
    repo,
    infra: { configured: false },
    now: () => clock,
    deliverLog(channelId, payload) {
      logs.push({ channelId, text: JSON.stringify(payload) });
      return true;
    },
  });
  return {
    app,
    repo,
    logs,
    dir,
    setClock(value) { clock = value; },
    close() { repo.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

test("token errado e ausente recebem a mesma recusa, e o hash não é o token", async () => {
  const env = world();
  const server = createAgentHttp(env.app.agents);
  const address = await listenAgent(server, 0);
  const base = `http://127.0.0.1:${address.port}`;
  try {
    env.repo.insertClient(clientRow("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "200000000000000001", "Mesa A"));
    const client = env.repo.getById(GUILD, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    const token = env.app.agents.issueToken(GUILD, client, "admin");
    const stored = env.repo.agentForClient(client.id);
    assert.notEqual(stored.tokenHash, token);
    assert.equal(stored.tokenHash, hashAgentToken(token));
    assert.equal(fs.readFileSync(path.join(env.dir, "atlas.sqlite")).includes(token), false);
    const missing = await fetch(`${base}/agent/v1/poll`);
    const wrong = await fetch(`${base}/agent/v1/poll`, { headers: { authorization: "Bearer token-invalido" } });
    assert.equal(missing.status, 401);
    assert.equal(wrong.status, 401);
    assert.deepEqual(await missing.json(), await wrong.json());
    for (let index = 0; index < 80; index += 1) {
      assert.equal(env.app.agents.limited("ip:teste", 80), false);
    }
    assert.equal(env.app.agents.limited("ip:teste", 80), true);
  } finally {
    server.close();
    env.close();
  }
});

test("o token de uma máquina não recebe o PIN nem conclui o pedido da outra", async () => {
  const env = world();
  const server = createAgentHttp(env.app.agents);
  const address = await listenAgent(server, 0);
  const base = `http://127.0.0.1:${address.port}`;
  try {
    env.repo.insertClient(clientRow("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "200000000000000001", "Mesa A"));
    env.repo.insertClient(clientRow("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "200000000000000002", "Mesa B"));
    const first = env.repo.getById(GUILD, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    const second = env.repo.getById(GUILD, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    const tokenA = env.app.agents.issueToken(GUILD, first, "admin");
    const tokenB = env.app.agents.issueToken(GUILD, second, "admin");
    const pin = "2468";
    const job = env.app.agents.queuePin({ guildId: GUILD, client: first, userId: first.userId, pin });
    env.app.agents.queuePin({ guildId: GUILD, client: second, userId: second.userId, pin: "1357" });
    const own = await (await fetch(`${base}/agent/v1/poll`, { headers: { authorization: `Bearer ${tokenA}` } })).json();
    assert.equal(own.job.pin, pin);
    assert.equal(own.job.name, "Mesa A");
    const other = await env.app.agents.poll(env.app.agents.authenticate(tokenB), { waitMs: 0 });
    assert.equal(other.pin, "1357");
    const stolen = await fetch(`${base}/agent/v1/result`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokenB}`, "content-type": "application/json" },
      body: JSON.stringify({ id: job.id, ok: true, detail: `pin ${pin}` }),
    });
    assert.equal(stolen.status, 404);
    assert.equal(env.repo.getAgentJob(job.id).status, "sent");
    const done = await fetch(`${base}/agent/v1/result`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json" },
      body: JSON.stringify({ id: job.id, ok: true, detail: "pareado" }),
    });
    assert.equal(done.status, 200);
    assert.equal(env.repo.getAgentJob(job.id).status, "done");
    assert.equal(env.logs.some((entry) => entry.text.includes(pin) || entry.text.includes(tokenA)), false);
  } finally {
    server.close();
    env.close();
  }
});

const INFRA = "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1";
const ACTOR = { id: "100000000000000009", guildId: GUILD, permissions: 8n, roleIds: [], owner: true };

function installApp({ publicBotUrl = "http://203.0.113.10:12345", runCommand, listVms } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-install-"));
  const repo = openDatabase(dir);
  const logs = [];
  const calls = [];
  const config = readConfig({
    DISCORD_TOKEN: "token",
    DISCORD_CLIENT_ID: "100000000000000003",
    ALLOWED_GUILD_IDS: GUILD,
    ADMIN_LOG_CHANNEL_ID: "100000000000000008",
    PUBLIC_BOT_URL: publicBotUrl,
    AZURE_TENANT_ID: "tenant",
    AZURE_CLIENT_ID: "client",
    AZURE_CLIENT_SECRET: "secret",
    AZURE_SUBSCRIPTION_ID: "sub",
  });
  const infra = {
    configured: true,
    async runCommand(id, script) {
      calls.push({ id, script });
      return runCommand ? runCommand(id, script) : { mode: "azure", status: "ligada" };
    },
    async listVms() {
      return listVms ?? [{ id: INFRA, name: "vm1", resourceGroup: "rg", location: "brazilsouth", size: "Standard_NC4as_T4_v3", power: "ligada" }];
    },
  };
  const app = createApp({
    config,
    repo,
    infra,
    deliverLog(_channelId, payload) {
      logs.push(JSON.stringify(payload));
      return true;
    },
  });
  return {
    app, repo, logs, calls, dir,
    close() { repo.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

test("a instalação automática exige endereço, VM ligada e não grava segredo", async () => {
  const missing = installApp({ publicBotUrl: "" });
  const stopped = installApp({ runCommand: async () => ({ mode: "azure", status: "desligada", reason: "stopped" }) });
  const failed = installApp({ runCommand: async () => { throw Object.assign(new Error("azure"), { code: "failed" }); } });
  const installed = installApp();
  const original = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(" "));
  try {
    missing.repo.insertClient({ ...clientRow("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "200000000000000001", "Mesa A"), infraId: INFRA });
    const withoutUrl = await missing.app.admin.installAgent(GUILD, ACTOR, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", { seenWaitMs: 0 });
    assert.match(JSON.stringify(withoutUrl), /PUBLIC_BOT_URL/);
    assert.equal(missing.calls.length, 0);
    assert.equal(missing.repo.agentForClient("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), null);

    stopped.repo.insertClient({ ...clientRow("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "200000000000000001", "Mesa A"), infraId: INFRA });
    const parked = await stopped.app.admin.installAgent(GUILD, ACTOR, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", { seenWaitMs: 0 });
    assert.match(JSON.stringify(parked), /desligada/);
    assert.equal(stopped.repo.agentForClient("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), null);

    failed.repo.insertClient({ ...clientRow("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "200000000000000001", "Mesa A"), infraId: INFRA });
    const broken = await failed.app.admin.installAgent(GUILD, ACTOR, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", { seenWaitMs: 0 });
    assert.match(JSON.stringify(broken), /token novo não foi gravado/);
    assert.equal(failed.repo.agentForClient("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), null);

    installed.repo.insertClient({ ...clientRow("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "200000000000000001", "Mesa A"), infraId: INFRA });
    const progress = [];
    const done = await installed.app.admin.installAgent(GUILD, ACTOR, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", {
      seenWaitMs: 0,
      onProgress: (view) => progress.push(JSON.stringify(view)),
    });
    const token = /\$token = '([^']+)'/.exec(installed.calls[0].script)[1];
    assert.match(installed.calls[0].script, /http:\/\/203\.0\.113\.10:12345/);
    assert.match(installed.calls[0].script, /--creds/);
    assert.match(installed.calls[0].script, /schtasks\.exe/);
    assert.doesNotMatch(installed.calls[0].script, /winget/);
    assert.equal(installed.repo.agentForClient("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").tokenHash, hashAgentToken(token));
    assert.equal(fs.readFileSync(path.join(installed.dir, "atlas.sqlite")).includes(token), false);
    assert.equal(`${installed.logs.join("\n")}\n${errors.join("\n")}`.includes(token), false);
    assert.match(JSON.stringify(done), /agente offline/);
    assert.match(progress.join("\n"), /Instalando o agente/);
    const listed = await installed.app.admin.listAzureVms(GUILD, ACTOR, 0);
    const found = installed.app.admin.search(GUILD, ACTOR, "Mesa");
    assert.match(JSON.stringify(listed), /atlas:admin:agent:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/);
    assert.match(JSON.stringify(found), /Instalar\/Reinstalar agente/);
    assert.match(buildAgentInstallScript({ botUrl: "http://203.0.113.10:1", token: "abc", installSunshine: true, source: "agente" }), /LizardByte\.Sunshine/);
  } finally {
    console.error = original;
    missing.close();
    stopped.close();
    failed.close();
    installed.close();
  }
});

test("Run Command não roda em VM parada e o erro não leva o script", async () => {
  const secret = "token-que-nao-pode-aparecer";
  const script = `linha ${secret}`;
  const config = readConfig({
    DISCORD_TOKEN: "token",
    DISCORD_CLIENT_ID: "100000000000000003",
    AZURE_TENANT_ID: "tenant",
    AZURE_CLIENT_ID: "client",
    AZURE_CLIENT_SECRET: "secret",
    AZURE_SUBSCRIPTION_ID: "sub",
  });
  let ran = false;
  const stopped = createInfrastructure(config, {
    compute: {
      virtualMachines: {
        async instanceView() { return { statuses: [{ code: "PowerState/deallocated" }] }; },
        async beginRunCommandAndWait() { ran = true; },
      },
    },
    readTimeoutMs: 50,
    writeTimeoutMs: 50,
  });
  assert.equal((await stopped.runCommand(INFRA, script)).reason, "stopped");
  assert.equal(ran, false);
  const original = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const broken = createInfrastructure(config, {
      compute: {
        virtualMachines: {
          async instanceView() { return { statuses: [{ code: "PowerState/running" }] }; },
          async beginRunCommandAndWait() { throw new Error(`boom ${script}`); },
        },
      },
      readTimeoutMs: 50,
      writeTimeoutMs: 50,
    });
    await assert.rejects(() => broken.runCommand(INFRA, script));
    assert.equal(errors.join("\n").includes(secret), false);
    let input = null;
    const ok = createInfrastructure(config, {
      compute: {
        virtualMachines: {
          async instanceView() { return { statuses: [{ code: "PowerState/running" }] }; },
          async beginRunCommandAndWait(_group, _name, body) {
            input = body;
            return { value: [{ code: "ComponentStatus/StdOut/succeeded", message: "agente instalado" }] };
          },
        },
      },
      readTimeoutMs: 50,
      writeTimeoutMs: 50,
    });
    assert.equal((await ok.runCommand(INFRA, script)).mode, "azure");
    assert.equal(input.commandId, "RunPowerShellScript");
    assert.deepEqual(input.script, [script]);
  } finally {
    console.error = original;
  }
});

test("pedido vencido não sai no poll", async () => {
  const env = world();
  try {
    env.repo.insertClient(clientRow("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "200000000000000001", "Mesa A"));
    const client = env.repo.getById(GUILD, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    const token = env.app.agents.issueToken(GUILD, client, "admin");
    env.app.agents.queuePin({ guildId: GUILD, client, userId: client.userId, pin: "9081" });
    env.setClock(1_700_000_000_000 + 121_000);
    const job = await env.app.agents.poll(env.app.agents.authenticate(token), { waitMs: 0 });
    assert.equal(job, null);
  } finally {
    env.close();
  }
});
