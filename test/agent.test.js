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
