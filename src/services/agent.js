import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export const AGENT_JOB_TTL_MS = 120_000;
export const AGENT_ONLINE_MS = 60_000;
const POLL_SLICE_MS = 200;

export function hashAgentToken(token) {
  return createHash("sha256").update(String(token ?? "")).digest("hex");
}

export function agentLabel(row, now) {
  if (!row) return "agente não instalado";
  if (row.lastSeenAt && now - row.lastSeenAt <= AGENT_ONLINE_MS) return "agente online";
  return "agente offline";
}

function safeDetail(detail, pin) {
  const text = String(detail ?? "").slice(0, 200);
  if (pin && text.includes(pin)) return "resultado recebido";
  return text || "resultado recebido";
}

export function createAgentService({ repo, audit, now = () => Date.now(), waiters = new Map() }) {
  const hits = new Map();

  function limited(key, max) {
    const stamp = now();
    const recent = (hits.get(key) ?? []).filter((item) => stamp - item < 60_000);
    if (recent.length >= max) {
      hits.set(key, recent);
      return true;
    }
    recent.push(stamp);
    hits.set(key, recent);
    return false;
  }

  function authenticate(token) {
    const digest = Buffer.from(hashAgentToken(token || "vazio"), "hex");
    const dummy = Buffer.alloc(32, 1);
    let found = null;
    const rows = repo.allAgentTokens();
    if (!rows.length) timingSafeEqual(digest, dummy);
    for (const row of rows) {
      const stored = Buffer.from(row.tokenHash, "hex");
      const same = stored.length === digest.length && timingSafeEqual(stored, digest);
      if (same) found = row;
    }
    return found;
  }

  return {
    authenticate,
    limited,
    issueToken(guildId, client, actorId) {
      const token = randomBytes(32).toString("base64url");
      repo.saveAgentToken({ clientId: client.id, guildId, tokenHash: hashAgentToken(token), now: now() });
      return token;
    },
    async recordIssue(guildId, actorId, client) {
      await audit.record({
        guildId,
        actorId,
        action: "agente_token",
        targetUserId: client.userId,
        machineName: client.machineName,
        detail: `Token do agente gerado para ${client.machineName}. O valor não entra neste registro.`,
      });
    },
    statusFor(clientId) {
      return agentLabel(repo.agentForClient(clientId), now());
    },
    online(clientId) {
      const row = repo.agentForClient(clientId);
      return Boolean(row?.lastSeenAt && now() - row.lastSeenAt <= AGENT_ONLINE_MS);
    },
    hasToken(clientId) {
      return Boolean(repo.agentForClient(clientId));
    },
    queuePin({ guildId, client, userId, pin }) {
      const job = {
        id: randomUUID(),
        guildId,
        clientId: client.id,
        userId,
        pin,
        deviceName: String(client.machineName || "Atlas").slice(0, 32),
        now: now(),
        expiresAt: now() + AGENT_JOB_TTL_MS,
      };
      repo.insertAgentJob(job);
      return job;
    },
    watch(jobId, notify) {
      waiters.set(jobId, notify);
    },
    async poll(client, { version = "", sunshineOk = false, waitMs = 25_000 } = {}) {
      repo.touchAgent({ clientId: client.clientId, now: now(), version: String(version).slice(0, 32), sunshineOk });
      const deadline = Date.now() + waitMs;
      do {
        const job = repo.claimAgentJob(client.clientId, now());
        if (job) return { id: job.id, pin: job.pin, name: job.deviceName };
        if (Date.now() >= deadline) return null;
        await new Promise((resolve) => setTimeout(resolve, POLL_SLICE_MS));
      } while (Date.now() < deadline);
      return null;
    },
    async result(client, { id, ok, detail }) {
      const job = repo.getAgentJob(id);
      if (!job || job.clientId !== client.clientId || job.expiresAt <= now()) return false;
      const clean = safeDetail(detail, job.pin);
      const status = ok ? "done" : "failed";
      const saved = repo.finishAgentJob({ id, clientId: client.clientId, status, detail: clean });
      const notify = waiters.get(id);
      waiters.delete(id);
      if (notify) {
        await notify({ ok: Boolean(ok), detail: clean, pin: job.pin });
      }
      await audit.record({
        guildId: job.guildId,
        actorId: job.userId,
        action: ok ? "moonlight_ok" : "moonlight_falha",
        targetUserId: job.userId,
        machineName: job.deviceName,
        detail: ok ? "Moonlight autorizado com acesso completo." : "O agente não liberou o PIN.",
        secrets: [job.pin],
      });
      return saved;
    },
  };
}
