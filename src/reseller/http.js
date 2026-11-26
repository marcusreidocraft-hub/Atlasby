const BODY_LIMIT = 8_192;

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) return { tooBig: true, raw: "" };
    chunks.push(chunk);
  }
  return { tooBig: false, raw: Buffer.concat(chunks).toString("utf8") };
}

function bearer(headers) {
  const header = String(headers?.authorization || headers?.Authorization || "");
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : "";
}

export async function handleResellerHttp(req, res, url, resellers) {
  if (req.method === "OPTIONS") {
    send(res, 405, { error: "não permitido" });
    return;
  }
  const token = bearer(req.headers);
  if (!resellers.allow(token)) {
    send(res, 429, { error: "muitas requisições" });
    return;
  }
  const reseller = token ? resellers.authenticate(token) : null;
  if (!reseller) {
    send(res, 401, { error: "não autorizado" });
    return;
  }
  let body = {};
  if (req.method === "POST") {
    const incoming = await readBody(req);
    if (incoming.tooBig) {
      send(res, 413, { error: "corpo grande demais" });
      return;
    }
    if (incoming.raw) {
      try { body = JSON.parse(incoming.raw); } catch {
        send(res, 400, { error: "json inválido" });
        return;
      }
    }
  }
  const result = await resellers.handle(reseller, req.method, url.pathname, body);
  if (result.job) void result.job.catch(() => {});
  send(res, result.status, result.body);
}
