import http from "node:http";
import { logInteractionError } from "./components/reply.js";

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) return null;
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

function bearer(header) {
  const match = /^Bearer\s+(\S+)$/i.exec(String(header ?? ""));
  return match ? match[1] : "";
}

export function createAgentHttp(agents) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const ip = req.socket.remoteAddress || "local";
      if (agents.limited(`ip:${ip}`, 80)) {
        send(res, 429, { error: "muitas requisições" });
        return;
      }
      const token = bearer(req.headers.authorization);
      const client = agents.authenticate(token);
      if (!client) {
        send(res, 401, { error: "não autorizado" });
        return;
      }
      if (agents.limited(`token:${client.clientId}`, 30)) {
        send(res, 429, { error: "muitas requisições" });
        return;
      }
      if (req.method === "GET" && url.pathname === "/agent/v1/poll") {
        const job = await agents.poll(client, {
          version: req.headers["x-agent-version"],
          sunshineOk: req.headers["x-sunshine-ok"] === "1",
          waitMs: 25_000,
        });
        send(res, 200, { job });
        return;
      }
      if (req.method === "POST" && url.pathname === "/agent/v1/result") {
        const body = await readJson(req);
        if (!body || typeof body.id !== "string") {
          send(res, 400, { error: "pedido inválido" });
          return;
        }
        const saved = await agents.result(client, { id: body.id, ok: body.ok === true, detail: body.detail });
        send(res, saved ? 200 : 404, saved ? { ok: true } : { error: "pedido não encontrado" });
        return;
      }
      send(res, 404, { error: "não encontrado" });
    } catch (error) {
      logInteractionError(error);
      if (!res.headersSent) send(res, 500, { error: "erro interno" });
    }
  });
}

export function listenAgent(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}
