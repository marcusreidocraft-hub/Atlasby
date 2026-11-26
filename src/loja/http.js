import http from "node:http";
import { handleResellerHttp } from "../reseller/http.js";

export function createStoreHttp(handler, extras = {}) {
  const webhook = typeof handler === "function" ? handler : handler?.webhook;
  const resellers = extras.resellers || (typeof handler === "object" ? handler?.resellers : null);
  return http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url || "/", "http://127.0.0.1");
      if (url.pathname.startsWith("/api/reseller/")) {
        if (!resellers) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "não encontrado" }));
          return;
        }
        await handleResellerHttp(req, res, url, resellers);
        return;
      }
      if (req.method !== "POST" || url.pathname !== "/webhooks/wyzecash") {
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
      const status = await webhook(raw, req.headers);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: status === 200 }));
    } catch (error) {
      if (url?.pathname?.startsWith("/api/reseller/")) {
        console.error("API revendedor: erro");
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "erro interno" }));
        }
        return;
      }
      console.error(`Webhook: ${error instanceof Error ? error.message : "erro"}`);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
}
