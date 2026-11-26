import { createHmac, timingSafeEqual } from "node:crypto";

export const WYZECASH_API_BASE = "https://app.wyzecash.com.br/v1";

export function verifyWyzeCashSignature(raw, headers, secret, now = Date.now()) {
  const header = String(headers?.["x-wyzecash-signature"] ?? "");
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((part) => {
    const cut = part.indexOf("=");
    return cut < 0 ? [part.trim(), ""] : [part.slice(0, cut).trim(), part.slice(cut + 1).trim()];
  }));
  const stamp = parts.t || "";
  const given = parts.v1 || "";
  if (!/^\d+$/.test(stamp) || !/^[0-9a-f]{64}$/i.test(given)) return false;
  if (Math.abs(now / 1000 - Number(stamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${stamp}.${raw}`).digest("hex");
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(given, "hex");
  return left.length === right.length && left.length === 32 && timingSafeEqual(left, right);
}

export function webhookEvent(body, headers) {
  return String(body?.type || headers?.["x-wyzecash-event"] || "");
}

export function webhookEventId(body, headers) {
  return String(body?.id || headers?.["x-wyzecash-delivery"] || "");
}

export function paymentAmount(body) {
  const value = body?.data?.amount;
  return Number.isInteger(value) ? value : null;
}

export function paymentId(body) {
  return String(body?.data?.id || "");
}

export function createWyzeCashClient({ apiKey = "", baseUrl = WYZECASH_API_BASE, fetchImpl = globalThis.fetch } = {}) {
  const root = String(baseUrl || WYZECASH_API_BASE).replace(/\/$/, "");
  async function request(path, { method = "GET", body, idempotencyKey } = {}) {
    const headers = { authorization: `Bearer ${apiKey}`, accept: "application/json" };
    if (body) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    const response = await fetchImpl(`${root}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error("wyzecash");
      error.status = response.status;
      error.code = payload?.error?.code || "";
      throw error;
    }
    return payload;
  }
  return {
    configured: Boolean(apiKey),
    async createPayment({ cents, description, idempotencyKey }) {
      const body = await request("/payments", {
        method: "POST",
        idempotencyKey,
        body: { amount: cents, description: String(description || "Ignix Cloud PC").slice(0, 140), method: "pix" },
      });
      return {
        id: body.id || "",
        copyPaste: body.copyPaste || "",
        expiresAt: body.expiresAt || "",
        status: body.status || "",
        amount: body.amount,
      };
    },
    async getPayment(id) {
      const body = await request(`/payments/${encodeURIComponent(id)}`);
      return {
        id: body.id || id,
        copyPaste: body.copyPaste || "",
        expiresAt: body.expiresAt || "",
        status: body.status || "",
        amount: body.amount,
      };
    },
  };
}
