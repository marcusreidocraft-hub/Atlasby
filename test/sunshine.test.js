import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { createSunshineAgent } from "../src/services/sunshine.js";

const GUILD = "100000000000000001";
const CLIENT = "200000000000000001";
const IP = "203.0.113.10";

function world(sunshine, secret = "segredo-compartilhado") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-sun-"));
  const repo = openDatabase(dir);
  const logs = [];
  const config = readConfig({
    DISCORD_TOKEN: "token",
    DISCORD_CLIENT_ID: "100000000000000003",
    ALLOWED_GUILD_IDS: GUILD,
    AGENT_SECRET: secret,
    ADMIN_LOG_CHANNEL_ID: "100000000000000008",
  });
  repo.insertClient({
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", guildId: GUILD, userId: CLIENT, clientName: "Ana", machineName: "Mesa",
    gpu: "Tesla T4", vcpus: 4, ram: "28 GB", publicIp: IP, rdpUser: null, rdpPasswordCipher: null, pinCipher: null,
    planType: "mensal", startedAt: 1, expiresAt: 2, infraId: "", powerStatus: "ligada", now: 1,
  });
  const app = createApp({
    config,
    repo,
    infra: { configured: false, async readPower() { return { mode: "manual", status: null, reason: "unconfigured" }; } },
    sunshine,
    deliverLog(_channel, payload) {
      logs.push(JSON.stringify(payload));
      return true;
    },
  });
  return { app, repo, logs, dir, close() { repo.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test("o PIN sai para o IP público com o segredo compartilhado e não entra no log", async () => {
  const calls = [];
  const sunshine = createSunshineAgent({
    secret: "segredo-compartilhado",
    port: 7474,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, async json() { return { ok: true, result: "aceito" }; } };
    },
  });
  const env = world(sunshine);
  const original = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const view = await env.app.clients.submitPin(GUILD, CLIENT, "2468");
    assert.equal(calls[0].url, "http://203.0.113.10:7474/pin");
    assert.equal(calls[0].options.headers.authorization, "Bearer segredo-compartilhado");
    assert.equal(calls[0].options.body, JSON.stringify({ pin: "2468" }));
    assert.match(JSON.stringify(view), /Moonlight autorizado com acesso completo/);
    assert.equal(`${env.logs.join("\n")}\n${errors.join("\n")}`.includes("2468"), false);
    const bad = await env.app.clients.submitPin(GUILD, CLIENT, "12");
    assert.match(JSON.stringify(bad), /4 dígitos/);
    assert.equal(calls.length, 1);
  } finally {
    console.error = original;
    env.close();
  }
});

test("VM desligada, agente fora e segredo vazio têm avisos próprios", async () => {
  let calls = 0;
  const sunshine = createSunshineAgent({
    secret: "segredo-compartilhado",
    fetchImpl: async () => {
      calls += 1;
      const error = new Error("abort");
      error.name = "AbortError";
      throw error;
    },
  });
  const env = world(sunshine);
  try {
    env.repo.updatePower("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "desligada", 1);
    const opened = env.app.clients.pinStart(GUILD, CLIENT);
    assert.match(JSON.stringify(opened.payload), /Ligue a máquina primeiro/);
    assert.equal(calls, 0);
    env.repo.updatePower("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "ligada", 1);
    const offline = await env.app.clients.submitPin(GUILD, CLIENT, "1357");
    assert.match(JSON.stringify(offline), /Agente da VM não respondeu, tente de novo em instantes/);
    const empty = world(createSunshineAgent({ secret: "" }), "");
    try {
      const missing = empty.app.clients.pinStart(GUILD, CLIENT);
      assert.match(JSON.stringify(missing.payload), /AGENT_SECRET/);
    } finally {
      empty.close();
    }
    const failed = createSunshineAgent({
      secret: "segredo-compartilhado",
      fetchImpl: async () => ({ ok: false, status: 502, async json() { return { ok: false, error: "sunshine" }; } }),
    });
    const sunshineError = await failed.releasePin(IP, "9081");
    assert.equal(sunshineError.error, "sunshine");
  } finally {
    env.close();
  }
});

test("o agente do Windows registra o callback e não aceita outro nome de config", () => {
  const agent = fs.readFileSync(path.join(process.cwd(), "agent/agent.ps1"), "utf8");
  const install = fs.readFileSync(path.join(process.cwd(), "agent/install.ps1"), "utf8");
  assert.match(agent, /class LocalTrust2/);
  assert.match(agent, /RemoteCertificateValidationCallback Callback/);
  assert.match(agent, /ServerCertificateValidationCallback = \[AtlasCloudPC\.LocalTrust2\]::Callback/);
  assert.match(agent, /C:\\ProgramData\\AtlasCloudPC\\agent\.log/);
  assert.doesNotMatch(agent, /LocalTrust\]::Allow/);
  assert.match(install, /Não encontrei agent\.config\.json/);
  assert.doesNotMatch(install, /agent\.config \(1\)/);
});

test("desparear só chama o agente depois da confirmação", async () => {
  const calls = [];
  const sunshine = createSunshineAgent({
    secret: "segredo-compartilhado",
    fetchImpl: async (url, options) => {
      calls.push({ url, body: options.body });
      return { ok: true, async json() { return { ok: true, result: "despareado" }; } };
    },
  });
  const env = world(sunshine);
  try {
    const ask = await env.app.clients.askUnpair(GUILD, CLIENT);
    const id = JSON.stringify(ask).match(/atlas:vm:unpair:yes:([0-9a-f-]{36})/)[1];
    assert.equal(calls.length, 0);
    const done = await env.app.clients.confirmUnpair(GUILD, CLIENT, id);
    assert.equal(calls[0].url, "http://203.0.113.10:7474/unpair-all");
    assert.match(JSON.stringify(done), /dispositivos pareados foram removidos/);
    assert.equal(readConfig({ AGENT_PORT: "" }).agentPort, 7474);
  } finally {
    env.close();
  }
});
