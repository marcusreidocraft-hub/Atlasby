import http from "node:http";

export function createStoreHttp(handler) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (req.method !== "POST" || url.pathname !== "/wyvi/webhook") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "não encontrado" }));
        return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1_000_000) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      const status = await handler(raw, req.headers);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: status === 200 }));
    } catch (error) {
      console.error(`Webhook: ${error instanceof Error ? error.message : "erro"}`);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
}
